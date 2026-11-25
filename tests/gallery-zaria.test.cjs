const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const ts=require('typescript')
function compile(path, deps={}) {
  const module={exports:{}}
  const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','exports','module',code)(id=>{
    if(Object.hasOwn(deps,id))return deps[id]
    if(id==='node:crypto')return require(id)
    throw Error('Unexpected dependency: '+id)
  },module.exports,module)
  return module.exports
}
const policy=compile('lib/gallery/zaria.ts')
const d=compile('lib/gallery/zaria-catalog.ts',{'./zaria':policy,'@supabase/supabase-js':{createClient(){throw Error('No network')}}})
test('only the exact canonical primary approved portrait can display',()=>{
  const row={id:'zaria-solenne',production_ready:true,rights_status:'approved',primary_asset_id:policy.ZARIA_PORTRAIT.id,sha256:policy.ZARIA_PORTRAIT.sha256}
  assert.equal(policy.approvedZariaPortrait(row),true)
  for(const broken of [{sha256:'mismatch'},{rights_status:'pending'},{production_ready:false},{id:'ginger'}])assert.equal(policy.approvedZariaPortrait({...row,...broken}),false)
})
test('serves current work and real alternate links without leaking private or NFT candidates',()=>{
  const items=[{slug:'alternate',title:'Alternate',kind:'physical'},{slug:'current',title:'Current piece',kind:'digital'},{slug:'nft',title:'NFT',kind:'nft'},{slug:'../../admin',title:'Private',kind:'digital'}]
  const data=d.publicGallerySelection(items,'current')
  assert.equal(JSON.parse(data.context).current.title,'Current piece')
  assert.deepEqual(data.links.map(v=>v.path),['/gallery/current','/gallery/alternate','/gallery'])
  assert.equal(d.publicGallerySelection(items,'private').links.some(v=>v.path==='/gallery/private'),false)
  assert.equal(policy.zariaGalleryHref('/malicious'),' /ask?host=zaria'.trim())
})
test('empty and unverified catalog statuses are different and both offer a real Gallery link',()=>{
  for(const [rows,unavailable,status] of [[[],false,'no_public_listings'],[[{slug:'ignored',title:'Ignored',kind:'digital'}],true,'unavailable']]){
    const data=d.publicGallerySelection(rows,'ignored',unavailable)
    assert.equal(JSON.parse(data.context).status,status)
    assert.equal(JSON.parse(data.context).current,null)
    assert.deepEqual(data.links,[{label:'Explore the Gallery',path:'/gallery'}])
  }
})
