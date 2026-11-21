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
  "@/lib/events/stage-sound": function(exports, require) { ${build('lib/events/stage-sound.ts')} },
  "./StageSoundToggle": function(exports, require) { ${build('components/events/StageSoundToggle.tsx')} },
  lobby: function(exports, require) { ${build('components/events/StageLobby.tsx')} },
  performance: function(exports, require) { ${build('components/events/StagePremiereVideo.tsx')} },
};
function require(name) {
  if (name === "react") return React;
  if (!modules[name]) {
    modules[name] = {};
    sources[name](modules[name], require);
  }
  return modules[name];
}
const root = ReactDOM.createRoot(document.getElementById("root"));
window.mountLobby = props => root.render(React.createElement(require("lobby").default, props));
window.mountPerformance = props => root.render(React.createElement(require("performance").default, props));
window.bufferPlayback = [];
const createSource = AudioContext.prototype.createBufferSource;
AudioContext.prototype.createBufferSource = function () {
  const node = createSource.call(this);
  const start = node.start.bind(node);
  node.start = (...args) => {
    window.bufferPlayback.push({ context: this, node });
    return start(...args);
  };
  return node;
};`
const html = '<!doctype html><meta charset="utf-8"><title>Lobby fixture</title><div id="root"></div>'
const asset = (type, file) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`
const eventPage = fs.readFileSync('app/events/ahnika-already-gone/page.tsx', 'utf8')
assert.ok(eventPage.includes('/rooms/stage-beach-terrace-v2.webp'))
for (const ext of ['webm', 'mp4', 'wav']) {
  assert.ok(eventPage.includes(`/rooms/stage-golden-hour-surf-v2.${ext}`))
}
const poster = asset('image/webp', 'public/rooms/stage-beach-terrace-v2.webp')
const loop = {
  webm: asset('video/webm', 'public/rooms/stage-golden-hour-surf-v2.webm'),
  mp4: asset('video/mp4', 'public/rooms/stage-golden-hour-surf-v2.mp4'),
}
const sound = asset('audio/wav', 'public/rooms/stage-golden-hour-surf-v2.wav')
const intro = 'Fixture welcome: tonight on The Stage.'

async function mount(page, epoch, remaining, media = loop, audio = sound) {
  const fixture = 'https://stage-lobby.test/events/ahnika-already-gone'
  await page.route('**/*', route => route.request().url() === fixture
    ? route.fulfill({ contentType: 'text/html', body: html })
    : route.abort())
  await page.goto(fixture)
  await page.addScriptTag({ content: script })
  await page.evaluate(props => window.mountLobby(props), {
    poster, loop: media, sound: audio, intro, startsAt: new Date(epoch + remaining).toISOString(), serverNow: epoch,
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
    assert.equal(await room.evaluate(() => window.bufferPlayback.length), 0)
    await room.getByRole('button', { name: 'Sound', pressed: false, exact: true }).click()
    await room.getByRole('button', { name: 'Sound', pressed: true, exact: true }).waitFor()
    const playback = await room.evaluate(() => {
      const { context, node } = window.bufferPlayback[0]
      return { state: context.state, loop: node.loop, start: node.loopStart, end: node.loopEnd }
    })
    assert.deepEqual(playback, { state: 'running', loop: true, start: 0, end: 8 })
    // Render past the seam in the real browser audio engine and compare the
    // first post-wrap samples to the original samples (no silence or padding).
    const audioSeam = await room.evaluate(async input => {
      const rate = 24000
      const ctx = new OfflineAudioContext(1, rate * 9, rate)
      const source = ctx.createBufferSource()
      source.buffer = await ctx.decodeAudioData(await (await fetch(input)).arrayBuffer())
      source.loop = true
      source.loopEnd = source.buffer.duration
      source.connect(ctx.destination)
      source.start()
      const pcm = (await ctx.startRendering()).getChannelData(0)
      const start = rate * 8
      const difference = Math.max(...pcm.slice(start, start + 240).map((v, i) => Math.abs(v - pcm[i])))
      const step = Math.abs(pcm[start] - pcm[start - 1])
      return { difference, step, length: source.buffer.length }
    }, sound)
    assert.equal(audioSeam.length, 192000)
    assert.ok(audioSeam.difference < 1e-5 && audioSeam.step < 0.002, JSON.stringify(audioSeam))
    await room.getByRole('button', { name: 'Sound', pressed: true, exact: true }).click()
    await room.getByRole('button', { name: 'Sound', pressed: false, exact: true }).waitFor()
    await room.waitForFunction(() => window.bufferPlayback[0].context.state === 'closed')
    await room.locator('video').evaluate(v => new Promise(resolve => {
      v.addEventListener('seeked', resolve, { once: true })
      v.currentTime = v.duration - 0.4
    }))
    await room.waitForFunction(() => {
      const v = document.querySelector('video')
      return !v.paused && v.currentTime > 0.015 && v.currentTime < 0.65
    }, null, { timeout: 5000 })
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
    await reduced.getByRole('button', { name: 'Sound', pressed: false, exact: true }).click()
    await reduced.getByRole('button', { name: 'Sound', pressed: true, exact: true }).waitFor()
    await reduced.clock.runFor(1100)
    await reduced.getByText(intro).waitFor()
    assert.equal(await reduced.locator('video').count(), 0)
    await reduced.clock.fastForward(30000)
    await reduced.getByText('The premiere is starting.').waitFor()
    assert.equal(await reduced.getByText(intro).count(), 0)
    assert.equal(await reduced.getByRole('button', { name: 'Sound', exact: true }).count(), 0)
    await reduced.waitForFunction(() => window.bufferPlayback[0].context.state === 'closed')
    await reduced.evaluate(src => window.mountPerformance({ src, label: 'Handoff fixture' }), loop.webm)
    await reduced.getByRole('button', { name: 'Sound', pressed: true, exact: true }).waitFor()
    assert.equal(await reduced.locator('video').evaluate(v => !v.muted && v.controls), true)
    await reduced.getByRole('button', { name: 'Sound', pressed: true, exact: true }).click()
    await reduced.getByRole('button', { name: 'Sound', pressed: false, exact: true }).waitFor()
    assert.equal(await reduced.locator('video').evaluate(v => v.muted), true)

    const broken = await browser.newPage()
    await mount(broken, Date.now(), 120000, {
      webm: 'data:video/webm;base64,AA==', mp4: 'data:video/mp4;base64,AA==',
    }, 'data:audio/wav;base64,AA==')
    await broken.waitForFunction(() => !document.querySelector('video') &&
      document.querySelector('img')?.naturalWidth > 0 &&
      !Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Stage ambience')))
    await broken.getByRole('button', { name: 'Sound', exact: true }).click()
    await broken.getByText('Sound is unavailable. Try again.').waitFor()

    console.log('Stage lobby passed: video wrap, sample-exact audio wrap, opt-in sound, reduced motion, kickoff handoff and media fallback')
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
