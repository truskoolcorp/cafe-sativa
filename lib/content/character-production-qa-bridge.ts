import {createHash} from 'node:crypto'
import type {ProductionRpc} from './character-production-store.ts'

/** Server-only dependencies. download must bound streaming bytes, reject redirects,
 * and retrieve authenticated bytes without public or signed URLs. */
export interface QaBridgeObjects {
 getBucket(id:string):PromiseLike<{data:{id:string;public:boolean}|null;error:unknown}>
 from(id:string):{
  download(path:string,maxBytes:number):PromiseLike<{data:Uint8Array|null;error:unknown}>
  upload(path:string,bytes:Uint8Array,options:{contentType:'video/mp4';upsert:false}):PromiseLike<{error:unknown}>
 }
}
const MIN=16,MAX=35*1024*1024
const hash=/^[a-f0-9]{64}$/,keyPattern=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
type Manifest={state:'copy'|'committed';key:string;digest:string;sha:string;bytes:number;characterId:string;promoId:string;expectedUpdatedAt:string;sourceBucket:string;sourcePath:string;destinationBucket:string;destinationPath:string}
function manifest(value:unknown,key:string,digest:string):Manifest {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid QA manifest')
 const m=value as Manifest
 if(!['copy','committed'].includes(m.state)||m.key!==key||m.digest!==digest||typeof m.sha!=='string'||!hash.test(m.sha)||
 !Number.isSafeInteger(m.bytes)||m.bytes<MIN||m.bytes>MAX||typeof m.characterId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(m.characterId)||
 typeof m.promoId!=='string'||!uuid.test(m.promoId)||typeof m.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(m.expectedUpdatedAt))||
 m.sourceBucket!=='character-production-private'||m.sourcePath!==`${digest}/${m.sha}.mp4`||m.destinationBucket!=='cafe-sativa-content'||
 m.destinationPath!==`character-promos/${m.characterId}/${m.promoId}/${m.sha}.mp4`)throw Error('Invalid QA manifest')
 return Object.freeze({...m})
}
export function createCharacterProductionQaBridge(rpc:ProductionRpc,storage:QaBridgeObjects) {
 async function call(name:string,args:Record<string,unknown>) {
  const result=await rpc.rpc(`character_production_qa_${name}`,args)
  if(result.error)throw Error('QA persistence unconfirmed')
  return result.data
 }
 async function privateBucket(id:string) {
  const r=await storage.getBucket(id)
  if(r.error||r.data?.id!==id||r.data.public!==false)throw Error('Private bucket required')
 }
 async function read(bucket:string,path:string,m:Manifest) {
  const r=await storage.from(bucket).download(path,MAX)
  if(r.error||!(r.data instanceof Uint8Array)||r.data.length!==m.bytes)throw Error('QA bytes unavailable')
  const bytes=Uint8Array.from(r.data)
  if(createHash('sha256').update(bytes).digest('hex')!==m.sha||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw Error('QA bytes mismatch')
  return bytes
 }
 return {
  /** No caller-chosen target or enrollment. SQL owns the existing draft binding. */
  async ingest(key:string,digest:string) {
   if(typeof key!=='string'||!keyPattern.test(key)||typeof digest!=='string'||!hash.test(digest))throw Error('Invalid QA job')
   const prepared=await call('prepare',{p_key:key,p_digest:digest})
   if(prepared===null)return {status:'held' as const}
   const m=manifest(prepared,key,digest)
   await privateBucket(m.sourceBucket);await privateBucket(m.destinationBucket)
   if(m.state==='committed') {
    await read(m.destinationBucket,m.destinationPath,m)
    return {status:'ingested' as const}
   }
   const bytes=await read(m.sourceBucket,m.sourcePath,m)
   // Never retry upload or trust conflict status. Reconcile only exact readback.
   try {await storage.from(m.destinationBucket).upload(m.destinationPath,bytes,{contentType:'video/mp4',upsert:false})}catch{/* read back or fail closed */}
   await read(m.destinationBucket,m.destinationPath,m)
   await privateBucket(m.sourceBucket);await privateBucket(m.destinationBucket)
   const result=await call('commit',{p_key:key,p_digest:digest,p_sha:m.sha,p_bytes:m.bytes,
    p_promo_id:m.promoId,p_expected_updated_at:m.expectedUpdatedAt,
    p_destination_bucket:m.destinationBucket,p_destination_path:m.destinationPath})
   return {status:result===true?'ingested' as const:'held' as const}
  },
 }
}
/** Local queue runner only. Default-off, no client initialization, no scheduler,
 * enrollment, rendering, provider calls, QA approvals or publication. */
export function createCharacterProductionQaRunner(enabled=false,
 open?:()=>{rpc:ProductionRpc;bridge:ReturnType<typeof createCharacterProductionQaBridge>}) {
 let deps:ReturnType<NonNullable<typeof open>>|undefined
 return {async run(){
  if(enabled!==true)return {status:'disabled' as const,checked:0,ingested:0,held:0}
  if(!open)throw Error('QA dependencies required')
  const d=deps||(deps=open())
  const response=await d.rpc.rpc('character_production_qa_pending',{p_limit:5})
  if(response.error)throw Error('QA queue unavailable')
  const rows=response.data
  if(!Array.isArray(rows)||rows.length>5||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||
   typeof row.key!=='string'||!keyPattern.test(row.key)||typeof row.digest!=='string'||!hash.test(row.digest)||
   Object.keys(row).some(k=>k!=='key'&&k!=='digest')))throw Error('Invalid QA queue')
  const unique=new Map<string,string>()
  for(const row of rows){
   if(unique.has(row.key)&&unique.get(row.key)!==row.digest)throw Error('Conflicting QA identity')
   unique.set(row.key,row.digest)
  }
  let ingested=0,held=0
  for(const [key,digest] of unique){
   try{const r=await d.bridge.ingest(key,digest);if(r.status==='ingested')ingested++;else held++}catch{held++}
  }
  return {status:'checked' as const,checked:unique.size,ingested,held}
 }}
}
