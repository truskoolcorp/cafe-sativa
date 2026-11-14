/** Official read-only GET /v1/models and /v1/voices/{voice_id}. Never infers
 * a direct API model from a connector label and never synthesizes speech. */
export function createElevenLabsInventory(key:()=>string|undefined,fetcher:typeof fetch=fetch){
 async function get(path:string){
  const secret=key();if(!secret||secret.length>4096||/[\r\n]/.test(secret))throw Error('ElevenLabs unavailable')
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([(async()=>{
   const r=await fetcher('https://api.elevenlabs.io'+path,{method:'GET',headers:{'xi-api-key':secret,Accept:'application/json'},signal:c.signal,redirect:'error',cache:'no-store'})
   if(r.status!==200||!r.body||!r.headers.get('content-type')?.includes('application/json'))throw Error('Inventory unavailable')
   const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0
   try{while(true){const p=await reader.read();if(c.signal.aborted)throw Error('Expired');if(p.done)break;size+=p.value.length;if(size>1_000_000||parts.length>=4096)throw Error('Inventory exceeds cap');parts.push(p.value)}return JSON.parse(Buffer.concat(parts).toString('utf8'))}finally{void reader.cancel().catch(()=>{})}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('Inventory expired'))},8000)})])}finally{clearTimeout(timer);c.abort()}
 }
 return {async inspect(voiceId:string,modelId:string){
  if(!/^[A-Za-z0-9]{1,64}$/.test(voiceId)||!/^eleven_[a-z0-9_]{1,80}$/.test(modelId))throw Error('Invalid exact inventory identity')
  const [models,voice]=await Promise.all([get('/v1/models'),get('/v1/voices/'+encodeURIComponent(voiceId))])
  if(!Array.isArray(models)||models.length>100||!voice||voice.voice_id!==voiceId)throw Error('Unexpected inventory')
  const usable=models.filter(m=>m&&typeof m.model_id==='string'&&/^eleven_[a-z0-9_]{1,80}$/.test(m.model_id)&&m.can_do_text_to_speech===true)
  return {voiceId,voiceFound:true,requestedModel:modelId,modelAvailable:usable.filter(m=>m.model_id===modelId).length===1,availableTtsModelIds:usable.map(m=>m.model_id),canonicalBindingVerified:false,synthesisAuthorized:false}
 }}
}
