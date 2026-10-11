const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const c={exports:{},Buffer,Date,require};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/concierge/livekit-session.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);
const now=Date.now(),session={conversationId:'11111111-1111-1111-1111-111111111111',userId:'22222222-2222-2222-2222-222222222222',host:'ginger',expires:now+60000};
const token=c.exports.signVoiceSession(session,'test-secret');
assert.equal(c.exports.verifyVoiceSession(token,'test-secret',now).host,'ginger');
assert.equal(c.exports.verifyVoiceSession(token,'other-secret',now),null);
assert.equal(c.exports.verifyVoiceSession(token,'test-secret',now+61000),null);
assert.equal(c.exports.verifyVoiceSession(token+'x','test-secret',now),null);
assert.equal(c.exports.verifyVoiceSession(c.exports.signVoiceSession({...session,host:'chef-v'},'test-secret'),'test-secret',now),null);
assert.equal(c.exports.verifyVoiceSession(c.exports.signVoiceSession({...session,expires:now+1800001},'test-secret'),'test-secret',now),null);
console.log('PASS: signed memory grants bind user/conversation/approved host; altered, expired, overlong and unauthorized-host grants rejected');

