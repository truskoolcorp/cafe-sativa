const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto')
function load(file,modules={}){const c={exports:{},Buffer,Uint8Array,Intl,Date:class extends Date {static now(){return Date.parse('2026-11-20T00:00:00Z')}},URL,Object,AbortSignal,AbortController,Promise,Map,require:n=>{assert.ok(n in modules,`Unexpected import ${n}`);return modules[n]}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports}
const known=load('lib/content/character-promo-known-external.ts',{'./character-promo-external-receipts.ts':load('lib/content/character-promo-external-receipts.ts')})
const schedule=load('lib/content/character-promo-cafe-metricool.ts',{'./character-promo-known-external':known,'node:crypto':crypto,'./social-contract':load('lib/content/social-contract.ts',{'node:crypto':crypto}),'./character-promo-dispatch-time':load('lib/content/character-promo-dispatch-time.ts')})
const m=load('lib/content/character-promo-cafe-approval.ts',{'node:crypto':crypto,'./character-promo-cafe-metricool':schedule,'./character-promo-known-external':known,'./character-promo-time':load('lib/content/character-promo-time.ts')})
function fixture(){
 const now=Date.parse('2026-11-20T00:00:00Z'),at=new Date(now-1000).toISOString(),id='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',bytes=Buffer.from('0000ftyp0000000000000000'),sha=crypto.createHash('sha256').update(bytes).digest('hex'),path=`character-promos/zaria-solenne/${id}/${sha}.mp4`
 const d={id,character_id:'zaria-solenne',status:'script_approved',spoken_script:'Welcome',visual_brief:'Reviewed',duration_seconds:8,intended_channel:'cafe',actual_social_account:'metricool-brand:7605217',video_asset_path:path,audio_asset_path:'private.mp3',voice_approved_at:at,video_qa_approved_at:at,publication_approved_at:at,updated_at:at}
 const p={id:pid,promo_id:id,character_id:d.character_id,network:'facebook',account_id:'105363501666032',scheduled_at:new Date(now+3600000).toISOString(),status:'ready_for_delivery',caption:'Welcome to the Gallery'}
 const qa=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark'].map((name,i)=>({id:String(i),reviewer_id:actor,evidence:'Actual reviewed evidence',created_at:at,promo_id:id,video_sha256:sha,check_name:name,result:'pass'}))
 const sources={draft:d,plan:p,qa,canon:{revision_sha256:'a'.repeat(64),live:true,checked_at:at,character_id:d.character_id,primary_asset_id:'asset',portrait_sha256:'b'.repeat(64),voice_id:'voice',rights_status:'approved',voice_status:'canonical',production_ready:true},connection:{verified:true,checked_at:at,user_id:'4174093',brand_id:'7605217',timezone:'America/Chicago',accounts:[{network:p.network,account_id:p.account_id}]},videoBytes:bytes}
 const s={version:1,planId:pid,promoId:id,characterId:d.character_id,brandId:'7605217',userId:'4174093',network:p.network,accountId:p.account_id,timezone:'America/Chicago',scheduledAt:p.scheduled_at,videoSha256:sha,videoPath:path,contentApprovalDigest:m.cafeContentEvidenceDigest(sources),caption:p.caption,hashtags:['CafeSativa'],facebookTitle:'Welcome',collaborators:[]}
 const candidate={schedule:s,sources,sourceState:{draft:d,plan:p,qa},verifiedCollaborators:[]},input={planId:pid,expectedDigest:schedule.cafeScheduleDigest(s)};let writes=0
 const deps={now:()=>now,auth:async()=>({id:actor,isContentAdmin:true}),load:async()=>candidate,ownerAuthority:async(_s,digest)=>({reference:'owner-message:verified',scheduleDigest:digest,authorizedAt:at,expiresAt:new Date(now+7200000).toISOString(),revoked:false}),persist:async x=>{writes++;return {digest:x.digest,expiresAt:x.expiresAt}}}
 return {candidate,input,deps,stats:()=>writes,now}
}
const policyModule=load('lib/content/character-promo-cafe-owner-policy.ts',{'node:crypto':crypto,'./character-promo-cafe-metricool':schedule})
function policyFixture(f){const policy={version:1,reference:'verified-policy',ownerMessageIds:['Sentinel_'+'a'.repeat(32)],authorizedAt:new Date(f.now-1000).toISOString(),validUntil:new Date(f.now+7200000).toISOString(),revoked:false,brandId:'7605217',userId:'4174093',accounts:[{network:'facebook',accountId:'105363501666032'},{network:'instagram',accountId:'cafesativainc'}],characterIds:['zaria-solenne'],scope:'routine-cafe-persona-brand-promotions',paidPromotion:false};const assessment={scheduleDigest:f.input.expectedDigest,assessedAt:new Date(f.now).toISOString(),evidenceRef:'technical-scope-review',classification:'routine-cafe-persona-brand-promotion',highImpact:false,paidPromotion:false,containsSensitivePersonalData:false};return {policy,assessment,deps:{now:f.deps.now,readPolicy:async()=>policy,assessScope:async()=>assessment,retainEvidence:async(reference,record)=>({reference,sha256:crypto.createHash('sha256').update(record).digest('hex')}),verifiedCollaborators:[]}}}

function composition(f,change={}){
 const p=policyFixture(f),controller=new AbortController();let opens=0,drains=0,rpcs=0,sourceSignal,openedMetadata
 const server=load('lib/content/character-promo-cafe-authority-server.ts',{
  'server-only':{},'./character-promo-cafe-approval':m,'./character-promo-cafe-owner-policy':policyModule,
  './character-promo-cafe-sources-server':{createCafeSourceReader:cfg=>{opens++;sourceSignal=cfg.signal;openedMetadata=cfg.metadata;return {load:async()=>f.candidate,whenSettled:async()=>{drains++}}}}
 })
 const config={signal:controller.signal,metadata:new Map([[f.input.planId,{caption:'Pinned'}]]),verifiedCollaborators:[],
 auth:async()=>({id:'33333333-3333-4333-8333-333333333333',isContentAdmin:true}),
 readPolicy:async()=>p.policy,assessScope:async()=>p.assessment,
 authorityRpc:async(name,args,signal)=>{rpcs++;assert.equal(signal.aborted,false);assert.equal(name,'cs_record_cafe_metricool_authority');return {error:null,data:{digest:args.p_digest,expiresAt:args.p_expires_at}}},
 ...change}
 return {api:server.createCafeAuthorityServer(config),config,controller,p,stats:()=>({opens,drains,rpcs,sourceSignal,openedMetadata})}
}
test('disabled composition opens no dependencies or sources',async()=>{
 const f=fixture(),c=composition(f,{auth:async()=>assert.fail('auth')})
 assert.equal((await c.api.record(f.input)).status,'disabled')
 assert.equal(c.stats().opens,0);assert.equal(c.stats().rpcs,0)
})
test('existing real writer and policy compose one exact authority write, no provider publication',async()=>{
 const f=fixture(),c=composition(f),r=await c.api.record(f.input,{enabled:true})
 assert.equal(r.status,'recorded');assert.equal(r.scheduled,false);assert.equal(r.published,false);assert.equal(r.qaCreated,false)
 assert.equal(c.stats().rpcs,1);assert.equal(c.stats().opens,1);assert.equal(c.stats().drains,1);assert.equal(c.stats().sourceSignal.aborted,true)
})
test('missing or nonadmin session cannot open source or write',async()=>{
 for(const actor of [null,{id:'33333333-3333-4333-8333-333333333333',isContentAdmin:false}]){
 const f=fixture(),c=composition(f,{auth:async()=>actor});await assert.rejects(c.api.record(f.input,{enabled:true}));assert.equal(c.stats().opens,0);assert.equal(c.stats().rpcs,0)
 }
})
test('missing owner policy and revoked owner policy cannot persist',async()=>{
 for(const mode of ['missing','revoked']){
 const f=fixture(),c=composition(f);if(mode==='missing')c.config.readPolicy=async()=>null;else c.p.policy.revoked=true
 await assert.rejects(c.api.record(f.input,{enabled:true}));assert.equal(c.stats().rpcs,0);assert.equal(c.stats().sourceSignal.aborted,true)
 }
})
test('late authentication after cancellation cannot open sources or write',async()=>{
 let resolve;const f=fixture(),c=composition(f,{auth:()=>new Promise(r=>resolve=r)})
 const pending=c.api.record(f.input,{enabled:true});await new Promise(r=>setImmediate(r));c.controller.abort(Error('cancel'))
 await assert.rejects(pending,/cancel/);resolve({id:'33333333-3333-4333-8333-333333333333',isContentAdmin:true})
 await new Promise(r=>setImmediate(r));assert.equal(c.stats().opens,0);assert.equal(c.stats().rpcs,0)
})
test('metadata is copied before authentication awaits',async()=>{
 const f=fixture(),c=composition(f);c.config.auth=async()=>{c.config.metadata.get(f.input.planId).caption='changed';return {id:'33333333-3333-4333-8333-333333333333',isContentAdmin:true}}
 await c.api.record(f.input,{enabled:true});assert.equal(c.stats().openedMetadata.get(f.input.planId).caption,'Pinned')
})
test('RPC uncertainty is not retried and source is cancelled/drained',async()=>{
 let calls=0;const f=fixture(),c=composition(f,{authorityRpc:async()=>{calls++;throw Error('unknown')}})
 await assert.rejects(c.api.record(f.input,{enabled:true}),/unknown/);assert.equal(calls,1);assert.equal(c.stats().drains,1);assert.equal(c.stats().sourceSignal.aborted,true)
})
test('no default authority capability is fabricated',async()=>{
 const f=fixture(),c=composition(f,{authorityRpc:undefined});await assert.rejects(c.api.record(f.input,{enabled:true}),/dependencies missing/);assert.equal(c.stats().opens,0)
})
