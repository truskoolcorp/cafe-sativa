/** Per-tick backend transport, without retries. Both inherited SDK/provider
 * cancellation and the finite tick abort requests, including response bodies. */
export function createProductionFetch(tick:AbortSignal,fetcher:typeof fetch=fetch,timeoutMs=8000){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid backend deadline')
 const pending=new Set<Promise<unknown>>()
 function track<T>(task:Promise<T>):Promise<T>{pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task}
 const bounded:typeof fetch=async(input,init)=>{
  if(tick.aborted)throw Error('Production tick cancelled')
  const c=new AbortController(),inherited=init?.signal??(input instanceof Request?input.signal:null)
  const abort=()=>c.abort()
  tick.addEventListener('abort',abort,{once:true});inherited?.addEventListener('abort',abort,{once:true})
  if(tick.aborted||inherited?.aborted)abort()
  const timer=setTimeout(abort,timeoutMs)
  const cleanup=()=>{clearTimeout(timer);tick.removeEventListener('abort',abort);inherited?.removeEventListener('abort',abort)}
  const task=track(Promise.resolve().then(()=>{
   if(c.signal.aborted)throw Error('Production request cancelled')
   return fetcher(input,{...init,signal:c.signal,cache:'no-store',redirect:'error'})
  }))
  void task.then(response=>{if(c.signal.aborted&&response.body)void track(response.body.cancel()).catch(()=>{})},()=>{})
  try{
   const response=await Promise.race([task,new Promise<never>((_,reject)=>{
    c.signal.addEventListener('abort',()=>reject(Error('Production request unconfirmed')),{once:true})
    if(c.signal.aborted)reject(Error('Production request cancelled'))
   })])
   if(c.signal.aborted)throw Error('Production request expired')
   if(!response.body){cleanup();return response}
   const reader=response.body.getReader()
   let cancellation:Promise<void>|undefined
   const cancel=()=>cancellation??(cancellation=track(reader.cancel()))
   const stream=new ReadableStream<Uint8Array>({
    async pull(controller){try{
     if(c.signal.aborted)throw Error('Production body expired')
     const p=await track(reader.read())
     if(c.signal.aborted)throw Error('Production body expired')
     if(p.done){cleanup();controller.close()}else controller.enqueue(p.value)
    }catch(e){cleanup();controller.error(e);void cancel().catch(()=>{})}},
    async cancel(){cleanup();c.abort();await cancel()},
   })
   // Native fetch cancellation closes the reader. Explicit cancellation also
   // handles custom transports that only observe the signal at dispatch.
   c.signal.addEventListener('abort',()=>{cleanup();void cancel().catch(()=>{})},{once:true})
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers})
  }catch(e){cleanup();c.abort();throw e}
 }
 return {fetch:bounded,async whenSettled(){while(pending.size)await Promise.allSettled([...pending])}}
}
