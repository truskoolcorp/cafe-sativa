const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let user={id:'owner',email:'owner@example.test'},membership=null,dbError=null,subStatus='active',created=0,providerError=false;
const env={STRIPE_SECRET_KEY:'test-only',NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',STRIPE_PRICE_REGULAR_MONTHLY:'price_test'};
class Stripe { constructor(){this.subscriptions={retrieve:async()=>({status:subStatus})};this.checkout={sessions:{create:async()=>{created++;if(providerError)throw Error('SENSITIVE_PROVIDER_DETAIL');return {url:'https://checkout.stripe.com/test',id:'cs_test'}}}}} }
const scope={exports:{},process:{env},console:{error(){}},URL,require(name){
 if(name==='next/server')return {NextResponse:{json:(body,opts)=>({body,status:opts?.status||200})}};
 if(name==='stripe')return {default:Stripe};
 if(name.endsWith('/server'))return {createClient:()=>({auth:{getUser:async()=>({data:{user}})}})};
 if(name.endsWith('/admin'))return {createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:membership,error:dbError})})})})})};
 throw Error(name);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/create-checkout-session/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
const request=(origin='https://www.cafe-sativa.com',tier='regular')=>({url:'https://www.cafe-sativa.com/api/create-checkout-session',headers:{get:()=>origin},json:async()=>({tier})});
(async()=>{
 assert.equal((await scope.exports.POST(request('https://other.test'))).status,403);assert.equal(created,0);
 user=null;assert.equal((await scope.exports.POST(request())).status,401);user={id:'owner',email:'owner@example.test'};
 dbError={message:'database unavailable'};assert.equal((await scope.exports.POST(request())).status,503);assert.equal(created,0);dbError=null;
 membership={stripe_subscription_id:'sub_test',stripe_customer_id:'cus_test'};
 for(const status of ['active','trialing','past_due','unpaid','incomplete','paused']){subStatus=status;assert.equal((await scope.exports.POST(request())).status,409);}
 assert.equal(created,0);
 subStatus='canceled';assert.equal((await scope.exports.POST(request())).status,200);assert.equal(created,1);
 membership=null;providerError=true;const failed=await scope.exports.POST(request());assert.equal(failed.status,500);assert(!JSON.stringify(failed).includes('SENSITIVE_PROVIDER_DETAIL'));
 delete env.STRIPE_SECRET_KEY;assert(!JSON.stringify(await scope.exports.POST(request())).includes('STRIPE_SECRET_KEY'));
 console.log('PASS: origin, authentication, database failure, six billable subscription states, canceled subscription and safe error responses');
})().catch(e=>{console.error(e);process.exitCode=1});
