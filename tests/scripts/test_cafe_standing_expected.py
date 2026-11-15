import copy,hashlib,importlib.util,json,re,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('derive',ROOT/'scripts/derive-cafe-standing-expected.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def authority():
 raw=(ROOT/'docs/proposals/cafe-metricool-store.sql').read_text()
 body=re.search(r'CREATE FUNCTION cafe_metricool_private.authorized\([^\n]*AS \$\$([\s\S]*?)\$\$;',raw).group(1)
 body=body.replace("EXISTS(SELECT 1 FROM auth.users WHERE id=a.approved_by AND raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)",'public.cs_cafe_metricool_is_admin(a.approved_by)')
 body=body.replace("(e.video_sha256=s->>'videoSha256' OR","(e.evidence->>'promoId'=d.id::text OR e.video_sha256=s->>'videoSha256' OR")
 assert hashlib.md5(body.encode()).hexdigest()==m.BODY_MD5
 return {'identity':m.AUTHORIZED,'definition':'CREATE OR REPLACE FUNCTION '+m.AUTHORIZED+'\nAS $function$'+body+'$function$\n','owner':'cafe_metricool_owner','acl':'{cafe_metricool_owner=X/cafe_metricool_owner}'}
def fixture():
 before={'format':'cafe-standing-catalog-v1','catalog':{k:[] for k in m.KINDS}}
 before['catalog']['functions']=[authority()]
 after=copy.deepcopy(before);after['catalog']['functions']=[m.transformed(authority())]
 for ident in sorted(m.FUNCTIONS):
  owner='character_production_owner' if 'cs_cafe_generation_membership' in ident else 'cafe_metricool_owner'
  acl='{'+owner+'=X/'+owner+(',cafe_metricool_owner=X/'+owner if owner=='character_production_owner' else '')+'}'
  after['catalog']['functions'].append({'identity':ident,'definition':'synthetic function for delta shape unit test only','owner':owner,'acl':acl})
 for table in m.TABLES:
  after['catalog']['relations'] += [{'name':table,'owner':'cafe_metricool_owner','kind':'r','rls':True,'acl':None},{'name':table+'_pkey','owner':'cafe_metricool_owner','kind':'i','rls':False,'acl':None}]
 return before,after
class Tests(unittest.TestCase):
 def test_preserve_extra_live(self):
  b,a=fixture();live=copy.deepcopy(b)
  live['catalog']['roles']=[{'name':'unrelated-role','setting':'untouched'}]
  live['catalog']['functions'].append({'identity':'public.existing_scoped_grant()','definition':'untouched','owner':'existing','acl':'{service_role=X/existing}'})
  out,c=m.derive(live,b,a)
  self.assertEqual(out['catalog']['roles'],live['catalog']['roles']);self.assertIn(live['catalog']['functions'][-1],out['catalog']['functions']);self.assertEqual(c['functions'],10)
 def test_new_runtime_grant_rejected(self):
  b,a=fixture();a['catalog']['functions'][-1]['acl']='{service_role=X/cafe_metricool_owner}'
  with self.assertRaises(ValueError):m.derive(b,b,a)
 def test_wrong_authority_pin(self):
  b,a=fixture();live=copy.deepcopy(b);live['catalog']['functions'][0]['definition']+=' altered'
  with self.assertRaises(ValueError):m.derive(live,b,a)
 def test_unrelated_fixture_change(self):
  b,a=fixture();a['catalog']['roles']=[{'name':'new-role'}]
  with self.assertRaises(ValueError):m.derive(b,b,a)
 def test_existing_target_rejected(self):
  b,a=fixture();live=copy.deepcopy(b);live['catalog']['relations']=[copy.deepcopy(a['catalog']['relations'][0])]
  with self.assertRaises(ValueError):m.derive(live,b,a)
 def test_duplicate_identity_rejected(self):
  b,a=fixture();b['catalog']['functions']*=2
  with self.assertRaises(ValueError):m.derive(b,b,a)
if __name__=='__main__':unittest.main()
