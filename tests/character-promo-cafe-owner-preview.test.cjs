const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const PLAN='11111111-1111-4111-8111-111111111111',PROMO='22222222-2222-4222-8222-222222222222',OWNER='54b71f3f-19e1-46f0-99e2-28993463caf8',DIGEST='a'.repeat(64),ORIGIN='https://www.cafe-sativa.com'
function load(file,modules,replace=s=>s){const c={exports:{},Date,Request,Response,URL,TextDecoder,AbortSignal,AbortController,Promise,Object,Map,require:n=>{assert.ok(n in modules,n);return modules[n]}};vm.runInNewContext(ts.transpileModule(replace(fs.readFileSync(file,'utf8')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports}
function fixture({enabled=true,owner=true,ready=true,changed=false}={}){
 let writes=0,reads=0,loads=0,validations=0
 const plan={id:PLAN,promo_id:PROMO},draft={id:PROMO},candidate={schedule:{planId:PLAN,scheduledAt:new Date(Date.now()+3600000).toISOString(),marker:changed?'changed':'reviewed'},sourceState:{server:true}}
 const query=rows=>({select(){return this},eq(){return this},limit(){return this},abortSignal(){return this},retry(){reads++;return Promise.resolve({data:rows,error:null})}})
 const api=load('lib/content/character-promo-cafe-owner-preview-server.ts',{
 'server-only':{},'@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user:owner?{id:OWNER,app_metadata:{cafe_sativa_admin:true}}:null},error:null})}})},
 '@/lib/supabase/admin':{createAdminClient:()=>({from:table=>query(table==='cs_character_promo_delivery_plans'?[plan]:[draft])})},
 './character-production-bounded-fetch':{createProductionFetch:()=>({fetch:()=>assert.fail('network'),whenSettled:async()=>{}})},
 './character-promo-cafe-read-fetch':{cafeBoundedReadFetch:f=>f},
 './character-promo-cafe-sources-server':{createCafeSourceReader:()=>({load:async()=>{loads++;return candidate},whenSettled:async()=>{}})},
 './character-promo-cafe-editorial-from-plan':{cafeEditorialFromPlan:(p,d)=>{assert.equal(p.id,PLAN);assert.equal(d.id,PROMO);return {planId:PLAN}}},
 './character-promo-cafe-approval':{validateCafeApprovalCandidate:()=>{validations++;if(!ready)throw Error('QA missing')}},
 './character-promo-cafe-metricool':{cafeScheduleDigest:s=>s.marker==='changed'?'b'.repeat(64):DIGEST,cafeReservationKeys:()=>({destinationTimeKey:'dest',mediaDestinationKey:'media'})},
 './character-promo-cafe-authenticated-transport':{createCafeAuthenticatedOwnerTransport:()=>({recordConfirmedPreview:async(args,submission)=>{writes++;assert.equal(submission.confirmed,true);assert.equal(args.p_source.server,true);assert.equal(args.p_snapshot.marker,'reviewed');return {data:{digest:DIGEST,expiresAt:args.p_expires_at},error:null}}})}
 },source=>{if(!enabled)return source;const old='Object.freeze({enabled:false,planIds:Object.freeze([] as string[]),expiresAt:null})';assert.equal(source.split(old).length,2);return source.replace(old,`Object.freeze({enabled:true,planIds:Object.freeze(['${PLAN}']),expiresAt:Date.now()+3600000})`)})
 return {request:api.cafeOwnerPreviewRequest,stats:()=>({writes,reads,loads,validations})}
}
const post=(body={planId:PLAN,digest:DIGEST,confirm:true},headers={})=>new Request(ORIGIN+'/api/admin/character-promotions/cafe-owner-preview',{method:'POST',headers:{origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json',...headers},body:JSON.stringify(body)})
test('default disabled without any database or write',async()=>{const f=fixture({enabled:false}),r=await f.request(post());assert.equal(r.status,503);assert.deepEqual(f.stats(),{writes:0,reads:0,loads:0,validations:0})})
test('GET validates real candidate but never calls recording path',async()=>{const f=fixture(),r=await f.request(new Request(ORIGIN+'/api/admin/character-promotions/cafe-owner-preview?planId='+PLAN));assert.equal(r.status,200);assert.equal((await r.json()).status,'preview');assert.equal(f.stats().writes,0);assert.equal(f.stats().loads,1);assert.equal(f.stats().validations,1)})
test('POST reloads server-only source, validates and records exact confirmed digest',async()=>{const f=fixture(),r=await f.request(post());assert.equal(r.status,200);assert.equal((await r.json()).status,'recorded');assert.equal(f.stats().loads,1);assert.equal(f.stats().writes,1)})
test('cross-origin, missing CSRF site, unknown fields and foreign plans reject',async()=>{for(const req of [post(undefined,{origin:'https://evil.invalid'}),post(undefined,{'sec-fetch-site':'cross-site'}),post({planId:PLAN,digest:DIGEST,confirm:true,qa:['fake']}),post({planId:PROMO,digest:DIGEST,confirm:true}),post({planId:PLAN,digest:DIGEST,confirm:false})]){const f=fixture();assert.notEqual((await f.request(req)).status,200);assert.equal(f.stats().writes,0)}})
test('changed preview, missing real QA and wrong owner refuse recording',async()=>{for(const options of [{changed:true},{ready:false},{owner:false}]){const f=fixture(options);assert.notEqual((await f.request(post())).status,200);assert.equal(f.stats().writes,0)}})
test('oversized body and untrusted URL origin rejected',async()=>{const f=fixture();assert.notEqual((await f.request(post({padding:'x'.repeat(513)}))).status,200);assert.equal((await f.request(new Request('https://evil.invalid/?planId='+PLAN))).status,403);assert.equal(f.stats().writes,0)})
test('editorial derives exact existing records, never rewrites inline tags',()=>{
 const {cafeEditorialFromPlan:build}=load('lib/content/character-promo-cafe-editorial-from-plan.ts',{'./character-promo-time':{normalizePromoDatabaseTime:v=>new Date(v).toISOString()}})
 const draft={id:PROMO,character_id:'zaria-solenne',actual_social_account:'metricool-brand:7605217',title:'Look again',video_asset_path:`character-promos/zaria-solenne/${PROMO}/${DIGEST}.mp4`},plan={id:PLAN,promo_id:PROMO,character_id:'zaria-solenne',network:'facebook',account_id:'105363501666032',caption:'Look #Art',scheduled_at:'2026-12-01T18:00:00Z'}
 const m=build(plan,draft);assert.equal(m.caption,'Look #Art');assert.equal(m.facebookTitle,'Look again');assert.equal(m.hashtags.length,0);assert.equal(m.collaborators.length,0);assert.throws(()=>build({...plan,account_id:'other'},draft));assert.throws(()=>build(plan,{...draft,title:'x'.repeat(101)}))
})
test('submission window is distinct from recorded approval expiry',async()=>{
 const f=fixture(),get=await (await f.request(new Request(ORIGIN+'/api/admin/character-promotions/cafe-owner-preview?planId='+PLAN))).json()
 assert.ok(get.submissionWindowEnds);assert.equal(get.expiresAt,undefined);assert.equal(get.approvalExpiresAt,undefined)
 const start=Date.now(),body=await (await f.request(post())).json();assert.ok(Date.parse(body.approvalExpiresAt)<=Date.now()+15*60000);assert.ok(Date.parse(body.approvalExpiresAt)>=start);assert.ok(Date.parse(body.approvalExpiresAt)<Date.parse(get.submissionWindowEnds));assert.equal(body.expiresAt,undefined)
})
function clientFixture(storage=new Map(),storageFails=false){
 let states=[],refs=[],index=0,refIndex=0,posts=0
 const react={useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=v]},useRef:initial=>{const i=refIndex++;return refs[i]??=( {current:initial})}}
 const jsx=(type,props)=>({type,props}),c={exports:{},require:n=>n==='react'?react:{jsx,jsxs:jsx,Fragment:'fragment'},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(storageFails)throw Error('blocked');storage.set(k,v)}},fetch:async(url,options)=>{if(options?.method==='POST'){posts++;throw Error('ambiguous network')}return {ok:true,json:async()=>({status:'preview',planId:PLAN,digest:DIGEST,schedule:{},submissionWindowEnds:'2026-12-01'})}}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/admin/character-promotions/cafe-owner-preview/preview-client.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,c)
 const render=()=>{index=0;refIndex=0;return c.exports.default({planIds:[PLAN]})},buttons=tree=>{if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(buttons);return [...(tree.type==='button'?[tree]:[]),...buttons(tree.props?.children)]}
 return {buttons:()=>buttons(render()),posts:()=>posts,storage}
}
test('client synchronous latch prevents double POST and persistent marker prevents refresh retry',async()=>{
 const f=clientFixture();await f.buttons()[0].props.onClick();const confirm=f.buttons()[1].props.onClick;await Promise.all([confirm(),confirm()]);assert.equal(f.posts(),1)
 const refreshed=clientFixture(f.storage);await refreshed.buttons()[0].props.onClick();assert.equal(refreshed.buttons()[1].props.disabled,true);await refreshed.buttons()[1].props.onClick();assert.equal(refreshed.posts(),0)
})
test('client storage failure prevents POST',async()=>{
 const f=clientFixture(new Map(),true);await f.buttons()[0].props.onClick();await f.buttons()[1].props.onClick();assert.equal(f.posts(),0)
})
