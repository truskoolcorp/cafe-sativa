const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function modules(extra = {}) {
  const cache = {}
  function load(file) {
    if (cache[file]) return cache[file]
    const exports = {}; cache[file] = exports
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, Date, Intl, URL, AbortController, setTimeout, clearTimeout, ...extra,
      require(name) {
        if (name.startsWith('@/')) return load(name.replace('@/', '') + '.ts')
        throw Error('Unexpected dependency: ' + name)
      },
    }, { filename: file })
    return exports
  }
  return load('lib/concierge/youtube-draft-bridge.ts')
}
const api = modules(), T = api.YOUTUBE_DRAFT_TARGET
const A = 'UCaaaaaaaaaaaaaaaaaaaaaa', B = 'UCbbbbbbbbbbbbbbbbbbbbbb'
function harness(options = {}, lib = api) {
  let now = T.startsAt + 5000, calls = [], contextCalls = 0
  const context = () => ({ scope: 'approved-public-host-context', eventId: T.eventId, videoId: T.videoId,
    observedAt: now, expiresAt: now + 60000, publicCanonicalContext: 'Synthetic approved public Laviche identity',
    publicProgramming: 'Synthetic verified public event facts' })
  const bridge = new lib.YoutubeDraftBridge({ mode: 'offline-shadow', clock: () => now,
    context: () => { contextCalls++; return options.context ? options.context(context()) : context() },
    complete: async (request, signal) => { calls.push({ request, signal }); return options.complete ? options.complete(request, signal) : { content: [{ type: 'text', text: 'Welcome! What stood out to you in the video?' }] } },
    ...options.config,
  })
  const source = (patch = {}) => ({ eventId: T.eventId, videoId: T.videoId, liveChatId: T.liveChatId,
    authenticatedChannelId: T.channelId, messageId: 'source-' + now, authorChannelId: A,
    text: 'Laviche, what should we talk about?', publishedAt: now, observedAt: now, ...patch })
  return { bridge, calls, source, contextCalls: () => contextCalls, advance: ms => { now += ms }, now: () => now }
}

test('default, incomplete and unintended modes perform no dependency calls', async () => {
  let calls = 0
  for (const options of [{}, { mode: 'live', context: () => calls++, complete: () => calls++ },
    { mode: 'offline-shadow', context: () => calls++ }, { mode: 'offline-shadow', complete: () => calls++ }]) {
    const bridge = new api.YoutubeDraftBridge(options)
    assert.equal((await bridge.draft(null)).status, 'disabled')
  }
  assert.equal(calls, 0)
})
test('shared ASK engine produces only a bounded review draft, never an approved send', async () => {
  const h = harness(), source = h.source(), result = await h.bridge.draft(source)
  assert.equal(result.status, 'draft-needs-review'); assert.equal(result.postingEnabled, false)
  assert.equal(result.sourceMessageId, source.messageId)
  assert.equal(result.expiresAt, h.now() + 15000)
  assert.equal(h.calls[0].request.model, 'claude-haiku-4-5-20251001')
  assert.match(h.calls[0].request.system, /maître d'/)
  assert.match(h.calls[0].request.system, /shared PUBLIC YouTube/)
  assert.match(h.calls[0].request.system, /Only text can be delivered here/)
  assert.match(h.calls[0].request.system, /Synthetic approved public/)
  assert.equal(typeof h.bridge.send, 'undefined')
})
test('exact event, video, live chat and account pins fail closed', async () => {
  for (const patch of [{eventId:'wrong'}, {videoId:'wrong'}, {liveChatId:'wrong'}, {authenticatedChannelId:A},
    {authorChannelId:T.channelId}, {authorChannelId:'wrong'}, {messageId:null}, {messageId:{}}, {authorChannelId:null}]) {
    const h = harness(); assert.equal((await h.bridge.draft(h.source(patch))).reason, 'invalid_source')
    assert.equal(h.calls.length, 0)
  }
})
test('malformed, stale, future and pre-event messages cannot invoke generation', async () => {
  for (const patch of [{text:''}, {text:'x'.repeat(501)}, {text:'Laviche\u0000hello'}, {text:'Laviche\u202ehello'},
    {publishedAt:T.startsAt-1}, {publishedAt:T.startsAt+5001}, {observedAt:T.startsAt+5001},
    {publishedAt:NaN}, {observedAt:Infinity}]) {
    const h = harness(); assert.equal((await h.bridge.draft(h.source(patch))).status, 'skipped'); assert.equal(h.calls.length, 0)
  }
  const h = harness(), source = h.source(); h.advance(30001)
  assert.equal((await h.bridge.draft(source)).reason, 'invalid_source')
})
test('optional addressed-only mode filters messages; open-room accepts natural conversation', async () => {
  const h = harness({config:{conversationMode:'addressed-only'}}); assert.equal((await h.bridge.draft(h.source({text:'Great video!'}))).reason, 'not_addressed_to_host')
  assert.equal(h.calls.length, 0)
  const open = harness(); assert.equal((await open.bridge.draft(open.source({text:'Great video!'}))).status,'draft-needs-review')
  assert.equal(open.calls.length,1)
})
test('context must be fresh, correctly bound and explicitly public', async () => {
  for (const mutate of [() => null, c => ({...c,scope:'private'}), c => ({...c,eventId:'wrong'}),
    c => ({...c,videoId:'wrong'}), c => ({...c,observedAt:c.observedAt+1}), c => ({...c,expiresAt:c.observedAt}),
    c => ({...c,expiresAt:c.observedAt+60001}), c => ({...c,publicCanonicalContext:''}),
    c => ({...c,publicProgramming:'x'.repeat(6001)})]) {
    const h = harness({context:mutate}); assert.equal((await h.bridge.draft(h.source())).reason, 'public_context_unavailable')
    assert.equal(h.calls.length, 0)
  }
})
test('global and per-author cooldowns operate independently', async () => {
  const h = harness(); await h.bridge.draft(h.source())
  h.advance(1000); assert.equal((await h.bridge.draft(h.source({authorChannelId:B}))).reason, 'cooldown')
  h.advance(9000); assert.equal((await h.bridge.draft(h.source({authorChannelId:B}))).status, 'draft-needs-review')
  h.advance(10000); assert.equal((await h.bridge.draft(h.source())).reason, 'cooldown')
  h.advance(40000); assert.equal((await h.bridge.draft(h.source())).status, 'draft-needs-review')
})
test('duplicate source stays rejected after cooldown', async () => {
  const h = harness(), source = h.source(); await h.bridge.draft(source); h.advance(60000)
  assert.equal((await h.bridge.draft(h.source({messageId:source.messageId}))).reason, 'duplicate_source')
  assert.equal(h.calls.length, 1)
})
test('authors are isolated, bounded history contains no unpublished assistant drafts', async () => {
  const h = harness(); await h.bridge.draft(h.source({text:'Laviche, my public topic is jazz.'}))
  h.advance(10000); await h.bridge.draft(h.source({authorChannelId:B,text:'Laviche, I like dancing.'}))
  assert.equal(h.calls[1].request.messages.length, 1)
  assert.doesNotMatch(JSON.stringify(h.calls[1].request.messages), /jazz/)
  for (let i=0;i<8;i++) { h.advance(60000); await h.bridge.draft(h.source({text:'Laviche, next public topic '+i})) }
  const messages = h.calls.at(-1).request.messages
  assert.equal(messages.length, 6); assert.ok(messages.every(m => m.role === 'user'))
  assert.doesNotMatch(JSON.stringify(messages), /dancing|stood out/)
})
test('budget includes failed output and never silently retries', async () => {
  const h = harness({complete:async()=>({content:[{type:'text',text:'x'.repeat(201)}]})})
  for (let i=0;i<30;i++) { if(i) h.advance(10000); await h.bridge.draft(h.source({authorChannelId:'UC'+String(i).padStart(22,'0')})) }
  h.advance(10000)
  assert.equal((await h.bridge.draft(h.source({authorChannelId:B}))).reason, 'budget_exhausted')
  assert.equal(h.calls.length, 30)
})
test('output rejects links, contact data, markup, control characters and oversize', async () => {
  for (const text of ['x'.repeat(201),'hello\nworld','<script>','See https://bad.invalid','Visit www.example.com',
    'See example.org','Email x@example.test','Call 555-555-1212','Laviche\u202ehello']) {
    const h = harness({complete:async()=>({content:[{type:'text',text}]})})
    assert.equal((await h.bridge.draft(h.source())).reason, 'draft_output_rejected')
  }
})
test('provider failures stop permanently and redact upstream details', async () => {
  const h = harness({complete:async()=>{throw Error('private-provider-detail')}})
  const result = await h.bridge.draft(h.source())
  assert.equal(result.status, 'stopped'); assert.doesNotMatch(JSON.stringify(result),/private-provider/)
  h.advance(60000); assert.equal((await h.bridge.draft(h.source())).status, 'stopped'); assert.equal(h.calls.length,1)
})
test('in-flight work is singleflight and stop aborts then discards its result', async () => {
  let resolve
  const h = harness({complete:()=>new Promise(r=>{resolve=r})})
  const work=h.bridge.draft(h.source())
  assert.equal((await h.bridge.draft(h.source({authorChannelId:B}))).reason,'busy')
  h.bridge.stop(); assert.equal(h.calls[0].signal.aborted,true)
  resolve({content:[{type:'text',text:'Too late'}]})
  assert.equal((await work).status,'stopped')
})
test('a provider ignoring timeout cannot release a late draft or allow another generation', async () => {
  let expire, resolve
  const lib=modules({setTimeout:fn=>{expire=fn;return 1},clearTimeout:()=>{}})
  const h=harness({complete:()=>new Promise(r=>{resolve=r})},lib), work=h.bridge.draft(h.source())
  expire(); assert.equal((await work).status,'stopped'); assert.equal(h.calls[0].signal.aborted,true)
  resolve({content:[{type:'text',text:'Too late'}]})
  h.advance(60000); assert.equal((await h.bridge.draft(h.source())).status,'stopped')
})
test('late response, ended event and clock rollback fail closed', async () => {
  const h=harness({complete:async()=>{h.advance(30001);return {content:[{type:'text',text:'Late'}]}}})
  assert.equal((await h.bridge.draft(h.source())).reason,'verification_expired')
  const ended=harness(); ended.advance(1800000); assert.equal((await ended.bridge.draft(ended.source())).reason,'outside_event_window')
  const rollback=harness(); await rollback.bridge.draft(rollback.source()); rollback.advance(-1)
  assert.equal((await rollback.bridge.draft(rollback.source())).status,'stopped')
})
test('caller mutation cannot alter a running source or public context', async () => {
  let resolve, snapshot
  const h=harness({context:c=>{snapshot=c;return c},complete:()=>new Promise(r=>{resolve=r})})
  const source=h.source(), original=source.messageId, work=h.bridge.draft(source)
  source.messageId='mutated'; source.authorChannelId=B; source.text='mutated'; snapshot.expiresAt=0
  resolve({content:[{type:'text',text:'Public draft'}]})
  const result=await work
  assert.equal(result.status,'draft-needs-review'); assert.equal(result.sourceMessageId,original); assert.equal(result.authorChannelId,A)
})
test('module has no runtime integration, ASK history import, sender, environment or credential read',()=>{
  const text=fs.readFileSync('lib/concierge/youtube-draft-bridge.ts','utf8')
  assert.doesNotMatch(text,/from ['"].*(?:supabase|memory|livekit|composio|fixed-reply|worker)|process\.env|\bfetch\(|setInterval\(/)
  assert.doesNotMatch(text,/from ['"].*youtube-generation-server/)
})

const receiptFor = (draft, patch = {}) => ({ messageId: 'receipt-'+draft.sourceMessageId,
  channelId: T.channelId, liveChatId: T.liveChatId, text: draft.text, publishedAt: draft.createdAt, ...patch })
test('publication history is disabled without an explicit trusted verifier',async()=>{
  const h=harness(), draft=await h.bridge.draft(h.source())
  assert.equal(h.bridge.recordConfirmedPublication(draft,receiptFor(draft)).status,'disabled')
  h.advance(60000); await h.bridge.draft(h.source())
  assert.equal(h.calls.at(-1).request.messages.filter(m=>m.role==='assistant').length,0)
})
test('verified exact public receipt adds assistant history only to the original guest',async()=>{
  const receipts=[],h=harness({config:{verifyPublication:r=>{receipts.push(r);return true}}})
  const draft=await h.bridge.draft(h.source({text:'Laviche, my topic is jazz.'}))
  assert.equal(h.bridge.recordConfirmedPublication(draft,receiptFor(draft)).status,'recorded')
  assert.equal(Object.isFrozen(receipts[0]),true)
  h.advance(60000); await h.bridge.draft(h.source())
  assert.equal(h.calls.at(-1).request.messages[1].role,'assistant')
  assert.equal(h.calls.at(-1).request.messages[1].content,draft.text)
  h.advance(10000); await h.bridge.draft(h.source({authorChannelId:B}))
  assert.equal(h.calls.at(-1).request.messages.length,1)
})
test('copied, forged and cross-instance drafts cannot record history',async()=>{
  const h=harness({config:{verifyPublication:()=>true}}), draft=await h.bridge.draft(h.source())
  const other=harness({config:{verifyPublication:()=>true}})
  for(const candidate of [{...draft},Object.freeze({...draft}),Object.freeze({...draft,authorChannelId:B})])
    assert.equal(h.bridge.recordConfirmedPublication(candidate,receiptFor(draft)).status,'rejected')
  assert.equal(other.bridge.recordConfirmedPublication(draft,receiptFor(draft)).status,'rejected')
})
test('receipt target, exact text and send-time bounds are enforced before verifier',async()=>{
  for(const patch of [{channelId:A},{liveChatId:'other'},{text:'Different'},{messageId:null},
    {publishedAt:T.startsAt+4999},{publishedAt:T.startsAt+20000},{publishedAt:T.startsAt+5001}]) {
    let verified=0
    const h=harness({config:{verifyPublication:()=>{verified++;return true}}}),draft=await h.bridge.draft(h.source())
    assert.equal(h.bridge.recordConfirmedPublication(draft,receiptFor(draft,patch)).status,'rejected')
    assert.equal(verified,0)
  }
})
test('unverified receipts add no assistant history; identical verified receipts are idempotent',async()=>{
  const no=harness({config:{verifyPublication:()=>false}}),draft=await no.bridge.draft(no.source())
  assert.equal(no.bridge.recordConfirmedPublication(draft,receiptFor(draft)).status,'rejected')
  const yes=harness({config:{verifyPublication:()=>true}}),good=await yes.bridge.draft(yes.source())
  assert.equal(yes.bridge.recordConfirmedPublication(good,receiptFor(good)).status,'recorded')
  assert.equal(yes.bridge.recordConfirmedPublication(good,receiptFor(good)).status,'duplicate')
  assert.equal(yes.bridge.recordConfirmedPublication(good,receiptFor(good,{messageId:'other'})).status,'rejected')
  yes.advance(60000);await yes.bridge.draft(yes.source())
  assert.equal(yes.calls.at(-1).request.messages.filter(m=>m.role==='assistant').length,1)
})
test('one provider receipt cannot become replies to two guests',async()=>{
  const h=harness({config:{verifyPublication:()=>true}}),one=await h.bridge.draft(h.source())
  assert.equal(h.bridge.recordConfirmedPublication(one,receiptFor(one,{messageId:'shared-id'})).status,'recorded')
  h.advance(10000);const two=await h.bridge.draft(h.source({authorChannelId:B}))
  assert.equal(h.bridge.recordConfirmedPublication(two,receiptFor(two,{messageId:'shared-id'})).status,'rejected')
})
test('receipt verifier failure or stop cannot update history',async()=>{
  const failure=harness({config:{verifyPublication:()=>{throw Error('private')}}}),one=await failure.bridge.draft(failure.source())
  assert.equal(failure.bridge.recordConfirmedPublication(one,receiptFor(one)).status,'rejected')
  const stop=harness({config:{verifyPublication:()=>{stop.bridge.stop();return true}}}),two=await stop.bridge.draft(stop.source())
  assert.equal(stop.bridge.recordConfirmedPublication(two,receiptFor(two)).status,'rejected')
  assert.equal((await stop.bridge.draft(stop.source())).status,'stopped')
})
test('publication verifier cannot recursively record another draft using the same receipt',async()=>{
  let nested, second
  const h=harness({config:{verifyPublication:()=>{
    nested=h.bridge.recordConfirmedPublication(second,receiptFor(second,{messageId:'shared-receipt'}));return true
  }}})
  const first=await h.bridge.draft(h.source());h.advance(10000)
  second=await h.bridge.draft(h.source({authorChannelId:B}))
  assert.equal(h.bridge.recordConfirmedPublication(first,receiptFor(first,{messageId:'shared-receipt'})).status,'recorded')
  assert.equal(nested.status,'rejected')
  assert.equal(h.bridge.recordConfirmedPublication(second,receiptFor(second,{messageId:'shared-receipt'})).status,'rejected')
})
test('publication verifier cannot start a draft that is overwritten by the recording',async()=>{
  let nested
  const h=harness({config:{verifyPublication:()=>{h.advance(60000);nested=h.bridge.draft(h.source({text:'Laviche, nested message'}));return true}}})
  const first=await h.bridge.draft(h.source())
  assert.equal(h.bridge.recordConfirmedPublication(first,receiptFor(first)).status,'recorded')
  assert.equal((await nested).reason,'busy');assert.equal(h.calls.length,1)
  await h.bridge.draft(h.source({text:'Laviche, next actual message'}))
  const turns=h.calls.at(-1).request.messages
  assert.equal(turns.length,3);assert.equal(turns[1].role,'assistant')
  assert.equal(turns[2].content,'Laviche, next actual message')
})
test('clock and context callbacks can stop before any provider invocation',async()=>{
  const clock=harness({config:{clock:()=>{clock.bridge.stop();return T.startsAt+5000}}})
  assert.equal((await clock.bridge.draft(clock.source())).status,'stopped')
  assert.equal(clock.contextCalls(),0);assert.equal(clock.calls.length,0)
  const context=harness({context:value=>{context.bridge.stop();return value}})
  assert.equal((await context.bridge.draft(context.source())).status,'stopped')
  assert.equal(context.calls.length,0)
})
test('clock callback after publication verification can stop before committing history',async()=>{
  let stopOnClock=false
  const h=harness({config:{clock:()=>{if(stopOnClock)h.bridge.stop();return T.startsAt+5000},
    verifyPublication:()=>{stopOnClock=true;return true}}})
  const draft=await h.bridge.draft(h.source())
  assert.equal(h.bridge.recordConfirmedPublication(draft,receiptFor(draft)).status,'rejected')
  assert.equal((await h.bridge.draft(h.source())).status,'stopped')
})


test('open-room context shares only fresh public turns using anonymous guest labels',async()=>{
  const h=harness({config:{verifyPublication:()=>true}}), first=await h.bridge.draft(h.source({text:'The bass is great.'}))
  h.bridge.recordConfirmedPublication(first,receiptFor(first));h.advance(10000)
  await h.bridge.draft(h.source({authorChannelId:B,text:'I love the drums.'}))
  const request=h.calls.at(-1).request
  assert.match(request.system,/The bass is great/);assert.match(request.system,/guest-1/)
  assert.match(request.system,/stood out/);assert.doesNotMatch(request.system,new RegExp(A+'|'+B))
  assert.doesNotMatch(JSON.stringify(request.messages),/bass/)
  h.advance(60000);await h.bridge.draft(h.source({text:'Next song?'}))
  assert.doesNotMatch(h.calls.at(-1).request.system,/The bass is great|I love the drums/)
})
test('public prompt avoids website audio claims and routine AI disclaimers but requires truth',async()=>{
  const h=harness();await h.bridge.draft(h.source({text:'Are you an AI?'}))
  const system=h.calls[0].request.system
  assert.match(system,/Do not introduce replies/);assert.match(system,/directly asked.*answer honestly/)
  assert.match(system,/Never invent personal history/)
  assert.doesNotMatch(system,/Guests can speak to you out loud|Regular \(\$9/)
})
