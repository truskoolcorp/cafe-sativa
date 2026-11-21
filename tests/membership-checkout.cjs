const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let user={id:'owner',email:'owner@example.test'},membership=null,dbError=null,subStatus='active',created=0,release=null,lastSession=null,providerError=false,price={active:true,currency:'usd',type:'recurring',unit_amount:999,recurring:{interval:'month',interval_count:1}};
const env={STRIPE_SECRET_KEY:'test-only',NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',STRIPE_PRICE_REGULAR_MONTHLY:'price_1TNFwCIDc7LlvDW9siOcRvdd'};
class Stripe { constructor(){this.prices={retrieve:async()=>price};this.subscriptions={retrieve:async()=>({status:subStatus})};this.checkout={sessions:{create:async args=>{lastSession=args;created++;if(providerError)throw Error('SENSITIVE_PROVIDER_DETAIL');return {url:'https://checkout.stripe.com/test',id:'cs_test'}}}}} }
const scope={exports:{},process:{env},console:{error(){}},URL,require(name){
 if(name==='next/server')return {NextResponse:{json:(body,opts)=>({body,status:opts?.status||200})}};
 if(name.endsWith('/membership-prices'))return {CAFE_MEMBERSHIP_PRICES:{price_1TNFwCIDc7LlvDW9siOcRvdd:'regular'}};
 if(name.endsWith('/music-release-contract'))return {publicRelease:r=>r?.status==='approved'};
 if(name==='stripe')return {default:Stripe};
 if(name.endsWith('/server'))return {createClient:()=>({auth:{getUser:async()=>({data:{user}})}})};
 if(name.endsWith('/admin'))return {createAdminClient:()=>({from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='cs_music_releases'?release:membership,error:dbError})})})})})};
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
 membership=null;
 for(const changed of [{active:false},{currency:'eur'},{unit_amount:700},{recurring:{interval:'year',interval_count:1}}]){
  const saved=price;price={...price,...changed};assert.equal((await scope.exports.POST(request())).status,503);assert.equal(created,1);price=saved;
 }
 const savedId=env.STRIPE_PRICE_REGULAR_MONTHLY;env.STRIPE_PRICE_REGULAR_MONTHLY='price_foreign';assert.equal((await scope.exports.POST(request())).status,503);env.STRIPE_PRICE_REGULAR_MONTHLY=savedId;
 const releaseRequest=(releaseSlug)=>({...request(),json:async()=>({tier:'regular',releaseSlug})});
 assert.equal((await scope.exports.POST(releaseRequest('../wrong'))).status,400);
 assert.equal((await scope.exports.POST(releaseRequest('oh-laviche'))).status,409);
 release={id:'release-1',slug:'oh-laviche',status:'approved'};
 assert.equal((await scope.exports.POST(releaseRequest('oh-laviche'))).status,200);
 assert.equal(lastSession.metadata.music_release_id,'release-1');
 assert.equal(lastSession.subscription_data.metadata.music_release_slug,'oh-laviche');
 providerError=true;const failed=await scope.exports.POST(request());assert.equal(failed.status,500);assert(!JSON.stringify(failed).includes('SENSITIVE_PROVIDER_DETAIL'));
 delete env.STRIPE_SECRET_KEY;assert(!JSON.stringify(await scope.exports.POST(request())).includes('STRIPE_SECRET_KEY'));
 console.log('PASS: origin, authentication, database failure, six billable subscription states, canceled subscription and safe error responses');
})().catch(e=>{console.error(e);process.exitCode=1});
