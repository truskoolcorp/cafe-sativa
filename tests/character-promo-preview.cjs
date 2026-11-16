const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const id='573fb8db-a215-491f-8efc-0f48153f2d85',path=`character-promos/laviche-fea/${id}/${'a'.repeat(64)}.mp4`;
async function run({admin=true,query=id,row={id,character_id:'laviche-fea',video_asset_path:path},dbError=null,signError=null}={}) {
 const calls=[]; const chain={select(fields){calls.push(['select',fields]);return this},eq(field,value){calls.push(['eq',field,value]);return this},async maybeSingle(){return {data:row,error:dbError}}};
 const db={from(table){calls.push(['table',table]);return chain},storage:{from(bucket){calls.push(['bucket',bucket]);return {async createSignedUrl(object,ttl){calls.push(['sign',object,ttl]);return {data:{signedUrl:'https://example.supabase.co/private?token=short-lived'},error:signError}}}}}};
 const exports={};const context={exports,require(name){if(name==='next/server')return {NextResponse:{json:(body,options)=>({body,...options})}};if(name==='@/lib/content/auth')return {isContentAdmin:async()=>admin};if(name==='@/lib/supabase/admin')return {createAdminClient:()=>{calls.push(['open']);return db}};throw Error(name)}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/admin/character-promotions/preview/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
 const result=await exports.GET({nextUrl:new URL(`https://www.cafe-sativa.com/api/admin/character-promotions/preview?id=${encodeURIComponent(query)}`)});
 assert.equal(result.headers['Cache-Control'],'private, no-store');assert.equal(result.headers['Referrer-Policy'],'no-referrer');return {result,calls};
}
(async()=>{
 let r=await run({admin:false});assert.equal(r.result.status,401);assert.equal(r.calls.length,0);
 r=await run({query:'../../foreign'});assert.equal(r.result.status,400);assert.equal(r.calls.length,0);
 r=await run({row:null});assert.equal(r.result.status,404);assert(!r.calls.some(c=>c[0]==='sign'));
 for(const bad of ['https://evil.test/file.mp4',path.replace(id,'00000000-0000-0000-0000-000000000000'),path.replace('laviche-fea','keith'),path+'/../other.mp4']){
  r=await run({row:{id,character_id:'laviche-fea',video_asset_path:bad}});assert.equal(r.result.status,409);assert(!r.calls.some(c=>c[0]==='sign'));
 }
 r=await run({dbError:Error('secret')});assert.equal(r.result.status,503);assert(!JSON.stringify(r.result).includes('secret'));
 r=await run({signError:Error('secret')});assert.equal(r.result.status,503);assert(!JSON.stringify(r.result).includes('secret'));
 r=await run();assert.equal(r.result.body.expiresInSeconds,300);assert.equal(r.result.body.previewUrl,'https://example.supabase.co/private?token=short-lived');assert.deepEqual(r.calls.find(c=>c[0]==='sign'),['sign',path,300]);assert(r.calls.some(c=>c[0]==='bucket'&&c[1]==='cafe-sativa-content'));
 const page=fs.readFileSync('app/admin/character-promotions/page.tsx','utf8');assert(page.includes('<video'));assert(page.includes('Read spoken script'));assert(page.includes('Viewing does not approve or publish'));assert(!page.includes('autoPlay'));assert(page.includes('delete next[id]'));assert.equal((page.match(/disabled=\{busy \|\| previewBusy!==null\}/g)||[]).length,2);
 console.log('PASS: authenticated private preview, exact row/path binding, 5-minute expiry, no cache, error sanitization, script/player and no autoplay.');
})().catch(e=>{console.error(e);process.exitCode=1});
