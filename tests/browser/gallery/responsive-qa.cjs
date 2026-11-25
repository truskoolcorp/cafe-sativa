const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')
const postcss = require('postcss')
const tailwind = require('tailwindcss')
const source = process.env.GALLERY_FIXTURE_SOURCE || '.'
const Out = process.env.GALLERY_FIXTURE_OUT || '.gallery-browser-evidence'
const svg = (caption, art, width = 1000, height = 620) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 1000 620" preserveAspectRatio="none">' +
  '<defs><linearGradient id="g"><stop stop-color="#140d0a"/><stop offset="1" stop-color="#764e34"/></linearGradient></defs>' +
  '<path fill="url(#g)" d="M0 0h1000v620H0z"/><path stroke="#b48b65" stroke-width="2" fill="none" d="M65 60h870v475H65zM285 60v475m430-475v475" opacity=".65"/>' +
  (art ? '<circle cx="505" cy="282" r="140" fill="#bf8850" opacity=".7"/>' : '<path fill="#c99968" opacity=".27" d="M336 77h329v393H336z"/>') +
  '<text x="500" y="581" fill="#f1e5d1" font-size="24" text-anchor="middle" font-family="sans-serif">' + caption + '</text></svg>',
).toString('base64')
const still = svg('SYNTHETIC STILL / NOT THE APPROVED ROOM ASSET', false)
const debutMod = { exports: {} }
const debutJs = ts.transpileModule(fs.readFileSync(path.join(source, 'app/gallery/debut-work.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('exports', 'module', debutJs)(debutMod.exports, debutMod)
const debutWork = { ...debutMod.exports.debutWork, primary_image_url: svg('SYNTHETIC DEBUT WORK', true, 960, 540) }

const product = {
  id: 'fixture-1', slug: 'where-the-brass-meets-the-tide',
  title: 'Where the Brass Meets the Tide', artist_name: 'Café Sativa Studio',
  artist_slug: 'cafe-sativa-studio', description: 'Synthetic catalogue fixture, not a live listing.',
  kind: 'digital', price_cents: 1200, currency: 'usd', stock_count: null,
  primary_image_url: svg('SYNTHETIC LANDSCAPE / BROWSE-ONLY QA', true, 1600, 900),
}
const portrait = {
  ...product, id: 'fixture-portrait', slug: 'synthetic-portrait', title: 'Synthetic portrait',
  primary_image_url: svg('SYNTHETIC PORTRAIT / BROWSE-ONLY QA', true, 800, 1000),
}
const Link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children)
const Image = ({ fill, priority, alt, className, ...props }) =>
  React.createElement('img', {
    alt, className: (fill ? 'absolute inset-0 w-full h-full ' : '') + (className || ''),
    ...props,
  })
const Badge = ({ variant, ...props }) => React.createElement('span', props)
const Icon = props => React.createElement('svg', { width: 24, height: 24, 'aria-hidden': true, ...props })

function fixturePage(file, rows) {
  const modules = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': Link, 'next/image': Image,
    'next/navigation': { notFound: () => { throw new Error('Fixture returned 404') } },
    'next/headers': { cookies: () => ({ get: () => undefined }) },
    '@supabase/ssr': { createServerClient: () => ({
      from(table) {
        assert.equal(table, 'gallery_v')
        return { select: () => ({
          in(field, allowed) {
            assert.equal(field, 'kind')
            return { order: () => ({ limit: async () => ({ data: rows.filter(row => allowed.includes(row.kind)) }) }) }
          },
          eq(field, slug) {
            assert.equal(field, 'slug')
            return { maybeSingle: async () => ({ data: rows.find(row => row.slug === slug) || null }) }
          },
        }) }
      },
    }) },
    '@radix-ui/react-slot': { Slot: () => null },
    'lucide-react': { Package: Icon, ArrowLeft: Icon },
    '@/lib/content/venue-covers': { approvedVenueCovers: async () => ({ gallery: still }) },
    '@/components/ui/badge': { Badge },
    './debut-work': { debutWork }, '../debut-work': { debutWork },
  }
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const fixtureRequire = key => {
    assert.ok(Object.hasOwn(modules, key), 'Unmocked dependency: ' + key)
    return modules[key]
  }
  new Function('require', 'exports', 'module', 'process', code)(
    fixtureRequire, mod.exports, mod, { env: Object.freeze({}) },
  )
  return mod.exports.default
}

async function main() {
  const indexFile = 'app/gallery/page.tsx'
  const detailFile = 'app/gallery/[slug]/page.tsx'
  const layout = fs.readFileSync(path.join(source, 'app/globals.css'), 'utf8')
  const cfg = require(path.resolve(source, 'tailwind.config.js'))
  const rawEntries = [indexFile, detailFile].map(file => ({
    raw: fs.readFileSync(path.join(source, file), 'utf8'), extension: 'tsx',
  }))
  const css = (await postcss([tailwind({ ...cfg, content: rawEntries })])
    .process(layout, { from: undefined })).css
  const rows = [product, { ...product, id: 'fixture-2', title: 'Synthetic sold-out work', slug: 'sold-out', stock_count: 0 }, { ...product, id: 'fixture-nft', title: 'Synthetic NFT hidden', slug: 'nft-hidden', kind: 'nft' }]
  const populated = fixturePage(indexFile, rows)
  const gallery = renderToStaticMarkup(await populated({ searchParams: {} }))
  const empty = renderToStaticMarkup(await fixturePage(indexFile, [])({ searchParams: {} }))
  const filtered = renderToStaticMarkup(await populated({ searchParams: { kind: 'physical' } }))
  const detail = renderToStaticMarkup(await fixturePage(detailFile, rows)({ params: { slug: product.slug } }))
  const portraitDetail = renderToStaticMarkup(await fixturePage(detailFile, [portrait])({ params: { slug: portrait.slug } }))
  assert.match(gallery, /Digital art/)
  assert.match(detail, /Digital art/)
  assert.match(gallery, /Some works in the Gallery are created wholly or partly with AI\./)
  assert.doesNotMatch(gallery + detail, /Synthetic NFT hidden|AI-generated|AI-assisted|Ask Zaria|\/ask\?|Buy now|Connect wallet/)
  assert.match(detail, /Available to browse\. Purchases are not open yet\./)
  assert.match(empty, /Where the Brass Meets the Tide/)
  assert.equal((gallery.match(/href="\/gallery\/where-the-brass-meets-the-tide"/g) || []).length, 1)
  assert.doesNotMatch(detail, /Synthetic catalogue fixture|\$12\.00|Download/)
  assert.match(filtered, /No published work in this category/)
  assert.match(gallery, /Sold out/)
  if (process.argv.includes('--static')) {
    console.log('Gallery exact-source static fixture checks passed; Chromium not run.')
    return
  }
  fs.mkdirSync(Out, { recursive: true })
  const sizes = [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 960 }]
  const results = { sha: process.env.GITHUB_SHA || 'local-unpublished', scope: 'Gallery source fixture, synthetic images/data, no hosted services', sizes: [] }
  const { chromium } = require('playwright')
  const browser = await chromium.launch()
  try {
    for (const { name, width, height } of sizes) {
      const requests = []
      const errors = []
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' })
      await page.route('**/*', r => { requests.push(r.request().url()); return r.abort() })
      page.on('pageerror', err => errors.push(String(err)))
      const render = async body => page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body>' + body + '</body></html>')
      const pageWidth = async () => page.locator('html').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      const fits = async () => {
        const w = await pageWidth()
        assert.ok(w.scroll <= w.client, name + ' horizontally overflows: ' + JSON.stringify(w))
      }
      await render(gallery)
      await fits()
      const disclosure = page.getByText('Some works in the Gallery are created wholly or partly with AI.', { exact: true })
      assert.equal(await disclosure.count(), 1)
      assert.ok(await disclosure.isVisible())
      assert.equal(await disclosure.evaluate(el => getComputedStyle(el).fontSize), '14px')
      assert.equal(await page.getByRole('link', { name: 'All work' }).getAttribute('aria-current'), 'page')
      assert.ok(await page.getByRole('link', { name: /where the brass meets the tide/i }).isVisible())
      assert.equal(await page.getByText('Digital art', { exact: true }).count(), 2)
      assert.equal(await page.locator('#inside-gallery img').evaluate(el => el.complete && el.naturalWidth > 0), true)
      const cardGrid = await page.getByRole('link', { name: /where the brass meets the tide/i }).evaluate(el => getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length)
      assert.equal(cardGrid, name === 'mobile' ? 1 : 4)
      await page.screenshot({ path: path.join(Out, 'gallery-' + name + '.png'), fullPage: true })
      await page.keyboard.press('Tab')
      const step = page.getByRole('link', { name: 'Step inside' })
      assert.equal(await step.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('html').evaluate(() => location.hash), '#inside-gallery')
      const assertWholeArt = async title => {
        const art = page.getByRole('img', { name: title, exact: true })
        const measured = await art.evaluate(el => {
          const box = el.getBoundingClientRect()
          const frame = el.parentElement.getBoundingClientRect()
          return { w: box.width, h: box.height, frameH: frame.height,
            expected: el.naturalWidth / el.naturalHeight, fit: getComputedStyle(el).objectFit }
        })
        assert.ok(measured.w > 0 && measured.h > 0 && Number.isFinite(measured.expected), name + ' art image did not load')
        assert.ok(Math.abs(measured.w / measured.h - measured.expected) < 0.01, name + ' art did not maintain intrinsic aspect: ' + JSON.stringify(measured))
        assert.ok(Math.abs(measured.frameH - measured.h - 2) < 1, name + ' art frame contains a vertical band: ' + JSON.stringify(measured))
        assert.notEqual(measured.fit, 'cover', name + ' art image is configured to crop')
        return measured
      }
      await render(detail)
      await fits()
      const landscape = await assertWholeArt(product.title)
      assert.ok(await page.getByText('Digital art', { exact: true }).first().isVisible())
      assert.equal(await page.getByRole('button', { name: /buy|checkout|cart/i }).count(), 0)
      assert.equal(await page.getByRole('link', { name: 'All work' }).getAttribute('href'), '/gallery')
      await page.screenshot({ path: path.join(Out, 'detail-' + name + '.png'), fullPage: true })
      await render(portraitDetail)
      await fits()
      const portraitFrame = await assertWholeArt(portrait.title)
      await page.screenshot({ path: path.join(Out, 'portrait-' + name + '.png'), fullPage: true })
      await render(empty)
      await fits()
      assert.ok(await page.getByRole('link', { name: /where the brass meets the tide/i }).isVisible())
      await render(filtered)
      await fits()
      assert.equal(await page.getByRole('link', { name: 'Physical' }).getAttribute('aria-current'), 'page')
      assert.ok(await page.getByRole('status').isVisible())
      assert.deepEqual(requests, [])
      assert.deepEqual(errors, [])
      results.sizes.push({ name, width, height, cardGrid, horizontalOverflow: false, networkRequests: 0, pageErrors: 0, keyboardAnchor: true, browseOnlyDetail: true, landscapeFrame: landscape, portraitFrame })
      fs.writeFileSync(path.join(Out, 'results.json'), JSON.stringify(results, null, 2))
      await page.close()
    }
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
