'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ValidatedInput, ValidatedTextarea, reportSectionValidity } from "@/shared/ui/validated-input";
import { quotePricingDisplay } from '../../quotes/index.ts';
import { COMPANY_BOOKING_SITE_DAMAGE_NOTE } from '../domain/live-contracts';
import { useUnsavedChanges, useWorkspaceDraft } from '@/shared/ui/admin-workspace-state';
import type { LiveCompanyBookingState, LiveCompanyCalendarCheck } from '../domain/live-contracts';
import { companyBookingRequest, companyDraftAfterRead, companyMoney, companyTime, companyProcessingRetryable, currentAcceptance, dollarsToCents, parseCompanyCheck, periodPayload, shiftDay, signedRequestConfirmationPayload, usesSignedRequestBooking, type SignedRequestScheduleInput, type CompanyPeriodInput } from './live-booking-client';
import { useCompanyBookingState } from './live-booking-state';
import { LiveConfirmationSummary, LiveProposalSummary } from './live-proposal-summary';
import { LiveCompanyBookingDocuments } from './live-booking-documents';
import './live-booking.css';

type Draft = { revision: number; amount: string; scope: string; reason: string; periods: CompanyPeriodInput[]; dirty: boolean };
const emptyPeriod = (): CompanyPeriodInput => ({key:crypto.randomUUID(),kind:'all_day',startDate:'',lastDate:'',startLocal:'',endLocal:''});
function draftFor(state:LiveCompanyBookingState):Draft {
  const p=state.proposal;
  return {revision:state.revision,amount:p?(p.amountExGst/100).toFixed(2):'',scope:p?.scope??'',reason:p?.adjustmentReason??'',periods:p?p.segments.map((segment,index)=>({key:`${p.id}:${index}`,kind:segment.kind,startDate:segment.startDate,lastDate:shiftDay(segment.endDate,-1),startLocal:segment.startLocal??'',endLocal:segment.endLocal??''})):[emptyPeriod()],dirty:false};
}
function CalendarCheck({check,now}:{check:LiveCompanyCalendarCheck;now:number}) {return <section aria-label="Complete work period conflict check"><h4>All-period conflict check</h4><p>Checked {companyTime(check.checkedAt)} (Sydney). {Date.parse(check.expiresAt)>now?'Check remains current.':'Check expired; check every period again.'}</p>{check.conflicts.length?<ol className="live-company-periods">{check.conflicts.map((conflict,index)=><li key={index}><strong>Period {conflict.segmentIndex+1} · {conflict.source==='google'?'Google Calendar':'Saved company reservation'}: </strong>{companyTime(conflict.startAt)} → {companyTime(conflict.endAt)} (Sydney)<p>{conflict.message}</p></li>)}</ol>:<p className="live-company-notice">No conflict was found in any proposed period. Publishing and confirmation recheck all periods on the server.</p>}</section>;}
type Manager = ReturnType<typeof useCompanyBookingState>;
function CompanyEditorForm({state,manager}:{state:LiveCompanyBookingState;manager:Manager}) {
  const [initialDraft]=useState(()=>draftFor(state));
  const [storedDraft,setDraft]=useWorkspaceDraft<Draft>(`live-booking.${state.requestId}.draft`,initialDraft), [check,setCheck]=useState<{proposalId:string;hash:string;value:LiveCompanyCalendarCheck}|null>(null), [checking,setChecking]=useState(false), [localError,setLocalError]=useState('');
  const draft=storedDraft.revision<state.revision?companyDraftAfterRead(storedDraft,draftFor(state),Boolean(manager.attempt)):storedDraft;
  const [confirmAcknowledged,setConfirmAcknowledged]=useState(false), [now,setNow]=useState(0);
  const mounted=useRef(false), checkController=useRef<AbortController|null>(null), checkGeneration=useRef(0), id=useId(), errorBox=useRef<HTMLDivElement>(null);
  const canWrite=state.canWrite!==false, locked=Boolean(state.booking), stale=draft.revision!==state.revision, busy=manager.busy||checking, readonly=locked||busy||Boolean(manager.attempt)||!canWrite;
  useUnsavedChanges(`live-booking.${state.requestId}.guard`,{dirty:draft.dirty||Boolean(manager.attempt),busy:busy||Boolean(manager.attempt),onDiscard:()=>setDraft(draftFor(state))});
  const invalidateChecks=useCallback(()=>{checkGeneration.current++;},[]);
  useEffect(()=>{mounted.current=true;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{mounted.current=false;invalidateChecks();checkController.current?.abort();clearInterval(timer);};},[invalidateChecks]);
  useEffect(()=>{if(localError)errorBox.current?.focus();},[localError]);
  const proposal=state.proposal, validCheck=check&&proposal&&check.proposalId===proposal.id&&check.hash===proposal.hash&&!draft.dirty&&Date.parse(check.value.expiresAt)>now&&!check.value.conflicts.length;
  const accepted=currentAcceptance(state), canConfirm=canWrite&&proposal?.status==='published'&&accepted&&state.acceptance?.emailStatus==='provider_accepted'&&validCheck&&!locked&&!manager.attempt;
  function edit(update:Partial<Draft>) {setDraft({...draft,...update,dirty:true});setCheck(null);setConfirmAcknowledged(false);setLocalError('');}
  function updatePeriod(key:string,update:Partial<CompanyPeriodInput>) {edit({periods:draft.periods.map(period=>period.key===key?{...period,...update}:period)});}
  const editorFields = useRef<HTMLDivElement>(null);
  async function save() {
    if (!reportSectionValidity(editorFields.current)) return;
    setLocalError('');
    try {
      if(stale)throw new Error('This request changed. Load its current version before saving. Your entered details can be kept.');
      if(!draft.scope.trim()||!draft.reason.trim())throw new Error('Enter the work scope and the reason for the company price or scope adjustment.');
      const payload={expectedRevision:draft.revision,idempotencyKey:crypto.randomUUID(),amountExGst:dollarsToCents(draft.amount),scope:draft.scope,adjustmentReason:draft.reason,segments:periodPayload(draft.periods)};
      const saved=await manager.command('proposal',payload,'PUT');
      if(saved) {setDraft(draftFor(saved));setCheck(null);}
    } catch(cause){setLocalError(cause instanceof Error?cause.message:'Review the entered price and periods.');}
  }
  async function checkPeriods() {
    if(!proposal||draft.dirty||manager.attempt||busy)return;
    const controller=new AbortController(), version=++checkGeneration.current;checkController.current?.abort();checkController.current=controller;setChecking(true);setLocalError('');
    try {const value=parseCompanyCheck(await companyBookingRequest(`/api/admin/live-bookings/${encodeURIComponent(state.requestId)}/check`,state.requestId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:proposal.id,proposalHash:proposal.hash}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35_000)])}));if(mounted.current&&version===checkGeneration.current){setCheck({proposalId:proposal.id,hash:proposal.hash,value});setNow(Date.now());}}
    catch(cause){if(mounted.current&&version===checkGeneration.current)manager.fail(cause);}
    finally{if(mounted.current&&version===checkGeneration.current)setChecking(false);}
  }
  function proposalCommand(action:'publish'|'confirm') {if(!proposal)return;setConfirmAcknowledged(false);return manager.command(action,{expectedRevision:state.revision,proposalId:proposal.id,proposalHash:proposal.hash,idempotencyKey:crypto.randomUUID()});}
  return <div ref={editorFields}>
    {proposal&&<LiveProposalSummary proposal={proposal} originalTotal={state.submission.snapshot.pricing.total!} originalPricingVersion={state.submission.snapshot.pricing.pricingVersion}/>}
    <LiveConfirmationSummary state={state} staff/>
    {locked?<p className="live-company-notice">This proposal is frozen for confirmation. Its exact periods stay occupied while Google verification or company review is pending. Rescheduling or cancellation requires a separate company process.</p>:<>
      <h4>{proposal?'Prepare a revised company draft':'Prepare the company price and work periods'}</h4><p>Enter the actual work periods manually. No working hours, weekends, duration or staff capacity are assumed. Saving a revised draft preserves earlier published proposals and requires a fresh customer confirmation when it is published.</p>
      {stale&&<div className="live-company-notice" role="status"><p>The saved request revision changed. Your entries are preserved. Load the latest saved draft or keep your entries against the current revision before saving.</p><div className="live-company-actions"><button type="button" className="secondary" disabled={busy||Boolean(manager.attempt)} onClick={()=>{setDraft(draftFor(state));setCheck(null);}}>Load saved company draft</button><button type="button" className="secondary" disabled={busy||Boolean(manager.attempt)} onClick={()=>setDraft(current=>({...current,revision:state.revision,dirty:true}))}>Keep entries and use current revision</button></div></div>}
      {draft.dirty&&<p className="live-company-notice" role="status">Unsaved company changes. Save the draft before checking or publishing these periods.</p>}
      <fieldset disabled={readonly}><legend>Company final price and scope</legend><label htmlFor={`${id}-amount`}>Final supply price (AUD, excluding GST)<ValidatedInput validation="text" validationLabel="Final supply price" required pattern="[0-9]+([.][0-9]{1,2})?" title="Enter a positive amount using at most two decimal places." id={`${id}-amount`} inputMode="decimal" type="text" maxLength={12} value={draft.amount} onChange={event=>edit({amount:event.target.value})}/></label><p>GST and the final total are calculated on the server when saved. Original photo estimate: {companyMoney(state.submission.snapshot.pricing.total!)} {quotePricingDisplay(state.submission.snapshot.pricing.pricingVersion).taxStatusInline}.</p><label htmlFor={`${id}-scope`}>Included and excluded work scope<ValidatedTextarea required validationLabel="Work scope" id={`${id}-scope`} rows={4} maxLength={5000} value={draft.scope} onChange={event=>edit({scope:event.target.value})}/></label><label htmlFor={`${id}-reason`}>Reason for the final price or scope adjustment<ValidatedTextarea required validationLabel="Adjustment reason" id={`${id}-reason`} rows={3} maxLength={3000} value={draft.reason} onChange={event=>edit({reason:event.target.value})}/></label></fieldset>
      {draft.periods.map((period,index)=><fieldset key={period.key} disabled={readonly}><legend>Actual work period {index+1}</legend><label htmlFor={`${id}-${period.key}-kind`}>Period type<select id={`${id}-${period.key}-kind`} value={period.kind} onChange={event=>updatePeriod(period.key,{kind:event.target.value as CompanyPeriodInput['kind']})}><option value="all_day">All-day dates</option><option value="timed">Exact start and end times</option></select></label>{period.kind==='all_day'?<div className="live-company-grid"><label htmlFor={`${id}-${period.key}-start`}>First work day (Sydney)<ValidatedInput required validationLabel="Work period start" id={`${id}-${period.key}-start`} type="date" value={period.startDate} onChange={event=>updatePeriod(period.key,{startDate:event.target.value})}/></label><label htmlFor={`${id}-${period.key}-end`}>Last work day, included (Sydney)<ValidatedInput required validationLabel="Work period end" id={`${id}-${period.key}-end`} type="date" min={period.startDate||undefined} value={period.lastDate} onChange={event=>updatePeriod(period.key,{lastDate:event.target.value})}/></label></div>:<div className="live-company-grid"><label htmlFor={`${id}-${period.key}-start`}>Start date and time (Sydney)<ValidatedInput required validationLabel="Work period start" id={`${id}-${period.key}-start`} type="datetime-local" value={period.startLocal} onChange={event=>updatePeriod(period.key,{startLocal:event.target.value})}/></label><label htmlFor={`${id}-${period.key}-end`}>End date and time (Sydney)<ValidatedInput required validationLabel="Work period end" id={`${id}-${period.key}-end`} type="datetime-local" value={period.endLocal} onChange={event=>updatePeriod(period.key,{endLocal:event.target.value})}/></label></div>}<button type="button" className="secondary" disabled={draft.periods.length===1} onClick={()=>edit({periods:draft.periods.filter(item=>item.key!==period.key)})}>Remove period {index+1}</button></fieldset>)}
      <div className="live-company-actions"><button type="button" className="secondary" disabled={readonly||draft.periods.length>=20} onClick={()=>edit({periods:[...draft.periods,emptyPeriod()]})}>Add work period</button><button type="button" disabled={readonly||stale||!draft.dirty} onClick={()=>void save()}>Save company draft</button></div>
    </>}
    {localError&&<div className="live-company-error" role="alert" ref={errorBox} tabIndex={-1}>{localError}</div>}
    {check&&proposal&&check.proposalId===proposal.id&&check.hash===proposal.hash&&<CalendarCheck check={check.value} now={now}/>}
    {!locked&&<><div className="live-company-actions"><button type="button" className="secondary" disabled={!canWrite||busy||draft.dirty||!proposal||Boolean(manager.attempt)} onClick={()=>void checkPeriods()}>{checking?'Checking every work period…':'Check all-period conflicts'}</button>{proposal?.status==='draft'&&<button type="button" disabled={!canWrite||busy||draft.dirty||!validCheck||Boolean(manager.attempt)} onClick={()=>void proposalCommand('publish')}>Publish this proposal for customer confirmation</button>}</div>{proposal?.status==='published'&&<><p className="live-company-notice">{accepted?'Customer confirmation matches this exact proposal.':'Waiting for the customer to review the complete price, scope and every work period.'} Confirmation also requires the saved acknowledgment email to be accepted by the email provider.</p><label className="live-company-ack"><input type="checkbox" checked={confirmAcknowledged} disabled={busy||!canConfirm} onChange={event=>setConfirmAcknowledged(event.target.checked)}/> I checked this exact final price, all work periods and the matching customer acknowledgment. Confirming will occupy these periods before Google verification finishes.</label><button type="button" disabled={busy||!canConfirm||!confirmAcknowledged||draft.dirty} onClick={()=>void proposalCommand('confirm')}>Confirm and save work periods to Google Calendar</button></>}</>}
    <div className="live-company-actions">{companyProcessingRetryable(state)&&<button type="button" className="secondary" disabled={!canWrite||busy||Boolean(manager.attempt)} onClick={()=>void manager.command('retry',{})}>Retry pending booking processing</button>}{state.booking&&<button type="button" className="secondary" disabled={!canWrite||busy||Boolean(manager.attempt)} onClick={()=>void manager.command('reconcile',{})}>Recheck confirmed Google work periods</button>}</div>
    {state.proposals.length>1&&<details><summary>Preserved company proposal history ({state.proposals.length} versions)</summary>{state.proposals.filter(item=>item.id!==proposal?.id).map(item=><LiveProposalSummary key={item.id} proposal={item} originalTotal={state.submission.snapshot.pricing.total!} originalPricingVersion={state.submission.snapshot.pricing.pricingVersion}/>)}</details>}
  </div>;
}
type SignedScheduleDraft = SignedRequestScheduleInput & { revision: number; dirty: boolean };
function signedDraftFor(state: LiveCompanyBookingState): SignedScheduleDraft {
  const segments = state.proposal?.confirmationBasis === 'signed_request' ? state.proposal.segments : [];
  return { revision: state.revision, takeOffEndLocal: segments[0]?.endLocal ?? '', installStartLocal: segments[1]?.startLocal ?? '', installEndLocal: segments[1]?.endLocal ?? '', companyNote: state.proposal?.companyNote ?? COMPANY_BOOKING_SITE_DAMAGE_NOTE, dirty: false };
}
function SignedRequestEditor({state,manager}:{state:LiveCompanyBookingState;manager:Manager}) {
  const [initialDraft] = useState(() => signedDraftFor(state));
  const [storedDraft,setDraft] = useWorkspaceDraft<SignedScheduleDraft>(`live-booking.${state.requestId}.signed-request-draft`, initialDraft);
  const draft = storedDraft.revision < state.revision ? companyDraftAfterRead(storedDraft, signedDraftFor(state), Boolean(manager.attempt)) : storedDraft;
  const [error,setError] = useState(''), id = useId(), errorBox = useRef<HTMLDivElement>(null);
  const busy = manager.busy || Boolean(manager.attempt), readonly = busy || Boolean(state.booking) || state.canWrite === false, stale = draft.revision !== state.revision;
  useUnsavedChanges(`live-booking.${state.requestId}.signed-request-guard`, { dirty: draft.dirty || Boolean(manager.attempt), busy, onDiscard: () => setDraft(signedDraftFor(state)) });
  useEffect(() => { if(error) errorBox.current?.focus(); }, [error]);
  function edit(update: Partial<SignedScheduleDraft>) { setDraft({ ...draft, ...update, dirty: true }); setError(''); }
  const editorFields = useRef<HTMLDivElement>(null);
  async function confirm() {
    if (readonly || !reportSectionValidity(editorFields.current)) return;
    try {
      if (stale) throw new Error('The saved booking changed. Refresh the current version before confirming. Your entries are preserved.');
      const payload = signedRequestConfirmationPayload(state, { takeOffEndLocal: draft.takeOffEndLocal, installStartLocal: draft.installStartLocal, installEndLocal: draft.installEndLocal, companyNote: draft.companyNote }, crypto.randomUUID());
      setError('');
      const saved = await manager.command('confirm-request', payload);
      if (saved) setDraft(signedDraftFor(saved));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the take-off and installation visits.'); }
  }
  const start = `${state.submission.preferredDate}T${state.submission.preferredTime}`;
  return <div ref={editorFields}>
    <dl className="live-company-details"><div><dt>Photo-based estimate</dt><dd>{companyMoney(state.submission.snapshot.pricing.total!)} {quotePricingDisplay(state.submission.snapshot.pricing.pricingVersion).taxStatusInline} · Saved with the customer’s signature</dd></div><div><dt>Take-off start · Customer selected</dt><dd>{state.submission.preferredDate} · {state.submission.preferredTime} (Sydney)</dd></div><div><dt>Customer acknowledgment</dt><dd>{state.submission.signature.name} · {companyTime(state.submission.submittedAt)} (Sydney)</dd></div></dl>
    <p className="live-company-notice">{COMPANY_BOOKING_SITE_DAMAGE_NOTE}</p>
    <LiveConfirmationSummary state={state} staff />
    {state.proposal && <LiveProposalSummary proposal={state.proposal} originalTotal={state.submission.snapshot.pricing.total!} originalPricingVersion={state.submission.snapshot.pricing.pricingVersion} />}
    {state.booking ? <p className="live-company-notice">These visits and the signed estimate are saved. Their exact periods stay occupied while calendar verification or company review is pending.</p> : <>
      <p>Review the customer’s saved photos and estimate, enter both visit durations and confirm once. All periods are checked for conflicts on confirmation. The customer does not need to sign again.</p>
      {stale && <div className="live-company-notice" role="status"><p>The booking revision changed. Your entered visits are preserved.</p><button type="button" className="secondary" disabled={busy} onClick={() => setDraft(current => ({ ...current, revision: state.revision, dirty: true }))}>Keep entries against current saved version</button><button type="button" className="secondary" disabled={busy} onClick={() => setDraft(signedDraftFor(state))}>Load saved visits</button></div>}
      <fieldset disabled={readonly}><legend>Take-off visit · Australia/Sydney</legend><label htmlFor={`${id}-takeoff-start`}>Customer selected start<ValidatedInput validationLabel="Customer selected start" id={`${id}-takeoff-start`} type="datetime-local" value={start} readOnly /></label><label htmlFor={`${id}-takeoff-end`}>Take-off end date and time *<ValidatedInput validationLabel="Take-off end" id={`${id}-takeoff-end`} type="datetime-local" required min={start} value={draft.takeOffEndLocal} onChange={event => edit({ takeOffEndLocal: event.target.value })} /></label></fieldset>
      <fieldset disabled={readonly}><legend>Installation visit · Australia/Sydney</legend><label htmlFor={`${id}-install-start`}>Installation start date and time *<ValidatedInput validationLabel="Installation start" id={`${id}-install-start`} type="datetime-local" required min={draft.takeOffEndLocal || start} value={draft.installStartLocal} onChange={event => edit({ installStartLocal: event.target.value })} /></label><label htmlFor={`${id}-install-end`}>Installation end date and time *<ValidatedInput validationLabel="Installation end" id={`${id}-install-end`} type="datetime-local" required min={draft.installStartLocal || undefined} value={draft.installEndLocal} onChange={event => edit({ installEndLocal: event.target.value })} /></label></fieldset>
      <label htmlFor={`${id}-note`}>Customer guidance and site inspection notice<ValidatedTextarea validationLabel="Customer guidance" id={`${id}-note`} rows={3} maxLength={3000} value={draft.companyNote} disabled={readonly} onChange={event => edit({ companyNote: event.target.value })} /></label>
      <p>Booking confirmation sends the customer’s confirmation email and automatically saves the take-off and installation visits to the company Google Calendar. The signed photo-based price and customer-selected start remain unchanged.</p>
      <button type="button" disabled={readonly || stale || !draft.takeOffEndLocal || !draft.installStartLocal || !draft.installEndLocal} onClick={() => void confirm()}>{manager.busy ? 'Checking and confirming booking…' : 'Booking confirm'}</button>
    </>}
    {error && <div className="live-company-error" role="alert" ref={errorBox} tabIndex={-1}>{error}</div>}
    <div className="live-company-actions">{companyProcessingRetryable(state) && <button type="button" className="secondary" disabled={busy || state.canWrite === false} onClick={() => void manager.command('retry', {})}>Retry pending booking processing</button>}{state.booking && <button type="button" className="secondary" disabled={busy || state.canWrite === false} onClick={() => void manager.command('reconcile', {})}>Recheck confirmed Google visits</button>}</div>
  </div>;
}
export function LiveCompanyBookingEditor({requestId,onAccessLost,active=true}:{requestId:string;onAccessLost:()=>void;active?:boolean}) {
  const manager=useCompanyBookingState(requestId,true,onAccessLost,active);
  return <section className="live-company-booking" aria-label="Company booking review and confirmation"><h3>Company booking review and confirmation</h3><p>Review the original cabinet photos, AI estimate and signed take-off request. The original customer request and signature remain saved separately.</p>{!manager.loaded&&!manager.error&&<p role="status">Loading the saved company booking…</p>}{manager.error&&<p className="live-company-error" role="alert">{manager.error}</p>}{manager.notice&&<p role="status">{manager.notice}</p>}{manager.busy&&<p role="status">Checking and saving company booking status…</p>}{manager.attempt&&<div className="live-company-notice" role="status"><p>The command outcome is not confirmed. Keep the current entries and retry the same command; checking status does not issue a new command.</p><button type="button" disabled={manager.busy} onClick={()=>void manager.retry()}>Retry same company command</button></div>}<div className="live-company-actions"><button type="button" className="secondary" disabled={manager.busy||manager.refreshing} onClick={()=>void manager.refresh()}>{manager.refreshing?'Refreshing saved company status…':'Refresh company booking status'}</button></div>{manager.state?<>{usesSignedRequestBooking(manager.state) ? <SignedRequestEditor key={requestId} state={manager.state} manager={manager}/> : <CompanyEditorForm key={requestId} state={manager.state} manager={manager}/>}<LiveCompanyBookingDocuments key={`documents:${requestId}`} state={manager.state} staff onAccessLost={onAccessLost}/></>:manager.loaded&&<p>Company booking review becomes available after the customer submits the original signed reservation request.</p>}</section>;
}
