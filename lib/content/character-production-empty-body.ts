/** Validate transport-empty POSTs without accepting any caller payload. */
export function emptyQaBody(req:Request,signal:AbortSignal,timeoutMs=1000){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1000)throw Error('Invalid body deadline')
 const pending=new Set<Promise<unknown>>()
 function track<T>(p:Promise<T>){pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p}
 return {async check():Promise<'empty'|'nonempty'|'unconfirmed'>{
  if(signal.aborted)return 'unconfirmed'
  if(!req.body)return 'empty'
  const reader=req.body.getReader();let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined
  const cancel=()=>{if(!cancelled){cancelled=true;void track(reader.cancel()).catch(()=>{})}}
  let finishAbort:()=>void=()=>{}
  const abort=()=>{cancel();finishAbort()}
  const work=(async()=>{try{for(let n=0;n<16;n++){
   const part=await track(reader.read())
   if(cancelled||signal.aborted)return 'unconfirmed' as const
   if(part.done)return 'empty' as const
   if(!(part.value instanceof Uint8Array)||part.value.byteLength>0){cancel();return 'nonempty' as const}
  }cancel();return 'unconfirmed' as const}catch{cancel();return 'unconfirmed' as const}})()
  try{return await Promise.race([work,new Promise<'unconfirmed'>(resolve=>{
   finishAbort=()=>resolve('unconfirmed');signal.addEventListener('abort',abort,{once:true})
   timer=setTimeout(abort,timeoutMs);if(signal.aborted)abort()
  })])}finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort)}
 },async whenSettled(){while(pending.size)await Promise.allSettled([...pending])}}
}
