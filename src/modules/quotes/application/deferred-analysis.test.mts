import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleQueuedQuoteAnalysis } from './deferred-analysis.ts'
const requestId='a874d9f7-d118-4564-a4b6-a668ad3aa58a',jobId='f5f4f5e0-07ef-4a0e-bf27-032e8c7c8fe3'
const workspace=()=>({request:{id:requestId,mode:'live',companyId:'lk-group'},latest:{id:jobId,requestId,status:'queued',stale:false}})
function fixture() {
  const pending:Array<()=>Promise<void>>=[],ran:string[]=[],warnings:string[]=[]
  const deps={schedule:(callback:()=>Promise<void>)=>{pending.push(callback)},run:async(id:string)=>{ran.push(id)},warn:(message:string)=>{warnings.push(message)}}
  return {pending,ran,warnings,deps}
}
test('saved job schedules a callback without waiting for analysis and keeps the HTTP body intact',async()=>{
 const state=fixture(),response=Response.json(workspace())
 await scheduleQueuedQuoteAnalysis(response,state.deps)
 assert.equal(state.pending.length,1);assert.deepEqual(state.ran,[]);assert.deepEqual(await response.json(),workspace())
 await state.pending[0]();assert.deepEqual(state.ran,[jobId]);assert.deepEqual(state.warnings,[])
})
test('errors, non-live, stale, foreign and nonqueued jobs never schedule paid work',async()=>{
 const state=fixture()
 for(const status of ['running','succeeded','failed','uncertain'])await scheduleQueuedQuoteAnalysis(Response.json({...workspace(),latest:{...workspace().latest,status}}),state.deps)
 for(const body of [{...workspace(),request:{...workspace().request,mode:'demo'}},{...workspace(),request:{...workspace().request,companyId:'other'}},{...workspace(),latest:{...workspace().latest,stale:true}},{...workspace(),latest:{...workspace().latest,requestId:'another-request'}},{...workspace(),latest:{...workspace().latest,id:'PRIVATE INPUT'}},{...workspace(),latest:null},null])await scheduleQueuedQuoteAnalysis(Response.json(body),state.deps)
 await scheduleQueuedQuoteAnalysis(Response.json(workspace(),{status:403}),state.deps)
 assert.equal(state.pending.length,0);assert.equal(state.ran.length,0)
})
test('after callback errors are handled once with generic diagnostics and no automatic retry',async()=>{
 const state=fixture();let calls=0
 await scheduleQueuedQuoteAnalysis(Response.json(workspace()),{...state.deps,run:async()=>{calls++;throw new Error('PRIVATE API KEY, CUSTOMER DATA, PROVIDER RESPONSE')}})
 await state.pending[0]();assert.equal(calls,1);assert.equal(state.pending.length,1);assert.equal(state.warnings.length,1);assert.ok(!state.warnings[0].includes('PRIVATE'))
})
test('scheduling errors retain the saved response for existing recovery without leaking details',async()=>{
 const state=fixture(),response=Response.json(workspace())
 await scheduleQueuedQuoteAnalysis(response,{...state.deps,schedule:()=>{throw new Error('PRIVATE request context')}})
 assert.deepEqual(await response.json(),workspace());assert.equal(state.ran.length,0);assert.equal(state.warnings.length,1);assert.ok(!state.warnings[0].includes('PRIVATE'))
})
