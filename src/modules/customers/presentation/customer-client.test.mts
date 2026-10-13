import test from 'node:test'
import assert from 'node:assert/strict'
import { customerRequest, CustomerRequestError, reviewCandidates } from './customer-client.ts'

test('candidate queries and PATCH mutations send private input in JSON with existing credentials', async () => {
  const previous = globalThis.fetch
  const calls: { url: string; options?: RequestInit }[] = []
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ candidates: [] }) }
  try {
    await customerRequest('/candidates', { name: 'Synthetic person', email: 'synthetic@example.test' })
    await customerRequest('/synthetic-customer', { expectedRevision: 2, reason: 'Synthetic edit', idempotencyKey: 'fixed-key' }, undefined, 'PATCH')
    assert.equal(calls[0].url, '/api/admin/customers/candidates')
    assert.equal(calls[0].options?.method, 'POST')
    assert.equal(calls[0].options?.credentials, 'same-origin')
    assert.equal(calls[0].options?.cache, 'no-store')
    assert.equal(JSON.parse(String(calls[0].options?.body)).email, 'synthetic@example.test')
    assert.equal(calls[1].options?.method, 'PATCH')
    assert.equal(JSON.parse(String(calls[1].options?.body)).idempotencyKey, 'fixed-key')
  } finally { globalThis.fetch = previous }
})

test('known candidate conflicts preserve server review data; authorization and invalid JSON remain errors', async () => {
  const previous = globalThis.fetch
  const candidates = [{ customer: { id: 'synthetic-client', revision: 3 }, matchedBy: ['email'] }]
  try {
    globalThis.fetch = async () => Response.json({ code: 'needs_review', error: 'Review matching clients', candidates }, { status: 409 })
    await assert.rejects(customerRequest('/resolve', { name: 'Synthetic' }), cause => {
      assert.ok(cause instanceof CustomerRequestError)
      assert.equal(cause.status, 409)
      assert.deepEqual(reviewCandidates(cause), candidates)
      return true
    })
    globalThis.fetch = async () => new Response('not-json', { status: 401 })
    await assert.rejects(customerRequest('/synthetic-client'), cause => cause instanceof CustomerRequestError && cause.status === 401 && cause.data === null)
    assert.equal(reviewCandidates(new CustomerRequestError('Conflict', 409, { code: 'conflict', candidates })), null)
    assert.equal(reviewCandidates(new Error('Network lost')), null)
  } finally { globalThis.fetch = previous }
})
