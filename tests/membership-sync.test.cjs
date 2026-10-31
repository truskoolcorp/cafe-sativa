const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('lib/sync-membership.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const sub=(id,created,status='active')=>({id,created,status,metadata:{site:'cafe-sativa',user_id:'user_1'},customer:'cus_1',items:{data:[{price:{id:'approved'},current_period_end:1800000000}]}});
function setup(options={}) {
 const actions=[],reads=[];let member=options.member===null?null:{stripe_customer_id:'cus_1',stripe_subscription_id:'sub_current',updated_at:'2026-10-31T00:00:00Z',...options.member};
 const exports={};
 vm.runInNewContext(source,{exports,Date,Number,Error,require(name){if(name==='@/lib/membership-prices')return {cafeSubscriptionTier:s=>s.metadata?.site!=='other'&&s.items?.data?.[0]?.price?.id==='approved'?'regular':null};throw Error(name)}});
 const db={from(table){let write=null,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},update(data){write={op:'update',data};return q},upsert(data,config){write={op:'upsert',data,config};return q},async maybeSingle(){if(!write){reads.push('local');return {data:member?{...member}:null,error:options.readError}}actions.push({...write,filters});const mismatch=write.op==='update'&&filters.some(([k,v])=>k!=='user_id'&&member?.[k]!==v);return {data:options.conflict||mismatch?null:{user_id:'user_1'},error:options.writeError}}};return q}};
 const stripe={subscriptions:{async retrieve(id){reads.push(id);if(options.providerError)throw Error('provider failure');if(options.duringLookup)member={...member,updated_at:'new_revision'};return options.subscriptions?.[id]??sub(id,id==='sub_old'?100:id==='sub_current'?200:300)}}};
 return {actions,reads,run:input=>exports.syncCafeMembership(db,stripe,{userId:'user_1',subscriptionId:'sub_current',mode:'subscription',...input})};
}
test('current cancellation updates only observed membership revision and identity',async()=>{const h=setup({subscriptions:{sub_current:sub('sub_current',200,'canceled')}});assert.equal(await h.run(),'applied');assert.equal(h.actions[0].data.status,'canceled');assert.deepEqual(h.actions[0].filters,[['user_id','user_1'],['updated_at','2026-10-31T00:00:00Z'],['stripe_subscription_id','sub_current']]);assert.deepEqual(h.reads,['local','sub_current'])});
test('old subscription deletion cannot cancel replacement',async()=>{const h=setup();assert.equal(await h.run({subscriptionId:'sub_old'}),'ignored');assert.equal(h.actions.length,0);assert.deepEqual(h.reads,['local'])});
test('subscription update never creates an initial membership',async()=>{const h=setup({member:null});assert.equal(await h.run(),'ignored');assert.equal(h.actions.length,0)});
test('late old checkout cannot overwrite newer linked subscription',async()=>{const h=setup();assert.equal(await h.run({subscriptionId:'sub_old',mode:'checkout'}),'ignored');assert.equal(h.actions.length,0)});
test('verified newer checkout can replace using exact prior identity',async()=>{const h=setup();assert.equal(await h.run({subscriptionId:'sub_new',mode:'checkout'}),'applied');assert.equal(h.actions[0].data.stripe_subscription_id,'sub_new');assert.deepEqual(h.actions[0].filters.at(-1),['stripe_subscription_id','sub_current'])});
test('ambiguous equal creation times require reconciliation',async()=>{const h=setup({subscriptions:{sub_new:sub('sub_new',200)}});await assert.rejects(h.run({subscriptionId:'sub_new',mode:'checkout'}),/reconciliation/);assert.equal(h.actions.length,0)});
test('first checkout uses insert-on-conflict-do-nothing semantics',async()=>{const h=setup({member:null});assert.equal(await h.run({subscriptionId:'sub_new',mode:'checkout'}),'applied');assert.equal(h.actions[0].config.ignoreDuplicates,true)});
test('unlinked free membership compares null subscription before linking',async()=>{const h=setup({member:{stripe_subscription_id:null,stripe_customer_id:null}});assert.equal(await h.run({subscriptionId:'sub_new',mode:'checkout'}),'applied');assert.deepEqual(h.actions[0].filters.at(-1),['stripe_subscription_id',null])});
for(const [label,options] of [['concurrent replacement',{conflict:true}],['write failure',{writeError:'database failure'}],['lookup failure',{readError:'database failure'}],['provider failure',{providerError:true}]])test(label+' remains retryable',async()=>{const h=setup(options);await assert.rejects(h.run())});
test('racing initial insert remains retryable instead of overwriting winner',async()=>{const h=setup({member:null,conflict:true});await assert.rejects(h.run({mode:'checkout'}),/retry/);assert.equal(h.actions[0].config.ignoreDuplicates,true)});
for(const [label,patch,input]of [
 ['foreign price',{items:{data:[{price:{id:'foreign'},current_period_end:1800000000}]}},{}],
 ['foreign site',{metadata:{site:'other',user_id:'user_1'}},{}],
 ['foreign user',{metadata:{site:'cafe-sativa',user_id:'other'}},{}],
 ['foreign customer',{customer:'cus_other'},{}],
 ['wrong checkout customer',{}, {mode:'checkout',expectedCustomer:'other'}],
 ['wrong checkout tier',{}, {mode:'checkout',expectedTier:'vip'}]
])test(label+' does not write access',async()=>{const h=setup({subscriptions:{sub_current:{...sub('sub_current',200),...patch}}});assert.equal(await h.run(input),'ignored');assert.equal(h.actions.length,0)});
test('legacy linked subscription without user metadata may revoke exact existing link',async()=>{const s=sub('sub_current',200,'canceled');s.metadata={site:'cafe-sativa'};s.items.data[0].current_period_end=undefined;const h=setup({subscriptions:{sub_current:s}});assert.equal(await h.run(),'applied');assert.equal(h.actions[0].data.current_period_end,null);assert.equal(h.actions[0].data.status,'canceled')});
test('active access without valid period fails closed',async()=>{const s=sub('sub_current',200);s.items.data[0].current_period_end=undefined;const h=setup({subscriptions:{sub_current:s}});await assert.rejects(h.run(),/period/);assert.equal(h.actions.length,0)});

test('local revision change during provider lookup fails compare-and-swap',async()=>{const h=setup({duringLookup:true});await assert.rejects(h.run(),/retry/);assert.equal(h.actions.length,1)});
