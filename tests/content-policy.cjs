const assert = require('node:assert/strict')
const { approvedAsset, compileShot, dueSlots, localDate, CONTENT_POLICY } = require('../.content-test/policy.js')
const asset = { id:'reference',kind:'venue',subject:'bar',url:'https://example.com/bar.png',sha256:'a'.repeat(64),version:'1',approved_by:'owner',approved_at:'2026-10-07T00:00:00Z',active:true }
assert.equal(CONTENT_POLICY.monthlyBudgetCents,2500)
assert.equal(approvedAsset(asset),true)
for (const patch of [{active:false},{approved_by:null},{approved_at:null},{sha256:'bad'},{url:'http://example.com/a'},{url:'https://user:password@example.com/a'}]) {
  assert.equal(approvedAsset({...asset,...patch}),false)
  assert.throws(()=>compileShot({...asset,...patch},'Slow camera move'))
}
assert.throws(()=>compileShot({...asset,kind:'character'},'Slow camera move'))
assert.throws(()=>compileShot(asset,''))
assert.equal(compileShot(asset,'Slow camera move').promptImage,asset.url)
// Before and after Chicago midnight; UTC date alone must not determine content slots.
assert.equal(localDate(new Date('2026-10-13T03:00:00Z')),'2026-10-12')
assert.equal(dueSlots(new Date('2026-10-13T03:00:00Z'))[0].room,'main-lounge')
assert.equal(dueSlots(new Date('2026-10-13T06:00:00Z')).length,0)
assert.equal(dueSlots(new Date('2026-11-02T12:00:00Z'))[0].room,'main-lounge')
console.log('Content policy checks passed')
