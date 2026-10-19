const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const src=fs.readFileSync('lib/content/vip-replay-access.ts','utf8')
const mod={exports:{}}
vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,Date})
const {vipReplayAllowed}=mod.exports
const now=new Date('2026-10-19T00:00:00Z')
test('only active VIP passes',()=>{
 assert.equal(vipReplayAllowed({tier:'vip',status:'active'},now),true)
 assert.equal(vipReplayAllowed({tier:'vip',status:'active',current_period_end:'2026-10-20T00:00:00Z'},now),true)
})
for(const [name,member] of [
 ['anonymous',null],['regular',{tier:'regular',status:'active'}],
 ['canceled',{tier:'vip',status:'canceled'}],
 ['past due',{tier:'vip',status:'past_due'}],
 ['expired',{tier:'vip',status:'active',current_period_end:'2026-10-18T00:00:00Z'}],
 ['bad expiration',{tier:'vip',status:'active',current_period_end:'not-a-date'}]
])test(name+' is denied',()=>assert.equal(vipReplayAllowed(member,now),false))
test('Vault never serves media through the public approved-items endpoint',()=>{
 const page=fs.readFileSync('app/replays/page.tsx','utf8')
 assert.match(page,/db\.auth\.getUser\(\)/)
 assert.match(page,/vipReplayAllowed\(member\)/)
 assert.doesNotMatch(page,/media_url|createSignedUrl|\/api\/content\/media\//)
})
