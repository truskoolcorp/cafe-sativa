import {spawn} from 'node:child_process'
import {createReadStream} from 'node:fs'
import {finished} from 'node:stream/promises'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const hash=b=>createHash('sha256').update(b).digest('hex')
/** Trusted private-storage caller supplies exact verified bytes, not URLs/paths.
 * No network, approval writes or perceptual inference. Linux Node worker only. */
export async function evaluateTechnicalMedia(input,{signal,ffmpeg,ffprobe,timeoutMs=45000}){
 if(!signal||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000||![ffmpeg,ffprobe].every(x=>typeof x==='string'&&x.startsWith('/')))throw Error('Invalid trusted runtime')
 signal.throwIfAborted()
 const capture=(b,sha,cap)=>{if(!(b instanceof Uint8Array)||b.length<16||b.length>cap||!/^[a-f0-9]{64}$/.test(sha))throw Error('Invalid bounded input');const copy=Buffer.from(b);if(hash(copy)!==sha)throw Error('Hash mismatch');return copy}
 const video=capture(input.video,input.videoSha256,35*1024*1024),audio=capture(input.audio,input.audioSha256,32*1024*1024)
 if(video.subarray(4,8).toString('ascii')!=='ftyp')throw Error('MP4 signature required')
 const audioFormat=audio.subarray(0,4).toString('ascii')==='RIFF'&&audio.subarray(8,12).toString('ascii')==='WAVE'?'wav':audio.subarray(0,3).toString('ascii')==='ID3'||audio[0]===255&&(audio[1]&224)===224?'mp3':null
 if(!audioFormat)throw Error('Supported original speech format required')
 const format=name=>name==='video.mp4'?'mov':audioFormat
 const inputArgs=name=>['-protocol_whitelist','file,pipe','-format_whitelist',format(name),'-f',format(name),...(name==='video.mp4'?['-enable_drefs','0','-use_absolute_path','0']:[]),'-i',name]
 const life=new AbortController(),s=AbortSignal.any([signal,life.signal]),timer=setTimeout(()=>life.abort(),timeoutMs)
 let root
 async function fingerprint(path){
  s.throwIfAborted();const stream=createReadStream(path,{highWaterMark:65536}),digest=createHash('sha256');let size=0
  const abort=()=>stream.destroy(Error('Cancelled'));s.addEventListener('abort',abort,{once:true});if(s.aborted)abort()
  try{for await(const chunk of stream){s.throwIfAborted();size+=chunk.length;if(size>128*1024*1024)throw Error('Binary size unconfirmed');digest.update(chunk)}if(!size)throw Error('Empty binary');return digest.digest('hex')}
  finally{s.removeEventListener('abort',abort);stream.destroy();await finished(stream).catch(()=>{})}
 }
 async function run(binary,args){
  s.throwIfAborted()
  return new Promise((resolve,reject)=>{
   const child=spawn(binary,args,{cwd:root,stdio:['ignore','pipe','pipe'],shell:false,env:{PATH:'/usr/bin:/bin',LANG:'C'}})
   let size=0,parts=[],problem=null
   const stop=()=>{problem??=Error('Cancelled');child.kill('SIGKILL')}
   s.addEventListener('abort',stop,{once:true});if(s.aborted)stop()
   const read=(b,save)=>{size+=b.length;if(size>262144){problem=Error('Diagnostics over limit');child.kill('SIGKILL')}else if(save)parts.push(b)}
   child.stdout.on('data',b=>read(b,true));child.stderr.on('data',b=>read(b,false))
   child.on('error',e=>{problem=e})
   // Never race away from subprocess: close joins original process and pipes.
   child.on('close',code=>{s.removeEventListener('abort',stop);if(problem||code!==0||s.aborted)reject(problem||Error('Probe/decode failed'));else resolve(Buffer.concat(parts).toString('utf8'))})
  })
 }
 try{
  root=await mkdtemp(join(tmpdir(),'cafe-media-qa-'));s.throwIfAborted()
  await writeFile(join(root,'video.mp4'),video,{mode:0o600,flag:'wx'});await writeFile(join(root,'audio.bin'),audio,{mode:0o600,flag:'wx'})
  const binaries={}
  for(const [name,path] of [['ffmpeg',ffmpeg],['ffprobe',ffprobe]]){const sha256=await fingerprint(path),version=(await run(path,['-version'])).split('\n')[0];if(!version.startsWith(name+' version ')||version.length>512)throw Error('Codec version unconfirmed');binaries[name]={sha256,version}}
  const probe=async name=>JSON.parse(await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',...inputArgs(name)]))
  const v=await probe('video.mp4'),a=await probe('audio.bin')
  const vs=v.streams?.filter(x=>x.codec_type==='video'),as=v.streams?.filter(x=>x.codec_type==='audio')
  const duration=Number(v.format?.duration),audioDuration=Number(a.format?.duration)
  if(v.streams?.length!==2||a.streams?.length!==1||a.streams[0].codec_type!=='audio'||vs?.length!==1||as?.length!==1||vs[0].codec_name!=='h264'||as[0].codec_name!=='aac'||!Number.isFinite(duration)||duration<8||duration>45||!Number.isFinite(audioDuration)||audioDuration<=0||audioDuration>45||![vs[0].width,vs[0].height].every(x=>Number.isInteger(x)&&x>0&&x<=3840))throw Error('Unsupported media or actual duration')
  const pcm=[]
  for(const name of ['video.mp4','audio.bin']){
   await run(ffmpeg,['-v','error','-xerror','-threads','1',...inputArgs(name),'-f','null','-'])
   pcm.push((await run(ffmpeg,['-v','error','-xerror','-threads','1',...inputArgs(name),'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','hash','-hash','sha256','-'])).trim())
  }
  s.throwIfAborted()
  for(const [name,path] of [['ffmpeg',ffmpeg],['ffprobe',ffprobe]])if(await fingerprint(path)!==binaries[name].sha256)throw Error('Codec binary changed')
  if(pcm.some(x=>!/^SHA256=[a-f0-9]{64}$/.test(x)))throw Error('Invalid PCM evidence')
  return {assessorKind:'bounded-native-codec',assessorVersion:1,binaries,videoSha256:hash(video),audioSha256:hash(audio),actualDurationSeconds:duration,audioDurationSeconds:audioDuration,decodedAudioIdentical:pcm[0]===pcm[1],pcmHashes:pcm,checks:{mp4_integrity:'pass',duration:'pass',canonical_speech:'needs_review',canonical_likeness:'needs_review',lip_sync:'needs_review',visual_text:'needs_review',rights:'needs_review',brand_safety:'needs_review',third_party_watermark:'needs_review'},qaApproved:false,publicationApproved:false}
 }finally{clearTimeout(timer);life.abort();if(root)await rm(root,{recursive:true,force:true})}
}
