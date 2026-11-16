const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, modules = {}) {
  const context = {exports: {}, require: name => {
    if(name==='@/lib/content/character-promo-watermark')return load('lib/content/character-promo-watermark.ts')
    assert.ok(name in modules, `Unexpected import: ${name}`)
    return modules[name]
  }}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
  }).outputText, context)
  return context.exports
}
const audio = load('lib/content/character-promo-audio.ts')
const sha = 'a'.repeat(64)
const draft = {
  id: 'promo-1', character_id: 'keith', title: 'Invitation', spoken_script: 'Please join us.',
  visual_brief: 'Approved portrait', duration_seconds: 30, status: 'script_approved',
  intended_channel: 'truskoolcorp_metricool_brand_5373515', actual_social_account: 'verified-account',
  audio_asset_path: null, video_asset_path: `character-promos/keith/promo-1/${sha}.mp4`,
  voice_approved_at: 'approved', video_qa_approved_at: 'approved', publication_approved_at: 'approved',
}
const checkNames = ['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']
const qa = checkNames.map(check_name => ({promo_id: draft.id, video_sha256: sha, check_name, result: 'pass', evidence:'Full clip reviewed', reviewer_id:'11111111-1111-4111-8111-111111111111',created_at:new Date().toISOString()}))
const plan = {id: 'plan-1', promo_id: draft.id, network: 'facebook', account_id: 'verified-account', status: 'ready_for_delivery'}
const status = (d = draft, rows = qa) => audio.characterPromoAudioStatus(d, rows)
const routes = ['readiness', 'production-packets', 'schedule-preview']
async function get(route, {d = draft, rows = qa, plans = [plan], errorTable, authorized = true, registry} = {}) {
  let reads = 0
  const db = {from(table) {
    reads++
    const data = {cs_character_promo_drafts: d ? [d] : [], cs_character_promo_qa_checks: rows, cs_character_promo_delivery_plans: plans}[table]
    assert.ok(data, `Unexpected table: ${table}`)
    const result = {data, error: table === errorTable ? {message: 'Unavailable'} : null}
    const query = {select() {return query}, order() {return query}, limit() {return query}, eq() {return query}, then(resolve, reject) {return Promise.resolve(result).then(resolve, reject)}}
    // No mutation or provider methods exist in this fake. Any such calls fail.
    return query
  }}
  const handler = load(`app/api/admin/programming/character-promos/${route}/route.ts`, {
    'next/server': {NextResponse: {json: (body, options = {}) => ({body, status: options.status || 200, headers: options.headers})}},
    '@/lib/content/auth': {isContentAdmin: async () => authorized},
    '@/lib/supabase/admin': {createAdminClient: () => db},
    '@/lib/content/character-promo-audio': audio,
    '@/lib/content/glyph-characters': {GLYPH_CHARACTER_SNAPSHOT: {characters: [{id:'keith',voice_id:'canonical-reference',primary_asset_id:'portrait'}]}},
    '@/lib/content/glyph-live': {liveGlyphCharacters: async () => registry || ({live:true,characters:[{id:'keith',rights_status:'approved',voice_status:'canonical',primary_asset_id:'portrait'}]})},
  })
  const result = await handler.GET()
  return {...result, reads}
}
function issues(route, result) {
  return route === 'readiness' ? result.body.items[0].blockers : route === 'production-packets' ? result.body.packets[0].blockers : result.body.suggestions[0].issues
}
function audioBlocked(route, result) {
  return issues(route, result).some(v => /audio|speech|voice/i.test(v))
}
test('embedded current-hash speech is evidence only; explicit voice approval remains necessary', () => {
  assert.equal(status().ready, true)
  const candidate = status({...draft, voice_approved_at: null})
  assert.equal(candidate.embeddedSpeechRecorded, true)
  assert.equal(candidate.ready, false)
  assert.equal(status({...draft, video_asset_path: null}).ready, false)
  assert.equal(status({...draft, video_asset_path: 'incoming-123.mp4'}).ready, false)
  assert.equal(audio.characterPromoAudioStatus(undefined, []).ready, false)
})
test('stale, unrelated, missing, failed or conflicting speech evidence fails closed', () => {
  const speech = qa.find(q => q.check_name === 'canonical_speech')
  for (const rows of [[], [{...speech,video_sha256:'b'.repeat(64)}], [{...speech,promo_id:'other'}], [{...speech,result:'needs_review'}], [{...speech,result:'fail'}], [{...speech,check_name:'mp4_integrity'}], [speech,{...speech,result:'fail'}]]) {
    assert.equal(status(draft, rows).ready, false)
  }
})
test('separate MP3 behavior remains unchanged and still needs final voice approval', () => {
  const mp3 = {...draft, audio_asset_path:'narration.mp3',video_asset_path:null}
  assert.equal(status(mp3, []).ready, true)
  assert.equal(status({...mp3,voice_approved_at:null}, []).ready, false)
})
for (const route of routes) {
  test(`${route}: valid embedded speech removes only the MP3 hold`, async () => {
    const result = await get(route)
    assert.equal(result.status, 200)
    assert.equal(result.headers['Cache-Control'], 'private, no-store')
    assert.equal(audioBlocked(route, result), false)
    if (route === 'readiness') assert.equal(result.body.items[0].ready, true)
    if (route === 'schedule-preview') assert.equal(result.body.suggestions[0].readyToSchedule, true)
    if (route === 'production-packets') {
      assert.equal(result.body.packets[0].readyForGeneration, false)
      assert.equal(result.body.packets[0].readyForPublishing, false)
    }
  })
  test(`${route}: invalid or unapproved embedded candidates remain blocked`, async () => {
    for (const options of [
      {rows: qa.map(q=>({...q,video_sha256:'b'.repeat(64)}))},
      ...['needs_review','fail'].map(result=>({rows:qa.map(q=>q.check_name==='canonical_speech'?{...q,result}:q)})),
      {rows:qa.filter(q=>q.check_name!=='canonical_speech')},
      {d:{...draft,voice_approved_at:null}}, {d:{...draft,video_asset_path:null}},
    ]) assert.equal(audioBlocked(route, await get(route, options)), true)
  })
  test(`${route}: MP3 and independent publication/video holds remain intact`, async () => {
    assert.equal(audioBlocked(route, await get(route, {d:{...draft,audio_asset_path:'narration.mp3'}, rows:[]})), false)
    assert.equal(audioBlocked(route, await get(route, {d:{...draft,audio_asset_path:'narration.mp3',voice_approved_at:null}})), true)
    for (const field of ['publication_approved_at','video_qa_approved_at']) {
      assert.ok(issues(route, await get(route, {d:{...draft,[field]:null}})).length > 0)
    }
  })
  test(`${route}: QA read errors fail closed and unauthorized callers cannot read`, async () => {
    assert.equal((await get(route, {errorTable:'cs_character_promo_qa_checks'})).status, 503)
    const denied = await get(route, {authorized:false})
    assert.equal(denied.status,401)
    assert.equal(denied.reads,0)
  })
}
test('readiness retains all nine exact-hash QA requirements and every delivery/account/script hold', async () => {
  for (const name of checkNames) {
    const result = await get('readiness',{rows:qa.filter(q=>q.check_name!==name)})
    assert.equal(result.body.items[0].ready,false)
    assert.ok(result.body.items[0].qaProgress.pending.includes(name))
  }
  for (const options of [
    {d:{...draft,status:'draft'}}, {d:{...draft,actual_social_account:null}},
    {d:{...draft,intended_channel:'wrong'}},
    {d:{...draft,character_id:'other',intended_channel:'character_profile_unconfirmed'}},
    {plans:[]}, {plans:[{...plan,account_id:null}]}, {plans:[{...plan,status:'draft'}]},
    {plans:[{...plan,status:'confirmed',provider_receipt:null}]},
  ]) assert.equal((await get('readiness',options)).body.items[0].ready,false)
})
test('schedule preview retains destination, script and delivery clearance holds; no scheduling enabled',async()=>{
  for (const options of [{d:null},{d:{...draft,status:'draft'}},{plans:[{...plan,account_id:null}]},{plans:[{...plan,status:'draft'}]}]) {
    const result = await get('schedule-preview', options)
    assert.equal(result.body.suggestions[0].readyToSchedule,false)
    assert.equal(result.body.automatedSchedulingEnabled,false)
    assert.equal(result.body.noPostsChanged,true)
  }
})
test('production packets retain live canon and account holds', async()=>{
  assert.ok(issues('production-packets',await get('production-packets',{registry:{live:false,characters:[]}})).length>0)
  assert.ok(issues('production-packets',await get('production-packets',{d:{...draft,actual_social_account:null}})).some(v=>/mapping/.test(v)))
})

test('readiness never infers owner attestation or independent verification from an uploaded MP4', async()=>{
  const unapproved = {...draft, voice_approved_at:null}
  const unreviewed = issues('readiness',await get('readiness',{d:unapproved,rows:[]}))
  assert.ok(unreviewed.includes('Final voice approval pending'))
  assert.equal(unreviewed.some(v=>/owner.attested|evidence recorded|independent.*verif/i.test(v)),false)
  const recorded = issues('readiness',await get('readiness',{d:unapproved}))
  assert.ok(recorded.includes('Embedded speech evidence recorded; final voice approval still pending'))
  assert.equal(recorded.some(v=>/owner.attested|independent.*verif/i.test(v)),false)
})
