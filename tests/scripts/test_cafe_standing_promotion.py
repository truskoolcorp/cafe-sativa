import datetime,hashlib,importlib.util,os,tempfile,unittest
from pathlib import Path
from test_cafe_standing_install import sample
P=Path(__file__).resolve().parents[2]/'scripts/prepare-cafe-standing-promotion.py'
s=importlib.util.spec_from_file_location('promotion',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
NOW=datetime.datetime(2026,11,15,12,tzinfo=datetime.timezone.utc)
class Tests(unittest.TestCase):
 def setUp(self):
  self.a=sample();self.b=sample();self.b['catalog']['functions'].append({'synthetic':'new'})
  self.sql=m.module().generate(self.a,self.b);self.sha=hashlib.sha256(self.sql.encode()).hexdigest()
 def run_promote(self,**kw):
  args=dict(before=self.a,after=self.b,rehearsal_sha=self.sha,approval_reference='synthetic-approval',review_reference='synthetic-review',expires_at='2026-11-15T12:10:00Z',now=NOW);args.update(kw);return m.promote(**args)
 def test_preserves_guards(self):
  sql=self.run_promote();self.assertTrue(sql.endswith('COMMIT;\n'));self.assertNotIn('\nROLLBACK;',sql)
  for fragment in ['Exact reviewed before catalog mismatch','Exact reviewed after catalog mismatch','Unexpected activation data','REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres'] :self.assertIn(fragment,sql)
  self.assertEqual(sql.count("RAISE EXCEPTION 'Promotion execution window expired'"),2)
 def test_bad_digest(self):
  with self.assertRaises(ValueError):self.run_promote(rehearsal_sha='0'*64)
 def test_invalid_or_expired_window(self):
  for exp in ['2026-11-15T12:00:00Z','2026-11-15T12:31:00Z','2026-11-15T12:10:00','bad']:
   with self.assertRaises(ValueError):self.run_promote(expires_at=exp)
 def test_reference_injection(self):
  for ref in ['',"approval\nCOMMIT;",'a'*201]:
   with self.assertRaises(ValueError):self.run_promote(approval_reference=ref)
 def test_private_exclusive_output(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'out.sql';m.write_private(p,self.run_promote());self.assertEqual(p.stat().st_mode&0o777,0o600)
   with self.assertRaises(FileExistsError):m.write_private(p,'overwrite')
  with self.assertRaises(ValueError):m.write_private(m.ROOT/'forbidden.sql','x')
if __name__=='__main__':unittest.main()
