const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict'),cp=require('node:child_process'),os=require('node:os');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const format={exports:{}};vm.runInNewContext(compile('lib/content/video-formats.ts'),format);
const scope={exports:{},Buffer,process,require:n=>n.endsWith('/video-formats')?format.exports:require(n)};
vm.runInNewContext(compile('lib/content/venue-frame.ts'),scope);
const ffmpeg=path.join(process.cwd(),'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'cs-frame-test-'));
(async()=>{try{
 for(const [w,h]of [[192,128],[160,90],[90,160]]){
  const input=path.join(folder,w+'x'+h+'.png');
  cp.execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s='+w+'x'+h,'-frames:v','1','-threads','1',input]);
  const output=await scope.exports.prepareVenueFrame(fs.readFileSync(input));
  assert.equal(output.readUInt32BE(16),1280);assert.equal(output.readUInt32BE(20),720);
  const png=path.join(folder,'prepared.png');fs.writeFileSync(png,output);
  const raw=cp.execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',png,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:4*1024*1024});
  const pixel=x=>[...raw.subarray((360*1280+x)*3,(360*1280+x)*3+3)];
  assert(pixel(640)[0]>240);
  if(w/h<16/9){assert(pixel(0).every(c=>c>=14&&c<=18));assert(pixel(1279).every(c=>c>=14&&c<=18));}
 }
 await assert.rejects(()=>scope.exports.prepareVenueFrame(Buffer.alloc(0)));
 console.log('PASS: actual FFmpeg prepares 3:2, 16:9 and portrait sources at 1280x720; padding verified, center preserved, empty source blocked');
}finally{fs.rmSync(folder,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
