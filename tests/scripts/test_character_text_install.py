import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[2]/'scripts/prepare-character-text-install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
 b={'format':'cafe-standing-catalog-v1','catalog':{k:[] for k in ['roles','members','schemas','defaults','triggers','policies','functions','relations','columns','constraints']}}
 a=copy.deepcopy(b);c=a['catalog'];c['functions']=[{'identity':x,'owner':'character_production_owner'} for x in m.FUNCTIONS];c['relations']=[{'name':x,'owner':'character_production_owner'} for x in m.RELATIONS];c['columns']=[{'table':next(iter(m.TABLES)),'name':'id'}];c['constraints']=[{'table':next(iter(m.TABLES)),'name':'fixture'}];return b,a
class Tests(unittest.TestCase):
 def test_rollback_only_and_restoration(self):
  b,a=fixture();s=m.generate(b,a);self.assertTrue(s.rstrip().endswith('ROLLBACK;'));self.assertNotIn('COMMIT;',s);self.assertEqual(s.count('SET LOCAL ROLE character_production_owner;'),1);self.assertIn('REVOKE character_production_owner FROM postgres GRANTED BY postgres;',s);self.assertNotIn('TO service_role',s);self.assertNotIn('INSERT INTO character_production.text_replenishment_budgets',s)
 def test_no_lifecycle_expansion(self):
  for k in ['roles','members','schemas','defaults','triggers','policies']:
   b,a=fixture();a['catalog'][k]=[{'unexpected':True}]
   with self.assertRaises(ValueError):m.generate(b,a)
 def test_reject_existing_edit_and_extra_objects(self):
  b,a=fixture();b['catalog']['functions']=[{'identity':'existing','owner':'old'}]
  with self.assertRaises(ValueError):m.generate(b,a)
  b,a=fixture();a['catalog']['relations'].append({'name':'unrelated','owner':'character_production_owner'})
  with self.assertRaises(ValueError):m.generate(b,a)
 def test_reject_owner_change(self):
  b,a=fixture();a['catalog']['functions'][0]['owner']='service_role'
  with self.assertRaises(ValueError):m.generate(b,a)
if __name__=='__main__':unittest.main()
