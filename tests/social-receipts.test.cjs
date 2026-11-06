// Run: node --test tests/social-receipts.test.cjs
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const ts=require('typescript')
const root=path.join(__dirname,'..')
const source=fs.readFileSync(path.join(root,'lib/content/social-receipts.ts'),'utf8')
const moduleBox={exports:{}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleBox.exports,module:moduleBox,Date})
const {dueSocialReceipts}=moduleBox.exports
const now=Date.parse('2026-11-06T08:00:00Z')
function database(rows) {
  const calls=[]
  const query={
    select(){return this},
    eq(key,value){rows=rows.filter(row=>row[key]===value);return this},
    or(filter){calls.push(filter);const cutoff=filter.split('checked_at.lt.')[1];assert.ok(cutoff);rows=rows.filter(row=>!row.checked_at || Date.parse(row.checked_at)<Date.parse(cutoff));return this},
    order(){rows.sort((a,b)=>(a.checked_at?Date.parse(a.checked_at):-Infinity)-(b.checked_at?Date.parse(b.checked_at):-Infinity));return this},
    limit(n){return {data:rows.slice(0,n),calls}},
  }
  return {from(table){assert.equal(table,'cs_social_deliveries');return query}}
}
test('October deliveries remain eligible in November after prolonged outage',()=>{
 const result=dueSocialReceipts(database([{state:'scheduled',scheduled_at:'2026-10-13T00:00:00Z',checked_at:'2026-10-17T00:28:44Z'}]),now)
 assert.equal(result.data.length,1)
})
test('never-checked receipts lead the bounded batch, independent of schedule age',()=>{
 const rows=Array.from({length:25},(_,id)=>({id,state:'scheduled',scheduled_at:'2026-01-01T00:00:00Z',checked_at:id===24?null:'2026-11-05T00:00:00Z'}))
 const result=dueSocialReceipts(database(rows),now)
 assert.equal(result.data.length,20);assert.equal(result.data[0].id,24)
})
test('hourly throttle excludes recent and exact-boundary checks',()=>{
 const rows=['2026-11-06T07:59:00Z','2026-11-06T07:00:00Z','2026-11-06T06:59:59Z'].map(checked_at=>({state:'scheduled',checked_at}))
 assert.equal(dueSocialReceipts(database(rows),now).data.length,1)
})
test('receipt selection never selects queued or uncertain submissions',()=>{
 const rows=['queued','submitting','submission_unknown','blocked','scheduled'].map(state=>({state,checked_at:null}))
 assert.deepEqual(dueSocialReceipts(database(rows),now).data.map(row=>row.state),['scheduled'])
})
test('scheduler one-row probe uses the same age-independent selection',()=>{
 assert.equal(dueSocialReceipts(database([{state:'scheduled',checked_at:null},{state:'scheduled',checked_at:null}]),now,1).data.length,1)
 const route=fs.readFileSync(path.join(root,'app/api/content/social/delivery/route.ts'),'utf8')
 assert.match(route,/dueSocialReceipts\(db,now,1\)/)
 assert.doesNotMatch(route,/gte\('scheduled_at'/)
 assert.match(route,/OAuth invalid_grant/)
})
test('worker retains read-only and uncertain-submission protections',()=>{
 const worker=fs.readFileSync(path.join(root,'lib/content/social-delivery.ts'),'utf8')
 assert.match(worker,/await dueSocialReceipts\(db\)/)
 assert.doesNotMatch(worker,/gte\('scheduled_at'/)
 assert.match(worker,/if \(options.readOnly\) continue/)
 assert.match(worker,/if\(!enabled \|\| options.readOnly\)return/)
 assert.match(worker,/verifiedSocialPublication\(post,row,brand.timezone\)/)
 assert.match(worker,/Not present in pending queue; publication remains unconfirmed/)
 assert.match(worker,/Submission may have reached Metricool. Inspect before any manual retry./)
})
