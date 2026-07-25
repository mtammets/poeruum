import { readFile } from 'node:fs/promises'

const reportPaths = process.argv.slice(2)

if (!reportPaths.length) {
  throw new Error('Anna vähemalt ühe Lighthouse JSON-raporti asukoht.')
}

const results = await Promise.all(reportPaths.map(async (reportPath) => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  return {
    performance: Math.round((report.categories?.performance?.score ?? 0) * 100),
    accessibility: Math.round((report.categories?.accessibility?.score ?? 0) * 100),
    metrics: {
      FCP: report.audits?.['first-contentful-paint']?.displayValue,
      LCP: report.audits?.['largest-contentful-paint']?.displayValue,
      TBT: report.audits?.['total-blocking-time']?.displayValue,
      CLS: report.audits?.['cumulative-layout-shift']?.displayValue,
    },
  }
}))

results.forEach(({ performance, accessibility, metrics }, index) => {
  console.log(`Lighthouse ${index + 1}: performance ${performance}, accessibility ${accessibility}`)
  console.log(Object.entries(metrics).map(([name, value]) => `${name} ${value ?? '—'}`).join(', '))
})

const sortedPerformance = results.map(({ performance }) => performance).sort((left, right) => left - right)
const medianPerformance = sortedPerformance[Math.floor(sortedPerformance.length / 2)]
const minimumAccessibility = Math.min(...results.map(({ accessibility }) => accessibility))

console.log(`Lighthouse värav: performance mediaan ${medianPerformance}, accessibility miinimum ${minimumAccessibility}`)

if (medianPerformance < 80) {
  console.error(`Performance mediaan ${medianPerformance} jäi alla nõutud 80 punkti.`)
  process.exitCode = 1
}

if (minimumAccessibility < 100) {
  console.error(`Ligipääsetavus ${minimumAccessibility} jäi alla nõutud 100 punkti.`)
  process.exitCode = 1
}
