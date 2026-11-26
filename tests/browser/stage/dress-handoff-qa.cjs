const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { chromium } = require('playwright')

const umd = pkg => fs.readFileSync(require.resolve(pkg).replace(/index.js$/, `umd/${pkg}.production.min.js`), 'utf8')
const source = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText
// Use the same component source, no remote data, account, network service, or credentials.
const script = `${umd('react')}\n${umd('react-dom')}\n
const modules = {};
const sources = {
  "@/lib/events/stage-dress-playout": function(exports, require) { ${source('lib/events/stage-dress-playout.ts')} },
  "@/lib/events/stage-sound": function(exports, require) { ${source('lib/events/stage-sound.ts')} },
  player: function(exports, require) { ${source('components/events/StageDressPlayer.tsx')} },
};
function require(name) {
  if (name === "react") return React;
  if (!modules[name]) { modules[name] = {}; sources[name](modules[name], require); }
  return modules[name];
}
const timing = JSON.parse(document.querySelector('#timing').textContent);
ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(require("player").default, timing));
`

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-dress-fixture-'))
  const files = process.env.REHEARSAL_FILES || temp
  const introDuration = process.env.REHEARSAL_FILES ? 30 : 3
  if (files === temp) {
    const packaged = path.resolve('node_modules/@ffmpeg-installer/linux-x64/ffmpeg')
    const encoder = process.env.QA_TEST_FFMPEG || (fs.existsSync(packaged) ? packaged : 'ffmpeg')
    for (const [role, color, tone, duration] of [['intro', 'red', 400, introDuration], ['performance', 'blue', 660, 4]]) {
      execFileSync(encoder, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:size=320x180:rate=30:duration=${duration}`,
        '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000:duration=${duration}`,
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', path.join(temp, role + '.mp4')])
    }
    fs.writeFileSync(path.join(temp, 'intro.en.vtt'), 'WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nFixture welcomes our guests.\n')
  }
  const requests = []
  const failures = []
  let timing
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'application/javascript')
      return res.end(script)
    }
    if (req.url === '/stage/rehearsal') {
      res.setHeader('Content-Type', 'text/html')
      return res.end('<!doctype html><meta charset="utf-8"><main id="root"></main><script type="application/json" id="timing">' +
        JSON.stringify({ ...timing, serverNow: Date.now() }) + '</script><script src="/fixture.js"></script>')
    }
    const role = req.url.split('/').pop()
    if (!['intro', 'performance', 'captions'].includes(role)) { res.statusCode = 404; return res.end() }
    const at = Date.now()
    requests.push({ role, at })
    const intro = role !== 'performance'
    if (at < (intro ? timing.introAt : timing.kickoff) || at >= (intro ? timing.kickoff : timing.cutoff)) {
      res.statusCode = 404
      return res.end()
    }
    const name = ({ intro: 'intro.mp4', captions: 'intro.en.vtt', performance: 'performance.mp4' })[role]
    const file = path.join(files, name)
    const bytes = fs.statSync(file).size
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
    const start = match ? +match[1] : 0
    const end = match && match[2] ? Math.min(+match[2], bytes - 1) : bytes - 1
    res.setHeader('Content-Type', role === 'captions' ? 'text/vtt' : 'video/mp4')
    res.setHeader('Content-Length', end - start + 1)
    res.setHeader('Accept-Ranges', 'bytes')
    if (match) {
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes}`)
    }
    fs.createReadStream(file, { start, end }).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  let pages = []
  try {
    // Test the H.264/AAC formats the real rehearsal uses; the bundled
    // Chromium environment need not provide the licensed codecs.
    browser = await chromium.launch({ channel: 'chrome' })
    pages = await Promise.all([browser.newPage(), browser.newPage()])
    await Promise.all(pages.map(async (page, i) => {
      page.on('pageerror', err => failures.push(err.message))
      await page.addInitScript((muted) => {
        sessionStorage.setItem('cs:stage-sound:v1:/stage/rehearsal', muted ? 'off' : 'on')
        sessionStorage.setItem('cs:stage-sound:v1:/stage/rehearsal:volume', '35')
        window.receipt = { lastIntro: null, firstPerformance: null }
        const observe = () => {
          for (const [i, v] of [...document.querySelectorAll('video')].entries()) {
            if (!v.paused && getComputedStyle(v).visibility === 'visible') {
              if (!i) window.receipt.lastIntro = { t: performance.now(), videoTime: v.currentTime }
              if (i && !window.receipt.firstPerformance) {
                window.receipt.firstPerformance = { t: performance.now(), videoTime: v.currentTime, muted: v.muted, volume: v.volume }
              }
            }
          }
          requestAnimationFrame(observe)
        }
        requestAnimationFrame(observe)
      }, i === 0)
    }))
    const introAt = Date.now() + 1250
    timing = { introAt, kickoff: introAt + introDuration * 1000, cutoff: introAt + (introDuration + 99.7) * 1000 }
    await Promise.all(pages.map(page => page.goto('http://127.0.0.1:' + server.address().port + '/stage/rehearsal')))
    await Promise.all(pages.map(page => page.waitForFunction(() =>
      document.querySelector('video[aria-label^="Laviche"]')?.getAttribute('aria-hidden') === 'false', null, { timeout: 10000 })))
    const sound = pages[1].getByRole('button', { name: 'Sound: Off' })
    if (await sound.isVisible()) await sound.click()
    await Promise.all(pages.map(page => page.waitForFunction(() => window.receipt.firstPerformance, null, { timeout: 40000 })))
    const receipts = await Promise.all(pages.map(page => page.evaluate(() => window.receipt)))
    assert.deepEqual(failures, [])
    assert(requests.filter(r => r.role === 'performance').length >= 2)
    assert(requests.filter(r => r.role === 'performance').every(r => r.at >= timing.kickoff))
    assert.equal(receipts[0].firstPerformance.muted, true)
    assert.equal(receipts[1].firstPerformance.muted, false)
    for (const r of receipts) {
      assert.equal(r.firstPerformance.volume, 0.35)
      assert(r.lastIntro.videoTime >= introDuration - 0.15, JSON.stringify(r))
      assert(r.firstPerformance.videoTime <= 0.18, JSON.stringify(r))
      assert(r.firstPerformance.t - r.lastIntro.t <= 180, JSON.stringify(r))
    }
    console.log(JSON.stringify({ synthetic: files === temp, receipts, earliestPerformanceRequestAfterCueMs:
      Math.min(...requests.filter(r => r.role === 'performance').map(r => r.at - timing.kickoff)) }, null, 2))
  } catch (error) {
    const snapshot = await Promise.all(pages.map(page => page.evaluate(() => ({
      status: document.querySelector('#root')?.textContent,
      receipt: window.receipt,
      videos: [...document.querySelectorAll('video')].map(v => ({ label: v.getAttribute('aria-label'),
        src: v.getAttribute('src'), hidden: v.getAttribute('aria-hidden'), error: v.error?.message,
        paused: v.paused, videoTime: v.currentTime, readyState: v.readyState })),
    })).catch(() => null)))
    console.error(JSON.stringify({ failures, requests: requests.map(r => [r.role, r.at - timing.introAt]), snapshot }))
    throw error
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
    for (const name of ['intro.mp4', 'performance.mp4', 'intro.en.vtt']) {
      const file = path.join(temp, name)
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    fs.rmdirSync(temp)
  }
}
run().catch(err => { console.error(err); process.exitCode = 1 })
