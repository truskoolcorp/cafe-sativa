const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let calls=0,dbCalls=0,rateReads=0,lastSession;
let product={id:'12345678-1234-1234-1234-123456789abc',status:'published',price_cents:1200,kind:'physical',stock_count:2,artist:{id:'artist',is_approved:true,charges_enabled:true,stripe_account_id:'acct_test'}};
const rate={id:'shr_Approved',active:true,type:'fixed_amount',fixed_amount:{amount:725,currency:'usd'}};
let providerRate=rate;
const env={STRIPE_SECRET_KEY:'sk_test_mock'};
const helper={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery-shipping.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,helper);
const context={exports:{},URL,process:{env},console,require(name){
 if(name==='next/server')return {NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})}};
 if(name==='stripe')return {default:class {shippingRates={retrieve:async id=>{rateReads++;assert.equal(id,rate.id);return providerRate}};checkout={sessions:{create:async input=>{calls++;lastSession=input;return {url:'https://checkout.stripe.com/test'}}}}}};
 if(name==='@supabase/ssr')return {createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})};
 if(name==='next/headers')return {cookies:()=>({get:()=>null})};
 if(name.endsWith('/admin'))return {createAdminClient:()=>({from(){dbCalls++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:product})}}})};
 if(name==='@/lib/gallery-shipping')return helper.exports;
 throw Error(name)
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/gallery/checkout/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const send=(body,origin='https://www.cafe-sativa.com')=>context.exports.POST({url:'https://www.cafe-sativa.com/api/gallery/checkout',headers:{get:()=>origin},json:async()=>body});
(async()=>{
 assert.equal((await send({product_id:product.id},'https://evil.example')).status,403);
 for(const quantity of [0,-1,1.5,11,'2',null]) {if(quantity===null)continue;assert.equal((await send({product_id:product.id,quantity})).status,400)}
 assert.equal((await send(null)).status,400);
 assert.equal(calls,0);assert.equal(dbCalls,0);
 const physical={product_id:product.id};
 assert.equal((await send(physical)).body.code,'shipping_unavailable');
 const rule={rateId:rate.id,country:'US',amountCents:725,mode:'customer_paid',approvalRef:'quote-test',expiresAt:new Date(Date.now()+60000).toISOString()};
 const configure=(patch={})=>{env.CAFE_GALLERY_SHIPPING_RULES=JSON.stringify({[product.id]:{...rule,...patch}})};
 for(const patch of [{amountCents:0},{mode:'included'},{country:'CA'},{approvalRef:''},{expiresAt:'2000-01-01'},{rateId:'unknown'}]){
  configure(patch);
  assert.equal((await send(physical)).status,409);
 }
 configure();
 assert.equal((await send({...physical,quantity:2})).status,409);
 assert.equal((await send({...physical,shipping_rate:'shr_CallerSupplied'})).status,200);
 assert.equal(calls,1);assert.equal(rateReads,1);
 assert.equal(lastSession.shipping_options[0].shipping_rate,rate.id);
 assert.equal(lastSession.shipping_address_collection.allowed_countries.join(','),'US');
 assert.equal(lastSession.adaptive_pricing.enabled,false);
 for(const bad of [{...rate,active:false},{...rate,id:'shr_Other'},{...rate,fixed_amount:{amount:0,currency:'usd'}},{...rate,fixed_amount:{amount:725,currency:'eur'}},{...rate,fixed_amount:{amount:725,currency:'usd',currency_options:{eur:{amount:700}}}}]){
  providerRate=bad;
  assert.equal((await send(physical)).status,409);
 }
 assert.equal(calls,1);
 configure({mode:'included',amountCents:0});
 providerRate={...rate,fixed_amount:{amount:0,currency:'usd'}};
 assert.equal((await send(physical)).status,200);assert.equal(calls,2);
 product={...product,kind:'digital',digital_delivery_url:null};
 assert.equal((await send(physical)).status,409);assert.equal(calls,2);
 product={...product,digital_delivery_url:'https://example.test/download'};
 const reads=rateReads;
 assert.equal((await send(physical)).status,200);assert.equal(calls,3);
 assert.equal(lastSession.shipping_options,undefined);assert.equal(rateReads,reads);
 product={...product,kind:'physical',stock_count:0};
 assert.equal((await send(physical)).status,400);assert.equal(calls,3);
 console.log('PASS: missing and stale quotes, Stripe mismatches, verified paid and included rates, digital isolation and existing checkout gates');
})().catch(e=>{console.error(e);process.exitCode=1});

