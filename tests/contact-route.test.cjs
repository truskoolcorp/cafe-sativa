const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
function harness(options = {}) {
  const emails = [];
  let handler, inserts = 0, done = 0;
  let source = fs.readFileSync(require('node:path').join(__dirname, '../app/api/contact/route.ts'), 'utf8');
  source = source.replace(/^import .*\n/gm, '').replace(/export /g, '')
    .replace(/await import\(\s*'@\/lib\/email\/send-contact-acknowledgment'\s*\)/g, '({ sendContactAcknowledgment: mockAcknowledgment })')
    .replace(/await import\('@\/lib\/email\/send'\)/g, '({ sendEmail: mockEmail })');
  const notify = async (data) => { emails.push(data); await new Promise(resolve => setTimeout(resolve, 5)); done++; if (options.emailFailure) throw Error('mock failure'); return { ok: true }; };
  vm.runInNewContext(stripTypeScriptTypes(source) + '; out.handler=POST;', {
    NextResponse: { json: (data, init) => ({ data, status: init?.status || 200 }) },
    createAdminClient: () => ({ from: () => ({ insert: async () => { inserts++; return { error: options.dbFailure ? { message: 'mock' } : null }; } }) }),
    mockAcknowledgment: notify, mockEmail: notify,
    process: { env: { CONTACT_FORWARD_TO: 'team@example.invalid' } }, console: { error() {} },
    out: { set handler(value) { handler = value; } },
  });
  const body = { name: '<b>Test</b>', email: 'test@example.invalid', subject: '<img src=x>', message: 'This is a test contact message.', ...options.body };
  return { emails, run: () => handler({ json: async () => body, headers: { get: () => null } }), counts: () => ({ inserts, done }) };
}
test('contact response waits for both notification attempts', async () => {
  const h = harness(); assert.equal((await h.run()).status, 200); assert.equal(h.counts().done, 2);
});
test('user-controlled names and subjects are escaped in team HTML', async () => {
  const h = harness(); await h.run(); const html = h.emails.find(e => e.html).html;
  assert(!html.includes('<b>Test</b>')); assert(!html.includes('<img src=x>')); assert(html.includes('&lt;b&gt;'));
});
test('structured contact fields are rejected before persistence', async () => {
  const h = harness({ body: { name: {} } }); assert.equal((await h.run()).status, 400); assert.equal(h.counts().inserts, 0);
});
test('notification failure does not discard a stored message', async () => {
  const h = harness({ emailFailure: true }); assert.equal((await h.run()).status, 200); assert.equal(h.counts().inserts, 1);
});
test('database failure does not send acknowledgment emails', async () => {
  const h = harness({ dbFailure: true }); assert.equal((await h.run()).status, 500); assert.equal(h.emails.length, 0);
});
