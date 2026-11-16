const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

const src = fs.readFileSync('lib/content/social-delivery.ts','utf8')
test('social delivery code compiles',()=>{
  const output=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true})
  assert.equal((output.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
})
test('read-only verification cannot mutate the delivery ledger',()=>{
  assert.match(src,/if \(!options\.readOnly\) \{\s*const stale=await db\.from\('cs_social_deliveries'\)\.update/)
  assert.match(src,/if \(options\.readOnly\) continue\s*const update=await db\.from\('cs_social_deliveries'\)\.update/)
  assert.match(src,/if\(!enabled \|\| options\.readOnly\)return/)
})
