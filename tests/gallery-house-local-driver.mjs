import { strict as assert } from 'node:assert'
import { randomUUID, randomBytes, createHash } from 'node:crypto'

const apiOrigin='http://127.0.0.1:54321'
const siteOrigin='http://127.0.0.1:4116'
const files={approvedBucket:'gallery-approved',bytes:Buffer.from('Synthetic Gallery download verification bytes.\n')}
const fail=phase=>{throw Error('Isolated Gallery fixture failed: '+phase)}
const must=(value,phase)=>{if(!value||value.error)fail(phase);return value.data}
export const validCheckoutUrl = raw => {
 try {
  const url=new URL(raw)
  return url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password&&
    /^\/c\/pay\/cs_test_[A-Za-z0-9_]+$/.test(url.pathname)
 } catch { return false }
}
function localCredentials(c) {
 return c?.api===apiOrigin&&typeof c.anonKey==='string'&&typeof c.serviceRoleKey==='string'&&
   c.anonKey!==c.serviceRoleKey&&c.anonKey.length>0&&c.serviceRoleKey.length>0
}
/** Creates only synthetic local fixtures once the dedicated local schema is verified. 
 * No main function calls this, and no hosted URL or seller/customer data is accepted.
 */
export async function seedLocalHouse(c, createClient) {
 if(!localCredentials(c))fail('local Supabase origin')
 const client=createClient(apiOrigin,c.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}})
 const makeUser=async role=>{
  const email='gallery-'+role+'-'+randomUUID()+'@example.com'
  const password=randomBytes(32).toString('base64url')
  const data=must(await client.auth.admin.createUser({email,password,email_confirm:true}),'synthetic Auth user')
  if(!data?.user?.id)fail('synthetic Auth identity')
  return {id:data.user.id,email,password}
 }
 const seller=await makeUser('studio')
 const buyers=[await makeUser('buyer-a'),await makeUser('buyer-b')]
 const artist=randomUUID(),product=randomUUID(),edition=randomUUID()
 const objectPath=product+'/synthetic.bin'
 must(await client.from('artists').insert({id:artist,user_id:seller.id,display_name:'Synthetic Gallery Studio',is_approved:true}),'local artist row')
 must(await client.from('products').insert({id:product,artist_id:artist,slug:'synthetic-test-artwork',title:'Synthetic test artwork',
   kind:'digital',status:'published',price_cents:1200,currency:'usd',stock_count:1}),'local product row')
 const h=createHash('sha256').update(files.bytes).digest('hex')
 must(await client.storage.from(files.approvedBucket).upload(objectPath,files.bytes,{contentType:'application/octet-stream',upsert:false}),'private source upload')
 must(await client.from('gallery_approved_assets').insert({id:edition,product_id:product,object_path:objectPath,sha256:h,approved_by:seller.id}),'private edition row')
 if(must(await client.rpc('cs_gallery_house_ready',{p_product:product,p_artist:artist,p_asset:edition}),'house preflight')!==true)fail('private house preflight')
 return {artist,product,edition,buyers,sha256:h}
}
export async function buyerCookie(c, identity, createServerClient) {
 if(!localCredentials(c)||!/^gallery-buyer-[ab]-[0-9a-f-]{36}@example\.com$/.test(identity?.email??''))
  fail('local buyer credentials')
 const jar=new Map()
 const client=createServerClient(apiOrigin,c.anonKey,{cookies:{
  getAll:()=>Array.from(jar,([name,value])=>({name,value})),
  setAll: pairs=>{for(const {name,value} of pairs)if(value)jar.set(name,value);else jar.delete(name)},
 }})
 const data=must(await client.auth.signInWithPassword({email:identity.email,password:identity.password}),'local buyer sign-in')
 if(data?.user?.id!==identity.id||!jar.size)fail('local buyer cookie')
 if([...jar.keys()].some(name=>!/^sb-[A-Za-z0-9._-]+$/.test(name)))fail('unexpected cookie name')
 return [...jar].map(([k,v])=>k+'='+encodeURIComponent(v)).join('; ')
}
/** Exact Stripe test hosted Checkout only. Call from a reviewed provider driver,
 * not standalone. It does not provision, log, screenshot, or build fake events.
 */
export async function submitHostedStripeTestCard(page, checkoutUrl) {
 if(!validCheckoutUrl(checkoutUrl))fail('Stripe test Checkout URL')
 await page.goto(checkoutUrl,{waitUntil:'domcontentloaded',timeout:15000})
 const assertOrigin=()=>{if(!validCheckoutUrl(page.url())||new URL(page.url()).pathname!==new URL(checkoutUrl).pathname)fail('unexpected hosted checkout navigation')}
 assertOrigin()
 const fields=[['input[name="cardNumber"]','4242424242424242'],['input[name="cardExpiry"]','1230'],
  ['input[name="cardCvc"]','123'],['input[name="billingName"]','Synthetic Gallery Buyer']]
 for(const [selector,value] of fields){assertOrigin();await page.locator(selector).fill(value,{timeout:10000})}
 const country=page.locator('select[name="billingCountry"]')
 if(await country.count()===1){assertOrigin();await country.selectOption('US',{timeout:3000})}
 const postal=page.locator('input[name="billingPostalCode"]')
 if(await postal.count()===1){assertOrigin();await postal.fill('10001',{timeout:3000})}
 assertOrigin()
 await Promise.all([page.waitForURL(u=>u.origin===siteOrigin&&u.pathname==='/gallery/thanks',{timeout:30000}),
  page.locator('button[type="submit"]').click({timeout:5000})])
}
async function selfTest() {
 const key={api:apiOrigin,anonKey:'synthetic-anon',serviceRoleKey:'synthetic-service'}
 const calls=[]
 const fakeClient={auth:{admin:{createUser:async x=>{calls.push(['auth',x.email_confirm]);return {data:{user:{id:randomUUID()}}}}}},
  from:t=>({insert:async x=>{calls.push(['insert',t,x.kind??null]);return {error:null}}}),
  storage:{from:b=>({upload:async (_path,bytes)=>{calls.push(['upload',b,bytes.length]);return {error:null}}})},
  rpc:async name=>{calls.push(['rpc',name]);return {data:true}}
 }
 await assert.rejects(seedLocalHouse({...key,api:'https://other.invalid'},()=>fakeClient))
 assert.equal(calls.length,0)
 const seed=await seedLocalHouse(key,(url,k)=>{assert.equal(url,apiOrigin);assert.equal(k,key.serviceRoleKey);return fakeClient})
 assert.equal(seed.buyers.length,2);assert.notEqual(seed.buyers[0].id,seed.buyers[1].id)
 assert.equal(calls.filter(x=>x[0]==='auth'&&x[1]).length,3)
 assert.ok(calls.some(x=>x[0]==='upload'&&x[1]==='gallery-approved'))
 assert.deepEqual(calls.at(-1),['rpc','cs_gallery_house_ready'])
 const buyer=seed.buyers[0]
 const stub=(_url,_key,{cookies})=>({auth:{signInWithPassword:async()=>{
  cookies.setAll([{name:'sb-synthetic-auth-token',value:'abstract=fixture'}]);return {data:{user:{id:buyer.id}}}
 }}})
 assert.equal(await buyerCookie(key,buyer,stub),'sb-synthetic-auth-token=abstract%3Dfixture')
 await assert.rejects(buyerCookie(key,{...buyer,email:'not-a-fixture@elsewhere.invalid'},stub))
 const good='https://checkout.stripe.com/c/pay/cs_test_Synthetic#optional'
 for(const url of ['https://checkout.stripe.com/c/pay/cs_live_no','https://checkout.stripe.com.evil.invalid/c/pay/cs_test_no','http://checkout.stripe.com/c/pay/cs_test_no'])
  assert.equal(validCheckoutUrl(url),false)
 assert.equal(validCheckoutUrl(good),true)
 let wrote=false
 await assert.rejects(submitHostedStripeTestCard({goto:async()=>{wrote=true}},'https://example.invalid'))
 assert.equal(wrote,false)
 await assert.rejects(submitHostedStripeTestCard({goto:async()=>{},url:()=> 'https://example.invalid'},good))
 const fill=[]
 let complete=false
 const page={goto:async()=>{},url:()=>good,locator:sel=>({fill:async()=>fill.push(sel),count:async()=>0,click:async()=>{complete=true}}),
  waitForURL:async predicate=>assert.equal(predicate(new URL(siteOrigin+'/gallery/thanks')),true)}
 await submitHostedStripeTestCard(page,good)
 assert.equal(fill.length,4);assert.equal(complete,true)
 console.log('PASS: Gallery local fixture driver mocks. No network, Auth, Storage, browser or Stripe execution.')
}
if(process.argv.length===3&&process.argv[2]==='--self-test'){
 try{await selfTest()}catch{console.error('Offline Gallery local fixture driver failed.');process.exitCode=1}
}else if(process.argv.slice(2).includes('--provider')){
 console.error('Provider execution requires a separately reviewed launcher.')
 process.exitCode=1
}
