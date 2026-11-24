const {strict:assert}=require('node:assert')
const {readFileSync,writeFileSync}=require('node:fs')
const {createServer}=require('node:http')
const {spawn,spawnSync}=require('node:child_process')
const {once}=require('node:events')
const {setTimeout:sleep}=require('node:timers/promises')
const app='http://localhost:4392'
const data='http://127.0.0.1:54321'
const upstream='http://127.0.0.1:4393'
const session='30000000-2000-4000-8000-000000000001'
const ownerRequest={host:'zaria',surface:'web-chat',session_id:session,room_id:'qa-art',message:'Tell me about the work I selected.'}
const canaryKey='qa-only-no-provider'
const modelCalls=[]
let glyphCalls=0
let failModel=false
let stage='parse runner-local status'
const glyphMeta={live:true,characters:[{id:'zaria-solenne',production_ready:true,rights_status:'approved',canonical_context:'QA canonical curator identity for a synthetic test.',voice_status:'canonical',voice_id:'5zneNR4v1Uw5AjIZ9Un4'}]}
const stub=createServer(async(req,res)=>{
 res.setHeader('content-type','application/json')
 if(req.method==='GET'&&req.url==='/api/studios/cafe-sativa-canon'&&req.headers.authorization===`Bearer ${canaryKey}`){
  glyphCalls++;return res.end(JSON.stringify(glyphMeta))
 }
 if(req.method==='POST'&&req.url==='/v1/messages'&&req.headers['x-api-key']===canaryKey){
  const chunks=[]; for await(const chunk of req)chunks.push(chunk)
  modelCalls.push(JSON.parse(Buffer.concat(chunks)))
  if(failModel){res.statusCode=503;return res.end(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'Synthetic fixture outage'}}))}
  return res.end(JSON.stringify({id:'msg_qa_offline',type:'message',role:'assistant',content:[{type:'text',text:'In this test, the selected work has a public Gallery page.'}],model:'claude-haiku-4-5-20251001',stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}))
 }
 res.statusCode=404;res.end('{}')
})
function patch(path,original,replacement){
 const initial=readFileSync(path,'utf8')
 assert.equal(initial.split(original).length,2,'one expected source insertion')
 writeFileSync(path,initial.replace(original,replacement))
 return ()=>writeFileSync(path,initial)
}
function parseLocalStatus(){
 const v=JSON.parse(readFileSync(process.argv[2],'utf8'))
 assert.equal(String(v.API_URL).replace(/^http:\/\/localhost:/,'http://127.0.0.1:'),data)
 const db=new URL(v.DB_URL)
 assert.equal(db.protocol,'postgresql:');assert.ok(['localhost','127.0.0.1'].includes(db.hostname))
 assert.equal(db.port,'54322');assert.equal(db.pathname,'/postgres');assert.ok(db.username&&db.password)
 assert.equal(db.search,'');assert.equal(db.hash,'')
 assert.match(v.ANON_KEY,/^[A-Za-z0-9._-]{1,4096}$/)
 assert.match(v.SERVICE_ROLE_KEY,/^[A-Za-z0-9._-]{1,4096}$/)
 assert.notEqual(v.ANON_KEY,v.SERVICE_ROLE_KEY)
 return {db,anon:v.ANON_KEY,role:v.SERVICE_ROLE_KEY}
}
async function main(){
 const c=parseLocalStatus()
 const psql=(args)=> {
  const r=spawnSync(process.env.ZARIA_LOCAL_PSQL,['-X','-qAt','-v','ON_ERROR_STOP=1',...args],{timeout:15000,
   env:{PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'54322',PGDATABASE:'postgres',
     PGUSER:decodeURIComponent(c.db.username),PGPASSWORD:decodeURIComponent(c.db.password),PGCONNECT_TIMEOUT:'5'}})
  assert.equal(r.status,0,'disposable QA psql')
  return r.stdout.toString().trim()
 }
 stage='seed and verify isolated PostgreSQL'
 psql(['-f','tests/zaria-local-backend.sql'])
 assert.equal(psql(['-c','select count(*) from public.qa_gallery_items']), '4')
 const restore=[]
 let next
 try{
  stage='pin upstream to one runner-local origin'
  restore.push(patch('lib/content/glyph-live.ts',"const SOURCE='https://studio.truskool.net/api/studios/cafe-sativa-canon'","const SOURCE='"+upstream+"/api/studios/cafe-sativa-canon'"))
  restore.push(patch('app/api/concierge/route.ts',"new Anthropic({ apiKey: anthropicKey,timeout:25000,maxRetries:0 })","new Anthropic({ apiKey: anthropicKey,baseURL:'"+upstream+"',timeout:25000,maxRetries:0 })"))
  await new Promise(r=>stub.listen(4393,'127.0.0.1',r))
  stage='start Next without inherited deployment environment'
  const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',
   NEXT_PUBLIC_SITE_URL:app,NEXT_PUBLIC_SUPABASE_URL:data,NEXT_PUBLIC_SUPABASE_ANON_KEY:c.anon,SUPABASE_SERVICE_ROLE_KEY:c.role,
   NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT:'true',CS_ZARIA_GALLERY_PORTRAIT:'false',CS_ZARIA_GALLERY_LIVE_VOICE:'false',
   GLYPH_CANON_READ_TOKEN:canaryKey,ANTHROPIC_API_KEY:canaryKey}
  next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','4392'],{env,stdio:'ignore'})
  let ready=false
  for(let i=0;i<35;i++){
   try{const r=await fetch(app+'/api/concierge',{signal:AbortSignal.timeout(20000)});if(r.status===405){ready=true;break}}catch{}
   if(next.exitCode!==null)break
   await sleep(500)
  }
  assert.ok(ready,'Next route readiness')
  const send=(body=ownerRequest,origin=app)=>fetch(app+'/api/concierge',{method:'POST',
   headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const count=()=>psql(['-c','select count(*) from public.host_messages'])
  stage='verify wrong origin, wrong surface and missing selected facts do not leak'
  assert.equal((await send(ownerRequest,'https://wrong-origin.invalid')).status,403)
  assert.equal((await send({...ownerRequest,surface:'email'})).status,404)
  assert.equal(glyphCalls,0)
  assert.equal(modelCalls.length,0)
  assert.equal(count(),'0')

  stage='verify actual Zaria response, selected facts and citations'
  const response=await send()
  if(response.status!==200){const body=await response.json().catch(()=>({}));throw Error('unexpected route status '+response.status+' / '+String(body.code??body.error??'unavailable'))}
  const body=await response.json()
  assert.equal(body.host,'zaria')
  assert.equal(body.memory_saved,true)
  assert.equal(body.remaining,9)
  assert.match(body.conversation_id,/^[a-f0-9-]{36}$/)
  assert.deepEqual(body.gallery_links.map(i=>i.path),['/gallery/qa-art','/gallery/qa-alternate','/gallery'])
  assert.equal(modelCalls.length,1)
  assert.equal(modelCalls[0].model,'claude-haiku-4-5-20251001')
  assert.ok(modelCalls[0].system.includes('QA canonical curator identity'))
  assert.match(modelCalls[0].system,/"current":\{"slug":"qa-art"/)
  assert.doesNotMatch(modelCalls[0].system,/QA NFT NOT ALLOWED|QA PRIVATE NOT ALLOWED/)
  assert.equal(count(),'2')

  stage='verify foreign requester cannot reuse the conversation'
  const other={...ownerRequest,session_id:'30000000-2000-4000-8000-000000000002',conversation_id:body.conversation_id}
  assert.equal((await send(other)).status,403)
  assert.equal(modelCalls.length,1)
  assert.equal(count(),'2')

  stage='verify private requested work is not loaded and safe turn memory persists'
  const follow=await send({...ownerRequest,room_id:'qa-hidden',conversation_id:body.conversation_id,message:'What do we know about this selection?'})
  assert.equal(follow.status,200)
  const second=await follow.json()
  assert.equal(second.conversation_id,body.conversation_id)
  assert.equal(second.remaining,8)
  assert.deepEqual(second.gallery_links.map(i=>i.path).sort(),['/gallery','/gallery/qa-alternate','/gallery/qa-art'])
  assert.match(modelCalls[1].system,/"current":null/)
  assert.doesNotMatch(modelCalls[1].system,/qa-hidden|QA NFT NOT ALLOWED|QA PRIVATE NOT ALLOWED/)
  assert.deepEqual(modelCalls[1].messages.map(m=>m.role),['user','assistant','user'])
  assert.equal(count(),'4')

  stage='verify simulated model outage writes no turn'
  failModel=true
  const fail=await send({...ownerRequest,conversation_id:body.conversation_id})
  assert.equal(fail.status,502)
  assert.equal(modelCalls.length,3)
  assert.equal(count(),'4')
  console.log('PASS: exact Next handler + real disposable Supabase/PostgREST: origin and surface rejection, catalog filters and safe citations, scoped context/model request, cross-session denial, turn persistence and rate count, no persistence on simulated provider failure.')
 }finally{
  if(next?.exitCode===null){const exited=once(next,'exit');next.kill('SIGTERM');await Promise.race([exited,sleep(3000)])}
  stub.close()
  for(const undo of restore.reverse())undo()
 }
}
main().catch(e=>{console.error('QA stage:',stage,';',e.message);process.exitCode=1})
