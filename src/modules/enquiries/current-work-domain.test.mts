import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {workMutation,workExact,workText,WorkError} from './management.ts'
import {validateStaffQuotePayload} from '../quotes/domain/staff-draft.ts'
import {simpleDraftInput} from '../bookings/domain/simple-management.ts'
import {sydneyLocalToInstant} from '../operations/access.ts'
const mutation={expectedRevision:0,idempotencyKey:randomUUID(),reason:' Staff work '}
test('revision, UUID and exact field checks reject non-integral, unsafe and undocumented mutation inputs',()=>{assert.equal(workMutation(mutation).reason,'Staff work');for(const expectedRevision of [-1,0.5,2147483647,Number.MAX_SAFE_INTEGER,NaN,'0'])assert.throws(()=>workMutation({...mutation,expectedRevision}),WorkError);assert.throws(()=>workExact({...mutation,actorUserId:randomUUID()},Object.keys(mutation)),WorkError);assert.throws(()=>workMutation({...mutation,reason:'\u0001'}),WorkError)})
test('plain text rejects lone UTF-16 surrogates and preserves valid emoji',()=>{
  for(const text of ['\ud800','\udfff','Before \ud800 after','Before \udfff after'])for(const required of [true,false])assert.throws(()=>workText(text,500,required),(error:unknown)=>error instanceof WorkError&&error.status===422&&error.outcome==='not_applied')
  assert.equal(workText('  Ready 🖌️ 😀  ',500),'Ready 🖌️ 😀')
  assert.equal(workMutation({...mutation,reason:'Ready 😀'}).reason,'Ready 😀')
})
test('staff quote adapter reuses current contact/service validation without persisting customer consent',()=>{const payload={contact:{name:'Synthetic Customer',email:'CUSTOMER@example.invalid',phone:'0400 000 000',siteAddress:'1 Synthetic Street',suburb:'Sydney',postcode:'2000',details:''},service:{serviceId:'cabinet-painting',intent:'advice',surfaces:['unknown'],doorCount:null,drawerCount:null,material:'',colourPreference:''},internalNotes:''};const value=validateStaffQuotePayload(payload);assert.equal(value.contact.email,'customer@example.invalid');assert.equal('consent'in value.contact,false);for(const patch of [{pricing:{total:1}},{contact:{...payload.contact,consent:true}},{service:{...payload.service,doorCount:501}},{service:{...payload.service,surfaces:['unknown','doors']}}])assert.throws(()=>validateStaffQuotePayload({...payload,...patch}),WorkError)})
test('nullable local dates allow incomplete draft but reject DST ambiguity, nonexistent dates and reversed periods',()=>{const raw={...mutation,takeOffEndLocal:null,installStartLocal:null,installEndLocal:null,companyNote:''};assert.equal(simpleDraftInput(raw,sydneyLocalToInstant).takeOffEndLocal,null);for(const installStartLocal of ['2030-04-07T02:30','2030-10-06T02:30','2030-02-30T09:00'])assert.throws(()=>simpleDraftInput({...raw,installStartLocal},sydneyLocalToInstant),WorkError);assert.throws(()=>simpleDraftInput({...raw,takeOffEndLocal:'2030-01-02T10:00',installStartLocal:'2030-01-02T09:00'},sydneyLocalToInstant),WorkError);assert.throws(()=>simpleDraftInput({...raw,takeOffStartLocal:'2030-01-01T09:00'},sydneyLocalToInstant),WorkError)})
