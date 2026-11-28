const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync('app/api/gallery/financial-review/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000003',artist='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002'
function setup({mode='isolated-test',flag='true',user=a,ownerIds=owner,fail=false,foreignMode=false,liveFlag='false',liveOwnerIds=owner,foreignRefund=false}={}){
 const calls=[]
 const rows={
  artists:[{id:artist,user_id:a},{id:other,user_id:b}],
  gallery_order_accepted_financial_review:[
    {order_id:'one',artist_id:artist,sale_kind:'consigned',provider_livemode:false,evidence_state:'observed',financial_evidence:{processing_fees_cents:null}},
    {order_id:'two',artist_id:other,sale_kind:'consigned',provider_livemode:false,evidence_state:'unobserved'},
    {order_id:'house',artist_id:artist,sale_kind:'house',provider_livemode:false,evidence_state:'observed'},
    {order_id:'live',artist_id:artist,sale_kind:'consigned',provider_livemode:true,evidence_state:'observed'}],
  gallery_refund_mode_review_candidates:[{order_id:'two',review_reason:'digital_edition_manual_review',provider_livemode:false},{order_id:'live',review_reason:'digital_edition_manual_review',provider_livemode:true}]
 }
 const admin={from(table){calls.push(table);let r=rows[table].slice();return {
 select(fields){assert.ok(!fields.includes('*')&&!fields.includes('buyer')&&!fields.includes('snapshot,provider_snapshot'));return this},
 eq(k,v){if(k==='provider_livemode')assert.equal(v,mode==='production');if(k!=='provider_livemode'||!(table==='gallery_refund_mode_review_candidates'?foreignRefund:foreignMode))r=r.filter(x=>x[k]===v);return this},
 order(){return this},
 limit(n){assert.equal(n,101);return Promise.resolve(fail?{error:{message:'internal'}}:{data:r.slice(0,n)})},
 maybeSingle(){return Promise.resolve({data:r.length===1?r[0]:null})}
 }}}
 const ctx={exports:{},URL,Response,process:{env:{GALLERY_FINANCIAL_REVIEW_TEST:flag,GALLERY_TEST_FINANCIAL_OWNER_IDS:ownerIds,GALLERY_PRODUCTION_FINANCIAL_OWNER_IDS:liveOwnerIds}},require(n){
 if(n.endsWith('/environment'))return {galleryFinancialReviewMode:()=>mode==='production'?(liveFlag==='true'?'production':'blocked'):(mode==='isolated-test'&&flag==='true'?mode:'blocked')}
 if(n.endsWith('/server'))return {createClient:()=>({auth:{getUser:async()=>({data:{user:user?{id:user,user_metadata:{role:'owner'}}:null}})}})}
 if(n.endsWith('/admin'))return {createAdminClient:()=>admin}
 throw Error(n)}}
 vm.runInNewContext(source,ctx)
 return {calls,get:async(q='')=>{const r=await ctx.exports.GET({url:'http://127.0.0.1:3000/api/gallery/financial-review'+q});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}}
}
test('isolated report denies disabled, production, blocked and anonymous before financial reads',async()=>{
 for(const [o,s] of [[{flag:'false'},404],[{mode:'production'},404],[{mode:'blocked'},404],[{user:null},401]]){const x=setup(o);assert.equal((await x.get()).status,s);assert.deepEqual(x.calls,[])}
})
test('artist derives identity on server and cannot read other artists, house, owner queue or live evidence',async()=>{
 const x=setup(),r=await x.get();assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual(r.body.orders.map(o=>o.order_id),['one']);assert.equal(r.body.orders[0].financial_evidence.processing_fees_cents,null);assert.deepEqual(r.body.refund_review,[])
 assert.equal((await x.get('?scope=artist&artist_id='+other)).status,400)
 assert.equal((await x.get('?scope=owner')).status,403)
})
test('only explicitly configured authenticated isolated owner can read all test sales and refund-review queue',async()=>{
 const x=setup({user:owner}),r=await x.get('?scope=owner');assert.equal(r.status,200);assert.deepEqual(r.body.orders.map(o=>o.order_id),['one','two','house']);assert.equal(r.body.refund_review[0].review_reason,'digital_edition_manual_review')
 assert.equal((await setup({user:owner,ownerIds:owner+',invalid'}).get('?scope=owner')).status,403)
 assert.equal((await setup({user:owner}).get()).status,403)
})
test('missing view or unexpected live evidence fails closed without returning financial rows',async()=>{
 for(const o of [{fail:true},{foreignMode:true}]){const r=await setup(o).get();assert.equal(r.status,503);assert.equal(r.body.orders,undefined)}
})

test('production financial report requires separate flag and authenticated owner or artist, with live-only refund review',async()=>{
 const o={mode:'production',liveFlag:'true'}
 const artistResult=await setup(o).get()
 assert.equal(artistResult.status,200);assert.equal(artistResult.body.mode,'production')
 assert.deepEqual(artistResult.body.orders.map(x=>x.order_id),['live']);assert.deepEqual(artistResult.body.refund_review,[])
 const x=setup({...o,user:owner}),r=await x.get('?scope=owner')
 assert.equal(r.status,200);assert.deepEqual(r.body.orders.map(x=>x.order_id),['live'])
 assert.deepEqual(r.body.refund_review.map(x=>x.order_id),['live'])
 assert.equal((await setup({...o,user:owner,liveOwnerIds:a}).get('?scope=owner')).status,403)
 assert.equal((await setup({...o,user:owner,foreignRefund:true}).get('?scope=owner')).status,503)
 assert.equal((await setup({...o,foreignMode:true}).get()).status,503)
 assert.equal((await setup({...o,user:null}).get()).status,401)
 assert.equal((await x.get('?scope=owner&mode=isolated-test')).status,400)
})
const displaySource=ts.transpileModule(fs.readFileSync('lib/gallery/financial-review-display.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const displayCtx={exports:{},Intl};vm.runInNewContext(displaySource,displayCtx)
test('financial report display preserves unknown, actual zero, signed fees and non-USD minor units',()=>{
 const {reportAmount,reportEvidence,refundReviewReason}=displayCtx.exports
 for(const unknown of [null,undefined,'0',NaN,Infinity,1.5])assert.equal(reportAmount(unknown,'usd'),'Unknown')
 assert.equal(reportAmount(0,'usd'),'$0.00 USD')
 assert.equal(reportAmount(-35,'USD'),'-$0.35 USD')
 assert.equal(reportAmount(1200,'jpy'),'1,200 JPY minor units')
 assert.equal(reportAmount(100,'bad currency'),'Unknown')
 assert.equal(reportEvidence('attention'),'Review required')
 assert.equal(refundReviewReason('digital_edition_manual_review'),'Digital edition — manual review')
})
