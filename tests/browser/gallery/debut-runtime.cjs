// Local-only, read-only fixture test of the actual Next gallery and approved derivative.
const assert = require('node:assert/strict')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { chromium } = require('playwright')

const app = 'http://127.0.0.1:4492'
const dataOrigin = 'http://127.0.0.1:4493'
const slug = 'where-the-brass-meets-the-tide'
const title = 'Where the Brass Meets the Tide'
const imagePath = '/gallery/' + slug + '-display.webp'
const item = {
  id: 'fixture-physical', slug: 'fixture-physical', title: 'Synthetic physical control',
  description: null, kind: 'physical', price_cents: 3200, currency: 'usd',
  primary_image_url: null, stock_count: null, created_at: '2026-11-22T00:00:00Z',
  artist_id: 'fixture', artist_slug: 'fixture', artist_name: 'Synthetic Artist',
}
const attempts = []
const fixture = http.createServer((req, res) => {
  attempts.push({ method: req.method, url: req.url })
  const u = new URL(req.url, dataOrigin)
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'GET') return res.writeHead(405).end('{}')
  if (u.pathname === '/rest/v1/gallery_v') {
    if (u.searchParams.has('slug')) return res.end('null')
    return res.end(JSON.stringify([{...item,id:'duplicate',slug,title:'Wrong duplicate',kind:'digital',price_cents:9999}, item]))
  }
  return res.end('[]')
})

;(async () => {
  await new Promise(resolve => fixture.listen(4493, '127.0.0.1', resolve))
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: process.env.GALLERY_PRODUCTION_BUILD ? 'production' : 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: dataOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-only-browser-anon',
  }
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.GALLERY_PRODUCTION_BUILD ? 'start' : 'dev', '-H', '127.0.0.1', '-p', '4492'], { env, stdio: ['ignore','pipe','pipe'] })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-9000) })
  let browser
  try {
    for (let i=0; i<50; i++) {
      try { const ready = await fetch(app + '/gallery', {signal:AbortSignal.timeout(25000)}); if (ready.ok) break } catch {}
      assert.ok(i<49 && child.exitCode===null,'Next should start')
      await new Promise(resolve => setTimeout(resolve,500))
    }
    const display = await fetch(app + imagePath)
    assert.equal(display.status,200)
    assert.equal(display.headers.get('content-type'),'image/webp')
    const bytes = Buffer.from(await display.arrayBuffer())
    assert.equal(bytes.length,93106)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'7b0c383bbd7927df554881d457e2eb87d454a33207505bed62afd6936e4ed47c')
    browser = await chromium.launch({ headless:true, ...(process.env.GALLERY_CHROMIUM ? { executablePath:process.env.GALLERY_CHROMIUM,args:['--no-sandbox'] } : {}) })
    for (const [width,height] of [[390,844],[1440,960]]) {
      const page = await browser.newPage({viewport:{width,height}, reducedMotion:'reduce', serviceWorkers:'block'})
      const external = []
      await page.route('**/*', route => {
        const u = new URL(route.request().url())
        if (u.origin!==app) {
          external.push(u.hostname)
          return route.abort()
        }
        return route.continue()
      })
      const nav = await page.goto(app+'/gallery')
      assert.equal(nav.status(),200)
      const sameCard = () => page.getByRole('link',{name:/Where the Brass Meets the Tide/})
      assert.equal(await sameCard().count(),1)
      assert.equal(await page.getByText('Wrong duplicate').count(),0)
      assert.match(await sameCard().innerText(),/On display/)
      assert.doesNotMatch(await sameCard().innerText(),/\$|Buy|Sold out/)
      await page.getByRole('link',{name:'Physical',exact:true}).click()
      await page.waitForURL('**/gallery?kind=physical')
      assert.equal(await sameCard().count(),0)
      assert.equal(await page.getByText('Synthetic physical control').count(),1)
      await page.getByRole('link',{name:'Digital',exact:true}).click()
      await page.waitForURL('**/gallery?kind=digital')
      assert.equal(await sameCard().count(),1)
      await sameCard().focus()
      await page.keyboard.press('Enter')
      await page.waitForURL('**/gallery/'+slug)
      assert.equal(await page.getByRole('heading',{level:1,name:title}).count(),1)
      assert.equal(await page.getByText('Café Sativa Studio',{exact:true}).count(),1)
      assert.equal(await page.getByText('Available to browse. Purchases are not open yet.').count(),1)
      assert.equal(await page.getByText(/\$12|Buy now|Download|checkout/i).count(),0)
      const art = page.getByRole('img',{name:title,exact:true})
      const dim = await art.evaluate(async el => { await el.decode(); return [el.naturalWidth,el.naturalHeight,new URL(el.src).pathname] })
      assert.deepEqual(dim,[960,540,imagePath])
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      if (process.env.GALLERY_EVIDENCE_DIR) {
        mkdirSync(process.env.GALLERY_EVIDENCE_DIR,{recursive:true})
        await page.screenshot({path:join(process.env.GALLERY_EVIDENCE_DIR,'artwork-detail-'+width+'.png'),fullPage:true})
      }
      await page.getByRole('link',{name:'All work',exact:true}).click()
      await page.waitForURL('**/gallery')
      assert.equal(await sameCard().count(),1)
      assert.ok(external.every(host=>['tracker.metricool.com','fonts.googleapis.com','fonts.gstatic.com'].includes(host)), 'unexpected external host: '+external.join(','))
      console.log(`PASS ${width}x${height}: Gallery, filtered exposure, keyboard detail, decoded 960x540 derivative, no price or checkout, return.`)
      await page.close()
    }
    assert.ok(attempts.every(row=>row.method==='GET'))
    assert.ok(attempts.some(row=>row.url.startsWith('/rest/v1/gallery_v?')))
    assert.ok(attempts.every(row=>!row.url.includes('slug=eq.'+slug)), 'editorial detail must not read product data')
  } catch (e) { console.error(log); throw e }
  finally { await browser?.close(); child.kill('SIGTERM'); fixture.close() }
})().catch(e=>{console.error(e);process.exitCode=1})
