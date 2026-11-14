import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync(new URL('../docs/proposals/character-production-preflight.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'')
test('foundation inventory remains metadata-only without mutation or provider calls',()=>{
 assert(!/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|CALL|DO|COPY)\b/i.test(sql.replace(/'(?:''|[^'])*'/g, '"literal"')))
 assert(!/\bcharacter_production_(claim|submitted|output|unknown)\s*\(/i.test(sql))
 assert(sql.includes("n.nspname='character_production'"))
 assert(sql.includes('pg_auth_members'))
 assert(sql.includes('acldefault'))
 assert(sql.includes('storage.buckets'))
 assert(!/SELECT\s+\*/i.test(sql))
})
