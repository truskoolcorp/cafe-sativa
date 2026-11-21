const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { chromium } = require('playwright')

// Fixture-only tone and visible motion. No approved assets, secrets, or remote calls.
const media = fs.readFileSync(path.join(__dirname, 'synthetic-clip.webm')).toString('base64')

const umd = (pkg) => fs.readFileSync(require.resolve(pkg).replace(/index.js$/, `umd/${pkg}.production.min.js`), 'utf8')
const build = (path) => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText
const script = `${umd('react')}\n${umd('react-dom')}\n
const modules = {};
const sources = {
  "@/lib/events/scheduled-playback": function(exports, require) { ${build('lib/events/scheduled-playback.ts')} },
  player: function(exports, require) { ${build('components/events/ScheduledPremierePlayer.tsx')} },
};
function require(name) {
  if (name === "react") return React;
  if (name === "next/link") return { default: props => React.createElement("a", props) };
  if (!modules[name]) {
    modules[name] = {};
    sources[name](modules[name], require);
  }
  return modules[name];
}
window.mountFixture = (startsAt, durationMs, serverNow) =>
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(require("player").default, {
    src: "data:video/webm;base64,${media}", startsAt, durationMs, serverNow
  }));`
const html = '<!doctype html><meta charset="utf-8"><title>Stage playback fixture</title><div id="root"></div>'

const read = (page) => page.locator('video').evaluate(v => ({
  position: v.currentTime, muted: v.muted, paused: v.paused, hasControls: v.controls,
  decodedAudio: v.webkitAudioDecodedByteCount,
}))

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.STAGE_QA_CHROMIUM || undefined })
  try {
    const pages = await Promise.all([browser.newPage(), browser.newPage()])
    const errors = []
    await Promise.all(pages.map(async page => {
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.abort())
      await page.setContent(html)
      await page.addScriptTag({ content: script })
    }))

    const at = Date.now() - 100
    const [early, late] = pages
    const startsAt = new Date(at).toISOString()
    const durationMs = 12500
    const mount = page => page.evaluate(({ startsAt, durationMs, serverNow }) =>
      window.mountFixture(startsAt, durationMs, serverNow), { startsAt, durationMs, serverNow: Date.now() })

    await mount(early)
    await early.waitForFunction(() => document.querySelector('video')?.currentTime >= 3.5)
    assert.equal((await read(early)).muted, true)
    assert.equal((await read(early)).hasControls, false)
    await mount(late)
    await late.waitForFunction(() => {
      const video = document.querySelector('video')
      return video && !video.paused && video.currentTime >= 3
    })
    const [a, b] = await Promise.all(pages.map(read))
    assert.equal(b.muted, true)
    assert.equal(b.hasControls, false)
    assert.ok(Math.abs(a.position - b.position) <= 2.25, `Playback drift: ${a.position} vs ${b.position}`)

    await Promise.all(pages.map(async page => {
      await page.getByRole('button', { name: 'Enable sound' }).click()
      await page.getByRole('button', { name: 'Mute sound' }).waitFor()
      await page.waitForFunction(() => {
        const video = document.querySelector('video')
        return video && !video.muted && !video.paused && video.webkitAudioDecodedByteCount > 0
      })
    }))
    await Promise.all(pages.map(async page => {
      await page.getByText('This premiere has ended.').waitFor({ timeout: 16000 })
      assert.equal(await page.locator('video').count(), 0)
      assert.equal(await page.getByRole('link', { name: 'Visit the VIP replay archive' }).getAttribute('href'), '/vip/recordings')
    }))
    assert.deepEqual(errors, [])
    console.log('Stage UI fixture passed: late join alignment, decoded audio with sound enabled, no seek controls, and scheduled player close')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
