const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const React=require('react')
const {renderToStaticMarkup}=require('react-dom/server')

function load(file,mocks={},globals={}) {
  const exports={}
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
  vm.runInNewContext(code,{exports,URL,Date,Object,Response,...globals,require(name){if(name in mocks)return mocks[name];return require(name)}} ,{filename:file})
  return exports
}
const policy=load('lib/events/hit-em-premiere.ts')
const config=policy.HIT_EM_PREMIERE
const valid=()=>({id:config.eventId,slug:config.slug,title:config.title,description:'Approved public event description.',status:'scheduled',starts_at:config.startsAt,ticket_price_cents:0})
const policyMock={'@/lib/events/hit-em-premiere':policy}
const component=load('components/events/HitEmPremiere.tsx',{
  ...policyMock,'next/link':({children,...props})=>React.createElement('a',props,children),
}).default
const html=event=>renderToStaticMarkup(React.createElement(component,{event}))

test('approved exact free event is accepted regardless of viewer identity',()=>{
  const event=policy.publicHitEmPremiere(valid())
  assert.equal(event.state,'ready');assert.equal(event.startsAt,'2026-11-11T06:00:00.000Z')
  assert.equal(new Date('2026-11-11T00:00:00-06:00').toISOString(),event.startsAt)
})
test('draft, missing, malformed and unknown statuses fail closed',()=>{
  for(const row of [null,undefined,[],{},true,{...valid(),status:'draft'},{...valid(),status:'unrecognized'}])assert.equal(policy.publicHitEmPremiere(row),null)
})
for(const [name,patch] of Object.entries({
  'different event identity':{id:'another-event'},'different slug':{slug:'another-party'},
  'paid event':{ticket_price_cents:1},'string price':{ticket_price_cents:'0'},
  'negative price':{ticket_price_cents:-1},'missing price':{ticket_price_cents:undefined},
  'rescheduled event':{starts_at:'2026-11-11T18:00:00Z'},'invalid start':{starts_at:'not-a-date'},
  'different title':{title:'Another party'},'unexpected description':{description:{html:'x'}},
  'oversized description':{description:'x'.repeat(10001)},
}))test(`${name} cannot expose the public premiere page`,()=>assert.equal(policy.publicHitEmPremiere({...valid(),...patch}),null))

test('cancellation removes the player, chat link, and calendar',()=>{
  const event=policy.publicHitEmPremiere({...valid(),status:'canceled'})
  assert.equal(event.state,'canceled')
  const output=html(event)
  assert.match(output,/canceled/);assert.doesNotMatch(output,/<iframe|youtube|calendar|Zoom/)
})
test('public page has verified player and fallback, with no account or ticket gate',()=>{
  const output=html(policy.publicHitEmPremiere(valid()))
  assert.match(output,/youtube-nocookie\.com\/embed\/ZYA0r9JM6eA/)
  assert.match(output,/youtube\.com\/watch\?v=ZYA0r9JM6eA/)
  assert.match(output,/No Café Sativa account, membership, ticket, or payment is required/)
  assert.match(output,/Posting in chat requires a YouTube sign-in/)
  assert.match(output,/YouTube controls when playback begins/)
  assert.doesNotMatch(output,/href="\/auth|create-ticket-checkout|zoom\.us|camera;|microphone|autoplay=1/)
  assert.doesNotMatch(output,/We are live|Ticket confirmed|Keith will let you in|recording will be available/)
})
test('ended gathering is labeled ended without promising live chat or a recording',()=>{
  const output=html(policy.publicHitEmPremiere({...valid(),status:'ended'}))
  assert.match(output,/This gathering has ended/);assert.match(output,/Open the video on YouTube/)
  assert.doesNotMatch(output,/join live chat|Add to my calendar|recording will/)
})
test('event text is escaped and cannot add script or redirect the player',()=>{
  const output=html(policy.publicHitEmPremiere({...valid(),description:'<script>bad()</script><a href="https://bad.test">x</a>'}))
  assert.doesNotMatch(output,/<script>|href="https:\/\/bad/)
  assert.match(output,/&lt;script&gt;/)
  assert.match(output,/youtube-nocookie\.com\/embed\/ZYA0r9JM6eA/)
})
test('mobile and failed-embed fallback opens the exact premiere with safe target attributes',()=>{
  const output=html(policy.publicHitEmPremiere(valid()))
  assert.match(output,/href="https:\/\/www\.youtube\.com\/watch\?v=ZYA0r9JM6eA" target="_blank" rel="noopener noreferrer"/)
  assert.match(output,/on mobile or if the embedded player does not load/)
})

function loaderFixture(data,error=null) {
  const calls=[]
  const query={select(fields){calls.push(['select',fields]);return query},eq(k,v){calls.push(['eq',k,v]);return query},in(k,v){calls.push(['in',k,[...v]]);return query},maybeSingle(){return Promise.resolve({data,error})}}
  const loader=load('lib/events/load-hit-em-premiere.ts',{
    ...policyMock,'server-only':{},'@/lib/supabase/server':{createClient:()=>({from(table){calls.push(['from',table]);return query}})},
  })
  return {calls,run:loader.loadHitEmPremiere}
}
test('loader only reads exact public event fields and published statuses',async()=>{
  const f=loaderFixture(valid());assert.equal((await f.run()).state,'ready')
  assert.deepEqual(f.calls,[['from','my_events_v'],['select','id,slug,title,description,status,starts_at,ticket_price_cents'],['eq','id',config.eventId],['eq','slug',config.slug],['in','status',['scheduled','live']]])
  assert.doesNotMatch(JSON.stringify(f.calls),/zoom|recording|tickets|memberships|user_id|storage|insert|update/)
})
test('loader independently rejects a draft even if an incorrect mock/query returns one',async()=>assert.equal(await loaderFixture({...valid(),status:'draft'}).run(),null))
test('public loader rejects ended/canceled rows even if the public view unexpectedly returns them',async()=>{
  for(const status of ['ended','canceled'])assert.equal(await loaderFixture({...valid(),status}).run(),null)
})
test('public loader uses the existing visitor client, not admin credentials or an auth gate',()=>{
  const source=fs.readFileSync('lib/events/load-hit-em-premiere.ts','utf8')
  assert.match(source,/from '@\/lib\/supabase\/server'/)
  assert.doesNotMatch(source,/createAdminClient|SUPABASE_SERVICE_ROLE_KEY|\.auth\.|getUser\(|getSession\(/)
})
test('database error is sanitized and is not mistaken for event publication',async()=>{
  await assert.rejects(loaderFixture(null,{message:'private-database-detail'}).run(),e=>e.message==='The event listing is temporarily unavailable.')
})

function pageFixture(event) {
  const notFound=()=>{throw Error('NOT_FOUND')}
  return load('app/events/hit-em-release-party/page.tsx',{'next/navigation':{notFound},'@/components/events/HitEmPremiere':component,'@/lib/events/load-hit-em-premiere':{loadHitEmPremiere:async()=>event}})
}
test('draft/unavailable record returns not found and no announcement metadata',async()=>{
  const page=pageFixture(null)
  await assert.rejects(page.default(),/NOT_FOUND/)
  const metadata=await page.generateMetadata()
  assert.equal(metadata.robots.index,false);assert.doesNotMatch(JSON.stringify(metadata),/Hit Em|youtube|November/)
})
test('ready page renders exact event without authentication or ticket checkout',async()=>{
  const event=policy.publicHitEmPremiere(valid()),page=pageFixture(event)
  const element=await page.default();assert.equal(element.type,component);assert.equal(element.props.event,event)
  assert.equal((await page.generateMetadata()).alternates.canonical,'https://www.cafe-sativa.com/events/hit-em-release-party')
  assert.equal((await page.generateMetadata()).title,'Hit Em Release Party')
  assert.equal((await page.generateMetadata()).openGraph.url,'https://www.cafe-sativa.com/events/hit-em-release-party')
  assert.equal(page.dynamic,'force-dynamic');assert.equal(page.revalidate,0)
})
test('legacy watch route redirects to the same public gathering without a session',()=>{
  const paths=[]
  const page=load('app/events/hit-em-release-party/watch/page.tsx',{...policyMock,'next/navigation':{redirect:path=>paths.push(path)}})
  page.default();assert.deepEqual(paths,['/events/hit-em-release-party'])
})

function calendarFixture(event,error=false) {
  return load('app/events/hit-em-release-party/calendar/route.ts',{...policyMock,'next/server':{NextResponse:Response},'@/lib/events/load-hit-em-premiere':{loadHitEmPremiere:async()=>{if(error)throw Error('private-error');return event}}})
}
test('calendar is stable, correctly zoned and has no invented duration, attendee or automatic reminder',async()=>{
  const body=policy.hitEmCalendarEvent()
  assert.equal(body,policy.hitEmCalendarEvent())
  assert.match(body,/DTSTART:20261111T060000Z\r\n/)
  assert.match(body,new RegExp(`UID:${config.eventId}@cafe-sativa.com`))
  assert.doesNotMatch(body,/DTEND|DURATION|VALARM|ATTENDEE|ORGANIZER|METHOD:REQUEST/)
  assert.match(body.replace(/\r\n[ \t]/g,''),/YouTube sign-in is required to post in live chat\./)
  for(const line of body.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,`RFC5545 line too long: ${line}`)
  const response=await calendarFixture(policy.publicHitEmPremiere(valid())).GET()
  assert.equal(response.status,200);assert.equal(await response.text(),body)
  assert.equal(response.headers.get('cache-control'),'no-store')
  assert.match(response.headers.get('content-disposition'),/attachment;/)
  assert.equal(response.headers.get('content-type'),'text/calendar; charset=utf-8')
})
test('private, canceled and ended events do not offer new calendar invitations',async()=>{
  for(const event of [null,{state:'canceled'},policy.publicHitEmPremiere({...valid(),status:'ended'})])assert.equal((await calendarFixture(event).GET()).status,404)
})
test('calendar failure is uncached 503 without leaking diagnostics',async()=>{
  const response=await calendarFixture(null,true).GET()
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.doesNotMatch(await response.text(),/private-error/)
})
test('temporary page error offers retry without triggering checkout',()=>{
  const ErrorPage=load('app/events/hit-em-release-party/error.tsx').default
  let resets=0;const tree=ErrorPage({reset:()=>resets++})
  const walk=node=>{if(!node||typeof node!=='object')return; if(node.type==='button')node.props.onClick();React.Children.forEach(node.props?.children,walk)}
  walk(tree);assert.equal(resets,1)
  const output=renderToStaticMarkup(tree);assert.match(output,/Try again/);assert.doesNotMatch(output,/form|checkout|password/)
})

function listingFixture(rows,{upcomingError=false,premiereError=false,now='2026-11-11T06:01:00Z'}={}) {
  const calls=[]
  const fixedNow=new Date(now).getTime()
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[fixedNow]))} static now(){return fixedNow} }
  const source=fs.readFileSync('lib/events.ts','utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const exports={},supabase={from(table){assert.equal(table,'my_events_v');let filters=[],maximum=1000,premiere=false;const q={select(){return q},gte(k,v){filters.push(r=>r[k]>=v);return q},order(){return q},eq(k,v){if(k==='id')premiere=true;filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},limit(n){maximum=n;return q},then(resolve,reject){calls.push(premiere?'premiere':'upcoming');const error=premiere?premiereError:upcomingError;return Promise.resolve({data:error?null:rows.filter(r=>filters.every(f=>f(r))).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)).slice(0,maximum),error:error?{}:null}).then(resolve,reject)}};return q}}
  vm.runInNewContext(code,{exports,Date:FixedDate,Map,console:{error(){}},require(name){if(name==='@/lib/supabase/server')return{createClient:()=>supabase};if(name==='@/lib/events/hit-em-premiere')return policy;throw Error(name)}})
  return {...exports,calls}
}
const listedPremiere=()=>({...valid(),category:'stage',is_featured:false})
const laterEvent=()=>({...valid(),id:'another-event',slug:'another-event',title:'Another confirmed event',starts_at:'2026-11-12T06:00:00Z',category:'stage',is_featured:false})
test('published premiere stays discoverable after midnight without changing status or inventing an end',async()=>{
  const f=listingFixture([listedPremiere(),laterEvent()]),events=await f.getUpcomingEvents()
  assert.equal(events.length,2);assert.equal(events[0].slug,config.slug);assert.equal(events[0].status,'scheduled')
  assert.equal((await f.getFeaturedEvent()).slug,config.slug)
})
test('future and dedicated queries do not duplicate the premiere',async()=>{
  const f=listingFixture([listedPremiere(),laterEvent()],{now:'2026-11-11T05:59:00Z'})
  assert.equal((await f.getUpcomingEvents()).filter(e=>e.slug===config.slug).length,1)
})
test('ordinary past events are not revived and explicit featured choice is preserved',async()=>{
  const f=listingFixture([listedPremiere(),{...laterEvent(),is_featured:true},{...laterEvent(),id:'old',slug:'old',starts_at:'2026-01-01T00:00:00Z'}])
  assert.equal((await f.getUpcomingEvents()).length,2);assert.equal((await f.getFeaturedEvent()).slug,'another-event')
})
test('category and result limit still apply to public premiere discovery',async()=>{
  const f=listingFixture([listedPremiere(),laterEvent(),{...laterEvent(),id:'kitchen',slug:'kitchen',category:'kitchen'}])
  assert.equal((await f.getUpcomingEvents({category:'stage',limit:1})).length,1)
  const kitchen=await f.getUpcomingEvents({category:'kitchen'});assert.equal(kitchen.length,1);assert.equal(kitchen[0].slug,'kitchen')
})
test('draft, canceled, ended, paid, or replaced premiere is not rediscovered',async()=>{
  for(const patch of [{status:'draft'},{status:'canceled'},{status:'ended'},{ticket_price_cents:1},{id:'replacement'}]) {
    const f=listingFixture([{...listedPremiere(),...patch},laterEvent()]);const events=await f.getUpcomingEvents()
    assert.equal(events.length,1);assert.equal(events[0].slug,'another-event')
  }
})
test('one failed discovery query does not hide independently verified events',async()=>{
  let f=listingFixture([listedPremiere(),laterEvent()],{premiereError:true});assert.equal((await f.getUpcomingEvents())[0].slug,'another-event')
  f=listingFixture([listedPremiere(),laterEvent()],{upcomingError:true});assert.equal((await f.getUpcomingEvents())[0].slug,config.slug)
  f=listingFixture([listedPremiere(),laterEvent()],{upcomingError:true,premiereError:true});assert.equal((await f.getUpcomingEvents()).length,0)
})
test('invalid future premiere does not starve a limited normal event result',async()=>{
  const f=listingFixture([{...listedPremiere(),ticket_price_cents:10},laterEvent()],{now:'2026-11-11T05:59:00Z'})
  const rows=await f.getUpcomingEvents({limit:1});assert.equal(rows.length,1);assert.equal(rows[0].slug,'another-event')
})
test('ordinary per-viewer access and price are preserved from the safe view',async()=>{
  const f=listingFixture([{...laterEvent(),access:'purchase_required',ticket_price_cents:1500}])
  const row=(await f.getUpcomingEvents())[0];assert.equal(row.access,'purchase_required');assert.equal(row.ticket_price_cents,1500)
})

// A later featured item must be found without loading unbounded inventory.
test('featured selection remains database-filtered beyond a 1000-row inventory cap',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({...laterEvent(),id:`event-${i}`,slug:`event-${i}`,starts_at:new Date(Date.UTC(2026,10,12,0,i)).toISOString(),is_featured:i===1000}))
  const f=listingFixture(rows);assert.equal((await f.getFeaturedEvent()).id,'event-1000')
})
test('invalid featured premiere does not hide a later valid featured event',async()=>{
  const f=listingFixture([{...listedPremiere(),is_featured:true,ticket_price_cents:5},{...laterEvent(),is_featured:true}],{now:'2026-11-11T05:59:00Z'})
  assert.equal((await f.getFeaturedEvent()).slug,'another-event')
})

const previewPolicy=load('lib/events/hit-em-preview.ts',policyMock)
const previewEnv={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/hit-em-public-premiere-20261108'}
const previewMocks={'@/lib/events/hit-em-preview':previewPolicy,'@/components/events/HitEmPremiere':component,'next/navigation':{notFound(){throw Error('NOT_FOUND')}},...policyMock}
function previewPage(env){return load('app/preview/hit-em-release-party/page.tsx',previewMocks,{process:{env}})}
function previewCalendar(env){return load('app/preview/hit-em-release-party/calendar/route.ts',previewMocks,{process:{env}})}
test('private visual fixture is restricted to exact PR preview environment',()=>{
  assert.equal(previewPolicy.canPreviewHitEm(previewEnv),true)
  for(const env of [{},{VERCEL_ENV:'preview'},{...previewEnv,VERCEL_ENV:'production'},{...previewEnv,VERCEL_ENV:'development'},{...previewEnv,VERCEL_GIT_COMMIT_REF:'main'},{...previewEnv,VERCEL_GIT_COMMIT_REF:'other-branch'}])assert.equal(previewPolicy.canPreviewHitEm(env),false)
})
test('production and unrelated previews cannot render fixture or download its calendar',async()=>{
  for(const env of [{},{...previewEnv,VERCEL_ENV:'production'},{...previewEnv,VERCEL_GIT_COMMIT_REF:'other-branch'}]){
    assert.throws(()=>previewPage(env).default(),/NOT_FOUND/)
    assert.doesNotMatch(JSON.stringify(previewPage(env).generateMetadata()),/Hit Em|youtube|November/)
    const response=previewCalendar(env).GET();assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/Hit Em|VCALENDAR|ZYA0r9JM6eA/)
  }
})
test('authorized private fixture renders same component with explicit nonpublication notice',()=>{
  const page=previewPage(previewEnv),output=renderToStaticMarkup(page.default())
  assert.match(output,/Private preview. This page does not publish the event/)
  assert.match(output,/not the live listing/)
  assert.match(output,/youtube-nocookie\.com\/embed\/ZYA0r9JM6eA/)
  assert.match(output,/href="\/preview\/hit-em-release-party\/calendar"/)
  assert.equal(page.generateMetadata().robots.index,false);assert.equal(page.generateMetadata().robots.follow,false)
  assert.equal(page.dynamic,'force-dynamic');assert.equal(page.revalidate,0)
})
test('preview calendar matches real calendar exactly and is private and uncached',async()=>{
  const response=previewCalendar(previewEnv).GET()
  assert.equal(response.status,200);assert.equal(await response.text(),policy.hitEmCalendarEvent())
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow')
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
})
test('private fixture reads no database or identity and does not weaken public loader',async()=>{
  for(const file of ['lib/events/hit-em-preview.ts','app/preview/hit-em-release-party/page.tsx','app/preview/hit-em-release-party/calendar/route.ts'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/createAdminClient|supabase|\.from\(|\.update\(|\.insert\(|cookies\(|headers\(/)
  assert.equal(await loaderFixture({...valid(),status:'draft'}).run(),null)
  assert.equal(previewPolicy.hitEmPreviewFixture().startsAt,config.startsAt)
})

function eventIndexFixture(events){
  const calls=[]
  const page=load('app/events/page.tsx',{
    'next/link':({children,...props})=>React.createElement('a',props,children),
    'lucide-react':{Calendar:()=>React.createElement('span',null,'Calendar')},
    '@/components/events/EventCard':{EventCard:({event})=>React.createElement('a',{href:'/events/'+event.slug},event.title)},
    '@/components/events/SiteFeatures':{SiteFeatures:({category})=>React.createElement('div',{'data-category':category},'CONCEPT_PREVIEWS')},
    '@/components/ui/button':{Button:({children})=>React.createElement('span',null,children)},
    '@/lib/events':{getUpcomingEvents:async options=>{calls.push(options);return events}},
    '@/lib/utils':{cn:(...classes)=>classes.filter(Boolean).join(' ')},
  })
  return {calls,render:async category=>renderToStaticMarkup(await page.default({searchParams:{category}}))}
}
test('confirmed event results are discoverable before concept previews',async()=>{
  const f=eventIndexFixture([{id:config.eventId,slug:config.slug,title:config.title}]),output=await f.render()
  assert.ok(output.indexOf('href="/events/hit-em-release-party"')<output.indexOf('CONCEPT_PREVIEWS'))
  assert.match(output,/Showing 1 event/)
})
test('event index keeps category filtering and empty-state privacy',async()=>{
  const f=eventIndexFixture([]),output=await f.render('stage')
  assert.equal(f.calls[0].category,'stage');assert.match(output,/data-category="stage"/)
  assert.match(output,/No confirmed upcoming events in this category/)
  assert.doesNotMatch(output,/Hit Em|hit-em-release-party/)
  await f.render('unknown');assert.equal(f.calls[1].category,undefined)
})
