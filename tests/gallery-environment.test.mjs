import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/gallery/environment.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} })
const { galleryEnvironment, galleryRequestUrl, gallerySalesEnabled } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const site = 'https://gallery-preview.example'
const database = 'https://syntheticgallery.supabase.co'
const sandbox = {
  VERCEL_ENV: 'preview',
  GALLERY_ISOLATED_TEST: 'true',
  STRIPE_SECRET_KEY: 'sk_test_synthetic',
  STRIPE_WEBHOOK_SECRET: 'whsec_shared_synthetic',
  GALLERY_TEST_STRIPE_WEBHOOK_SECRET: 'whsec_separate_synthetic',
  GALLERY_TEST_SUPABASE_URL: database,
  NEXT_PUBLIC_SUPABASE_URL: database,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
  NEXT_PUBLIC_SITE_URL: site,
  GALLERY_INVENTORY_HOLDS: 'true',
  GALLERY_PRIVATE_DOWNLOADS: 'true',
}
test('an explicitly isolated preview can run Gallery test operations', () => {
  assert.equal(galleryEnvironment(site + '/api/gallery/checkout', sandbox), 'isolated-test')
})
test('an unconfigured deployment or local process cannot mutate Gallery test state', () => {
  for (const VERCEL_ENV of [undefined, 'development', 'preview']) {
    assert.equal(galleryEnvironment(site, { VERCEL_ENV }), 'blocked')
  }
})
test('misconfigured previews fail closed', () => {
  const unsafe = [
    { STRIPE_SECRET_KEY: 'sk_live_synthetic' },
    { GALLERY_TEST_STRIPE_WEBHOOK_SECRET: sandbox.STRIPE_WEBHOOK_SECRET },
    { GALLERY_TEST_STRIPE_WEBHOOK_SECRET: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { GALLERY_PRIVATE_DOWNLOADS: 'false' },
    { GALLERY_DELIVERY_NOTICES: 'true' },
    { NEXT_PUBLIC_SUPABASE_URL: 'not a URL' },
    { GALLERY_TEST_SUPABASE_URL: 'https://someotherpreview.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://nwfxvhqbjtfvoopcadff.supabase.co',
      GALLERY_TEST_SUPABASE_URL: 'https://nwfxvhqbjtfvoopcadff.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://anrprovgdpwqcalkolsz.supabase.co',
      GALLERY_TEST_SUPABASE_URL: 'https://anrprovgdpwqcalkolsz.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      GALLERY_TEST_SUPABASE_URL: 'http://127.0.0.1:54321' },
  ]
  for (const change of unsafe) assert.equal(galleryEnvironment(site, { ...sandbox, ...change }), 'blocked')
  assert.equal(galleryEnvironment('https://wrong-preview.example', sandbox), 'blocked')
})
test('production continues using its existing path', () => {
  assert.equal(galleryEnvironment(site, { VERCEL_ENV: 'production' }), 'production')
})

test('new sales default off and cannot use a test key in production', () => {
 const ready = {...sandbox, VERCEL_ENV:'production', STRIPE_SECRET_KEY:'sk_live_synthetic', GALLERY_DIGITAL_WORKER:'true', GALLERY_SALES_ENABLED:'true'}
 assert.equal(gallerySalesEnabled('production',ready),true)
 assert.equal(gallerySalesEnabled('isolated-test',{...ready,STRIPE_SECRET_KEY:'sk_test_synthetic'}),true)
 assert.equal(gallerySalesEnabled('blocked',ready),false)
 for (const change of [{GALLERY_SALES_ENABLED:undefined},{GALLERY_SALES_ENABLED:'false'},{GALLERY_PRIVATE_DOWNLOADS:'false'},{GALLERY_INVENTORY_HOLDS:'false'},{GALLERY_DIGITAL_WORKER:undefined},{STRIPE_SECRET_KEY:'sk_test_synthetic'}])
  assert.equal(gallerySalesEnabled('production',{...ready,...change}),false)
 // Existing paid/refunded webhook environment classification is unchanged by the sales switch.
 assert.equal(galleryEnvironment(site,{...ready,GALLERY_SALES_ENABLED:'false'}),'production')
})

test('temporary restricted Stripe CLI key works only for explicit non-Vercel local isolation', () => {
 const app = 'http://127.0.0.1:4116'
 const db = 'http://127.0.0.1:54321'
 const local = {...sandbox, VERCEL_ENV:undefined, GALLERY_LOCAL_STRIPE_CLI:'true',
  STRIPE_SECRET_KEY:'rkcs_test_SYNTHETIC_NOT_A_KEY',
  GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID:'acct_synthetic',
  GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_synthetic',
  NEXT_PUBLIC_SITE_URL:app, NEXT_PUBLIC_SUPABASE_URL:db, GALLERY_TEST_SUPABASE_URL:db,
  GALLERY_DIGITAL_WORKER:'true', GALLERY_SALES_ENABLED:'true'}
 assert.equal(galleryEnvironment(app+'/api/gallery/checkout',local),'isolated-test')
 assert.equal(gallerySalesEnabled('isolated-test',local),true)
 assert.equal(gallerySalesEnabled('production',{...local,VERCEL_ENV:'production'}),false)
 const hosted = {...local, VERCEL_ENV:'preview', NEXT_PUBLIC_SITE_URL:site,
  NEXT_PUBLIC_SUPABASE_URL:database, GALLERY_TEST_SUPABASE_URL:database}
 assert.equal(galleryEnvironment(site,hosted),'blocked')
 assert.equal(galleryEnvironment(site,{...hosted,STRIPE_SECRET_KEY:'sk_test_synthetic'}),'isolated-test')
 for(const change of [{VERCEL_ENV:'development'},{VERCEL:'1'},{VERCEL_URL:'preview.invalid'},{VERCEL_DEPLOYMENT_ID:'test'},
   {GALLERY_LOCAL_STRIPE_CLI:'false'},{GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID:'acct_unexpected'},
   {GALLERY_HOUSE_STRIPE_ACCOUNT_ID:undefined},{NEXT_PUBLIC_SITE_URL:'http://localhost:4116'},
   {NEXT_PUBLIC_SITE_URL:'https://127.0.0.1:4116'},{NEXT_PUBLIC_SITE_URL:db},
   {NEXT_PUBLIC_SUPABASE_URL:'https://syntheticgallery.supabase.co',GALLERY_TEST_SUPABASE_URL:'https://syntheticgallery.supabase.co'},
   {GALLERY_DELIVERY_NOTICES:'true'}]){
  const candidate={...local,...change}
  assert.equal(galleryEnvironment(app,candidate),'blocked')
  assert.equal(gallerySalesEnabled('isolated-test',candidate),false)
 }
 assert.equal(galleryEnvironment('http://127.0.0.1:9999/api/gallery/checkout',local),'blocked')
 const request=(url,host)=>({url,headers:{get:name=>name==='host'?host:null}})
 const nextUrl='http://localhost:4116/api/gallery/checkout'
 assert.equal(galleryRequestUrl(request(nextUrl,'127.0.0.1:4116'),local),app+'/api/gallery/checkout')
 for(const [url,host,env] of [
  [nextUrl,'localhost:4116',local],[nextUrl,'external.invalid:4116',local],
  ['http://localhost:9999/api/gallery/checkout','127.0.0.1:4116',local],
  ['https://localhost:4116/api/gallery/checkout','127.0.0.1:4116',local],
  [nextUrl,'127.0.0.1:4116',{...local,VERCEL:'1'}],
  ['http://external.invalid:4116/api/gallery/checkout','127.0.0.1:4116',local],
 ]) assert.equal(galleryRequestUrl(request(url,host),env),url)
})
