const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const id='5094636c-be48-4ac3-ae7b-80acfb729c13';
async function run({admin=true,origin='https://www.cafe-sativa.com',promoId=id,character='zaria-solenne'}={}){
 const calls=[];const chain={select(){return this},eq(){return this},async single(){return {data:{id:promoId,character_id:character},error:null}}};
 const db={from(){calls.push('db');return chain},storage:{from(bucket){assert.equal(bucket,'cafe-sativa-content');return {async createSignedUploadUrl(path){calls.push(path);return {data:{token:'synthetic'},error:null}}}}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/admin/character-promotions/media/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require(name){if(name==='next/server')return {NextResponse:{json:(body,options)=>({body,...options})}};if(name==='node:crypto')return require(name);if(name==='@/lib/content/auth')return {isContentAdmin:async()=>admin};if(name==='@/lib/supabase/admin')return {createAdminClient:()=>db};throw Error(name)}});
 const result=await exports.POST({headers:{get:()=>origin},nextUrl:new URL('https://www.cafe-sativa.com/api/admin/character-promotions/media'),json:async()=>({promoId,sha256:'a'.repeat(64),size:2048,stage:'init'})});return {result,calls};
}
(async()=>{
 let r=await run();assert.equal(r.result.status,200);assert(r.calls.includes(`character-promos/zaria-solenne/${id}/${'a'.repeat(64)}.mp4`));
 for(const [options,status] of [[{admin:false},401],[{origin:'https://evil.test'},403],[{promoId:'1a8fcea0-ac1c-41ad-b72d-a4ce95cdb6fc'},400],[{character:'freja-ilunga'},409]]){r=await run(options);assert.equal(r.result.status,status);assert(!r.calls.some(x=>x.startsWith('character-promos/')))}
 const source=fs.readFileSync('app/api/admin/character-promotions/media/route.ts','utf8');assert(source.includes('voice_approved_at:null,video_qa_approved_at:null,publication_approved_at:null'));assert(source.includes('publicationScheduled:false'));
 console.log('PASS: exact Zaria upload only; auth/origin/character binding and no publication preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
