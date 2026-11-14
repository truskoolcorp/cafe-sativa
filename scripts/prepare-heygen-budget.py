#!/usr/bin/env python3
"""Emit dormant proposal; does not apply schema or seed evidence/policy."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
for name,sha in {'character-production-store.sql':'2c858dabefdfaf67c9bf2fa7189503aaa7a55d27b1e1eb710b27365268881ca9','character-production-queue.sql':'60bbedfa3597b9bf86dfe67d05d49f678a99a076c3ea6a47d30910750e415624','character-production-receipt-evidence.sql':'330574ec751fd7590a3585b00c557237c5da0923e2b42b62353c4a0543aaeef8'}.items():
 assert hashlib.sha256((R/'docs/proposals'/name).read_bytes()).hexdigest()==sha
def function(file,name):
 s=(R/'docs/proposals'/file).read_text();a=s.index('CREATE FUNCTION public.'+name);b=s.index('END $$;',a)+7 if 'LANGUAGE plpgsql' in s[a:s.index('$$;',a)] else s.index('$$;',a)+3
 return s[a:b].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
head=(R/'docs/proposals/character-production-heygen-budget-body.sql').read_text()
claim=function('character-production-store.sql','character_production_claim(')
claim=claim.replace("to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')","character_production.calendar_period(b.provider,clock_timestamp())")
claim=claim.replace(' INSERT INTO character_production.jobs(key,digest'," IF b.provider='heygen' AND (b.cap_cents>2000 OR NOT character_production.heygen_spend_allowed(a.slot,a.digest,cost,NULL)) THEN RETURN NULL; END IF;\n INSERT INTO character_production.jobs(key,digest")
due=function('character-production-queue.sql','character_production_due(').replace("to_char(o.at AT TIME ZONE 'UTC','YYYY-MM')","character_production.calendar_period(p_provider,o.at)")
due=due.replace('  WHERE s.enabled AND a.enabled AND b.enabled',"  WHERE s.enabled AND a.enabled AND b.enabled AND (b.provider<>'heygen' OR b.cap_cents<=2000)")
receipt=function('character-production-receipt-evidence.sql','character_production_observe_receipt(').replace("to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')","character_production.calendar_period(j.provider,clock_timestamp())")
receipt=receipt.replace("   AND j.period=", "   AND (j.provider<>'heygen' OR character_production.heygen_spend_allowed(j.slot,j.digest,j.cost,j.key))\n   AND j.period=")
print(head+'\n'+claim+'\n'+due+'\n'+receipt+'\nCOMMIT;')
