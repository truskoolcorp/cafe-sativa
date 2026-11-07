const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./helpers/load-ts.cjs')
const destination=load('lib/content/social-destination.ts')
const {SOCIAL_DESTINATION}=destination
const id='00000000-0000-4000-8000-000000000001'
const original={id,title:'Venue',site_category:'venue',status:'pending_approval',copy_draft:'Old draft',copy_final:null,source_job_id:'job',media_url:'/api/content/media/approved-job.mp4',scheduled_at:'2030-10-13T00:00:00Z',updated_at:'2026-11-07T00:00:00Z'}
const requestBody={action:'approve',id,copy:'Reviewed caption',expectedUpdatedAt:original.updated_at,scheduledAt:original.scheduled_at,confirmAccuracy:true,publishSocial:true,socialDestination:SOCIAL_DESTINATION}
function harness(options={}) {
 const item={...original},calls={updates:0,queues:[],dispatches:0,publishes:0,reads:0,planned:0},receipts=[]
 const db={from(table){
   let patch=null
   const q={select(){return q},eq(){return q},not(){return q},in(){return q},order(){return q},limit(){return q},
     update(value){patch=value;return q},single:async()=>{calls.reads++;if(options.readError)throw Error('Read failed');return {data:{...item},error:null}},
     maybeSingle:async()=>{
       if(table==='cs_social_deliveries')return {data:options.active?{state:'queued'}:null,error:null}
       if(patch){calls.updates++;Object.assign(item,patch);if(options.updateError)throw Error('Response lost after save');return {data:{...item},error:null}}
       return {data:{...item},error:null}
     },
     then(resolve){return Promise.resolve({data:[item],error:null}).then(resolve)}
   };return q
 }}
 const route=load('app/api/content/site/route.ts',{
   'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status||200,headers:init?.headers})}},
   '@/lib/content/auth':{isContentAdmin:async()=>options.admin!==false},
   '@/lib/supabase/admin':{createAdminClient:()=>db},
   '@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'owner'}}})}})},
   '@/lib/content/site':{
     siteMediaApproved:async()=>options.qa!==false,siteCover:async()=>null,
     planSiteContent:async()=>{calls.planned++;if(options.planError)throw Error('Stopped after creating first draft');return 1},
     publishDueSiteContent:async()=>{calls.publishes++;if(options.publishError){item.status='published';throw Error('Interrupted after publication')}return 0},
   },
   '@/lib/content/clip-features':{planApprovedClipFeatures:async()=>{calls.planned++;if(options.planError)throw Error('Stopped after creating first draft');return 1}},
   '@/lib/content/social-destination':destination,
   '@/lib/content/social-delivery':{
     queueSocialFeature:async(row,owner,proof)=>{calls.queues.push({row,owner,proof});receipts.push({state:'queued'});if(options.queueError)throw Error('Queue committed but response lost')},
     processSocialDelivery:async()=>{calls.dispatches++;if(options.dispatchError){receipts[0].state='submission_unknown';throw Error('Provider response lost')}return {status:'scheduled'}},
   },
 },{console:{error(){}}})
 return {route,item,calls,receipts,post:(patch={},origin='https://www.cafe-sativa.com')=>route.POST({headers:{get:()=>origin},nextUrl:{origin:'https://www.cafe-sativa.com'},json:async()=>({...requestBody,...patch})})}
}
test('read endpoint exposes a fixed non-secret per-item destination contract',async()=>{
 const h=harness(),response=await h.route.GET()
 assert.equal(response.status,200);assert.equal(destination.isSocialDestination(response.body.socialDestination),true)
 assert.equal(response.headers['Cache-Control'],'private, no-store')
 assert.doesNotMatch(JSON.stringify(response.body.socialDestination),/credential|token|secret/)
})
test('admin and same-origin requirements still reject before writes',async()=>{
 const h=harness({admin:false});assert.equal((await h.post()).status,401);assert.equal(h.calls.updates,0)
 const other=harness();assert.equal((await other.post({},'https://other.invalid')).status,403);assert.equal(other.calls.updates,0)
})
for(const proof of [undefined,null,{...SOCIAL_DESTINATION,version:'old'},{...SOCIAL_DESTINATION,brandId:1},{...SOCIAL_DESTINATION,userId:1},{...SOCIAL_DESTINATION,facebookPageId:'other'},{...SOCIAL_DESTINATION,threadsHandle:'other'},{...SOCIAL_DESTINATION,tiktok:'new'}])test('API rejects social approval without exact destination before saving: '+JSON.stringify(proof),async()=>{
 const h=harness(),result=await h.post({socialDestination:proof})
 assert.equal(result.status,400);assert.match(result.body.error,/exact Tru Skool/)
 assert.equal(h.calls.updates,0);assert.equal(h.calls.queues.length,0);assert.equal(h.calls.publishes,0)
})
for(const patch of [{confirmAccuracy:false},{action:'save'},{copy:'x'.repeat(501)},{scheduledAt:'invalid'},{scheduledAt:new Date().toISOString()}])test('explicit accuracy, approve action, caption length and future schedule remain required: '+JSON.stringify(patch),async()=>{
 const h=harness(),result=await h.post(patch)
 assert.equal(result.status,400);assert.equal(h.calls.updates,0);assert.equal(h.calls.queues.length,0)
})
for(const options of [{qa:false},{active:true}])test('QA and existing social deliveries stay guarded: '+JSON.stringify(options),async()=>{
 const h=harness(options),result=await h.post();assert.equal(result.status,409);assert.equal(h.calls.updates,0)
})
test('successful exact request passes its saved row and destination to queue once',async()=>{
 const h=harness(),result=await h.post()
 assert.equal(result.status,200);assert.equal(result.body.saved,true);assert.equal(result.body.socialQueue,'queued')
 assert.equal(h.calls.updates,1);assert.equal(h.calls.reads,1);assert.equal(h.calls.queues.length,1)
 const {row,owner,proof}=h.calls.queues[0]
 assert.equal(row.copy_final,requestBody.copy);assert.equal(Date.parse(row.scheduled_at),Date.parse(requestBody.scheduledAt))
 assert.equal(row.status,'approved');assert.equal(row.approved_by,owner)
 assert.equal(destination.isSocialDestination(proof),true)
})
test('website-only approval remains available without social destination proof',async()=>{
 const h=harness(),result=await h.post({publishSocial:false,socialDestination:undefined})
 assert.equal(result.status,200);assert.equal(result.body.saved,true);assert.equal(h.calls.queues.length,0)
})
for(const action of ['save','approve','return'])test('lost save response is uncertain, never claimed unsaved or unpublished: '+action,async()=>{
 const h=harness({updateError:true}),result=await h.post({action,publishSocial:false})
 assert.equal(result.status,503);assert.equal(result.body.saved,null);assert.equal(result.body.refreshRequired,true)
 assert.match(result.body.error,/may have saved changes/);assert.match(result.body.error,/Do not resubmit blindly/)
 assert.doesNotMatch(result.body.error,/no publication|server rejected|could not be saved/)
 assert.equal(h.calls.updates,1);assert.equal(h.calls.queues.length,0);assert.equal(h.calls.publishes,0)
})
test('queue error after insertion does not claim no delivery exists or dispatch again',async()=>{
 const h=harness({queueError:true}),result=await h.post()
 assert.equal(result.status,200);assert.equal(result.body.saved,true);assert.equal(result.body.socialQueue,'unknown')
 assert.equal(result.body.refreshRequired,true);assert.match(result.body.socialWarning,/may already exist/)
 assert.doesNotMatch(result.body.socialWarning,/was not queued/)
 assert.equal(h.receipts.length,1);assert.equal(h.calls.dispatches,0)
})
test('dispatch error preserves known queue success and warns of possible submission',async()=>{
 const h=harness({dispatchError:true}),result=await h.post()
 assert.equal(result.status,200);assert.equal(result.body.socialQueue,'queued');assert.equal(result.body.socialQueued,true)
 assert.equal(result.body.refreshRequired,true);assert.match(result.body.socialWarning,/submission may have occurred/)
 assert.equal(h.calls.queues.length,1);assert.equal(h.calls.dispatches,1)
})
for(const publishSocial of [false,true])test('publication error after approval/save reports known save and uncertain publication: social='+publishSocial,async()=>{
 const h=harness({publishError:true}),result=await h.post({publishSocial})
 assert.equal(result.status,503);assert.equal(result.body.saved,true);assert.equal(h.item.status,'published')
 assert.equal(result.body.socialQueue,publishSocial?'queued':'not_requested')
 assert.equal(result.body.publicationStatus,'unknown');assert.equal(result.body.refreshRequired,true)
 assert.match(result.body.error,/changes were saved/);assert.match(result.body.error,/some due items may already be published/)
 assert.doesNotMatch(result.body.error,/no publication|could not be saved/)
})
test('publish-due partial batch failure does not promise that no publication occurred',async()=>{
 const h=harness({publishError:true}),result=await h.post({action:'publish_due'})
 assert.equal(result.status,503);assert.equal(result.body.publicationStatus,'unknown')
 assert.match(result.body.error,/some due items may already be published/);assert.equal(h.calls.publishes,1)
})
for(const action of ['plan','prepare_clips'])test('partial planning failure reports possible saved changes: '+action,async()=>{
 const h=harness({planError:true}),result=await h.post({action})
 assert.equal(result.status,503);assert.match(result.body.error,/may have saved changes/)
 assert.equal(result.body.refreshRequired,true);assert.equal(h.calls.publishes,0)
})
test('pre-write read failure does not claim this request saved or published anything',async()=>{
 const h=harness({readError:true}),result=await h.post()
 assert.equal(result.status,503);assert.equal(result.body.saved,false);assert.equal(result.body.publicationStatus,'not_attempted')
 assert.equal(h.calls.updates,0);assert.equal(result.body.socialQueue,'not_attempted')
})
