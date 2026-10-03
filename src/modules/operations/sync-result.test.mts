import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeSyncError, summarizeSyncResult, syncFailureMessage } from './domain/sync-result.ts'

const successful = {gmail:{imported:1}, calendar:{synced:1, failed:0}}

test('provider errors and individual Calendar failures produce sanitized failure summaries', () => {
  assert.match(syncFailureMessage({gmail:{error:'private upstream response'}, calendar:{synced:1, failed:2}})!, /Gmail sync failed.*Calendar sync failed for 2/)
  assert.doesNotMatch(syncFailureMessage({gmail:{error:'private upstream response'}, calendar:{synced:1, failed:2}})!, /private/)
  assert.match(syncFailureMessage({gmail:{imported:0}, calendar:{error:'Calendar permission missing'}})!, /Calendar sync failed/)
  assert.match(syncFailureMessage(null)!, /invalid result/)
  assert.match(syncFailureMessage({gmail:{}, calendar:{}})!, /invalid result/)
})

test('remaining pages, unselected integrations and held leases are never completed syncs', () => {
  const partial = {gmail:{imported:2, partial:true}, calendar:{synced:1, failed:0, conflicts:1, reviewed:2}}
  assert.equal(syncFailureMessage(partial), null)
  assert.equal(summarizeSyncResult(partial).state, 'partial')
  assert.equal(summarizeSyncResult(partial).exitCode, 2)
  const skipped = {gmail:{skipped:'No label selected'}, calendar:{skipped:'No calendar selected'}}
  assert.equal(syncFailureMessage(skipped), null)
  assert.equal(summarizeSyncResult(skipped).state, 'skipped')
  assert.equal(summarizeSyncResult(skipped).exitCode, 2)
  assert.equal(summarizeSyncResult({...successful, gmail:{code:'sync_busy'}}).state, 'busy')
  assert.equal(summarizeSyncError({status:409, message:'private lease ID'}).state, 'busy')
  assert.equal(summarizeSyncError({status:409, code:'google_connection_changed'}).state, 'failed')
})
test('booking retry and external busy review are not reported as a completed Calendar sync',()=>{
 const retry=summarizeSyncResult({...successful,calendar:{synced:0,failed:0,bookings:{synced:0,retrying:1,reviewed:0}}})
 assert.equal(retry.state,'failed')
 assert.match(retry.message,/booking sync has pending retries/)
 const review=summarizeSyncResult({...successful,calendar:{synced:0,failed:0,bookings:{synced:0,retrying:0,reviewed:0},busy:{reviewed:1}}})
 assert.equal(review.state,'partial')
 assert.match(review.message,/owner review/)
})

test('reconnect and configuration failures back off while transient failures retain normal polling', () => {
  for (const code of ['google_reconnect_required', 'google_configuration', 'google_permission_denied', 'google_not_connected']) {
    const outcome = summarizeSyncResult({...successful, gmail:{error:'private provider body', code}})
    assert.equal(outcome.state, 'failed')
    assert.equal(outcome.retryAfterMs, 300_000)
    assert.doesNotMatch(outcome.message, /private/)
  }
  const transient = summarizeSyncResult({...successful, gmail:{error:'temporary', code:'google_temporary'}})
  assert.equal(transient.retryAfterMs, 60_000)
  assert.doesNotMatch(transient.message, /[Rr]econnect/)
})

function worker(results: unknown[], once: boolean, stopWhileWaiting = false) {
  const directory = mkdtempSync(join(tmpdir(), 'lk-worker-result-test-'))
  // Intercept the router before import. No credentials, database, or Google client load.
  const stub = `let index=0; const results=${JSON.stringify(results)}; export async function syncAll(){const value=results[index++]; if(index===results.length&&!${once}&&!${stopWhileWaiting})process.emit('SIGTERM');if(value.__throw)throw Object.assign(new Error('private exception'),value.__throw);return value}`
  const script = `
    import { registerHooks } from 'node:module';
    globalThis.fetch=()=>{throw new Error('Network forbidden in worker test')};
    globalThis.setTimeout=(callback,delay)=>{process.stdout.write('TEST_DELAY '+delay+'\\n');queueMicrotask(${stopWhileWaiting ? "()=>process.emit('SIGTERM')" : 'callback'});return 0};
    registerHooks({resolve(specifier,context,next){
      if(specifier.endsWith('/operations/router.ts'))return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`)},shortCircuit:true};
      return next(specifier,context);
    }});
    ${once ? "process.argv.push('--once');" : ''}
    await import(${JSON.stringify(new URL('../../../scripts/integrations-worker.mjs', import.meta.url).href)});
  `
  try {
    return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: {OPERATIONS_STORE:'sqlite', LOCAL_OPERATIONS_ENABLED:'true'},
    })
  } finally { rmSync(directory, {recursive:true, force:true}) }
}

test('one-shot worker returns failure without a completed log on a provider failure', () => {
  const result = worker([{gmail:{imported:1}, calendar:{synced:1, failed:1}}], true)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Integration poll failed.*Calendar sync failed/)
  assert.doesNotMatch(result.stdout, /completed/)
})

test('one-shot worker succeeds only when both selected integration results are successful', () => {
  const result = worker([successful], true)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Integration poll completed/)
  assert.doesNotMatch(result.stderr, /Integration poll failed/)
})

test('one-shot worker uses exit 2 for remaining pages, missing targets, and concurrent work', () => {
  for (const data of [
    {...successful, gmail:{imported:1, partial:true}},
    {...successful, gmail:{skipped:'No label selected'}},
    {__throw:{status:409}},
  ]) {
    const result = worker([data], true)
    assert.equal(result.status, 2, result.stderr)
    assert.doesNotMatch(result.stdout, /completed|private/)
    assert.match(result.stdout, /Integration poll (partial|skipped|busy)/)
  }
})

test('continuous worker retries failures with classified delays and exits normally after a stop signal', () => {
  const result = worker([
    {...successful, gmail:{error:'private response', code:'google_temporary'}},
    {...successful, gmail:{error:'private response', code:'google_reconnect_required'}},
    successful,
  ], false)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Integration poll failed.*Next poll in 60 seconds/)
  assert.match(result.stderr, /Integration poll failed.*Next poll in 300 seconds/)
  assert.doesNotMatch(result.stderr, /private/)
  assert.match(result.stdout, /TEST_DELAY 60000/)
  assert.match(result.stdout, /TEST_DELAY 300000/)
  assert.equal(result.stdout.match(/Integration poll completed/g)?.length, 1)
})

test('worker hides unexpected exception messages and retries them without claiming completion', () => {
  const result = worker([{__throw:{message:'private token and URL'}}], true)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Integration poll failed/)
  assert.doesNotMatch(result.stderr, /private|token|URL/)
  assert.doesNotMatch(result.stdout, /completed/)
})

test('SIGTERM during a polling delay wakes the worker and prevents another run', () => {
  const result = worker([successful], false, true)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.match(/Integration poll completed/g)?.length, 1)
  assert.equal(result.stdout.match(/TEST_DELAY/g)?.length, 1)
  assert.doesNotMatch(result.stderr, /Integration poll failed/)
})
