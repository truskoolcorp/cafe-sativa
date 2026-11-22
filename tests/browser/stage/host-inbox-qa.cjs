const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { chromium } = require('playwright')
const { fixture } = require('../../stage-host-inbox.test.cjs')

const origin = 'https://stage-host-inbox.test'
const roomId = '5cafe000-0000-4000-8000-000000000001'
const umd = pkg => fs.readFileSync(require.resolve(pkg).replace(/index.js$/, `umd/${pkg}.production.min.js`), 'utf8')
const build = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
} }).outputText
const script = `${umd('react')}\n${umd('react-dom')}\n
const modules = {}, sources = {
  Lounge: (exports, require) => { ${build('app/lounge/LoungeRoom.tsx')} },
  '@/lib/lounge-speaker': (exports, require) => { ${build('lib/lounge-speaker.ts')} },
  './lounge-speaker': (exports, require) => { ${build('lib/lounge-speaker.ts')} },
  '@/lib/lounge-mentions': (exports, require) => { ${build('lib/lounge-mentions.ts')} },
  '@/lib/lounge-message-state': (exports, require) => { ${build('lib/lounge-message-state.ts')} },
};
function require(name) {
  if (name === 'react') return React;
  if (name === 'lucide-react') return new Proxy({}, {get: () => () => null});
  if (name === 'next/link') return () => null;
  if (name === '@/lib/utils') return {cn: (...args) => args.filter(x=> typeof x==='string').join(' ')};
  if (name === '@/components/ui/button') return {Button: ({size, variant, asChild, ...rest}) => React.createElement('button', rest)};
  if (name === '@/lib/supabase/client') return {createClient: () => ({
    channel: () => ({on(){return this}, subscribe(){return this}}), removeChannel: () => {},
  })};
  if (!modules[name]) { modules[name] = {}; sources[name](modules[name], require); }
  return modules[name];
}
window.mount = props => ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(require('Lounge').LoungeRoom, props));`

async function main() {
  const browser = await chromium.launch({ headless: true })
  const harness = fixture()
  harness.env.STAGE_LAVICHE_MODERATOR_ENABLED = 'true'
  harness.setServiceGrant()
  const unexpected = [], guestErrors = []
  let queued = Promise.resolve()
  try {
    async function open(actor, moderator = false) {
      const page = await browser.newPage()
      page.on('pageerror', error => guestErrors.push(error.message))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin) { unexpected.push(request.url()); return route.abort() }
        if (url.pathname === '/') {
          const props = { roomId, userId: actor, displayName: 'Fixture guest', tier: 'explorer', isStaff: false,
            minPostTier: 'explorer', initialMessages: [], conciergeDrafts: true, privateRoom: true,
            rehearsalDraftModerator: moderator, stageHostInbox: true }
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>' +
            `<script>window.mount(${JSON.stringify(props)})</script>` })
        }
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script })
        if (url.pathname === '/api/lounge/stage-questions') {
          const response = queued.then(async () => {
            harness.session.id = actor
            harness.session.moderator = moderator
            return harness.call(request.method(), request.postDataJSON() || {})
          })
          queued = response.catch(() => {})
          const { status, body } = await response
          return route.fulfill({ status, json: body })
        }
        unexpected.push(request.url())
        return route.abort()
      })
      await page.goto(origin)
      return page
    }
    const a = await open('guest-a'), b = await open('guest-b'), mod = await open('fixture-moderator', true)
    async function ask(page, host, question) {
      await page.getByRole('button', { name: 'Ask a host', exact: true }).click()
      await page.getByRole('combobox').selectOption(host.toLowerCase())
      await page.getByRole('textbox', { name: `Question for ${host}`, exact: true }).fill(question)
      await page.getByRole('button', { name: 'Send question', exact: true }).click()
    }
    await ask(a, 'Ahnika', 'What time is kickoff?')
    await a.getByText(/Ahnika: The show starts.*2:03 PM Central/).waitFor()
    await ask(b, 'Laviche', 'What time is kickoff?')
    await b.getByText(/Laviche: From the floor:.*2:03 PM Central/).waitFor()
    assert.equal(await b.getByText('To Ahnika: What time is kickoff?', { exact: true }).count(), 0)
    await ask(a, 'Laviche', 'Synthetic fixture question requiring moderator review.')
    await a.getByText('Awaiting moderator review.', { exact: true }).waitFor()
    const moderator = mod.getByText('Synthetic fixture question requiring moderator review.', { exact: true })
    await mod.getByText('Private Stage Q&A', { exact: true }).click()
    await moderator.waitFor()
    assert.equal(await b.getByText(/Synthetic fixture question requiring moderator review/).count(), 0)
    await mod.getByRole('button', { name: 'Review and reply', exact: true }).click()
    await mod.getByRole('textbox', { name: 'Private moderator reply', exact: true }).fill('Reviewed privately.')
    await mod.getByRole('button', { name: 'Send private reply', exact: true }).click()
    await a.getByText('Moderator: Reviewed privately.', { exact: true }).waitFor()
    assert.equal(await b.getByText('Moderator: Reviewed privately.', { exact: true }).count(), 0)
    assert.equal(await a.locator('audio').count() + await b.locator('audio').count(), 0)
    assert.deepEqual(unexpected, [])
    assert.deepEqual(guestErrors, [])
    console.log('Private Stage browser fixture: both text hosts and private moderator replies passed.')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
