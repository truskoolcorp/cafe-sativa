const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,deps,globals={}){const c={exports:{},require:n=>{if(n==='server-only')return {};if(n in deps)return deps[n];throw Error(n)},Buffer,structuredClone,Intl,Set,JSON,Number,Error,...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports}
const core=load('lib/content/character-production-replenishment.ts',{'node:crypto':require('node:crypto')})
for(const mode of ['revoked','aborted','freshness','lease','midnight','allowed'])test('real provider fetch boundary after asynchronous SDK preparation: '+mode,async()=>{
 let now=mode==='midnight'?Date.UTC(2026,10,17,5,59,59):Date.UTC(2026,10,16,15),enabled=true,outbound=0,saved=0,release,prepared
 const preparation=new Promise(r=>prepared=r),hold=new Promise(r=>release=r),controller=new AbortController()
 const source={characterId:'zaria',canonicalRevision:'a'.repeat(64),voiceId:'voice',portraitSha256:'b'.repeat(64),roomKey:'gallery',publicCanon:'Zaria hosts the Gallery.',publicProgramming:'No live event verified.',topic:'Look at art from a second angle.',verifiedHandles:[],recentScripts:[],observedAt:now}
 const output={title:'Look again',spokenScript:'Take another look. What detail did you notice this time?',visualBrief:'Zaria in the approved Gallery scene.',facebookTitle:'Look again with Zaria',caption:'A new angle on art.',hashtags:['CafeSativa'],collaborators:[]}
 const response={id:'receipt',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:100,output_tokens:100}}
 class SDK{constructor(options){assert.equal(options.maxRetries,0);this.messages={create:async(req,opts)=>{assert.equal(opts.maxRetries,0);prepared();await hold;await options.fetch('https://api.anthropic.com/v1/messages',{signal:opts.signal});return response}}}}
 const provider=load('lib/content/character-production-replenishment-provider.ts',{'@anthropic-ai/sdk':{default:SDK},'./character-production-replenishment':core},{process:{env:{ANTHROPIC_API_KEY:'fixture-only'}},fetch:async()=>{outbound++;return {}}})
 const lease={id:'11111111-1111-1111-1111-111111111111',period:'2026-11',model:core.REPLENISHMENT_MODEL,maxCostCents:10,monthlyCapCents:20,inputMicroUsdPerToken:1,outputMicroUsdPerToken:3,expiresAt:now+3600000,rateEvidence:'fixture ceiling'}
 const worker=core.createFreshCandidateReplenisher({enabled:()=>enabled,now:()=>now,load:async()=>source,store:{claim:async()=> 'claim',authorize:async()=>true,save:async()=>{saved++;return true}},complete:provider.createReplenishmentCompletion()})
 const attempt=worker.produce('daily:2026-11-16:zaria',lease,controller.signal)
 // Attach rejection handler before releasing delayed SDK work.
 const result=attempt.then(v=>({v}),e=>({e}));await preparation
 if(mode==='revoked')enabled=false
 if(mode==='aborted')controller.abort()
 if(mode==='freshness')now+=61000
 if(mode==='lease')now+=3600001
 if(mode==='midnight')now=Date.UTC(2026,10,17,6)
 release();const r=await result
 assert.equal(outbound,mode==='allowed'?1:0);assert.equal(saved,mode==='allowed'?1:0)
 if(mode==='allowed')assert.equal(r.v.status,'awaiting_audio_binding_and_qa');else assert.ok(r.e)
})
