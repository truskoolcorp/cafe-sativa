/** Next's Node adapter can represent an empty POST as a non-null stream.
 * Accept EOF only: no buffering, decoding, JSON or request-controlled scope.
 * Stop on the first byte/chunk, failed read, abort or finite deadline. */
export async function hasEmptyRequestBody(req:Request,deadlineMs=500):Promise<boolean>{
 if(req.signal.aborted||req.bodyUsed)return false
 if(req.body===null)return true
 let reader:ReadableStreamDefaultReader<Uint8Array>
 try{reader=req.body.getReader()}catch{return false}
 let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{}
 const read=(async()=>{
  // Bound pathological streams emitting empty chunks as well as wall clock.
  for(let n=0;n<8;n++){
   const item=await reader.read()
   if(req.signal.aborted)return false
   if(item.done)return true
   if(!(item.value instanceof Uint8Array)||item.value.byteLength>0)return false
  }
  return false
 })()
 try{return await Promise.race([read,new Promise<boolean>(resolve=>{
  abort=()=>resolve(false);req.signal.addEventListener('abort',abort,{once:true})
  if(req.signal.aborted)resolve(false)
  timer=setTimeout(()=>resolve(false),deadlineMs)
 })])}catch{return false}
 finally{
  clearTimeout(timer);req.signal.removeEventListener('abort',abort)
  // Do not await cancellation: an uncooperative source cannot hold this guard.
  void reader.cancel().catch(()=>{})
 }
}
