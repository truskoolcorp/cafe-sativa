const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

module.exports = env => {
  const load = (file, resolve) => {
    const scope = { exports: {}, process: { env }, require: resolve }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, scope)
    return scope.exports
  }
  const offers = load('lib/membership-offers.ts')
  return { offers, prices: load('lib/membership-prices.ts', name => {
    if (name === './membership-offers') return offers
    throw Error(name)
  }) }
}
