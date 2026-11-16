const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const event='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let grant={conversationId:'conversation',userId:'owner',host:'laviche'},owner=true,canon=true,count=0,existing=null,insertError=null,lookupError=null,inserts=0;
const db={from(table){let write=null;const q={select(){return q},eq(){return q},gte(){return q},insert(value){write=value;return q},maybeSingle:async()=>({data:table==='host_conversations'?{authorized:owner}:existing,error:lookupError}),then(resolve,reject){if(write){inserts++;if(!insertError)existing=write;return Promise.resolve({error:insertError}).then(resolve,reject)}return Promise.resolve({count,error:null}).then(resolve,reject)}};return q}};
const env={CS_LIVEKIT_ENABLED:'true',CS_LIVEKIT_BRIDGE_SECRET:'test'};
const scope={exports:{},Response,Date,process:{env},require(n){
 if(n.endsWith('/livekit-session'))return {verifyVoiceSession:()=>grant};
 if(n.endsWith('/admin'))return {createAdminClient:()=>db};
 if(n.endsWith('/concierge-canon'))return {canonicalConciergeHost:async()=>canon?{voiceId:'approved'}:null};
 if(n.endsWith('/conversation-access'))return {conversationMatchesRequester:r=>r?.authorized};
 throw Error(n);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/concierge/livekit/memory/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
const req=body=>({headers:{get:()=> 'Bearer signed'},json:async()=>body});
const turn={event_id:event,role:'user',content:'Hello Café Sativa'};
(async()=>{
 env.CS_LIVEKIT_ENABLED='false';assert.equal((await scope.exports.POST(req(turn))).status,503);env.CS_LIVEKIT_ENABLED='true';
 const realGrant=grant;grant=null;assert.equal((await scope.exports.POST(req(turn))).status,401);grant=realGrant;
 for(const patch of [{role:'system'},{content:''},{content:'x'.repeat(4001)},{event_id:'invalid'}])assert.equal((await scope.exports.POST(req({...turn,...patch}))).status,400);
 owner=false;assert.equal((await scope.exports.POST(req(turn))).status,403);owner=true;
 canon=false;assert.equal((await scope.exports.POST(req(turn))).status,409);canon=true;
 count=60;assert.equal((await scope.exports.POST(req(turn))).status,429);count=0;assert.equal(inserts,0);
 assert.equal((await scope.exports.POST(req(turn))).status,201);assert.equal(inserts,1);
 const duplicate=await scope.exports.POST(req(turn));assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(inserts,1);
 assert.equal((await scope.exports.POST(req({...turn,content:'different'}))).status,409);assert.equal(inserts,1);
 existing={...existing,conversation_id:'other'};assert.equal((await scope.exports.POST(req(turn))).status,409);
 existing=null;lookupError={message:'private-database-error'};const failed=await scope.exports.POST(req(turn));assert.equal(failed.status,503);assert(!(await failed.text()).includes('private-database-error'));
 console.log('PASS: disabled/invalid grant, input limits, owner/canonical gates, rate hold, one insert, idempotent retry, conflicting payload and conversation, safe database errors');
})().catch(e=>{console.error(e);process.exitCode=1});
