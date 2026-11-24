const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const scope = { exports: {} }
const source = fs.readFileSync('lib/events/public-stage-metadata.ts', 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
const { publicStageMetadata } = scope.exports

const input = {
  slug: 'ahnika-already-gone', title: 'Ahnika Merlot — Already Gone', description: 'An intimate prerecorded acoustic performance.',
  artwork: { fileName: 'ahnika-acoustic-set.webp', alt: 'Ahnika Merlot with her acoustic guitar', width: 1600, height: 900 },
}

test('the watch page is its own canonical share target and uses the public event still', () => {
  const metadata = publicStageMetadata(input)
  assert.equal(metadata.alternates.canonical, 'https://www.cafe-sativa.com/events/ahnika-already-gone')
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical)
  assert.equal(metadata.openGraph.images[0].url, 'https://www.cafe-sativa.com/events/ahnika-acoustic-set.webp')
  assert.equal(metadata.twitter.images[0].url, metadata.openGraph.images[0].url)
  assert.match(metadata.openGraph.description, /prerecorded/)
  assert.ok(fs.existsSync('public/events/ahnika-acoustic-set.webp'))
})

test('share metadata rejects non-canonical paths and anything other than a local still', () => {
  for (const slug of ['https://example.com', 'private/preview', '../rehearsal', 'other?alt=1']) {
    assert.throws(() => publicStageMetadata({ ...input, slug }), /Invalid public Stage slug/)
  }
  for (const fileName of ['../private/replay.webp', 'relay.mp4', 'https://example.com/art.png', 'art.png?token=1']) {
    assert.throws(() => publicStageMetadata({ ...input, artwork: { ...input.artwork, fileName } }), /Invalid public Stage artwork filename/)
  }
})
