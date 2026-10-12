'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LiveCustomerCompanyProposal } from '@/modules/bookings/client';
import { SignaturePad, type SignaturePoint } from '../../../shared/ui/signature-pad';
import type { LiveQuoteRequest } from '../domain/contracts';
import type { PublicAnalysisJob } from '../domain/photo-workspace';
import { validateBookingSignature, type LiveBookingAvailability, type LiveBookingReview, type LiveBookingState, type LiveBookingSubmission } from '../domain/booking-flow';
import { parseCustomerAccess } from './customer-access-client';
import { displayTime, LiveRequestError } from './request-client';
import { BookingResponseLifetime, bookingRequest, bookingDateLabel, bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingState, parseBookingReview, parseBookingAvailability, bookingEmailLabels, bookingCalendarLabels, pendingBookingAttemptAfterRead } from './booking-flow-client';

const MONEY = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
type Attempt = { path: string; method: string; body: string; review?: { approvalId: string; selectionRevision: number } };

export function BookingSubmissionSummary({ submission, staff = false }: { submission: LiveBookingSubmission; staff?: boolean }) {
  return <div className="lq-booking-receipt">
    <h3>Reservation request received</h3>
    <p className="lq-notice"><strong>Company confirmation required.</strong> This request does not reserve a date or confirm a booking. The company will review the complete work duration, scope and final price.</p>
    <dl className="lq-details">
      <div><dt>Receipt reference</dt><dd>{submission.reference}</dd></div>
      <div><dt>Preferred start date</dt><dd>{bookingDateLabel(submission.preferredDate)} (Sydney)</dd></div>
      <div><dt>Provisional painting amount</dt><dd>{MONEY.format(submission.snapshot.pricing.total! / 100)} incl GST</dd></div>
      <div><dt>Submitted</dt><dd>{displayTime(submission.submittedAt)} (Sydney)</dd></div>
      <div><dt>Acknowledged by</dt><dd>{submission.signature.name} · {submission.signature.method === 'typed' ? 'Typed signature' : 'Drawn signature'}</dd></div>
      <div><dt>Receipt document</dt><dd>{submission.receiptReady ? 'Frozen PDF saved' : 'PDF preparation pending'}</dd></div>
      <div><dt>Receipt email</dt><dd>{bookingEmailLabels[submission.emailStatus]}</dd></div>
      <div><dt>Company calendar</dt><dd>{bookingCalendarLabels[submission.calendarStatus]}</dd></div>
      {staff && <div><dt>Operational Google Calendar</dt><dd>{submission.snapshot.calendarTarget.calendarId}</dd></div>}
      {staff && submission.calendarEventId && <div><dt>Google event reference</dt><dd>{submission.calendarEventId}</dd></div>}
    </dl>
    {submission.error && <p className="lq-error" role="status">{submission.error}</p>}
    {submission.signature.method !== 'typed' && <svg className="lq-saved-signature" viewBox="0 0 300 90" role="img" aria-label={`Saved acknowledgment signature by ${submission.signature.name}`}><title>Saved acknowledgment signature</title>{submission.signature.strokes.map((stroke,i) => <polyline key={i} points={stroke.map(point=>`${point.x*300},${point.y*90}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
    <details><summary>Saved acknowledgment and approved estimate</summary><p>{submission.snapshot.acknowledgment.text}</p><p>Estimate revision {submission.snapshot.inputRevision} · {submission.snapshot.photos.length} saved photos · AI analysis {submission.snapshot.analysisId}</p><p>{submission.snapshot.pricing.notice}</p>{submission.snapshot.pricing.exclusions.map(item => <p key={item.code}>{item.description}</p>)}</details>
  </div>;
}

export function BookingFlowPanel({ request, latest, verifiedEmail, disabled = false, onBusyChange, onReadOnlyChange, onAccessLost }: { request: LiveQuoteRequest; latest: PublicAnalysisJob | null; verifiedEmail: string | null; disabled?: boolean; onBusyChange: (busy: boolean) => void; onReadOnlyChange: (readOnly: boolean) => void; onAccessLost: () => void }) {
  const [state, setState] = useState<LiveBookingState | null>(null), [review, setReview] = useState<LiveBookingReview | null>(null);
  const [month, setMonth] = useState(() => sydneyToday().slice(0, 7)), [availability, setAvailability] = useState<LiveBookingAvailability | null>(null), [availabilityExpired, setAvailabilityExpired] = useState(false);
  const [date, setDate] = useState(''), [strokes, setStrokes] = useState<SignaturePoint[][]>([]), [name, setName] = useState(''), [method, setMethod] = useState<'drawn' | 'typed'>('drawn'), [acknowledged, setAcknowledged] = useState(false);
  const [needsLink, setNeedsLink] = useState(false);
  const linkChecked = useRef(false);
  const [busy, setBusy] = useState(false), [calendarBusy, setCalendarBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [calendarError, setCalendarError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<Attempt | null>(null);
  const lifetime = useRef(new BookingResponseLifetime()), running = useRef(false), alive = useRef(false), reads = useRef<AbortController | null>(null), calendarReads = useRef<AbortController | null>(null), callbacks = useRef({ onBusyChange, onReadOnlyChange, onAccessLost });
  const errorBox = useRef<HTMLDivElement>(null), calendar = useRef<HTMLDivElement>(null);
  const requestRef = useRef(request), monthRef = useRef(month);
  useEffect(() => { callbacks.current = { onBusyChange, onReadOnlyChange, onAccessLost }; requestRef.current = request; monthRef.current = month; }, [request, month, onBusyChange, onReadOnlyChange, onAccessLost]);
  const verified = verifiedEmail?.toLowerCase() === request.payload.contact.email.toLowerCase();
  const eligible = Boolean(latest && !latest.stale && latest.status === 'succeeded' && latest.pricing?.status === 'provisional_estimate' && latest.pricing.total != null);
  const clearSignature = useCallback(() => { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); }, []);
  const apply = useCallback((value: LiveBookingState) => {
    setState(value); setLoaded(true); callbacks.current.onReadOnlyChange(!value.canEdit);
    setPending(current => pendingBookingAttemptAfterRead(current, value));
    if (value.submission) { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); }
    else if (value.approval?.stale) { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); setDate(''); }
  }, []);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    if (cause instanceof LiveRequestError && [401,403].includes(cause.status)) { setState(null); clearSignature(); setAvailability(null); callbacks.current.onAccessLost(); return; }
    setError(cause instanceof Error ? cause.message : 'The request result could not be confirmed. Check saved status or retry the same request.');
  }, [clearSignature]);
  const reload = useCallback(async () => {
    if (running.current) return;
    reads.current?.abort(); const controller = new AbortController(); reads.current = controller;
    const version = lifetime.current.begin();
    setBusy(true);
    try {
      if (!linkChecked.current) {
        const access = parseCustomerAccess(await bookingRequest('/api/quote/requests/customer', requestRef.current.id, {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)])}));
        if (!lifetime.current.accepts(version)) return;
        if (access.currentRequestId !== requestRef.current.id || !access.requests.some(item=>item.id===requestRef.current.id)) { setNeedsLink(true); setLoaded(true); setNotice('Verify email and keep this specific quote above before approving. Your draft is still here.'); return; }
        linkChecked.current = true; setNeedsLink(false);
      }
      const value = parseBookingState(await bookingRequest('/api/quote/requests/booking', requestRef.current.id, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) }), requestRef.current.id); if (lifetime.current.accepts(version)) { apply(value); setError(''); } }
    catch (cause) { if (lifetime.current.accepts(version)) fail(cause); }
    finally { if (lifetime.current.accepts(version)) setBusy(false); }
  }, [apply, fail]);
  useEffect(() => {
    alive.current = true; lifetime.current.reopen(); const current = lifetime.current;
    return () => { alive.current = false; current.close(); reads.current?.abort(); calendarReads.current?.abort(); callbacks.current.onBusyChange(false); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled && verified) { clearSignature(); return reload(); } });
    return () => { cancelled = true; reads.current?.abort(); };
  }, [request.revision, latest?.id, latest?.status, verified, clearSignature, reload]);
  useEffect(() => { callbacks.current.onBusyChange(busy || calendarBusy || Boolean(pending) || (verified && !loaded)); }, [busy, calendarBusy, pending, verified, loaded]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  const savedApproval = state?.approval;
  const approval = savedApproval && (savedApproval.inputRevision !== request.revision || (latest && savedApproval.analysisId !== latest.id)) ? { ...savedApproval, stale: true } : savedApproval;
  const submission = state?.submission;
  const showCalendar = Boolean(approval && !approval.stale && !submission);
  const loadMonth = useCallback(async (selectedMonth: string) => {
    calendarReads.current?.abort(); const controller = new AbortController(); calendarReads.current = controller;
    setAvailability(null); setAvailabilityExpired(false); setCalendarBusy(true); setCalendarError('');
    try {
      const value = parseBookingAvailability(await bookingRequest(`/api/quote/requests/booking/availability?month=${selectedMonth}`, requestRef.current.id, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) }), selectedMonth);
      if (alive.current && calendarReads.current === controller) setAvailability(value);
    } catch (cause) { if (alive.current && calendarReads.current === controller && !(cause instanceof DOMException && cause.name === 'AbortError')) { if (cause instanceof LiveRequestError && [401,403].includes(cause.status)) fail(cause); else setCalendarError(cause instanceof Error ? cause.message : 'Availability is unavailable. Refresh to retry.'); } }
    finally { if (alive.current && calendarReads.current === controller) setCalendarBusy(false); }
  }, [fail]);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled && showCalendar) return loadMonth(month); }); return () => { cancelled = true; calendarReads.current?.abort(); }; }, [showCalendar, month, loadMonth]);
  useEffect(() => {
    if (!availability) return;
    const timer = setTimeout(() => { setAvailabilityExpired(true); clearSignature(); }, Math.max(0, Date.parse(availability.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [availability, clearSignature]);
  useEffect(() => { if (!review) return; const timer = setTimeout(() => { clearSignature(); setNotice('Your review expired. Check the preferred date again before signing.'); }, Math.max(0, Date.parse(review.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [review, clearSignature]);
  const processing = Boolean(submission && (['pending','sending','retrying'].includes(submission.emailStatus) || ['pending','syncing','retrying'].includes(submission.calendarStatus)));
  useEffect(() => { if (!processing) return; const timer = setInterval(() => { if (!running.current) void reload(); }, 5000); return () => clearInterval(timer); }, [processing, reload]);
  async function perform(attempt: Attempt) {
    if (running.current || disabled || !verified || needsLink) return;
    reads.current?.abort(); const version = lifetime.current.begin(); running.current = true; setBusy(true); setPending(attempt); setError(''); setNotice('');
    try {
      const body = await bookingRequest(attempt.path, requestRef.current.id, { method: attempt.method, headers: { 'content-type': 'application/json' }, body: attempt.body, signal: AbortSignal.timeout(60_000) });
      if (!lifetime.current.accepts(version)) return;
      if (attempt.review) { setReview(parseBookingReview(body, requestRef.current.id, attempt.review.approvalId, attempt.review.selectionRevision)); setNotice('Review the saved acknowledgment and sign below.'); }
      else { apply(parseBookingState(body, requestRef.current.id)); clearSignature(); }
      setPending(null);
    } catch (cause) {
      if (!lifetime.current.accepts(version)) return;
      if (cause instanceof LiveRequestError && cause.status < 500) { setPending(null); if ([409,422].includes(cause.status)) { clearSignature(); setAvailability(null); setDate(''); setNotice('The estimate or availability changed. Reload the saved status before continuing.'); } }
      fail(cause);
    } finally { running.current = false; if (lifetime.current.accepts(version)) setBusy(false); }
  }
  function command(path: string, method: string, payload: Record<string, unknown>, reviewBinding?: Attempt['review']) {
    if (pending || busy || disabled) return;
    void perform({ path: `/api/quote/requests/booking/${path}`, method, body: JSON.stringify(payload), review: reviewBinding });
  }
  function approve() {
    if (!verified || needsLink) { setNotice('Verify email and keep this quote above before approving its estimate.'); document.querySelector<HTMLInputElement>('input[name="customer-email"]')?.focus(); return; }
    if (!latest || !eligible || !loaded) return;
    setDate(''); clearSignature(); command('approve', 'POST', { analysisId: latest.id, expectedRevision: request.revision, idempotencyKey: crypto.randomUUID() });
  }
  function selectDate(value: string) { if (busy || pending || disabled) return; clearSignature(); setDate(value); setError(''); command('date', 'PUT', { approvalId: approval!.id, preferredDate: value, availabilityRevision: availability!.revision, idempotencyKey: crypto.randomUUID() }); }
  function submit() {
    if (!review || !acknowledged) return;
    try { const signature = validateBookingSignature({ name, method, strokes: method === 'typed' ? [] : strokes, acknowledged }); command('submit','POST',{ reviewProof: review.reviewProof, signature, idempotencyKey: crypto.randomUUID() }); }
    catch (cause) { fail(cause); }
  }
  async function download() {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    const version = lifetime.current.begin();
    try {
      const response = await fetch('/api/quote/requests/booking/documents/receipt', { credentials: 'same-origin', cache: 'no-store', headers: { 'x-lk-quote-request-id': request.id }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The private receipt PDF is not ready. Check saved status and retry.');
      const blob = await response.blob(); if (!lifetime.current.accepts(version)) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `${submission?.reference ?? 'booking-request'}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) { if (lifetime.current.accepts(version)) fail(cause); }
    finally { running.current = false; if (lifetime.current.accepts(version)) setBusy(false); }
  }
  function calendarKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 7 : event.key === 'ArrowUp' ? -7 : 0;
    if (!delta && !['Home','End'].includes(event.key)) return;
    event.preventDefault(); const buttons = Array.from(calendar.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const index = buttons.indexOf(event.currentTarget);
    let target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + delta;
    while (target >= 0 && target < buttons.length && buttons[target].disabled) target += delta < 0 || event.key === 'End' ? -1 : 1;
    buttons[target]?.focus();
  }
  const locked = disabled || busy || Boolean(pending), days = bookingMonthDates(month), firstMonth = availability?.minMonth ?? sydneyToday().slice(0,7), lastMonth = availability?.maxMonth ?? shiftBookingMonth(sydneyToday().slice(0,7), 3);
  const selectedIsCurrent = Boolean(approval && !approval.stale && approval.preferredDate && approval.preferredDate === date);
  return <section className="lq-booking" aria-labelledby="live-booking-title">
    <h3 id="live-booking-title">Estimate approval and reservation request</h3>
    {error && <div className="lq-error" ref={errorBox} tabIndex={-1} role="alert"><p>{error}</p>{!pending && <button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Check saved request status</button>}</div>}
    {pending && <div className="lq-notice" role="status"><p>This request result is not confirmed. A successful status check keeps your original request available to retry. Retry it before editing.</p><div className="lq-actions"><button type="button" disabled={busy} onClick={() => void perform(pending)}>Retry same request</button><button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Check saved request status</button></div></div>}
    <p role="status" aria-live="polite">{busy ? 'Checking and saving your request…' : notice}</p>
    {submission ? <><BookingSubmissionSummary submission={submission} /><div className="lq-actions"><button type="button" className="secondary" disabled={busy || !submission.receiptReady} onClick={() => void download()}>Download saved receipt PDF</button><button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Refresh receipt status</button>{submission.emailStatus !== 'provider_accepted' || submission.calendarStatus !== 'synced' ? <button type="button" disabled={locked || ['manual_review','outcome_unknown'].includes(submission.emailStatus) || ['manual_review','conflict'].includes(submission.calendarStatus)} onClick={() => command('retry','POST',{})}>Retry pending receipt delivery</button> : null}</div><p>These submitted details, photos, estimate and acknowledgment are saved as an immutable receipt.</p><LiveCustomerCompanyProposal key={request.id} requestId={request.id} onAccessLost={onAccessLost} /></> : <>
      <p className="lq-notice">Approve the provisional estimate to request a preferred start date. <strong>Company confirmation required.</strong> A request does not reserve the date or confirm a contract.</p>
      {approval?.stale && <p role="status">Your saved estimate changed. Review the current photos and estimate, then approve it again.</p>}
      {!approval || approval.stale ? <><p>{eligible ? 'Review your saved AI estimate and exclusions above before continuing.' : 'Save a current numeric AI provisional estimate from your cabinet photos before approving.'}</p><button type="button" disabled={locked || !eligible || (verified && !loaded)} onClick={approve}>Approve estimate and choose date</button>{(!verified || needsLink) && <p>Verify email and keep this quote above to continue.</p>}</> : <>
        <p>Approved provisional painting estimate: <strong>{MONEY.format(approval.snapshot.pricing.total! / 100)} incl GST</strong>. Exact quantities and final scope remain subject to site confirmation.</p>
        <h4>Choose a preferred start date</h4><p>Booked days are unavailable. Requestable days are preferences only; the company must check the complete duration.</p>
        <div className="lq-calendar-nav"><button type="button" className="secondary" aria-label="Previous month" disabled={locked || calendarBusy || month <= firstMonth} onClick={() => { clearSignature(); setMonth(shiftBookingMonth(month,-1)); }}>←</button><h5>{new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(`${month}-01T12:00:00Z`))}</h5><button type="button" className="secondary" aria-label="Next month" disabled={locked || calendarBusy || month >= lastMonth} onClick={() => { clearSignature(); setMonth(shiftBookingMonth(month,1)); }}>→</button></div>
        {calendarBusy && <p role="status">Checking company availability…</p>}{calendarError && <p className="lq-error" role="alert">{calendarError} Dates remain disabled until a complete check succeeds.</p>}{availabilityExpired && <p role="status">Availability expired. Refresh before choosing or signing.</p>}
        <div className="lq-calendar" ref={calendar} role="group" aria-label="Preferred start date in Sydney; use arrow keys to move between requestable dates">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <span className="lq-weekday" key={day} aria-hidden="true">{day}</span>)}
          {Array.from({length:(new Date(`${month}-01T12:00:00Z`).getUTCDay()+6)%7},(_,i) => <span key={`space-${i}`} />)}
          {days.map((value,i) => { const day = availability?.days[i], selectable = Boolean(day?.selectable && !availabilityExpired && !calendarBusy && !locked); return <button type="button" key={value} disabled={!selectable} aria-pressed={approval.preferredDate === value} aria-label={`${bookingDateLabel(value)}, ${day?.reason === 'busy' ? 'unavailable: booked' : selectable ? 'available to request only' : 'unavailable'}`} onKeyDown={calendarKeyboard} onClick={() => selectDate(value)}>{i+1}{day?.reason === 'busy' && <span>Booked</span>}</button>; })}
        </div>
        <div className="lq-actions"><button type="button" className="secondary" disabled={locked || calendarBusy} onClick={() => { clearSignature(); void loadMonth(month); }}>Refresh availability</button></div>
        {approval.preferredDate && <p role="status">Saved preferred start date: <strong>{bookingDateLabel(approval.preferredDate)}</strong> (Sydney). No date is held.</p>}
        {availability && !availability.days.some(day => day.selectable) && <p>No dates are available to request in this month.</p>}
        {!review && <button type="button" disabled={locked || calendarBusy || !selectedIsCurrent || !availability || availabilityExpired} onClick={() => command('review','POST',{approvalId:approval.id,selectionRevision:approval.selectionRevision},{approvalId:approval.id,selectionRevision:approval.selectionRevision})}>Review acknowledgment and sign</button>}
        {review && <fieldset className="lq-fields lq-booking-sign" disabled={locked || availabilityExpired}><legend>Nonbinding reservation request acknowledgment</legend><p>{review.snapshot.acknowledgment.text}</p><p>Preferred start date: <strong>{bookingDateLabel(review.snapshot.preferredDate!)}</strong>. Provisional painting amount: <strong>{MONEY.format(review.snapshot.pricing.total! / 100)} incl GST</strong>.</p><label>Your full name *<input name="booking-signature-name" autoComplete="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><fieldset><legend>Signature method</legend><label className="lq-option"><input type="radio" name="booking-signature-method" checked={method === 'drawn'} onChange={() => { setMethod('drawn'); setStrokes([]); }} />Draw signature</label><label className="lq-option"><input type="radio" name="booking-signature-method" checked={method === 'typed'} onChange={() => { setMethod('typed'); setStrokes([]); }} />Use my typed full name as my signature</label></fieldset>{method === 'drawn' && <SignaturePad label="Draw your acknowledgment signature *" strokes={strokes} onChange={setStrokes} disabled={locked || availabilityExpired} />}<label className="lq-option"><input name="booking-acknowledged" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I acknowledge the summary above and understand company confirmation is required. *</label><button type="button" disabled={!acknowledged || !name.trim() || (method === 'drawn' && !strokes.length)} onClick={submit}>Submit reservation request</button></fieldset>}
      </>}
    </>}
  </section>;
}
