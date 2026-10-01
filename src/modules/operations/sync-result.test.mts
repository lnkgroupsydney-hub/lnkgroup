import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncFailureMessage } from './domain/sync-result.ts'

test('sync failure detection includes provider errors and individual Calendar push failures', () => {
  assert.match(syncFailureMessage({gmail:{error:'Gmail permission missing'}, calendar:{synced:1, failed:2}})!, /Gmail permission missing.*Calendar sync failed for 2/)
  assert.equal(syncFailureMessage({gmail:{imported:0}, calendar:{error:'Calendar permission missing'}}), 'Calendar permission missing')
  assert.match(syncFailureMessage({gmail:{imported:0}, calendar:{synced:2, failed:1}})!, /Calendar sync failed/)
  assert.match(syncFailureMessage(null)!, /invalid result/)
})

test('review requests, remaining Gmail pages, and unselected integrations are valid poll results', () => {
  assert.equal(syncFailureMessage({gmail:{imported:2, partial:true}, calendar:{synced:1, failed:0, conflicts:1, reviewed:2}}), null)
  assert.equal(syncFailureMessage({gmail:{skipped:'No label selected'}, calendar:{skipped:'No calendar selected'}}), null)
})

function worker(results: unknown[], once: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'lk-worker-result-test-'))
  // Intercept the router before import. This subprocess never loads credentials,
  // a database adapter, or a Google client, and sleeps are shortened only here.
  const stub = `let index=0; const results=${JSON.stringify(results)}; export async function syncAll(){const value=results[index++]; if(index===results.length&&!${once})process.emit('SIGTERM');return value}`
  const script = `
    import { registerHooks } from 'node:module';
    globalThis.fetch=()=>{throw new Error('Network forbidden in worker test')};
    globalThis.setTimeout=(callback)=>{queueMicrotask(callback);return 0};
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

test('one-shot worker returns failure without a completed log on a partial provider failure', () => {
  const result = worker([{gmail:{imported:1}, calendar:{synced:1, failed:1}}], true)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Integration poll failed.*Calendar sync failed/)
  assert.doesNotMatch(result.stdout, /completed/)
})

test('one-shot worker succeeds when both integration results are successful', () => {
  const result = worker([{gmail:{imported:1}, calendar:{synced:1, failed:0}}], true)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Integration poll completed/)
  assert.doesNotMatch(result.stderr, /Integration poll failed/)
})

test('continuous worker retries a partial failure and can stop successfully after recovery', () => {
  const result = worker([
    {gmail:{error:'Gmail permission missing'}, calendar:{synced:0, failed:0}},
    {gmail:{imported:1}, calendar:{synced:1, failed:0}},
  ], false)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Integration poll failed.*Retrying later/)
  assert.equal(result.stdout.match(/Integration poll completed/g)?.length, 1)
})
