import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { parseLocalSupabaseStatus } from './gallery-house-sandbox-prep.mjs'
import { seedLocalHouse, buyerCookie } from './gallery-house-local-driver.mjs'

const app='http://127.0.0.1:4116'
const api='http://127.0.0.1:54321'
const orderPath='/api/gallery/download'
const get = (path,opts={}) => fetch(app+path,{...opts,redirect:'error',signal:AbortSignal.timeout(65000)})
const must=(x)=>{if(!x||x.error)throw Error('Fixture operation failed');return x.data}
const check=(predicate)=>{if(!predicate)throw Error('Fixture expectation did not pass')}
const phase=(label)=>{process.stdout.write('PASS: '+label+'\n')}
let stage='verified local runtime inputs', server, browser
try {
 check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='truskoolcorp/cafe-sativa'&&
  process.env.GITHUB_EVENT_NAME==='pull_request'&&process.env.GITHUB_HEAD_REF==='qa/gallery-house-local-runtime-20261124'&&process.env.GITHUB_RUN_ATTEMPT==='1')
 check(process.argv.length===3&&process.argv[2].startsWith(process.env.RUNNER_TEMP+'/'))
 const c=parseLocalSupabaseStatus(readFileSync(process.argv[2],'utf8'))
 check(c.api===api)
 const db=createClient(api,c.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}})
 stage='local Auth, private Storage and house preflight'
 const f=await seedLocalHouse(c,createClient)
 const [cookieA,cookieB]=await Promise.all(f.buyers.map(b=>buyerCookie(c,b,createServerClient)))
 check(cookieA!==cookieB)
 phase(stage)
 stage='next dev loopback startup'
 const cron=randomBytes(24).toString('hex')
 const env={PATH:process.env.PATH,HOME:process.env.HOME,LIVEKIT_API_KEY:undefined,NEXT_TELEMETRY_DISABLED:'1',
  NEXT_PUBLIC_SITE_URL:app,NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:c.anonKey,
  SUPABASE_SERVICE_ROLE_KEY:c.serviceRoleKey,GALLERY_TEST_SUPABASE_URL:api,GALLERY_ISOLATED_TEST:'true',
  GALLERY_LOCAL_STRIPE_CLI:'true',GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID:'acct_SYNTHETIC',
  GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_SYNTHETIC',STRIPE_SECRET_KEY:'rkcs_test_SYNTHETIC_NOT_A_KEY',
  GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_SYNTHETIC_NOT_A_SECRET',
  GALLERY_HOUSE_PRODUCT_ID:f.product,GALLERY_HOUSE_ARTIST_ID:f.artist,
  GALLERY_INVENTORY_HOLDS:'true',GALLERY_PRIVATE_DOWNLOADS:'true',GALLERY_DIGITAL_WORKER:'true',
  GALLERY_DELIVERY_NOTICES:'false',GALLERY_SALES_ENABLED:'false',GALLERY_INVENTORY_RECONCILE:'false',
  CRON_SECRET:cron}
 delete env.LIVEKIT_API_KEY
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','4116'],
  {env,stdio:'ignore',detached:true})
 let ready=false
 for(let n=0;n<30&&!ready;n++){
  if(server.exitCode!==null)break
  try {ready=(await fetch(app+orderPath,{signal:AbortSignal.timeout(7000)})).status===404} catch {}
  if(!ready)await new Promise(r=>setTimeout(r,1000))
 }
 check(ready)
 phase(stage)
 stage='sale remains disabled and no provider call'
 const off=await get('/api/gallery/checkout',{method:'POST',headers:{Cookie:cookieA,Origin:app,'Content-Type':'application/json'},
  body:JSON.stringify({product_id:f.product,quantity:1})})
 check(off.status===503)
 const isOff=await off.json();check(isOff.error==='Gallery purchases are temporarily unavailable.')
 phase(stage)
 stage='competing inventory and synthetic paid receipt'
 const args=user=>({p_product:f.product,p_user:user.id,p_quantity:1})
 const hold=must(await db.rpc('cs_hold_gallery_inventory',args(f.buyers[0])))
 check(typeof hold==='string'&&hold.length===36)
 check(must(await db.rpc('cs_hold_gallery_inventory',args(f.buyers[1])))===null)
 must(await db.from('gallery_inventory_holds').update({stripe_session_id:'cs_synthetic_runtime'}).eq('id',hold))
 const receipt={session_id:'cs_synthetic_runtime',payment_intent_id:'pi_synthetic_runtime',payment_status:'paid',
  user_id:f.buyers[0].id,email:f.buyers[0].email,subtotal_cents:1200,total_cents:1200,currency:'usd',application_fee_cents:0}
 const payload={p_hold:hold,p_asset:f.edition,product_uuid:f.product,artist_uuid:f.artist,quantity:1,receipt}
 const paid=must(await db.rpc('cs_record_house_gallery_payment',payload))
 const replay=must(await db.rpc('cs_record_house_gallery_payment',payload))
 check(paid?.created===true&&replay?.created===false&&paid.id===replay.id)
 phase(stage)
 stage='real worker private delivery and buyer access'
 const worker=await get('/api/gallery/worker',{headers:{Authorization:'Bearer '+cron}})
 check(worker.ok)
 const worked=await worker.json()
 check(worked.fulfillment?.authorized===1&&worked.notifications?.enabled===false)
 const path=orderPath+'?order='+encodeURIComponent(paid.id)
 const buyer=await get(path,{headers:{Cookie:cookieA}})
 const other=await get(path,{headers:{Cookie:cookieB}})
 const anonymous=await get(path)
 check(buyer.ok&&other.status===404&&anonymous.status===401)
 check((buyer.headers.get('cache-control')??'').includes('no-store'))
 const signed=await buyer.json()
 const signedUrl=new URL(signed.url)
 check(signedUrl.origin===api&&signedUrl.pathname.startsWith('/storage/v1/object/sign/gallery-private/'))
 const bytes=await fetch(signedUrl,{redirect:'error',signal:AbortSignal.timeout(15000)})
 check(bytes.ok&&createHash('sha256').update(Buffer.from(await bytes.arrayBuffer())).digest('hex')===f.sha256)
 phase(stage)
 stage='Chromium local HTTP browser isolation'
 const require=createRequire(import.meta.url)
 const {chromium}=require(process.env.GALLERY_PLAYWRIGHT_MODULE)
 browser=await chromium.launch({headless:true})
 const page=await browser.newPage({serviceWorkers:'block',acceptDownloads:false})
 await page.route('**/*',q=>{const url=new URL(q.request().url());return url.origin===app?q.continue():q.abort()})
 const response=await page.goto(app+path,{waitUntil:'domcontentloaded',timeout:12000})
 check(response&&response.status()===401)
 // Browser authenticated requests use only the synthetic session, never an existing profile.
 await page.context().addCookies(cookieA.split('; ').map(field=>{const sep=field.indexOf('=');return {name:field.slice(0,sep),value:field.slice(sep+1),url:app}}))
 const responseBuyer=await page.goto(app+path,{waitUntil:'domcontentloaded',timeout:12000})
 check(responseBuyer&&responseBuyer.status()===200)
 phase(stage)
 stage='synthetic refunded state denies fresh links and does not restock'
 must(await db.from('orders').update({fulfillment_state:'refunded'}).eq('id',paid.id))
 check((await get(path,{headers:{Cookie:cookieA}})).status===404)
 const product=must(await db.from('products').select('stock_count').eq('id',f.product).single())
 check(product.stock_count===0)
 phase(stage)
 console.log('PASS: isolated real Supabase/Next/browser runtime; Stripe provider was not contacted or verified.')
} catch {
 console.error('Isolated synthetic run failed at: '+stage+'. Diagnostics suppressed.')
 process.exitCode=1
} finally {
 if(browser)await browser.close().catch(()=>{})
 if(server?.pid){try{process.kill(-server.pid,'SIGTERM')}catch{}}
}
