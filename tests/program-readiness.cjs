const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const policy={exports:{},URL,Intl};vm.runInNewContext(compile('lib/content/policy.ts'),policy);
const context={exports:{},require:()=>policy.exports};vm.runInNewContext(compile('lib/content/program-readiness.ts'),context);
const check=context.exports.programReferenceStatus;
const asset=subject=>({id:subject,kind:'venue',subject,url:'https://canon.example/'+subject,sha256:'a'.repeat(64),version:'v1',approved_by:'owner',approved_at:'2026-10-10T00:00:00Z',active:true});
const glyph={live:true,characters:['ahnika-merlot','laviche-fea','chef-v','keith'].map(id=>({id,name:id,production_ready:true}))};
let result=check([asset('bar'),asset('main-lounge')],glyph);
assert.equal(result.find(p=>p.category==='bar').referenceChecksPassed,true);
assert.equal(result.find(p=>p.category==='stage').referenceChecksPassed,false);
assert.equal(result.find(p=>p.category==='community').roomApproved,false); // lounge does not establish long-table setting
result=check([asset('stage')],glyph);assert.equal(result.find(p=>p.category==='stage').referenceChecksPassed,true);
result=check([asset('stage')],{...glyph,live:false});assert.equal(result.find(p=>p.category==='stage').referenceChecksPassed,false);
result=check([asset('kitchen')],{live:true,characters:[{id:'chef-v',name:'Chef V',production_ready:false,blockers:['approvedRightsConsent']}]});assert.equal(result.find(p=>p.category==='kitchen').referenceChecksPassed,false);
result=check([{...asset('bar'),active:false}],glyph);assert.equal(result.find(p=>p.category==='bar').referenceChecksPassed,false);
assert.ok(check([asset('gallery')],glyph).find(p=>p.category==='gallery').episodeChecks.includes('Actual artwork, attribution and usage permission'));
console.log('PASS: exact category rooms required; retired rooms/stale registry/blocked cast held; gallery permissions remain separate; lounge cannot substitute for long-table setting');
