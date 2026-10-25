// Disposable loopback PostgreSQL only. No company environment or connection URL.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { initializeCustomerFixtureAuth, seedCustomerFixtureStaff } from '../src/modules/customers/infrastructure/customer-test-fixtures.mts';
const flags = process.argv.slice(2), get = (name, fallback) => flags.includes(name) ? flags[flags.indexOf(name)+1] : fallback;
const port = get('--port','55438'), user = get('--user','lk_r2_test'), binary = get('--psql','/opt/homebrew/opt/postgresql@17/bin/psql');
if (!/^\d{4,5}$/.test(port) || Number(port)<1024 || !/^lk_r2_test$/.test(user)) throw new Error('This runner requires the isolated lk_r2_test loopback server.');
const database = `lk_ems_r2_${process.pid}`, common = ['-X','-h','127.0.0.1','-p',port,'-U',user,'-v','ON_ERROR_STOP=1','-Atq'];
const quote = value => "'"+String(value).replaceAll("'","''")+"'";
function sql(statement, db = database) { const result = spawnSync(binary,[...common,'-d',db],{input:statement,encoding:'utf8'}); if(result.status!==0) throw new Error(result.stderr); return result.stdout.trim(); }
sql(`create database ${database};`,'postgres');
const migrations = readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
sql("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;");
const fixtureDb = { exec: async statement => sql(statement), query: async (statement, params=[]) => { sql(statement.replace(/\$(\d+)\b/g,(_match,index)=> { const value=params[Number(index)-1]; return value==null?'null':typeof value==='object'?quote(JSON.stringify(value)):quote(value); })); return {rows:[]}; } };
await initializeCustomerFixtureAuth(fixtureDb);
for (const name of migrations) sql(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
const actor = {companyId:'lk-group',actorUserId:randomUUID(),actorSessionId:randomUUID()};
await seedCustomerFixtureStaff(fixtureDb,actor);
const rpcSql = (command,args) => `select public.lk_customers_command(${quote(command)},${quote(JSON.stringify({...args,...actor}))}::jsonb);`;
const rpc = (command,args) => JSON.parse(sql('set role service_role;'+rpcSql(command,args)));
function simultaneous(command,args) { return new Promise(resolve=>{ const child=spawn(binary,[...common,'-d',database]);let out='',err='';child.stdout.on('data',part=>out+=part);child.stderr.on('data',part=>err+=part);child.on('close',code=>{ const lines=out.trim().split('\n');resolve({code,pid:Number(lines[0]),value:code===0?JSON.parse(lines[1]):null,error:err}); });child.stdin.end(`begin;set role service_role;select pg_backend_pid();${rpcSql(command,args)}select pg_sleep(0.2);commit;`); }); }
const key = () => randomUUID(), mutation = revision => ({expectedRevision:revision,reason:'Synthetic review only',idempotencyKey:key()});
const site = unit => ({label:'Synthetic property',address:{line1:'1 Synthetic Street',unit,suburb:'Synthetic Sydney',state:'NSW',postcode:'2000',country:'AU'},contactName:null,notes:null});
function source(name,email) { const id=randomUUID();sql(`insert into public.lk_quote_requests(id,company_id,reference,owner_hash,owner_expires_at,payload,status,revision,consent_version) values(${quote(id)},'lk-group',${quote('RQ-'+id.replaceAll('-','').toUpperCase())},repeat('a',64),now()+interval '1 day',${quote(JSON.stringify({contact:{name,email,siteAddress:'1 Synthetic Street'}}))}::jsonb,'draft',1,'quote-storage-review-v1');insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at) values('lk-group',${quote(id)},${quote(actor.actorUserId)},${quote(email)},now());`);return {type:'quote_request',id,expectedCrmRevision:0,expectedSourceRevision:1}; }
const outcomes=[];function pass(name,evidence) { outcomes.push({name,evidence});console.log('PASS '+name+': '+JSON.stringify(evidence)); }
const sourceOne=source('Concurrent source','source@example.invalid');
const before=JSON.parse(sql(`select to_jsonb(q)-array['customer_id','property_id','crm_revision'] from public.lk_quote_requests q where id=${quote(sourceOne.id)};`));
const accessBefore=sql('select jsonb_agg(to_jsonb(a) order by request_id) from public.lk_quote_request_access a;');
const linked=await Promise.all([1,2].map(()=>simultaneous('resolve',{name:'Concurrent source',email:'source@example.invalid',property:site('1'),source:sourceOne,idempotencyKey:key()})));
assert.notEqual(linked[0].pid,linked[1].pid);assert.equal(linked.filter(r=>r.code===0).length,2,JSON.stringify(linked));assert.equal(linked[0].value.customer.id,linked[1].value.customer.id);assert.equal(linked[0].value.property.id,linked[1].value.property.id);
assert.equal(Number(sql('select count(*) from public.lk_customers;')),1);assert.equal(Number(sql('select count(*) from public.lk_customer_properties;')),1);
assert.deepEqual(JSON.parse(sql(`select to_jsonb(q)-array['customer_id','property_id','crm_revision'] from public.lk_quote_requests q where id=${quote(sourceOne.id)};`)),before);assert.equal(sql('select jsonb_agg(to_jsonb(a) order by request_id) from public.lk_quote_request_access a;'),accessBefore);
pass('same verified quote, different sessions and keys reuse one client/property',{sessions:linked.map(r=>r.pid),customerCount:Number(sql('select count(*) from public.lk_customers;')),propertyCount:Number(sql('select count(*) from public.lk_customer_properties;')),sourceAndAccessPreserved:true});
const contactRace=await Promise.all(['Contact A','Contact B'].map(name=>simultaneous('resolve',{name,email:'shared@example.invalid',idempotencyKey:key()})));
assert.notEqual(contactRace[0].pid,contactRace[1].pid);assert.equal(contactRace.filter(r=>r.code===0&&r.value.outcome==='client_created').length,1);assert.equal(contactRace.filter(r=>r.code===0&&r.value.outcome==='needs_review').length,1);
const created=contactRace.find(r=>r.value?.outcome==='client_created').value.customer;
const reviewed=rpc('resolve',{name:'Other household member',email:'shared@example.invalid',decision:{kind:'different_person',reason:'Synthetic different household member reviewed',reviewedCandidates:[{id:created.id,revision:created.revision}]},idempotencyKey:key()});assert.notEqual(reviewed.customer.id,created.id);
pass('shared-contact race stops for review; audited different person can be saved',{sessions:contactRace.map(r=>r.pid),distinctAfterReview:true});
const client=linked[0].value.customer;
const edits=await Promise.all(['Changed A','Changed B'].map(name=>simultaneous('update',{id:client.id,name,email:'source@example.invalid',...mutation(client.revision)})));
assert.equal(edits.filter(r=>r.code===0).length,1,JSON.stringify(edits));assert.match(edits.find(r=>r.code!==0).error,/changed|revision/i);const current=rpc('detail',{id:client.id}).customer;
pass('competing edits cannot overwrite the same revision',{sessions:edits.map(r=>r.pid),saved:1,conflicts:1});
const properties=await Promise.all([1,2].map(()=>simultaneous('property_create',{id:client.id,...mutation(current.revision),...site('2')})));
assert.equal(properties.filter(r=>r.code===0).length,1,JSON.stringify(properties));assert.equal(Number(sql(`select count(*) from public.lk_customer_properties where customer_id=${quote(client.id)};`)),2);
const property=properties.find(r=>r.code===0).value.property;
pass('property concurrency keeps one address per unit and preserves another unit',{sessions:properties.map(r=>r.pid),propertyCount:2});
const archived=await Promise.all([1,2].map(()=>simultaneous('property_archive',{id:client.id,propertyId:property.id,...mutation(property.revision)})));
assert.equal(archived.filter(r=>r.code===0).length,1);const restored=await Promise.all([1,2].map(()=>simultaneous('property_restore',{id:client.id,propertyId:property.id,...mutation(property.revision+1)})));
assert.equal(restored.filter(r=>r.code===0).length,1);
pass('property archive and restore each accept only one concurrent revision',{archiveSessions:archived.map(r=>r.pid),restoreSessions:restored.map(r=>r.pid)});
const clientRevision=rpc('detail',{id:client.id}).customer.revision;
const customerArchive=await Promise.all([1,2].map(()=>simultaneous('archive',{id:client.id,...mutation(clientRevision)})));assert.equal(customerArchive.filter(r=>r.code===0).length,1);
const customerRestore=await Promise.all([1,2].map(()=>simultaneous('restore',{id:client.id,...mutation(clientRevision+1)})));assert.equal(customerRestore.filter(r=>r.code===0).length,1);assert.equal(rpc('detail',{id:client.id}).records[0].sourceId,sourceOne.id);
pass('customer archive and restore races preserve the connected quote',{archiveSessions:customerArchive.map(r=>r.pid),restoreSessions:customerRestore.map(r=>r.pid),relationPreserved:true});
const replayKey=key(), replayArgs={name:'Immutable original',email:'immutable@example.invalid',idempotencyKey:replayKey};const first=rpc('resolve',replayArgs);rpc('update',{id:first.customer.id,name:'Updated current',email:'updated-current@example.invalid',...mutation(first.customer.revision)});assert.deepEqual(rpc('resolve',replayArgs),first);
pass('response replay returns original fields and revision together',{immutableReceipt:true});
const beforeRollback=Number(sql('select count(*) from public.lk_customers;'));sql('revoke insert on public.lk_customer_activity from service_role;');let failure;try {rpc('resolve',{name:'Rollback only',email:'rollback@example.invalid',property:site('3'),idempotencyKey:key()});} catch(error) {failure=error;}finally{sql('grant insert on public.lk_customer_activity to service_role;');}assert.ok(failure);assert.equal(Number(sql('select count(*) from public.lk_customers;')),beforeRollback);
pass('audit failure rolls back client and property writes',{rolledBack:true});
for(const role of ['anon','authenticated']) {let failure;try{sql(`set role ${role};${rpcSql('list',{q:'',page:1,pageSize:10})}`);}catch(error){failure=error;}assert.ok(failure);}
pass('anonymous and authenticated roles cannot call CRM RPC',{roles:['anon','authenticated']});
sql(`delete from auth.sessions where id=${quote(actor.actorSessionId)};`);let revoked;try {rpc('list',{q:'',page:1,pageSize:10});}catch(error){revoked=error;}assert.ok(revoked);
pass('revoked upstream staff session closes CRM reads',{revokedSessionBlocked:true});
console.log(JSON.stringify({synthetic:true,host:'127.0.0.1',port:Number(port),database,postgres:sql('show server_version;'),migrations:migrations.length,passed:outcomes.length,outcomes},null,2));
