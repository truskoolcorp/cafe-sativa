const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')

const { stripTypeScriptTypes } = require('node:module')
const code = stripTypeScriptTypes(readFileSync(require('node:path').join(__dirname, '../app/api/lounge/report/route.ts'), 'utf8')
  .replace(/^import .*$/gm, '').replace('export async function POST', 'async function POST'))
const id = '00000000-0000-4000-8000-000000000000'
const target = { room_id: id, message_id: id }

async function submit({ user = { id }, body = target, error = null } = {}) {
  let row
  const POST = runInNewContext(code + '; POST', {
    NextResponse: { json: (payload, options) => ({ payload, status: options?.status ?? 200 }) },
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user } }) },
      from: () => ({ insert: async (value) => { row = value; return { error } } }),
    }),
  })
  return { status: (await POST({ json: async () => body })).status, row }
}

test('report requires a valid target and signed-in non-anonymous account', async () => {
  assert.equal((await submit({ user: null })).status, 401)
  assert.equal((await submit({ user: { is_anonymous: true } })).status, 401)
  assert.equal((await submit({ body: { room_id: 'bad' } })).status, 400)
})

test('only target fields are persisted; duplicates succeed without retry', async () => {
  const { status, row } = await submit({ body: { ...target, reporter_id: 'spoofed' }, error: { code: '23505' } })
  assert.equal(status, 200)
  assert.equal(JSON.stringify(row), JSON.stringify(target))
})

test('database policy denials and outages fail closed', async () => {
  assert.equal((await submit({ error: { code: '42501' } })).status, 403)
  assert.equal((await submit({ error: { code: '42P01' } })).status, 503)
})
