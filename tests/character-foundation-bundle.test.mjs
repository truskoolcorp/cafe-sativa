import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {prepareFoundation} from '../scripts/prepare-character-foundation.mjs'
test('offline bundle preserves exact ordered sources inside single guarded transaction',()=>{
 const read=name=>readFileSync(new URL('../docs/proposals/'+name,import.meta.url),'utf8')
 const a=prepareFoundation(read),b=prepareFoundation(read)
 assert.deepEqual(a,b);assert.equal(a.manifest.length,3)
 assert.equal((a.sql.match(/^BEGIN;$/gm)||[]).length,1)
 assert.equal((a.sql.match(/^COMMIT;$/gm)||[]).length,1)
 assert(a.sql.indexOf('Dedicated reviewed owner role required')<a.sql.indexOf('CREATE SCHEMA'))
 assert(!/CREATE ROLE|GRANT\s+(EXECUTE|ALL|USAGE)/i.test(a.sql))
 assert.throws(()=>prepareFoundation(()=> 'SELECT 1;'))
})
