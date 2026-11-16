const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const logs=[],calls=[],clients=[],sentinel='SECRET_SERVICE_ROLE_SENTINEL';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:sentinel};
const response=new Response('ok');
const context={exports:{},process:{env},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x),warn:(...x)=>logs.push(x)},fetch:async(input,init)=>{calls.push({input,init});return response},require(n){assert.equal(n,'@supabase/supabase-js');return {createClient:(url,key,options)=>{const client={url,key,options};clients.push(client);return client}}}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/supabase/admin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
(async()=>{
 const client=context.exports.createAdminClient();assert.equal(client.url,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(client.key,sentinel);assert.equal(client.options.auth.persistSession,false);assert.equal(client.options.auth.autoRefreshToken,false);
 const wrapped=client.options.global.fetch;
 const headers=new Headers({authorization:`Bearer ${sentinel}`,'content-type':'application/json'}),body=JSON.stringify({operation:'sign',expiresIn:300}),signal=new AbortController().signal;
 for(const method of ['POST','PATCH','DELETE','PUT','GET']){
  const init={method,headers,body:method==='GET'?undefined:body,signal,cache:'force-cache',credentials:'omit',redirect:'manual'};
  const snapshot={...init};assert.equal(await wrapped('https://example.supabase.co/storage/v1/object/sign/clip',init),response);
  const call=calls.at(-1);assert.equal(call.init.cache,'no-store');assert.equal(call.init.method,method);assert.equal(call.init.headers,headers);assert.equal(call.init.body,init.body);assert.equal(call.init.signal,signal);assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'manual');assert.deepEqual(init,snapshot);assert.notEqual(call.init,init);
 }
 const request=new Request('https://example.supabase.co/rest/v1/items',{method:'POST',body,headers,cache:'force-cache'});
 await wrapped(request);let call=calls.at(-1);assert.equal(call.input,request);assert.equal(call.init.cache,'no-store');assert.deepEqual(Object.keys(call.init),['cache']);const effective=new Request(call.input,call.init);assert.equal(effective.method,'POST');assert.equal(effective.headers.get('authorization'),`Bearer ${sentinel}`);assert.equal(await effective.text(),body);assert.equal(effective.cache,'no-store');
 const url=new URL('https://example.supabase.co/rest/v1/items');await wrapped(url);assert.equal(calls.at(-1).input,url);assert.equal(calls.at(-1).init.cache,'no-store');
 for(const key of ['SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL']){const saved=env[key];delete env[key];assert.throws(()=>context.exports.createAdminClient(),e=>e.message==='Missing Supabase admin environment variables.'&&!e.message.includes(sentinel));env[key]=saved;}
 assert.equal(clients.length,1);assert.deepEqual(logs,[]);
 console.log('PASS: admin fetch always no-store; Request/URL/string input, methods, bodies, headers, signals and options preserved; caller init unmodified; credential/auth gates unchanged and no logs.');
})().catch(e=>{console.error(e);process.exitCode=1});
