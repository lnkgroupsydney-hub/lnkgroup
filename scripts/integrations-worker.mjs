import { existsSync } from 'node:fs'
import { summarizeSyncError, summarizeSyncResult } from '../src/modules/operations/domain/sync-result.ts'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.OPERATIONS_STORE !== 'supabase' && process.env.LOCAL_OPERATIONS_ENABLED !== 'true') {
  process.stderr.write('Local operations are not enabled.\n')
  process.exit(1)
}
const { syncAll } = await import('../src/modules/operations/router.ts')
const once = process.argv.includes('--once')
let running = true
let finishSleep = null
const stop = () => { running = false; finishSleep?.() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
while (running) {
  let deliveryFailed = false
  if (process.env.QUOTE_DEMO_ENABLED === 'true') {
    try {
      const { runDemoDelivery } = await import('../src/modules/enquiries/infrastructure/demo-email.ts')
      const delivery = await runDemoDelivery({limit:1})
      deliveryFailed = delivery.failed > 0 || delivery.retrying > 0 || delivery.reviewRequired > 0 || delivery.storageErrors > 0
      const line = `[${new Date().toISOString()}] Demo delivery: claimed ${delivery.claimed}, accepted ${delivery.accepted}, Calendar queued ${delivery.calendarQueued}, retrying ${delivery.retrying}, failed ${delivery.failed}, review required ${delivery.reviewRequired}.\n`
      if (deliveryFailed) process.stderr.write(line)
      else process.stdout.write(line)
    } catch {
      deliveryFailed = true
      process.stderr.write('Demo delivery failed; pending work remains for retry or review.\n')
    }
  }
  if (!running) break
  let outcome
  try { outcome = summarizeSyncResult(await syncAll()) }
  catch (error) { outcome = summarizeSyncError(error) }
  const retry = once || !running ? '' : ` Next poll in ${outcome.retryAfterMs / 1000} seconds.`
  const line = `[${new Date().toISOString()}] Integration poll ${outcome.state}: ${outcome.message}${retry}\n`
  if (outcome.state === 'failed') process.stderr.write(line)
  else process.stdout.write(line)
  if (once) { process.exitCode = deliveryFailed ? 1 : outcome.exitCode; break }
  if (running) await new Promise((resolve) => {
    const timer = setTimeout(resolve, outcome.retryAfterMs)
    finishSleep = () => { clearTimeout(timer); resolve() }
  })
  finishSleep = null
}
