// Offline TypeScript loader: production modules run only against explicit stubs.
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
module.exports=function load(file,imports={},globals={}) {
 const exports={}
 const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true})
 const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
 if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=> '\n'}))
 vm.runInNewContext(result.outputText,{exports,Date,Intl,URL,console,require:name=>{
  if(Object.hasOwn(imports,name))return imports[name]
  if(name.startsWith('node:'))return require(name)
  throw Error('Unstubbed import: '+name)
 },...globals},{filename:file})
 return exports
}
