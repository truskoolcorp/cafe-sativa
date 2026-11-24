const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync('app/api/gallery/financial-review/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000003',artist='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002'
function setup({mode='isolated-test',flag='true',user=a,ownerIds=owner,fail=false,foreignMode=false}={}){
 const calls=[]
 const rows={
  artists:[{id:artist,user_id:a},{id:other,user_id:b}],
  gallery_order_financial_review:[
    {order_id:'one',artist_id:artist,sale_kind:'consigned',provider_livemode:false,evidence_state:'observed',financial_evidence:{processing_fees_cents:null}},
    {order_id:'two',artist_id:other,sale_kind:'consigned',provider_livemode:null,evidence_state:'unobserved'},
    {order_id:'house',artist_id:artist,sale_kind:'house',provider_livemode:false,evidence_state:'observed'},
    {order_id:'live',artist_id:artist,sale_kind:'consigned',provider_livemode:true,evidence_state:'observed'}],
  gallery_refund_review_candidates:[{order_id:'two',review_reason:'digital_edition_manual_review'}]
 }
 const admin={from(table){calls.push(table);let r=rows[table].slice();return {
 select(fields){assert.ok(!fields.includes('*')&&!fields.includes('buyer')&&!fields.includes('snapshot,provider_snapshot'));return this},
 eq(k,v){r=r.filter(x=>x[k]===v);return this},
 or(f){assert.equal(f,'provider_livemode.is.null,provider_livemode.eq.false');if(!foreignMode)r=r.filter(x=>x.provider_livemode!==true);return this},
 order(){return this},
 limit(n){assert.equal(n,101);return Promise.resolve(fail?{error:{message:'internal'}}:{data:r.slice(0,n)})},
 maybeSingle(){return Promise.resolve({data:r.length===1?r[0]:null})}
 }}}
 const ctx={exports:{},URL,Response,process:{env:{GALLERY_FINANCIAL_REVIEW_TEST:flag,GALLERY_TEST_FINANCIAL_OWNER_IDS:ownerIds}},require(n){
 if(n.endsWith('/environment'))return {galleryEnvironment:()=>mode}
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
