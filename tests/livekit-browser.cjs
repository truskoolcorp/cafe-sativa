const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const timers=new Set();let nextConnect=null;
class Room {
 constructor(){this.events={};this.remoteParticipants=new Map();this.canPlaybackAudio=true;this.mics=0;this.disconnects=0;this.localParticipant={setMicrophoneEnabled:async()=>this.mics++}}
 on(event,fn){this.events[event]=fn;return this}
 removeAllListeners(){this.events={}}
 async connect(){if(nextConnect)await nextConnect}
 async startAudio(){}
 async disconnect(){this.disconnects++}
}
const events={};for(const name of ['ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected','AudioPlaybackStatusChanged'])events[name]=name;
const context={exports:{},require:()=>({Room,RoomEvent:events,Track:{Kind:{Audio:'audio'}},ParticipantKind:{AGENT:4}}),setTimeout:(fn,ms)=>{const timer={fn,ms};timers.add(timer);return timer},clearTimeout:timer=>timers.delete(timer)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/concierge/live-voice-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
(async()=>{
 let room;const states=[];const root={appendChild:element=>element.attached=true};
 const client=new context.exports.LiveVoiceConnection((...state)=>states.push(state),root,()=>room=new Room());
 await client.start('wss://example.invalid','test');assert.equal(room.mics,1);assert.equal(states.at(-1)[0],'waiting');
 room.events.ParticipantConnected({kind:4});assert.equal(states.at(-1)[0],'connected');
 let removed=0;const element={remove:()=>removed++};const track={kind:'audio',attach:()=>element,detach:()=>[element]};
 room.events.TrackSubscribed(track);assert.equal(element.attached,true);
 client.stop();assert.equal(removed,1);assert.equal(room.disconnects,1);assert.equal(timers.size,0);
 let release;nextConnect=new Promise(resolve=>release=resolve);const pending=client.start('wss://example.invalid','test');const canceledRoom=room;client.stop();release();await pending;assert.equal(canceledRoom.mics,0);assert.equal(canceledRoom.disconnects,2);
 nextConnect=null;await client.start('wss://example.invalid','test');const absent=room;Array.from(timers).find(t=>t.ms===20000).fn();assert.equal(states.at(-1)[0],'error');assert.equal(absent.disconnects,1);
 await client.start('wss://example.invalid','test');room.events.ParticipantConnected({kind:4});room.events.Reconnecting();assert.equal(states.at(-1)[0],'reconnecting');room.events.Reconnected();assert.equal(states.at(-1)[0],'connected');
 Array.from(timers).find(t=>t.ms===300000).fn();assert.equal(states.at(-1)[0],'ended');assert.equal(timers.size,0);
 console.log('PASS: mic only after join, host state, audio cleanup, canceled join cannot publish, absent-host timeout, reconnect and call limit');
})().catch(error=>{console.error(error);process.exitCode=1});
