import test from 'node:test'
import assert from 'node:assert/strict'
import {demoAvailability,sydneyToday} from './infrastructure/demo-availability.ts'

const [year,month]=sydneyToday().split('-').map(Number)
const nextMonth=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7)
const occupiedDay=`${nextMonth}-05`
const read=async()=>({calendarId:'owner-calendar',intervals:[]})

test('confirmed DB occupancy blocks the public preferred day even if Google lists no event',async()=>{
 const result=await demoAvailability(nextMonth,read,async()=>[{startAt:`${occupiedDay}T00:00:00Z`,endAt:`${occupiedDay}T01:00:00Z`}])
 assert.deepEqual(result.public.days.find(day=>day.date===occupiedDay),{date:occupiedDay,selectable:false,reason:'busy'})
 assert.equal(result.snapshot.intervals.some(value=>value.occupancy==='opaque'&&value.kind==='timed'),true)
})
test('an unavailable DB occupancy read never turns into a free day',async()=>{
 await assert.rejects(demoAvailability(nextMonth,read,async()=>{throw new Error('private storage failure')}))
})
