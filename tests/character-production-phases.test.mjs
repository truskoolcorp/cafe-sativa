import test from 'node:test'
import assert from 'node:assert/strict'
import {createHeyGenProductionProvider,heyGenBindingRevision,validateHeyGenProductionConfig} from '../lib/content/character-production-provider-heygen.ts'
const b={characterId:'synthetic',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64),voiceId:'voice',avatarId:'avatar'}
const config={enabled:true,linkId:'account',model:'avatar_iv',bindings:[b],mediaOrigins:['https://media.example.com'],timeoutMs:5,maxVideoBytes:100,phases:{prepareMs:80,submitMs:80,statusMs:20,downloadMs:120,totalMs:160}}
const slot=()=>({key:'test',characterId:b.characterId,canonicalRevision:b.canonicalRevision,portraitSha256:b.portraitSha256,voiceId:b.voiceId,providerBindingRevision:heyGenBindingRevision(config,b),provider:'heygen',model:'avatar_iv',authorizationExpiresAt:Date.now()+1000,script:'test'})
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const codecs={receipt:x=>x,status:x=>x}
test('read-only preparation has own bound and paid request receives fresh live signal',async()=>{
 let paid=0
 const transport={create_video_from_avatar:async()=>{throw Error('must not use compound submit')},get_video:async()=>{},prepare_video_from_avatar:async(args,signal)=>{await delay(15);assert.equal(signal.aborted,false);return async paidSignal=>{assert.equal(signal.aborted,true);assert.equal(paidSignal.aborted,false);paid++;await delay(15);return {taskId:'original'}}}}
 const provider=createHeyGenProductionProvider(config,transport,codecs)
 assert.deepEqual(await provider.submit(slot()),{taskId:'original'});assert.equal(paid,1)
})
test('expired preparation cannot dispatch paid call even if eventual preparation ignores abort',async()=>{
 let paid=0
 const provider=createHeyGenProductionProvider({...config,phases:{...config.phases,prepareMs:5}}, {create_video_from_avatar:async()=>{},get_video:async()=>{},prepare_video_from_avatar:async()=>{await delay(30);return async()=>{paid++;return {taskId:'bad'}}}},codecs)
 await assert.rejects(provider.submit(slot()));await delay(35);assert.equal(paid,0)
})
test('paid timeout is never retried',async()=>{
 let paid=0
 const provider=createHeyGenProductionProvider({...config,phases:{...config.phases,submitMs:5}}, {create_video_from_avatar:async()=>{},get_video:async()=>{},prepare_video_from_avatar:async()=>async()=>{paid++;await delay(30);return {taskId:'late'}}},codecs)
 await assert.rejects(provider.submit(slot()));await delay(35);assert.equal(paid,1)
})
test('phase settings require bounded sums and prepared transport, legacy settings unchanged',async()=>{
 for(const phases of [{...config.phases,totalMs:100},{...config.phases,submitMs:Infinity},{...config.phases,unknown:1}])assert.throws(()=>validateHeyGenProductionConfig({...config,phases}))
 let calls=0;const transport={create_video_from_avatar:async()=>{calls++;return {taskId:'legacy'}},get_video:async()=>{}}
 await assert.rejects(createHeyGenProductionProvider(config,transport,codecs).submit(slot()));assert.equal(calls,0)
 const legacy={...config,timeoutMs:100};delete legacy.phases
 assert.deepEqual(await createHeyGenProductionProvider(legacy,transport,codecs).submit(slot()),{taskId:'legacy'});assert.equal(calls,1)
})
test('authorization expiring during preparation never reaches paid phase',async()=>{
 let paid=0
 const p=createHeyGenProductionProvider(config,{create_video_from_avatar:async()=>{},get_video:async()=>{},prepare_video_from_avatar:async()=>{await delay(30);return async()=>{paid++;return {taskId:'forbidden'}}}},codecs)
 await assert.rejects(p.submit({...slot(),authorizationExpiresAt:Date.now()+5}));await delay(40);assert.equal(paid,0)
})
test('status lookup gets a separate explicit bound without retrying original task',async()=>{
 let reads=0
 const p=createHeyGenProductionProvider(config,{create_video_from_avatar:async()=>{},get_video:async()=>{reads++;await delay(10);return {state:'pending',taskId:'existing'}}},codecs)
 assert.deepEqual(await p.collect('existing',heyGenBindingRevision(config,b)),{state:'pending'})
 assert.equal(reads,1)
})
test('real bounded provider network and direct API honor independent POST/GET bounds',async()=>{
 const {createProductionFetch,createProductionProviderFetch}=await import('../lib/content/character-production-bounded-fetch.ts')
 const {createDirectHeyGenApi}=await import('../lib/content/character-production-heygen-direct.ts')
 const tick=new AbortController();let calls=0
 const fake=async(_url,init)=>{calls++;await delay(25);if(init.signal.aborted)throw Error('aborted');return Response.json({data:{id:'existing',status:'pending'}})}
 const network=createProductionProviderFetch(tick.signal,fake,100)
 const api=createDirectHeyGenApi(()=> 'synthetic',network.fetch,5,80)
 assert.equal((await api.video('existing',new AbortController().signal)).data.id,'existing')
 assert.throws(()=>createProductionFetch(tick.signal,fake,10001))
 await assert.rejects(network.fetch('https://unverified.example.com/'));assert.equal(calls,1)
 tick.abort();await assert.rejects(api.video('existing',new AbortController().signal));await network.whenSettled()
})
test('production composition separates backend and provider transport and tracks both',async()=>{
 const {readFileSync}=await import('node:fs')
 const s=readFileSync(new URL('../lib/content/character-production-server-composition.ts',import.meta.url),'utf8')
 assert.match(s,/const network=createProductionFetch\(signal\)/)
 assert.match(s,/createProductionProviderFetch\(signal,fetch,phases\?Math.max\(phases.submitMs,phases.statusMs\):8000,/)
 assert.match(s,/createAdminClient\(network.fetch\)/)
 assert.match(s,/manifest.images,images,audio,providerNetwork.fetch\)/)
 assert.match(s,/providerNetwork.whenSettled\(\)/)
})
test('composed provider transport no longer silently enforces former 8-second ceiling',{timeout:12000},async()=>{
 const {createProductionProviderFetch}=await import('../lib/content/character-production-bounded-fetch.ts')
 const {createDirectHeyGenApi}=await import('../lib/content/character-production-heygen-direct.ts')
 const tick=new AbortController()
 const network=createProductionProviderFetch(tick.signal,async(_url,init)=>{
  await delay(8100);if(init.signal.aborted)throw Error('unexpected old deadline');return Response.json({data:{id:'original',status:'pending'}})
 },10000)
 const api=createDirectHeyGenApi(()=> 'synthetic',network.fetch,1000,10000)
 assert.equal((await api.video('original',new AbortController().signal)).data.id,'original')
 await network.whenSettled();tick.abort()
})
