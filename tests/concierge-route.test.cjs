const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
const ISSUED = Date.now()
const HEX_TIME = ISSUED.toString(16).padStart(12,'0')
const V2 = {request_id:`${HEX_TIME.slice(0,8)}-${HEX_TIME.slice(8)}-7234-9234-123456789abc`,issued_at:ISSUED}
function harness(options = {}) {
  const env = { ...(options.configured ? { ANTHROPIC_API_KEY: 'synthetic-only' } : {}), ...(options.durable ? { CONCIERGE_DURABLE_MODE: options.durable } : {}), ...(options.maintenance ? { CONCIERGE_TEXT_MAINTENANCE: options.maintenance } : {}) }
  const calls = { rpc: [], provider: 0, writes: [], rate: [], memory: [], auth: 0, database: 0 }
  const event = { id: '00e7d9c6-61b9-4af9-827e-b6d13310b762', slug: 'hit-em-release-party',
    title: 'Hit Em Release Party', starts_at: '2026-11-11T06:00:00Z', ends_at: null,
    status: 'scheduled', ticket_price_cents: 0, access: 'free', description: '', free_for_tiers: [] }
  const admin = { async rpc(name, args) { calls.rpc.push({name,args}); return options.rpc ? options.rpc(name,args,calls) : {error:'unavailable'} }, from(table) {
    calls.database++
    let inserting = false
    const query = {
      select() { return this }, eq() { return this }, gte() { return this }, is() { return this },
      order() { return this }, limit() { return this }, in() { return this },
      insert(value) { inserting = true; calls.writes.push({ table, value }); return this },
      single() { return this }, maybeSingle() { return this },
      then(resolve) {
        if (table === 'memberships') return Promise.resolve(resolve({ data: options.membership ?? null, error: options.membershipError ?? null }))
        if (table === 'host_conversations') return Promise.resolve(resolve({ data: {
          id: ID, user_id: options.conversationUser ?? null, session_id: ID, host_agent: 'laviche', ended_at: null,
        }, error: options.conversationError ?? null }))
        return Promise.resolve(resolve({ data: inserting ? null : [], error: inserting ? options.persistError ?? null : options.historyError ?? null }))
      },
    }
    return query
  } }
  function load(file) {
    const context = { exports: {}, Buffer, Date, Intl, URL, Set, console: { error() {} },
      process: { env },
      require(name) {
        if (name === 'node:crypto') return {randomUUID:()=>ID}
        if (name === 'next/server') return { NextResponse: class {
          static json(body, init = {}) { return { body, status: init.status ?? 200, headers: {...(init.headers ?? {}),set(key,value){this[key]=value}} } }
        } }
        if (name === '@anthropic-ai/sdk') return { default: class {
          constructor(options) { calls.provider++; calls.providerOptions=options }
          messages = { create: async (params) => { calls.providerParams=params; options.onProvider?.(env); if(options.providerError) throw new Error('private prompt'); return { content: [{ type: 'text', text: 'Synthetic general reply' }], _request_id: 'req_fixture', id: 'msg_fixture', usage: { input_tokens: 17, output_tokens: 5 }, ...(options.completion ?? {}) } } }
        } }
        if (name.endsWith('/concierge-canon')) return { canonicalConciergeHost: async () => options.canonMissing ? null : ({ context: options.context ?? 'Approved identity' }) }
        if (name.endsWith('/content/site')) return { getSiteContent: async () => {
          if (options.featureError) throw new Error('Synthetic feature outage')
          return []
        } }
        if (name === '@/lib/events') return { getUpcomingEvents: async () => options.events ?? [event] }
        if (name.endsWith('/supabase/server')) return { createClient: () => ({ auth: { getUser: async () => {
          calls.auth++
          return { data: { user: options.userId ? { id: options.userId } : null }, error: options.authError }
        } } }) }
        if (name.endsWith('/supabase/admin')) return { createAdminClient: () => admin }
        if (name.endsWith('/personas')) return { getHost: host => host === 'laviche' ? { id: host, system_prompt: 'Approved host' } : null }
        if (name.endsWith('/rate-limit')) return { checkRateLimit: async params => {
          calls.rate.push(params)
          return options.usageUnavailable ? { allowed: false, unavailable: true, message: 'Availability check failed', resetsInSeconds: 30 }
            : options.denied ? { allowed: false, message: 'Limit reached', resetsInSeconds: 60 }
            : { allowed: true, remaining: 10, resetsInSeconds: 3600 }
        } }
        if (name.endsWith('/memory')) return { getMemoryContext: async params => {
          calls.memory.push(params)
          if (options.memoryError) throw new Error('Synthetic memory failure')
          return []
        } }
        if (name.startsWith('./')) return load(require('node:path').join(require('node:path').dirname(file), name) + '.ts')
        if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts')
        throw new Error(`Unexpected import: ${name}`)
      },
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context)
    return context.exports
  }
  const route = load(options.statusRoute ? 'app/api/concierge/status/route.ts' : 'app/api/concierge/route.ts')
  return { calls, helpers: load('lib/concierge/durable.ts'), get: () => route.GET({ url: 'https://www.cafe-sativa.com/api/concierge/status', headers: { get: () => null } }), post: (body = {}) => route.POST({ url: options.url ?? 'https://www.cafe-sativa.com/api/concierge', json: async () => ({ host: 'laviche',
    message: 'Hi Laviche. For the Hit Em premiere, when does it start in Dallas, is it free, and where do I join the shared live chat?',
    session_id: ID, surface: 'web-chat', ...body }), headers: { get: name => name === 'x-concierge-requester' ? options.expectedRequester ?? null : name === 'origin' ? options.origin ?? null : name === 'x-concierge-durable' ? (options.legacyMode ? '0' : options.requireDurable ? '1' : null) : null } }) }
}
test('verified launch FAQ returns and persists exact facts with no provider key or provider call', async () => {
  const h = harness({ featureError: true })
  const response = await h.post()
  assert.equal(response.status, 200)
  assert.match(response.body.message, /12:00 AM midnight CST/)
  assert.match(response.body.message, /no Café Sativa account, membership, or ticket/)
  assert.match(response.body.message, /ZYA0r9JM6eA/)
  assert.equal(h.calls.provider, 0)
  assert.equal(h.calls.rate.length, 1)
  assert.equal(h.calls.writes.length, 1)
  assert.equal(h.calls.writes[0].table, 'host_messages')
  assert.equal(h.calls.writes[0].value[1].content, response.body.message)
})
test('deterministic FAQ cannot bypass ownership or rate checks', async () => {
  const other = harness({ conversationUser: 'another-user' })
  const inaccessible = await other.post({ conversation_id: ID })
  assert.equal(inaccessible.status, 403)
  assert.equal(inaccessible.body.code, 'conversation_unavailable')
  assert.equal(other.calls.writes.length, 0)
  const denied = harness({ denied: true })
  assert.equal((await denied.post()).status, 429)
  assert.equal(denied.calls.writes.length, 0)
})
test('unverified event cannot trigger the deterministic answer; general chat still uses the provider', async () => {
  const unavailable = harness({ events: [] })
  assert.equal((await unavailable.post()).status, 503)
  assert.equal(unavailable.calls.provider, 0)
  const general = harness({ configured: true })
  const response = await general.post({ message: 'Hello Laviche' })
  assert.equal(response.status, 200)
  assert.equal(response.body.message, 'Synthetic general reply')
  assert.equal(general.calls.provider, 1)
})
test('malformed IDs/types are rejected before usage, history, provider or writes', async () => {
  for (const body of [{ session_id: {} }, { session_id: '' }, { session_id: 42 },
    { session_id: 'x'.repeat(257) }, { session_id: 'session\u0000id' },
    { conversation_id: false }, { conversation_id: '' }, { conversation_id: [] },
    { room_id: {} }, { room_id: 'x'.repeat(129) }, { host: ['laviche'] },
    { surface: ['web-chat'] }, { message: 'x'.repeat(2001) }, { message: ' ' }]) {
    const h = harness({ configured: true })
    assert.equal((await h.post(body)).status, 400)
    assert.equal(h.calls.rate.length, 0)
    assert.equal(h.calls.provider, 0)
    assert.equal(h.calls.writes.length, 0)
  }
})
test('legacy opaque guest sessions remain compatible for mall and email surfaces', async () => {
  for (const [surface, session] of [['mall-3d', 'mall-1794147756000-abc12345'], ['email', 'legacy-session:example-123']]) {
    const h = harness()
    const response = await h.post({ session_id: `  ${session}  `, surface })
    assert.equal(response.status, 200)
    assert.equal(h.calls.rate[0].sessionId, session)
    assert.equal(h.calls.rate[0].tier, 'anonymous')
  }
})
test('expired or invalid memberships receive Explorer limits; valid paid period keeps its tier', async () => {
  for (const [membership, expected] of [
    [{ tier: 'vip', status: 'active', current_period_end: '2000-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'vip', status: 'active', current_period_end: null }, 'explorer'],
    [{ tier: 'vip', status: 'canceled', current_period_end: '2999-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'made-up', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'explorer'],
    [{ tier: 'regular', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'regular'],
    [{ tier: 'vip', status: 'active', current_period_end: '2999-01-01T00:00:00Z' }, 'vip'],
  ]) {
    const h = harness({ userId: ID, membership })
    assert.equal((await h.post()).status, 200)
    assert.equal(h.calls.rate[0].tier, expected)
  }
})
test('usage, membership and history failures stop provider work without treating infrastructure failure as quota exhaustion', async () => {
  for (const options of [{ usageUnavailable: true }, { membershipError: {}, userId: ID },
    { conversationError: {} }, { historyError: {} }, { memoryError: true }]) {
    const h = harness({ configured: true, ...options })
    const response = await h.post({ message: 'Hello' })
    assert.equal(response.status, 503)
    assert.notEqual(response.body.rate_limited, true)
    assert.equal(h.calls.provider, 0)
    assert.equal(h.calls.writes.length, 0)
  }
})
test('current conversation is excluded from prior memory; failed save delivers answer with explicit warning', async () => {
  const h = harness({ persistError: {} })
  const response = await h.post()
  assert.equal(h.calls.memory[0].excludeConversationId, ID)
  assert.equal(response.status, 200)
  assert.equal(response.body.memory_saved, false)
  assert.match(response.body.warning, /could not be saved/)
  assert.match(response.body.message, /Hit Em/)
})
test('unapproved browser origin is rejected before any paid or database work', async () => {
  const denied = harness({ origin: 'https://unrelated.invalid', configured: true })
  const response = await denied.post()
  assert.equal(response.status, 403)
  assert.equal(response.body.code, 'origin_not_allowed')
  assert.equal(denied.calls.auth, 0)
  assert.equal(denied.calls.database, 0)
  assert.equal(denied.calls.rate.length, 0)
  assert.equal(denied.calls.provider, 0)
  assert.equal(denied.calls.writes.length, 0)
  assert.equal((await harness({ origin: 'https://www.cafe-sativa.com' }).post()).status, 200)
})
test('real origin resolver permits documented same-origin aliases without expanding cross-origin access', async () => {
  for (const origin of ['https://virtual.cafe-sativa.com', 'https://virtual-cafe-sativa.vercel.app']) {
    const same = harness({ origin, url: `${origin}/api/concierge` })
    const response = await same.post({ conversation_id: ID })
    assert.equal(response.status, 200)
    assert.equal(response.body.conversation_id, ID)
    assert.equal(same.calls.auth, 1)
    assert.equal(same.calls.writes.length, 1)
    assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
    const cross = harness({ origin })
    assert.equal((await cross.post()).status, 403)
    assert.equal(cross.calls.auth, 0)
    assert.equal(cross.calls.database, 0)
  }
})
test('real origin resolver retains approved mall/preview callers and rejects untrusted same-origin hosts', async () => {
  for (const origin of ['https://mall.truskool.net', 'https://virtual-cafe-sativa-preview.vercel.app']) {
    const response = await harness({ origin }).post()
    assert.equal(response.status, 200)
    assert.equal(response.headers['Access-Control-Allow-Origin'], origin)
  }
  for (const origin of ['https://unrelated.invalid', 'http://virtual.cafe-sativa.com', 'null',
    'https://virtual.cafe-sativa.com.unrelated.invalid']) {
    const denied = harness({ origin, url: `${origin}/api/concierge` })
    assert.equal((await denied.post()).status, 403)
    assert.equal(denied.calls.auth, 0)
    assert.equal(denied.calls.database, 0)
    assert.equal(denied.calls.provider, 0)
  }
})

const POLICY = {version:1,max_prompt_bytes:48000,max_input_messages:61,max_output_tokens:512,max_reply_chars:16384}
function ledger(overrides = {}) {
 return async (name,args,calls) => {
  if(overrides[name]) return overrides[name](args,calls)
  if(name.includes('admit')) return {data:{admitted:true,state:'RESERVED',requester:`s:${ID}`,owner_token:ID,request_id:ID,conversation_id:ID,remaining:9,policy:POLICY}}
  if(name.includes('dispatch')) return {data:{dispatch_granted:true,state:'DISPATCHING'}}
  if(name.includes('complete')) return {data:{state:'COMPLETED',response:{message:args.p_reply,conversation_id:ID,host:'laviche',remaining:9,memory_saved:true}}}
  if(name.includes('status')) return {data:{state:'UNCERTAIN'}}
  return {data:{state:'UNCERTAIN'}}
 }
}
test('durable FAQ completes atomically without provider, legacy counter or message inserts', async()=>{
 const h=harness({durable:'on',rpc:ledger()}); const r=await h.post({request_id:ID})
 assert.equal(r.status,200); assert.equal(r.body.memory_saved,true); assert.equal(h.calls.provider,0)
 assert.equal(h.calls.rate.length,0); assert.equal(h.calls.writes.length,0)
 assert.deepEqual(h.calls.rpc.map(x=>x.name),['concierge_admit_v1','concierge_complete_v1'])
 assert.equal(h.calls.rpc[0].args.p_payload.conversation_id,null)
})
test('durable paid path is dispatched once with bounded envelope and zero SDK retries',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger()});const r=await h.post({request_id:ID,message:'Hello'})
 assert.equal(r.status,200);assert.equal(h.calls.provider,1);assert.equal(h.calls.providerParams.max_tokens,512);assert.equal(h.calls.providerOptions.maxRetries,0);assert.equal(h.calls.providerOptions.timeout,25000)
 assert.equal(h.calls.rpc.filter(x=>x.name.includes('dispatch')).length,1)
})
test('ambiguous dispatch never calls provider and remains uncertain',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger({concierge_dispatch_v1:()=>{throw Error('lost')}})})
 const r=await h.post({request_id:ID,message:'Hello'});assert.equal(r.status,503);assert.equal(h.calls.provider,0)
 assert.equal(h.calls.rpc.at(-1).args.p_outcome,'uncertain')
})
test('ambiguous admission does status only and never uses replay to dispatch',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger({concierge_admit_v1:()=>{throw Error('lost')}})})
 const r=await h.post({request_id:ID});assert.equal(r.status,202);assert.equal(h.calls.provider,0)
 assert.deepEqual(h.calls.rpc.map(x=>x.name),['concierge_admit_v1','concierge_status_v1'])
})
test('completion retries database only and never exposes uncommitted provider answer',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger({concierge_complete_v1:()=>({error:'offline'})})})
 const r=await h.post({request_id:ID,message:'Hello'});assert.equal(r.status,503);assert.equal(r.body.code,'save_pending')
 assert.equal(r.body.message,undefined);assert.equal(h.calls.provider,1)
 assert.equal(h.calls.rpc.filter(x=>x.name.includes('complete')).length,2)
})
test('completion response loss retries same transaction then returns committed response',async()=>{
 let attempts=0; const h=harness({durable:'on',configured:true,rpc:ledger({concierge_complete_v1:args=>{
 if(!attempts++) throw Error('lost');return {data:{state:'COMPLETED',response:{message:args.p_reply,memory_saved:true}}}
 }})});const r=await h.post({request_id:ID,message:'Hello'});assert.equal(r.status,200);assert.equal(h.calls.provider,1);assert.equal(attempts,2)
})
test('durable config, canonical and prompt limits fail closed before provider',async()=>{
 for(const opts of [{durable:'invalid'}, {durable:'on'}, {durable:'on',rpc:ledger(),canonMissing:true}, {durable:'on',rpc:ledger(),context:'X'.repeat(50000)}]) {
 const h=harness({...opts,configured:true});const r=await h.post({request_id:ID,message:'Hello'});assert.equal(r.status,503);assert.equal(h.calls.provider,0);assert.equal(h.calls.rate.length,0)
 }
})
test('existing pending, cancelled, conflict and owner denial never dispatch or reveal reply',async()=>{
 for(const data of [{admitted:false,state:'RESERVED'},{admitted:false,state:'CANCELLED'},{error:'conflict'},{error:'forbidden'}]) {
 const h=harness({durable:'on',rpc:ledger({concierge_admit_v1:()=>({data})})});const r=await h.post({request_id:ID})
 assert.notEqual(r.status,200);assert.equal(r.body.message,undefined);assert.equal(h.calls.provider,0);assert.equal(h.calls.rpc.length,1)
 }
})

test('status derives auth, delegates owner check, exposes no token and never calls provider',async()=>{
 const h=harness({durable:'on',statusRoute:true,userId:ID,rpc:ledger({concierge_status_v1:()=>({data:{error:'forbidden',owner_token:'secret'}})})})
 const r=await h.post({request_id:ID});assert.equal(r.status,403);assert.equal(r.body.owner_token,undefined)
 assert.equal(h.calls.provider,0);assert.equal(h.calls.rpc[0].args.p_user_id,ID);assert.equal(h.calls.rate.length,0)
})
test('status allows same-ID expired reservation recovery only when admissions enabled',async()=>{
 for (const durable of ['on',undefined]) {
 const h=harness({durable,statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data:{state:'reserved',recovery_required:true}})})})
 const r=await h.post({request_id:ID});assert.equal(r.status,202);assert.equal(r.body.recovery_required,durable==='on');assert.equal(h.calls.provider,0)
 }
})
test('auth dependency failure cannot fall back into guest durable namespace',async()=>{
 for(const statusRoute of [true,false]) {
 const h=harness({durable:'on',statusRoute,authError:{name:'AuthRetryableFetchError'},rpc:ledger()})
 assert.equal((await h.post({request_id:ID})).status,503);assert.equal(h.calls.rpc.length,0)
 }
})
test('unknown provider outcome retains charge and never retries provider',async()=>{
 const h=harness({durable:'on',configured:true,providerError:true,rpc:ledger()})
 const r=await h.post({request_id:ID,message:'Hello'});assert.equal(r.status,503);assert.equal(h.calls.provider,1)
 assert.equal(h.calls.rpc.at(-1).args.p_outcome,'uncertain');assert.equal(r.body.message,undefined)
})

test('missing request grants exact-ID readmission only with durable mode on',async()=>{
 for(const durable of ['on',undefined]) {
 const h=harness({durable,statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data:{error:'request_missing',recovery_required:true}})})})
 const r=await h.post(V2);assert.equal(r.status,durable==='on'?202:404)
 assert.equal(r.body.recovery_required,durable==='on'?true:undefined);assert.equal(h.calls.provider,0)
 }
})
test('capability response is authoritative uncached and has no database work',async()=>{
 for(const durable of ['on','off','invalid']) {
 const h=harness({durable,statusRoute:true});const r=await h.get()
 assert.equal(r.status,durable==='invalid'?503:200);assert.equal(r.headers['Cache-Control'],'no-store')
 if(durable!=='invalid') assert.equal(r.body.durable_enabled,durable==='on')
 assert.equal(h.calls.database,0);assert.equal(h.calls.auth,0)
 }
})
test('durable mode change cannot fall through to legacy provider or persistence',async()=>{
 const h=harness({configured:true,requireDurable:true});const r=await h.post({request_id:ID,message:'Hello'})
 assert.equal(r.status,503);assert.equal(r.body.code,'durable_disabled');assert.equal(h.calls.provider,0);assert.equal(h.calls.database,0)
})
test('delayed original after missing status competes by the same key and only fresh admission dispatches',async()=>{
 let admitted=false
 const rpc=ledger({concierge_admit_v1:async(args)=>{
  assert.equal(args.p_request_id,ID)
  if(admitted) return {data:{admitted:false,state:'dispatching'}}
  admitted=true
  return {data:{admitted:true,state:'reserved',requester:`s:${ID}`,owner_token:ID,request_id:ID,conversation_id:ID,policy:POLICY}}
 }})
 const original=harness({durable:'on',configured:true,rpc}),retry=harness({durable:'on',configured:true,rpc})
 const result=await Promise.all([original.post({request_id:ID,message:'Hello'}),retry.post({request_id:ID,message:'Hello'})])
 assert.equal(original.calls.provider+retry.calls.provider,1);assert.deepEqual(result.map(r=>r.status).sort(),[200,202])
})

test('legacy capability mode change never creates an unretained durable admission',async()=>{
 const h=harness({durable:'on',legacyMode:true,rpc:ledger()});const r=await h.post({message:'Hello'})
 assert.equal(r.status,503);assert.equal(r.body.code,'mode_changed');assert.equal(r.body.admitted,false)
 assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.provider,0)
})

test('durable browser identity expectation is mandatory and cannot authorize another account',async()=>{
 for(const statusRoute of [false,true]) for(const expectedRequester of [undefined,`user:${ID}`,`guest:${ID}`]) {
 const h=harness({durable:'on',statusRoute,requireDurable:true,userId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',expectedRequester,rpc:ledger()})
 const r=await h.post({request_id:ID,message:'Private account A text'})
 assert.equal(r.status,409);assert.equal(r.body.code,'requester_changed');assert.equal(r.body.admitted,undefined)
 assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.database,0);assert.equal(h.calls.provider,0);assert.equal(h.calls.memory.length,0)
 }
})
test('durable guest fence matches exact normalized session and rejects sign-in drift',async()=>{
 const h=harness({durable:'on',requireDurable:true,expectedRequester:`guest:${ID}`,rpc:ledger()})
 assert.equal((await h.post({request_id:ID})).status,200)
 const signedIn=harness({durable:'on',requireDurable:true,expectedRequester:`guest:${ID}`,userId:ID,rpc:ledger()})
 assert.equal((await signedIn.post({request_id:ID})).status,409);assert.equal(signedIn.calls.rpc.length,0)
})
test('legacy mall without browser fence remains compatible',async()=>{
 const h=harness({durable:'on',rpc:ledger()});assert.equal((await h.post({request_id:ID,surface:'mall-3d'})).status,200)
})
test('only explicit fresh-key conversation rejection may release retained work',async()=>{
 const fresh=harness({durable:'on',rpc:ledger({concierge_admit_v1:()=>({data:{error:'conversation_unavailable',admitted:false}})})})
 const rejected=await fresh.post({request_id:ID,conversation_id:ID})
 assert.equal(rejected.status,403);assert.equal(rejected.body.code,'conversation_unavailable');assert.equal(rejected.body.admitted,false)
 const existing=harness({durable:'on',rpc:ledger({concierge_admit_v1:()=>({data:{error:'forbidden'}})})})
 const denied=await existing.post({request_id:ID,conversation_id:ID});assert.equal(denied.status,403);assert.equal(denied.body.admitted,undefined)
 assert.equal(fresh.calls.provider+existing.calls.provider,0)
})

test('version2 carries its immutable issuance and old retained version1 hashes stay unchanged',async()=>{
 const h=harness({durable:'on',rpc:ledger()}); assert.equal((await h.post(V2)).status,200)
 const payload=h.calls.rpc[0].args.p_payload
 assert.equal(payload.version,2); assert.equal(payload.issued_at,ISSUED)
 assert.deepEqual(Object.keys(payload).sort(),['conversation_id','host','issued_at','message','room_id','surface','version'])
 const old=harness({durable:'on',rpc:ledger()}); await old.post({request_id:ID})
 assert.equal(old.calls.rpc[0].args.p_payload.version,1)
 assert.equal(Object.hasOwn(old.calls.rpc[0].args.p_payload,'issued_at'),false)
})
test('timestamp changes, nonnumeric timestamps and mismatched keys fail before any admission',async()=>{
 for(const patch of [{issued_at:ISSUED+1},{issued_at:String(ISSUED)},{issued_at:Infinity},{issued_at:ISSUED+0.5},{request_id:ID}]) {
  const h=harness({durable:'on',configured:true,rpc:ledger()})
  assert.equal((await h.post({...V2,...patch})).status,400)
  assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.provider,0);assert.equal(h.calls.auth,0)
 }
})
test('durable server never creates a missing request identity for an old client',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger()});const r=await h.post()
 assert.equal(r.status,409);assert.equal(r.body.code,'request_upgrade_required')
 assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.provider,0);assert.equal(h.calls.rate.length,0)
})
test('missing keys require explicit database eligibility; old SQL and missing v1 cannot grant replay',async()=>{
 for(const [body,data] of [[V2,{error:'request_missing'}],[{request_id:ID},{error:'request_missing',recovery_required:true}],
   [V2,{error:'request_expired'}],[{request_id:ID},{error:'request_expired'}]]) {
  const h=harness({durable:'on',statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data})})})
  const r=await h.post(body);assert.notEqual(r.status,202);assert.equal(r.body.recovery_required,undefined)
  assert.equal(r.body.admitted,undefined);assert.equal(r.body.terminal,undefined);assert.equal(h.calls.provider,0)
 }
})
test('expired or old requests can still retrieve an existing committed response without admission',async()=>{
 for(const body of [V2,{request_id:ID}]) {
  const h=harness({durable:'on',statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data:{state:'completed',response:{message:'Original only',memory_saved:true}}})})})
  const r=await h.post(body);assert.equal(r.status,200);assert.equal(r.body.message,'Original only')
  assert.deepEqual(h.calls.rpc.map(x=>x.name),['concierge_status_v1']);assert.equal(h.calls.provider,0)
 }
})
test('database expiry rejection never converts an expired pending request into a new admission',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger({concierge_admit_v1:()=>({data:{error:'request_expired'}})})})
 const r=await h.post(V2);assert.equal(r.status,409);assert.equal(r.body.code,'request_expired')
 assert.equal(r.body.admitted,undefined);assert.equal(r.body.terminal,undefined);assert.equal(h.calls.provider,0)
})
test('text maintenance blocks legacy, durable, mall and malformed admissions before all external work',async()=>{
 for(const durable of ['on','off','invalid']) for(const maintenance of ['on','bad-value']) for(const fence of [{},{legacyMode:true},{requireDurable:true}]) {
  const h=harness({durable,maintenance,configured:true,rpc:ledger(),...fence})
  const r=await h.post({host:'invalid',surface:'mall-3d'})
  assert.equal(r.status,503);assert.equal(r.body.code,maintenance==='on'?'text_maintenance':'policy_unavailable')
  assert.equal(r.body.admitted,undefined)
  assert.equal(h.calls.auth,0);assert.equal(h.calls.database,0);assert.equal(h.calls.rpc.length,0)
  assert.equal(h.calls.provider,0);assert.equal(h.calls.rate.length,0);assert.equal(h.calls.writes.length,0)
 }
})
test('maintenance status stays readable but suppresses missing and expired-reservation admission replay',async()=>{
 for(const maintenance of ['on','invalid']) for(const data of [
   {state:'reserved',recovery_required:true},{error:'request_missing',recovery_required:true},
   {state:'completed',response:{message:'Already finished',memory_saved:true}}]) {
  const h=harness({durable:'on',maintenance,statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data})})})
  const r=await h.post(V2);assert.notEqual(r.body.recovery_required,true)
  if(data.state==='completed') { assert.equal(r.status,200);assert.equal(r.body.message,'Already finished') }
  assert.equal(h.calls.provider,0);assert.deepEqual(h.calls.rpc.map(x=>x.name),['concierge_status_v1'])
 }
})
test('capability reports only text admission maintenance with v2 contract; invalid gate fails closed',async()=>{
 for(const maintenance of ['off','on','invalid']) {
  const h=harness({durable:'on',maintenance,statusRoute:true});const r=await h.get()
  assert.equal(r.status,maintenance==='invalid'?503:200)
  if(maintenance!=='invalid') {assert.equal(r.body.durable_enabled,true);assert.equal(r.body.durable_payload_version,2);assert.equal(r.body.text_admissions_enabled,maintenance==='off')}
  assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(h.calls.rpc.length,0)
 }
})
test('an already admitted worker can complete after maintenance begins',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger(),onProvider:env=>{env.CONCIERGE_TEXT_MAINTENANCE='on'}})
 const r=await h.post({...V2,message:'Hello'})
 assert.equal(r.status,200);assert.equal(h.calls.provider,1);assert.equal(h.calls.rpc.at(-1).name,'concierge_complete_v1')
 const stopped=await h.post({...V2,message:'Later'});assert.equal(stopped.body.code,'text_maintenance');assert.equal(h.calls.provider,1)
})
test('provider receipts allow only bounded opaque identifiers and integer token counts',()=>{
 const {sanitizedProviderReceipt:receipt}=harness().helpers
 const value=receipt({_request_id:'req_123',id:'msg-123',usage:{input_tokens:0,output_tokens:2147483647},content:'PRIVATE',owner_token:'SECRET',user_id:ID})
 assert.deepEqual(JSON.parse(JSON.stringify(value)),{request_id:'req_123',message_id:'msg-123',input_tokens:0,output_tokens:2147483647})
 for(const invalid of ['', 'private text', 'x'.repeat(129), 'bad\nline', 'https://private', {}, 1]) {
  assert.equal(receipt({_request_id:invalid,id:invalid}).request_id,null)
  assert.equal(receipt({_request_id:invalid,id:invalid}).message_id,null)
 }
 for(const invalid of [-1,2147483648,0.5,NaN,Infinity,'5',{}]) {
  const r=receipt({usage:{input_tokens:invalid,output_tokens:invalid}})
  assert.equal(r.input_tokens,null);assert.equal(r.output_tokens,null)
 }
 assert.equal(receipt(null).message_id,null)
})
test('provider receipts reach atomic completion and charged terminal finish but never the browser',async()=>{
 const h=harness({durable:'on',configured:true,rpc:ledger({concierge_complete_v1:()=>({error:'offline'}),concierge_finish_v1:()=>({data:{state:'FAILED'}})})})
 const r=await h.post({...V2,message:'Hello'})
 assert.equal(r.status,409);assert.equal(r.body.terminal,true);assert.equal(r.body.message,undefined)
 assert.equal(h.calls.provider,1);assert.equal(h.calls.rpc.at(-1).args.p_outcome,'provider_terminal_failure')
 for(const call of h.calls.rpc.filter(x=>x.name.includes('complete')||x.name.includes('finish'))) {
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.p_provider_receipt)),{request_id:'req_fixture',message_id:'msg_fixture',input_tokens:17,output_tokens:5})
 }
 assert.ok(!JSON.stringify(r.body).includes('req_fixture'));assert.ok(!JSON.stringify(r.body).includes('msg_fixture'))
})
test('lost terminal finish acknowledgement stays pending, concurrent completed finish returns only committed cache',async()=>{
 for(const finishResult of [null,{state:'completed',response:{message:'Committed winner',memory_saved:true}}]) {
  let statusReads=0
  const h=harness({durable:'on',configured:true,rpc:ledger({concierge_complete_v1:()=>({error:'offline'}),
   concierge_status_v1:()=>({data:++statusReads>1&&finishResult?finishResult:{state:'uncertain'}}),concierge_finish_v1:()=>{
   if(!finishResult)throw Error('lost acknowledgement');return {data:{state:'completed'}}
  }})})
  const r=await h.post({...V2,message:'Hello'});assert.equal(h.calls.provider,1)
  if(finishResult){assert.equal(r.status,200);assert.equal(r.body.message,'Committed winner')}
  else {assert.equal(r.status,503);assert.equal(r.body.code,'save_pending');assert.equal(r.body.terminal,undefined);assert.equal(r.body.message,undefined)}
 }
})
test('unknown provider failure does not manufacture a successful receipt or terminal result',async()=>{
 const h=harness({durable:'on',configured:true,providerError:true,rpc:ledger()})
 const r=await h.post({...V2,message:'Hello'})
 assert.equal(r.status,503);assert.equal(r.body.terminal,undefined)
 assert.equal(h.calls.rpc.at(-1).args.p_outcome,'uncertain');assert.equal(h.calls.rpc.at(-1).args.p_provider_receipt,null)
})

test('terminal provider completion errors still reconcile charged ledger after content or account deletion',async()=>{
 for(const error of ['gone','forbidden','invalid_request']) {
  const h=harness({durable:'on',configured:true,rpc:ledger({
   concierge_complete_v1:()=>({data:{error}}),concierge_status_v1:()=>({data:{error:'gone'}}),
   concierge_finish_v1:()=>({data:{state:'FAILED'}}),
  })})
  const r=await h.post({...V2,message:'Private message'})
  assert.equal(r.status,409);assert.equal(r.body.terminal,true);assert.equal(r.body.message,undefined)
  assert.equal(h.calls.rpc.filter(x=>x.name.includes('complete')).length,2)
  assert.equal(h.calls.rpc.at(-1).args.p_outcome,'provider_terminal_failure');assert.equal(h.calls.provider,1)
 }
})
test('finish COMPLETED without response must recheck authorized cache; missing cache acknowledgement remains pending',async()=>{
 for(const result of [null,{error:'gone'},{state:'completed'}]) {
  let statusReads=0
  const h=harness({durable:'on',configured:true,rpc:ledger({
   concierge_complete_v1:()=>({error:'offline'}),concierge_finish_v1:()=>({data:{state:'COMPLETED'}}),
   concierge_status_v1:()=>{if(++statusReads===1)return {data:{state:'UNCERTAIN'}};if(!result)throw Error('lost');return {data:result}},
  })})
  const r=await h.post({...V2,message:'Hello'})
  assert.equal(statusReads,2);assert.equal(h.calls.provider,1);assert.equal(r.body.message,undefined)
  assert.equal(r.body.terminal,undefined);assert.equal(r.body.admitted,undefined)
  if(result?.error)assert.equal(r.body.code,'gone');else assert.equal(r.body.code,'save_pending')
 }
})

test('only explicitly verified terminal redaction or expiry is forwarded as terminal',async()=>{
 for(const code of ['gone','expired','request_expired','forbidden']) for(const terminal of [true,false,undefined]) {
  const h=harness({durable:'on',statusRoute:true,rpc:ledger({concierge_status_v1:()=>({data:{error:code,terminal}})})})
  const r=await h.post(V2)
  assert.equal(r.body.terminal,terminal===true&&code!=='forbidden'?true:undefined)
  assert.equal(r.body.message,undefined);assert.equal(r.body.admitted,undefined);assert.equal(r.body.recovery_required,undefined)
  assert.equal(h.calls.provider,0)
 }
})
