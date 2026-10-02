import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_PRICE, DEMO_TERMS, DEMO_VERSION } from '../domain/demo-submission.ts'
import { createDemoEmailPayload, DEMO_RECIPIENT } from './demo-documents.ts'
import { runDemoDelivery, type DemoDeliveryDependencies, type DemoEmailJob } from './demo-email.ts'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const FROM = 'L&K Demo <onboarding@resend.dev>'
const fixture = (): DemoEmailJob => ({
  id:'11111111-2222-4333-8444-555555555555', reference:'DEMO-TEST123', submitted_at:new Date(NOW).toISOString(), snapshot_hash:'a'.repeat(64),
  snapshot:{mode:'demo',version:DEMO_VERSION,draftId:'66666666-2222-4333-8444-555555555555',draftRevision:2,preferredDate:'2026-10-09',price:DEMO_PRICE,terms:DEMO_TERMS,payload:{
    contact:{name:'<script>private()</script>',email:'client@example.com',phone:'',siteAddress:'12 Test Road',suburb:'Ermington',postcode:'2115',details:'<img src=x onerror=alert(1)>',consent:true},
    service:{serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:0,drawerCount:1,material:'Wood',colourPreference:'White'},
  }},
  signature:{name:'Test <Signer>',acknowledged:true,strokes:[[{x:.1,y:.1},{x:.2,y:.3},{x:.3,y:.4},{x:.4,y:.2}]]},
  lease_generation:1,lease_until:new Date(NOW+120_000).toISOString(),email_status:'pending',email_payload:null,email_first_attempt_at:null,email_attempts:0,email_provider_id:null,
})
function harness(job = fixture(), responses: (Response | Error)[] = [Response.json({id:'resend-accepted-id'})]) {
  const events: string[] = [], sends: {key:string;body:string}[] = [], failures: Record<string,unknown>[] = []
  let queued = true, index = 0, rejectAccepted = false
  const deps: DemoDeliveryDependencies = {
    config:{enabled:true,apiKey:'never-a-real-key',from:FROM,recipient:DEMO_RECIPIENT}, now:()=>NOW,
    command:async (command,args) => {
      events.push(command)
      if (command === 'claim') { if (!queued) return []; queued=false; return [structuredClone(job)] }
      if (command === 'email_attempt') {
        if (job.email_payload) assert.deepEqual(args.payload,job.email_payload)
        job.email_payload ??= structuredClone(args.payload) as typeof job.email_payload
        job.email_first_attempt_at ??= new Date(NOW).toISOString(); job.email_attempts++; job.email_status='sending'
        return structuredClone(job)
      }
      if (command === 'email_failed') { failures.push(args); job.email_status=String(args.outcome); return {} }
      if (command === 'email_accepted') {
        if (rejectAccepted) throw new Error('private DB response')
        job.email_status='provider_accepted'; job.email_provider_id=String(args.provider_id)
        return {emailStatus:'provider_accepted',calendarStatus:'pending'}
      }
      throw new Error('Unexpected command')
    },
    request:async (_url,init) => {
      events.push('provider_send')
      const headers = new Headers(init?.headers)
      sends.push({key:headers.get('Idempotency-Key')!,body:String(init?.body)})
      const response=responses[index++]; if(response instanceof Error)throw response
      return response
    },
  }
  return {job,deps,events,sends,failures,requeue:()=>{queued=true;job.lease_generation++;job.lease_until=new Date(NOW+120_000).toISOString()},rejectAccepted:()=>{rejectAccepted=true},acceptDatabase:()=>{rejectAccepted=false}}
}

test('demo documents are escaped, self-contained, signed and explicitly non-commercial HTML', () => {
  const source=fixture()
  // jsonb may return object keys in a different order without changing the signed values.
  source.snapshot.price={label:DEMO_PRICE.label,totalCents:DEMO_PRICE.totalCents,currency:DEMO_PRICE.currency}
  const payload=createDemoEmailPayload(source,FROM,DEMO_RECIPIENT)
  assert.deepEqual(payload.to,[DEMO_RECIPIENT])
  assert.equal(payload.attachments.length,2)
  for(const attachment of payload.attachments) {
    assert.match(attachment.filename,/\.html$/)
    const html=Buffer.from(attachment.content,'base64').toString('utf8')
    assert.match(html,/DEMONSTRATION ONLY/)
    assert.match(html,/Pending confirmation/)
    assert.match(html,/&lt;script&gt;private\(\)&lt;\/script&gt;/)
    assert.doesNotMatch(html,/<script|<img|<iframe|<form|<link/i)
    assert.match(html,/<dt>Cabinet doors<\/dt><dd>0<\/dd>/)
  }
  assert.match(Buffer.from(payload.attachments[1].content,'base64').toString('utf8'),/<svg.*<polyline/)
  assert.match(payload.text,/pending confirmation/)
})

test('documents reject real prices, invalid signature coordinates and unintended recipients', () => {
  const price=fixture();price.snapshot.price={...DEMO_PRICE,totalCents:999} as typeof DEMO_PRICE
  assert.throws(()=>createDemoEmailPayload(price,FROM,DEMO_RECIPIENT))
  const signature=fixture(); signature.signature.strokes[0][0].x=Number.NaN
  assert.throws(()=>createDemoEmailPayload(signature,FROM,DEMO_RECIPIENT))
  assert.throws(()=>createDemoEmailPayload(fixture(),FROM,'another@example.com'))
  assert.throws(()=>createDemoEmailPayload(fixture(),'onboarding@resend.dev>\r\nBcc: other@example.com',DEMO_RECIPIENT))
})

test('frozen payload is stored before sending and Calendar queues only after provider acceptance', async () => {
  const h=harness()
  const result=await runDemoDelivery({id:h.job.id},h.deps)
  assert.deepEqual(h.events,['claim','email_attempt','provider_send','email_accepted'])
  assert.equal(result.accepted,1);assert.equal(result.calendarQueued,1)
  assert.equal(h.sends[0].key,`demo-quote:${h.job.id}`)
  assert.deepEqual(JSON.parse(h.sends[0].body),h.job.email_payload)
})

test('response loss retries the exact frozen request and idempotency key without premature Calendar work', async () => {
  const h=harness(fixture(),[new Error('private token-bearing timeout'),Response.json({id:'same-provider-id'})])
  const first=await runDemoDelivery({},h.deps)
  assert.equal(first.retrying,1);assert.equal(first.calendarQueued,0)
  assert.equal(h.failures[0].error_code,'email_outcome_unknown')
  assert.equal(h.events.includes('email_accepted'),false)
  h.requeue();h.deps.config.from='Different Demo Name <onboarding@resend.dev>'
  const second=await runDemoDelivery({},h.deps)
  assert.equal(second.accepted,1)
  assert.deepEqual(h.sends[0],h.sends[1])
})

test('DB failure after provider acceptance preserves the request for idempotent recovery', async () => {
  const h=harness(fixture(),[Response.json({id:'same-provider-id'}),Response.json({id:'same-provider-id'})])
  h.rejectAccepted()
  const first=await runDemoDelivery({},h.deps)
  assert.equal(first.storageErrors,1);assert.equal(first.calendarQueued,0)
  h.acceptDatabase();h.requeue()
  const second=await runDemoDelivery({},h.deps)
  assert.equal(second.calendarQueued,1)
  assert.deepEqual(h.sends[0],h.sends[1])
})

test('stored provider acceptance retries Calendar enqueue without sending another email', async () => {
  const job=fixture();job.email_status='provider_accepted';job.email_provider_id='existing-provider-id'
  const h=harness(job)
  const result=await runDemoDelivery({},h.deps)
  assert.deepEqual(h.events,['claim','email_accepted']);assert.equal(h.sends.length,0)
  assert.equal(result.accepted,0);assert.equal(result.calendarQueued,1)
})

test('past the conservative retry window ambiguous jobs require review without another provider request', async () => {
  const job=fixture();job.email_first_attempt_at=new Date(NOW-23*60*60*1000).toISOString()
  const h=harness(job)
  const result=await runDemoDelivery({},h.deps)
  assert.equal(result.reviewRequired,1);assert.equal(h.sends.length,0)
  assert.equal(h.failures[0].outcome,'outcome_unknown')
})

test('provider error classification is bounded, sanitized and keeps Calendar blocked', async () => {
  for(const [response,outcome,code] of [
    [Response.json({message:'private'}, {status:429}),'retrying','email_transient'],
    [Response.json({message:'private'}, {status:503}),'retrying','email_transient'],
    [Response.json({name:'concurrent_idempotent_requests',message:'private'}, {status:409}),'retrying','email_transient'],
    [Response.json({name:'invalid_idempotent_request',message:'private'}, {status:409}),'outcome_unknown','email_payload_conflict'],
    [Response.json({message:'private'}, {status:422}),'failed','email_rejected'],
    [Response.json({message:'private'}, {status:403}),'failed','email_configuration'],
    [Response.json({notId:'private'}),'retrying','email_outcome_unknown'],
  ] as const) {
    const h=harness(fixture(),[response]);const result=await runDemoDelivery({},h.deps)
    assert.equal(h.failures[0].outcome,outcome);assert.equal(h.failures[0].error_code,code)
    assert.equal(result.calendarQueued,0)
    assert.doesNotMatch(JSON.stringify(result)+JSON.stringify(h.failures),/private/)
  }
})

test('disabled or misconfigured delivery never claims a queue item or sends', async () => {
  const h=harness();h.deps.config.enabled=false
  assert.equal((await runDemoDelivery({},h.deps)).disabled,true)
  h.deps.config.enabled=true;h.deps.config.recipient='other@example.com'
  assert.equal((await runDemoDelivery({},h.deps)).configurationMissing,true)
  assert.equal(h.events.length,0)
})

test('failed payload freezing and expired leases cannot reach the provider', async () => {
  const h=harness();const original=h.deps.command
  h.deps.command=async(command,args)=>{if(command==='email_attempt')throw new Error('private');return original(command,args)}
  assert.equal((await runDemoDelivery({},h.deps)).storageErrors,1)
  assert.equal(h.sends.length,0)
  const expired=harness();expired.job.lease_until=new Date(NOW).toISOString()
  assert.equal((await runDemoDelivery({},expired.deps)).retrying,1)
  assert.equal(expired.sends.length,0)
})

test('worker delivers the email queue before Calendar sync and exposes delivery failures in its exit status', () => {
  const directory = mkdtempSync(join(tmpdir(),'lk-demo-worker-test-'))
  const workerUrl = new URL('../../../../scripts/integrations-worker.mjs',import.meta.url).href
  const router = `export async function syncAll(){process.stdout.write('TEST_CALENDAR\\n');return {gmail:{imported:0},calendar:{synced:0,failed:0}}}`
  try {
    for (const failed of [false,true]) {
      const email = `export async function runDemoDelivery(){process.stdout.write('TEST_EMAIL\\n');return {claimed:1,accepted:${failed?0:1},calendarQueued:${failed?0:1},retrying:${failed?1:0},failed:0,reviewRequired:0,storageErrors:0}}`
      const script = `
        import { registerHooks } from 'node:module';
        globalThis.fetch=()=>{throw new Error('No network in worker test')};
        registerHooks({resolve(specifier,context,next){
          if(specifier.endsWith('/operations/router.ts'))return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(router)}`)},shortCircuit:true};
          if(specifier.endsWith('/enquiries/infrastructure/demo-email.ts'))return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(email)}`)},shortCircuit:true};
          return next(specifier,context);
        }});
        process.argv.push('--once'); await import(${JSON.stringify(workerUrl)});
      `
      const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','--eval',script],{cwd:directory,encoding:'utf8',timeout:5000,env:{OPERATIONS_STORE:'sqlite',LOCAL_OPERATIONS_ENABLED:'true',QUOTE_DEMO_ENABLED:'true'}})
      assert.equal(run.status,failed?1:0,run.stderr)
      assert.ok(run.stdout.indexOf('TEST_EMAIL')>=0)
      assert.ok(run.stdout.indexOf('TEST_CALENDAR')>run.stdout.indexOf('TEST_EMAIL'))
      if(failed)assert.match(run.stderr,/Demo delivery:.*retrying 1/)
    }
  } finally {rmSync(directory,{recursive:true,force:true})}
})
