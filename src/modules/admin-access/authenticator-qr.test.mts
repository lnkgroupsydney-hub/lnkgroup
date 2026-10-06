import assert from 'node:assert/strict'
import test from 'node:test'
import { authenticatorQrImage } from './presentation/authenticator-qr.ts'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000000" d="M0 0h24v24H0z"/><title>인증 100%</title></svg>'
const expected = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

test('auth-js raw SVG data URI renders without losing hash colours or Unicode', () => {
  const source = authenticatorQrImage(`data:image/svg+xml;utf-8,${svg}`)
  assert.equal(source, expected)
  assert.equal(new URL(source!).hash, '')
  assert.equal(decodeURIComponent(source!.split(',')[1]), svg)
})

test('raw, percent-encoded and base64 SVG image formats remain supported', () => {
  assert.equal(authenticatorQrImage(svg), expected)
  assert.equal(authenticatorQrImage(expected), expected)
  assert.equal(authenticatorQrImage(`data:image/svg+xml,${encodeURIComponent(svg)}`), expected)
  const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  assert.equal(authenticatorQrImage(base64), base64)
})

test('non-image destinations and malformed payloads cannot be used as QR sources', () => {
  for (const source of ['https://example.invalid/qr.svg', 'javascript:alert(1)', 'data:text/html,<svg></svg>', 'data:image/svg+xml;utf-8,%ZZ', '<div>Not an image</div>', '']) {
    assert.equal(authenticatorQrImage(source), null)
  }
})
