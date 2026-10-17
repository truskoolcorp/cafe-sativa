const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const source=fs.readFileSync('lib/content/social-contract.ts','utf8')
const module={exports:{}}
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true})
assert.equal(js.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
vm.runInNewContext(js.outputText,{module,exports:module.exports,require,URL,Intl,Date,Object,Array,String,Number,Boolean})
const {verifiedSocialPublication,providerLocalDate}=module.exports
const timezone='America/Los_Angeles', scheduled_at='2026-10-15T00:00:00Z'
const row={provider_uuid:'uid-one',provider_post_id:123,caption:'Approved Café Sativa copy',scheduled_at}
const provider=(network,host)=>({network,status:'PUBLISHED',publicUrl:'https://'+host+'/posts/123'})
const post={id:123,uuid:'uid-one',text:row.caption,publicationDate:{timezone,dateTime:providerLocalDate(scheduled_at,timezone)},providers:[provider('facebook','facebook.com'),provider('threads','www.threads.com')]}
test('both approved networks with verified identity and public URLs confirm publication',()=>{const x=verifiedSocialPublication(post,row,timezone);assert.equal(x.publicationConfirmed,true);assert.match(x.publicUrls.facebook,/facebook.com/)})
for(const [name,mutate] of Object.entries({
 'missing Threads network':p=>p.providers.pop(),
 'wrong provider uuid':p=>p.uuid='other',
 'wrong provider id':p=>p.id=234,
 'wrong caption':p=>p.text='Changed',
 'wrong scheduled date':p=>p.publicationDate.dateTime='2026-10-16T17:00:00',
 'pending Threads':p=>p.providers[1].status='PENDING',
 'unapproved Instagram':p=>p.providers[1].network='instagram',
 'untrusted Facebook URL':p=>p.providers[0].publicUrl='https://facebook.com.evil.example/posts/123',
 'http URL':p=>p.providers[1].publicUrl='http://threads.com/post/a',
 'duplicate network':p=>p.providers[1].network='facebook'
})){test(name+' does not confirm',()=>{const p=structuredClone(post);mutate(p);assert.equal(verifiedSocialPublication(p,row,timezone),null)})}
test('read-only path keeps ledger receipt updates behind guard',()=>{const s=fs.readFileSync('lib/content/social-delivery.ts','utf8');assert.match(s,/if \(options\.readOnly\) continue\s*const update=/)})
