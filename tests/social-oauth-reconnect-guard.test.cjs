const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const source=fs.readFileSync('app/api/content/social/delivery/route.ts','utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
function run(lastError){
  const calls=[]
  const db={from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{last_error:lastError},error:null})})})})}
  const exports={}
  const requireMock=n=>{
    if(n==='next/server')return {NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})}}
    if(n==='@/lib/content/auth')return {cronAuthorized:()=>true}
    if(n==='@/lib/supabase/admin')return {createAdminClient:()=>db}
    if(n==='@/lib/content/social-delivery')return {processSocialDelivery:async()=>{calls.push('dispatch');return {status:'sent'}}}
    throw Error('Unexpected import '+n)
  }
  vm.runInNewContext(js,{exports,require:requireMock,Date,Promise,Error,Boolean,JSON})
  return exports.GET({headers:{get:()=> 'valid-authorization'}}).then(result=>({result,calls}))
}
test('invalid_grant suppresses unattended submission',async()=>{
  const {result,calls}=await run('Delivery check failed at OAuth refresh: Metricool OAuth invalid_grant (HTTP 400). No automatic submission retry.')
  assert.equal(result.status,200)
  assert.equal(result.body.status,'reconnect_required')
  assert.deepEqual(calls,[])
})
test('invalid_client suppresses unattended submission',async()=>{
  const {result,calls}=await run('Delivery check failed at OAuth refresh: Metricool OAuth invalid_client (HTTP 400). No automatic submission retry.')
  assert.equal(result.body.status,'reconnect_required')
  assert.deepEqual(calls,[])
})
