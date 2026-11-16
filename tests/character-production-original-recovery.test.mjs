import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createOriginalRecoveryHandler,originalRecovery as r} from '../lib/content/character-production-original-recovery.ts'
const request=(bytes=Buffer.alloc(0))=>new Request('https://cafe.example/api/admin/recovery',{method:'POST',headers:{origin:'https://cafe.example','content-type':'video/mp4','content-length':String(r.bytes)},body:bytes})
test('unauthorized and expired requests never open backend or upload',async()=>{
 for(const [auth,now,status]of [[false,r.start+1,401],[true,r.start-1,409],[true,r.end,409]]){
 let opened=0;const h=createOriginalRecoveryHandler({authorize:async()=>auth,now:()=>now,open:()=>{opened++;throw Error('forbidden')}})
 assert.equal((await h(request())).status,status);assert.equal(opened,0)}
})
test('wrong method, parameters, MIME, size and bytes never open backend',async()=>{
 let opened=0;const h=createOriginalRecoveryHandler({authorize:async()=>true,now:()=>r.start+1,open:()=>{opened++;throw Error('forbidden')}})
 assert.equal((await h(new Request('https://cafe.example/recovery'))).status,405)
 assert.equal((await h(new Request('https://cafe.example/recovery?task=foreign',{method:'POST'}))).status,405)
 assert.equal((await h(new Request('https://cafe.example/recovery',{method:'POST',headers:{origin:'https://cafe.example'},body:'bad'}))).status,400)
 assert.equal((await h(request(Buffer.alloc(r.bytes)))).status,400);assert.equal(opened,0)
})
test('manual original output local integration only; never loads production credentials',{skip:!process.env.RECOVERY_TEST_MP4},async()=>{
 const bytes=readFileSync(process.env.RECOVERY_TEST_MP4);let state='submitted',stored=null,uploads=0,commits=0
 const job={key:r.key,digest:r.digest,taskId:r.taskId,token:'synthetic-token',provider:'heygen',model:'avatar_iv',providerBindingRevision:'a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0'}
 const h=createOriginalRecoveryHandler({authorize:async()=>true,now:()=>r.start+1,open:()=>({read:async()=>({job,state}),commit:async passed=>{assert.deepEqual(passed,job);state='pending_qa';commits++;return true},whenSettled:async()=>{},storage:{privateBucket:async()=>true,insert:async(path,b)=>{assert.equal(path,r.digest+'/'+r.sha+'.mp4');uploads++;stored=Buffer.from(b)},read:async()=>stored}})})
 const res=await h(request(bytes));assert.equal(res.status,200);const result=await res.json();assert.equal(result.manualRecovery,true);assert.equal(result.newRender,false);assert.equal(result.publicationApproved,false);assert.equal(JSON.stringify(result).includes('synthetic-token'),false)
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await h(request(bytes))).status,200);assert.equal(uploads,1);assert.equal(commits,2)
})

test('missing or foreign Origin rejected before authentication and auth exceptions fail closed',async()=>{
 let auth=0
 const h=createOriginalRecoveryHandler({authorize:async()=>{auth++;throw Error('private authentication detail')},now:()=>r.start+1,open:()=>{throw Error('must not open')}})
 for(const origin of [null,'https://foreign.example']){const headers=origin?{origin}:{};assert.equal((await h(new Request('https://cafe.example/recovery',{method:'POST',headers}))).status,403)}
 assert.equal(auth,0)
 const response=await h(request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private authentication detail/);assert.equal(auth,1)
})
