const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const raw = fs.readFileSync('lib/content/member-release.ts','utf8')
const result=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}})
const mod={exports:{}}
vm.runInNewContext(result.outputText,{module:mod,exports:mod.exports,Date})
const {publiclyReleased}=mod.exports
const valid={status:'published',approved_at:'2026-10-01T00:00:00Z',approved_by:'owner',published_at:'2026-10-02T00:00:00Z',scheduled_at:'2026-10-02T00:00:00Z',copy_final:'Approved editorial'}
const now=new Date('2026-10-19T00:00:00Z')
test('approved published due content visible',()=>assert.equal(publiclyReleased(valid,now),true))
for(const [name,change] of [
 ['pending approval',{status:'pending_approval'}],
 ['scheduled but not published',{status:'scheduled'}],
 ['unapproved',{approved_by:null}],
 ['future release',{scheduled_at:'2026-11-01T00:00:00Z'}],
 ['future publication',{published_at:'2026-11-01T00:00:00Z'}],
 ['invalid publication timestamp',{published_at:'invalid'}],
 ['empty final copy',{copy_final:' '}],
 ['missing release receipt',{published_at:null}]
])test(name+' hidden',()=>assert.equal(publiclyReleased({...valid,...change},now),false))
test('discovery presents text-only; never leaks media URLs or demo entitlements',()=>{
 const page=fs.readFileSync('app/discover/page.tsx','utf8')
 assert.match(page,/publiclyReleased/)
 assert.doesNotMatch(page,/media_url|<video|<audio|<iframe/)
})
