const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const policy={exports:{},URL,Intl,Date};vm.runInNewContext(compile('lib/content/policy.ts'),policy);
const version=policy.exports.CONTENT_POLICY.version;
function fixture(options={}) {
 const asset={id:'master',kind:'venue',subject:'bar',active:true,approved_by:'owner',approved_at:'now',url:'https://example.com/bar.png',sha256:'a'.repeat(64),version:'1'};
 const draft={id:'draft',room:'bar',status:'planned',policy_version:version,title:'Bar',caption:'Virtual bar',updated_at:'before',created_at:'1',qa_approved_by:'old',qa_approved_at:'old'};
 const source={id:'source',room:'bar',canonical_asset_id:'master',status:'approved',policy_version:version,qa_approved_by:'owner',qa_approved_at:'now',output_url:'22222222-2222-4222-8222-222222222222.mp4',created_at:'0'};
 const assets=[asset],jobs=[source,draft];let writes=[];
 options.configure?.({asset,draft,source,assets,jobs});
 const db={from(table){let filters=[],patch=null,limit=Infinity;const rows=table==='cs_canonical_assets'?assets:jobs;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(n){limit=n;return q},update(v){patch=v;return q},then(a,b){options.beforeRead?.({table,asset,draft,source,jobs,patch});if(patch)options.beforeWrite?.({asset,draft,source,jobs});const found=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(patch){writes.push(patch);found.forEach(r=>Object.assign(r,patch));}return Promise.resolve({data:structuredClone(found),error:null}).then(a,b)}};return q}};
 const context={exports:{},Date,require(n){if(n.endsWith('/policy'))return policy.exports;if(n.endsWith('/admin'))return {createAdminClient:()=>db};throw Error(n)}};vm.runInNewContext(compile('lib/content/reuse-approved.ts'),context);
 return {asset,draft,source,jobs,writes,run:context.exports.reuseApprovedWhilePaused};
}
(async()=>{
 let f=fixture();assert.equal((await f.run()).reused,1);assert.equal(f.draft.status,'pending_qa');assert.equal(f.draft.qa_approved_by,null);assert.equal(f.draft.qa_approved_at,null);assert.equal(f.draft.output_url,f.source.output_url);assert.deepEqual(Object.keys(f.writes[0]).sort(),['canonical_asset_id','output_url','status','qa_approved_by','qa_approved_at','blocker','updated_at'].sort());
 for(const configure of [
 ({source})=>source.qa_approved_by=null,
 ({source})=>source.qa_approved_at=null,
 ({source})=>source.policy_version='2026-10-07',
 ({source})=>source.output_url='../secret.mp4',
 ({source})=>source.output_url='https://example.com/clip.mp4',
 ({source})=>source.status='failed',
 ({asset})=>asset.active=false,
 ({assets,asset})=>assets.push({...asset,id:'other'}),
 ({draft})=>draft.canonical_asset_id='revoked',
 ({draft})=>draft.status='blocked',
 ({draft})=>draft.policy_version='old',
 ({draft})=>draft.caption=' ',
 ({jobs,source})=>jobs.push({...source,id:'pending',status:'pending_qa'}),
 ]) {f=fixture({configure});assert.equal((await f.run()).reused,0);}
 f=fixture({configure:({source})=>Object.assign(source,{policy_version:'2026-10-07',blocker:'Owner visual override by owner: reviewed'})});assert.equal((await f.run()).reused,1);
 f=fixture({beforeWrite:({draft})=>draft.updated_at='changed'});assert.equal((await f.run()).reused,0);
 f=fixture({configure:({jobs,source})=>{jobs.unshift(...Array.from({length:1001},(_,i)=>({...source,id:'unrelated'+i,room:'gallery',canonical_asset_id:'other'})));jobs.push({...source,id:'late-pending',status:'pending_qa'})}});assert.equal((await f.run()).reused,0,'Pending sibling beyond unrelated historical rows must block reuse');
 console.log('PASS: QA, policy, canonical, ambiguity, private path, queue and target CAS checks; only pending-QA fields written.');
 if(process.argv.includes('--race-regressions')) {
  let reads=0;f=fixture({beforeRead:({table,asset})=>{if(table==='cs_canonical_assets' && ++reads===2)asset.active=false}});assert.equal((await f.run()).reused,0,'Canonical revoked before final recheck must not reuse');
  reads=0;f=fixture({beforeRead:({table,source})=>{if(table==='cs_canonical_assets' && ++reads===2){source.qa_approved_at=null;source.status='failed'}}});assert.equal((await f.run()).reused,0,'Source revoked before final recheck must not reuse');
  f=fixture({configure:({jobs,draft})=>jobs.push({...draft,id:'draft2'})});await Promise.all([f.run(),f.run()]);assert.equal(f.jobs.filter(j=>j.status==='pending_qa').length,1,'Concurrent workers must create at most one review draft per master');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
