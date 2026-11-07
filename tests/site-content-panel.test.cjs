const {test}=require('node:test')
const assert=require('node:assert/strict')
const load=require('./helpers/load-ts.cjs')
const destination=load('lib/content/social-destination.ts')
const baseItem={id:'00000000-0000-4000-8000-000000000001',title:'Venue preview',site_category:'venue',status:'pending_approval',copy_draft:'Reviewed caption',copy_final:null,updated_at:'2026-11-07T00:00:00Z',scheduled_at:'2030-10-13T00:00:00Z',published_at:null,approval_notes:null,media_url:'/api/content/media/approved-job.mp4'}
const response=(body,ok=true)=>({ok,json:async()=>body})
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function harness() {
 let cursor=0,tree,siteFailure=false,siteDeferred=null,postHandler=null,proof=destination.SOCIAL_DESTINATION
 const hooks=[],posts=[],reads=[]
 let rows=[{...baseItem}]
 const react={
   useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value}]},
   useRef(initial){const i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i]},
   useCallback:fn=>fn,useEffect(){},
 }
 const jsx=(type,props,key)=>({type,props:props||{},key})
 const {default:Panel}=load('app/admin/SiteContentPanel.tsx',{
   react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
   './dashboard.module.css':{default:{}},'./SocialConnectionPanel':{default:()=>null},
   '@/lib/content/social-destination':destination,
 },{fetch:async(url,options={})=>{
   if(options.method==='POST'){
     const body=JSON.parse(options.body);posts.push(body)
     if(postHandler)return postHandler(body)
     rows=rows.map(row=>row.id===body.id?{...row,copy_draft:body.copy,copy_final:body.copy,scheduled_at:body.scheduledAt,updated_at:'new-version',status:body.action==='approve'?'approved':'pending_approval'}:row)
     return response({saved:true,published:0,socialQueued:body.publishSocial,socialWorkerStatus:'idle'})
   }
   reads.push(url)
   if(url==='/api/content/references')return response({candidates:[],programmingReadiness:[]})
   assert.equal(url,'/api/content/site')
   if(siteFailure)throw Error('Status unavailable')
   if(siteDeferred)return siteDeferred.promise
   return response({items:rows.map(r=>({...r})),socialDestination:proof})
 }})
 function render(){cursor=0;tree=Panel({onReviewReferences(){}});return tree}
 function nodes(value){if(arguments.length===0)value=tree;if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.props?.children)]}
 function text(value){if(arguments.length===0)value=tree;if(Array.isArray(value))return value.map(text).join(' ');if(value===null||value===undefined||typeof value==='boolean')return '';return typeof value==='object'?text(value.props?.children):String(value)}
 function button(label){const found=nodes().find(n=>n.type==='button'&&text(n).includes(label));assert.ok(found,'Button: '+label);return found}
 function checkboxes(){return nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')}
 async function settle(){await tick();render()}
 async function click(label){const node=button(label);assert.equal(Boolean(node.props.disabled),false,label+' enabled');await node.props.onClick();await settle()}
 async function open(){await click('Refresh status');await click('Open draft and review')}
 function approveChecks(){checkboxes().forEach(n=>n.props.onChange({target:{checked:true}}));render()}
 render()
 return {render,nodes,text,button,checkboxes,settle,click,open,approveChecks,posts,reads,
   setSiteFailure:value=>{siteFailure=value},setSiteDeferred:value=>{siteDeferred=value},
   setPostHandler:value=>{postHandler=value},setProof:value=>{proof=value},setRows:value=>{rows=value},
 }
}
test('shows exact destination and transmits it only for explicit per-item social approval',async()=>{
 const h=harness();await h.open()
 assert.match(h.text(),/Facebook page 146219355471397/);assert.match(h.text(),/Threads @truskoolcorp/)
 assert.match(h.text(),/Metricool brand 5373515, account 4174093/);assert.match(h.text(),/this item only, not future posts/)
 h.approveChecks();await h.click('Approve website publication')
 assert.equal(h.posts.length,1);assert.equal(h.posts[0].publishSocial,true)
 assert.equal(destination.isSocialDestination(h.posts[0].socialDestination),true)
 assert.equal(h.posts[0].copy,baseItem.copy_draft)
 assert.equal(h.posts[0].scheduledAt,baseItem.scheduled_at)
})
test('website-only approval does not attach social proof',async()=>{
 const h=harness();await h.open();h.checkboxes()[0].props.onChange({target:{checked:true}});h.render()
 await h.click('Approve website publication')
 assert.equal(h.posts[0].publishSocial,false);assert.equal(h.posts[0].socialDestination,undefined)
})
for(const field of ['site-copy','site-schedule'])test('changing '+field+' clears both confirmations',async()=>{
 const h=harness();await h.open();h.approveChecks()
 const input=h.nodes().find(n=>n.props.id===field)
 input.props.onChange({target:{value:field==='site-copy'?'Changed exact caption':'2030-11-12T12:00'}});h.render()
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false])
 assert.equal(h.button('Approve website publication').props.disabled,true)
})
test('reopening a card clears social and accuracy approvals',async()=>{
 const h=harness();await h.open();h.approveChecks();await h.click('Back to website overview');await h.click('Open draft and review')
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false])
})
for(const proof of [null,{...destination.SOCIAL_DESTINATION,version:'different'}])test('unavailable or changed destination disables social checkbox: '+JSON.stringify(proof),async()=>{
 const h=harness();h.setProof(proof);await h.open()
 assert.equal(h.checkboxes()[1].props.disabled,true);assert.match(h.text(),/destination details unavailable or changed/)
})
test('same-tick repeated click sends only one POST and prevents dismissal during mutation',async()=>{
 const h=harness();await h.open();h.approveChecks();const pending=deferred()
 h.setPostHandler(()=>pending.promise)
 const submit=h.button('Approve website publication').props.onClick
 const first=submit(),second=submit();h.render()
 assert.equal(h.posts.length,1);assert.equal(h.button('Back to website overview').props.disabled,true)
 assert.equal(h.button('Approve website publication').props.disabled,true)
 pending.resolve(response({saved:true,published:0,socialQueued:true,socialWorkerStatus:'scheduled'}))
 await Promise.all([first,second]);await h.settle();assert.equal(h.posts.length,1)
})
test('lost POST response closes stale form, refreshes and requires new confirmation',async()=>{
 const h=harness();await h.open();h.approveChecks()
 h.setPostHandler(()=>{h.setRows([{...baseItem,status:'approved',updated_at:'after-save'}]);throw Error('Network interrupted')})
 await h.click('Approve website publication')
 assert.equal(h.checkboxes().length,0);assert.equal(h.posts.length,1);assert.match(h.text(),/Do not resubmit blindly/)
 assert.match(h.text(),/Status refreshed/)
 await h.click('All content');await h.click('Open draft and review')
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false])
 assert.equal(h.button('Approve website publication').props.disabled,true)
})
test('503 after approval/publication preserves known saved result and does not auto-submit',async()=>{
 const h=harness();await h.open();h.approveChecks()
 h.setPostHandler(()=>response({saved:true,refreshRequired:true,error:'Publication interrupted; some due items may already be published.'},false))
 await h.click('Approve website publication')
 assert.match(h.text(),/changes were saved/);assert.match(h.text(),/some due items may already be published/)
 assert.equal(h.checkboxes().length,0);assert.equal(h.posts.length,1)
})
test('success followed by failed reads blocks all mutations until a successful explicit refresh',async()=>{
 const h=harness();await h.open();h.approveChecks()
 h.setPostHandler(()=>{h.setSiteFailure(true);return response({saved:true,published:0})})
 await h.click('Approve website publication')
 assert.match(h.text(),/changes were saved/);assert.match(h.text(),/Status could not be refreshed/)
 for(const label of ['Prepare program drafts','Prepare approved clip drafts','Publish approved due items','Open draft and review'])assert.equal(h.button(label).props.disabled,true,label)
 assert.equal(h.checkboxes().length,0);assert.equal(h.posts.length,1)
 h.setSiteFailure(false);await h.click('Refresh status');await h.click('Open draft and review')
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false]);assert.equal(h.posts.length,1)
})
test('queue uncertainty warning exits the editor without advancing or retrying',async()=>{
 const h=harness();await h.open();h.approveChecks()
 h.setPostHandler(()=>response({saved:true,published:0,socialQueued:false,socialQueue:'unknown',refreshRequired:true,socialWarning:'A delivery may already exist. Inspect receipts; do not resubmit.'}))
 await h.click('Approve website publication')
 assert.equal(h.checkboxes().length,0);assert.match(h.text(),/may already exist/);assert.equal(h.posts.length,1)
})
test('global publication and worker results are not attributed to the selected item',async()=>{
 const h=harness();await h.open();h.checkboxes()[0].props.onChange({target:{checked:true}});h.render()
 h.setPostHandler(()=>response({saved:true,published:3}))
 await h.click('Approve website publication')
 assert.match(h.text(),/3 due website items published/);assert.doesNotMatch(h.text(),/Approval saved and published/)
 h.approveChecks();h.setPostHandler(()=>response({saved:true,published:0,socialQueued:true,socialWorkerStatus:'scheduled'}))
 await h.click('Approve website publication')
 assert.match(h.text(),/may refer to another queued item/);assert.match(h.text(),/publication is not confirmed/)
})
test('refreshes are coalesced and a pre-existing read cannot be overtaken by a mutation',async()=>{
 const h=harness();await h.open();h.approveChecks()
 const submit=h.button('Approve website publication').props.onClick
 const refresh=h.button('Refresh status').props.onClick
 const pending=deferred();h.setSiteDeferred(pending)
 const before=h.reads.filter(r=>r==='/api/content/site').length
 refresh();refresh();h.render();await submit()
 assert.equal(h.posts.length,0)
 assert.equal(h.reads.filter(r=>r==='/api/content/site').length,before+1)
 assert.equal(h.button('Approve website publication').props.disabled,true)
 pending.resolve(response({items:[baseItem],socialDestination:destination.SOCIAL_DESTINATION}));await h.settle()
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false])
})
test('manual refresh cannot overlap an active mutation, including stale event callbacks',async()=>{
 const h=harness();await h.open();h.approveChecks()
 const refresh=h.button('Refresh status').props.onClick,pending=deferred()
 h.setPostHandler(()=>pending.promise)
 const action=h.button('Approve website publication').props.onClick()
 const before=h.reads.length;refresh();assert.equal(h.reads.length,before)
 pending.resolve(response({saved:true,published:0}));await action;await h.settle()
 assert.equal(h.posts.length,1)
})

test('stale Back and Open callbacks cannot navigate while a save or refresh is in flight',async()=>{
 const h=harness();await h.click('Refresh status')
 const open=h.button('Open draft and review').props.onClick
 await h.click('Open draft and review');h.approveChecks()
 const back=h.button('Back to website overview').props.onClick,pending=deferred()
 h.setPostHandler(()=>pending.promise)
 const action=h.button('Approve website publication').props.onClick()
 back();open();h.render()
 assert.equal(h.checkboxes().length,2)
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[true,true])
 pending.resolve(response({saved:true,published:0}));await action;await h.settle()
 const read=deferred();h.setSiteDeferred(read)
 h.button('Refresh status').props.onClick();back();open();h.render()
 assert.equal(h.checkboxes().length,2)
 read.resolve(response({items:[baseItem],socialDestination:destination.SOCIAL_DESTINATION}));await h.settle()
 assert.equal(h.posts.length,1)
})

test('stale submit callback stays blocked after failed mutation recovery until a fresh read succeeds',async()=>{
 const h=harness();await h.open();h.approveChecks()
 const submit=h.button('Approve website publication').props.onClick
 h.setPostHandler(()=>{h.setSiteFailure(true);throw Error('Lost response')})
 await submit();await submit();h.render()
 assert.equal(h.posts.length,1)
 assert.equal(h.button('Prepare program drafts').props.disabled,true)
 h.setSiteFailure(false);await h.click('Refresh status');await h.click('Open draft and review')
 assert.deepEqual(h.checkboxes().map(n=>n.props.checked),[false,false])
})
