const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const clean = value => JSON.parse(JSON.stringify(value))
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const source = {
  id: '00000000-0000-4000-8000-000000000001', release_title: 'Before Me',
  artist_name: 'THE Verse Alkemist', reported_track_count: 7,
  catalog_status: 'needs_verification', streaming_status: 'unverified',
}
const prior = (changes = {}) => ({
  id: '00000000-0000-4000-8000-000000000099', proposal_key: 'owner-existing',
  proposed_month: '2026-11', performance_type: 'music', title: 'Owner concept',
  description: 'Owner edits', status: 'draft', created_at: '2026-10-01', ...changes,
})

// Stateful offline database implements the two existing uniqueness constraints.
// Neither network access nor an unlisted table/write operation is available.
function database({ catalog = [source], proposals = [], fail, onInsert } = {}) {
  const state = { catalog: clean(catalog), proposals: clean(proposals), calls: [], writes: [], conflicts: 0 }
  const db = { from(table) {
    assert.ok(['cs_music_catalog', 'cs_programming_proposals', 'cs_canonical_assets', 'cs_content_jobs'].includes(table), table)
    const op = { table, kind: 'read', filters: [], orders: [], fields: '', row: null, cap: Infinity, single: false }
    const q = {
      select(fields) { op.fields = fields; return q },
      eq(key, value) { op.filters.push(row => row[key] === value); return q },
      neq(key, value) { op.filters.push(row => row[key] !== value); return q },
      in(key, values) { op.filters.push(row => values.includes(row[key])); return q },
      or(expression) {
        const match = /^and\(proposed_month.eq.(20\d{2}-\d{2}),performance_type.eq.music\),proposal_key.eq.(inventory-music-20\d{2}-\d{2})$/.exec(expression)
        assert.ok(match, expression)
        op.filters.push(row => (row.proposed_month === match[1] && row.performance_type === 'music') || row.proposal_key === match[2])
        return q
      },
      order(key, { ascending }) { op.orders.push({ key, ascending }); return q },
      limit(value) { op.cap = value; return q },
      insert(row) { assert.equal(table, 'cs_programming_proposals'); op.kind = 'insert'; op.row = clean(row); return q },
      upsert(rows) { assert.equal(table, 'cs_content_jobs'); op.kind = 'upsert'; op.rows = clean(rows); return q },
      single() { op.single = true; return q },
      then(resolve, reject) { return Promise.resolve().then(() => {
        state.calls.push(op)
        const error = fail?.(op, state)
        if (error) return { data: null, error }
        if (op.kind === 'upsert') { state.writes.push(op); return { data: [], error: null } }
        if (op.kind === 'insert') {
          onInsert?.(op, state)
          const duplicate = state.proposals.some(row => row.proposal_key === op.row.proposal_key || (
            row.proposed_month === op.row.proposed_month && row.performance_type === 'music' && row.status !== 'rejected'
          ))
          if (duplicate) { state.conflicts++; return { data: null, error: { code: '23505' } } }
          const row = { id: 'generated-' + state.proposals.length, created_at: '2026-11-01', ...op.row }
          state.proposals.push(row); state.writes.push(op)
          return { data: project(row), error: null }
        }
        let rows = (table === 'cs_music_catalog' ? state.catalog : table === 'cs_programming_proposals' ? state.proposals : []).filter(row => op.filters.every(f => f(row)))
        rows = [...rows].sort((a, b) => { for (const { key, ascending } of op.orders) { if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1) } return 0 }).slice(0, op.cap)
        return { data: clean(rows.map(project)), error: null }
        function project(row) { return op.fields === '*' || !op.fields ? clean(row) : Object.fromEntries(op.fields.split(',').map(key => [key, row[key]])) }
      }).then(resolve, reject) },
    }
    return q
  } }
  return { db, state }
}
function runtime(options = {}) {
  const { db, state } = database(options)
  let adminCalls = 0
  const stages = []
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-01T05:30:00Z'])) } }
  const modules = {}
  const mock = {
    '@/lib/supabase/admin': { createAdminClient() { adminCalls++; if (options.setupError) throw Error('secret backend address'); return db } },
    '@/lib/content/auth': { isContentAdmin: async () => options.authorized !== false, cronAuthorized: () => options.authorized !== false },
    'next/server': { NextResponse: { json: (body, init) => ({ body: clean(body), status: init?.status || 200, headers: init?.headers }) } },
    '@/lib/content/reference-previews': { planReferencePreviews: async () => { stages.push('references'); if (options.referenceFailure) throw Error('secret failure'); return 0 } },
    '@/lib/content/clip-features': { planApprovedClipFeatures: async () => { stages.push('clips'); return 0 } },
    '@/lib/content/site': {
      planSiteContent: async () => { stages.push('site'); return 0 },
      publishDueSiteContent: async () => { stages.push('existing_site_publisher'); return 0 },
    },
  }
  function load(file) {
    if (modules[file]) return modules[file]
    const mod = { exports: {} }
    vm.runInNewContext(compile(file), { exports: mod.exports, module: mod, Date: Clock, Intl, URL, Set,
      require(name) {
        if (mock[name]) return mock[name]
        if (name === '@/lib/content/policy') return load('lib/content/policy.ts')
        if (name === '@/lib/content/private-programming') return load('lib/content/private-programming.ts')
        throw Error('Unexpected dependency: ' + name)
      },
      fetch() { throw Error('No network allowed') },
    }, { filename: file })
    modules[file] = mod.exports
    return mod.exports
  }
  return { state, stages, adminCalls: () => adminCalls, planner: load('lib/content/private-programming.ts'), db,
    cron: () => load('app/api/content/cron/route.ts'), manual: () => load('app/api/admin/programming/proposals/recommend/route.ts') }
}
function request(changes = {}) {
  const headers = { origin: 'https://example.com', 'content-length': '19', authorization: 'Bearer local-test', ...changes.headers }
  return { headers: { get: key => headers[key] ?? null }, nextUrl: { origin: 'https://example.com' }, json: async () => changes.body || { month: '2026-11' } }
}
const plan = env => env.planner.recommendPrivateCatalogMusic(env.db, '2026-11', 'automatic')

test('creates only a private unscheduled inventory draft and preserves evidence', async () => {
  const env = runtime()
  const result = await plan(env)
  assert.equal(result.status, 'created')
  assert.equal(env.state.writes.length, 1)
  const row = env.state.proposals[0]
  assert.equal(row.title, 'Catalog spotlight: Before Me')
  assert.equal(row.source_catalog_id, source.id)
  assert.equal(row.artist_name, source.artist_name)
  assert.equal(row.proposed_month, '2026-11')
  assert.equal(row.status, 'draft')
  assert.equal(row.confidence, 'low')
  assert.deepEqual(row.source_evidence, [{ kind: 'internal_release_inventory', catalogId: source.id, releaseTitle: source.release_title, catalogStatus: source.catalog_status, streamingStatus: source.streaming_status, reportedTrackCount: 7, engagementEvidence: false, externallyVerified: false }])
  for (const field of ['proposed_start', 'scheduled_at', 'approved_at', 'owner_reviewed_at', 'owner_reviewed_by', 'published_at', 'event_id', 'budget', 'render_id']) assert.equal(row[field], undefined)
  assert.match(row.description, /not a confirmed event/)
  assert.match(row.production_brief, /Do not render or schedule without further approval/)
  assert.ok(env.state.calls.every(op => ['cs_music_catalog', 'cs_programming_proposals'].includes(op.table)))
  assert.ok(env.state.writes.every(op => op.table === 'cs_programming_proposals' && op.kind === 'insert'))
  assert.deepEqual(env.stages, [])
})

test('empty inventory or invalid titles do not fabricate a proposal', async () => {
  for (const catalog of [[], [{ ...source, release_title: '' }], [{ ...source, release_title: '   ' }], [{ ...source, release_title: 'x'.repeat(240) }], [{ ...source, artist_name: 'Other artist' }]]) {
    const env = runtime({ catalog })
    assert.equal((await plan(env)).status, 'empty_catalog')
    assert.equal(env.state.writes.length, 0)
  }
})
for (const status of ['draft', 'owner_review', 'revision_requested', 'concept_approved', 'rejected']) test(`automatic mode preserves an existing ${status} proposal including owner edits`, async () => {
  const original = prior({ status })
  const env = runtime({ proposals: [original] })
  assert.equal((await plan(env)).status, 'existing')
  assert.deepEqual(env.state.proposals, [original])
  assert.equal(env.state.writes.length, 0)
  assert.equal(env.state.calls.length, 1)
})

test('current production-shaped November inventory draft is skipped without writes', async () => {
  const existing = prior({ proposal_key: 'inventory-music-2026-11', title: 'Catalog spotlight: Before Me', source_catalog_id: source.id })
  const env = runtime({ proposals: [existing] })
  const result = await env.planner.planPrivateProgramming(new Date('2026-11-07T12:00:00Z'))
  assert.equal(result.status, 'existing')
  assert.equal(result.month, '2026-11')
  assert.equal(result.proposal.title, existing.title)
  assert.equal(env.state.writes.length, 0)
})

test('permanent month key preserves a proposal moved by owner to a different month/type', async () => {
  const env = runtime({ proposals: [prior({ proposal_key: 'inventory-music-2026-11', proposed_month: '2027-01', performance_type: 'other' })] })
  assert.equal((await plan(env)).status, 'existing')
  assert.equal(env.state.writes.length, 0)
})

test('rejection in a different month is not a permanent catalog-source ban', async () => {
  const env = runtime({ proposals: [prior({ status: 'rejected', proposed_month: '2026-10', source_catalog_id: source.id })] })
  assert.equal((await plan(env)).status, 'created')
  assert.equal(env.state.proposals[1].source_catalog_id, source.id)
})

test('sequential retries never overwrite or duplicate a draft', async () => {
  const env = runtime()
  await plan(env)
  env.state.proposals[0].description = 'Reviewed owner edits'
  assert.equal((await plan(env)).status, 'existing')
  assert.equal(env.state.writes.length, 1)
  assert.equal(env.state.proposals[0].description, 'Reviewed owner edits')
})

test('two concurrent actual planner calls resolve the unique-conflict to the winning row', async () => {
  const env = runtime()
  const results = await Promise.all([plan(env), plan(env)])
  assert.deepEqual(results.map(r => r.status).sort(), ['created', 'existing'])
  assert.equal(results[0].proposal.id, results[1].proposal.id)
  assert.equal(env.state.conflicts, 1)
  assert.equal(env.state.proposals.length, 1)
  assert.equal(env.state.writes.length, 1)
})

test('a racing owner proposal wins without overwrite', async () => {
  const original = prior()
  const env = runtime({ onInsert(op, state) { state.proposals.push(clean(original)) } })
  const result = await plan(env)
  assert.equal(result.status, 'existing')
  assert.equal(result.proposal.id, original.id)
  assert.equal(env.state.conflicts, 1)
  assert.deepEqual(env.state.proposals, [original])
  assert.equal(env.state.writes.length, 0)
})

test('unexplained unique conflict is a failure, not a success receipt', async () => {
  const env = runtime({ fail: op => op.kind === 'insert' && { code: '23505' } })
  await assert.rejects(plan(env), error => error.stage === 'concurrent_proposal')
  assert.equal(env.state.writes.length, 0)
})

for (const [label, fail, expected] of [
  ['proposal read', op => op.table === 'cs_programming_proposals', 'existing_proposals'],
  ['catalog read', op => op.table === 'cs_music_catalog', 'catalog_inventory'],
  ['insert', op => op.kind === 'insert', 'save_proposal'],
]) test(`backend ${label} errors identify their stage and never continue`, async () => {
  const env = runtime({ fail: op => fail(op) && { code: 'XX000', message: 'private backend details' } })
  await assert.rejects(plan(env), error => error.stage === expected && !error.message.includes('private backend details'))
  assert.equal(env.state.writes.length, 0)
})

test('transport exceptions are sanitized and reported at the current stage', async () => {
  const env = runtime({ fail(op) { if (op.table === 'cs_music_catalog') throw Error('secret backend address') } })
  await assert.rejects(plan(env), error => error.stage === 'catalog_inventory' && !error.message.includes('secret'))
})

test('Chicago month is correct at UTC, DST-season, and year boundaries', async () => {
  for (const [instant, month] of [
    ['2026-11-01T04:59:59Z', '2026-10'], ['2026-11-01T05:00:00Z', '2026-11'],
    ['2027-01-01T05:59:59Z', '2026-12'], ['2027-01-01T06:00:00Z', '2027-01'],
  ]) {
    const env = runtime()
    const result = await env.planner.planPrivateProgramming(new Date(instant))
    assert.equal(result.month, month)
    assert.equal(env.state.proposals[0].proposal_key, 'inventory-music-' + month)
  }
})

test('catalog rotation has a stable tie-break and uses only actual inventory', async () => {
  const catalog = [{ ...source, id: 'b' }, { ...source, id: 'a' }]
  const first = runtime({ catalog }), second = runtime({ catalog: [...catalog].reverse() })
  await plan(first); await plan(second)
  assert.equal(first.state.proposals[0].source_catalog_id, second.state.proposals[0].source_catalog_id)
  assert.ok(catalog.some(row => row.id === first.state.proposals[0].source_catalog_id))
})

test('manual route retains admin, same-origin, input and size gates before database access', async () => {
  for (const [opts, req, status] of [
    [{ authorized: false }, request(), 401], [{}, request({ headers: { origin: 'https://evil.example' } }), 403],
    [{}, request({ headers: { 'content-length': '1501' } }), 413], [{}, request({ body: { month: '2026-13' } }), 400],
  ]) {
    const env = runtime(opts)
    assert.equal((await env.manual().POST(req)).status, status)
    assert.equal(env.adminCalls(), 0)
  }
})

test('manual creation returns the unchanged private-only permission flags', async () => {
  const env = runtime()
  const response = await env.manual().POST(request())
  assert.equal(response.status, 201)
  for (const name of ['engagementAnalyzed', 'publicEventCreated', 'productionApproved', 'renderingStarted', 'publishingStarted']) assert.equal(response.body[name], false)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
})

test('manual empty, active proposal, owner rejection and inventory rejection retain explicit behavior', async () => {
  for (const [opts, expected] of [
    [{ catalog: [] }, 404], [{ proposals: [prior()] }, 409],
    [{ proposals: [prior({ status: 'rejected' })] }, 201],
    [{ proposals: [prior({ proposal_key: 'inventory-music-2026-11', status: 'rejected' })] }, 409],
  ]) {
    const env = runtime(opts)
    assert.equal((await env.manual().POST(request())).status, expected)
    assert.equal(env.state.writes.length, expected === 201 ? 1 : 0)
  }
})

test('manual backend setup failure returns sanitized 503', async () => {
  const env = runtime({ setupError: true })
  const response = await env.manual().POST(request())
  assert.equal(response.status, 503)
  assert.equal(response.body.stage, 'database_setup')
  assert.doesNotMatch(JSON.stringify(response), /secret backend/)
})

test('cron authorization remains ahead of all planning and database activity', async () => {
  const env = runtime({ authorized: false })
  assert.equal((await env.cron().GET(request())).status, 401)
  assert.equal(env.adminCalls(), 0)
  assert.deepEqual(env.stages, [])
})

test('cron executes the real private planner and keeps existing content stages separate', async () => {
  const env = runtime()
  const response = await env.cron().GET(request())
  assert.equal(response.status, 200)
  assert.equal(response.body.privateProgramming.status, 'created')
  assert.equal(response.body.privateProgramming.month, '2026-11')
  assert.equal(env.state.proposals.length, 1)
  assert.deepEqual(env.stages, ['references', 'site', 'clips', 'existing_site_publisher'])
})

test('cron private planning failure is reported after all established content stages run', async () => {
  const env = runtime({ fail: op => op.table === 'cs_music_catalog' && { code: 'XX000' } })
  const response = await env.cron().GET(request())
  assert.equal(response.status, 503)
  assert.equal(response.body.stage, 'private_programming')
  assert.equal(response.body.detail, 'catalog_inventory')
  assert.equal(response.body.partialFailure, true)
  assert.equal(response.body.privateProgramming.status, 'failed')
  assert.deepEqual(response.body.completedStages, ['reference_previews', 'site_planning', 'clip_features', 'site_publishing', 'content_slots'])
  assert.equal(env.state.writes.filter(op => op.table === 'cs_programming_proposals').length, 0)
  assert.equal(env.state.writes.filter(op => op.table === 'cs_content_jobs').length, 1)
  assert.deepEqual(env.stages, ['references', 'site', 'clips', 'existing_site_publisher'])
})

test('cron reports both private and existing-pipeline failures without hiding either', async () => {
  const env = runtime({ referenceFailure: true, fail: op => op.table === 'cs_music_catalog' && { code: 'XX000' } })
  const response = await env.cron().GET(request())
  assert.equal(response.status, 503)
  assert.equal(response.body.stage, 'reference_previews')
  assert.equal(response.body.privateProgramming.status, 'failed')
  assert.equal(response.body.privateProgramming.detail, 'catalog_inventory')
  assert.deepEqual(response.body.completedStages, [])
  assert.deepEqual(env.stages, ['references'])
})

test('cron reports earlier completed private planning when a subsequent stage fails', async () => {
  const env = runtime({ referenceFailure: true })
  const response = await env.cron().GET(request())
  assert.equal(response.status, 503)
  assert.equal(response.body.stage, 'reference_previews')
  assert.deepEqual(response.body.completedStages, ['private_programming'])
  assert.equal(env.state.proposals.length, 1)
  assert.deepEqual(env.stages, ['references'])
  assert.doesNotMatch(JSON.stringify(response), /secret failure/)
})

test('existing database constraints retain permanent key and active-month uniqueness without permission changes', () => {
  const sql = fs.readFileSync('supabase/migrations/20261020130000_private_programming_proposals.sql', 'utf8')
  assert.match(sql, /proposal_key text not null unique/)
  assert.match(sql, /unique index.*\(proposed_month\).*performance_type='music' and status <> 'rejected'/)
  assert.match(sql, /revoke all on public.cs_programming_proposals from anon,authenticated/)
})
