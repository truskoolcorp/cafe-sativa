/** Offline artifact builder only. Never connects to a database. Output is a
 * review bundle, not auto-discovered by any migration runner. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const files=['character-production-store.sql','character-production-qa-bridge.sql','character-production-queue.sql']
export function prepareFoundation(read){
 const entries=files.map(name=>{
  const source=read(name)
  if((source.match(/^BEGIN;$/gm)||[]).length!==1||(source.match(/^COMMIT;$/gm)||[]).length!==1)throw Error('Unexpected transaction boundaries')
  return {name,sha256:createHash('sha256').update(source).digest('hex'),sql:source.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')}
 })
 const guard=`DO $$ BEGIN
 IF current_user <> 'character_production_owner' THEN RAISE EXCEPTION 'Dedicated reviewed owner role required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN RAISE EXCEPTION 'Unsafe owner role'; END IF;
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PostgreSQL 17 required'; END IF;
 IF to_regnamespace('character_production') IS NOT NULL THEN RAISE EXCEPTION 'Foundation already exists: reconcile, do not overwrite'; END IF;
 IF to_regclass('public.cs_character_promo_drafts') IS NULL THEN RAISE EXCEPTION 'Promo foundation missing'; END IF;
END $$;`
 return {manifest:entries.map(({name,sha256})=>({name,sha256})),sql:'-- REVIEW ARTIFACT ONLY. No role provisioning, grants, credentials, slots or activation.\nBEGIN;\nSET LOCAL lock_timeout=\'5s\';\nSET LOCAL statement_timeout=\'60s\';\n'+guard+'\n'+entries.map(e=>e.sql).join('\n')+'\nCOMMIT;\n'}
}
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1]).href){
 const output=process.argv[2]
 if(!output||!output.endsWith('.review.sql'))throw Error('Specify explicit .review.sql output; no database execution is supported')
 const result=prepareFoundation(name=>readFileSync(new URL('../docs/proposals/'+name,import.meta.url),'utf8'))
 writeFileSync(output,result.sql,{flag:'wx',mode:0o600})
 writeFileSync(output+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx',mode:0o600})
}
