// Synthetic hook-level client regression: no browser, network, microphone or model calls.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const assert = require('node:assert/strict'), { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
const CONVERSATION = 'abcdef12-1234-1234-1234-123456789abc'
function client({ blockedStorage = false, items = new Map(), durableEnabled = true, textAdmissionsEnabled = true, payloadVersion = 2, capabilityUnavailable = false, createId = () => ID, beforeSet = () => {}, authError = null, authReject = false } = {}) {
  const hooks = [], effects = [], timers = new Map(), requests = [], capabilities = []
  let index = 0, tree, authListener, timerId = 0
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const react = {
    Suspense: 'Suspense',
    useState(initial) {
      const at = index++
      if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial
      return [hooks[at], value => { hooks[at] = typeof value === 'function' ? value(hooks[at]) : value }]
    },
    useRef(initial) { const at = index++; return hooks[at] ?? (hooks[at] = { current: initial }) },
    useEffect(effect, deps) {
      const at = index++, prior = hooks[at]
      if (!prior || !deps || deps.some((value, i) => value !== prior.deps[i])) {
        hooks[at] = { deps, cleanup: prior?.cleanup }
        effects.push(() => { hooks[at].cleanup?.(); hooks[at].cleanup = effect() })
      }
    },
  }
  const storage = { get length() { return items.size }, key: index => [...items.keys()][index] ?? null, getItem: key => items.get(key) ?? null, setItem: (key, value) => { beforeSet(key, value); items.set(key, value) }, removeItem: key => items.delete(key) }
  const window = {}
  Object.defineProperty(window, 'localStorage', { get() { if (blockedStorage) throw Error('Storage denied'); return storage } })
  const globals = { Date, Map, window, crypto: { randomUUID: createId }, AbortController,
    console: { error() {} },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    fetch: (url, init) => {
      if(init.method === 'GET') {
        capabilities.push({url,init})
        return capabilityUnavailable ? Promise.reject(Error('Unavailable')) : Promise.resolve({ok:true,json: async()=>({durable_enabled:durableEnabled,text_admissions_enabled:textAdmissionsEnabled,durable_payload_version:payloadVersion})})
      }
      return new Promise((resolve, reject) => {
      requests.push({ url, init, resolve })
      init.signal?.addEventListener('abort', () => reject(Error('Aborted')))
    }) },
  }
  function load(file) {
    const scope = { ...globals, exports: {}, require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'next/navigation') return { useSearchParams: () => ({ get: () => null }) }
      if (name === 'next/link' || name === 'next/image') return { __esModule: true, default: name }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) })
      if (name.endsWith('/supabase/client')) return { createClient: () => ({ auth: {
        getUser: async () => { if(authReject) throw Object.assign(Error('Auth network failure'), typeof authReject === 'object' ? authReject : {}); return { data: { user: null }, error: authError } },
        onAuthStateChange: callback => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } } },
      } }) }
      if (name.endsWith('/ui/button')) return { Button: 'Button' }
      if (name.endsWith('/utils')) return { cn: (...args) => args.filter(Boolean).join(' ') }
      if (name.endsWith('/LiveVoiceConversation')) return { __esModule: true, default: 'LiveVoiceConversation' }
      if (name === '@/lib/concierge/browser-requests') return load('lib/concierge/browser-requests.ts')
      if (name === '@/lib/concierge/browser-session') return load('lib/concierge/browser-session.ts')
      if (name === '@/lib/concierge/request' || name === './request') return load('lib/concierge/request.ts')
      throw Error(name)
    } }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, scope)
    return scope.exports
  }
  const page = load('app/ask/page.tsx').default()
  const component = page.props.children.type
  const all = (node) => node == null ? [] : Array.isArray(node) ? node.flatMap(all)
    : typeof node === 'object' ? [node, ...all(node.props.children)] : [node]
  const render = () => { index = 0; tree = component() }
  const flush = async () => {
    render()
    while (effects.length) effects.shift()()
    for(let i=0;i<12;i++) await Promise.resolve()
    render()
    while (effects.length) effects.shift()()
    render()
  }
  render()
  return {
    flush, requests, items, capabilities,
    liveVoice: () => all(tree).find(node => node?.type === 'LiveVoiceConversation'),
    textarea: () => all(tree).find(node => node?.type === 'textarea'),
    text: () => all(tree).filter(node => typeof node === 'string').join(' '),
    type(text) { all(tree).find(node => node?.type === 'textarea').props.onChange({ target: { value: text } }); render() },
    send() { return all(tree).find(node => node?.type === 'Button' && node.props.size === 'lg').props.onClick() },
    recover() { return all(tree).find(node => node?.type === 'Button' && node.props.children === 'Check original message').props.onClick() },
    switchHost(host) { all(tree).find(node => node?.type === 'button' && node.key === host).props.onClick() },
    changeUser(id) { authListener('SIGNED_IN', id ? { user: { id, email: `${id}@example.invalid` } } : null) },
    respond(status = 200, body = { message: 'Synthetic reply', conversation_id: CONVERSATION }) {
      requests.at(-1).resolve({ status, ok: status >= 200 && status < 300, json: async () => body })
    },
    expireRequest() { [...timers.values()].find(timer => timer.delay === 65000).fn() },
  }
}
test('blocked storage fails closed before any send', async () => {
  const h = client({ blockedStorage: true }); await h.flush(); h.type('Hello')
  await h.send()
  assert.equal(h.requests.length, 0)
  assert.equal(h.textarea().props.disabled, true)
  assert.match(h.text(), /storage is unavailable/)
})
test('timeout retains exact payload across reload and recovery never uses edited text', async () => {
  const h = client(); await h.flush(); h.type('Original question')
  const send = h.send(); const body = h.requests[0].init.body
  assert.match(JSON.parse(body).request_id, /^[a-f0-9]{8}-[a-f0-9]{4}-7/); assert.equal(typeof JSON.parse(body).issued_at, 'number')
  h.expireRequest(); await send; await h.flush()
  assert.equal(h.textarea().props.disabled, true)
  assert.match(h.text(), /may still have been processed/)
  const reload = client({ items: h.items }); await reload.flush()
  assert.equal(reload.requests.length, 0)
  reload.type('Edited draft'); await reload.send()
  assert.equal(reload.requests.length, 0)
  const recovery = reload.recover()
  assert.equal(reload.requests[0].url, '/api/concierge/status')
  assert.equal(reload.requests[0].init.body, body)
  reload.respond(); await recovery; await reload.flush()
  assert.match(reload.text(), /Synthetic reply/)
  assert.equal(reload.textarea().props.disabled, false)
})
test('expired reservation replays the same ID and body only after explicit recovery grant', async () => {
  const h = client(); await h.flush(); h.type('Original')
  const send = h.send(); const original = h.requests[0].init.body
  h.respond(202, { code: 'request_pending' }); await send; await h.flush()
  const recovery = h.recover()
  h.respond(202, { recovery_required: true });
  for(let i=0;i<8;i++) await Promise.resolve()
  assert.equal(h.requests.at(-1).url, '/api/concierge')
  assert.equal(h.requests.at(-1).init.body, original)
  h.respond(503, { code: 'save_pending' }); await recovery; await h.flush()
  assert.equal(h.textarea().props.disabled, true)
  assert.equal(h.items.size, 2)
})
test('disabled, missing, and unavailable recovery never replay or release original request', async () => {
  for (const [status, code] of [[503,'durable_disabled'], [404,'request_missing'],[503,'status_unavailable']]) {
    const h = client(); await h.flush(); h.type('Unknown')
    const send = h.send(); h.expireRequest(); await send; await h.flush()
    const recovery = h.recover(); h.respond(status,{code}); await recovery; await h.flush()
    assert.equal(h.requests.length,2)
    assert.equal(h.requests[1].url,'/api/concierge/status')
    assert.equal(h.textarea().props.disabled,true)
  }
})
test('scope change prevents recovery replay and returns to retained original request', async () => {
  const h = client(); await h.flush(); h.type('Original')
  const send=h.send(); h.respond(202,{}); await send; await h.flush()
  const recovery=h.recover(); h.switchHost('ginger'); await h.flush()
  h.respond(202,{recovery_required:true}); await recovery; await h.flush()
  assert.equal(h.requests.length,2)
  assert.equal(h.textarea().props.disabled,false)
  h.switchHost('laviche'); await h.flush()
  assert.equal(h.textarea().props.disabled,true)
  h.changeUser('other-user'); await h.flush()
  assert.equal(h.textarea().props.disabled,false)
  assert.ok(!h.text().includes('Original'))
  h.changeUser(null); await h.flush()
  assert.equal(h.textarea().props.disabled,true)
})
test('known terminal or pre-admission outcomes release the composer', async () => {
  for(const [status, body] of [[409,{terminal:true,code:'request_terminal'}],[503,{admitted:false,code:'capacity_busy'}]]) {
    const h=client(); await h.flush(); h.type('Question')
    const send=h.send(); h.respond(status,body); await send; await h.flush()
    assert.equal(h.textarea().props.disabled,false)
    assert.equal(h.textarea().props.value,'Question')
  }
})
test('host changes and account changes discard stale replies and never reuse another identity conversation', async () => {
  const h = client(); await h.flush(); h.type('First host question')
  const request = h.send(); h.switchHost('ginger'); await h.flush()
  h.respond(); await request; await h.flush()
  assert.ok(!h.text().includes('Synthetic reply'))
  h.changeUser('user-a'); await h.flush(); h.type('Member question')
  const member = h.send()
  assert.equal(JSON.parse(h.requests.at(-1).init.body).conversation_id, null)
  h.respond(); await member; await h.flush()
  assert.equal(h.items.get('cafe-sativa:conv-id:user:user-a:ginger'), CONVERSATION)
  h.changeUser('user-b'); await h.flush(); h.type('Another member')
  const another = h.send()
  assert.equal(JSON.parse(h.requests.at(-1).init.body).conversation_id, null)
  h.respond(); await another
})
test('persistence warning is displayed alongside the delivered answer without retrying', async () => {
  const h = client(); await h.flush(); h.type('Hello')
  const send = h.send(); h.respond(200, { message: 'Delivered', conversation_id: CONVERSATION,
    memory_saved: false, warning: 'This turn could not be saved.' })
  await send; await h.flush()
  assert.match(h.text(), /Delivered/)
  assert.match(h.text(), /could not be saved/)
  assert.equal(h.requests.length, 1)
})
test('origin 403 preserves conversation; only a conversation-specific 403 clears it', async () => {
  const h = client(); await h.flush(); h.type('Start')
  const start = h.send(); h.respond(); await start; await h.flush()
  h.type('Continue')
  const blocked = h.send()
  h.respond(403, { code: 'origin_not_allowed', error: 'This chat origin is not allowed.' })
  await blocked; await h.flush()
  assert.match(h.text(), /origin is not allowed/)
  assert.ok(!h.text().includes('That conversation has ended'))
  assert.equal(h.textarea().props.value, 'Continue')
  assert.equal(h.items.get(`cafe-sativa:conv-id:guest:${ID}:laviche`), CONVERSATION)
  const retry = h.send()
  assert.equal(JSON.parse(h.requests.at(-1).init.body).conversation_id, CONVERSATION)
  h.respond(403, { code: 'conversation_unavailable', error: 'Conversation unavailable.' })
  await retry; await h.flush()
  assert.match(h.text(), /That conversation has ended/)
  assert.equal(h.items.has(`cafe-sativa:conv-id:guest:${ID}:laviche`), false)
  const fresh = h.send()
  assert.equal(JSON.parse(h.requests.at(-1).init.body).conversation_id, null)
  h.respond(); await fresh
})
test('unrecognized 503 and repeated send clicks retain a single request', async () => {
  const h=client(); await h.flush(); h.type('Question')
  const one=h.send(), two=h.send()
  assert.equal(h.requests.length,1)
  assert.ok(h.items.has(`cafe-sativa:pending-chat:guest:${ID}:laviche:${JSON.parse(h.requests[0].init.body).request_id}`))
  h.respond(503,{error:'Unknown outcome'}); await Promise.all([one,two]); await h.flush()
  await h.send()
  assert.equal(h.requests.length,1)
  assert.equal(h.textarea().props.disabled,true)
})
test('malformed retained payload blocks rather than silently minting another ID', async () => {
  const items=new Map([[`cafe-sativa:session-id`,ID],[`cafe-sativa:pending-chat:guest:${ID}:laviche`,'invalid json']])
  const h=client({items}); await h.flush(); h.type('Question'); await h.send()
  assert.equal(h.requests.length,0)
  assert.equal(h.textarea().props.disabled,true)
})
test('status authorization rejection does not discard a potentially completed original', async () => {
  const h=client(); await h.flush(); h.type('Question')
  const send=h.send(); h.respond(202,{}); await send; await h.flush()
  const check=h.recover(); h.respond(403,{code:'conversation_unavailable'}); await check; await h.flush()
  assert.equal(h.textarea().props.disabled,true)
})
test('authoritative OFF preserves page-local storage fallback and legacy timeout draft', async () => {
  const h=client({durableEnabled:false,blockedStorage:true}); await h.flush()
  assert.equal(h.capabilities[0].url,'/api/concierge/status')
  assert.equal(h.capabilities[0].init.cache,'no-store')
  assert.equal(h.textarea().props.disabled,false)
  h.type('Legacy message'); const send=h.send()
  assert.equal(h.requests.length,1)
  assert.equal(h.requests[0].init.headers['X-Concierge-Durable'],'0')
  assert.equal(JSON.parse(h.requests[0].init.body).request_id,undefined)
  h.respond(); await send; await h.flush()
  assert.match(h.text(),/Synthetic reply/)
  h.type('Legacy timeout'); const timeout=h.send(); h.expireRequest(); await timeout; await h.flush()
  assert.equal(h.textarea().props.value,'Legacy timeout')
  assert.equal(h.textarea().props.disabled,false)
  assert.match(h.text(),/may still have been processed/)
  assert.ok(!h.text().includes('Check original message'))
})
test('capability unavailable prevents both durable and legacy sending', async () => {
  const h=client({capabilityUnavailable:true}); await h.flush(); h.type('Question'); await h.send()
  assert.equal(h.requests.length,0)
  assert.equal(h.textarea().props.disabled,true)
  assert.match(h.text(),/availability could not be checked/)
})
test('OFF does not discard a retained request or replay status404', async () => {
  const on=client(); await on.flush(); on.type('Retained question')
  const original=on.send(); on.expireRequest(); await original; await on.flush()
  const off=client({durableEnabled:false,items:on.items}); await off.flush()
  assert.equal(off.textarea().props.disabled,true)
  const check=off.recover(); off.respond(404,{code:'request_missing'}); await check; await off.flush()
  assert.equal(off.requests.length,1)
  assert.equal(off.requests[0].init.headers['X-Concierge-Durable'],'1')
  assert.equal(off.textarea().props.disabled,true)
})
test('ON missing-request recovery grant replays identical ID and body with durable fence', async () => {
  const h=client(); await h.flush(); h.type('Missing question')
  const first=h.send(); const original=h.requests[0].init.body
  assert.equal(h.requests[0].init.headers['X-Concierge-Durable'],'1')
  h.expireRequest(); await first; await h.flush()
  const check=h.recover(); h.respond(202,{state:'MISSING',recovery_required:true})
  for(let i=0;i<12;i++) await Promise.resolve()
  assert.equal(h.requests.length,3)
  assert.equal(h.requests[2].url,'/api/concierge')
  assert.equal(h.requests[2].init.body,original)
  assert.equal(h.requests[2].init.headers['X-Concierge-Durable'],'1')
  h.respond(); await check; await h.flush()
  assert.equal(h.textarea().props.disabled,false)
})
test('ON to OFF fence retains pending; OFF to ON fence safely restores legacy draft', async () => {
  const on=client(); await on.flush(); on.type('Durable question')
  const first=on.send(); on.respond(503,{code:'durable_disabled'}); await first; await on.flush()
  assert.equal(on.textarea().props.disabled,true)
  assert.match(on.text(),/will not be resent/)
  const off=client({durableEnabled:false}); await off.flush(); off.type('Legacy question')
  const second=off.send(); off.respond(503,{code:'mode_changed',error:'Reload to check chat mode.'}); await second; await off.flush()
  assert.equal(off.textarea().props.value,'Legacy question')
  assert.equal(off.items.size,1)
  assert.match(off.text(),/Reload this page before sending again/)
})
test('concurrent tabs retain both immutable request IDs and reload recovers each sequentially', async () => {
  const secondID='22345678-1234-1234-1234-223456789abc'
  const items=new Map([['cafe-sativa:session-id',ID]])
  let second, interleave=true
  const b=client({items,createId:()=>secondID}); await b.flush(); b.type('Second tab')
  const a=client({items,beforeSet:key=>{
    if(interleave && key.includes('pending-chat')) { interleave=false; second=b.send() }
  }})
  await a.flush(); a.type('First tab'); const first=a.send()
  assert.equal(a.requests.length,1); assert.equal(b.requests.length,1)
  assert.equal([...items.keys()].filter(key=>key.includes('pending-chat')).length,2)
  a.expireRequest(); b.expireRequest(); await Promise.all([first,second])
  const reload=client({items}); await reload.flush()
  const check1=reload.recover(); assert.equal(reload.requests[0].init.body,a.requests[0].init.body)
  reload.respond(); await check1; await reload.flush()
  assert.equal(reload.textarea().props.disabled,true)
  assert.match(reload.text(),/Second tab/)
  assert.equal([...items.keys()].filter(key=>key.includes('pending-chat')).length,1)
  const check2=reload.recover(); assert.equal(reload.requests[1].init.body,b.requests[0].init.body)
  reload.respond(); await check2; await reload.flush()
  assert.equal(reload.textarea().props.disabled,false)
  assert.equal([...items.keys()].filter(key=>key.includes('pending-chat')).length,0)
})
test('requester hint remains original identity during delayed authentication mismatch', async () => {
  const h=client(); await h.flush(); h.changeUser('user-a'); await h.flush(); h.type('Account A question')
  const send=h.send()
  assert.equal(h.requests[0].init.headers['X-Concierge-Requester'],'user:user-a')
  // The browser cookie may already represent B while its auth callback is delayed.
  h.respond(409,{code:'requester_changed',error:'Identity changed.'}); await send; await h.flush()
  assert.equal(h.textarea().props.disabled,true)
  const check=h.recover()
  assert.equal(h.requests[1].init.headers['X-Concierge-Requester'],'user:user-a')
  h.respond(202,{recovery_required:true}); for(let i=0;i<12;i++) await Promise.resolve()
  assert.equal(h.requests[2].init.headers['X-Concierge-Requester'],'user:user-a')
  h.respond(409,{code:'requester_changed'}); await check; await h.flush()
  h.changeUser('user-b'); await h.flush()
  assert.equal(h.textarea().props.disabled,false)
  assert.ok(!h.text().includes('Account A question'))
  h.changeUser('user-a'); await h.flush()
  assert.equal(h.textarea().props.disabled,true)
})
test('first-use guest session race retains both sessions and never crosses into signed-in recovery', async () => {
  const sessionB='22345678-1234-1234-1234-123456789abc'
  const items=new Map()
  // Tab A initialized before tab B's concurrent last session write wins.
  const a=client({items}); await a.flush()
  items.delete('cafe-sativa:session-id')
  const b=client({items,createId:()=>sessionB}); await b.flush()
  assert.equal(items.get('cafe-sativa:session-id'),sessionB)
  // Both tabs have passed startup with no pending records. Interleave durable writes.
  a.type('Session A'); const first=a.send(); a.expireRequest(); await first
  // Existing unresolved guest work in another session is discovered on send.
  b.type('Session B'); await b.send(); await b.flush()
  assert.equal(b.requests.length,0)
  assert.equal(b.textarea().props.disabled,true)
  const check=b.recover()
  assert.equal(b.requests[0].init.headers['X-Concierge-Requester'],`guest:${ID}`)
  assert.equal(JSON.parse(b.requests[0].init.body).session_id,ID)
  b.changeUser('member'); await b.flush()
  b.respond(202,{recovery_required:true}); await check; await b.flush()
  assert.equal(b.requests.length,1)
  assert.ok(!b.text().includes('Session A'))
  b.changeUser(null); await b.flush()
  assert.equal(b.textarea().props.disabled,true)
  const retry=b.recover(); b.respond(); await retry; await b.flush()
  b.type('New session B question'); const fresh=b.send()
  assert.equal(JSON.parse(b.requests.at(-1).init.body).session_id,sessionB)
  assert.equal(JSON.parse(b.requests.at(-1).init.body).conversation_id,null)
  b.respond(); await fresh
})
test('multiple guest sessions recover sequentially after reload with original session fences', async () => {
  const other='22345678-1234-1234-1234-123456789abc'
  const items=new Map([['cafe-sativa:session-id',other]])
  for (const id of [ID,other]) {
    const request={requester:`guest:${id}`,host:'laviche',body:JSON.stringify({request_id:id,session_id:id,host:'laviche',surface:'web-chat',message:`Guest ${id}`,conversation_id:null})}
    items.set(`cafe-sativa:pending-chat:guest:${id}:laviche:${id}`,JSON.stringify(request))
  }
  const h=client({items}); await h.flush()
  for(const id of [ID,other]) {
    const check=h.recover()
    assert.equal(h.requests.at(-1).init.headers['X-Concierge-Requester'],`guest:${id}`)
    assert.equal(JSON.parse(h.requests.at(-1).init.body).session_id,id)
    h.respond(); await check; await h.flush()
  }
  assert.equal(h.textarea().props.disabled,false)
})
test('malformed guest scope/body agreement blocks sending rather than hiding another guest record', async () => {
  const other='22345678-1234-1234-1234-123456789abc'
  const record={requester:`guest:${ID}`,host:'laviche',body:JSON.stringify({request_id:ID,session_id:other,host:'laviche',surface:'web-chat',message:'Invalid'})}
  const items=new Map([['cafe-sativa:session-id',other],[`cafe-sativa:pending-chat:guest:${ID}:laviche:${ID}`,JSON.stringify(record)]])
  const h=client({items}); await h.flush(); h.type('New'); await h.send()
  assert.equal(h.requests.length,0)
  assert.equal(h.textarea().props.disabled,true)
})
test('storage scan overflow and oversized retained records fail closed even OFF', async () => {
  const overflow=new Map(Array.from({length:4097},(_,i)=>[`unrelated:${i}`,'x']))
  const oversized=new Map([['cafe-sativa:session-id',ID],[`cafe-sativa:pending-chat:guest:${ID}:laviche:${ID}`,'x'.repeat(32769)]])
  for(const items of [overflow,oversized]) {
    const h=client({items,durableEnabled:false}); await h.flush(); h.type('Question'); await h.send()
    assert.equal(h.requests.length,0)
    assert.equal(h.textarea().props.disabled,true)
  }
})
test('unknown auth failures hide guest pending data and block sending until a valid auth callback', async () => {
  const record={requester:`guest:${ID}`,host:'laviche',body:JSON.stringify({request_id:ID,session_id:ID,host:'laviche',surface:'web-chat',message:'Private retained guest question'})}
  for (const auth of [{authError:{name:'AuthApiError',message:'Unavailable'}},{authReject:true}]) {
    const items=new Map([['cafe-sativa:session-id',ID],[`cafe-sativa:pending-chat:guest:${ID}:laviche:${ID}`,JSON.stringify(record)]])
    const h=client({items,...auth}); await h.flush(); h.type('New message'); await h.send()
    assert.equal(h.requests.length,0)
    assert.equal(h.textarea().props.disabled,true)
    assert.ok(!h.text().includes('Private retained guest question'))
    assert.ok(!h.text().includes('Check original message'))
    assert.match(h.text(),/sign-in status could not be checked/)
    h.changeUser(null); await h.flush()
    assert.match(h.text(),/Private retained guest question/)
    const check=h.recover(); h.respond(); await check; await h.flush()
    assert.equal(h.textarea().props.disabled,false)
  }
})
test('AuthSessionMissingError establishes a valid anonymous identity for pending recovery', async () => {
  const record={requester:`guest:${ID}`,host:'laviche',body:JSON.stringify({request_id:ID,session_id:ID,host:'laviche',surface:'web-chat',message:'Anonymous retained question'})}
  const items=new Map([['cafe-sativa:session-id',ID],[`cafe-sativa:pending-chat:guest:${ID}:laviche:${ID}`,JSON.stringify(record)]])
  for(const auth of [{authError:{name:'AuthSessionMissingError'}},{authReject:{name:'AuthSessionMissingError'}}]) {
    const h=client({items:new Map(items),...auth}); await h.flush()
    assert.match(h.text(),/Anonymous retained question/)
    const check=h.recover(); h.respond(); await check; await h.flush()
    assert.equal(h.textarea().props.disabled,false)
  }
})

test('text maintenance blocks new sends but keeps retained status recovery and live voice UI available',async()=>{
 const first=client();await first.flush();first.type('Original before maintenance')
 const sending=first.send();const body=first.requests[0].init.body;first.expireRequest();await sending
 const paused=client({items:first.items,textAdmissionsEnabled:false});await paused.flush()
 assert.equal(paused.textarea().props.disabled,true);assert.match(paused.text(),/paused for maintenance/)
 paused.type('New');await paused.send();assert.equal(paused.requests.length,0)
 const recover=paused.recover();assert.equal(paused.requests[0].url,'/api/concierge/status');assert.equal(paused.requests[0].init.body,body)
 paused.respond();await recover;await paused.flush();assert.equal(paused.textarea().props.disabled,true)
 assert.match(paused.text(),/Synthetic reply/);assert.ok(paused.liveVoice())
})
test('maintenance racing with a send retains exact issuance and never assumes this ID was not admitted',async()=>{
 const h=client();await h.flush();h.type('Race')
 const send=h.send();const body=h.requests[0].init.body
 h.respond(503,{code:'text_maintenance'});await send;await h.flush()
 assert.equal(h.textarea().props.disabled,true);assert.match(h.text(),/original message is retained/)
 const check=h.recover();assert.equal(h.requests[1].init.body,body)
 h.respond(202,{state:'RESERVED',recovery_required:false});await check;await h.flush()
 assert.equal(h.requests.length,2);assert.equal(h.textarea().props.disabled,true)
})
test('expired replay and missing v1 remain retained without refreshing identity or issuance',async()=>{
 for(const old of [false,true]) {
  let items,original
  if(old) {
   original=JSON.stringify({request_id:ID,session_id:ID,host:'laviche',surface:'web-chat',message:'Old unknown'})
   items=new Map([['cafe-sativa:session-id',ID],[`cafe-sativa:pending-chat:guest:${ID}:laviche:${ID}`,JSON.stringify({requester:`guest:${ID}`,host:'laviche',body:original})]])
  } else {
   const first=client();await first.flush();first.type('Unknown');const sending=first.send()
   original=first.requests[0].init.body;first.expireRequest();await sending;items=first.items
  }
  const h=client({items});await h.flush();const check=h.recover()
  assert.equal(h.requests[0].init.body,original)
  h.respond(409,{code:'request_expired'});await check;await h.flush()
  assert.equal(h.requests.length,1);assert.equal(h.textarea().props.disabled,true);assert.match(h.text(),/too old to replay safely/)
  assert.ok([...h.items.values()].some(value=>value.includes(JSON.parse(original).request_id)))
 }
})
test('new durable client requires the v2 capability and does not send to an older worker',async()=>{
 for(const payloadVersion of [undefined,1,3]) {
  // Explicit null represents the absent legacy capability in this mock.
  const h=client({payloadVersion:payloadVersion??null});await h.flush();h.type('Question');await h.send()
  assert.equal(h.requests.length,0);assert.equal(h.textarea().props.disabled,true)
 }
})

test('unresolved redaction remains retained; positively terminal redaction or expiry releases only after explicit status',async()=>{
 for(const code of ['gone','request_expired']) for(const terminal of [false,true]) {
  const h=client();await h.flush();h.type('Original')
  const send=h.send();h.expireRequest();await send;await h.flush()
  const check=h.recover();h.respond(409,{code,...(terminal?{terminal:true}:{})});await check;await h.flush()
  assert.equal(h.requests.length,2);assert.equal(h.textarea().props.disabled,!terminal)
  assert.equal([...h.items.keys()].filter(key=>key.includes('pending-chat')).length,terminal?0:1)
  if(terminal){assert.match(h.text(),/saved reply is no longer available/);assert.equal(h.textarea().props.value,'Original')}
 }
})

test('missing-key recovery transient denial retains exact original until delayed completion is recovered',async()=>{
 for(const [status,data] of [
  [503,{code:'capacity_busy',admitted:false}],
  [429,{code:'quota_exceeded',admitted:false,rate_limited:true}],
  [503,{code:'policy_unavailable',admitted:false}],
  [403,{code:'conversation_unavailable',admitted:false}],
  [400,{code:'invalid_request',admitted:false}],
 ]) {
  const original=client();await original.flush();original.type('Delayed original')
  const send=original.send();const body=original.requests[0].init.body
  original.expireRequest();await send;await original.flush()
  const h=client({items:original.items});await h.flush()
  const check=h.recover();assert.equal(h.requests[0].init.body,body)
  h.respond(202,{state:'MISSING',recovery_required:true})
  for(let i=0;i<12;i++)await Promise.resolve()
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].url,'/api/concierge')
  assert.equal(h.requests[1].init.body,body)
  h.respond(status,data);await check;await h.flush()
  assert.equal(h.textarea().props.disabled,true)
  const retained=[...h.items.entries()].filter(([key])=>key.includes('pending-chat'))
  assert.equal(retained.length,1);assert.equal(JSON.parse(retained[0][1]).body,body)
  h.type('Would duplicate the original');await h.send();assert.equal(h.requests.length,2)
  // The delayed original can still admit later because the denial made no tombstone.
  // A reload must recover that same key, never create a second request identity.
  const reload=client({items:h.items});await reload.flush()
  const completion=reload.recover();assert.equal(reload.requests[0].url,'/api/concierge/status')
  assert.equal(reload.requests[0].init.body,body)
  reload.respond(200,{message:'Delayed original committed',conversation_id:CONVERSATION,memory_saved:true})
  await completion;await reload.flush()
  assert.equal(reload.requests.length,1);assert.equal(reload.textarea().props.disabled,false)
  assert.match(reload.text(),/Delayed original committed/)
  assert.equal([...reload.items.keys()].filter(key=>key.includes('pending-chat')).length,0)
 }
})
test('status non-admission marker alone cannot release an unresolved original',async()=>{
 const h=client();await h.flush();h.type('Original')
 const send=h.send();h.expireRequest();await send;await h.flush()
 const check=h.recover();h.respond(503,{code:'policy_unavailable',admitted:false});await check;await h.flush()
 assert.equal(h.textarea().props.disabled,true)
 assert.equal([...h.items.keys()].filter(key=>key.includes('pending-chat')).length,1)
 assert.equal(h.requests.length,2)
})
test('verified terminal outcome after same-ID recovery POST safely releases the original',async()=>{
 const h=client();await h.flush();h.type('Original')
 const send=h.send();h.expireRequest();await send;await h.flush()
 const check=h.recover();h.respond(202,{state:'MISSING',recovery_required:true})
 for(let i=0;i<12;i++)await Promise.resolve()
 h.respond(409,{code:'request_expired',terminal:true});await check;await h.flush()
 assert.equal(h.requests.length,3);assert.equal(h.textarea().props.disabled,false)
 assert.equal([...h.items.keys()].filter(key=>key.includes('pending-chat')).length,0)
})
