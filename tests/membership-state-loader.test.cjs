const {test}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {stripTypeScriptTypes}=require('node:module')
const source=stripTypeScriptTypes(fs.readFileSync(__dirname+'/../lib/membership-state-loader.ts','utf8')).replace('export function','function')
function setup() {
 const context={setTimeout},pending=[],published=[],scheduled=[]
 vm.runInNewContext(source+';this.create=createMembershipStateLoader',context)
 const loader=context.create(id=>new Promise((resolve,reject)=>pending.push({id,resolve,reject})),v=>published.push(v),task=>scheduled.push(task))
 return {loader,pending,published,flush:()=>{while(scheduled.length)scheduled.shift()()}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('switching identities clears old plan and rejects a late old-user result',async()=>{
 const h=setup();h.loader.load('A');h.flush();h.loader.load('B');h.flush()
 h.pending[1].resolve({tier:'regular'});await tick()
 h.pending[0].resolve({tier:'vip'});await tick()
 assert.deepEqual(h.published,[null,null,{tier:'regular'}])
})
test('sign-out immediately clears membership and invalidates an in-flight response',async()=>{
 const h=setup();h.loader.load('A');h.flush();h.loader.load(null)
 h.pending[0].resolve({tier:'vip'});await tick()
 assert.deepEqual(h.published,[null,null])
})
test('same-user refresh replaces old state with fresh membership',async()=>{
 const h=setup();h.loader.load('A');h.flush();h.pending[0].resolve({tier:'vip'});await tick()
 h.loader.load('A');h.flush();h.pending[1].resolve({tier:'explorer'});await tick()
 assert.deepEqual(h.published,[null,{tier:'vip'},null,{tier:'explorer'}])
})
test('unmount prevents deferred queries and late state writes',async()=>{
 const h=setup();h.loader.load('A');h.loader.dispose();h.flush()
 assert.equal(h.pending.length,0);assert.deepEqual(h.published,[null])
 const j=setup();j.loader.load('A');j.flush();j.loader.dispose();j.pending[0].resolve({tier:'vip'});await tick()
 assert.deepEqual(j.published,[null])
})
test('read failure clears the plan without retaining another users data',async()=>{
 const h=setup();h.loader.load('A');h.flush();h.pending[0].reject(Error('offline'));await tick()
 assert.deepEqual(h.published,[null,null])
})
test('membership page uses identity-aware loader and subscribes before initial lookup',()=>{
 const s=fs.readFileSync(__dirname+'/../app/membership/page.tsx','utf8')
 assert.match(s,/membershipLoader.load\(user\?\.id \?\? null\)/)
 assert.match(s,/membershipLoader.dispose\(\)/)
 assert.ok(s.indexOf('supabase.auth.onAuthStateChange')<s.indexOf('supabase.auth.getUser()'))
 assert.match(s,/if \(!authEventSeen\) applyUser\(error \? null : data.user\)/)
})
