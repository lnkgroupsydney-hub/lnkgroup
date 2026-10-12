import { existsSync } from 'node:fs'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.OPERATIONS_STORE !== 'supabase' || process.env.QUOTE_LIVE_ENABLED !== 'true') {
  process.stderr.write('Live booking delivery is not enabled.\n'); process.exit(1)
}
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--once')) {
  process.stderr.write('Usage: npm run booking:worker -- [--once]\n'); process.exit(1)
}
const { processLiveBookingDelivery } = await import('../src/modules/quotes/booking-delivery.ts')
const once = args.includes('--once')
let running = true, wake = null
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; wake?.() })
while (running) {
  try {
    const result = await processLiveBookingDelivery()
    if (result.claimed || result.storageErrors || result.configurationMissing) {
      process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...result }) + '\n')
    }
    if (once && (result.storageErrors || result.configurationMissing)) process.exitCode = 1
  } catch {
    process.stderr.write('Live booking delivery was interrupted. Private saved jobs are retained for lease recovery; ambiguous email attempts require review after the retry window.\n')
    if (once) process.exitCode = 1
  }
  if (once || !running) break
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 15_000)
    wake = () => { clearTimeout(timer); resolve() }
  })
  wake = null
}
