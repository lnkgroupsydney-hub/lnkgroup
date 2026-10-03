import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyBookingCalendar } from './calendar-availability.ts'

const bookingId = 'booking-1'
const calendarId = 'owner-calendar'
const segments = [
  { id:'day-one', startAt:'2099-01-04T22:00:00.000Z', endAt:'2099-01-05T06:00:00.000Z' },
  { id:'day-three', startAt:'2099-01-06T22:00:00.000Z', endAt:'2099-01-07T06:00:00.000Z' },
]
const owned = { account_sub:'approved', selected_calendar_id:calendarId }
const deps = (pages: unknown[], connection = async()=>owned) => {
  let calls=0
  return {
    connection,
    request: async() => Response.json(pages[calls++]),
    now:()=>new Date('2099-01-01T00:00:00.000Z'),
    calls:()=>calls,
  }
}
const event = (id:string,startAt:string,endAt:string,booking?:string) => ({id,status:'confirmed',transparency:'opaque',start:{dateTime:startAt},end:{dateTime:endAt},extendedProperties:{private:{bookingId:booking}}})

test('checks all work segments and catches busy on a later segment', async()=>{
  const source=deps([{accessRole:'owner',items:[event('other','2099-01-06T23:00:00Z','2099-01-07T01:00:00Z')]}])
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},source),(error:unknown)=>error instanceof Error && /no longer available/.test(error.message))
  assert.equal(source.calls(),1)
})

test('excludes only linked event ID with matching private booking identity', async()=>{
  const self=event('linked','2099-01-04T23:00:00Z','2099-01-05T01:00:00Z',bookingId)
  const valid=deps([{accessRole:'owner',items:[self]}])
  const result=await verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:['linked']},valid)
  assert.equal(result.calendarId,calendarId)
  const wrong=deps([{accessRole:'owner',items:[{...self,extendedProperties:{private:{bookingId:'another'}}}]}])
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:['linked']},wrong))
  const unknown=deps([{accessRole:'owner',items:[self]}])
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},unknown))
})

test('paginates through an empty first page before accepting free', async()=>{
  const source=deps([{accessRole:'owner',items:[],nextPageToken:'next'},{accessRole:'owner',items:[]}])
  await verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},source)
  assert.equal(source.calls(),2)
})

test('fails closed on incomplete page, stale calendar selection, and invalid event shape', async()=>{
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},deps([{items:[]}])) )
  let call=0
  const changed=async()=>++call===1?owned:{...owned,selected_calendar_id:'changed'}
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},deps([{accessRole:'owner',items:[]}],changed)))
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},deps([{accessRole:'owner',items:[{id:'bad',status:'confirmed',start:{date:'2099-01-05'}}]}])))
})

test('all-day exclusive end blocks actual work but not following day', async()=>{
  const allDay={id:'outside',status:'confirmed',transparency:'opaque',start:{date:'2099-01-06'},end:{date:'2099-01-07'}}
  const free=deps([{accessRole:'owner',items:[allDay]}])
  await verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},free)
  const work=deps([{accessRole:'owner',items:[{...allDay,start:{date:'2099-01-07'},end:{date:'2099-01-08'}}]}])
  await assert.rejects(verifyBookingCalendar({segments,bookingId,calendarId,excludedManagedEventIds:[]},work))
})
