import { NextRequest, NextResponse } from 'next/server';
import { isContentAdmin } from '@/lib/content/auth';

const AT_BASE = process.env.AIRTABLE_BASE_ID || 'appOKiDIBrgayTVW5';
const AT_PAT  = process.env.AIRTABLE_PAT!;

const TABLES: Record<string, string> = {
  calendar:   'tblF4taJ2uMuK9hQG',
  genLog:     'tblrqrmpMVXridABu',
  publishLog: 'tblmziJeOofHnTzVz',
  brief:      'tblGcyrva3YIy74aI',
};

export async function GET(req: NextRequest) {
  if (!await isContentAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  const raw = new URLSearchParams((searchParams.get('params') || '').replace(/^\?/, ''));
  const allowed = new URLSearchParams();
  // Only allow the dashboard's bounded pagination/sort parameters through the service credential.
  for (const [name, value] of Array.from(raw.entries())) {
    if (/^sort\[\d+\]\[(field|direction)\]$/.test(name)) allowed.append(name, value);
  }
  allowed.set('maxRecords', String(Math.min(100, Math.max(1, Number(raw.get('maxRecords')) || 50))));
  const params = `?${allowed.toString()}`;
  if (!table || !TABLES[table]) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
  if (!AT_PAT) return NextResponse.json({ error: 'Missing AIRTABLE_PAT env var' }, { status: 500 });
  const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${TABLES[table]}${params}`, { headers: { Authorization: `Bearer ${AT_PAT}` }, next: { revalidate: 0 } });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: NextRequest) {
  if (!await isContentAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ error: 'Historical drafts are read-only. Use Content review for current media approvals.' }, { status: 409 });
}
