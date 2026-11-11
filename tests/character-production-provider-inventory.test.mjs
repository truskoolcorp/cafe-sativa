import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHeyGenBindingVerifier} from '../lib/content/character-production-provider-inventory.ts';
const config={linkId:'synthetic-account',model:'avatar_v'};
const binding={characterId:'synthetic',avatarId:'avatar-exact',voiceId:'voice-exact',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64)};
const look={id:binding.avatarId,status:'completed',error:null,supported_api_engines:['avatar_v']};
const voice={voice_id:binding.voiceId,status:'ACTIVE'};
const page=(items,has_more=false,next_token=null)=>({isError:false,content:[{type:'text',text:JSON.stringify({items,has_more,next_token})}]});
function setup(l=page([look]),v=page([voice]),c=config){const calls=[];return {calls,verify:createHeyGenBindingVerifier(c,{async list_avatar_looks(a){calls.push(['looks',a]);return l},async list_voices(a){calls.push(['voices',a]);return v}})}}
test('exact private look model and active voice match verified read contracts',async()=>{
 const x=setup();assert.equal(await x.verify(binding),true);assert.deepEqual(x.calls,[['looks',{link_id:config.linkId,ownership:'private',limit:50}],['voices',{link_id:config.linkId,type:'private',limit:100}]]);
});
test('look mismatch, missing capability, errors, and non-ready status block voice reads',async()=>{
 for(const patch of [{id:'other',name:binding.avatarId},{status:'processing'},{supported_api_engines:['avatar_iv']},{error:'bad'},{error_code:'bad'},{error_message:'bad'}]){const x=setup(page([{...look,...patch}]));assert.equal(await x.verify(binding),false);assert.equal(x.calls.length,1)}
});
test('missing or inactive exact voice cannot be replaced by name/default',async()=>{
 for(const rows of [[],[{...voice,voice_id:'other',name:binding.voiceId}],[{...voice,status:'inactive'}],[{...voice,status:'active'}]])assert.equal(await setup(page([look]),page(rows)).verify(binding),false);
});
test('bounded pagination follows only returned tokens and detects duplicate exact IDs',async()=>{
 const calls=[];const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(a){calls.push(a);return a.token?page([look]):page([],true,'next')},async list_voices(){return page([voice])}});
 assert.equal(await verify(binding),true);assert.equal(calls[1].token,'next');
 assert.equal(await setup(page([look,look])).verify(binding),false);assert.equal(await setup(page([look]),page([voice,voice])).verify(binding),false);
});
test('scope is frozen and malformed expected IDs are rejected locally',async()=>{
 const c={...config},x=setup(undefined,undefined,c);c.linkId='other';c.model='avatar_iv';assert.equal(await x.verify(binding),true);assert.equal(x.calls[0][1].link_id,config.linkId);
 const bad=setup();assert.equal(await bad.verify({...binding,voiceId:{toString:()=>binding.voiceId}}),false);assert.equal(bad.calls.length,0);
});
