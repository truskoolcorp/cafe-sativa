import type {SpeechProvider} from './character-production-speech.ts'
/** Existing server key accessor. This factory performs no call until the ledger
 * orchestrator invokes synthesize. Official response request-id is mandatory;
 * missing receipt, abort or non200 is unknown, never retried. */
export function createElevenLabsSpeech(key:()=>string|undefined,accountBinding:string,fetcher:typeof fetch=fetch,timeoutMs=20000):SpeechProvider{
 if(!accountBinding||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw Error('Invalid speech configuration')
 return {async synthesize(s){
  if(s.accountBinding!==accountBinding||!/^[A-Za-z0-9]{1,64}$/.test(s.voiceId)||!/^eleven_[a-z0-9_]{1,80}$/.test(s.voiceModel))throw Error('Wrong speech binding')
  const secret=key();if(!secret||secret.length>4096||/[\r\n]/.test(secret))throw Error('Speech key unavailable')
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([(async()=>{
   const r=await fetcher('https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(s.voiceId)+'?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':secret,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:s.script,model_id:s.voiceModel}),signal:c.signal,redirect:'error',cache:'no-store'})
   const requestId=r.headers.get('request-id')
   if(r.status!==200||!requestId||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(requestId)||r.headers.get('content-type')?.split(';')[0].trim()!=='audio/mpeg'||!r.body)throw Error('Unconfirmed speech response')
   const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>32*1024*1024))throw Error('Speech size rejected')
   const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0
   try{while(true){const p=await reader.read();if(c.signal.aborted)throw Error('Speech timed out');if(p.done)break;size+=p.value.length;if(size>32*1024*1024||parts.length>=4096)throw Error('Speech exceeds cap');parts.push(Uint8Array.from(p.value))}if(size<12||(length!==null&&Number(length)!==size))throw Error('Speech length mismatch');return {requestId,bytes:Buffer.concat(parts,size)}}finally{void reader.cancel().catch(()=>{})}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('Speech outcome unknown'))},timeoutMs)})])}finally{clearTimeout(timer);c.abort()}
 }}
}
