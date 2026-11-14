/** JSON database transport bound before SDK JSON allocation. Private MP4
 * downloads use the separate existing streaming Storage adapter, not this cap. */
export function cafeBoundedReadFetch(fetcher:typeof fetch):typeof fetch{
 return async(input,init)=>{
  const r=await fetcher(input,init)
  if(!r.body)return r
  const length=r.headers.get('content-length')
  if(length&&(!/^\d+$/.test(length)||Number(length)>524288)){await r.body.cancel();throw Error('Cafe database response exceeds cap')}
  const reader=r.body.getReader();let bytes=0,chunks=0
  const body=new ReadableStream<Uint8Array>({
   async pull(controller){try{const p=await reader.read();if(p.done){controller.close();return}
    if(!(p.value instanceof Uint8Array)||p.value.length===0||++chunks>4096||(bytes+=p.value.length)>524288)throw Error('Cafe database response exceeds cap')
    controller.enqueue(p.value)
   }catch(e){controller.error(e);void reader.cancel().catch(()=>{})}},
   async cancel(){await reader.cancel()},
  })
  return new Response(body,{status:r.status,statusText:r.statusText,headers:r.headers})
 }
}
