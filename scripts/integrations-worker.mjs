import { existsSync } from 'node:fs'
import { syncFailureMessage } from '../src/modules/operations/domain/sync-result.ts'

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
  try {
    const result = await syncAll()
    const failure = syncFailureMessage(result)
    if (failure) {
      process.stderr.write(`Integration poll failed: ${failure}${once ? '' : ' Retrying later.'}\n`)
      if (once) process.exitCode = 1
    } else process.stdout.write(`Integration poll completed: ${JSON.stringify(result)}\n`)
  } catch {
    process.stderr.write(`Integration poll failed.${once ? '' : ' Retrying later.'}\n`)
    if (once) process.exitCode = 1
  }
  if (once) break
  if (running) await new Promise((resolve) => {
    const timer = setTimeout(resolve, 60000)
    finishSleep = () => { clearTimeout(timer); resolve() }
  })
  finishSleep = null
}
