const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let user={id:'buyer'},member={stripe_customer_id:'cus_cs',stripe_subscription_id:'sub_cs'},writeError=null,updated={user_id:'buyer'},writes=0;
let sub={id:'sub_cs',customer:'cus_cs',metadata:{user_id:'buyer',site:'cafe-sativa'},items:{data:[{price:{id:'price_cs'},current_period_end:1794434400}]},status:'active',cancel_at_period_end:false};
const scope={exports:{},process:{env:{STRIPE_SECRET_KEY:'mock'}},URL,require(n){
 if(n==='next/server')return {NextResponse:{json:(body,o)=>({body,status:o?.status||200})}};
 if(n==='stripe')return {default:class{constructor(){this.subscriptions={retrieve:async()=>sub}}}};
 if(n.endsWith('/server'))return {createClient:()=>({auth:{getUser:async()=>({data:{user}})}})};
 if(n.endsWith('/membership-prices'))return {cafeSubscriptionTier:s=>s.items.data[0].price.id==='price_cs'&&s.metadata.site==='cafe-sativa'?'regular':null};
 if(n.endsWith('/admin'))return {createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:member})})}),update:()=>{writes++;const q={eq:()=>q,select:()=>q,maybeSingle:async()=>({data:updated,error:writeError})};return q;}})})};
 throw Error(n);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/membership/refresh/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
const req=o=>({url:'https://www.cafe-sativa.com/api/membership/refresh',headers:{get:()=>o||'https://www.cafe-sativa.com'}});
(async()=>{
 assert.equal((await scope.exports.POST(req('https://evil.test'))).status,403);
 user=null;assert.equal((await scope.exports.POST(req())).status,401);user={id:'buyer'};
 sub.metadata.user_id='other';assert.equal((await scope.exports.POST(req())).status,409);assert.equal(writes,0);sub.metadata.user_id='buyer';
 sub.customer='cus_other';assert.equal((await scope.exports.POST(req())).status,409);sub.customer='cus_cs';
 sub.items.data[0].price.id='price_other';assert.equal((await scope.exports.POST(req())).status,409);sub.items.data[0].price.id='price_cs';
 for(const [s,status] of [['active','active'],['past_due','past_due'],['unpaid','past_due'],['canceled','canceled'],['paused','incomplete']]){sub.status=s;assert.equal((await scope.exports.POST(req())).body.status,status)}
 sub.cancel_at_period_end=true;assert.equal((await scope.exports.POST(req())).body.cancelAtPeriodEnd,true);
 updated=null;assert.equal((await scope.exports.POST(req())).status,503);
 console.log('PASS: authenticated owner only, foreign customer/price blocked, current status and cancellation synchronized, concurrent replacement fails closed');
})().catch(e=>{console.error(e);process.exitCode=1});
