import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHeyGenBindingVerifier} from '../lib/content/character-production-provider-inventory.ts';
const config={linkId:'synthetic-account',model:'avatar_v'},binding={characterId:'synthetic',avatarId:'exact-avatar',voiceId:'exact-voice',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64)};
const look={id:binding.avatarId,status:'completed',error:null,supported_api_engines:['avatar_v']},voice={voice_id:binding.voiceId,status:'ACTIVE'};
const page=(items,has_more=false,next_token=null)=>({isError:false,content:[{type:'text',text:JSON.stringify({items,has_more,next_token})}]});
test('malformed errors oversized responses and envelopes fail closed',async()=>{
 for(const raw of [null,{}, {...page([look]),isError:true},{...page([look]),content:[]},{...page([look]),content:[{type:'text',text:'not json'}]},page(Array(101).fill(look)),page([look],true,null),page([look],true,'x'.repeat(2049)),{isError:false,content:[{type:'text',text:' '.repeat(1_000_001)}]}]) {
  let voices=0;const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(){return raw},async list_voices(){voices++;return page([voice])}});assert.equal(await verify(binding),false);assert.equal(voices,0);
 }
});
test('repeated tokens and more than five pages terminate without voice reads',async()=>{
 for(const repeat of [true,false]){let reads=0;const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(){reads++;return page([],true,repeat?'same':`next-${reads}`)},async list_voices(){throw Error('must not read')}});assert.equal(await verify(binding),false);assert.equal(reads,repeat?2:5)}
});
test('late providers ignoring abort and blocked event loops cannot approve',async()=>{
 for(const slow of [async()=>{await new Promise(r=>setTimeout(r,20));return page([look])},async()=>{const end=performance.now()+15;while(performance.now()<end){}return page([look])}]) {
  let voices=0,signal;const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(a,s){signal=s;return slow()},async list_voices(){voices++;return page([voice])}},5);assert.equal(await verify(binding),false);assert.equal(signal.aborted,true);assert.equal(voices,0);
 }
});
test('fresh read failures are not cached as prior availability',async()=>{
 let ok=true;const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(){if(!ok)throw Error('provider unavailable');return page([look])},async list_voices(){return page([voice])}});assert.equal(await verify(binding),true);ok=false;assert.equal(await verify(binding),false);
});
test('voice pagination is bounded and duplicate rows on later pages are ambiguous',async()=>{
 let count=0;const verify=createHeyGenBindingVerifier(config,{async list_avatar_looks(){return page([look])},async list_voices(a){count++;return a.token?page([voice]):page([voice],true,'next')}});assert.equal(await verify(binding),false);assert.equal(count,2);
});
