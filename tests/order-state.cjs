const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const c={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/order-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,c);
const state=c.exports.orderReceiptState;
assert.equal(state(null),'pending');assert.equal(state({fulfillment_state:'pending'}),'pending');assert.equal(state({paid_at:'invalid'}),'pending');
assert.equal(state({paid_at:'2026-10-11T10:00:00Z',fulfillment_state:'pending'}),'confirmed');
assert.equal(state({paid_at:'2026-10-11T10:00:00Z',fulfillment_state:'refunded'}),'refunded');
console.log('PASS: missing/unsettled orders cannot claim payment success; paid pending fulfillment confirmed; refunded orders cannot show fulfillment/download access');
