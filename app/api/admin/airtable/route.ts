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
  if (req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const recordId = req.nextUrl.searchParams.get('recordId');
  if (req.nextUrl.searchParams.get('table') !== 'calendar' || !/^rec[a-zA-Z0-9]{14}$/.test(recordId || '')) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
  if (!AT_PAT) return NextResponse.json({ error: 'Draft service unavailable' }, { status: 503 });
  try {
    const body = await req.json();
    if (!['save','approve','return'].includes(body.action) || typeof body.copy !== 'string' || !body.copy.trim() || body.copy.length > 15000 || typeof body.expectedCopy !== 'string') return NextResponse.json({ error: 'Provide valid draft copy' }, { status: 400 });
    if (body.action === 'approve' && body.confirmAccuracy !== true) return NextResponse.json({ error: 'Review and confirm the copy accuracy before approval' }, { status: 400 });
    const url = `https://api.airtable.com/v0/${AT_BASE}/${TABLES.calendar}/${recordId}`;
    const headers = { Authorization: `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' };
    const found = await fetch(url, { headers, cache: 'no-store' });
    if (!found.ok) return NextResponse.json({ error: 'Unable to load draft' }, { status: 502 });
    const record = await found.json();
    if (['scheduled','published'].includes(record.fields.Status)) return NextResponse.json({ error: 'This item already has a delivery status. Review its delivery before editing.' }, { status: 409 });
    if ((record.fields['Copy Draft'] || '') !== body.expectedCopy) return NextResponse.json({ error: 'This draft changed. Close and reopen it before saving.' }, { status: 409 });
    const status = body.action === 'approve' ? 'approved' : 'pending_approval';
    const audit = `${new Date().toISOString()}: ${body.action === 'approve' ? 'Copy approved by authenticated owner; not a scheduling or media approval.' : body.action === 'return' ? 'Returned for revision by authenticated owner.' : 'Draft edited; approval reset for review.'}`;
    const fields = { 'Copy Draft': body.copy.trim(), 'Copy Final': body.action === 'approve' ? body.copy.trim() : '', Status: status, 'Approval Notes': `${record.fields['Approval Notes'] || ''}\n${audit}`.trim() };
    const saved = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
    if (!saved.ok) return NextResponse.json({ error: 'Unable to save draft' }, { status: 502 });
    return NextResponse.json(await saved.json(), { headers: { 'Cache-Control':'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to process draft update' }, { status: 400 }); }
}
