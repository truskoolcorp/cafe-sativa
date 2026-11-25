import { strict as assert } from 'node:assert'

/** Sourced from the official release asset pages; Linux x64 only.
 * A separately approved runner must verify bytes before extraction and execution.
 * This offline module never fetches, provisions, starts services, or contacts providers.
 */
export const pinnedTools = Object.freeze({
 stripe: Object.freeze({
  url:'https://github.com/stripe/stripe-cli/releases/download/v1.55.14/stripe_1.55.14_linux_x86_64.tar.gz',
  sha256:'cfc9af47378a0331334b16da910812046957695244807e92706ed137b897a520'
 }),
 supabase: Object.freeze({
  url:'https://github.com/supabase/cli/releases/download/v3.3.0/supabase_3.3.0_linux_amd64.tar.gz',
  sha256:'8d12731ae522a8f263170ca719b33f163dd05f4365ae6c22b31714dfa1e92b9b'
 })
})
const safeJson = raw => {
 if(typeof raw!=='string'||raw.length>65536)throw Error('invalid sandbox response')
 try { return JSON.parse(raw) } catch { throw Error('invalid sandbox response') }
}
export function parseAnonymousStripeOutput(raw) {
 if(typeof raw!=='string'||raw.length>65536)throw Error('invalid sandbox response')
 const start=raw.indexOf('{'), end=raw.lastIndexOf('}')
 const value=safeJson(start<0||end<=start?'':raw.slice(start,end+1))
 if(!/^rkcs_test_[A-Za-z0-9_]+$/.test(value?.secret_key??'')||
    !/^pk_test_[A-Za-z0-9_]+$/.test(value?.publishable_key??'')||
    !/^acct_[A-Za-z0-9]+$/.test(value?.account_id??'')||
    !Number.isFinite(Date.parse(value?.expires_at)))throw Error('not an anonymous test sandbox')
 // Deliberately discard the claim URL and publishable key. Never log the return value.
 return {key:value.secret_key,account:value.account_id}
}
export function parseLocalSupabaseStatus(raw) {
 const status=safeJson(raw)
 const api=String(status?.API_URL??'').replace(/^http:\/\/localhost:/,'http://127.0.0.1:')
 if(api!=='http://127.0.0.1:54321')throw Error('API endpoint is not the test runner loopback')
 let db
 try { db=new URL(status?.DB_URL??'') } catch { throw Error('invalid local database endpoint') }
 if(db.hostname==='localhost')db.hostname='127.0.0.1'
 if(db.protocol!=='postgresql:'||db.hostname!=='127.0.0.1'||db.port!=='54322'||db.pathname!=='/postgres'||
    !db.username||!db.password||db.search||db.hash)throw Error('database endpoint is not the test runner loopback')
 const serviceKey=value=>typeof value==='string'&&value.length<=4096&&/^[A-Za-z0-9._-]+$/.test(value)
 if(!serviceKey(status?.ANON_KEY)||!serviceKey(status?.SERVICE_ROLE_KEY)||status.ANON_KEY===status.SERVICE_ROLE_KEY)
  throw Error('local service credentials unavailable')
 return {api,db:db.href,anonKey:status.ANON_KEY,serviceRoleKey:status.SERVICE_ROLE_KEY}
}
function testPreparation() {
 const synthetic = {secret_key:'rkcs_test_SYNTHETIC_NOT_A_KEY',publishable_key:'pk_test_SYNTHETIC_NOT_A_KEY',
  account_id:'acct_Synthetic',claim_url:'https://example.invalid/not-a-claim',expires_at:'2026-12-01'}
 assert.deepEqual(parseAnonymousStripeOutput('synthetic progress\n'+JSON.stringify(synthetic)),{key:synthetic.secret_key,account:synthetic.account_id})
 for(const key of ['sk_live_never','sk_test_other_sandbox','rk_test_not_anonymous'])
   assert.throws(()=>parseAnonymousStripeOutput(JSON.stringify({...synthetic,secret_key:key})))
 assert.throws(()=>parseAnonymousStripeOutput('no json'))
 const local={API_URL:'http://localhost:54321',DB_URL:'postgresql://unit:synthetic@localhost:54322/postgres',ANON_KEY:'synth-anon',SERVICE_ROLE_KEY:'synth-service'}
 const v=parseLocalSupabaseStatus(JSON.stringify(local))
 assert.equal(v.api,'http://127.0.0.1:54321');assert.equal(new URL(v.db).hostname,'127.0.0.1')
 for(const change of [{API_URL:'https://production.example'},{DB_URL:'postgresql://unit:synthetic@127.0.0.1:54322/postgres?host=remote.example'},
  {DB_URL:'postgresql://unit:synthetic@127.0.0.1:54321/postgres'},{ANON_KEY:'synth-service'},{SERVICE_ROLE_KEY:null}])
   assert.throws(()=>parseLocalSupabaseStatus(JSON.stringify({...local,...change})))
 for(const x of Object.values(pinnedTools)){assert.match(x.sha256,/^[a-f0-9]{64}$/);assert.equal(new URL(x.url).hostname,'github.com')}
 console.log('PASS: Offline Gallery sandbox preparation. No provisioning or provider execution.')
}
if(process.argv.slice(2).length===1&&process.argv[2]==='--self-test')testPreparation()
else if(process.argv.slice(2).includes('--provider')){
 console.error('Provider execution is not available in this preparation module.')
 process.exitCode=1
}
