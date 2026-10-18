import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { baseSha, browserArgs, classifyChanges, parseDiff, planForEvent, uiScopes, validateGate } from './ci-scope.mjs'

const modified = (...paths) => paths.map((path) => ({ path, status: 'M' }))

test('story changes select both the interview and public article, including server rendering', () => {
  const plan = classifyChanges(modified('src/storyInterview.css', 'src/DirectoryStoryArticle.tsx', 'README.md'))
  assert.equal(plan.mode, 'ui')
  assert.deepEqual(plan.browser, ['e2e/directory-stories.e2e.ts', 'e2e/story-interview.e2e.ts'])
  assert.deepEqual(plan.server, ['test:story-server'])
  assert.deepEqual(plan.shards, [1])
})

test('multiple views combine all related checks without duplicates', () => {
  const plan = classifyChanges(modified('src/Kaubamaja.tsx', 'src/StoryInterview.tsx', 'src/DailyHoroscope.tsx'))
  for (const scope of uiScopes.slice(0, 3)) {
    for (const check of scope.browser) assert.ok(plan.browser.includes(check))
    for (const check of scope.server) assert.ok(plan.server.includes(check))
  }
  assert.equal(plan.browser.length, new Set(plan.browser).size)
})

test('every scoped source, browser suite and server script exists', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
  const files = uiScopes.flatMap((scope) => scope.files)
  assert.equal(files.length, new Set(files).size)
  for (const scope of uiScopes) {
    for (const path of [...scope.files, ...scope.browser]) assert.ok(existsSync(path), path)
    for (const script of scope.server) assert.ok(scripts[script], script)
  }
})

test('docs skip unrelated suites; every unreviewed or shared change forces full CI', () => {
  const docs = classifyChanges(modified('README.md', 'docs/ci.md'))
  assert.equal(docs.mode, 'docs')
  assert.deepEqual(docs.browser, [])
  for (const path of ['src/App.tsx', 'src/styles.css', 'src/brand.css', 'src/lib/storyInterview.ts', 'src/StorefrontCart.tsx', 'shared/directory-stories.mjs', 'server.mjs', 'package.json', 'package-lock.json', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'supabase/migrations/new.sql', 'supabase/functions/story-interview/index.ts', 'e2e/story-interview.e2e.ts', 'src/NewView.tsx', 'public/new.svg', 'AGENTS.md']) {
    const plan = classifyChanges(modified('src/storyInterview.css', path))
    assert.equal(plan.mode, 'full', path)
    assert.deepEqual(plan.shards, [1, 2, 3, 4])
  }
  assert.equal(classifyChanges([]).mode, 'full')
})

test('removed, renamed and type-changed files always run full CI', () => {
  for (const status of ['D', 'R100', 'C100', 'T', 'U', '?']) {
    assert.equal(classifyChanges([{ status, path: 'src/storyInterview.css' }]).mode, 'full')
  }
})

test('NUL-delimited diffs preserve unusual filenames and reject truncated results', () => {
  assert.deepEqual(parseDiff('M\0src/storyInterview.css\0A\0odd\n"name.ts\0'), [
    { status: 'M', path: 'src/storyInterview.css' }, { status: 'A', path: 'odd\n"name.ts' },
  ])
  assert.equal(classifyChanges(parseDiff('R100\0src/storyInterview.css\0src/new.css\0')).mode, 'full')
  assert.throws(() => parseDiff('M\0incomplete'))
  assert.throws(() => parseDiff('M\0'))
})

test('manual runs, missing bases and unavailable Git history fall back to full CI', () => {
  const sha = 'a'.repeat(40)
  assert.equal(baseSha('push', { before: sha }), sha)
  assert.equal(baseSha('pull_request', { pull_request: { base: { sha } } }), sha)
  for (const [name, event] of [['workflow_dispatch', {}], ['push', {}], ['push', { before: '0'.repeat(40) }], ['push', { before: '--help' }], ['pull_request', {}]]) {
    assert.equal(planForEvent(name, event).mode, 'full')
  }
  assert.equal(planForEvent('push', { before: sha }, '/nonexistent-ci-repository').mode, 'full')
})

test('a multi-commit push or PR includes earlier shared changes, not only the last UI commit', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'poeruum-ci-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = () => { git('add', '.'); git('-c', 'user.name=CI test', '-c', 'user.email=ci@example.invalid', 'commit', '-m', 'fixture') }
  try {
    git('init')
    writeFileSync(join(cwd, 'README.md'), 'base')
    commit()
    const base = git('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'server.mjs'), '// shared logic')
    commit()
    const previous = git('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'README.md'), 'documentation')
    commit()
    assert.equal(planForEvent('push', { before: previous }, cwd).mode, 'docs')
    assert.equal(planForEvent('push', { before: base }, cwd).mode, 'full')
    assert.equal(planForEvent('pull_request', { pull_request: { base: { sha: base } } }, cwd).mode, 'full')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('browser runner runs all four full shards and refuses empty or unknown UI selections', () => {
  for (let shard = 1; shard <= 4; shard++) assert.ok(browserArgs('full', '[]', shard).includes(`--shard=${shard}/4`))
  assert.ok(browserArgs('ui', '["e2e/story-interview.e2e.ts"]', 1).includes('e2e/story-interview.e2e.ts'))
  for (const raw of ['[]', '["--pass-with-no-tests"]', '{}', 'invalid']) assert.throws(() => browserArgs('ui', raw, 1))
  assert.throws(() => browserArgs('full', '[]', 5))
  assert.throws(() => browserArgs('docs', '[]', 1))
})

test('deployment gate accepts only the exact successful or intentionally skipped jobs for each scope', () => {
  for (const mode of ['full', 'ui', 'docs']) {
    const needs = {
      scope: { result: 'success', outputs: { mode } },
      application: { result: 'success' },
      browser: { result: mode === 'docs' ? 'skipped' : 'success' },
      journeys: { result: mode === 'full' ? 'success' : 'skipped' },
      database: { result: mode === 'full' ? 'success' : 'skipped' },
    }
    assert.equal(validateGate(needs), mode)
    for (const job of Object.keys(needs)) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        if (needs[job].result === result) continue
        assert.throws(() => validateGate({ ...needs, [job]: { ...needs[job], result } }), `${mode}: ${job}: ${result}`)
      }
      assert.throws(() => validateGate({ ...needs, [job]: undefined }))
    }
  }
  assert.throws(() => validateGate({}))
  assert.throws(() => validateGate({ scope: { result: 'success', outputs: { mode: 'unknown' } } }))
})
