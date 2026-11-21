const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { chromium } = require('playwright')

const umd = (pkg) => fs.readFileSync(require.resolve(pkg).replace(/index.js$/, `umd/${pkg}.production.min.js`), 'utf8')
const build = (path) => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText
const script = `${umd('react')}\n${umd('react-dom')}\n
const modules = {};
const sources = {
  "@/lib/events/stage-lobby": function(exports, require) { ${build('lib/events/stage-lobby.ts')} },
  lobby: function(exports, require) { ${build('components/events/StageLobby.tsx')} },
};
function require(name) {
  if (name === "react") return React;
  if (!modules[name]) {
    modules[name] = {};
    sources[name](modules[name], require);
  }
  return modules[name];
}
window.mountLobby = props => ReactDOM.createRoot(document.getElementById("root"))
  .render(React.createElement(require("lobby").default, props));`
const html = '<!doctype html><meta charset="utf-8"><title>Lobby fixture</title><div id="root"></div>'
const asset = (type, file) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`
const eventPage = fs.readFileSync('app/events/ahnika-already-gone/page.tsx', 'utf8')
for (const ext of ['webp', 'webm', 'mp4']) {
  assert.ok(eventPage.includes(`/rooms/stage-beach-terrace-v2.${ext}`))
}
const poster = asset('image/webp', 'public/rooms/stage-beach-terrace-v2.webp')
const loop = {
  webm: asset('video/webm', 'public/rooms/stage-beach-terrace-v2.webm'),
  mp4: asset('video/mp4', 'public/rooms/stage-beach-terrace-v2.mp4'),
}
const intro = 'Fixture welcome: tonight on The Stage.'

async function mount(page, epoch, remaining, media = loop) {
  await page.route('**/*', route => route.abort())
  await page.setContent(html)
  await page.addScriptTag({ content: script })
  await page.evaluate(props => window.mountLobby(props), {
    poster, loop: media, intro, startsAt: new Date(epoch + remaining).toISOString(), serverNow: epoch,
  })
  await page.getByRole('heading', { name: 'Premiere lobby' }).waitFor()
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.STAGE_QA_CHROMIUM || undefined })
  try {
    const room = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await mount(room, Date.now(), 120000)
    await room.waitForFunction(() => {
      const v = document.querySelector('video')
      return v && v.muted && v.loop && !v.paused && v.currentTime > 0.25
    })
    assert.equal(await room.getByText(intro).count(), 0)
    await room.getByRole('button', { name: 'Pause Stage ambience' }).click()
    await room.getByRole('button', { name: 'Play Stage ambience' }).waitFor()
    assert.equal(await room.locator('video').count(), 0)
    await room.getByRole('button', { name: 'Play Stage ambience' }).click()
    await room.locator('video').waitFor()

    const reduced = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
    const clock = Date.UTC(2026, 11, 1, 5, 59, 29)
    await reduced.clock.install({ time: clock })
    await mount(reduced, clock, 31000)
    await reduced.getByRole('button', { name: 'Play Stage ambience' }).waitFor()
    assert.equal(await reduced.locator('video').count(), 0)
    assert.equal(await reduced.getByText(intro).count(), 0)
    await reduced.clock.runFor(1100)
    await reduced.getByText(intro).waitFor()
    assert.equal(await reduced.locator('video').count(), 0)
    await reduced.clock.fastForward(30000)
    await reduced.getByText('The premiere is starting.').waitFor()
    assert.equal(await reduced.getByText(intro).count(), 0)

    const broken = await browser.newPage()
    await mount(broken, Date.now(), 120000, {
      webm: 'data:video/webm;base64,AA==', mp4: 'data:video/mp4;base64,AA==',
    })
    await broken.waitForFunction(() => !document.querySelector('video') &&
      document.querySelector('img')?.naturalWidth > 0 &&
      !Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Stage ambience')))

    console.log('Stage lobby passed: playing muted loop, pause/resume, reduced motion, timed welcome and safe media failure')
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
