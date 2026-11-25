const assert=require('node:assert/strict')
const http=require('node:http')
const {spawn}=require('node:child_process')
const {readFileSync,writeFileSync}=require('node:fs')
const {createHash}=require('node:crypto')
const {chromium}=require('playwright')
const app='http://127.0.0.1:4392'
const dataOrigin='http://127.0.0.1:4393'
const art={id:'qa-art',slug:'qa-art',title:'QA Artwork',description:'Synthetic Gallery-only work.',kind:'digital',price_cents:1200,currency:'usd',primary_image_url:null,stock_count:1,artist_id:'a',artist_slug:'qa-artist',artist_name:'QA Artist',artist_avatar:null,created_at:'2025-01-01T00:00:00Z'}
const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')
const fixtureSha=createHash('sha256').update(img).digest('hex')
const canonicalId='473df9fd-b48c-4f01-a89a-499de631b954'
const testToken='synthetic-gallery-portrait-test'
let portraitFixtureMode='valid'
let portraitFetches=0
const fixture=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',app);res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Content-Type','application/json')
 if(req.method==='OPTIONS'){res.writeHead(204).end();return}
 const u=new URL(req.url,dataOrigin)
 if(u.pathname==='/fixture/approved-portrait'){
  if(req.headers.authorization!=='Bearer '+testToken){res.writeHead(401).end();return}
  if(u.searchParams.has('assetId')){
   portraitFetches++
   if(u.searchParams.get('assetId')!==canonicalId||u.searchParams.get('characterId')!=='zaria-solenne'){res.writeHead(400).end();return}
   res.writeHead(200,{'Content-Type':'image/png','X-Canonical-Sha256':fixtureSha})
   return res.end(portraitFixtureMode==='changed-bytes'?Buffer.from('not the locked bytes'):img)
  }
  return res.end(JSON.stringify({live:true,characters:[{id:'zaria-solenne',production_ready:true,rights_status:portraitFixtureMode==='unapproved'?'pending':'approved',portrait_available:true,primary_asset_id:canonicalId,sha256:fixtureSha}]}))
 }
 if(u.pathname==='/rest/v1/gallery_v')return res.end(JSON.stringify(!u.searchParams.get('slug')||u.searchParams.get('slug')==='eq.qa-art'?[art]:[]))
 return res.end('[]')
})
async function main(){
 await new Promise(resolve=>fixture.listen(4393,'127.0.0.1',resolve))
 const env={GLYPH_CANON_READ_TOKEN:testToken,PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:dataOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT:'true',CS_ZARIA_GALLERY_PORTRAIT:'true',CS_LIVEKIT_ENABLED:'false'}
 const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','4392'],{env,stdio:['ignore','pipe','pipe']})
 let serverLog=''
 for(const stream of [next.stdout,next.stderr])stream.on('data',buf=>{serverLog=(serverLog+buf).slice(-15000)})
 let browser
 try{
  let ready=false
  for(let i=0;i<45;i++){
   try{const res=await fetch(app+'/gallery',{signal:AbortSignal.timeout(30000)});if(res.ok){ready=true;break}}catch{}
   if(next.exitCode!==null)break
   await new Promise(r=>setTimeout(r,500))
  }
  assert.ok(ready,'Next Gallery should respond')
  const getPortrait=()=>fetch(app+'/api/hosts/portrait?host=zaria',{signal:AbortSignal.timeout(30000)})
  const response=await getPortrait()
  assert.equal(response.status,200,'actual Next portrait route should render valid fixture')
  assert.match(response.headers.get('content-type'),/^image\/png/)
  assert.ok(response.headers.get('cache-control').split(',').map(v=>v.trim()).includes('no-store'))
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  const derivative=Buffer.from(await response.arrayBuffer())
  assert.deepEqual(derivative.subarray(0,8),img.subarray(0,8))
  assert.equal(derivative.readUInt32BE(16),448)
  assert.equal(derivative.readUInt32BE(20),560)
  assert.notEqual(createHash('sha256').update(derivative).digest('hex'),fixtureSha)
  portraitFixtureMode='unapproved'
  let requests=portraitFetches
  assert.equal((await getPortrait()).status,404)
  assert.equal(portraitFetches,requests,'unapproved metadata must not retrieve portrait bytes')
  portraitFixtureMode='changed-bytes'
  assert.equal((await getPortrait()).status,503)
  portraitFixtureMode='valid'
  browser=await chromium.launch({headless:true})
  for(const viewport of [{width:390,height:844},{width:1440,height:960}]){
   const page=await browser.newPage({viewport})
   const turns=[]
   const beforePortraitFetch=portraitFetches
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url())
    if(u.origin!==app && u.origin!==dataOrigin)return route.abort()
    if(u.pathname==='/api/concierge'){
     turns.push(route.request().postDataJSON())
     return route.fulfill({status:200,json:{message:'Synthetic reply about the currently selected work.',gallery_links:[{label:'See QA Artwork',path:'/gallery/qa-art'},{label:'Omit external path',path:'https://example.invalid/gallery/qa-art'}]}})
    }
    if(u.pathname.includes('/api/concierge/livekit')||u.pathname==='/api/concierge/speak')throw Error('Text-only Zaria attempted voice')
    return route.continue()
   })
   await page.goto(app+'/gallery')
   await page.getByRole('link',{name:'Talk to Zaria'}).waitFor()
   const portrait=page.getByRole('img',{name:'Zaria Solenne, Café Sativa Gallery curator'})
   await portrait.scrollIntoViewIfNeeded()
   await portrait.evaluate(el=>el.decode())
   assert.ok(portraitFetches>beforePortraitFetch,'browser loaded actual portrait route')
   await page.goto(app+'/gallery/qa-art')
   await page.getByRole('link',{name:'Ask Zaria about this work'}).click()
   await page.waitForURL('**/ask?host=zaria&work=qa-art')
   const textarea=page.locator('textarea')
   await textarea.fill('Tell me about this work')
   await textarea.press('Enter')
   await page.getByText('Synthetic reply about the currently selected work.').waitFor()
   assert.equal(turns.length,1)
   assert.equal(turns[0].host,'zaria')
   assert.equal(turns[0].room_id,'qa-art')
   assert.equal(turns[0].surface,'web-chat')
   assert.equal(await page.getByRole('link',{name:'See QA Artwork'}).count(),1)
   assert.equal(await page.getByText('Omit external path').count(),0)
   assert.equal(await page.getByText('Start voice conversation').count(),0)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
   await page.getByRole('link',{name:'See QA Artwork'}).click()
   await page.waitForURL('**/gallery/qa-art')
   await page.close()
  }
  console.log('PASS: actual Next Gallery to Zaria selected-work text to artwork at 390 and 1440 pixels; synthetic chat, actual portrait derivative and fail-closed checks; no provider or voice')
 }catch(error){console.error(serverLog);throw error}
 finally{await browser?.close();next.kill('SIGTERM');fixture.close()}
}
// QA-only: pin the two exact synthetic inputs in the disposable CI checkout.
// No application code or canonical production fixture is changed in the branch.
async function isolated(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','run only in the disposable CI checkout')
 const transforms=[
  ['lib/content/glyph-live.ts','https://studio.truskool.net/api/studios/cafe-sativa-canon',dataOrigin+'/fixture/approved-portrait'],
  ['lib/gallery/zaria.ts','ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca',fixtureSha],
 ].map(([name,from,to])=>{
  const source=readFileSync(name,'utf8')
  assert.equal(source.split(from).length,2,'exactly one fixture substitution: '+name)
  return {name,source,changed:source.replace(from,to)}
 })
 try {
  for(const file of transforms)writeFileSync(file.name,file.changed)
  await main()
 } finally {
  for(const file of transforms)writeFileSync(file.name,file.source)
 }
}
isolated().catch(error=>{console.error(error);process.exitCode=1})
