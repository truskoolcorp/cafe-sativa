export const productionBuckets=[
 {id:'character-production-private',public:false as const,fileSizeLimit:35*1024*1024,allowedMimeTypes:['video/mp4']},
 {id:'character-production-audio',public:false as const,fileSizeLimit:8*1024*1024,allowedMimeTypes:['audio/mpeg','audio/wav']},
] as const
interface Metadata{id:string;public:boolean;file_size_limit?:number|null;allowed_mime_types?:string[]|null}
interface Result{data:unknown;error:{status?:number;statusCode?:string|number}|null}
export interface BucketProvisioningStorage{getBucket(id:string):PromiseLike<Result>;createBucket(id:string,options:{public:false;fileSizeLimit:number;allowedMimeTypes:string[]}):PromiseLike<Result>}
const deadline=async<T>(p:PromiseLike<T>)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Storage result unconfirmed')),5000)})])}finally{clearTimeout(timer)}}
function matches(d:Metadata,b:typeof productionBuckets[number]){return d?.id===b.id&&d.public===false&&d.file_size_limit===b.fileSizeLimit&&Array.isArray(d.allowed_mime_types)&&d.allowed_mime_types.length===b.allowedMimeTypes.length&&[...d.allowed_mime_types].sort().join('|')===[...b.allowedMimeTypes].sort().join('|')}
/** Fixed two private buckets only. Never updates/deletes a bucket or policies.
 * An unknown create response is held, never automatically retried. */
export async function provisionCharacterStorage(storage:BucketProvisioningStorage,create=false){
 const observed=[]
 for(const b of productionBuckets){const r=await deadline(storage.getBucket(b.id));if(r.error){if(Number(r.error.status??r.error.statusCode)!==404)throw Error('Storage inspection failed');observed.push({id:b.id,status:'missing'})}else observed.push({id:b.id,status:matches(r.data as Metadata,b)?'verified_private':'conflict'})}
 if(!create||observed.some(b=>b.status==='conflict'))return {ready:observed.every(b=>b.status==='verified_private'),buckets:observed,changed:false}
 const created:string[]=[]
 for(const b of productionBuckets){if(observed.find(x=>x.id===b.id)?.status!=='missing')continue
  const result=await deadline(storage.createBucket(b.id,{public:false,fileSizeLimit:b.fileSizeLimit,allowedMimeTypes:[...b.allowedMimeTypes]}));if(result.error)throw Error('Bucket creation unconfirmed; inspect before retrying')
  created.push(b.id)
  const check=await deadline(storage.getBucket(b.id));if(check.error||!matches(check.data as Metadata,b))throw Error('Private bucket verification failed')
 }
 return {ready:true,buckets:productionBuckets.map(b=>({id:b.id,status:'verified_private'})),changed:created.length>0}
}
