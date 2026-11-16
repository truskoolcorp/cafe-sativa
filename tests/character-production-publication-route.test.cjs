const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/content/character-production-publication-route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:e,require:n=>{
 if(n==='server-only')return {}
 if(n==='./auth')return {cronAuthorized:h=>h==='Bearer fixture'}
 if(n==='./character-production-publication-runtime')return {createCafePublicationRuntime:()=>{throw Error('Must remain unconfigured')}}
 throw Error(n)
},Request,Response,URL})
test('route remains unconfigured with correct authentication',async()=>{const r=await e.cafePublicationGET(new Request('https://cafe.test/api',{headers:{authorization:'Bearer fixture'}}));assert.equal(r.status,503);assert.equal((await r.json()).status,'unconfigured')})
test('route rejects absent auth and caller query/body',async()=>{
 assert.equal((await e.cafePublicationGET(new Request('https://cafe.test/api'))).status,401)
 assert.equal((await e.cafePublicationGET(new Request('https://cafe.test/api?planId=foreign',{headers:{authorization:'Bearer fixture'}}))).status,405)
 assert.equal((await e.cafePublicationGET(new Request('https://cafe.test/api',{method:'POST',body:'{}',headers:{authorization:'Bearer fixture'}}))).status,405)
})
