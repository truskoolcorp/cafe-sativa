import importlib.util,json,hashlib,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parents[2]/'scripts/prepare-cafe-standing-install.py'
s=importlib.util.spec_from_file_location('installer',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def sample():return {'format':'cafe-standing-catalog-v1','catalog':{k:[{'synthetic':k}] for k in ['roles','members','schemas','functions','relations','columns','constraints','triggers','policies','defaults']}}
class Tests(unittest.TestCase):
 def test_digest(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x';p.write_text(json.dumps(sample()));digest=hashlib.sha256(p.read_bytes()).hexdigest()
   self.assertEqual(m.load_manifest(p,digest),sample())
   with self.assertRaises(ValueError):m.load_manifest(p,'0'*64)
 def test_lifecycle(self):
  a=sample();b=sample();b['catalog']['members']=[]
  with self.assertRaises(ValueError):m.generate(a,b)
 def test_noop(self):
  with self.assertRaises(ValueError):m.generate(sample(),sample())
 def test_rehearsal_only(self):
  a=sample();b=sample();b['catalog']['functions'].append({'synthetic':'new'})
  sql=m.generate(a,b)
  self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
  self.assertNotIn('\nCOMMIT;',sql)
  self.assertIn('Exact reviewed before catalog mismatch',sql)
  self.assertIn('Exact reviewed after catalog mismatch',sql)
  self.assertIn('REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres',sql)
  self.assertIn('Unexpected activation data',sql)
if __name__=='__main__':unittest.main()
