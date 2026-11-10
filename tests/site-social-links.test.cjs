const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const filename = path.resolve('components/site/Footer.tsx')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
  reportDiagnostics: true,
})
const footerModule = new Module(filename, module)
footerModule.filename = filename
footerModule.paths = Module._nodeModulePaths(path.dirname(filename))
footerModule._compile(compiled.outputText, filename)
const html = renderToStaticMarkup(React.createElement(footerModule.exports.Footer))
const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, text]) => ({
  href: attributes.match(/\bhref="([^"]+)"/)?.[1].replace(/&amp;/g, '&'),
  label: text.replace(/<[^>]*>/g, ''),
  attributes,
}))

test('footer renders all confirmed public social destinations exactly once', () => {
  const expected = {
    Instagram: 'https://www.instagram.com/cafesativainc/',
    Threads: 'https://www.threads.com/@cafesativainc',
    Facebook: 'https://www.facebook.com/CafeSativaLLC',
    TikTok: 'https://www.tiktok.com/@cafesativa',
    Snapchat: 'https://www.snapchat.com/add/cafesativainc',
    LinkedIn: 'https://www.linkedin.com/company/cafesativa',
    'X (Twitter)': 'https://x.com/skool_tru',
  }
  assert.equal(links.filter(link => /^https:\/\//.test(link.href)).length, Object.keys(expected).length)
  for (const [label, href] of Object.entries(expected)) {
    const matches = links.filter(link => link.label === label)
    assert.equal(matches.length, 1, `${label} should appear exactly once`)
    assert.equal(matches[0].href, href)
    assert.match(matches[0].attributes, /\btarget="_blank"/)
    assert.match(matches[0].attributes, /\brel="noopener noreferrer"/)
  }
})

test('footer keeps contact, legal and venue links in the current tab', () => {
  for (const href of ['/contact', '/privacy', '/terms', '/stage', '/gallery', '/kitchen', '/cigar-lounge', '/events', '/ask']) {
    const link = links.find(link => link.href === href)
    assert.ok(link, `${href} should remain available`)
    assert.doesNotMatch(link.attributes, /\btarget=/)
  }
})

test('social links remain in the shared site footer and compile cleanly', () => {
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const layout = fs.readFileSync('app/layout.tsx', 'utf8')
  assert.match(layout, /import\s*\{\s*Footer\s*\}\s*from\s*['"]@\/components\/site\/Footer['"]/)
  assert.match(layout, /<Footer\s*\/>/)
})
