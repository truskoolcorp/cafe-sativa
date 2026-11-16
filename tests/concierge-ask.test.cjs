// Synthetic hook-level client regression: no browser, network, microphone or model calls.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const assert = require('node:assert/strict'), { test } = require('node:test')
const ID = '12345678-1234-1234-1234-123456789abc'
const CONVERSATION = 'abcdef12-1234-1234-1234-123456789abc'
function client({ blockedStorage = false } = {}) {
  const hooks = [], effects = [], timers = new Map(), requests = [], items = new Map()
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
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
  const window = {}
  Object.defineProperty(window, 'localStorage', { get() { if (blockedStorage) throw Error('Storage denied'); return storage } })
  const globals = { Date, Map, window, crypto: { randomUUID: () => ID }, AbortController,
    console: { error() {} },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    fetch: (url, init) => new Promise((resolve, reject) => {
      requests.push({ url, init, resolve })
      init.signal?.addEventListener('abort', () => reject(Error('Aborted')))
    }),
  }
  function load(file) {
    const scope = { ...globals, exports: {}, require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'next/navigation') return { useSearchParams: () => ({ get: () => null }) }
      if (name === 'next/link' || name === 'next/image') return { __esModule: true, default: name }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) })
      if (name.endsWith('/supabase/client')) return { createClient: () => ({ auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: callback => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } } },
      } }) }
      if (name.endsWith('/ui/button')) return { Button: 'Button' }
      if (name.endsWith('/utils')) return { cn: (...args) => args.filter(Boolean).join(' ') }
      if (name.endsWith('/LiveVoiceConversation')) return { __esModule: true, default: 'LiveVoiceConversation' }
      if (name === '@/lib/concierge/browser-session') return load('lib/concierge/browser-session.ts')
      if (name === './request') return load('lib/concierge/request.ts')
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
    await Promise.resolve(); await Promise.resolve()
    render()
    while (effects.length) effects.shift()()
    render()
  }
  render()
  return {
    flush, requests, items,
    textarea: () => all(tree).find(node => node?.type === 'textarea'),
    text: () => all(tree).filter(node => typeof node === 'string').join(' '),
    type(text) { all(tree).find(node => node?.type === 'textarea').props.onChange({ target: { value: text } }); render() },
    send() { return all(tree).find(node => node?.type === 'Button' && node.props.size === 'lg').props.onClick() },
    switchHost(host) { all(tree).find(node => node?.type === 'button' && node.key === host).props.onClick() },
    changeUser(id) { authListener('SIGNED_IN', id ? { user: { id, email: `${id}@example.invalid` } } : null) },
    respond(status = 200, body = { message: 'Synthetic reply', conversation_id: CONVERSATION }) {
      requests.at(-1).resolve({ status, ok: status >= 200 && status < 300, json: async () => body })
    },
    expireRequest() { [...timers.values()].find(timer => timer.delay === 65000).fn() },
  }
}
test('blocked storage still sends one valid guest request; repeated clicks cannot duplicate it', async () => {
  const h = client({ blockedStorage: true })
  assert.equal(h.textarea().props.disabled, true)
  await h.flush()
  h.type('Hello')
  const first = h.send(), second = h.send()
  assert.equal(h.requests.length, 1)
  assert.equal(JSON.parse(h.requests[0].init.body).session_id, ID)
  h.respond()
  await Promise.all([first, second]); await h.flush()
  assert.match(h.text(), /Synthetic reply/)
  h.type('Again')
  const again = h.send()
  assert.equal(JSON.parse(h.requests[1].init.body).conversation_id, CONVERSATION)
  h.respond(); await again
})
test('failed send restores the draft and removes the unsent bubble; finite timeout warns of uncertain outcome', async () => {
  const h = client(); await h.flush(); h.type('Retry this question')
  const failure = h.send(); h.respond(503, { error: 'Temporarily unavailable' })
  await failure; await h.flush()
  assert.equal(h.textarea().props.value, 'Retry this question')
  assert.ok(!h.text().includes('Retry this question'))
  const timeout = h.send(); h.expireRequest(); await timeout; await h.flush()
  assert.match(h.text(), /may still have been processed/)
  assert.equal(h.textarea().props.value, 'Retry this question')
  assert.equal(h.textarea().props.disabled, false)
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
