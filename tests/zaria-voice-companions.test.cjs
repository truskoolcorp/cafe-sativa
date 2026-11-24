const test=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript')
const ParticipantKind={STANDARD:0,AGENT:4}, c={exports:{},TextDecoder,require:()=>({ParticipantKind})}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/concierge/live-voice-client.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c)
const parse=c.exports.parseGalleryVoiceLinks
const topic='cafe-sativa.zaria.gallery-links.v1'
const user={kind:0,attributes:{'lk.agent.name':'cafe-sativa-zaria'}}
const agent={kind:4,attributes:{'lk.agent.name':'cafe-sativa-zaria'}}
const packet=(sequence=3,path='/gallery/blue-hour')=>Buffer.from(JSON.stringify({sequence,links:[{label:'Blue Hour',path}]}))
test('named LiveKit agent only, no guest metadata or avatar impersonation',()=>{
 assert.equal(parse(packet(),user,topic,0),null)
 assert.equal(parse(packet(),undefined,topic,0),null)
 assert.equal(parse(packet(),{...agent,attributes:{'lk.agent.name':'another-host'}},topic,0),null)
 assert.equal(parse(packet(),{...agent,attributes:{...agent.attributes,'lk.publish_on_behalf':'other'}},topic,0),null)
 assert.equal(parse(packet(),agent,'other',0),null)
 assert.equal(parse(packet(),agent,topic,0).links[0].path,'/gallery/blue-hour')
})
test('stale packet after interruption stays hidden; links never leave Gallery',()=>{
 assert.equal(parse(packet(3),agent,topic,3),null)
 const clear=Buffer.from(JSON.stringify({sequence:4,links:[]}))
 assert.equal(parse(clear,agent,topic,3).links.length,0)
 assert.equal(parse(packet(3),agent,topic,4),null)
 for(const path of ['//evil.test/gallery','/gallery/../checkout','/gallery/%2f','/gallery?url=foo','https://evil.test','/gallery/fake/manage'])
   assert.equal(parse(packet(5,path),agent,topic,4),null)
 assert.equal(parse(Buffer.from([255]),agent,topic,4),null)
 assert.equal(parse(Buffer.alloc(2050),agent,topic,4),null)
})
