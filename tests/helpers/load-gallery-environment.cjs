const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
module.exports = function loadGalleryEnvironment(env) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync('lib/gallery/environment.ts','utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText
  vm.runInNewContext(code,{exports,URL,process:{env}})
  return exports
}
