import { NextRequest, NextResponse } from 'next/server';

const AT_BASE = process.env.AIRTABLE_BASE_ID || 'appOKiDIBrgayTVW5';
const AT_PAT  = process.env.AIRTABLE_PAT!;

const TABLES: Record<string, string> = {
  calendar:   'tblF4taJ2uMuK9hQG',
  genLog:     'tblrqrmpMVXridABu',
  publishLog: 'tblmziJeOofHnTzVz',
  brief:      'tblGcyrva3YIy74aI',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  const params = searchParams.get('params') || '';
  if (!table || !TABLES[table]) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
  if (!AT_PAT) return NextResponse.json({ error: 'Missing AIRTABLE_PAT env var' }, { status: 500 });
  const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${TABLES[table]}${params}`, { headers: { Authorization: `Bearer ${AT_PAT}` }, next: { revalidate: 0 } });
  return NextResponse.json(await res.json());
}

export async function PATCH(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table');
  const recordId = searchParams.get('recordId');
  if (!table || !TABLES[table] || !recordId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  if (!AT_PAT) return NextResponse.json({ error: 'Missing AIRTABLE_PAT env var' }, { status: 500 });
  const body = await req.json();
  const res = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${TABLES[table]}/${recordId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: body.fields }) });
  return NextResponse.json(await res.json());
}
