import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {prepareProvisioning,generatorSignatures,brokerSignatures} from '../scripts/prepare-character-provisioning.mjs'
test('offline provisioning has exact bounded roles, grants and no QA/LOGINs',()=>{const r=prepareProvisioning(n=>readFileSync(new URL('../docs/proposals/'+n,import.meta.url),'utf8'));assert.equal((r.sql.match(/^BEGIN;$/gm)||[]).length,1);assert.equal((r.sql.match(/^COMMIT;$/gm)||[]).length,1);assert.equal(r.manifest.length,3);assert(!r.sql.includes('qa_targets'));assert(!/PASSWORD|CREATE ROLE[^;]*\sLOGIN\s/.test(r.sql));assert.equal((r.sql.match(/^GRANT EXECUTE/gm)||[]).length,generatorSignatures.length+brokerSignatures.length);assert(r.sql.includes('SET FALSE')===false);assert(r.sql.includes('m.set_option'));assert(r.sql.includes("SET LOCAL createrole_self_grant=''"));assert(!/GRANT.+TO service_role/.test(r.sql));assert.throws(()=>prepareProvisioning(()=>''))})
