import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCustomerApi } from './infrastructure/api.ts'
import { CustomerError, validateCreateCustomer, validateCustomerLink, customerSearch } from './domain/validation.ts'
import { customerCommand } from './application/customers.ts'
import { AdminAccessError } from '../admin-access/index.ts'
const actor = { companyId: 'lk-group', userId: randomUUID(), sessionId: randomUUID() }
const base = 'http://127.0.0.1:3002'
function fixture() {
 const calls: { command: string; args: Record<string, unknown> }[] = [], permissions: string[] = []
 let deny: AdminAccessError | null = null, fail: Error | null = null
 const api = createCustomerApi({ authorize: async (_req, permission) => { permissions.push(permission);if(deny)throw deny;return actor }, baseUrl:()=>base, store: { command: async <T>(command: string, args: Record<string, unknown>): Promise<T> => { calls.push({command,args});if(fail)throw fail;return { id: args.id, companyId:'lk-group', revision:1 } as T } } })
 return { api, calls, permissions, deny:(error:AdminAccessError)=>{deny=error}, fail:(error:Error)=>{fail=error} }
}
const post = (value: unknown, headers: Record<string,string> = {}) => new Request(`${base}/api/admin/customers`,{method:'POST',headers:{origin:base,'content-type':'application/json',...headers},body:JSON.stringify(value)})
const create = () => ({ name:'Synthetic',email:'client@example.invalid',idempotencyKey:randomUUID() })

test('read and writes require distinct current staff grants and private responses', async()=>{
 const f=fixture();await f.api.list(new Request(`${base}/api/admin/customers?q=Person&page=2&pageSize=5`));const r=await f.api.create(post(create()))
 assert.deepEqual(f.permissions,['operations.read','operations.write']);assert.equal(r.status,201)
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Cookie')
 assert.deepEqual({q:f.calls[0].args.q,page:f.calls[0].args.page,pageSize:f.calls[0].args.pageSize},{q:'Person',page:2,pageSize:5})
 assert.equal(f.calls[1].args.actorUserId,actor.userId);assert.equal(f.calls[1].args.actorSessionId,actor.sessionId)
})
test('unauthenticated, insufficient permission and verification denial never query customer store',async()=>{
 for(const code of ['AUTHENTICATION_REQUIRED','ACCESS_DENIED','EMAIL_VERIFICATION_REQUIRED','ACCESS_UNAVAILABLE'] as const) {
  const f=fixture();f.deny(new AdminAccessError(code));const r=await f.api.create(post(create()))
  assert.equal(r.status,code==='AUTHENTICATION_REQUIRED'?401:code==='ACCESS_UNAVAILABLE'?503:403);assert.equal(f.calls.length,0)
  assert.equal(JSON.stringify(await r.json()).includes(actor.userId),false)
 }
})
test('cross-origin, absent Origin, wrong media type and oversized streaming bodies fail before storage',async()=>{
 for(const req of [post(create(),{origin:'https://foreign.invalid'}),post(create(),{origin:''}),post(create(),{'sec-fetch-site':'cross-site'}),post(create(),{'content-type':'application/jsonp'}),post(create(),{'content-length':'4097'}),post({name:'x'.repeat(5000)})]) {
  const f=fixture(),r=await f.api.create(req);assert.ok([403,413,415].includes(r.status));assert.equal(f.calls.length,0)
 }
})
test('malformed JSON, arrays and invalid customer data fail safely',async()=>{
 const malformed=new Request(`${base}/api/admin/customers`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{broken'})
 const f=fixture();assert.equal((await f.api.create(malformed)).status,400)
 for(const value of [[],null,{...create(),name:''},{...create(),email:'invalid'},{...create(),name:'bad\u0000name'}]) assert.equal((await fixture().api.create(post(value))).status,400)
 assert.equal(f.calls.length,0)
})
test('body actor metadata cannot override verified server actor',async()=>{
 const f=fixture(),forged={...create(),actorUserId:randomUUID(),actorSessionId:randomUUID(),companyId:'other'}
 await f.api.create(post(forged));assert.equal(f.calls[0].args.actorUserId,actor.userId);assert.equal(f.calls[0].args.companyId,'lk-group')
 let captured:Record<string,unknown>={}
 await customerCommand({command:async<T>(_command:string,args:Record<string,unknown>)=>{captured=args;return null as T}},actor,'create',{actorUserId:'forged',companyId:'other'})
 assert.equal(captured.actorUserId,actor.userId);assert.equal(captured.companyId,actor.companyId)
})
test('link validation prevents draft sources, stale values and missing reasons while accepting intended command',async()=>{
 const sourceId=randomUUID(),id=randomUUID(),input={action:'link',sourceType:'submission',sourceId,reason:'Confirm source match',expectedRevision:1,idempotencyKey:randomUUID()}
 const f=fixture();assert.equal((await f.api.link(post(input),id)).status,200);assert.equal(f.calls[0].command,'link');assert.equal(f.calls[0].args.id,id)
 for(const changed of [{sourceType:'draft'},{reason:''},{expectedRevision:0},{expectedRevision:1.5},{sourceId:'invalid'},{action:'merge'}]) assert.throws(()=>validateCustomerLink({...input,...changed}),CustomerError)
})
test('invalid IDs and pagination do not call storage; unavailable provider details remain private',async()=>{
 const f=fixture();assert.equal((await f.api.detail(new Request(`${base}/api/admin/customers/no`),'no')).status,400)
 assert.equal((await f.api.list(new Request(`${base}/api/admin/customers?pageSize=999`))).status,400);assert.equal(f.calls.length,0)
 f.fail(new Error('secret-provider-token'));const r=await f.api.list(new Request(`${base}/api/admin/customers`));assert.equal(r.status,503);assert.equal(JSON.stringify(await r.json()).includes('secret-provider-token'),false)
})
test('validation preserves optional blank fields as missing and caps search without automatic identity merge',()=>{
 assert.deepEqual(validateCreateCustomer({name:' Synthetic ',email:'',phone:' ',address:null,idempotencyKey:' key '}),{name:'Synthetic',email:null,phone:null,address:null,idempotencyKey:'key'})
 assert.throws(()=>customerSearch(new URLSearchParams('page=0')),CustomerError)
 assert.throws(()=>customerSearch(new URLSearchParams(`q=${'x'.repeat(121)}`)),CustomerError)
})
