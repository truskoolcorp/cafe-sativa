const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const ts=require('typescript')
function compile(path, deps={}) {
  const module={exports:{}}
  const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','exports','module',code)(id=>{
    if(Object.hasOwn(deps,id))return deps[id]
    if(id==='node:crypto')return require(id)
    throw Error('Unexpected dependency: '+id)
  },module.exports,module)
  return module.exports
}
const policy=compile('lib/gallery/zaria.ts')
const d=compile('lib/gallery/zaria-catalog.ts',{'./zaria':policy,'@supabase/supabase-js':{createClient(){throw Error('No network')}}})
const grants=compile('lib/concierge/livekit-session.ts',{'@/lib/gallery/zaria':policy})
const validVoice={NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT:'true',CS_ZARIA_GALLERY_LIVE_VOICE:'true',CS_ZARIA_LIVEKIT_VERIFIED_VOICE_ID:policy.ZARIA_VOICE.id,CS_ZARIA_LIVEKIT_VERIFIED_VOICE_MODEL:policy.ZARIA_VOICE.model,CS_ZARIA_LIVEKIT_AGENT_NAME:'cafe-sativa-zaria',CS_LIVEKIT_AGENT_NAME:'cafe-sativa-hosts'}
test('isolates Zaria rollout and refuses default, shared, and incompatible voice setup',()=>{
  assert.equal(policy.zariaVoiceAgent({}),null)
  assert.equal(policy.zariaVoiceAgent(validVoice),'cafe-sativa-zaria')
  for(const broken of [{CS_ZARIA_LIVEKIT_AGENT_NAME:'cafe-sativa-hosts'},{CS_ZARIA_LIVEKIT_VERIFIED_VOICE_MODEL:'eleven_turbo_v2_5'},{CS_ZARIA_LIVEKIT_VERIFIED_VOICE_ID:'different'},{NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT:'false'}])assert.equal(policy.zariaVoiceAgent({...validVoice,...broken}),null)
})
test('only the exact canonical primary approved portrait can display',()=>{
  const row={id:'zaria-solenne',production_ready:true,rights_status:'approved',primary_asset_id:policy.ZARIA_PORTRAIT.id,sha256:policy.ZARIA_PORTRAIT.sha256}
  assert.equal(policy.approvedZariaPortrait(row),true)
  for(const broken of [{sha256:'mismatch'},{rights_status:'pending'},{production_ready:false},{id:'ginger'}])assert.equal(policy.approvedZariaPortrait({...row,...broken}),false)
})
test('serves current work and real alternate links without leaking private or NFT candidates',()=>{
  const items=[{slug:'alternate',title:'Alternate',kind:'physical'},{slug:'current',title:'Current piece',kind:'digital'},{slug:'nft',title:'NFT',kind:'nft'},{slug:'../../admin',title:'Private',kind:'digital'}]
  const data=d.publicGallerySelection(items,'current')
  assert.equal(JSON.parse(data.context).current.title,'Current piece')
  assert.deepEqual(data.links.map(v=>v.path),['/gallery/current','/gallery/alternate','/gallery'])
  assert.equal(d.publicGallerySelection(items,'private').links.some(v=>v.path==='/gallery/private'),false)
  assert.equal(policy.zariaGalleryHref('/malicious'),' /ask?host=zaria'.trim())
})
test('empty and unverified catalog statuses are different and both offer a real Gallery link',()=>{
  for(const [rows,unavailable,status] of [[[],false,'no_public_listings'],[[{slug:'ignored',title:'Ignored',kind:'digital'}],true,'unavailable']]){
    const data=d.publicGallerySelection(rows,'ignored',unavailable)
    assert.equal(JSON.parse(data.context).status,status)
    assert.equal(JSON.parse(data.context).current,null)
    assert.deepEqual(data.links,[{label:'Explore the Gallery',path:'/gallery'}])
  }
})
test('selected work is signed for Zaria only; cross-host/invalid selections are not accepted',()=>{
  const base={conversationId:'10000000-0000-0000-0000-000000000000',userId:'20000000-0000-0000-0000-000000000000',expires:1800001}
  const encode=(host,galleryWork)=>grants.verifyVoiceSession(grants.signVoiceSession({...base,host,galleryWork},'fake'),'fake',100)
  assert.equal(encode('zaria','current').galleryWork,'current')
  assert.equal(encode('zaria','//outside'),null)
  assert.equal(encode('laviche','current'),null)
  assert.equal(encode('laviche',undefined).host,'laviche')
})

const bridge=compile('lib/gallery/zaria-voice-v1.ts',{'./zaria':policy})
const cfg={...validVoice,VERCEL_ENV:'preview',VERCEL_URL:'unique-preview.vercel.app',CS_ZARIA_PREVIEW_EXPECTED_HOST:'unique-preview.vercel.app',
 CS_ZARIA_PREVIEW_BRIDGE:'true',CS_LIVEKIT_ENABLED:'true',CS_ZARIA_PREVIEW_BRIDGE_SECRET:'test-only-secret-that-has-32-characters',
 NEXT_PUBLIC_SUPABASE_URL:'https://isolated.supabase.co',CS_ZARIA_PREVIEW_SUPABASE_URL:'https://isolated.supabase.co',
 CS_ZARIA_DENY_PRODUCTION_SUPABASE_URL:'https://separate.supabase.co',
 CS_ZARIA_PREVIEW_LIVEKIT_URL:'wss://dedicated-zaria.livekit.cloud',CS_ZARIA_PREVIEW_LIVEKIT_EXPECTED_HOST:'dedicated-zaria.livekit.cloud',
 CS_ZARIA_PREVIEW_LIVEKIT_API_KEY:'synthetic-qa-key',CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET:'synthetic-qa-secret',
 LIVEKIT_URL:'wss://shared-hosts.livekit.cloud',LIVEKIT_API_KEY:'synthetic-shared-key',LIVEKIT_API_SECRET:'synthetic-shared-secret',
 CS_ZARIA_PREVIEW_QA_USER_IDS:'20000000-0000-0000-0000-000000000000'}
const origin='https://'+cfg.VERCEL_URL
const grant={version:bridge.VERSION,audience:bridge.AUDIENCE,host:'zaria',scope:cfg.VERCEL_URL,room:'cs-10000000-0000-0000-0000-000000000000',
 participantIdentity:'10000000-0000-0000-0000-000000000001',userId:cfg.CS_ZARIA_PREVIEW_QA_USER_IDS,
 conversationId:'10000000-0000-0000-0000-000000000002',nonce:'10000000-0000-0000-0000-000000000003',galleryWork:'current',iat:500,exp:300500}
test('voice bridge gate rejects production, alternate host, shared secret and nonisolated database',()=>{
 assert.ok(bridge.privateZariaConfig(origin,cfg))
 assert.ok(bridge.privateZariaMember(origin,cfg.CS_ZARIA_PREVIEW_QA_USER_IDS,cfg))
 assert.equal(bridge.privateZariaMember(origin,'30000000-0000-0000-0000-000000000000',cfg),null)
 assert.equal(bridge.privateZariaMember(origin,null,cfg),null)
 assert.equal(bridge.privateZariaConfig('https://other.vercel.app',cfg),null)
 for(const broken of [{VERCEL_ENV:'production'},{CS_ZARIA_PREVIEW_BRIDGE:'false'},{CS_ZARIA_PREVIEW_QA_USER_IDS:''},
 {CS_ZARIA_LIVEKIT_VERIFIED_VOICE_MODEL:'wrong'},{CS_LIVEKIT_BRIDGE_SECRET:cfg.CS_ZARIA_PREVIEW_BRIDGE_SECRET},
 {NEXT_PUBLIC_SUPABASE_URL:'https://separate.supabase.co'}])assert.equal(bridge.privateZariaConfig(origin,{...cfg,...broken}),null)
})
test('stable preview branch alias survives redeploy only within the pinned project and Git ref',()=>{
 const expectedHost='isolated-zaria-git-private-qa.vercel.app'
 const stable={...cfg,CS_ZARIA_PREVIEW_EXPECTED_HOST:expectedHost,VERCEL_BRANCH_URL:expectedHost,
  CS_ZARIA_PREVIEW_EXPECTED_PROJECT_ID:'prj_zaria123',VERCEL_PROJECT_ID:'prj_zaria123',
  CS_ZARIA_PREVIEW_EXPECTED_GIT_REF:'feat/zaria-private-qa',VERCEL_GIT_COMMIT_REF:'feat/zaria-private-qa'}
 const request='https://'+expectedHost
 for(const VERCEL_URL of ['generated-old.vercel.app','generated-new.vercel.app',undefined])
  assert.equal(bridge.privateZariaConfig(request,{...stable,VERCEL_URL}).scope,expectedHost)
 for(const denied of [{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'prj_other'},{VERCEL_GIT_COMMIT_REF:'main'},
  {VERCEL_BRANCH_URL:undefined},{VERCEL_BRANCH_URL:'other.vercel.app'},{CS_ZARIA_PREVIEW_EXPECTED_GIT_REF:undefined},
  {CS_ZARIA_PREVIEW_EXPECTED_PROJECT_ID:undefined}])
  assert.equal(bridge.privateZariaConfig(request,{...stable,...denied}),null)
 assert.equal(bridge.privateZariaConfig(origin,stable),null)
})
test('voice grant rejects wrong audience, identity, room, deployment, duration, expiry or signature',()=>{
 const secret=cfg.CS_ZARIA_PREVIEW_BRIDGE_SECRET
 const token=bridge.signZariaGrant(grant,secret)
 assert.deepEqual(bridge.verifyZariaGrant(token,secret,cfg.VERCEL_URL,bridge.PREVIEW_AUDIENCE,600),grant)
 assert.equal(bridge.verifyZariaGrant(token,secret,'other.vercel.app',bridge.PREVIEW_AUDIENCE,600),null)
 assert.equal(bridge.verifyZariaGrant(token+'.extra',secret,cfg.VERCEL_URL,bridge.PREVIEW_AUDIENCE,600),null)
 assert.equal(bridge.verifyZariaGrant(token,secret,cfg.VERCEL_URL,bridge.PREVIEW_AUDIENCE,300500),null)
 for(const broken of [{audience:'public'},{host:'laviche'},{room:'another-room'},{participantIdentity:'not-signed-in'},
 {exp:300501},{galleryWork:'//private'}])assert.equal(bridge.verifyZariaGrant(bridge.signZariaGrant({...grant,...broken},secret),secret,cfg.VERCEL_URL,bridge.PREVIEW_AUDIENCE,600),null)
})
test('production voice opens only for the exact production host, database and approved user allowlist',()=>{
 const host='www.cafe-sativa.com'
 const production={...validVoice,VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'virtual-cafe-sativa-glyph-protocol.vercel.app',
  CS_ZARIA_PRODUCTION_EXPECTED_HOST:host,CS_ZARIA_PRODUCTION_BRIDGE:'true',CS_LIVEKIT_ENABLED:'true',
  CS_ZARIA_PRODUCTION_BRIDGE_SECRET:'production-fixture-secret-at-least-32-chars',
  CS_ZARIA_PRODUCTION_USER_IDS:'20000000-0000-0000-0000-000000000000',
  NEXT_PUBLIC_SUPABASE_URL:'https://production.supabase.co',CS_ZARIA_PRODUCTION_SUPABASE_URL:'https://production.supabase.co',
  CS_ZARIA_DENY_PREVIEW_SUPABASE_URL:'https://isolated.supabase.co',
  CS_ZARIA_PRODUCTION_LIVEKIT_URL:'wss://dedicated-zaria.livekit.cloud',CS_ZARIA_PRODUCTION_LIVEKIT_EXPECTED_HOST:'dedicated-zaria.livekit.cloud',
  CS_ZARIA_PRODUCTION_LIVEKIT_API_KEY:'synthetic-prod-key',CS_ZARIA_PRODUCTION_LIVEKIT_API_SECRET:'synthetic-prod-secret',
  LIVEKIT_URL:'wss://shared-hosts.livekit.cloud',LIVEKIT_API_KEY:'synthetic-shared-key',LIVEKIT_API_SECRET:'synthetic-shared-secret'}
 const url='https://'+host, selected=bridge.privateZariaConfig(url,production)
 assert.equal(selected?.environment,'production')
 assert.equal(selected?.audience,bridge.PRODUCTION_AUDIENCE)
 assert.ok(bridge.privateZariaMember(url,production.CS_ZARIA_PRODUCTION_USER_IDS,production))
 assert.equal(bridge.privateZariaMember(url,'30000000-0000-0000-0000-000000000000',production),null)
 for(const broken of [{VERCEL_ENV:'preview'},{CS_ZARIA_PRODUCTION_EXPECTED_HOST:'cafe-sativa.com'},
  {CS_ZARIA_PRODUCTION_USER_IDS:''},{NEXT_PUBLIC_SUPABASE_URL:'https://isolated.supabase.co'},
  {CS_ZARIA_PRODUCTION_LIVEKIT_URL:'wss://shared-hosts.livekit.cloud'}])
  assert.equal(bridge.privateZariaConfig(url,{...production,...broken}),null)
})
test('worker wire body has no override fields, v1 speech is plain and bounded',()=>{
 const req={version:bridge.VERSION,room:grant.room}
 assert.ok(bridge.parseZariaBridgeBody(req,'admit'))
 assert.equal(bridge.parseZariaBridgeBody({...req,user_id:grant.userId},'admit'),null)
 const turn={...req,utterance:'What is this piece? ',event_id:grant.nonce}
 assert.equal(bridge.parseZariaBridgeBody(turn,'turn').utterance,'What is this piece?')
 assert.equal(bridge.parseZariaBridgeBody({...turn,selection:'internal'},'turn'),null)
 assert.equal(bridge.parseZariaBridgeBody({...turn,utterance:'a'.repeat(1601)},'turn'),null)
 assert.equal(bridge.zariaSpeech('See [Artwork](/gallery/current) **now**.'),'See Artwork now.')
 assert.ok(bridge.zariaSpeech('word '.repeat(350)).length<=600)
})
test('admit HTTP checks ownership and room with no model or database turn mutation',async()=>{
 const now=Date.now(), mockCalls={reads:0,model:0,rpc:0}
 let owned=true, availability=true
 const ownedRow={user_id:grant.userId,session_id:null,host_agent:'zaria',ended_at:null}
 const handler=compile('lib/gallery/zaria-voice-v1-handler.ts',{
  '@anthropic-ai/sdk':{default:class{constructor(){mockCalls.model++;throw Error('No provider allowed')}}},
  '@/lib/supabase/admin':{createAdminClient(){return{from(){return{select(){return this},eq(){return this},async maybeSingle(){mockCalls.reads++;return{data:owned?ownedRow:null}}}},rpc(){mockCalls.rpc++;throw Error('Not allowed on admission')}}}},
  '@/lib/concierge/conversation-access':compile('lib/concierge/conversation-access.ts'),
  '@/lib/content/concierge-canon':{canonicalConciergeHost:async()=>({voiceId:policy.ZARIA_VOICE.id})},
  '@/lib/concierge/history':{},'@/lib/concierge/personas':{},'@/lib/concierge/response-engine':{},
  '@/lib/events/stage-host-availability':{stageHostIsPerforming:()=>false},
  './zaria-answer':{},'./zaria':policy,'./zaria-voice-v1':{...bridge,privateZariaConfig:url=>availability?bridge.privateZariaConfig(url,cfg):null},
 })
 const token=bridge.signZariaGrant({...grant,iat:now,exp:now+180000},cfg.CS_ZARIA_PREVIEW_BRIDGE_SECRET)
 const req=(body={},headers={})=>new Request(origin+'/api/concierge/zaria/voice-v1/admit',{method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},
  body:JSON.stringify({version:bridge.VERSION,room:grant.room,...body})})
 assert.equal((await handler.zariaBridge(req({},{origin}),'admit')).status,403)
 assert.equal((await handler.zariaBridge(req({room:'cs-10000000-0000-0000-0000-000000000009'}),'admit')).status,403)
 assert.equal(mockCalls.reads,0)
 assert.equal((await (await handler.zariaBridge(req(),'admit')).json()).participant_identity,grant.participantIdentity)
 owned=false
 assert.equal((await handler.zariaBridge(req(),'admit')).status,403)
 availability=false
 assert.equal((await handler.zariaBridge(req(),'admit')).status,404)
 assert.deepEqual(mockCalls,{reads:2,model:0,rpc:0})
})

test('requires dedicated scoped LiveKit config and blocks every shared-host fallback',()=>{
 assert.deepEqual(bridge.privateZariaConfig(origin,cfg).livekit,{
  url:cfg.CS_ZARIA_PREVIEW_LIVEKIT_URL,key:cfg.CS_ZARIA_PREVIEW_LIVEKIT_API_KEY,secret:cfg.CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET,
 })
 for(const broken of [
  {CS_ZARIA_PREVIEW_LIVEKIT_URL:undefined},{CS_ZARIA_PREVIEW_LIVEKIT_API_KEY:undefined},{CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET:undefined},
  {CS_ZARIA_PREVIEW_LIVEKIT_EXPECTED_HOST:undefined},{CS_ZARIA_PREVIEW_LIVEKIT_URL:'wss://wrong.livekit.cloud'},
  {CS_ZARIA_PREVIEW_LIVEKIT_API_KEY:cfg.LIVEKIT_API_KEY},{CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET:cfg.LIVEKIT_API_SECRET},
  {LIVEKIT_URL:cfg.CS_ZARIA_PREVIEW_LIVEKIT_URL},{CS_ZARIA_PREVIEW_LIVEKIT_URL:cfg.CS_ZARIA_PREVIEW_LIVEKIT_URL+'/other'},
  {CS_ZARIA_PREVIEW_LIVEKIT_URL:'https://dedicated-zaria.livekit.cloud'},
 ])assert.equal(bridge.privateZariaConfig(origin,{...cfg,...broken}),null)
})

test('session endpoint signs Zaria admission only with the isolated key and chooses the existing shared host independently',async()=>{
 const availableEnv={...cfg,CS_LIVEKIT_BRIDGE_SECRET:'synthetic unrelated voice bridge'}
 const saved=Object.fromEntries(Object.keys(availableEnv).map(key=>[key,process.env[key]]))
 for(const [key,value] of Object.entries(availableEnv))process.env[key]=value
 let user={id:grant.userId,is_anonymous:false}
 let selectedHost='zaria'
 const signatures=[]
 class Token{
  constructor(key,secret,opts){this.key=key;this.secret=secret;this.opts=opts}
  addGrant(value){this.grant=value}
  async toJwt(){signatures.push({key:this.key,secret:this.secret,room:this.grant.room,agent:this.roomConfig.agents[0].agentName});return 'synthetic-session-token'}
 }
 class Config{constructor(v){Object.assign(this,v)}}
 const session=compile('app/api/concierge/livekit/session/route.ts',{
  '@/lib/gallery/zaria':policy,'@/lib/gallery/zaria-voice-v1':bridge,'@/lib/gallery/zaria-answer':{zariaGrounding:async()=>({links:[]})},
  'livekit-server-sdk':{AccessToken:Token,RoomConfiguration:Config,RoomAgentDispatch:Config,TrackSource:{MICROPHONE:1}},
  '@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user}})}})},
  '@/lib/supabase/admin':{createAdminClient:()=>({from:()=>({select(){return this},eq(){return this},async maybeSingle(){return{data:{user_id:grant.userId,session_id:null,host_agent:selectedHost,ended_at:null}}}})})},
  '@/lib/content/concierge-canon':{canonicalConciergeHost:async()=>({voiceId:policy.ZARIA_VOICE.id})},
  '@/lib/concierge/conversation-access':compile('lib/concierge/conversation-access.ts'),
  '@/lib/concierge/livekit-session':grants,
  '@/lib/events/stage-host-availability':{stageHostIsPerforming:()=>false},
 })
 const makeRequest=()=>new Request(origin+'/api/concierge/livekit/session',{method:'POST',
  headers:{origin,'content-type':'application/json'},body:JSON.stringify({host:selectedHost,conversation_id:grant.conversationId})})
 try{
  assert.equal((await session.GET(new Request(origin+'/api/concierge/livekit/session?host=zaria'))).status,200)
  const allowed=await session.POST(makeRequest())
  assert.equal(allowed.status,201)
  assert.equal((await allowed.json()).server_url,cfg.CS_ZARIA_PREVIEW_LIVEKIT_URL)
  assert.deepEqual({...signatures[0],room:'ignored'},{key:cfg.CS_ZARIA_PREVIEW_LIVEKIT_API_KEY,secret:cfg.CS_ZARIA_PREVIEW_LIVEKIT_API_SECRET,room:'ignored',agent:'cafe-sativa-zaria'})
  user={...user,is_anonymous:true}
  assert.equal((await session.POST(makeRequest())).status,403)
  assert.equal((await (await session.GET(new Request(origin+'/api/concierge/livekit/session?host=zaria'))).json()).available,false)
  user={...user,is_anonymous:false}
  process.env.CS_ZARIA_PREVIEW_LIVEKIT_URL=cfg.LIVEKIT_URL
  assert.equal((await session.POST(makeRequest())).status,503)
  assert.equal(signatures.length,1)
  selectedHost='laviche'
  const shared=await session.POST(makeRequest())
  assert.equal(shared.status,201)
  assert.equal((await shared.json()).server_url,cfg.LIVEKIT_URL)
  assert.equal(signatures[1].key,cfg.LIVEKIT_API_KEY)
  assert.equal(signatures[1].agent,'cafe-sativa-hosts')
 }finally{
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
})


test('Zaria renders the public approved portrait derivative and keeps generated Markdown out of the chat bubble',()=>{
  assert.equal(policy.ZARIA_DISPLAY_PORTRAIT,'https://www.cafe-sativa.com/api/gallery/zaria-portrait')
  assert.equal(policy.zariaChatDisplay('*[Explore the Gallery](/gallery)** — first stop'), 'Explore the Gallery — first stop')
  assert.equal(policy.zariaChatDisplay('## Try this\n\n**An artwork** and _its artist_.'), 'Try this\n\nAn artwork and its artist.')
  assert.equal(policy.zariaChatDisplay('[Safe link label](https://untrusted.invalid)'), 'Safe link label')
  assert.match(fs.readFileSync('app/ask/page.tsx','utf8'),/avatar: ZARIA_DISPLAY_PORTRAIT/)
})
