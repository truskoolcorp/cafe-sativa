const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const policy={exports:{},URL,Intl,Date};vm.runInNewContext(compile('lib/content/policy.ts'),policy);
const c={exports:{},URL,Set,Object,process:{env:{}},require:n=>n==='react'?{cache:f=>f}:n.endsWith('/policy')?policy.exports:{createAdminClient:()=>{throw Error('Unused')}}};vm.runInNewContext(compile('lib/content/venue-covers.ts'),c);
const origin='https://nwfxvhqbjtfvoopcadff.supabase.co',asset={kind:'venue',subject:'community',active:true,approved_by:'owner',approved_at:'now',version:'v1',sha256:'a'.repeat(64),url:origin+'/storage/v1/object/public/cafe-sativa-canon/exact-long-table.png'};
assert.equal(c.exports.venueCoverMap([asset],origin).community,asset.url);
for(const changed of [{active:false},{approved_by:null},{kind:'character'},{subject:'staff'},{url:'https://evil.example/room.png'},{url:origin+'/storage/v1/object/public/other/room.png'},{sha256:'invalid'}])assert.equal(Object.keys(c.exports.venueCoverMap([{...asset,...changed}],origin)).length,0);
assert.equal(Object.keys(c.exports.venueCoverMap([asset,asset,asset],origin)).length,0);
console.log('PASS: exact approved public room masters; retired, unapproved, private/foreign and ambiguous references withheld');
