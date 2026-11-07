const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./helpers/load-ts.cjs')
const destination=load('lib/content/social-destination.ts')
const contract=load('lib/content/social-contract.ts',{'@/lib/content/social-destination':destination})
const {SOCIAL_DESTINATION,isSocialDestination}=destination
const caption='Approved virtual venue preview.'
const item={id:'feature',source_job_id:'job',media_url:'/api/content/media/approved-job.mp4',approved_by:'owner',approved_at:'2026-11-07T00:00:00Z',status:'approved',copy_final:caption,scheduled_at:'2030-10-13T00:00:00Z'}
const approvedRow=()=>({id:'delivery',content_item_id:item.id,source_job_id:'job',state:'queued',caption,caption_hash:contract.captionHash(caption),scheduled_at:item.scheduled_at,approved_by:'owner',approved_at:item.approved_at,receipt:{approvedDestination:{...SOCIAL_DESTINATION}}})
function harness({row=null,qa=true,enabled=true,ambiguous=false}={}) {
 const rows=row?[structuredClone(row)]:[],providerCalls=[],exports=[],inserts=[]
 let posts=[]
 const db={from(table){
   let filters=[],patch=null,insert=null
   const q={select(){return q},order(){return q},limit(){return q},
     eq(k,v){filters.push(r=>r[k]===v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},
     update(value){patch=value;return q},insert(value){insert=value;return q},
     maybeSingle:async()=>run(true),then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject)}
   }
   function run(single){
     if(insert){inserts.push(insert);rows.push({id:'new',...insert});return {error:null}}
     const found=(table==='content_items'?[item]:rows).filter(r=>filters.every(f=>f(r)))
     if(patch)found.forEach(r=>Object.assign(r,patch))
     return {data:single?found[0]||null:found,error:null}
   }
   return q
 }}
 const session={call:async(name,args)=>{
   providerCalls.push({name,args})
   if(name==='getScheduledPosts')return posts
   assert.equal(name,'createScheduledPost')
   const info=JSON.parse(args.info)
   posts=[{...info,id:123,uuid:'post',media:['https://static.metricool.com/test.mp4']}]
   if(ambiguous)throw Error('Response lost after creation')
   return {id:123}
 }}
 const delivery=load('lib/content/social-delivery.ts',{
   '@/lib/content/social-destination':destination,'@/lib/content/social-contract':contract,
   '@/lib/content/metricool-mcp':{MetricoolHttpError:class extends Error{}},
   '@/lib/content/social-receipts':{dueSocialReceipts:async()=>({data:rows.filter(r=>r.state==='scheduled'),error:null})},
   '@/lib/supabase/admin':{createAdminClient:()=>db},
   '@/lib/content/site':{siteMediaApproved:async()=>qa},
   '@/lib/content/approved-media':{approvedMediaJob:async()=>qa?{id:'job'}:null},
   '@/lib/content/social-connection':{withSocialConnection:fn=>fn({db,session,brand:{timezone:'America/Los_Angeles'},enabled})},
   '@/lib/content/video-formats':{videoFormatFor:()=> 'feed'},
   '@/lib/content/video-variants':{prepareVideoVariant:async()=>{exports.push('export');return {url:'https://example.invalid/clip.mp4',format:'feed',sourceSha256:'hash',version:'v1'}}},
 })
 return {delivery,rows,providerCalls,exports,inserts,setPosts:value=>{posts=value}}
}
test('fixed destination contains only existing exact identities and is immutable',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(SOCIAL_DESTINATION)),{version:'truskool-facebook-threads-v1',provider:'metricool',brandId:5373515,userId:4174093,facebookPageId:'146219355471397',threadsHandle:'truskoolcorp'})
 assert.equal(Object.isFrozen(SOCIAL_DESTINATION),true)
 assert.equal(isSocialDestination({...SOCIAL_DESTINATION}),true)
 for(const field of Object.keys(SOCIAL_DESTINATION)){
   assert.equal(isSocialDestination({...SOCIAL_DESTINATION,[field]:'different'}),false,field)
   const missing={...SOCIAL_DESTINATION};delete missing[field]
   assert.equal(isSocialDestination(missing),false,field)
 }
 for(const value of [null,true,'Tru Skool',[],{}, {...SOCIAL_DESTINATION,networks:['facebook','threads','tiktok']}])assert.equal(isSocialDestination(value),false)
})
test('queue requires exact destination proof and persists a separate snapshot in JSON receipt',async()=>{
 const h=harness(),proof={...SOCIAL_DESTINATION}
 await h.delivery.queueSocialFeature(item,'owner',proof)
 assert.equal(h.rows.length,1)
 assert.equal(h.rows[0].content_item_id,item.id)
 assert.equal(h.rows[0].caption_hash,contract.captionHash(caption))
 assert.equal(h.rows[0].scheduled_at,item.scheduled_at)
 assert.equal(h.rows[0].approved_by,'owner')
 assert.equal(isSocialDestination(h.rows[0].receipt.approvedDestination),true)
 proof.brandId=1
 assert.equal(h.rows[0].receipt.approvedDestination.brandId,5373515)
 assert.equal(h.providerCalls.length,0)
})
for(const proof of [undefined,null,{...SOCIAL_DESTINATION,version:'old'},{...SOCIAL_DESTINATION,threadsHandle:'other'},{...SOCIAL_DESTINATION,tiktok:'added'}])test('queue rejects absent, obsolete or changed destination: '+JSON.stringify(proof),async()=>{
 const h=harness()
 await assert.rejects(h.delivery.queueSocialFeature(item,'owner',proof),/destination approval/)
 assert.equal(h.inserts.length,0);assert.equal(h.providerCalls.length,0)
})
for(const patch of [{status:'pending_approval'},{approved_at:null},{approved_by:'other'},{copy_final:''},{copy_final:'x'.repeat(501)},{scheduled_at:'invalid'},{scheduled_at:new Date().toISOString()},{source_job_id:null},{media_url:null}])test('queue preserves item approval, caption, time and clip gates: '+JSON.stringify(patch),async()=>{
 const h=harness()
 await assert.rejects(h.delivery.queueSocialFeature({...item,...patch},'owner',SOCIAL_DESTINATION))
 assert.equal(h.inserts.length,0)
})
test('revoked QA cannot queue',async()=>{
 const h=harness({qa:false});await assert.rejects(h.delivery.queueSocialFeature(item,'owner',SOCIAL_DESTINATION));assert.equal(h.inserts.length,0)
})
for(const receipt of [{},{approvedDestination:{...SOCIAL_DESTINATION,version:'old'}},{approvedDestination:{...SOCIAL_DESTINATION,facebookPageId:'other'}}])test('worker blocks new dispatch with missing or mismatched snapshot: '+JSON.stringify(receipt),async()=>{
 const row={...approvedRow(),receipt},h=harness({row})
 const result=await h.delivery.processSocialDelivery()
 assert.equal(result.status,'blocked');assert.match(result.error,/destination approval/)
 assert.equal(h.providerCalls.length,0);assert.equal(h.exports.length,0)
 assert.throws(()=>contract.socialCreateArguments(row,'UTC','https://example.invalid/test.mp4'),/destination approval/)
})
test('approved snapshot survives scheduling and subsequent receipt reconciliation',async()=>{
 const h=harness({row:approvedRow()})
 assert.equal((await h.delivery.processSocialDelivery()).status,'scheduled')
 assert.equal(h.providerCalls.filter(c=>c.name==='createScheduledPost').length,1)
 assert.equal(isSocialDestination(h.rows[0].receipt.approvedDestination),true)
 assert.equal(h.rows[0].receipt.observation,'Scheduling confirmed, not publication')
 h.setPosts([])
 await h.delivery.processSocialDelivery()
 assert.equal(isSocialDestination(h.rows[0].receipt.approvedDestination),true)
 assert.match(h.rows[0].receipt.observation,/unconfirmed/)
 assert.equal(h.providerCalls.filter(c=>c.name==='createScheduledPost').length,1)
})
test('uncertain provider submission keeps approval snapshot and is never retried',async()=>{
 const h=harness({row:approvedRow(),ambiguous:true})
 assert.equal((await h.delivery.processSocialDelivery()).status,'submission_unknown')
 assert.equal(isSocialDestination(h.rows[0].receipt.approvedDestination),true)
 await h.delivery.processSocialDelivery()
 assert.equal(h.providerCalls.filter(c=>c.name==='createScheduledPost').length,1)
})
test('legacy scheduled receipt remains reconcilable without inventing fresh consent',async()=>{
 const row={...approvedRow(),state:'scheduled',scheduled_at:'2024-01-01T00:00:00Z',provider_uuid:'post',provider_post_id:123,receipt:{publicationConfirmed:true,publicUrls:{facebook:'https://www.facebook.com/posts/123',threads:'https://www.threads.com/post/123'}}}
 const h=harness({row})
 const result=await h.delivery.processSocialDelivery()
 assert.equal(result.reconciled,1)
 assert.equal(h.rows[0].state,'scheduled');assert.equal(h.rows[0].receipt.publicationConfirmed,true)
 assert.equal(h.rows[0].receipt.approvedDestination,undefined)
 assert.equal(h.providerCalls.filter(c=>c.name==='createScheduledPost').length,0)
 assert.equal(h.exports.length,0)
})
