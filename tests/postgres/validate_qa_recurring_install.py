#!/usr/bin/env python3
"""Real disposable PG17 inert recurring installer with original non-superuser."""
import subprocess,time,concurrent.futures
import validate_ledger as db
import validate_qa_install as base
import validate_qa_recurring as fixture

def suite():
 base.suite()
 sql=(db.ROOT/'docs/proposals/character-production-qa-recurring-install.sql').read_text()
 assert sql==subprocess.check_output(['python3','scripts/prepare-qa-recurring-install.py'],cwd=db.ROOT,text=True)
 # Explicit fixture identity substitution: production installer postgres, this
 # disposable existing-owner fixture installer provision_installer, both nonsuper.
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 adapted=base.adapt(sql)
 before=base.snapshot()
 db.run(prefix+adapted.replace('\nCOMMIT;','\nROLLBACK;'));assert base.snapshot()==before
 for altered,label in [
  (adapted.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected'; END $$; COMMIT;"),'injected'),
  (adapted.replace(" IF EXISTS(SELECT 1 FROM character_production.qa_slot_bindings) THEN"," UPDATE character_production.jobs SET task='injected-data';\n IF EXISTS(SELECT 1 FROM character_production.qa_slot_bindings) THEN"),'job mutation'),
 ]:
  p=subprocess.run(db.command(),input=prefix+altered,text=True,capture_output=True);assert p.returncode,(label,p.stdout,p.stderr);assert base.snapshot()==before,label
 # Required FK and unexpected privileges fail before persistent DDL.
 fk=db.run("SELECT conname FROM pg_constraint WHERE conrelid='public.cs_character_promo_delivery_plans'::regclass AND confrelid='public.cs_character_promo_drafts'::regclass AND contype='f'")
 p=subprocess.run(db.command(),input=prefix+'BEGIN; ALTER TABLE public.cs_character_promo_delivery_plans DROP CONSTRAINT '+fk+'; '+adapted,text=True,capture_output=True);assert p.returncode and 'FK missing' in p.stderr,p.stderr;assert base.snapshot()==before
 p=subprocess.run(db.command(),input=prefix+'BEGIN; GRANT CREATE ON SCHEMA public TO character_production_owner; '+adapted,text=True,capture_output=True);assert p.returncode and 'baseline' in p.stderr,p.stderr;assert base.snapshot()==before
 db.run(prefix+adapted)
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE') AND NOT has_schema_privilege('provision_installer','character_production','USAGE') AND NOT has_column_privilege('character_production_owner','public.cs_character_promo_drafts','id','REFERENCES')",'temporary privileges restored')
 db.check('(SELECT count(*)=0 FROM character_production.qa_slot_bindings)','no bindings installed')
 db.check("(SELECT proowner='provision_installer'::regrole FROM pg_proc WHERE oid='public.character_production_qa_draft_unplanned(uuid)'::regprocedure)",'helper actual source owner preserved')
 for r in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check('NOT has_function_privilege('+db.quote(r)+",'public.character_production_qa_draft_unplanned(uuid)','EXECUTE')",'helper private')
  db.check('NOT has_table_privilege('+db.quote(r)+",'character_production.qa_slot_bindings','INSERT,UPDATE,DELETE,SELECT')",'no planner/raw rights')
  for f in ['public.character_production_qa_ready_slots(integer)','public.character_production_qa_materialize(text,text)']:
   db.check('has_function_privilege('+db.quote(r)+','+db.quote(f)+",'EXECUTE')="+str(r=='service_role').lower(),'only exact backend RPC')
 # Existing target copy rights cannot be used to write prebound but unmaterialized draft.
 pid=fixture.fixture('recurring-fresh',101)
 db.run("SET ROLE character_production_owner; SELECT id FROM public.cs_character_promo_drafts WHERE id='"+pid+"' FOR UPDATE")
 p=subprocess.run(db.command(),input="SET ROLE character_production_owner; UPDATE public.cs_character_promo_drafts SET updated_at=now() WHERE id='"+pid+"';",text=True,capture_output=True);assert p.returncode and 'row-level security' in p.stderr
 def plan(k,pid):return "INSERT INTO public.cs_character_promo_delivery_plans(promo_id,character_id,network,scheduled_at) VALUES('"+pid+"','synthetic-persona',"+db.quote(k)+",now());"
 stale=fixture.fixture('recurring-planned',102);db.run(plan('planned',stale))
 db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF public.character_production_qa_ready_slots(1) IS DISTINCT FROM jsonb_build_array(jsonb_build_object('key','recurring-fresh','digest',repeat('a',64))) OR public.character_production_qa_materialize('recurring-planned',repeat('a',64)) THEN RAISE EXCEPTION 'planned draft queued'; END IF; END $$;")
 # Plan-first FK row lock forces materializer to wait; after commit it refuses.
 pid=fixture.fixture('plan-first',103)
 leader=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 leader.stdin.write("SET application_name='qa_plan_race'; BEGIN; "+plan('race',pid)+" SELECT pg_sleep(3); COMMIT;\n");leader.stdin.close()
 for _ in range(50):
  if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='qa_plan_race' AND wait_event='PgSleep')")=='t':break
  time.sleep(.05)
 else:raise AssertionError('plan barrier not observed')
 db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF public.character_production_qa_materialize('plan-first',repeat('a',64)) THEN RAISE EXCEPTION 'racing plan allowed'; END IF; END $$;")
 leader.wait(timeout=10);assert leader.returncode==0,leader.stderr.read()
 # Materializer-first holds draft FOR UPDATE; FK plan insert waits until commit.
 pid=fixture.fixture('materialize-first',104)
 leader=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 leader.stdin.write("SET application_name='qa_materialize_race'; BEGIN; SET ROLE service_role; SELECT public.character_production_qa_materialize('materialize-first',repeat('a',64)); SELECT pg_sleep(3); COMMIT;\n");leader.stdin.close()
 for _ in range(50):
  if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='qa_materialize_race' AND wait_event='PgSleep')")=='t':break
  time.sleep(.05)
 else:raise AssertionError('materializer barrier not observed')
 started=time.monotonic();db.run(plan('after-materialize',pid));assert time.monotonic()-started>1,'FK did not serialize plan insert'
 leader.wait(timeout=10);assert leader.returncode==0,leader.stderr.read()
 fixture.check('materialize-first',False)
 db.check("(SELECT count(*)=1 FROM character_production.qa_targets WHERE job_key='materialize-first')",'one unchanged target despite later plan')
 # Fresh exact backend path materializes; subsequent plan prevents replay.
 db.run("SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF NOT public.character_production_qa_materialize('recurring-fresh',repeat('a',64)) THEN RAISE EXCEPTION 'fresh rejected'; END IF; END $$;")
 db.run(plan('later','99999999-9999-4999-8999-000000000101'));fixture.check('recurring-fresh',False)
 db.check("(SELECT reserved_cents=35 AND cap_cents=40 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11')",'budget preserved')
 db.finish('qa-recurring-install')
if __name__=='__main__':suite()
