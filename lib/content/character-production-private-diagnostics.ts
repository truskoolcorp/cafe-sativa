/** Read-only source validation, never preparation context/claim or providers. */
export const PRIVATE_SOURCE_SCOPE={characterId:'zaria-solenne',roomKey:'gallery',assignmentRole:'primary_host',topic:'art-observation' as const,venueAssetId:'b84f9f4e-af29-476e-b55b-38e146a847c7',venueSha256:'89c327c4a82c3249f8bd1937891cd9dae6a8a34be556fbdab605168e2b845a04',verifiedCollaborators:[]}
const safeErrors=new Set(['Existing source read unavailable; no permission fallback','Current room assignment ambiguous','Approved current room reference changed or unresolved','Recent script history unavailable','Source snapshot changed or expired','GLYPH live connection not configured','GLYPH live source unavailable','Invalid canonical source response','Production request unconfirmed','Production request cancelled','Production request expired','Production tick cancelled','Cafe database response exceeds cap'])
const safeCodes=new Set(['glyph_unavailable','glyph_not_live','glyph_ambiguous_character','glyph_character_missing','glyph_context_missing','glyph_portrait_id_missing','glyph_portrait_hash_missing','glyph_voice_missing','glyph_portrait_invalid','glyph_rights_unapproved','glyph_voice_uncanonical','glyph_not_production_ready','glyph_evidence_too_large','invalid_source_json'])
type Reader={load():Promise<unknown>;whenSettled():Promise<void>}
export function createPrivateDiagnostics(d:{authorize():Promise<boolean>;open(signal:AbortSignal):Reader;retain(work:Promise<void>):void;now?:()=>number;deadlineMs?:number}){
 const now=d.now??Date.now,deadline=d.deadlineMs??60000,sunset=Date.parse('2026-11-17T06:00:00Z')
 if(!Number.isSafeInteger(deadline)||deadline<1||deadline>60000)throw Error('Invalid diagnostic deadline')
 let busy=false
 return async(req:Request)=>{
  const reply=(status:string,code:number,reason?:string)=>Response.json({status,reason,readOnly:true,generationAttempted:false},{status:code,headers:{'Cache-Control':'private, no-store'}})
  if(req.method!=='GET'||new URL(req.url).search)return reply('unsupported',403)
  if(now()>=sunset)return reply('expired',503)
  if(busy)return reply('busy',429);busy=true
  const c=new AbortController(),abort=()=>c.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)c.abort()
  const timer=setTimeout(abort,Math.min(deadline,Math.max(1,sunset-now())));let reader:Reader|undefined
  const check=()=>{c.signal.throwIfAborted();if(now()>=sunset)throw Error('Diagnostic expired')}
  const work=Promise.resolve().then(async()=>{try{check();if(!await d.authorize())return reply('unauthorized',401);check();reader=d.open(c.signal);check();await reader.load();check();return reply('sources_valid',200)}catch(e){const message=e instanceof Error?e.message:'',code=e&&typeof e==='object'&&'code' in e?e.code:undefined;return reply('source_validation_failed',503,typeof code==='string'&&safeCodes.has(code)?code:safeErrors.has(message)?message:message==='unavailable'?'bounded_canonical_read_unavailable':'unclassified_source_failure')}})
  const drain=work.then(async()=>{c.abort();try{await reader?.whenSettled();busy=false}catch{/* Failed drainage permanently holds this instance. */}finally{clearTimeout(timer);req.signal.removeEventListener('abort',abort)}})
  try{d.retain(drain)}catch{c.abort();void drain.catch(()=>{});return reply('retention_failed',503)}
  let onAbort=()=>{}
  const expired=new Promise<Response>(resolve=>{onAbort=()=>resolve(reply('held',503));c.signal.addEventListener('abort',onAbort,{once:true});if(c.signal.aborted)onAbort()})
  try{return await Promise.race([work,expired])}finally{c.signal.removeEventListener('abort',onAbort)}
 }
}
