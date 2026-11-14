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
 return {async subscription(){
  const value=await get('/v1/user/subscription')
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.tier!=='string'||! /^[a-z0-9_-]{1,80}$/i.test(value.tier)||!Number.isSafeInteger(value.character_count)||value.character_count<0||!Number.isSafeInteger(value.character_limit)||value.character_limit<0)throw Error('Unverified quota metadata')
  const extension=value.max_credit_limit_extension
  const cap=extension==='unlimited'?'unlimited':Number.isSafeInteger(extension)&&extension>=0?extension:null
  return {tier:value.tier,usedCharacters:value.character_count,characterLimit:value.character_limit,remainingCharacters:Math.max(0,value.character_limit-value.character_count),overageEntitled:typeof value.can_extend_character_limit==='boolean'?value.can_extend_character_limit:null,overageCapCredits:cap,overageEnabled:cap===null||typeof value.can_extend_character_limit!=='boolean'?null:value.can_extend_character_limit&&cap!==0,spendAuthorized:false}
 },async inspect(voiceId:string,modelId:string){
  if(!/^[A-Za-z0-9]{1,64}$/.test(voiceId)||!/^eleven_[a-z0-9_]{1,80}$/.test(modelId))throw Error('Invalid exact inventory identity')
  const [models,voice]=await Promise.all([get('/v1/models'),get('/v1/voices/'+encodeURIComponent(voiceId))])
  if(!Array.isArray(models)||models.length>100||!voice||voice.voice_id!==voiceId)throw Error('Unexpected inventory')
  const usable=models.filter(m=>m&&typeof m.model_id==='string'&&/^eleven_[a-z0-9_]{1,80}$/.test(m.model_id)&&m.can_do_text_to_speech===true)
  return {voiceId,voiceFound:true,requestedModel:modelId,modelAvailable:usable.filter(m=>m.model_id===modelId).length===1,availableTtsModelIds:usable.map(m=>m.model_id),canonicalBindingVerified:false,synthesisAuthorized:false}
 }}
}
