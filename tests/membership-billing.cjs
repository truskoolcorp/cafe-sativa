const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),vm=require('vm');
let user={id:'user-one'},member={stripe_customer_id:'cus_one',stripe_subscription_id:'sub_one'},dbError=null,calls=0,fail=false;
const sub={customer:'cus_one',metadata:{user_id:'user-one'},items:{data:[{price:{id:'price_1TNFwCIDc7LlvDW9siOcRvdd'}}]}};
let subscriptions={data:[sub],has_more:false};
class Stripe{constructor(){this.subscriptions={retrieve:async()=>sub,list:async()=>subscriptions};this.billingPortal={sessions:{create:async params=>{calls++;assert.equal(params.customer,'cus_one');assert.equal(params.configuration,'bpc_1UPOC2IDc7LlvDW9P3m45ZQR');assert.equal(params.return_url,'https://www.cafe-sativa.com/account');if(fail)throw Error('private-provider-detail');return {url:'https://billing.stripe.com/p/session-test'}}}}}}
const helper={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/membership-prices.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,helper);
const scope={exports:{},URL,Set,process:{env:{STRIPE_SECRET_KEY:'test'}},require:n=>{
 if(n==='@/lib/membership-prices')return helper.exports;
 if(n==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options?.status||200})}};
 if(n==='stripe')return {default:Stripe};
 if(n.endsWith('/server'))return {createClient:()=>({auth:{getUser:async()=>({data:{user}})}})};
 if(n.endsWith('/admin'))return {createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:member,error:dbError})})})})})};
 throw Error(n);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/membership/billing/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
const req=origin=>({url:'https://www.cafe-sativa.com/api/membership/billing',headers:{get:()=>origin}});
const own=()=>req('https://www.cafe-sativa.com');
(async()=>{
 assert.equal((await scope.exports.POST(req('https://foreign.test'))).status,403);
 user=null;assert.equal((await scope.exports.POST(own())).status,401);user={id:'user-one'};
 const saved=member;member=null;assert.equal((await scope.exports.POST(own())).status,409);member=saved;
 dbError={message:'private-db-detail'};assert.equal((await scope.exports.POST(own())).status,503);dbError=null;
 sub.metadata.user_id='other';assert.equal((await scope.exports.POST(own())).status,409);sub.metadata.user_id='user-one';
 sub.customer='cus_other';assert.equal((await scope.exports.POST(own())).status,409);sub.customer='cus_one';
 subscriptions={data:[sub,{...sub,items:{data:[{price:{id:'price_other_project'}}]}}],has_more:false};
 assert.equal((await scope.exports.POST(own())).status,409);assert.equal(calls,0);
 subscriptions={data:[sub],has_more:true};assert.equal((await scope.exports.POST(own())).status,409);
 subscriptions={data:[sub],has_more:false};assert.equal((await scope.exports.POST(own())).status,200);assert.equal(calls,1);
 fail=true;const result=await scope.exports.POST(own());assert.equal(result.status,503);assert(!JSON.stringify(result).includes('private-provider-detail'));
 console.log('PASS: portal origin/auth/owner/customer gates, missing membership, database failure, other-project subscription, pagination and safe provider errors');
})().catch(e=>{console.error(e);process.exitCode=1});

