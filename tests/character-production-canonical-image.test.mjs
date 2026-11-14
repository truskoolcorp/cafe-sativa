import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createCanonicalImageRuntimeProvider} from '../lib/content/character-production-image-composition.ts'
import {imageApprovedAvatar,canonicalImageDigest,canonicalImagePath} from '../lib/content/character-production-canonical-image.ts'
import {heyGenBindingRevision} from '../lib/content/character-production-provider-heygen.ts'
import {createPrivateCanonicalImageSource} from '../lib/content/character-production-private-image.ts'
const hash=x=>createHash('sha256').update(x).digest('hex'),image=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]),sound=Buffer.from('ID3abcdefghijklmnop')
const proof={characterId:'zaria',canonicalRevision:'a'.repeat(64),portraitSha256:hash(image),imageBytes:image.length,mime:'image/png',audio:{characterId:'zaria',canonicalRevision:'a'.repeat(64),portraitSha256:hash(image),avatarId:'canonical-image-zaria',voiceId:'Bree',voiceModel:'eleven_v4',scriptSha256:hash('hello'),audioSha256:hash(sound),audioBytes:sound.length,mime:'audio/mpeg',provider:'elevenlabs',synthesisReceiptId:'existing-receipt'}}
const origin='https://example.supabase.co',source=(bucket,bytes)=>({origin,read:async()=>bytes,sign:async p=>origin+'/storage/v1/object/sign/'+bucket+'/'+p+'?token=private'})
const cfg={enabled:true,linkId:'account',model:'avatar_iv',aspectRatio:'16:9',bindings:[imageApprovedAvatar(proof)],mediaOrigins:['https://media.example.com'],timeoutMs:8000,maxVideoBytes:1000000}
const args={link_id:'account',avatarId:proof.audio.avatarId,voiceId:'Bree',script:'hello',engine:{type:'avatar_iv'},aspectRatio:'16:9',outputFormat:'mp4',resolution:'1080p'}
function setup(img=image,aud=sound){const requests=[];const api=createCanonicalImageRuntimeProvider(cfg,'exact-account',()=> 'fake-test-key',[proof],source('cafe-sativa-characters',img),source('character-production-audio',aud),async(url,init)=>{requests.push({url,body:init.body&&JSON.parse(init.body)});return Response.json({data:init.method==='GET'?{username:'exact-account'}:{video_id:'task',status:'waiting'}})});return {api,requests}}
test('exact image and existing audio use documented image union, no native avatar/script/voice/engine',async()=>{const{api,requests}=setup();assert.equal(await api.verifyBinding(cfg.bindings[0]),true);await api.transport.create_video_from_avatar(args,new AbortController().signal);const body=requests.at(-1).body;assert.equal(body.type,'image');assert.equal(body.image.type,'url');assert.match(body.image.url,/cafe-sativa-characters\/production-inputs/);for(const forbidden of ['avatar_id','image_url','script','voice_id','engine'])assert.equal(forbidden in body,false)})
test('corrupt image/audio, wrong script, model and capability cannot spend',async()=>{for(const [img,aud]of [[Buffer.alloc(image.length),sound],[image,Buffer.alloc(sound.length)]]){const{api,requests}=setup(img,aud);await assert.rejects(api.transport.create_video_from_avatar(args,new AbortController().signal));assert.equal(requests.length,0)}const{api,requests}=setup();for(const bad of [{...args,script:'wrong'},{...args,engine:{type:'avatar_v'}}])await assert.rejects(api.transport.create_video_from_avatar(bad,new AbortController().signal));assert.equal(requests.length,0)})
test('image mode is exact digest discriminator while legacy revision remains stable',()=>{const b=cfg.bindings[0],legacy={...b};delete legacy.imageBindingSha256;assert.notEqual(heyGenBindingRevision(cfg,b),heyGenBindingRevision(cfg,legacy));assert.throws(()=>canonicalImageDigest({...proof,canonicalRevision:'b'.repeat(64)}));assert.throws(()=>createCanonicalImageRuntimeProvider({...cfg,model:'avatar_v'},'account',()=>'', [proof],source('',image),source('',sound)))})
test('real Storage adapter private bounded readback then short signed exact path',async()=>{let signed=0;const sdk={getBucket:async()=>({data:{id:'cafe-sativa-characters',public:false,file_size_limit:10*1024*1024,allowed_mime_types:['image/png','image/jpeg','image/webp','application/json']},error:null}),from:()=>({download:()=>({asStream:async()=>({data:new ReadableStream({start(c){c.enqueue(image);c.close()}}),error:null})}),createSignedUrl:async(p,ttl)=>{assert.equal(ttl,300);signed++;return {data:{signedUrl:origin+'/storage/v1/object/sign/cafe-sativa-characters/'+p+'?token=x'},error:null}}})};const s=createPrivateCanonicalImageSource(sdk,origin,[proof]);await s.sign(canonicalImagePath(proof),new AbortController().signal);assert.equal(signed,1);sdk.getBucket=async()=>({data:{public:true},error:null});await assert.rejects(s.sign(canonicalImagePath(proof),new AbortController().signal));assert.equal(signed,1)})
test('reviewed Gallery scene keeps canonical identity separate from rendered image bytes',async()=>{
 const identity='c'.repeat(64)
 const scene={...proof,portraitSha256:identity,audio:{...proof.audio,portraitSha256:identity},approvedScene:{imageSha256:hash(image),approvalReference:'owner-approved-gallery-reference-test'}}
 const binding=imageApprovedAvatar(scene),config={...cfg,bindings:[binding]}
 assert.equal(binding.portraitSha256,identity)
 assert.equal(canonicalImagePath(scene),'production-inputs/'+hash(image)+'.png')
 const requests=[]
 const api=createCanonicalImageRuntimeProvider(config,'exact-account',()=> 'fake-test-key',[scene],source('cafe-sativa-characters',image),source('character-production-audio',sound),async(url,init)=>{requests.push({url,body:init.body&&JSON.parse(init.body)});return Response.json({data:init.method==='GET'?{username:'exact-account'}:{video_id:'task',status:'waiting'}})})
 assert.equal(await api.verifyBinding(binding),true)
 await api.transport.create_video_from_avatar(args,new AbortController().signal)
 assert.match(requests.at(-1).body.image.url,new RegExp(hash(image)))
 assert.doesNotMatch(requests.at(-1).body.image.url,new RegExp(identity))
 const digest=canonicalImageDigest(scene)
 for(const changed of [{...scene,approvedScene:{...scene.approvedScene,imageSha256:'d'.repeat(64)}},{...scene,approvedScene:{...scene.approvedScene,approvalReference:'different-approval'}},{...scene,portraitSha256:'e'.repeat(64),audio:{...scene.audio,portraitSha256:'e'.repeat(64)}}])assert.notEqual(canonicalImageDigest(changed),digest)
 for(const changed of [{...scene,approvedScene:{imageSha256:hash(image)}},{...scene,approvedScene:{...scene.approvedScene,imageSha256:'bad'}},{...scene,audio:{...scene.audio,portraitSha256:hash(image)}}])assert.throws(()=>canonicalImageDigest(changed))
})
test('scene proof snapshot cannot be changed after provider composition',async()=>{
 const scene={...proof,approvedScene:{imageSha256:hash(image),approvalReference:'reviewed-scene'}}
 const config={...cfg,bindings:[imageApprovedAvatar(scene)]},requests=[]
 const api=createCanonicalImageRuntimeProvider(config,'exact-account',()=> 'fake-test-key',[scene],source('cafe-sativa-characters',image),source('character-production-audio',sound),async(url,init)=>{requests.push({url,body:init.body&&JSON.parse(init.body)});return Response.json({data:{video_id:'task',status:'waiting'}})})
 scene.approvedScene.imageSha256='f'.repeat(64)
 await api.transport.create_video_from_avatar(args,new AbortController().signal)
 assert.match(requests.at(-1).body.image.url,new RegExp(hash(image)))
})
