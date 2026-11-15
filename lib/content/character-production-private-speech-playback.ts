import {createHash} from 'node:crypto'
import {verifyIncludedSpeechReceipt} from './character-production-speech-receipt.ts'
import type {IncludedSpeechOperation,IncludedOperationStore} from './character-production-included-speech-operation.ts'
type ReadStore=Pick<IncludedOperationStore,'preflight'|'readClaim'|'readProviderReceipt'|'readReceipt'|'readAudio'>
/** Fixed operation only. Authenticated private bytes, never signed URLs/provider calls. */
export function createPrivateSpeechPlayback(s:IncludedSpeechOperation,d:{authorize():Promise<boolean>;open(signal:AbortSignal):{store:ReadStore;whenSettled():Promise<void>};timeoutMs?:number;authMs?:number}){
 const scope=structuredClone(s),ms=d.timeoutMs??20000
 if(!Number.isSafeInteger(ms)||ms<1||ms>25000)throw Error('Invalid playback deadline')
 return async(req:Request)=>{
  const headers={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Vary':'Cookie'}
  const fail=(status:number)=>Response.json({status:status===401?'unauthorized':'private_audio_unavailable'},{status,headers})
  if(req.method!=='GET')return fail(405)
  if(new URL(req.url).search||req.body!==null||req.headers.get('sec-fetch-site')==='cross-site')return fail(400)
  const life=new AbortController(),abort=()=>life.abort();req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let opened:ReturnType<typeof d.open>|undefined,t:ReturnType<typeof setTimeout>|undefined,a:ReturnType<typeof setTimeout>|undefined
  const auth=Promise.resolve().then(()=>d.authorize())
  const task=(async()=>{
   if(await auth!==true||life.signal.aborted)return fail(401)
   opened=d.open(life.signal)
   const receipt=await verifyIncludedSpeechReceipt(scope,opened.store,life.signal)
   if(life.signal.aborted)throw Error('Cancelled')
   const bytes=await opened.store.readAudio(receipt.audioSha256,receipt.audioBytes)
   if(life.signal.aborted||bytes.length!==receipt.audioBytes||createHash('sha256').update(bytes).digest('hex')!==receipt.audioSha256)throw Error('Audio changed after receipt verification')
   return new Response(Uint8Array.from(bytes),{status:200,headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(bytes.length),'Content-Disposition':'inline; filename="zaria-look-again-private.mp3"','Accept-Ranges':'none'}})
  })()
  void task.finally(()=>opened?.whenSettled()).catch(()=>{})
  try{return await Promise.race([task,new Promise<Response>(resolve=>{
   a=setTimeout(()=>{abort();resolve(fail(401))},d.authMs??5000);void auth.finally(()=>clearTimeout(a)).catch(()=>{})
   t=setTimeout(()=>{abort();resolve(fail(503))},ms)
   life.signal.addEventListener('abort',()=>resolve(fail(503)),{once:true})
  })])}catch{return fail(503)}finally{clearTimeout(t);clearTimeout(a);abort();req.signal.removeEventListener('abort',abort)}
 }
}
