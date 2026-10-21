import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const phase=process.argv[2],runDir=process.argv[3]
if(!['new','operations','check'].includes(phase)||!runDir)throw Error('Usage: node scripts/verify-ems-r3a.mjs new|operations|check <run-dir>')
mkdirSync(runDir,{recursive:true})
const tests=['src/modules/enquiries/enquiry-management-db.test.mts','src/modules/quotes/staff-drafts-db.test.mts','src/modules/bookings/simple-management-db.test.mts','src/modules/bookings/simple-cancellation.test.mts','src/modules/enquiries/current-work-api.test.mts','src/modules/enquiries/current-work-domain.test.mts','src/modules/enquiries/presentation/enquiry-management-client.test.mts','src/modules/quotes/presentation/staff-quote-client.test.mts','src/modules/bookings/presentation/simple-booking-client.test.mts']
const commands=phase==='new'?tests.map(file=>['node',['--experimental-strip-types','--test',file]]):[['npm',['run',phase==='operations'?'test:operations':'check']]]
const resultsPath=resolve(runDir,'verification.json'),results=existsSync(resultsPath)?JSON.parse(readFileSync(resultsPath,'utf8')):[]
let failed=false
for(const [executable,args] of commands){const command=[executable,...args].join(' ');console.log('Running '+command);const startedAt=new Date().toISOString(),r=spawnSync(executable,args,{cwd:process.cwd(),encoding:'utf8',maxBuffer:32*1024*1024}),output=(r.stdout??'')+(r.stderr??''),log=resolve(runDir,phase+'-'+(phase==='new'?args.at(-1).replaceAll('/','_'):Date.now())+'.log');writeFileSync(log,output);const count=name=>Number(output.match(new RegExp('(?:ℹ |# )'+name+' (\\d+)(?:\\n|\\r|$)'))?.[1]??0);const result={command,startedAt,exitCode:r.status,signal:r.signal,pass:count('pass'),fail:count('fail'),skip:count('skipped'),log,...(r.error?{error:r.error.message}:{})};if(existsSync(resultsPath))results.splice(0,results.length,...JSON.parse(readFileSync(resultsPath,'utf8')));results.push(result);writeFileSync(resultsPath,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(result));if(r.status!==0)failed=true}
writeFileSync(resolve(runDir,'verification.md'),'# EMS R3a 실행 검증\n\n'+results.map(r=>`- \`${r.command}\` — exit ${r.exitCode}, pass ${r.pass}, fail ${r.fail}, skip ${r.skip}; [log](${r.log})`).join('\n')+'\n\ncheck의 pass/fail/skip 숫자 0은 테스트 집계가 없는 lint/typecheck/build 명령이라는 뜻이다. UI 브라우저·운영 DB/Google/메일 인수는 수행하지 않았다.\n')
process.exitCode=failed?1:0
