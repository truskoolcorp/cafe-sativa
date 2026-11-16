const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const c={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/episode-briefs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);
for(const brief of c.exports.EPISODE_BRIEFS){
 const room={id:brief.roomAssetId,sha256:brief.roomSha256,subject:brief.room,active:true,approved_at:'2026-10-11',approved_by:'owner'};
 const cast=brief.cast.map(a=>({id:a.id,primary_asset_id:a.assetId,sha256:a.sha256,voice_id:a.voiceId,voice_status:'canonical',rights_status:'approved',production_ready:true}));
 const matches=(characters=cast,reference=room)=>c.exports.episodeCanonMatches(brief,characters,reference);
 assert.equal(matches(),true);assert.equal(matches(cast,{...room,active:false}),false);
 for(const property of ['voice_id','primary_asset_id','sha256','rights_status','voice_status'])assert.equal(matches(cast.map((a,i)=>i===0?{...a,[property]:'changed'}:a)),false);
 assert.equal(matches(cast.map(a=>({...a,production_ready:false}))),false);assert.equal(matches([],room),false);
 assert.notEqual(c.exports.episodeHash(brief),c.exports.episodeHash({...brief,caption:brief.caption+' changed'}));
 assert.equal(brief.releaseAt,null);assert.equal(brief.cast.some(a=>a.id==='chef-v'),false);
}
console.log('PASS: exact cast, portrait, voice, rights, readiness and current room gates; script changes invalidate approval; no Chef V or invented release dates');
