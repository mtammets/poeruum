// Both film layouts and the audio mix use the same recordings and start times.
export async function loadCampaignCalls() {
  const response = await fetch('/src/themes/black-friday/woodpeckerCalls.json')
  if (!response.ok) throw new Error('Cannot load the current woodpecker recordings')
  const recordings = await response.json()
  if (recordings.length !== 2) throw new Error('The film expects two woodpecker recordings')
  return recordings.map((call, index) => ({ ...call, start: [3.8, 10.7][index], gain: [1, .8][index] }))
}

export function callOpening(calls, time) {
  const call = calls.find(call => time >= call.start && time < call.start + call.duration)
  if (!call) return 0
  const frame = (time - call.start) / call.step
  const index = Math.floor(frame)
  const from = call.levels[index] ?? 0
  const to = call.levels[index + 1] ?? 0
  return (from + (to - from) * (frame - index)) / 100
}
