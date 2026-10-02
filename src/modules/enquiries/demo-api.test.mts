import test,{after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import type {DemoSnapshot,DemoSubmissionStatus} from './domain/demo-submission.ts'

Object.assign(process.env,{
  OPERATIONS_STORE:'supabase',LOCAL_OPERATIONS_ENABLED:'true',APP_BASE_URL:'http://127.0.0.1:3002',QUOTE_DEMO_ENABLED:'true',QUOTE_DEMO_RECIPIENT_EMAIL:'lnkgroupsydney@gmail.com',
  NEXT_PUBLIC_SUPABASE_URL:'https://demo-api-pglite.invalid',SUPABASE_SECRET_KEY:'synthetic-demo-key',
  GOOGLE_TOKEN_ENCRYPTION_KEY:'55'.repeat(32),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',
})
const db=new PGlite()
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8'))
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x=>x.tablename)
const originalFetch=globalThis.fetch
let events:unknown[]=[],googleFailed=false,googleCalls=0,scheduled:(()=>Promise<void>)[]=[]
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url)
  if(url.origin==='https://www.googleapis.com'){
    assert.equal(request.method,'GET','No calendar mutation is allowed in this suite')
    assert.match(url.pathname,/^\/calendar\/v3\/calendars\//)
    googleCalls++
    return googleFailed?Response.json({private:'SENSITIVE PROVIDER FAILURE'},{status:503}):Response.json({accessRole:'owner',items:events})
  }
  assert.equal(url.origin,'https://demo-api-pglite.invalid','Unexpected external request')
  assert.equal(request.headers.get('apikey'),'synthetic-demo-key')
  const name=url.pathname.split('/').at(-1)!
  assert.ok(['lk_quote_draft','lk_quote_submission','lk_operations_command','lk_google_health'].includes(name))
  const body=await request.json() as {command:string;args:Record<string,unknown>}
  try{return Response.json((await db.query<{r:unknown}>(`select public.${name}($1,$2::jsonb) r`,[body.command,JSON.stringify(body.args)])).rows[0].r)}
  catch(err){const error=err as {code:string;message:string};return Response.json({code:error.code,message:error.message},{status:400})}
}
const draft=await import('./infrastructure/quote-draft-api.ts')
const api=await import('./infrastructure/demo-api.ts')
const {encrypt}=await import('../operations/infrastructure/auth.ts')
const {readCalendarOccupancy}=await import('../operations/availability.ts')
const {demoAvailability,sydneyToday,monthRange}=await import('./infrastructure/demo-availability.ts')
const today=sydneyToday(),[year,month]=today.split('-').map(Number)
const chosenMonth=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7)
const chosenDate=`${chosenMonth}-15`
const signature={name:'김',acknowledged:true,strokes:[[{x:0.1,y:0.1},{x:0.2,y:0.3},{x:0.3,y:0.1},{x:0.5,y:0.4}]]}
const payload={contact:{name:'Synthetic Demo Client',email:'lnkgroupsydney@gmail.com',phone:'',siteAddress:'TEST ONLY',suburb:'Test',postcode:'2000',details:'Synthetic demonstration only',consent:true},service:{serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:4,drawerCount:null,material:'',colourPreference:''}}
beforeEach(async()=>{
  await db.exec('reset role')
  await db.exec(`truncate ${tables.map(x=>`public.${x}`).join(',')}`)
  await db.query("insert into public.lk_google_connection(id,account_sub,email,access_cipher,refresh_cipher,expires_at,selected_calendar_id) values(1,'test-company','lnkgroupsydney@gmail.com',$1,$2,$3,'test-calendar')",[encrypt('synthetic-access-token'),encrypt('synthetic-refresh-token'),Date.now()+3600000])
  await db.exec('set role service_role')
  events=[];googleFailed=false;googleCalls=0;scheduled=[]
  process.env.QUOTE_DEMO_ENABLED='true';process.env.APP_BASE_URL='http://127.0.0.1:3002';process.env.QUOTE_DEMO_RECIPIENT_EMAIL='lnkgroupsydney@gmail.com'
})
after(async()=>{globalThis.fetch=originalFetch;await db.close()})
function req(path:string,method='GET',cookie?:string,body?:unknown,origin='http://127.0.0.1:3002'){
  return new Request(`http://127.0.0.1:3002/api/quote/${path}`,{method,headers:{origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function session(){const response=await draft.draftSessionPost(req('draft/session','POST'));assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0]}
async function fixture(email=payload.contact.email){
  const cookie=await session()
  const saved=await draft.draftPut(req('draft','PUT',cookie,{expectedRevision:0,payload:{...payload,contact:{...payload.contact,email}}}))
  assert.equal(saved.status,200,await saved.clone().text())
  return cookie
}
async function review(cookie:string,revision=1){
  const calendar=await api.availabilityGet(req(`availability?month=${chosenMonth}`,'GET',cookie));assert.equal(calendar.status,200,await calendar.clone().text())
  const availability=await calendar.json() as {revision:string}
  const response=await api.reviewPost(req('review','POST',cookie,{expectedRevision:revision,preferredDate:chosenDate,availabilityRevision:availability.revision}))
  return response
}
async function reviewed(cookie:string){const response=await review(cookie);assert.equal(response.status,200,await response.clone().text());return await response.json() as {snapshot:DemoSnapshot;reviewToken:string}}
function submit(cookie:string,reviewToken:string,idempotencyKey=randomUUID(),override:Record<string,unknown>={}){
  return api.submitPost(req('submission','POST',cookie,{reviewToken,idempotencyKey,signature,...override}),task=>scheduled.push(task))
}
async function counts(){return (await db.query<{submissions:number;enquiries:number;outbox:number}>("select (select count(*)::int from public.lk_quote_submissions) submissions,(select count(*)::int from public.lk_enquiries) enquiries,(select count(*)::int from public.lk_outbox) outbox")).rows[0]}
const busy=()=>({status:'confirmed',summary:'PRIVATE CALENDAR TITLE',attendees:[{email:'private@example.invalid'}],start:{date:chosenDate},end:{date:`${chosenMonth}-16`}})

test('demo handlers require explicit loopback enablement, private session and same-origin writes',async()=>{
  assert.equal((await api.availabilityGet(req(`availability?month=${chosenMonth}`))).status,401)
  const cookie=await fixture()
  process.env.QUOTE_DEMO_ENABLED='false'
  assert.deepEqual(await (await api.demoGet(req('demo','GET',cookie))).json(),{enabled:false,recipientEmail:null,submission:null})
  assert.equal((await api.availabilityGet(req(`availability?month=${chosenMonth}`,'GET',cookie))).status,404)
})

test('foreign origins and non-company demo recipients cannot review or send',async()=>{
  const cookie=await fixture('another@example.invalid')
  assert.equal((await review(cookie)).status,400)
  assert.equal((await api.reviewPost(req('review','POST',cookie,{},'https://attacker.invalid'))).status,403)
  process.env.APP_BASE_URL='https://preview.example.invalid'
  assert.equal((await api.submissionGet(req('submission','GET',cookie))).status,404)
  assert.equal(scheduled.length,0)
})

test('busy days are disabled without leaking calendar details and cannot be reviewed',async()=>{
  const cookie=await fixture();events=[busy()]
  const response=await api.availabilityGet(req(`availability?month=${chosenMonth}`,'GET',cookie))
  assert.equal(response.status,200)
  const text=await response.text(),body=JSON.parse(text) as {days:{date:string;selectable:boolean}[]}
  assert.equal(body.days.find(x=>x.date===chosenDate)?.selectable,false)
  assert.equal(text.includes('PRIVATE CALENDAR TITLE'),false);assert.equal(text.includes('private@example.invalid'),false)
  assert.equal((await review(cookie)).status,409)
  assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
})

test('review tokens reject tampering and cross-session reuse',async()=>{
  const a=await fixture(),b=await fixture(),proof=await reviewed(a)
  assert.equal(proof.reviewToken.includes(payload.contact.name),false)
  const tail=proof.reviewToken.at(-1)==='0'?'1':'0'
  assert.equal((await submit(a,proof.reviewToken.slice(0,-1)+tail)).status,400)
  assert.equal((await submit(b,proof.reviewToken)).status,403)
  assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
  assert.equal(scheduled.length,0)
})

test('saved details changes invalidate approval and signature before submission',async()=>{
  const cookie=await fixture(),proof=await reviewed(cookie)
  const save=await draft.draftPut(req('draft','PUT',cookie,{expectedRevision:1,payload:{...payload,service:{...payload.service,doorCount:7}}}))
  assert.equal(save.status,200)
  assert.equal((await submit(cookie,proof.reviewToken)).status,409)
  assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
  assert.equal(scheduled.length,0)
})

test('new busy events and Calendar target changes after signing are rejected by a fresh submission check',async()=>{
  const cookie=await fixture(),proof=await reviewed(cookie)
  events=[busy()]
  assert.equal((await submit(cookie,proof.reviewToken)).status,409)
  events=[]
  await db.exec("update public.lk_google_connection set selected_calendar_id='other-calendar' where id=1")
  assert.equal((await submit(cookie,proof.reviewToken)).status,409)
  assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
  assert.equal(scheduled.length,0)
})

test('successful submission saves only the demo receipt; response-loss retry works without Google and queues no calendar before email',async()=>{
  const cookie=await fixture(),proof=await reviewed(cookie),key=randomUUID()
  const first=await submit(cookie,proof.reviewToken,key)
  assert.equal(first.status,202,await first.clone().text())
  const result=await first.json() as {submission:DemoSubmissionStatus}
  assert.equal(result.submission.emailStatus,'pending');assert.equal(result.submission.calendarStatus,'blocked')
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  assert.equal(scheduled.length,1)
  googleFailed=true;const before=googleCalls
  const replay=await submit(cookie,proof.reviewToken,key)
  assert.equal(replay.status,202);assert.deepEqual(await replay.json(),result);assert.equal(googleCalls,before)
  assert.equal((await submit(cookie,proof.reviewToken,randomUUID())).status,409)
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  assert.deepEqual(await (await api.submissionGet(req('submission','GET',cookie))).json(),result)
})

test('signature bounds reject empty, tiny, non-finite, oversized and unacknowledged drawings',()=>{
  assert.deepEqual(api.validateDemoSignature(signature),signature)
  for(const value of [null,{...signature,acknowledged:false},{...signature,name:'\u0000'}, {...signature,strokes:[]},
    {...signature,strokes:[[{x:0.1,y:0.1}]]}, {...signature,strokes:[Array.from({length:4},()=>({x:0.1,y:0.1}))]},
    {...signature,strokes:[[{x:NaN,y:0.1}]]},{...signature,strokes:[[{x:1.1,y:0.1}]]},
    {...signature,strokes:[Array.from({length:2001},()=>({x:0.1,y:0.1}))]},
  ])assert.throws(()=>api.validateDemoSignature(value))
})

test('Google availability failures return safe errors and create no submission',async()=>{
  const cookie=await fixture(),proof=await reviewed(cookie);googleFailed=true
  const response=await submit(cookie,proof.reviewToken)
  assert.equal(response.status,503);assert.equal((await response.text()).includes('SENSITIVE PROVIDER FAILURE'),false)
  assert.equal(scheduled.length,0);assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
})

test('occupancy reader follows every page, expands recurring events and only returns date/time occupancy',async()=>{
  const urls:string[]=[]
  const result=await readCalendarOccupancy(`${chosenMonth}-01`,`${chosenMonth}-28`,{
    connection:async()=>({account_sub:'company',selected_calendar_id:'company-calendar'}),
    request:async url=>{urls.push(url);return Response.json(urls.length===1?{accessRole:'owner',items:[busy()],nextPageToken:'page-two'}:{accessRole:'owner',items:[{status:'cancelled'},{status:'tentative',transparency:'transparent',summary:'PRIVATE',start:{dateTime:`${chosenDate}T09:00:00+11:00`},end:{dateTime:`${chosenDate}T10:00:00+11:00`}}]})},
  })
  assert.equal(urls.length,2);assert.equal(new URL(urls[0]).searchParams.get('singleEvents'),'true');assert.equal(new URL(urls[1]).searchParams.get('pageToken'),'page-two')
  assert.equal(result.intervals.length,2);assert.equal(result.intervals[0].occupancy,'opaque');assert.equal(result.intervals[1].occupancy,'transparent')
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false)
})

test('occupancy lookup fails closed on missing ownership, partial pages, repeated tokens and target changes',async()=>{
  const connection=async()=>({account_sub:'company',selected_calendar_id:'company-calendar'})
  for(const body of [{accessRole:'reader',items:[]},{accessRole:'owner',items:{}},{accessRole:'owner',items:[{status:'confirmed'}]},{accessRole:'owner',items:[],nextPageToken:''}]){
    await assert.rejects(readCalendarOccupancy(`${chosenMonth}-01`,`${chosenMonth}-28`,{connection,request:async()=>Response.json(body)}))
  }
  await assert.rejects(readCalendarOccupancy(`${chosenMonth}-01`,`${chosenMonth}-28`,{connection,request:async()=>Response.json({accessRole:'owner',items:[],nextPageToken:'repeated'})}))
  let checks=0
  await assert.rejects(readCalendarOccupancy(`${chosenMonth}-01`,`${chosenMonth}-28`,{connection:async()=>({account_sub:'company',selected_calendar_id:++checks===1?'old':'new'}),request:async()=>Response.json({accessRole:'owner',items:[]})}))
  await assert.rejects(readCalendarOccupancy(`${chosenMonth}-01`,`${chosenMonth}-28`,{connection,request:async()=>Response.json({}, {status:503})}))
})

test('malformed provider intervals fail closed and Sydney calendar boundaries stay explicit',async()=>{
  await assert.rejects(demoAvailability(chosenMonth,async()=>({calendarId:'test',intervals:[{occupancy:'opaque',kind:'all_day',startDate:'invalid-date',endDateExclusive:chosenDate}]})))
  assert.equal(sydneyToday(new Date('2026-10-03T14:30:00Z')),'2026-10-04')
  assert.equal(monthRange('2026-10',new Date('2026-10-02T00:00:00Z')).dates.length,31)
  assert.throws(()=>monthRange('2026-14',new Date('2026-10-02T00:00:00Z')))
  assert.throws(()=>monthRange('2027-02',new Date('2026-10-02T00:00:00Z')))
})
