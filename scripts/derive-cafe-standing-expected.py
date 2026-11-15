#!/usr/bin/env python3
"""Derive a PRIVATE candidate manifest from a reviewed disposable object delta.
Not a live-schema replay, installer, approval, provider operation or production write.
"""
import argparse,copy,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
AUTHORIZED='cafe_metricool_private.authorized(uuid,text)'
BODY_MD5='b851290417cceb49a25ab085e75f4765'
OLD='AND public.cs_cafe_metricool_is_admin(a.approved_by)'
NEW='AND cafe_metricool_private.publication_authorized(p,p_digest) '+OLD
TABLES={f'cafe_metricool_private.{n}' for n in ['publication_scopes','publication_binding','publication_authorities','semantic_budgets','semantic_attempts']}
FUNCTIONS={
 'public.cs_cafe_generation_membership(uuid)',
 'cafe_metricool_private.publication_immutable()',
 'cafe_metricool_private.publication_binding_revoke()',
 'cafe_metricool_private.publication_current(uuid,uuid)',
 'cafe_metricool_private.publication_authorized(uuid,text)',
 'public.cs_record_enrolled_cafe_authority(uuid,jsonb,text,jsonb,jsonb)',
 'cafe_metricool_private.reserve_semantic_attempt(uuid,text,bigint)',
 'cafe_metricool_private.finish_semantic_attempt(text,jsonb)',
 'public.cs_reserve_cafe_semantic_attempt(uuid,text,bigint)',
 'public.cs_finish_cafe_semantic_attempt(text,jsonb)'}
KINDS={'roles','members','schemas','functions','relations','columns','constraints','triggers','policies','defaults'}
def key(kind,row):
 if kind in ['roles','schemas','relations']:return row['name']
 if kind=='functions':return row['identity']
 if kind in ['constraints','triggers','policies']:return row['table']+'/'+row['name']
 if kind=='columns':return row['table']+'/'+str(row['number'])
 if kind=='members':return '/'.join(row[x] for x in ['role','member','grantor'])
 if kind=='defaults':return '/'.join(str(row[x] or '') for x in ['role','schema','type'])
 raise ValueError('Unknown catalog kind')
def catalog(manifest):
 if set(manifest)!={'format','catalog'} or manifest['format']!='cafe-standing-catalog-v1' or set(manifest['catalog'])!=KINDS:raise ValueError('Complete manifest required')
 result={}
 for kind,rows in manifest['catalog'].items():
  if not isinstance(rows,list):raise ValueError('Catalog array required')
  result[kind]={key(kind,r):r for r in rows}
  if len(result[kind])!=len(rows):raise ValueError('Duplicate catalog identity: '+kind)
 return result

def transformed(row):
 if row['identity']!=AUTHORIZED or row['owner']!='cafe_metricool_owner':raise ValueError('Exact authority identity required')
 definition=row['definition'];match=re.search(r'AS (\$[A-Za-z0-9_]*\$)([\s\S]*)\1\s*$',definition)
 if not match or hashlib.md5(match.group(2).encode()).hexdigest()!=BODY_MD5 or definition.count(OLD)!=1 or NEW in definition:raise ValueError('Exact repaired authority body required')
 changed=copy.deepcopy(row);changed['definition']=definition.replace(OLD,NEW);return changed

def safe_new(kind,row):
 if kind=='functions':
  ident=row['identity'];owner='character_production_owner' if ident=='public.cs_cafe_generation_membership(uuid)' else 'cafe_metricool_owner'
  if ident not in FUNCTIONS or row['owner']!=owner:raise ValueError('Unexpected new function')
  # Current source explicitly removes public/role grants. Only new cross-owner
  # execute is the projection bridge. Manifest review still covers exact bodies.
  permitted={owner}
  if ident=='public.cs_cafe_generation_membership(uuid)':permitted.add('cafe_metricool_owner')
  acl=row['acl']
  if not isinstance(acl,str):raise ValueError('Explicit new function ACL required')
  entries=acl.strip('{}').split(',')
  if {e.split('=')[0] for e in entries}!=permitted or any(not re.fullmatch(r'[a-z_]+=X/'+owner,e) for e in entries):raise ValueError('Unexpected new function ACL')
 elif kind=='relations':
  if row['name'] not in TABLES|{t+'_pkey' for t in TABLES} or row['owner']!='cafe_metricool_owner':raise ValueError('Unexpected new relation')
  if row['name'] in TABLES and (row['kind']!='r' or row['rls'] is not True):raise ValueError('New table must retain RLS')
  if row['name'] not in TABLES and row['kind']!='i':raise ValueError('Expected primary index')
  acl=row['acl']
  if acl is not None and any(not re.fullmatch(r'cafe_metricool_owner=[arwdDxtm]+/cafe_metricool_owner',e) for e in acl.strip('{}').split(',')):raise ValueError('Unexpected relation ACL')
 elif kind in ['columns','constraints','triggers']:
  if row['table'] not in TABLES|({t+'_pkey' for t in TABLES} if kind=='columns' else set()):raise ValueError('Unexpected new child object')
  if kind=='columns' and row['acl'] is not None:raise ValueError('Unexpected column grant')
 else:raise ValueError('Unexpected catalog addition: '+kind)

def derive(live,fixture_before,fixture_after):
 l,b,a=map(catalog,[live,fixture_before,fixture_after]);result=copy.deepcopy(l)
 additions={};changes=[]
 for kind in sorted(KINDS):
  if set(b[kind])-set(a[kind]):raise ValueError('Disposable contract removed objects')
  added=set(a[kind])-set(b[kind]);additions[kind]=len(added)
  for ident in set(b[kind])&set(a[kind]):
   if b[kind][ident]!=a[kind][ident]:
    if kind!='functions' or ident!=AUTHORIZED or transformed(b[kind][ident])!=a[kind][ident]:raise ValueError('Unexpected disposable existing-object change')
    if ident not in l[kind]:raise ValueError('Live authority absent')
    result[kind][ident]=transformed(l[kind][ident]);changes.append(ident)
  for ident in added:
   if ident in l[kind]:raise ValueError('Target already exists in live baseline')
   safe_new(kind,a[kind][ident]);result[kind][ident]=copy.deepcopy(a[kind][ident])
 if changes!=[AUTHORIZED] or set(a['functions'])-set(b['functions'])!=FUNCTIONS or set(a['relations'])-set(b['relations'])!=TABLES|{t+'_pkey' for t in TABLES}:raise ValueError('Incomplete exact source delta')
 # Preserve every unrelated live catalog entry, including six/four grants,
 # full roles/membership/default topology, source schemas and existing tables.
 for kind in KINDS:
  for ident,row in l[kind].items():
   if not(kind=='functions' and ident==AUTHORIZED) and result[kind][ident]!=row:raise ValueError('Live non-target changed')
 return {'format':'cafe-standing-catalog-v1','catalog':{kind:[rows[k] for k in sorted(rows)] for kind,rows in result.items()}},additions

def load(path,digest):
 raw=Path(path).read_bytes()
 if not re.fullmatch('[0-9a-f]{64}',digest) or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Reviewed input hash mismatch')
 return json.loads(raw)
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for n in ['live-before','fixture-before','fixture-after']:
  p.add_argument('--'+n,required=True);p.add_argument('--'+n+'-sha256',required=True)
 p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output).resolve()
 if out==ROOT or ROOT in out.parents:raise ValueError('Private manifest output must remain outside repository')
 m,counts=derive(*[load(getattr(a,n),getattr(a,n+'_sha256')) for n in ['live_before','fixture_before','fixture_after']])
 raw=(json.dumps(m,separators=(',',':'))+'\n').encode();out.write_bytes(raw);out.chmod(0o600)
 print(json.dumps({'status':'private_candidate_overlay_not_live_replay','sha256':hashlib.sha256(raw).hexdigest(),'added':counts,'changed':['authorized_definition_only'],'liveActions':False}))
if __name__=='__main__':main()
