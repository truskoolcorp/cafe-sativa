const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let user={id:'owner',email:'owner@example.test'},membership=null,dbError=null,subStatus='active',created=0,release=null,lastSession=null,providerError=false,price={active:true,currency:'usd',type:'recurring',unit_amount:999,recurring:{interval:'month',interval_count:1}};
const env={STRIPE_SECRET_KEY:'test-only',NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',STRIPE_PRICE_REGULAR_MONTHLY:'price_1TNFwCIDc7LlvDW9siOcRvdd'};
const {offers,prices}=require('./load-membership-offers.cjs')(env);
class Stripe { constructor(){this.prices={retrieve:async()=>price};this.subscriptions={retrieve:async()=>({status:subStatus})};this.checkout={sessions:{create:async args=>{lastSession=args;created++;if(providerError)throw Error('SENSITIVE_PROVIDER_DETAIL');return {url:'https://checkout.stripe.com/test',id:'cs_test'}}}}} }
const scope={exports:{},process:{env},console:{error(){}},URL,require(name){
 if(name==='next/server')return {NextResponse:{json:(body,opts)=>({body,status:opts?.status||200})}};
 if(name.endsWith('/membership-prices'))return prices;
 if(name.endsWith('/membership-offers'))return offers;
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
 assert.equal(lastSession.allow_promotion_codes,true);
 assert.equal(lastSession.automatic_tax,undefined);
 const annualRequest=tier=>({...request(),json:async()=>({tier,cadence:'annual'})});
 assert.equal((await scope.exports.POST({...request(),json:async()=>({tier:'regular',cadence:'weekly'})})).status,400);
 assert.equal((await scope.exports.POST(annualRequest('regular'))).status,503);
 env.NEXT_PUBLIC_CAFE_ANNUAL_MEMBERSHIPS='true';
 assert.equal((await scope.exports.POST(annualRequest('regular'))).status,503);
 const monthlyPrice=price;
 for(const [tier,product,cents,legacy] of [
   ['regular','prod_ULxrCgCmYnTWOF',9990,'price_1TdCcIIDc7LlvDW9fuj3QaNn'],
   ['vip','prod_ULxsmvOgLeiyYy',24990,'price_1TdCcIIDc7LlvDW9ROnqf2HG'],
 ]){
  const key=`STRIPE_PRICE_${tier.toUpperCase()}_ANNUAL`, id=`price_Accepted${tier}`;
  const legacySubscription={items:{data:[{price:{id:legacy}}]},metadata:{site:'cafe-sativa',tier}};
  assert.equal(prices.cafeSubscriptionTier(legacySubscription),tier);
  env[key]=legacy;
  assert.equal((await scope.exports.POST(annualRequest(tier))).status,503);
  env[key]=id;
  const annualPrice={id,product,active:true,currency:'usd',type:'recurring',unit_amount:cents,tax_behavior:'exclusive',
   recurring:{interval:'year',interval_count:1,usage_type:'licensed'}};
  const before=created;
  for(const changes of [{product:'prod_foreign'},{unit_amount:cents-90},{currency:'eur'},{active:false},
   {tax_behavior:'inclusive'},{tax_behavior:'unspecified'},
   {recurring:{...annualPrice.recurring,interval_count:2}},{recurring:{...annualPrice.recurring,usage_type:'metered'}}]){
   price={...annualPrice,...changes};
   assert.equal((await scope.exports.POST(annualRequest(tier))).status,503);
  }
  assert.equal(created,before);
  price=annualPrice;
  assert.equal((await scope.exports.POST(annualRequest(tier))).status,200);
  assert.equal(lastSession.line_items[0].price,id);
  assert.equal(lastSession.subscription_data.metadata.cadence,'annual');
  assert.equal(lastSession.allow_promotion_codes,false);
  assert.equal(lastSession.automatic_tax.enabled,true);
  assert.equal(lastSession.billing_address_collection,'required');
  assert.equal(lastSession.customer_update,undefined);
  membership={stripe_customer_id:'cus_test',stripe_subscription_id:null};
  assert.equal((await scope.exports.POST(annualRequest(tier))).status,200);
  assert.equal(lastSession.customer,'cus_test');
  assert.equal(lastSession.customer_update.address,'auto');
  membership=null;
  const sub={items:{data:[{price:annualPrice}]},metadata:{site:'cafe-sativa',tier}};
  assert.equal(prices.cafeSubscriptionTier(sub),tier);
  assert.equal(prices.cafeSubscriptionTier({...sub,metadata:{site:'another-store'}}),null);
  env.NEXT_PUBLIC_CAFE_ANNUAL_MEMBERSHIPS='false';
  assert.equal((await scope.exports.POST(annualRequest(tier))).status,503);
  assert.equal(prices.cafeSubscriptionTier(sub),tier,'pausing sales must not break annual renewals');
  env.NEXT_PUBLIC_CAFE_ANNUAL_MEMBERSHIPS='true';
 }
 price=monthlyPrice;
 providerError=true;const failed=await scope.exports.POST(request());assert.equal(failed.status,500);assert(!JSON.stringify(failed).includes('SENSITIVE_PROVIDER_DETAIL'));
 delete env.STRIPE_SECRET_KEY;assert(!JSON.stringify(await scope.exports.POST(request())).includes('STRIPE_SECRET_KEY'));
 console.log('PASS: existing monthly guards, exact annual Stripe prices, legacy price isolation, and annual subscriber recognition when sales are paused');
})().catch(e=>{console.error(e);process.exitCode=1});
