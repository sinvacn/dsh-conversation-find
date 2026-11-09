import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/** Load the real client bundle in a VM and return its plugin definition. */
function loadPlugin() {
  const source = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
  let definition
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { definition = value } } },
    queueMicrotask,
    console,
    setTimeout,
    clearTimeout,
  })
  if (definition === undefined) throw new Error('client.js did not register a module')
  return definition.factory()
}

const plugin = loadPlugin()
assert.ok(plugin.inject.includes('locale'))
assert.equal(typeof plugin.apply, 'function')
assert.equal(typeof plugin.__test.compileMatcher, 'function')

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('the find matcher honors case, whole-word, regex and escaping', () => {
  const compile = plugin.__test.compileMatcher
  const ranges = (matcher, text) => [...text.matchAll(matcher)].map(match => [match.index, match[0].length])

  assert.deepEqual(ranges(compile('alpha', { caseSensitive: false, wholeWord: false, regex: false }), 'Alpha alphabet'), [[0, 5], [6, 5]])
  assert.deepEqual(ranges(compile('alpha', { caseSensitive: true, wholeWord: false, regex: false }), 'Alpha alphabet'), [[6, 5]])
  assert.deepEqual(ranges(compile('alpha', { caseSensitive: false, wholeWord: true, regex: false }), 'Alpha alphabet'), [[0, 5]])
  assert.deepEqual(ranges(compile('a.b', { caseSensitive: false, wholeWord: false, regex: false }), 'a.b axb'), [[0, 3]])
  assert.deepEqual(ranges(compile('const \\w+', { caseSensitive: false, wholeWord: false, regex: true }), 'const alpha\nconst beta'), [[0, 11], [12, 10]])
  assert.throws(() => compile('[', { caseSensitive: false, wholeWord: false, regex: true }))
})

test('the find matcher treats escapes literally outside regex mode', () => {
  const compile = plugin.__test.compileMatcher
  const matcher = compile('a+b (c)', { caseSensitive: false, wholeWord: false, regex: false })
  assert.deepEqual([...'xx a+b (c) yy'.matchAll(matcher)].map(match => match[0]), ['a+b (c)'])
  assert.equal(plugin.__test.escapeRegExp('a+b (c)'), 'a\\+b \\(c\\)')
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} tests failed`)
  process.exitCode = 1
} else {
  console.log(`\n${tests.length}/${tests.length} tests passed`)
}
