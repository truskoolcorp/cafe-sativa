const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../lib/podcast-video.ts'),'utf8')).replaceAll('export ','');
const context=vm.createContext({});vm.runInContext(source+';this.parse=newestPlaylistVideo',context);
const now=Date.parse('2026-11-12T12:00:00Z');
const entry=(id,date,title='An episode')=>`<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${date}</published></entry>`;
test('newest publication wins independent of playlist ordering',()=>{const xml=entry('abcdefghijk','2026-11-10')+entry('zyxwvutsrqp','2026-11-11')+entry('12345678901','2026-11-09');assert.equal(context.parse(xml,now).id,'zyxwvutsrqp')});
test('reject future, malformed dates and unsafe video IDs',()=>{assert.equal(context.parse(entry('bad/id','2026-11-10')+entry('abcdefghijk','invalid')+entry('zyxwvutsrqp','2026-11-13'),now),null)});
test('empty and oversized feeds fail closed',()=>{assert.equal(context.parse('',now),null);assert.equal(context.parse(' '.repeat(1000001),now),null)});
test('title is plain text and entities are decoded',()=>{assert.equal(context.parse(entry('abcdefghijk','2026-11-11','<![CDATA[Leaf <b>&amp;</b> Culture]]>'),now).title,'Leaf & Culture')});
