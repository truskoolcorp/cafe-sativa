import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/gallery/environment.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} })
const { galleryEnvironment, gallerySalesEnabled, galleryMerchantRequestUrl } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
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
})

test('restricted merchant sandbox key requires the exact disposable Gallery fixture deployment', () => {
 const app = 'http://127.0.0.1:4116'
 const db = 'http://127.0.0.1:54321'
 const cfg = {...sandbox, VERCEL_ENV:undefined, STRIPE_SECRET_KEY:'rk_test_SYNTHETIC_ONLY',
  GALLERY_LOCAL_STRIPE_MERCHANT_SANDBOX:'true', GALLERY_PRIVATE_TEST_FIXTURES:'true',
  GALLERY_MERCHANT_SANDBOX_ACCOUNT_ID:'acct_dedicated', GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_dedicated',
  GALLERY_HOUSE_PRODUCT_ID:'aaaaaaaa-1111-4111-a111-111111111111',
  GALLERY_HOUSE_ARTIST_ID:'bbbbbbbb-2222-4222-a222-222222222222',
  NEXT_PUBLIC_SITE_URL:app, NEXT_PUBLIC_SUPABASE_URL:db, GALLERY_TEST_SUPABASE_URL:db,
  GALLERY_DELIVERY_NOTICES:'false', GALLERY_DIGITAL_WORKER:'true', GALLERY_SALES_ENABLED:'true'}
 const path='/api/gallery/checkout'
 assert.equal(galleryEnvironment(app+path,cfg),'isolated-test')
 assert.equal(gallerySalesEnabled('isolated-test',cfg),true)
 assert.equal(gallerySalesEnabled('production',cfg),false)
 assert.equal(gallerySalesEnabled('isolated-test',{...cfg,GALLERY_SALES_ENABLED:'false'}),false)
 for (const change of [
   {STRIPE_SECRET_KEY:'rk_live_SYNTHETIC_ONLY'}, {STRIPE_SECRET_KEY:'rk_test_'}, {STRIPE_SECRET_KEY:'rkcs_test_SYNTHETIC_ONLY'},
   {GALLERY_MERCHANT_SANDBOX_ACCOUNT_ID:'acct_wrong'}, {GALLERY_MERCHANT_SANDBOX_ACCOUNT_ID:undefined},
   {GALLERY_MERCHANT_SANDBOX_ACCOUNT_ID:'acct_1GZMxgIDc7LlvDW9', GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_1GZMxgIDc7LlvDW9'},
   {GALLERY_PRIVATE_TEST_FIXTURES:'false'}, {GALLERY_LOCAL_STRIPE_MERCHANT_SANDBOX:'false'}, {GALLERY_LOCAL_STRIPE_CLI:'true'},
   {GALLERY_HOUSE_ARTIST_ID:cfg.GALLERY_HOUSE_PRODUCT_ID}, {GALLERY_HOUSE_PRODUCT_ID:'bad-uuid'},
   {VERCEL_ENV:'production'}, {VERCEL_ENV:'preview'}, {VERCEL_ENV:'development'}, {VERCEL:'1'},
   {VERCEL_URL:'x.example'}, {VERCEL_DEPLOYMENT_ID:'x'}, {GALLERY_DELIVERY_NOTICES:undefined}, {GALLERY_DELIVERY_NOTICES:'true'},
   {NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:4117'},
   {NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54322',GALLERY_TEST_SUPABASE_URL:'http://127.0.0.1:54322'},
   {NEXT_PUBLIC_SITE_URL:site,NEXT_PUBLIC_SUPABASE_URL:database,GALLERY_TEST_SUPABASE_URL:database},
 ]) {
   const invalid={...cfg,...change}
   assert.equal(galleryEnvironment(app+path,invalid),'blocked',JSON.stringify(change))
   assert.equal(gallerySalesEnabled('isolated-test',invalid),false,JSON.stringify(change))
 }
 for(const requestUrl of ['http://127.0.0.1:4117'+path,'http://user@127.0.0.1:4116'+path,'https://127.0.0.1:4116'+path]) {
  assert.equal(galleryEnvironment(requestUrl,cfg),'blocked')
 }
 const testHost=(host,url,forwarded)=>({url,headers:new Headers({host,'x-forwarded-host':forwarded??'anything.invalid'})})
 const synthesized='http://localhost:4116'+path
 assert.equal(galleryMerchantRequestUrl(testHost('127.0.0.1:4116',synthesized),cfg),app+path)
 assert.equal(galleryMerchantRequestUrl(testHost('untrusted.example',synthesized,'127.0.0.1:4116'),cfg),synthesized)
 assert.equal(galleryEnvironment(galleryMerchantRequestUrl(testHost('untrusted.example',app+path,'127.0.0.1:4116'),cfg),cfg),'blocked')
 const otherPort='http://localhost:4117'+path
 assert.equal(galleryMerchantRequestUrl(testHost('127.0.0.1:4116',otherPort),cfg),otherPort)
})
