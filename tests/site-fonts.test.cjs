const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const postcss = require('postcss')
const fontkit = require('next/dist/compiled/@next/font/dist/fontkit').default
const readFont = fontkit.default || fontkit
const { getFallbackFontOverrideMetrics } = require('next/dist/compiled/@next/font/dist/google/get-fallback-font-override-metrics')
const manifest = JSON.parse(fs.readFileSync('public/fonts/manifest.json', 'utf8'))
const css = fs.readFileSync('app/fonts.css', 'utf8')
const layout = fs.readFileSync('app/layout.tsx', 'utf8')
const families = { inter: 'Inter', playfair: 'Playfair Display' }
const fonts = manifest.files.filter(file => file.path.endsWith('.woff2'))
const faces = []
postcss.parse(css).walkAtRules('font-face', rule => {
  const props = {}
  rule.walkDecls(decl => { props[decl.prop] = decl.value })
  faces.push(props)
})

test('layout uses local fonts with the same two Latin preloads and CSS variables', () => {
  assert.doesNotMatch(layout, /next\/font\/google|fonts\.googleapis|fonts\.gstatic/)
  assert.match(layout, /import '\.\/fonts\.css'/)
  const preloads = [...layout.matchAll(/<link\s+rel="preload"[^>]+>/g)].map(match => match[0])
  assert.equal(preloads.length, 2)
  for (const family of ['inter', 'playfair']) {
    const preload = preloads.find(value => value.includes(`/fonts/${family}-latin.woff2`))
    assert.ok(preload)
    assert.match(preload, /as="font"/)
    assert.match(preload, /type="font\/woff2"/)
    assert.match(preload, /crossOrigin="anonymous"/)
    assert.match(css, new RegExp(`--font-${family}:`))
  }
  assert.doesNotMatch(css, /https?:|@import/)
})

test('all pinned binaries retain upstream hashes, genuine families and variable weight axes', () => {
  assert.equal(fonts.length, 11)
  assert.equal(fonts.reduce((total, font) => total + font.bytes, 0), 308528)
  for (const file of fonts) {
    assert.ok(file.source.startsWith('https://fonts.gstatic.com/'))
    const data = fs.readFileSync(file.path)
    assert.equal(data.length, file.bytes)
    assert.equal(data.subarray(0, 4).toString(), 'wOF2')
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256)
    const font = readFont(data)
    assert.equal(font.familyName, families[file.family])
    assert.equal(font.variationAxes.wght.min, file.family === 'inter' ? 100 : 400)
    assert.equal(font.variationAxes.wght.max, 900)
    if (file.subset === 'latin') {
      for (const char of 'Café Sativa España Tenerife €') {
        assert.ok(font.hasGlyphForCodePoint(char.codePointAt(0)), `${file.path}: ${char}`)
      }
    }
  }
})

test('all existing Unicode subsets, CSS weights and swap behavior are preserved', () => {
  const expected = {
    inter: ['cyrillic-ext', 'cyrillic', 'greek-ext', 'greek', 'vietnamese', 'latin-ext', 'latin'],
    playfair: ['cyrillic', 'vietnamese', 'latin-ext', 'latin'],
  }
  assert.equal(faces.filter(face => face.src.startsWith('url(')).length, 19)
  for (const family of Object.keys(expected)) {
    assert.deepEqual(fonts.filter(font => font.family === family).map(font => font.subset), expected[family])
    for (const file of fonts.filter(font => font.family === family)) {
      const local = '/' + file.path.slice('public/'.length)
      const actual = faces.filter(face => face.src.includes(`url(${local})`))
      assert.deepEqual(actual.map(face => face['font-weight']), family === 'inter' ? ['100 900'] : ['400', '600', '700'])
      for (const face of actual) {
        assert.equal(face['font-family'], `'${families[family]}'`)
        assert.equal(face['font-style'], 'normal')
        assert.equal(face['font-display'], 'swap')
        assert.match(face['unicode-range'], /^U\+/)
        assert.ok(fs.existsSync(path.join('public', local)))
      }
    }
  }
})

test('metric-adjusted fallbacks retain the existing Next 14 visual layout', () => {
  for (const family of ['Inter', 'Playfair Display']) {
    const metrics = getFallbackFontOverrideMetrics(family)
    const face = faces.find(face => face['font-family'] === `'${family} Fallback'`)
    assert.ok(face)
    assert.equal(face.src, `local('${metrics.fallbackFont}')`)
    assert.equal(face['ascent-override'], metrics.ascentOverride)
    assert.equal(face['descent-override'], metrics.descentOverride)
    assert.equal(face['line-gap-override'], metrics.lineGapOverride)
    assert.equal(face['size-adjust'], metrics.sizeAdjust)
  }
})

test('each unmodified font family is distributed with its original OFL and copyright', () => {
  const licenses = manifest.files.filter(file => file.path.endsWith('OFL.txt'))
  assert.equal(licenses.length, 2)
  for (const license of licenses) {
    const raw = fs.readFileSync(license.path), text = raw.toString()
    assert.equal(createHash('sha256').update(raw).digest('hex'), license.sha256)
    assert.match(text, /Copyright/)
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/)
    assert.match(text, /This license becomes null and void/)
    if (license.family === 'playfair') assert.match(text, /Reserved Font Name "Playfair Display"/)
  }
})
