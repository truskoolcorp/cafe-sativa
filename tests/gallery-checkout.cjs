const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let calls=0,dbCalls=0;let product={id:'12345678-1234-1234-1234-123456789abc',status:'published',price_cents:1200,kind:'physical',stock_count:2,artist:{id:'artist',is_approved:true,charges_enabled:true,stripe_account_id:'acct_test'}};
const context={exports:{},URL,process:{env:{STRIPE_SECRET_KEY:'sk_test_mock'}},console,require(name){if(name==='next/server')return {NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})}};if(name==='stripe')return {default:class {checkout={sessions:{create:async input=>{calls++;assert.equal(input.line_items[0].quantity,1);return {url:'https://checkout.stripe.com/test'}}}}}};if(name==='@supabase/ssr')return {createServerClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})};if(name==='next/headers')return {cookies:()=>({get:()=>null})};if(name.endsWith('/admin'))return {createAdminClient:()=>({from(){dbCalls++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:product})}}})};throw Error(name)}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/gallery/checkout/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const send=(body,origin='https://www.cafe-sativa.com')=>context.exports.POST({url:'https://www.cafe-sativa.com/api/gallery/checkout',headers:{get:()=>origin},json:async()=>body});
(async()=>{
 assert.equal((await send({product_id:product.id},'https://evil.example')).status,403);
 for(const quantity of [0,-1,1.5,11,'2',null]) {if(quantity===null)continue;assert.equal((await send({product_id:product.id,quantity})).status,400)}
 assert.equal((await send(null)).status,400);
 assert.equal(calls,0);assert.equal(dbCalls,0);
 assert.equal((await send({product_id:product.id})).status,200);assert.equal(calls,1);
 product={...product,kind:'digital',digital_delivery_url:null};
 assert.equal((await send({product_id:product.id})).status,409);assert.equal(calls,1);
 product={...product,kind:'physical',stock_count:0};
 assert.equal((await send({product_id:product.id})).status,400);assert.equal(calls,1);
 console.log('PASS: cross-origin/malformed/invalid quantity rejected before provider; missing digital asset and stock blocked; valid mocked checkout succeeds');
})().catch(e=>{console.error(e);process.exitCode=1});

