const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const NOW = Date.parse('2026-11-09T09:00:00.000Z')
const SOURCE = 'https://studio.truskool.net/api/studios/cafe-sativa-canon'
const SYNTHETIC_ENV = Object.freeze({
  GLYPH_CANON_READ_TOKEN: 'SYNTHETIC_CANON_TOKEN_NOT_A_CREDENTIAL',
  NEXT_PUBLIC_SUPABASE_URL: 'https://nwfxvhqbjtfvoopcadff.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'SYNTHETIC_ANON_KEY_NOT_A_CREDENTIAL',
})

// Each harness owns its module cache, clock, fetch, and environment. No real
// environment value is read and an omitted fetch never reaches the network.
function createHarness({ fetch = async () => { throw Error('Network forbidden in fixture') }, now = () => NOW, env = { ...SYNTHETIC_ENV }, root = path.resolve(__dirname, '../..') } = {}) {
  const loaded = new Map()
  class FixtureDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now()) }
    static now() { return now() }
  }
  function load(relative) {
    const file = path.resolve(root, relative)
    if (loaded.has(file)) return loaded.get(file)
    const exports = {}
    loaded.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const localRequire = name => {
      if (name === 'server-only') return {}
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'))
      if (name.startsWith('node:')) return require(name)
      throw Error('Unexpected fixture import: ' + name)
    }
    new Function('exports', 'require', 'process', 'fetch', 'Date', code)(exports, localRequire, { env }, fetch, FixtureDate)
    return exports
  }
  return { load }
}

function syntheticRow(patch = {}) {
  return {
    id: 'laviche-fea', name: 'Synthetic Laviche',
    primary_asset_id: '12345678-1234-1234-1234-123456789abc',
    sha256: 'b'.repeat(64), rights_status: 'approved',
    voice_id: 'SYNTHETIC_PRIVATE_VOICE', voice_status: 'canonical',
    approved_reference_count: 1, portrait_available: true, blockers: [],
    canonical_gaps: [], requires_rights_consent: false,
    canonical_context: 'SYNTHETIC_PRIVATE_CANON', profile_version: 7,
    production_ready: true, ...patch,
  }
}

function envelope(row = syntheticRow(), patch = {}) {
  return {
    verifiedAt: new Date(NOW).toISOString(), source: 'GLYPH live canonical registry',
    studioUrl: 'https://studio.truskool.net/', live: true, characters: [row], ...patch,
  }
}

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json' }, ...init,
})

const enrich = row => ({ ...row, portrait_url: row.portrait_available && row.primary_asset_id
  ? `/api/content/glyph/portrait?characterId=${encodeURIComponent(row.id)}&assetId=${encodeURIComponent(row.primary_asset_id)}`
  : null })

module.exports = { createHarness, syntheticRow, envelope, jsonResponse, enrich, NOW, SOURCE, SYNTHETIC_ENV }
