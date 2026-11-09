const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
function load(file) {
 const context = { exports: {}, Date, Object, Array, process: { env: {} }, require(name) {
  if(name === 'node:crypto' || name === 'node:perf_hooks') return require(name)
  if(name === '../events/hit-em-premiere') return load('lib/events/hit-em-premiere.ts')
  if(name === './public-chat-attestation') return load('lib/content/public-chat-attestation.ts')
  if(name === 'server-only') return {}
  if(name.startsWith('.')) return load(require('node:path').resolve(require('node:path').dirname(file),name+'.ts'))
  throw Error('Unexpected import')
 } }
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
 return context.exports
}
const api = load('lib/content/public-chat-attestation.ts')
const event = load('lib/events/hit-em-premiere.ts').HIT_EM_PREMIERE
const NOW = Date.parse('2026-11-11T06:00:00.000Z')
const secret = 'PRIVATE_SENTINEL_NOT_REAL_CANON'
function fixture() {
 const row = { id:'laviche-fea', canonical_context:secret,voice_id:'PRIVATE_VOICE_SENTINEL',rights_status:'approved',voice_status:'canonical',production_ready:true,additional_private_evidence:'PRIVATE_RECORD_SENTINEL' }
 const config = {version:1,privateCanonicalSha256:api.privateCanonicalDigest(row),publicReplyArtifactSha256:'a'.repeat(64),validFrom:NOW-1000,validUntil:NOW+120000}
 const canon = {originObservedAt:NOW,liveRead:true,value:{live:true,characters:[row]}}
 const listing = {originObservedAt:NOW,liveRead:true,value:{id:event.eventId,slug:event.slug,title:event.title,starts_at:event.startsAt,video_id:event.videoId,visibility:'public',ticket_price_cents:0,status:'scheduled'}}
 return {config,canon,listing,row}
}
function run(f,start=NOW,end=NOW+10) {return api.projectFixedReplyReadiness(f.config,f.canon,f.listing,start,end)}
function held(f,start,end) {const r=run(f,start,end);assert.equal(r.status,503);assert.equal(JSON.stringify(r.body),' {"error":"Readiness unavailable"}'.trim())}
test('strict public allowlist; private values and fingerprints never appear',()=>{
 const f=fixture(),r=run(f),serialized=JSON.stringify(r)
 assert.equal(r.status,200)
 assert.deepEqual(Object.keys(r.body).sort(),['contract','event','observation','publicReplyArtifactSha256','ready','scope'])
 for(const value of [secret,'PRIVATE_VOICE_SENTINEL','PRIVATE_RECORD_SENTINEL',f.config.privateCanonicalSha256,'canonical_context','voice_id']) assert.ok(!serialized.includes(value))
 assert.equal(Date.parse(r.body.observation.expiresAt)-NOW,60000)
})
test('canon changes, missing context/voice, fallback, duplicate and readiness gates fail closed',()=>{
 for(const mutation of [f=>f.row.production_ready=false,f=>f.row.rights_status='pending',f=>f.row.voice_status='fallback',f=>f.row.canonical_context='',f=>f.row.voice_id=null,f=>f.row.additional_private_evidence='changed',f=>f.canon.value.live=false,f=>f.canon.liveRead=false,f=>f.canon.value.characters.push({...f.row}),f=>f.canon.value.characters=[],f=>f.canon.value.snapshot=true,f=>f.canon.extra='bad']) {const f=fixture();mutation(f);held(f)}
})
test('unknown row field changes are bound to private snapshot hash',()=>{const f=fixture();f.row.newField='changed';held(f)})
test('event identity, schedule, video, visibility, price, state and unknown fields fail closed',()=>{
 for(const patch of [{id:'other'},{slug:'other'},{title:'other'},{starts_at:'2026-11-12T06:00:00.000Z'},{video_id:'other'},{visibility:'private'},{ticket_price_cents:1},{status:'draft'},{status:'ended'},{status:'canceled'},{secret:'unexpected'}]) {const f=fixture();Object.assign(f.listing.value,patch);held(f)}
})
test('malformed config, pins, unapproved window and invalid/regressing clocks fail closed',()=>{
 for(const patch of [{version:2},{privateCanonicalSha256:'x'},{publicReplyArtifactSha256:'A'.repeat(64)},{validFrom:NOW+1},{validUntil:NOW},{validUntil:NaN},{unexpected:true}]) {const f=fixture();Object.assign(f.config,patch);held(f)}
 const same=fixture();same.config.publicReplyArtifactSha256=same.config.privateCanonicalSha256;held(same)
 for(const [start,end] of [[NOW,NOW-1],[NaN,NOW],[NOW,Infinity],[-1,NOW],[NOW,NOW+60000],[NOW+0.1,NOW+10]]) held(fixture(),start,end)
})
test('stale or future upstream evidence never receives a refreshed TTL',()=>{
 for(const key of ['canon','listing']) for(const at of [NOW-60000,NOW+100,NaN,'2026-11-11']) {const f=fixture();f[key].originObservedAt=at;held(f)}
 const f=fixture();f.canon.originObservedAt=NOW-50000;const r=run(f);assert.equal(r.status,200);assert.equal(Date.parse(r.body.observation.expiresAt),NOW+10000)
})
test('source errors are generic, null config performs no reads, intermediate regression denied',async()=>{
 let reads=0
 const provider={now:()=>NOW,readCanon:async()=>{reads++;throw Error(secret)},readEvent:async()=>{throw Error(secret)}}
 assert.equal((await api.evaluateFixedReplyReadiness(null,provider)).status,503);assert.equal(reads,0)
 const f=fixture();const result=await api.evaluateFixedReplyReadiness(f.config,provider);assert.equal(result.status,503);assert.ok(!JSON.stringify(result).includes(secret))
 const clocks=[NOW,NOW-1,NOW+1];assert.equal((await api.evaluateFixedReplyReadiness(f.config,{now:()=>clocks.shift(),readCanon:async()=>f.canon,readEvent:async()=>f.listing})).status,503)
 const good=await api.evaluateFixedReplyReadiness(f.config,{now:()=>NOW,readCanon:async()=>f.canon,readEvent:async()=>f.listing});assert.equal(good.status,200)
})
test('runtime remains dormant and route has no caller-controlled inputs, CORS or logs',async()=>{
 const runtime=load('lib/content/public-chat-attestation-runtime.ts');assert.equal((await runtime.publicChatReadiness()).status,503)
 const route=fs.readFileSync('app/api/public/chat-readiness/v1/route.ts','utf8');assert.match(route,/no-store/);assert.match(route,/async function GET\(request: Request\)/);assert.match(route,/publicChatReadiness\(request.signal\)/);assert.doesNotMatch(route,/console\.|Access-Control|request\.(?:url|headers|cookies|json|text)|fetch\(/)
})

test('sparse arrays cannot collide with an approved empty array',()=>{
 const f=fixture();f.row.nested=[];f.config.privateCanonicalSha256=api.privateCanonicalDigest(f.row)
 assert.equal(run(f).status,200);f.row.nested=Array(1);held(f)
 assert.throws(()=>api.privateCanonicalDigest(Array(1)))
})
test('event status requires an exact string, never coercion',()=>{
 for(const status of [['scheduled'],['live'],{toString:()=> 'scheduled'},new String('live')]) {
  const f=fixture();f.listing.value.status=status;held(f)
 }
})
test('non-JSON data, ignored properties and custom prototypes are rejected',()=>{
 const values=[undefined,NaN,Infinity,-Infinity,-0,1n,Symbol('x'),()=>{},new Date(),new Map(),new Set(),/x/,Object.create(null),Object.create({inherited:true}),new (class X {})()]
 const cyclic={};cyclic.self=cyclic;values.push(cyclic)
 const hidden={};Object.defineProperty(hidden,'hidden',{value:1});values.push(hidden)
 const symbol={};symbol[Symbol('x')]=1;values.push(symbol)
 let getters=0;const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get(){getters++;return 1}});values.push(accessor)
 const decorated=[];decorated.extra=1;values.push(decorated)
 for(const value of values) {
  assert.throws(()=>api.privateCanonicalDigest({nested:value}))
  const f=fixture();f.row.nested=value;held(f)
 }
 assert.equal(getters,0)
 const f=fixture();Object.setPrototypeOf(f.config,{extra:'bad'});held(f)
})
test('depth, node count and serialized size are bounded',()=>{
 let deep={};for(let i=0;i<34;i++)deep={nested:deep}
 for(const value of [deep,Array(10001).fill(null),'x'.repeat(262145),Array(6000).fill('x'.repeat(50))]) {
  assert.throws(()=>api.privateCanonicalDigest(value));const f=fixture();f.row.nested=value;held(f)
 }
})

const adapter=load('lib/content/public-chat-attestation-adapter.ts')
function adapterFixture(patch={}) {
 const f=fixture();let calls=0
 const source={verifiedAt:new Date(NOW+5).toISOString(),source:'GLYPH live canonical registry',studioUrl:'https://studio.truskool.net/',live:true,characters:f.canon.value.characters,...patch}
 const times=[NOW,NOW+10,NOW+11,NOW+20]
 const providers=adapter.createTrustedPublicChatProviders({now:()=>times.shift(),liveGlyphCharacters:async()=>{calls++;return source},loadHitEmPremiere:async()=>({state:'ready',status:'scheduled',title:event.title,description:'Public',startsAt:event.startsAt})})
 return {f,source,providers,calls:()=>calls}
}
test('trusted adapter validates observed completion but conservatively keeps request start',async()=>{
 const x=adapterFixture();assert.equal(x.calls(),0)
 const canon=await x.providers.readCanon(),listing=await x.providers.readEvent()
 assert.equal(canon.originObservedAt,NOW);assert.equal(listing.originObservedAt,NOW+11)
 assert.equal(api.projectFixedReplyReadiness(x.f.config,JSON.parse(JSON.stringify(canon)),JSON.parse(JSON.stringify(listing)),NOW,NOW+20).status,200)
 assert.equal(Object.keys(canon.value).sort().join(','),'characters,live')
})
test('adapter rejects pre-request, future, missing, malformed or unknown origin evidence',async()=>{
 for(const patch of [{verifiedAt:new Date(NOW-1).toISOString()},{verifiedAt:new Date(NOW+11).toISOString()},{verifiedAt:null},{verifiedAt:'bad'},{source:'static snapshot'},{live:false},{studioUrl:'https://other.invalid/'},{unknown:true}]) {
  await assert.rejects(()=>adapterFixture(patch).providers.readCanon(),/unavailable/)
 }
})
test('adapter rejects clock regression, overlong read, changed loader policy and secret errors',async()=>{
 const source=adapterFixture().source
 for(const times of [[NOW,NOW-1],[NOW,NOW+60000],[NaN,NOW]]) {
  const p=adapter.createTrustedPublicChatProviders({now:()=>times.shift(),liveGlyphCharacters:async()=>source,loadHitEmPremiere:async()=>null})
  await assert.rejects(()=>p.readCanon(),/unavailable/)
 }
 for(const patch of [{state:'canceled'},{status:['scheduled']},{status:'ended'},{title:'changed'},{startsAt:'changed'},{unknown:true}]) {
  const p=adapter.createTrustedPublicChatProviders({now:()=>NOW,liveGlyphCharacters:async()=>source,loadHitEmPremiere:async()=>({state:'ready',status:'live',title:event.title,description:'',startsAt:event.startsAt,...patch})})
  await assert.rejects(()=>p.readEvent(),/unavailable/)
 }
 const p=adapter.createTrustedPublicChatProviders({now:()=>NOW,liveGlyphCharacters:async()=>{throw Error(secret)},loadHitEmPremiere:async()=>null})
 await assert.rejects(()=>p.readCanon(),error=>error.message==='unavailable')
})

