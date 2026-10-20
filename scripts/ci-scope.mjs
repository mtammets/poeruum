import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Only reviewed, isolated views get a smaller suite. Everything else is full CI.
export const uiScopes = [
  {
    files: ['src/DirectoryStories.tsx', 'src/DirectoryStoryHero.tsx', 'src/DirectoryStoryArticle.tsx', 'src/DirectoryStoryPage.tsx', 'src/DirectoryStoryDialog.tsx', 'src/StoryArrow.tsx', 'src/StoryInterview.tsx', 'src/directoryStories.css', 'src/storyInterview.css', 'e2e/directory-stories.e2e.ts', 'e2e/story-interview.e2e.ts'],
    browser: ['e2e/directory-stories.e2e.ts', 'e2e/story-interview.e2e.ts'],
    server: ['test:story-server'],
  },
  {
    files: ['src/Kaubamaja.tsx', 'src/StoreDirectoryLayout.tsx', 'src/StoreDirectoryCardContent.tsx', 'src/DirectoryHero.tsx', 'src/storeDirectory.css', 'src/AdminKaubamaja.tsx'],
    browser: ['e2e/directory-hero.e2e.ts', 'e2e/directory-search.e2e.ts', 'e2e/directory-highlights.e2e.ts', 'e2e/directory-analytics.e2e.ts', 'e2e/directory-stories.e2e.ts', 'e2e/story-interview.e2e.ts', 'e2e/admin-directory.e2e.ts', 'e2e/horoscope.e2e.ts', 'e2e/smoke.e2e.ts'],
    server: ['test:directory-highlights-server', 'test:story-server', 'test:horoscope-server'],
  },
  {
    files: ['src/DailyHoroscope.tsx', 'src/dailyHoroscope.css'],
    browser: ['e2e/horoscope.e2e.ts', 'e2e/directory-stories.e2e.ts'],
    server: ['test:horoscope-server'],
  },
  {
    files: ['src/AdminCampaigns.tsx', 'src/adminCampaigns.css'],
    browser: ['e2e/admin-campaigns.e2e.ts', 'e2e/campaign-swipe.e2e.ts'],
    server: ['test:campaign-server'],
  },
]

const unique = (values) => [...new Set(values)].sort()
const fullPlan = (reason) => ({ mode: 'full', browser: [], server: [], shards: [1, 2, 3, 4], reason })

export function classifyChanges(changes) {
  if (!changes.length) return fullPlan('No changed files; run the full suite.')
  const scopes = new Set()
  for (const { status, path } of changes) {
    // Deleting/moving a file can affect consumers outside its original view.
    if (!['A', 'M'].includes(status)) return fullPlan('A file was removed, moved or changed type.')
    if (path === 'README.md' || /^docs\/.*\.md$/.test(path)) continue
    const scope = uiScopes.find((entry) => entry.files.includes(path))
    if (!scope) return fullPlan('Changes include shared logic or files outside the reviewed UI scopes.')
    scopes.add(scope)
  }
  const selected = [...scopes]
  return {
    mode: selected.length ? 'ui' : 'docs',
    browser: unique(selected.flatMap((scope) => scope.browser)),
    server: unique(selected.flatMap((scope) => scope.server)),
    shards: [1],
    reason: selected.length ? 'Isolated views: run their browser and server checks.' : 'Documentation only: run the baseline checks.',
  }
}

export function baseSha(eventName, event) {
  const sha = eventName === 'push' ? event.before : eventName === 'pull_request' ? event.pull_request?.base?.sha : null
  return typeof sha === 'string' && /^[a-f0-9]{40}$/i.test(sha) && !/^0+$/.test(sha) ? sha : null
}

export function parseDiff(output) {
  if (!output) return []
  const parts = output.split('\0')
  if (parts.pop() !== '') throw new Error('Incomplete Git diff')
  const changes = []
  for (let index = 0; index < parts.length;) {
    const status = parts[index++]
    const path = parts[index++]
    if (!status || !path) throw new Error('Invalid Git diff')
    if (/^[RC]/.test(status) && !parts[index++]) throw new Error('Incomplete rename')
    changes.push({ status, path })
  }
  return changes
}

export function planForEvent(eventName, event, cwd = process.cwd()) {
  const base = baseSha(eventName, event)
  if (!base) return fullPlan('Manual run or unavailable base commit: run the full suite.')
  try {
    const diff = execFileSync('git', ['diff', '--name-status', '-z', '--no-renames', base, 'HEAD', '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
    return classifyChanges(parseDiff(diff))
  } catch {
    return fullPlan('The complete Git diff is unavailable: run the full suite.')
  }
}

function selectedChecks(raw, allowed) {
  const values = JSON.parse(raw || '[]')
  if (!Array.isArray(values) || !values.length || values.some((value) => !allowed.has(value))) throw new Error('Missing or invalid scoped checks')
  return unique(values)
}

export function browserArgs(mode, rawTests, shard) {
  if (mode === 'full') {
    if (!/^[1-4]$/.test(String(shard))) throw new Error('Invalid shard')
    return ['run', 'test:smoke', '--', `--shard=${shard}/4`, '--workers=1']
  }
  if (mode !== 'ui') throw new Error('Browser checks require a full or UI plan')
  const tests = selectedChecks(rawTests, new Set(uiScopes.flatMap((scope) => scope.browser)))
  return ['run', 'test:smoke', '--', ...tests, '--workers=1']
}

export function validateGate(needs) {
  const mode = needs.scope?.outputs?.mode
  if (!['full', 'ui', 'docs'].includes(mode)) throw new Error('Missing CI scope')
  const expected = {
    scope: 'success',
    application: 'success',
    browser: mode === 'docs' ? 'skipped' : 'success',
    journeys: mode === 'full' ? 'success' : 'skipped',
    database: mode === 'full' ? 'success' : 'skipped',
  }
  for (const [job, result] of Object.entries(expected)) {
    if (needs[job]?.result !== result) throw new Error(`${job}: expected ${result}, received ${needs[job]?.result ?? 'missing'}`)
  }
  return mode
}

function runNpm(args) {
  const result = spawnSync('npm', args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function main(command) {
  if (command === 'plan') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    const plan = planForEvent(process.env.GITHUB_EVENT_NAME, event)
    const output = { mode: plan.mode, browser: JSON.stringify(plan.browser), server: JSON.stringify(plan.server), shards: JSON.stringify(plan.shards) }
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(''))
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## CI: ${plan.mode}\n\n${plan.reason}\n\nLint, unit tests, production build and dependency audit always run.\n\n${plan.browser.map((path) => `- ${path}`).join('\n')}\n`)
    console.log(`CI scope: ${plan.mode}. ${plan.reason}`)
  } else if (command === 'browser') {
    runNpm(browserArgs(process.env.CI_MODE, process.env.CI_BROWSER_TESTS, process.env.CI_SHARD))
  } else if (command === 'server') {
    const checks = selectedChecks(process.env.CI_SERVER_TESTS, new Set(uiScopes.flatMap((scope) => scope.server)))
    for (const check of checks) runNpm(['run', check])
  } else if (command === 'gate') {
    console.log(`All required ${validateGate(JSON.parse(process.env.CI_NEEDS))} checks passed.`)
  } else throw new Error('Usage: node scripts/ci-scope.mjs plan|browser|server|gate')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2])
