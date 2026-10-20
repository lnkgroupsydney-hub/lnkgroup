import { randomUUID } from 'node:crypto'
import { requireStaffAdmin } from '../../admin-access/server.ts'
import { AdminAccessError } from '../../admin-access/index.ts'
import type { CustomerActor, CustomerDetail, CustomerPage, Customer, UnlinkedRecordPage } from '../domain/contracts.ts'
import { CustomerError, customerId, customerSearch, validateCreateCustomer, validateCustomerLookup, validateCustomerLink, validateMutation, validateProperty, validateDecision, validateResolve, validatePropertyDecision } from '../domain/validation.ts'
import { customerCommand, type CustomerStore } from '../application/customers.ts'
import { customerStore } from './store.ts'
export interface CustomerApiDependencies {
  authorize(req: Request, permission: 'operations.read' | 'operations.write'): Promise<CustomerActor>
  store: CustomerStore
  baseUrl(): string | undefined
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' } }) }
async function input(req: Request, baseUrl: string | undefined) {
  if (!baseUrl) throw new CustomerError(503, 'Administrator requests are unavailable.')
  if (req.headers.get('origin') !== new URL(baseUrl).origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new CustomerError(403, 'Same-origin request required.')
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new CustomerError(415, 'JSON required.')
  const max = 16384, length = req.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new CustomerError(413, 'Request too large.')
  const reader = req.body?.getReader()
  if (!reader) throw new CustomerError(400, 'Body required.')
  const chunks: Uint8Array[] = []; let total = 0
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    total += value.length
    if (total > max) { await reader.cancel(); throw new CustomerError(413, 'Request too large.') }
    chunks.push(value)
  }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new CustomerError(400, 'Invalid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CustomerError(400, 'JSON object required.')
  return value as Record<string, unknown>
}
export function createCustomerApi(deps: CustomerApiDependencies) {
  async function command<T>(actor: CustomerActor, action: string, value: Record<string,unknown>) {
    const result = await customerCommand<T>(deps.store, actor, action, value)
    if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'needs_property_review') {
      const error=new CustomerError(409,'Review matching properties before saving.');error.properties=(result as {properties?:unknown}).properties;throw error
    }
    if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'needs_review') {
      const error = new CustomerError(409,'Review matching clients before saving.'); error.candidates = (result as {candidates?:unknown}).candidates; throw error
    }
    return result
  }

  const safe = (handler: (req: Request, id?: string) => Promise<Response>) => async (req: Request, id?: string) => {
    try { return await handler(req, id) } catch (error) {
      if (error instanceof CustomerError || error instanceof AdminAccessError) return json({ error: error.message, ...(error instanceof CustomerError && error.properties ? {properties:error.properties} : {}), ...(error instanceof CustomerError && error.candidates ? {candidates:error.candidates} : {}), code: error instanceof CustomerError && error.properties ? 'needs_property_review' : error instanceof CustomerError && error.candidates ? 'needs_review' : ({ 400: 'validation', 401: 'unauthorized', 403: 'forbidden', 404: 'notfound', 409: 'conflict', 413: 'validation', 415: 'validation', 503: 'unavailable' } as Record<number, string>)[error.status] ?? 'unavailable' }, error.status)
      return json({ error: 'Customer service is temporarily unavailable.', code: 'unavailable' }, 503)
    }
  }
  return {
    list: safe(async req => { const actor = await deps.authorize(req, 'operations.read'); return json(await customerCommand<CustomerPage>(deps.store, actor, 'list', { ...customerSearch(new URL(req.url).searchParams) })) }),
    unlinked: safe(async req => { const actor = await deps.authorize(req, 'operations.read'); return json(await customerCommand<UnlinkedRecordPage>(deps.store, actor, 'unlinked', { ...customerSearch(new URL(req.url).searchParams) })) }),
    detail: safe(async (req, id) => { const actor = await deps.authorize(req, 'operations.read'); return json(await customerCommand<CustomerDetail>(deps.store, actor, 'detail', { id: customerId(id) })) }),
    create: safe(async req => {
      const actor = await deps.authorize(req, 'operations.write'), raw = await input(req, deps.baseUrl()), value = {...validateCreateCustomer(raw),decision:validateDecision(raw.decision)}
      return json({ customer: await command<Customer>(actor, 'create', { ...value, id: randomUUID() }) }, 201)
    }),
    candidates: safe(async req => {
      const actor = await deps.authorize(req,'operations.read'), raw = await input(req,deps.baseUrl()), value = validateCustomerLookup(raw)
      return json(await command(actor,'candidates',{name:value.name,email:value.email,phone:value.phone}))
    }),
    resolve: safe(async req => { const actor = await deps.authorize(req,'operations.write'), value = validateResolve(await input(req,deps.baseUrl()));return json(await command(actor,'resolve',{...value})) }),
    quoteRelation: safe(async(req,id) => { const actor=await deps.authorize(req,'operations.read');return json(await command(actor,'quote_relation',{id:customerId(id)})) }),
    update: safe(async(req,id) => { const actor=await deps.authorize(req,'operations.write'),raw=await input(req,deps.baseUrl()),value={...validateCreateCustomer(raw),...validateMutation(raw),decision:validateDecision(raw.decision)};return json({customer:await command(actor,'update',{...value,id:customerId(id)})}) }),
    archive: safe(async(req,id) => { const actor=await deps.authorize(req,'operations.write');return json({customer:await command(actor,'archive',{...validateMutation(await input(req,deps.baseUrl())),id:customerId(id)})}) }),
    restore: safe(async(req,id) => { const actor=await deps.authorize(req,'operations.write'),raw=await input(req,deps.baseUrl());return json({customer:await command(actor,'restore',{...validateMutation(raw),decision:validateDecision(raw.decision),id:customerId(id)})}) }),
    property: async(req:Request,id:string,propertyId:string|undefined,action:'property_create'|'property_update'|'property_archive'|'property_restore') => safe(async req => {
      const actor=await deps.authorize(req,'operations.write'),raw=await input(req,deps.baseUrl()),value={...validateMutation(raw),...(action==='property_create'||action==='property_update'?validateProperty(raw):{}),...(raw.propertyDecision!=null?{propertyDecision:validatePropertyDecision(raw.propertyDecision)}:{})}
      return json(await command(actor,action,{...value,id:customerId(id),...(propertyId?{propertyId:customerId(propertyId)}:{})}))
    })(req),
    link: safe(async (req, id) => {
      const actor = await deps.authorize(req, 'operations.write'), value = validateCustomerLink(await input(req, deps.baseUrl()))
      return json({ customer: await customerCommand<Customer>(deps.store, actor, value.action, { ...value, id: customerId(id) }) })
    }),
  }
}
const api = createCustomerApi({ authorize: requireStaffAdmin, store: customerStore, baseUrl: () => process.env.APP_BASE_URL })
export const customersGet = api.list, customersPost = api.create, customerGet = api.detail, unlinkedCustomerRecordsGet = api.unlinked, customerLinksPost = api.link

export const customerPatch=api.update, customerArchivePost=api.archive, customerRestorePost=api.restore, customerCandidatesPost=api.candidates, customerResolvePost=api.resolve, customerPropertyCommand=api.property, customerQuoteRelationGet=api.quoteRelation
