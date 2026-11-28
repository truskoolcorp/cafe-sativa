const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
let providerFailure=false,linkFailure=false;const errorLogs=[];
let authenticated=true,holds=0,calls=0,dbCalls=0,accountCheck=0,checkoutInput,platformAccount='acct_house',assets=[],houseReady=true;let product={id:'12345678-1234-1234-1234-123456789abc',status:'published',price_cents:1200,kind:'physical',stock_count:2,artist:{id:'artist',is_approved:true,charges_enabled:true,payouts_enabled:true,stripe_account_id:'acct_test'}};
const context={exports:{},URL,process:{env:{VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_live_mock',GALLERY_SALES_ENABLED:'true',GALLERY_INVENTORY_HOLDS:'true',GALLERY_PRIVATE_DOWNLOADS:'true',GALLERY_DIGITAL_WORKER:'true',GALLERY_PRODUCTION_SETTLEMENT_WEBHOOK:'true',GALLERY_SETTLEMENT_QUEUE_ENABLED:'true',
   GALLERY_PRODUCTION_FINANCIAL_REVIEW:'true',GALLERY_PRODUCTION_FINANCIAL_OWNER_IDS:'10000000-0000-4000-8000-000000000003',GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:'true',GALLERY_PRODUCTION_SETTLEMENT_WORKER:'true',GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET:'p'.repeat(48),GALLERY_REFUND_LEDGER:'true',
   GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:'acct_house',GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_house',
   NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',NEXT_PUBLIC_SUPABASE_URL:'https://nwfxvhqbjtfvoopcadff.supabase.co',GALLERY_ISOLATED_TEST:'false'}},console:{log:console.log,error:(...args)=>errorLogs.push(args)},require(name){if(name==='@/lib/gallery/environment')return require('./helpers/load-gallery-environment.cjs')(context.process.env);if(name==='@/lib/gallery/house-checkout'){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/house-checkout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:context.process});return exports}if(name==='next/server')return {NextResponse:{json:(body,opts={})=>({body,status:opts.status||200})}};if(name==='stripe')return {default:class {accounts={retrieveCurrent:async()=>{accountCheck++;return {id:platformAccount,charges_enabled:true,payouts_enabled:true}}};checkout={sessions:{create:async input=>{calls++;checkoutInput=input;if(providerFailure)throw Error('synthetic private provider detail');assert.equal(input.line_items[0].quantity,1);return {id:'cs_mock',url:'https://checkout.stripe.com/test'}}}}}};if(name==='@supabase/ssr')return {createServerClient:()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:'user'}:null}})}})};if(name==='next/headers')return {cookies:()=>({get:()=>null})};if(name.endsWith('/admin'))return {createAdminClient:()=>({rpc:async name=>{if(name==='cs_hold_gallery_inventory')holds++;return {data:name==='cs_gallery_house_ready'?houseReady:'hold'}},from(table){dbCalls++;return {select(){return this},eq(){return this},update(){return this},is(){return this},order(){return this},limit:async()=>({data:assets}),maybeSingle:async()=>({data:table==='gallery_inventory_holds'?(linkFailure?null:{id:'hold'}):product})}}})};throw Error(name)}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/gallery/checkout/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const send=(body,origin='https://www.cafe-sativa.com')=>context.exports.POST({url:(context.process.env.NEXT_PUBLIC_SITE_URL||'https://www.cafe-sativa.com')+'/api/gallery/checkout',headers:{get:()=>origin},json:async()=>body});
(async()=>{
 assert.equal((await send({product_id:product.id},'https://evil.example')).status,403);
 for(const quantity of [0,-1,1.5,11,'2',null]) {if(quantity===null)continue;assert.equal((await send({product_id:product.id,quantity})).status,400)}
 assert.equal((await send(null)).status,400);
 assert.equal(calls,0);assert.equal(dbCalls,0);
 context.process.env.VERCEL_ENV='preview';
 assert.equal((await send({product_id:product.id})).status,503);assert.equal(calls,0);assert.equal(dbCalls,0);
 context.process.env.VERCEL_ENV='production';
 delete context.process.env.GALLERY_SALES_ENABLED;
 assert.equal((await send({product_id:product.id})).status,503);assert.equal(calls,0);assert.equal(dbCalls,0);
 context.process.env.GALLERY_SALES_ENABLED='true';
 assert.equal((await send({product_id:product.id})).status,409);
 assert.equal(dbCalls,0);assert.equal(holds,0);assert.equal(calls,0);
 const isolatedSite='http://127.0.0.1:4116',isolatedDb='http://127.0.0.1:54321';
 Object.assign(context.process.env,{VERCEL_ENV:undefined,GALLERY_ISOLATED_TEST:'true',
   STRIPE_SECRET_KEY:'sk_test_mock',GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_mock',
   NEXT_PUBLIC_SITE_URL:isolatedSite,NEXT_PUBLIC_SUPABASE_URL:isolatedDb,GALLERY_TEST_SUPABASE_URL:isolatedDb,
   NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'});
 assert.equal((await send({product_id:product.id},isolatedSite)).status,200);assert.equal(calls,1);
 assert.equal(checkoutInput.payment_intent_data.application_fee_amount,120);
 assert.equal(checkoutInput.payment_intent_data.transfer_data.destination,'acct_test');
 product={...product,kind:'digital',digital_delivery_url:null};
 assert.equal((await send({product_id:product.id},isolatedSite)).status,409);assert.equal(calls,1);
 product={...product,kind:'nft'};
 assert.equal((await send({product_id:product.id},isolatedSite)).status,409);assert.equal(calls,1);
 product={...product,kind:'physical',stock_count:0};
 assert.equal((await send({product_id:product.id},isolatedSite)).status,400);assert.equal(calls,1);
 const env=context.process.env;
 Object.assign(env,{VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_live_mock',GALLERY_PRODUCTION_SETTLEMENT_WEBHOOK:'true',GALLERY_SETTLEMENT_QUEUE_ENABLED:'true',
   GALLERY_PRODUCTION_FINANCIAL_REVIEW:'true',GALLERY_PRODUCTION_FINANCIAL_OWNER_IDS:'10000000-0000-4000-8000-000000000003',GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:'true',GALLERY_PRODUCTION_SETTLEMENT_WORKER:'true',GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET:'p'.repeat(48),GALLERY_REFUND_LEDGER:'true',
   GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:'acct_house',GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_house',
   NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',NEXT_PUBLIC_SUPABASE_URL:'https://nwfxvhqbjtfvoopcadff.supabase.co',GALLERY_ISOLATED_TEST:'false'});
 Object.assign(env,{GALLERY_HOUSE_PRODUCT_ID:product.id,GALLERY_HOUSE_ARTIST_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_house'});
 product={...product,artist_id:env.GALLERY_HOUSE_ARTIST_ID,kind:'digital',slug:'where-the-brass-meets-the-tide',currency:'usd',stock_count:1,artist:{id:env.GALLERY_HOUSE_ARTIST_ID,is_approved:true}};
 const debutSha='33483b370c172774d73b2a7445322e9973422e90e3cefdbcf0fa6ed01ec06f93';
 assets=[{id:'approved_edition',sha256:debutSha}];
 const post=()=>send({product_id:product.id,gallery_sale_kind:'house',payout_destination:'acct_client_override'});
 assert.equal((await post()).status,409);assert.equal(accountCheck,0);assert.equal(calls,1);
 env.GALLERY_HOUSE_CHECKOUT_ENABLED='true';
 const dbBeforeOffer=dbCalls,holdsBeforeOffer=holds;
 assert.equal((await send({product_id:'11111111-1111-4111-8111-111111111111'})).status,409);
 assert.equal((await send({product_id:product.id,quantity:2})).status,409);
 assert.equal(dbCalls,dbBeforeOffer);
 authenticated=false;assert.equal((await post()).status,401);authenticated=true;
 for (const altered of [{slug:'other'},{price_cents:1201},{currency:'eur'},{kind:'physical'},{artist_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{artist_id:null},{artist_id:undefined}]) {
   const prior=product;product={...product,...altered};
   assert.equal((await post()).status,409);product=prior;
 }
 assert.equal(holds,holdsBeforeOffer);assert.equal(calls,1);
 for (const rejectedAssets of [[],[{id:'different_edition',sha256:'a'.repeat(64)}],
   [{id:'approved_edition',sha256:debutSha},{id:'duplicate',sha256:debutSha}]]) {
   const prior=assets; assets=rejectedAssets;
   assert.equal((await post()).status,409); assets=prior;
 }
 assert.equal(holds,holdsBeforeOffer);assert.equal(calls,1);assert.equal(accountCheck,0);
 houseReady=false;
 assert.equal((await post()).status,503);assert.equal(accountCheck,0);assert.equal(calls,1);
 houseReady=true;
 platformAccount='acct_wrong';
 assert.equal((await post()).status,503);assert.equal(accountCheck,1);assert.equal(calls,1);
 platformAccount='acct_house';
 product.artist.id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 assert.equal((await post()).status,409);assert.equal(accountCheck,1);assert.equal(calls,1);
 product.artist.id=env.GALLERY_HOUSE_ARTIST_ID;
 assert.equal((await post()).status,200);assert.equal(accountCheck,2);assert.equal(calls,2);
 assert.equal(checkoutInput.line_items[0].price_data.currency,'usd');
 assert.equal(checkoutInput.line_items[0].price_data.unit_amount,1200);
 assert.ok(!('transfer_data' in checkoutInput.payment_intent_data));
 assert.ok(!('application_fee_amount' in checkoutInput.payment_intent_data));
 assert.equal(checkoutInput.metadata.gallery_sale_kind,'house');
 assert.equal(checkoutInput.payment_intent_data.metadata.gallery_platform_account_id,'acct_house');
 assert.equal(checkoutInput.metadata.approved_asset_id,'approved_edition');
 assert.equal(checkoutInput.metadata.gallery_settlement_schema,'queue-v1');
 assert.equal(checkoutInput.payment_intent_data.metadata.gallery_settlement_schema,'queue-v1');
 assert.equal(checkoutInput.payment_intent_data.metadata.site,'cafe-sativa');
 env.GALLERY_PRODUCTION_SETTLEMENT_WEBHOOK='false';
 assert.equal((await post()).status,503);assert.equal(calls,2);
 env.GALLERY_PRODUCTION_SETTLEMENT_WEBHOOK='true';
 env.GALLERY_PRODUCTION_FINANCIAL_REVIEW='false';assert.equal((await post()).status,503);assert.equal(calls,2);
 env.GALLERY_PRODUCTION_FINANCIAL_REVIEW='true';
 delete env.GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET;
 assert.equal((await post()).status,503);assert.equal(calls,2);
 env.GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET='p'.repeat(48);
 env.CRON_SECRET='p'.repeat(48);
 assert.equal((await post()).status,503);assert.equal(calls,2);
 delete env.CRON_SECRET;
 const local='http://127.0.0.1:4116', db='http://127.0.0.1:54321';
 Object.assign(env,{VERCEL_ENV:undefined,GALLERY_ISOLATED_TEST:'true',GALLERY_LOCAL_STRIPE_CLI:'true',
  STRIPE_SECRET_KEY:'rkcs_test_SYNTHETIC_NOT_A_KEY',GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID:'acct_house',
  GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_synthetic',NEXT_PUBLIC_SITE_URL:local,
  NEXT_PUBLIC_SUPABASE_URL:db,GALLERY_TEST_SUPABASE_URL:db,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'});
 assert.equal((await send({product_id:product.id},local)).status,200);assert.equal(calls,3);
 // Same local test key cannot send checkout to an unrelated artist destination.
 product={...product,id:'22222222-2222-4222-8222-222222222222',kind:'physical',artist:{id:'artist_independent',is_approved:true,charges_enabled:true,payouts_enabled:true,stripe_account_id:'acct_unrelated'}};
 assert.equal((await send({product_id:product.id},local)).status,409);assert.equal(calls,3);
 // Exercise both failure phases without leaking arbitrary provider details.
 product={...product,id:env.GALLERY_HOUSE_PRODUCT_ID,kind:'digital',slug:'where-the-brass-meets-the-tide',currency:'usd',stock_count:1,artist:{id:env.GALLERY_HOUSE_ARTIST_ID,is_approved:true}};
 providerFailure=true;
 const failedCreate=await send({product_id:product.id},local);
 assert.equal(failedCreate.status,500);
 assert.equal(failedCreate.body.error,'Could not start checkout. Please retry.');
 assert.deepEqual(errorLogs.at(-1),['[gallery/checkout] session_create_failed']);
 providerFailure=false;linkFailure=true;
 const failedLink=await send({product_id:product.id},local);
 assert.equal(failedLink.status,500);
 assert.deepEqual(errorLogs.at(-1),['[gallery/checkout] reservation_link_failed']);
 assert.equal(errorLogs.length,2);
 assert.ok(!JSON.stringify(errorLogs).includes('synthetic private provider detail'));
 console.log('PASS: cross-origin/malformed/invalid quantity rejected before provider; missing digital asset and stock blocked; valid mocked checkout succeeds');
})().catch(e=>{console.error(e);process.exitCode=1});

