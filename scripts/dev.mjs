import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  // SIGTERM lets Vite await its shutdown hooks, including preview cleanup.
  for (const child of children) child.kill('SIGTERM')
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

for (const [name, script, args] of [
  ['Rakendus', '../node_modules/vite/bin/vite.js', process.argv.slice(2)],
  ['Maksete eelvaade', './payment-preview.mjs', []],
]) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    cwd: root,
    stdio: 'inherit',
  })
  children.add(child)
  child.on('error', (error) => {
    console.error(`${name} ei käivitunud: ${error.message}`)
    process.exitCode = 1
    stop()
  })
  child.on('close', (code, signal) => {
    children.delete(child)
    // Vite may report a handled signal as exit code 128 + signal number.
    const expectedShutdown = stopping && (signal === 'SIGINT' || signal === 'SIGTERM' || code === 130 || code === 143)
    if (!expectedShutdown && (code || signal)) process.exitCode = 1
    stop()
  })
}
