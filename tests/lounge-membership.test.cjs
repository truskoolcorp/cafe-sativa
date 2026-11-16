const {test}=require('node:test'); const assert=require('node:assert/strict'); const vm=require('node:vm'); const fs=require('node:fs'); const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../lib/lounge-membership.ts'),'utf8')).replace('export function','function');
const ctx=vm.createContext({}); vm.runInContext(source+';this.resolve=loungeMembershipTier;',ctx);
const now=Date.parse('2026-10-31T12:00:00Z');
test('future paid periods grant exact tier',()=>{for(const tier of ['regular','vip'])assert.equal(ctx.resolve({tier,status:'active',current_period_end:'2026-10-31T12:00:01Z'},now),tier)});
test('expired, exact-boundary, missing and malformed periods deny paid tier',()=>{for(const end of ['2026-10-31T11:59:59Z','2026-10-31T12:00:00Z',null,'invalid'])assert.equal(ctx.resolve({tier:'vip',status:'active',current_period_end:end},now),'explorer')});
test('past-due and canceled states cannot grant despite future expiry',()=>{for(const status of ['past_due','canceled','incomplete'])assert.equal(ctx.resolve({tier:'vip',status,current_period_end:'2026-11-01T12:00:00Z'},now),'explorer')});
test('missing and unknown memberships remain explorer',()=>{for(const member of [undefined,null,{tier:'admin',status:'active',current_period_end:'2026-11-01T12:00:00Z'}])assert.equal(ctx.resolve(member,now),'explorer')});
