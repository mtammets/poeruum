import { readFile } from 'node:fs/promises'

const reportPath = process.argv[2]

if (!reportPath) {
  throw new Error('Anna Lighthouse JSON-raporti asukoht esimese argumendina.')
}

const report = JSON.parse(await readFile(reportPath, 'utf8'))
const performance = Math.round((report.categories?.performance?.score ?? 0) * 100)
const accessibility = Math.round((report.categories?.accessibility?.score ?? 0) * 100)
const metrics = {
  FCP: report.audits?.['first-contentful-paint']?.displayValue,
  LCP: report.audits?.['largest-contentful-paint']?.displayValue,
  TBT: report.audits?.['total-blocking-time']?.displayValue,
  CLS: report.audits?.['cumulative-layout-shift']?.displayValue,
}

console.log(`Lighthouse: performance ${performance}, accessibility ${accessibility}`)
console.log(Object.entries(metrics).map(([name, value]) => `${name} ${value ?? '—'}`).join(', '))

if (performance < 80) {
  console.error(`Performance ${performance} jäi alla nõutud 80 punkti.`)
  process.exitCode = 1
}

if (accessibility < 100) {
  console.error(`Ligipääsetavus ${accessibility} jäi alla nõutud 100 punkti.`)
  process.exitCode = 1
}
