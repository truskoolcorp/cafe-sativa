import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/gallery/environment.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} })
const { galleryEnvironment } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
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
