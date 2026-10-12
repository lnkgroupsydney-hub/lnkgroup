import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { companyRpc, initializeCompanyFixtureAuth, seedCompanyFixture, companyTarget, companyProof, fixtureHash } from '../src/modules/bookings/infrastructure/live-test-fixtures.mts';

// Only an isolated temporary, loopback-only cluster is used. Company env files,
// external databases, Google, Resend and browser sessions are never accessed.
const execute=promisify(execFile), binaryDir=process.env.LK_TEST_POSTGRES_BIN??'/opt/homebrew/opt/postgresql@17/bin';
const literal=value=>value===null||value===undefined?'NULL':typeof value==='number'?String(value):`'${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")}'`;
const bind=(sql,params)=>sql.replace(/\$(\d+)\b/g,(_all,n)=>{if(Number(n)>params.length)throw new Error('Missing test SQL parameter.');return literal(params[Number(n)-1]);});
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

class PsqlSession {
  constructor(port,name){
    this.name=name;this.pending=null;this.serial=Promise.resolve();this.stdout='';this.stderr='';this.closed=false;
    this.process=spawn(join(binaryDir,'psql'),['-X','-q','-t','-A','-h','127.0.0.1','-p',String(port),'-U','lk_concurrency_fixture','-d','postgres'],{stdio:['pipe','pipe','pipe']});
    this.process.stdout.setEncoding('utf8');this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data',chunk=>{this.stdout+=chunk;this.finish();});
    this.process.stderr.on('data',chunk=>{this.stderr+=chunk;});
    this.process.on('error',error=>{this.pending?.reject(error);this.pending=null;});
    this.process.on('exit',()=>{this.closed=true;if(this.pending){this.pending.reject(new Error(`Test SQL session ${name} closed unexpectedly.`));this.pending=null;}});
    this.process.stdin.write('\\set VERBOSITY verbose\n\\set ON_ERROR_STOP off\n');
  }
  finish(){
    if(!this.pending)return;const markerIndex=this.stdout.indexOf(this.pending.marker);if(markerIndex<0)return;
    const current=this.pending,output=this.stdout.slice(0,markerIndex).trim();this.stdout=this.stdout.slice(markerIndex+current.marker.length).replace(/^\r?\n/,'');this.pending=null;
    // stdout/stderr are separate pipes. Allow the current stderr chunk to flush
    // before attributing an SQL error to this command, while commands stay serial.
    setImmediate(()=>{const errorOutput=this.stderr;this.stderr='';const failure=errorOutput.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):\s*([^\n]+)/);if(failure){const error=new Error(failure[2]);error.code=failure[1];current.reject(error);}else current.resolve(output);});
  }
  exec(sql){const run=this.serial.then(()=>new Promise((resolve,reject)=>{if(this.closed)return reject(new Error('Test SQL session is closed.'));const marker=`LK_END_${randomUUID().replaceAll('-','')}`;this.pending={marker,resolve,reject};this.process.stdin.write(`${sql.replace(/;?\s*$/,';')}\n\\echo ${marker}\n`);}));this.serial=run.catch(()=>{});return run;}
  async query(sql,params=[]){const bound=bind(sql,params).replace(/;\s*$/,'');if(!/^\s*(select|with)\b/i.test(bound)){await this.exec(bound);return {rows:[]};}const output=await this.exec(`select coalesce(json_agg(lk_row),'[]'::json)::text from (${bound}) lk_row`);return {rows:JSON.parse(output)};}
  async close(){if(this.closed)return;this.process.stdin.end('\\q\n');await Promise.race([once(this.process,'exit'),pause(2000)]);if(!this.closed)this.process.kill('SIGTERM');}
}

async function choosePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const allDay=(startDate,endDate)=>({kind:'all_day',startDate,endDate,startAt:new Date(`${startDate}T00:00:00+11:00`).toISOString(),endAt:new Date(`${endDate}T00:00:00+11:00`).toISOString()});
const timed=(startLocal,endLocal)=>({kind:'timed',startLocal,endLocal,startDate:startLocal.slice(0,10),endDate:new Date(Date.parse(`${endLocal}+11:00`)-1+11*3600000+86400000).toISOString().slice(0,10),startAt:new Date(`${startLocal}+11:00`).toISOString(),endAt:new Date(`${endLocal}+11:00`).toISOString()});
async function prepare(db,segments,email){
  const fixture=await seedCompanyFixture(db,{email});
  const drafted=await companyRpc(db,'staff_draft',{...fixture.staffArgs,expectedRevision:0,idempotencyKey:randomUUID(),proposal:{amountExGst:180001,scope:'Synthetic cabinet painting.',adjustmentReason:'Synthetic concurrency verification only.',segments},calendarTarget:companyTarget});
  const published=await companyRpc(db,'staff_publish',{...fixture.staffArgs,expectedRevision:drafted.revision,proposalId:drafted.proposal.id,proposalHash:drafted.proposal.hash,idempotencyKey:randomUUID(),calendarCheck:companyProof(drafted.proposal.hash)});
  const state=await companyRpc(db,'customer_accept',{...fixture.customerArgs,proposalId:published.proposal.id,proposalHash:published.proposal.hash,reviewExpiresAt:new Date(Date.now()+900000).toISOString(),signature:fixture.signature,idempotencyKey:randomUUID()});
  for(const kind of ['proposal_notice','acceptance_receipt']){
    const leaseToken=randomUUID(),claim=await companyRpc(db,'worker_claim',{requestId:fixture.requestId,leaseToken});assert.equal(claim.kind,kind);
    const pdf=Buffer.from('%PDF-synthetic-concurrency');await companyRpc(db,'freeze_mail',{id:claim.id,leaseToken,pdfBase64:pdf.toString('base64'),pdfHash:fixtureHash(pdf.toString()),payload:{to:[fixture.email],subject:'Synthetic test only'}});
    await companyRpc(db,'email_attempt',{id:claim.id,leaseToken});await companyRpc(db,'mail_result',{id:claim.id,leaseToken,providerMessageId:randomUUID()});
  }
  return {fixture,state,args:{...fixture.staffArgs,expectedRevision:state.revision,proposalId:state.proposal.id,proposalHash:state.proposal.hash,idempotencyKey:randomUUID(),calendarCheck:companyProof(state.proposal.hash)}};
}
async function expectWaiting(observer,pid){const deadline=Date.now()+5000;while(Date.now()<deadline){const rows=(await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows;if(rows[0]?.wait_event_type==='Lock')return;await pause(25);}throw new Error('The independent second session did not wait on the occupied work period.');}
async function count(observer,table,where='',params=[]){return (await observer.query(`select count(*)::integer n from public.${table} ${where}`,params)).rows[0].n;}
const result={database:'PostgreSQL 17 temporary isolated cluster',checks:{},cloudServicesCalled:false};
const directory=await mkdtemp(join(tmpdir(),'lk-confirm-concurrency-')),data=join(directory,'data'),socket=join(directory,'socket');let started=false;const sessions=[];
try {
  await mkdir(socket);const port=await choosePort();
  await execute(join(binaryDir,'initdb'),['-D',data,'-A','trust','-U','lk_concurrency_fixture','--encoding=UTF8','--no-locale'],{maxBuffer:2_000_000});
  await execute(join(binaryDir,'pg_ctl'),['-D',data,'-l',join(directory,'postgres.log'),'-o',`-F -h 127.0.0.1 -p ${port} -k ${socket}`,'-w','start'],{maxBuffer:1_000_000});started=true;
  const setup=new PsqlSession(port,'setup'),first=new PsqlSession(port,'first'),second=new PsqlSession(port,'second'),observer=new PsqlSession(port,'observer');sessions.push(setup,first,second,observer);
  await setup.exec("set statement_timeout='20s';create role anon;create role authenticated;create role service_role bypassrls");await initializeCompanyFixtureAuth(setup);
  const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations)await setup.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  for(const session of [first,second])await session.exec("set statement_timeout='20s';set lock_timeout='15s';set role service_role");
  result.serverVersion=(await observer.query("select current_setting('server_version') version")).rows[0].version;
  const firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid,secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;assert.notEqual(firstPid,secondPid);result.checks.independentSessions=true;

  // Same all-day period in two real transactions. The second blocks on the
  // uncommitted exclusion entry, then fails after the first commits.
  const pairA=await prepare(setup,[allDay('2030-01-05','2030-01-07')],'race-a@example.invalid'),pairB=await prepare(setup,[allDay('2030-01-05','2030-01-07')],'race-b@example.invalid');
  await first.exec('begin');const winner=await companyRpc(first,'staff_confirm',pairA.args);await second.exec('begin');const loserPending=companyRpc(second,'staff_confirm',pairB.args).then(state=>({ok:true,state}),error=>({ok:false,error}));
  await expectWaiting(observer,secondPid);await first.exec('commit');const loser=await loserPending;assert.equal(loser.ok,false);assert.equal(loser.error.code,'LK409');await second.exec('rollback');
  assert.equal((await companyRpc(setup,'staff_state',pairA.fixture.staffArgs)).booking.id,winner.booking.id);assert.equal((await companyRpc(setup,'staff_state',pairB.fixture.staffArgs)).booking,null);assert.equal(await count(observer,'lk_live_booking_confirmed_segments'),1);result.checks.overlapExactlyOneWinner=true;result.checks.secondWaitsUntilCommit=true;
  const replay=await companyRpc(second,'staff_confirm',{...pairA.args,calendarCheck:{...pairA.args.calendarCheck,expiresAt:'2000-01-01T00:00:00Z'}});assert.equal(replay.booking.id,winner.booking.id);assert.equal(await count(observer,'lk_live_company_bookings'),1);assert.equal(await count(observer,'lk_live_company_events'),1);result.checks.identicalIdempotencyReplayDoesNotDuplicate=true;

  // Rollback of the first transaction releases only its uncommitted hold; the
  // waiting second transaction can then commit the exact period itself.
  const rollbackA=await prepare(setup,[allDay('2030-01-10','2030-01-12')],'rollback-a@example.invalid'),rollbackB=await prepare(setup,[allDay('2030-01-10','2030-01-12')],'rollback-b@example.invalid');
  await first.exec('begin');await companyRpc(first,'staff_confirm',rollbackA.args);await second.exec('begin');const afterRollback=companyRpc(second,'staff_confirm',rollbackB.args);await expectWaiting(observer,secondPid);await first.exec('rollback');const replacement=await afterRollback;await second.exec('commit');assert.equal(replacement.booking.status,'confirming');assert.equal((await companyRpc(setup,'staff_state',rollbackA.fixture.staffArgs)).booking,null);result.checks.rollbackAllowsSecondWinner=true;

  // [start,end) adjacent work periods may coexist, including a timed period
  // beginning at the exact Sydney midnight ending an all-day period.
  const adjacent=await prepare(setup,[allDay('2030-01-07','2030-01-08')],'adjacent@example.invalid');await companyRpc(first,'staff_confirm',adjacent.args);
  const adjacentTimed=await prepare(setup,[timed('2030-01-08T00:00','2030-01-08T04:00')],'adjacent-timed@example.invalid');await companyRpc(second,'staff_confirm',adjacentTimed.args);result.checks.adjacentExclusiveBoundariesAllowed=true;
  const overlappingTimed=await prepare(setup,[timed('2030-01-06T09:00','2030-01-06T12:00')],'overlap-timed@example.invalid');await assert.rejects(companyRpc(second,'staff_confirm',overlappingTimed.args),error=>error.code==='LK409');assert.equal((await companyRpc(setup,'staff_state',overlappingTimed.fixture.staffArgs)).booking,null);result.checks.allDayAndTimedOverlapRejected=true;

  // A free first segment must not leak a partial booking when its later segment
  // conflicts. Transaction rollback removes holds, events, outbox and receipt.
  const multi=await prepare(setup,[allDay('2030-01-03','2030-01-04'),timed('2030-01-06T09:00','2030-01-06T12:00')],'multi-atomic@example.invalid');const before=await count(observer,'lk_live_booking_confirmed_segments'),beforeEvents=await count(observer,'lk_live_company_events');
  await assert.rejects(companyRpc(first,'staff_confirm',multi.args),error=>error.code==='LK409');assert.equal(await count(observer,'lk_live_booking_confirmed_segments'),before);assert.equal(await count(observer,'lk_live_company_events'),beforeEvents);assert.equal((await companyRpc(setup,'staff_state',multi.fixture.staffArgs)).booking,null);assert.equal(await count(observer,'lk_live_company_outbox',"where request_id=$1 and kind='confirmation'",[multi.fixture.requestId]),0);assert.equal(await count(observer,'lk_live_company_command_receipts',"where request_id=$1 and command='staff_confirm'",[multi.fixture.requestId]),0);result.checks.multiPeriodAtomicRollback=true;
  result.passed=Object.keys(result.checks).length;console.log(JSON.stringify(result,null,2));
} finally {
  await Promise.allSettled(sessions.map(session=>session.close()));
  if(started)await execute(join(binaryDir,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{maxBuffer:1_000_000}).catch(()=>execute(join(binaryDir,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{maxBuffer:1_000_000}));
  await rm(directory,{recursive:true,force:true});
}
