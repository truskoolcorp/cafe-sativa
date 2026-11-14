import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHeyGenProductionProvider,decodeVerifiedHeyGenCompleted,fetchVerifiedMedia,isPublicMediaIPv4,heyGenBindingRevision,validateHeyGenProductionConfig} from '../lib/content/character-production-provider-heygen.ts';
const binding={characterId:'synthetic',avatarId:'synthetic-avatar',voiceId:'synthetic-voice',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64)};
const config={enabled:true,linkId:'synthetic-link',model:'avatar_v',bindings:[binding],mediaOrigins:['https://files2.heygen.ai'],timeoutMs:100,maxVideoBytes:1024};
const revision=heyGenBindingRevision(config,binding);
const slot={...binding,providerBindingRevision:revision,provider:'heygen',model:'avatar_v',script:'Say exactly this.',authorizationExpiresAt:Date.now()+60000};
function setup(c=config,overrides={}){const calls=[];const transport={async create_video_from_avatar(a){calls.push(['create',a]);return {taskId:'synthetic-task'}},async get_video(a){calls.push(['get',a]);return {taskId:a.videoId,state:'pending'}},...overrides};return {p:createHeyGenProductionProvider(c,transport,{receipt:r=>r,status:r=>r}),calls}}
test('provider defaults disabled with no connector calls',async()=>{const x=setup({...config,enabled:undefined});await assert.rejects(x.p.submit(slot),/disabled/);await assert.rejects(x.p.collect('task',revision),/disabled/);assert.equal(x.calls.length,0)});
test('frozen exact avatar voice model mapping and verbatim script',async()=>{const c=structuredClone(config),x=setup(c);c.bindings[0].avatarId='changed';c.model='avatar_iv';await x.p.submit(slot);assert.deepEqual(x.calls[0][1],{link_id:'synthetic-link',avatarId:'synthetic-avatar',voiceId:'synthetic-voice',script:slot.script,engine:{type:'avatar_v'},aspectRatio:'9:16',outputFormat:'mp4',resolution:'1080p'})});
test('canonical drift unknown character expired authority and binding mismatch reject writes',async()=>{const x=setup();for(const bad of [{voiceId:'wrong'},{portraitSha256:'c'.repeat(64)},{canonicalRevision:'c'.repeat(64)},{model:'avatar_iv'},{provider:'other'},{characterId:'unknown'},{authorizationExpiresAt:0},{providerBindingRevision:'c'.repeat(64)}])await assert.rejects(x.p.submit({...slot,...bad}));assert.equal(x.calls.length,0)});
test('uncertain writes time out once without retry',async()=>{let writes=0;const x=setup({...config,timeoutMs:5},{create_video_from_avatar:()=>{writes++;return new Promise(()=>{})}});await assert.rejects(x.p.submit(slot),/deadline/);assert.equal(writes,1)});
test('polls only original task and throttles repeated reads',async()=>{const x=setup();assert.deepEqual(await x.p.collect('original',revision),{state:'pending'});await x.p.collect('original',revision);assert.deepEqual(x.calls,[['get',{link_id:'synthetic-link',videoId:'original'}]])});
test('mismatched returned task fails closed',async()=>{const x=setup(config,{get_video:async()=>({taskId:'different',state:'failed'})});await assert.rejects(x.p.collect('original',revision),/Mismatched/)});
test('account avatar or absent durable binding revision prevents reads and writes',async()=>{for(const c of [{...config,linkId:'other-account'},{...config,bindings:[{...binding,avatarId:'other-avatar'}]}]){const x=setup(c);await assert.rejects(x.p.submit(slot));await assert.rejects(x.p.collect('original',revision));assert.equal(x.calls.length,0)}const x=setup();await assert.rejects(x.p.collect('original'));assert.equal(x.calls.length,0)});
test('binding revision commits all fields in order-independent projection',()=>{for(const key of Object.keys(binding)){const value=key.endsWith('Revision')||key.endsWith('Sha256')?'d'.repeat(64):'changed';assert.notEqual(heyGenBindingRevision(config,{...binding,[key]:value}),revision)}assert.equal(heyGenBindingRevision(config,Object.fromEntries(Object.entries(binding).reverse())),revision);assert.notEqual(heyGenBindingRevision({...config,model:'avatar_iv'},binding),revision)});
test('config validator rejects invalid disabled or ambiguous config locally',()=>{assert.doesNotThrow(()=>validateHeyGenProductionConfig(config));for(const invalid of [{enabled:false},{bindings:[]},{bindings:[binding,binding]},{bindings:[null]},{mediaOrigins:[]},{mediaOrigins:['http://unsafe.example']},{model:'invented'},{maxVideoBytes:0}])assert.throws(()=>validateHeyGenProductionConfig({...config,...invalid}))});
test('untrusted media location is rejected before DNS or HTTP',async()=>{for(const url of ['http://files2.heygen.ai/video','https://evil.example/video','https://files2.heygen.ai@127.0.0.1/video','https://files2.heygen.ai:444/video','https://files2.heygen.ai/video#fragment'])await assert.rejects(fetchVerifiedMedia(url,config.mediaOrigins,1024,Date.now()+100))});
test('public IPv4 filter excludes private metadata special and IPv6 addresses',()=>{for(const address of ['127.0.0.1','10.2.3.4','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.1.1.1','::1','::ffff:127.0.0.1','2001:4860:4860::8888'])assert.equal(isPublicMediaIPv4(address),false,address);assert.equal(isPublicMediaIPv4('8.8.8.8'),true)});
test('verified completed decoder rejects errors and unverified envelopes',()=>{const raw={isError:false,structuredContent:{outputType:'video.player',videoId:'task',status:'completed',videoUrl:'https://files2.heygen.ai/video'}};assert.deepEqual(decodeVerifiedHeyGenCompleted(raw),{taskId:'task',state:'completed',mediaUrl:raw.structuredContent.videoUrl});for(const bad of [{},{...raw,isError:true},{...raw,structuredContent:{...raw.structuredContent,status:'processing'}}])assert.throws(()=>decodeVerifiedHeyGenCompleted(bad))});
import https from 'node:https';
import dnsPromises from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
test('network-boundary mocks verify DNS pinning redirect byte and time caps',async()=>{
 const originalRequest=https.request,originalLookup=dnsPromises.lookup;let mode='ok',requests=0;
 dnsPromises.lookup=async()=>[{address:'8.8.8.8',family:4}];
 https.request=(_url,options,onResponse)=>{
  requests++;const req=new EventEmitter();let res;req.destroy=()=>{res?.destroy();return req};
  req.end=()=>queueMicrotask(()=>{res=new PassThrough();res.statusCode=mode==='redirect'?302:200;res.headers={'content-type':'video/mp4'};if(mode==='length')res.headers['content-length']='100000';onResponse(res);if(mode==='slow')return;res.end(mode==='oversized'?Buffer.alloc(2048):Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]))});
  options.signal.addEventListener('abort',()=>{req.destroy();req.emit('error',Error('aborted'))},{once:true});
  options.lookup('files2.heygen.ai',{},(e,a,f)=>{assert.equal(e,null);assert.equal(a,'8.8.8.8');assert.equal(f,4)});
  options.lookup('files2.heygen.ai',{all:true},(e,a)=>assert.deepEqual(a,[{address:'8.8.8.8',family:4}]));return req;
 };syncBuiltinESMExports();
 try{const read=()=>fetchVerifiedMedia('https://files2.heygen.ai/test',config.mediaOrigins,1024,Date.now()+40);assert.equal((await read()).length,16);for(const next of ['redirect','length','oversized','slow']){mode=next;await assert.rejects(read())}assert.equal(requests,5);dnsPromises.lookup=async()=>[{address:'127.0.0.1',family:4}];syncBuiltinESMExports();await assert.rejects(read(),/Nonpublic/);assert.equal(requests,5)}finally{https.request=originalRequest;dnsPromises.lookup=originalLookup;syncBuiltinESMExports()}
});
test('queued submission never dispatches after caller blocks beyond expiry',async()=>{
 const x=setup({...config,timeoutMs:1000});
 const attempt=x.p.submit({...slot,authorizationExpiresAt:Date.now()+10});
 const until=performance.now()+25;while(performance.now()<until){}
 await assert.rejects(attempt,/deadline/);assert.equal(x.calls.length,0);
});
test('queued submission checks monotonic budget and wall rollback before dispatch',async()=>{
 const originalNow=Date.now;
 try{
  for(const rollback of [false,true]){
   const started=originalNow();Date.now=()=>started;
   const x=setup({...config,timeoutMs:5});const attempt=x.p.submit({...slot,authorizationExpiresAt:started+1000});
   if(rollback)Date.now=()=>started-1;
   else {const until=performance.now()+15;while(performance.now()<until){}}
   await assert.rejects(attempt,/deadline/);assert.equal(x.calls.length,0);
  }
 }finally{Date.now=originalNow}
});
test('explicit widescreen master is bound to new authorization, legacy portrait cannot be reused',async()=>{const c={...config,aspectRatio:'16:9'},rev=heyGenBindingRevision(c,binding),x=setup(c);assert.notEqual(rev,revision);await assert.rejects(x.p.submit(slot),/mismatch/);assert.equal(x.calls.length,0);await x.p.submit({...slot,providerBindingRevision:rev});assert.equal(x.calls[0][1].aspectRatio,'16:9');assert.equal(heyGenBindingRevision({...config,aspectRatio:'9:16'},binding),revision)})
test('unsupported output format fails before provider calls',async()=>{const c={...config,aspectRatio:'1:1'};assert.throws(()=>validateHeyGenProductionConfig(c));assert.throws(()=>heyGenBindingRevision(c,binding));const x=setup(c);await assert.rejects(x.p.submit(slot));assert.equal(x.calls.length,0)})
