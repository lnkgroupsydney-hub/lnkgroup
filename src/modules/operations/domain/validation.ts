import type { EnquiryInput } from './contracts.ts'
import { isValidAustralianPhone, isValidAustralianPostcode, isValidEmail, isValidInteger, isValidText } from '../../../shared/validation/input.ts'

export class AppError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

function text(value: unknown, name: string, max: number, required = true, multiline = false): string {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return ''
    throw new AppError(400, `Invalid ${name}`)
  }
  const trimmed = value.trim()
  if (!isValidText(value, { maxLength: max, required, multiline, requireLetter: ['name', 'siteAddress', 'suburb'].includes(name) })) throw new AppError(400, `Invalid ${name}`)
  return trimmed
}

function count(value: unknown, name: string): number | null {
  if (value === null) return null
  if (!isValidInteger(value, 0, 500)) throw new AppError(400, `Invalid ${name}`)
  return value as number
}

export function validDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, 'Invalid preferredDate')
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, 'Invalid preferredDate')
  if (value < sydneyMinute(Date.now()).slice(0, 10)) throw new AppError(400, 'Preferred date is in the past')
  return value
}

export function validateEnquiry(value: unknown): EnquiryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'Invalid enquiry')
  const x = value as Record<string, unknown>
  if (x.serviceId !== 'cabinet-painting' || x.acknowledgement !== true) throw new AppError(400, 'Invalid service or acknowledgement')
  if (!Array.isArray(x.targetSurfaces) || x.targetSurfaces.length < 1 || x.targetSurfaces.length > 12) throw new AppError(400, 'Invalid targetSurfaces')
  const targetSurfaces = x.targetSurfaces.map((v) => text(v, 'targetSurfaces', 60))
  const email = text(x.email, 'email', 254).toLowerCase()
  if (!isValidEmail(email)) throw new AppError(400, 'Invalid email')
  const postcode = text(x.postcode, 'postcode', 4)
  if (!isValidAustralianPostcode(postcode)) throw new AppError(400, 'Invalid postcode')
  const phone = text(x.phone, 'phone', 40, false)
  if (!isValidAustralianPhone(phone)) throw new AppError(400, 'Enter a valid Australian phone number.')
  const preferredDate = validDate(x.preferredDate)
  return {
    serviceId: 'cabinet-painting', projectIntent: text(x.projectIntent, 'projectIntent', 160),
    targetSurfaces, suburb: text(x.suburb, 'suburb', 100), postcode,
    doorCount: count(x.doorCount, 'doorCount'), drawerCount: count(x.drawerCount, 'drawerCount'),
    material: text(x.material, 'material', 100, false), colourPreference: text(x.colourPreference, 'colourPreference', 100, false),
    notes: text(x.notes, 'notes', 3000, false, true), name: text(x.name, 'name', 120), email,
    phone, siteAddress: text(x.siteAddress, 'siteAddress', 240, false),
    preferredDate, acknowledgement: true, idempotencyKey: text(x.idempotencyKey, 'idempotencyKey', 100),
  }
}

const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function sydneyMinute(epoch: number): string {
  const p = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function sydneyLocalToInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new AppError(400, 'Invalid Sydney local time')
  const ms = Date.parse(`${value}:00Z`)
  if (Number.isNaN(ms)) throw new AppError(400, 'Invalid Sydney local time')
  const matches = [10, 11].map((hours) => ms - hours * 3600000).filter((v) => sydneyMinute(v) === value)
  if (matches.length !== 1) throw new AppError(400, 'Sydney local time is nonexistent or ambiguous')
  return new Date(matches[0]).toISOString()
}

export function validateSchedule(startLocal: unknown, endLocal: unknown): { startAt: string; endAt: string } {
  const startAt = sydneyLocalToInstant(startLocal)
  const endAt = sydneyLocalToInstant(endLocal)
  if (Date.parse(startAt) <= Date.now() || Date.parse(endAt) <= Date.parse(startAt)) throw new AppError(400, 'Schedule must be in the future with end after start')
  if (Date.parse(endAt) - Date.parse(startAt) > 90 * 86400000) throw new AppError(400, 'Schedule is too long')
  return { startAt, endAt }
}

export function validateProposedInstants(start: string | null, end: string | null): boolean {
  if (!start || !end) return false
  const a = Date.parse(start), b = Date.parse(end)
  return Number.isFinite(a) && Number.isFinite(b) && a > Date.now() && b > a && b - a <= 90 * 86400000
}
