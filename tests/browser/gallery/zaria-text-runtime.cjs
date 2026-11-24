const assert=require('node:assert/strict')
const http=require('node:http')
const {spawn}=require('node:child_process')
const {chromium}=require('playwright')
const app='http://127.0.0.1:4392'
const dataOrigin='http://127.0.0.1:4393'
const art={id:'qa-art',slug:'qa-art',title:'QA Artwork',description:'Synthetic Gallery-only work.',kind:'digital',price_cents:1200,currency:'usd',primary_image_url:null,stock_count:1,artist_id:'a',artist_slug:'qa-artist',artist_name:'QA Artist',artist_avatar:null,created_at:'2025-01-01T00:00:00Z'}
const fixture=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',app);res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Content-Type','application/json')
 if(req.method==='OPTIONS'){res.writeHead(204).end();return}
 const u=new URL(req.url,dataOrigin)
 if(u.pathname==='/rest/v1/gallery_v')return res.end(JSON.stringify(!u.searchParams.get('slug')||u.searchParams.get('slug')==='eq.qa-art'?[art]:[]))
 return res.end('[]')
})
const img=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')
async function main(){
 await new Promise(resolve=>fixture.listen(4393,'127.0.0.1',resolve))
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:dataOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT:'true',CS_ZARIA_GALLERY_PORTRAIT:'true',CS_LIVEKIT_ENABLED:'false'}
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
  browser=await chromium.launch({headless:true})
  for(const viewport of [{width:390,height:844},{width:1440,height:960}]){
   const page=await browser.newPage({viewport})
   const turns=[]
   let portraitFetches=0
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url())
    if(u.origin!==app && u.origin!==dataOrigin)return route.abort()
    if(u.pathname==='/api/hosts/portrait'&&u.searchParams.get('host')==='zaria'){
     portraitFetches++;return route.fulfill({status:200,contentType:'image/png',body:img})
    }
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
   assert.ok(portraitFetches>0)
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
  console.log('PASS: actual Next Gallery to Zaria selected-work text to artwork at 390 and 1440 pixels; test-only API and portrait; no provider or voice')
 }catch(error){console.error(serverLog);throw error}
 finally{await browser?.close();next.kill('SIGTERM');fixture.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
