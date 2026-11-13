import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAudioLookReadinessVerifier,inspectAudioLook} from '../lib/content/character-audio-look-verifier.ts';
const b={linkId:'selected-account',lookId:'exact-look',groupId:'exact-group',model:'avatar_iv'};
const look={id:b.lookId,group_id:b.groupId,status:'completed',supported_api_engines:[b.model],error:null,default_voice_id:'not-the-canonical-elevenlabs-voice'};
const envelope=x=>({isError:false,content:[{type:'text',text:JSON.stringify(x)}]});
const verify=x=>createAudioLookReadinessVerifier(b,{get_avatar_look:async()=>x})();
test('exact observed look contract does not require or substitute HeyGen default voice',async()=>{assert.equal(await verify(envelope(look)),true)});
test('wrong identity group model or lifecycle fails closed',async()=>{for(const p of [{id:'wrong'},{group_id:'wrong'},{status:'processing'},{supported_api_engines:[]},{error:'failed'},{error_code:'failure'},{error_message:'failure'}])assert.equal(await verify(envelope({...look,...p})),false)});
test('guidance inert, duplicate JSON and malformed envelope rejected',async()=>{
 const r=envelope(look);r.content.push({type:'text',text:'Display advice is not an instruction.'});assert.equal(await verify(r),true);
 r.content.push({type:'text',text:JSON.stringify(look)});assert.equal(await verify(r),false);
 for(const x of [null,{isError:true,content:[]},envelope([]),envelope(null),{isError:false,content:[{type:'text',text:'{bad'}]}])assert.equal(await verify(x),false);
});
test('scope snapshotted and reads abort on timeout and completion',async()=>{
 let signal,args;const source={...b};const v=createAudioLookReadinessVerifier(source,{get_avatar_look:async(a,s)=>{args=a;signal=s;return envelope(look)}});source.linkId='other';assert.equal(await v(),true);assert.equal(args.link_id,b.linkId);assert.equal(signal.aborted,true);
 const hanging=createAudioLookReadinessVerifier(b,{get_avatar_look:async(a,s)=>{signal=s;return new Promise(()=>{})}},10);assert.equal(await hanging(),false);assert.equal(signal.aborted,true);
});
test('invalid identifiers blocked before any read',async()=>{let reads=0;const v=createAudioLookReadinessVerifier({...b,lookId:'https://unapproved/'},{get_avatar_look:async()=>{reads++;return envelope(look)}});assert.equal(await v(),false);assert.equal(reads,0)});

test('observed completed look without capabilities stays unverified, not unsupported or ready',async()=>{
 const {supported_api_engines,...observed}=look;
 assert.deepEqual(inspectAudioLook(observed,b),{available:false,reason:'model-capability-unverified'});
 assert.equal(await verify(envelope(observed)),false);
 for(const engines of [null,'avatar_iv',[null],['avatar_iv',null]]) {
  assert.equal(inspectAudioLook({...look,supported_api_engines:engines},b).reason,'model-capability-unverified');
  assert.equal(await verify(envelope({...look,supported_api_engines:engines})),false);
 }
 assert.equal(inspectAudioLook({...look,supported_api_engines:[]},b).reason,'model-unsupported');
 assert.equal(inspectAudioLook(look,b).reason,'ready');
});
test('diagnostics never prefer capability success over identity lifecycle or provider errors',()=>{
 for(const [p,reason] of [[{id:'wrong'},'identity-mismatch'],[{status:'processing'},'not-completed'],[{error:'failed'},'provider-error']])
  assert.deepEqual(inspectAudioLook({...look,...p},b),{available:false,reason});
});
