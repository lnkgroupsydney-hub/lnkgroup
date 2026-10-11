import { existsSync } from 'node:fs'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.OPERATIONS_STORE !== 'supabase' || process.env.QUOTE_LIVE_ENABLED !== 'true') {
  process.stderr.write('Live quote analysis is not enabled.\n'); process.exit(1)
}
const { runPendingQuoteAnalyses } = await import('../src/modules/quotes/media.ts')
const once = process.argv.includes('--once')
if (process.argv.slice(2).some(arg => arg !== '--once')) { process.stderr.write('Usage: npm run quote:worker -- [--once]\n'); process.exit(1) }
let running = true, wake = null
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{running=false;wake?.()})
while(running) {
  try { const result = await runPendingQuoteAnalyses(); if(result.examined || result.stagingCleaned) process.stdout.write(JSON.stringify({time:new Date().toISOString(),...result})+'\n') }
  catch { process.stderr.write('Quote analysis worker could not finish. Saved jobs are retained; interrupted paid calls require explicit customer retry.\n'); if(once) process.exitCode=1 }
  if(once || !running) break
  await new Promise(resolve=>{const timer=setTimeout(resolve,15000);wake=()=>{clearTimeout(timer);resolve()}})
  wake=null
}
