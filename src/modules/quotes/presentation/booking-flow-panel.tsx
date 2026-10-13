'use client';

import { ValidatedInput, reportSectionValidity } from "@/shared/ui/validated-input";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { LiveCustomerCompanyProposal } from '@/modules/bookings/client';
import { SignaturePad, type SignaturePoint } from '../../../shared/ui/signature-pad';
import type { LiveQuoteRequest } from '../domain/contracts';
import type { PublicAnalysisJob } from '../domain/photo-workspace';
import { BOOKING_SIMPLE_ACK_VERSION, validateBookingSignature, type LiveBookingAvailability, type LiveBookingReview, type LiveBookingState, type LiveBookingSubmission } from '../domain/booking-flow';
import { parseCustomerAccess } from './customer-access-client';
import { bookingFlowGuidance, shouldRefreshBookingAvailability } from './booking-flow-guidance';
import { displayTime, LiveRequestError } from './request-client';
import { BookingResponseLifetime, bookingRequest, bookingDateLabel, bookingMonthDates, shiftBookingMonth, sydneyToday, parseBookingState, parseBookingReview, parseBookingAvailability, bookingEmailLabels, bookingCalendarLabels, pendingBookingAttemptAfterRead, bookingPreparationAttempt, bookingPreparationNext, bookingTimeValid, type BookingAttempt } from './booking-flow-client';

const MONEY = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
type Attempt = BookingAttempt;

export function BookingSubmissionSummary({ submission, staff = false }: { submission: LiveBookingSubmission; staff?: boolean }) {
  const simpleBooking = submission.snapshot.version === BOOKING_SIMPLE_ACK_VERSION;
  return <div className="lq-booking-receipt">
    <h3 className={staff ? undefined : 'lq-sr-only'}>{simpleBooking ? 'Signed booking request saved' : 'Request received · Company booking confirmation'}</h3>
    {!staff && <div className="lq-receipt-highlights"><div className="lq-receipt-amount"><span>Photo-based painting estimate</span><strong>{MONEY.format(submission.snapshot.pricing.total! / 100)}</strong><small>Including GST · final price confirmed on site</small></div><div><CalendarDays size={20} aria-hidden="true" /><span>{simpleBooking ? 'Requested take-off visit' : 'Requested start date'}</span><strong>{bookingDateLabel(submission.preferredDate)}</strong><small>{submission.preferredTime ? `${submission.preferredTime} · Sydney time` : 'Sydney time'}</small></div><div><ClipboardCheck size={20} aria-hidden="true" /><span>Receipt reference</span><strong>{submission.reference}</strong></div></div>}
    <p className="lq-notice">{simpleBooking ? 'Your original take-off date and time, photo-based estimate and signature are saved. Check the company booking status below for the confirmed booking and installation details.' : <><strong>Company confirmation required.</strong> This request does not reserve a date or confirm a booking. This earlier request keeps its original separate company proposal and customer confirmation process.</>}</p>
    <details className="lq-optional-details" open={staff || undefined}><summary>Receipt and delivery details</summary><dl className="lq-details">
      <div><dt>Receipt reference</dt><dd>{submission.reference}</dd></div>
      <div><dt>{submission.snapshot.version === BOOKING_SIMPLE_ACK_VERSION ? 'Take-off date and time' : 'Preferred start date'}</dt><dd>{bookingDateLabel(submission.preferredDate)}{submission.preferredTime ? ` · ${submission.preferredTime}` : ' · Time not recorded in this earlier request'} (Sydney)</dd></div>
      <div><dt>Provisional painting amount</dt><dd>{MONEY.format(submission.snapshot.pricing.total! / 100)} incl GST</dd></div>
      <div><dt>Submitted</dt><dd>{displayTime(submission.submittedAt)} (Sydney)</dd></div>
      <div><dt>Acknowledged by</dt><dd>{submission.signature.name} · {submission.signature.method === 'typed' ? 'Typed signature' : 'Drawn signature'}</dd></div>
      <div><dt>Receipt document</dt><dd>{submission.receiptReady ? 'Frozen PDF saved' : 'PDF preparation pending'}</dd></div>
      <div><dt>Receipt email</dt><dd>{bookingEmailLabels[submission.emailStatus]}</dd></div>
      <div><dt>Company calendar</dt><dd>{bookingCalendarLabels[submission.calendarStatus]}</dd></div>
      {staff && <div><dt>Operational Google Calendar</dt><dd>{submission.snapshot.calendarTarget.calendarId}</dd></div>}
      {staff && submission.calendarEventId && <div><dt>Google event reference</dt><dd>{submission.calendarEventId}</dd></div>}
    </dl></details>
    {submission.error && <p className="lq-error" role="status">{submission.error}</p>}
    {submission.signature.method !== 'typed' && <svg className="lq-saved-signature" viewBox="0 0 300 90" role="img" aria-label={`Saved acknowledgment signature by ${submission.signature.name}`}><title>Saved acknowledgment signature</title>{submission.signature.strokes.map((stroke,i) => <polyline key={i} points={stroke.map(point=>`${point.x*300},${point.y*90}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
    <details><summary>Saved acknowledgment and approved estimate</summary><p>{submission.snapshot.acknowledgment.text}</p><p>Estimate revision {submission.snapshot.inputRevision} · {submission.snapshot.photos.length} saved photos · AI analysis {submission.snapshot.analysisId}</p><p>{submission.snapshot.pricing.notice}</p>{submission.snapshot.pricing.exclusions.map(item => <p key={item.code}>{item.description}</p>)}</details>
  </div>;
}

export function BookingFlowPanel({ request, latest, verifiedEmail, accessVersion = 0, disabled = false, view = 'date', active = true, actionContainer, onStageChange, onRecovery, onBusyChange, onReadOnlyChange, onAccessLost }: { request: LiveQuoteRequest; latest: PublicAnalysisJob | null; verifiedEmail: string | null; accessVersion?: number; disabled?: boolean; view?: 'date' | 'sign' | 'complete'; active?: boolean; actionContainer?: HTMLElement | null; onStageChange?: (stage: 'date' | 'sign' | 'complete') => void; onRecovery?: (target: 'photos' | 'email') => void; onBusyChange: (busy: boolean) => void; onReadOnlyChange: (readOnly: boolean) => void; onAccessLost: () => void }) {
  const [state, setState] = useState<LiveBookingState | null>(null), [review, setReview] = useState<LiveBookingReview | null>(null);
  const [month, setMonth] = useState(() => sydneyToday().slice(0, 7)), [availability, setAvailability] = useState<LiveBookingAvailability | null>(null), [availabilityExpired, setAvailabilityExpired] = useState(false);
  const [date, setDate] = useState(''), [time, setTime] = useState(''), [strokes, setStrokes] = useState<SignaturePoint[][]>([]), [name, setName] = useState(''), [method, setMethod] = useState<'drawn' | 'typed'>('drawn'), [acknowledged, setAcknowledged] = useState(false);
  const [needsLink, setNeedsLink] = useState(false);
  const linkChecked = useRef(false);
  const [busy, setBusy] = useState(false), [calendarBusy, setCalendarBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [calendarError, setCalendarError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<Attempt | null>(null);
  const lifetime = useRef(new BookingResponseLifetime()), running = useRef(false), alive = useRef(false), reads = useRef<AbortController | null>(null), calendarReads = useRef<AbortController | null>(null), callbacks = useRef({ onBusyChange, onReadOnlyChange, onAccessLost, onStageChange, onRecovery });
  const receivedSubmission = useRef<string | null>(null);
  const visibility = useRef({ active, view });
  useEffect(() => { visibility.current = { active, view }; }, [active, view]);
  const errorBox = useRef<HTMLDivElement>(null), calendar = useRef<HTMLDivElement>(null), calendarHeading = useRef<HTMLHeadingElement>(null), signHeading = useRef<HTMLLegendElement>(null);
  const requestRef = useRef(request), monthRef = useRef(month);
  useEffect(() => { callbacks.current = { onBusyChange, onReadOnlyChange, onAccessLost, onStageChange, onRecovery }; requestRef.current = request; monthRef.current = month; }, [request, month, onBusyChange, onReadOnlyChange, onAccessLost, onStageChange, onRecovery]);
  const verified = verifiedEmail?.toLowerCase() === request.payload.contact.email.toLowerCase();
  const eligible = Boolean(latest && !latest.stale && latest.status === 'succeeded' && latest.pricing?.status === 'provisional_estimate' && latest.pricing.total != null);
  const clearSignature = useCallback(() => { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); }, []);
  const apply = useCallback((value: LiveBookingState) => {
    setState(value); setLoaded(true); callbacks.current.onReadOnlyChange(!value.canEdit);
    setPending(current => pendingBookingAttemptAfterRead(current, value));
    if (value.submission) { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); if (receivedSubmission.current !== value.submission.id) { receivedSubmission.current = value.submission.id; callbacks.current.onStageChange?.('complete'); } }
    else if (value.approval?.stale) { setReview(null); setStrokes([]); setName(''); setAcknowledged(false); }
    else {
      if (value.approval?.preferredDate) { setDate(value.approval.preferredDate); setTime(value.approval.preferredTime ?? ''); }
      if (value.approval?.preferredDate && monthRef.current !== value.approval.preferredDate.slice(0, 7)) setMonth(value.approval.preferredDate.slice(0, 7));
    }
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
        if (access.currentRequestId !== requestRef.current.id || !access.requests.some(item=>item.id===requestRef.current.id)) { setNeedsLink(true); setLoaded(true); return; }
        linkChecked.current = true; setNeedsLink(false); setNotice(current => current === 'Confirm the saved email for this quote to choose your visit.' ? '' : current);
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
    lifetime.current.begin(); linkChecked.current = false; reads.current?.abort(); calendarReads.current?.abort();
    void Promise.resolve().then(() => {
      if (cancelled) return;
      clearSignature(); setLoaded(false); setAvailability(null);
      if (verified) return reload();
      setState(null); setAvailability(null); setLoaded(false); setNeedsLink(false); setBusy(false); callbacks.current.onReadOnlyChange(false);
    });
    return () => { cancelled = true; reads.current?.abort(); };
  }, [request.revision, latest?.id, latest?.status, verified, accessVersion, clearSignature, reload]);
  useEffect(() => { callbacks.current.onBusyChange(busy || calendarBusy || Boolean(pending)); }, [busy, calendarBusy, pending]);
  useEffect(() => { if (error && active) errorBox.current?.focus({ preventScroll: true }); }, [error, active]);
  const savedApproval = state?.approval;
  const approval = savedApproval && (savedApproval.inputRevision !== request.revision || (latest && savedApproval.analysisId !== latest.id)) ? { ...savedApproval, stale: true } : savedApproval;
  const submission = state?.submission;
  useEffect(() => {
    if (active && submission && receivedSubmission.current !== submission.id) { receivedSubmission.current = submission.id; callbacks.current.onStageChange?.('complete'); }
  }, [active, submission]);
  const showCalendar = Boolean(eligible && verified && loaded && !needsLink && !submission && active);
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
    const timer = setTimeout(() => { setAvailabilityExpired(true); }, Math.max(0, Date.parse(availability.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [availability]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled && shouldRefreshBookingAvailability({ expired: availabilityExpired, showCalendar, disabled, busy, calendarBusy, pending: Boolean(pending), reviewing: Boolean(review), calendarError })) return loadMonth(month);
    });
    return () => { cancelled = true; };
  }, [availabilityExpired, showCalendar, disabled, busy, calendarBusy, pending, review, calendarError, loadMonth, month]);
  useEffect(() => { if (review && active && view === 'sign') requestAnimationFrame(() => signHeading.current?.focus({ preventScroll: true })); }, [review, active, view]);
  useEffect(() => { if (!review) return; const timer = setTimeout(() => { clearSignature(); setNotice('Your signing session expired. Check your date and time, then continue to sign again.'); if (visibility.current.active && visibility.current.view === 'sign') callbacks.current.onStageChange?.('date'); }, Math.max(0, Date.parse(review.expiresAt) - Date.now())); return () => clearTimeout(timer); }, [review, clearSignature]);
  useEffect(() => { if (active && view === 'sign' && loaded && !review && !submission && !busy && !pending) callbacks.current.onStageChange?.('date'); }, [active, view, loaded, review, submission, busy, pending]);
  const processing = Boolean(submission && (['pending','sending','retrying'].includes(submission.emailStatus) || ['pending','syncing','retrying'].includes(submission.calendarStatus)));
  useEffect(() => { if (!processing) return; const timer = setInterval(() => { if (!running.current) void reload(); }, 5000); return () => clearInterval(timer); }, [processing, reload]);
  async function perform(attempt: Attempt) {
    if (running.current || disabled || !verified || needsLink) return;
    reads.current?.abort(); const version = lifetime.current.begin(); running.current = true; setBusy(true); setError(''); setNotice('');
    let current: Attempt | null = attempt;
    try {
      while (current) {
        setPending(current);
        const body = await bookingRequest(current.path, requestRef.current.id, { method: current.method, headers: { 'content-type': 'application/json' }, body: current.body, signal: AbortSignal.timeout(60_000) });
        if (!lifetime.current.accepts(version)) return;
        if (current.review) {
          setReview(parseBookingReview(body, requestRef.current.id, current.review.approvalId, current.review.selectionRevision, current.review.selection));
          setLoaded(true);
          setNotice('Your date, time and estimate are saved.'); callbacks.current.onStageChange?.('sign'); current = null;
        } else {
          const saved = parseBookingState(body, requestRef.current.id); apply(saved); clearSignature();
          current = bookingPreparationNext(current, saved, crypto.randomUUID());
        }
      }
      setPending(null);
    } catch (cause) {
      if (!lifetime.current.accepts(version)) return;
      if (cause instanceof LiveRequestError && cause.status < 500) { setPending(null); if ([409,422].includes(cause.status)) { clearSignature(); setAvailability(null); setNotice('The estimate or availability changed. Refresh the calendar and check the saved status.'); callbacks.current.onStageChange?.('date'); } }
      fail(cause);
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function command(path: string, method: string, payload: Record<string, unknown>, reviewBinding?: Attempt['review']) {
    if (pending || busy || disabled) return;
    void perform({ path: `/api/quote/requests/booking/${path}`, method, body: JSON.stringify(payload), review: reviewBinding });
  }
  function focusRecovery(target: 'photos' | 'email' | 'status' | 'calendar') {
    if (target === 'calendar') { void loadMonth(month); calendarHeading.current?.focus({ preventScroll: true }); return; }
    if (target === 'status') { void reload(); return; }
    if (callbacks.current.onRecovery) { callbacks.current.onRecovery(target); return; }
    const element = target === 'email' ? document.querySelector<HTMLElement>('button[data-quote-email-binding]') ?? document.querySelector<HTMLElement>('input[data-quote-email-binding]') ?? document.querySelector<HTMLElement>('[data-quote-access-heading]') : document.querySelector<HTMLElement>('#live-photos-title');
    element?.focus({ preventScroll: true });
  }
  function selectDate(value: string) { if (busy || pending || disabled) return; clearSignature(); setDate(value); setError(''); }
  function continueToSign() {
    if (!verified || needsLink) { focusRecovery('email'); return; }
    if (!latest || !eligible || !state || !availability || availabilityExpired || calendarBusy || pending || busy || disabled) return;
    try {
      if (!availability.days.some(day => day.date === date && day.selectable)) throw new Error('Choose an available take-off date.');
      clearSignature();
      void perform(bookingPreparationAttempt(state, latest.id, request.revision, { date, time, availabilityRevision: availability.revision }, crypto.randomUUID()));
    } catch (cause) { fail(cause); }
  }
  const signatureField = useRef<HTMLLabelElement>(null);
  function submit() {
    if (!review || !acknowledged) return;
    if (!reportSectionValidity(signatureField.current)) return;
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
  const selectedIsCurrent = Boolean(date && bookingTimeValid(time) && availability?.days.some(day => day.date === date && day.selectable));
  const guidance = bookingFlowGuidance({ latest, verified, needsLink, loaded, approved: Boolean(approval && !approval.stale), submitted: Boolean(submission), calendarError, calendarBusy, availabilityExpired });
  const waitingForEmail = !verified || needsLink;
  return <section className="lq-booking" aria-labelledby="live-booking-title">
    <h3 id="live-booking-title" className="lq-sr-only">{view === 'sign' ? 'Sign your booking request' : submission ? 'Booking request receipt' : 'Choose your visit'}</h3>
    {view !== 'sign' && !submission && !waitingForEmail && <p className="lq-notice" role="status">{guidance.message}</p>}
    {view !== 'sign' && !waitingForEmail && guidance.target && guidance.target !== 'email' && <button type="button" className="secondary" disabled={locked || calendarBusy} onClick={() => focusRecovery(guidance.target!)}>{guidance.target === 'photos' ? 'Go to photos and estimate' : guidance.target === 'calendar' ? 'Refresh availability' : 'Check saved request status'}</button>}
    {error && <div className="lq-error" ref={errorBox} tabIndex={-1} role="alert"><p>{error}</p>{!pending && <button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Check saved request status</button>}</div>}
    {pending && <div className="lq-notice" role="status"><p>This request result is not confirmed. A successful status check keeps your original request available to retry. Retry it before editing.</p><div className="lq-actions"><button type="button" disabled={busy} onClick={() => void perform(pending)}>Retry same request</button><button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Check saved request status</button></div></div>}
    <p role="status" aria-live="polite">{busy ? 'Checking and saving your request…' : waitingForEmail ? '' : notice}</p>
    {submission ? <><BookingSubmissionSummary submission={submission} /><div className="lq-actions"><button type="button" className="secondary" disabled={busy || !submission.receiptReady} onClick={() => void download()}>Download saved receipt PDF</button><button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>Refresh receipt status</button>{submission.emailStatus !== 'provider_accepted' || !['synced','not_required'].includes(submission.calendarStatus) ? <button type="button" disabled={locked || ['manual_review','outcome_unknown'].includes(submission.emailStatus) || ['manual_review','conflict'].includes(submission.calendarStatus)} onClick={() => command('retry','POST',{})}>Retry pending receipt delivery</button> : null}</div><p>These submitted details, photos, estimate and acknowledgment are saved as an immutable receipt.</p><LiveCustomerCompanyProposal key={request.id} requestId={request.id} onAccessLost={onAccessLost} /></> : <>
      {view === 'date' && !waitingForEmail && <div className="lq-help-card"><CalendarDays /><div><strong>Your preferred take-off visit</strong><p>Choose when to have your cabinet fronts removed. The company will arrange installation and confirm both visits. No date is held yet.</p></div></div>}
      {approval?.stale && <p role="status">Your estimate changed. Continuing to sign uses the current saved photos and estimate.</p>}
      {!showCalendar && !waitingForEmail && !eligible && <p>Save a current numeric AI estimate from your cabinet photos before choosing a date.</p>}
      {showCalendar && <><div data-quote-booking-date hidden={view !== 'date'}>
        <p>Photo-based painting estimate: <strong>{MONEY.format(latest!.pricing!.total! / 100)} incl GST</strong>. Additional damage found on site may increase the price; any extra work and cost will be discussed before proceeding.</p>
        <h4 ref={calendarHeading} tabIndex={-1}>Select a date</h4><p>Booked days are unavailable. Times are in Sydney local time; the company checks the full visit durations before confirmation.</p>
        <div className="lq-calendar-nav"><button type="button" className="secondary" aria-label="Previous month" disabled={locked || calendarBusy || month <= firstMonth} onClick={() => { clearSignature(); setMonth(shiftBookingMonth(month,-1)); }}>←</button><h5>{new Intl.DateTimeFormat('en-AU',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(`${month}-01T12:00:00Z`))}</h5><button type="button" className="secondary" aria-label="Next month" disabled={locked || calendarBusy || month >= lastMonth} onClick={() => { clearSignature(); setMonth(shiftBookingMonth(month,1)); }}>→</button></div>
        {calendarBusy && <p role="status">Checking company availability…</p>}{calendarError && <p className="lq-error" role="alert">{calendarError} Dates remain disabled until a complete check succeeds.</p>}{availabilityExpired && <p role="status">This calendar check expired. It refreshes automatically while idle, or use Refresh availability. Your saved preferred date remains unchanged.</p>}
        <div className="lq-calendar" ref={calendar} role="group" aria-label="Preferred start date in Sydney; use arrow keys to move between requestable dates">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <span className="lq-weekday" key={day} aria-hidden="true">{day}</span>)}
          {Array.from({length:(new Date(`${month}-01T12:00:00Z`).getUTCDay()+6)%7},(_,i) => <span key={`space-${i}`} />)}
          {days.map((value,i) => { const day = availability?.days[i], selectable = Boolean(day?.selectable && !availabilityExpired && !calendarBusy && !locked); return <button type="button" key={value} disabled={!selectable} aria-pressed={date === value} aria-label={`${bookingDateLabel(value)}, ${day?.reason === 'busy' ? 'unavailable: booked' : selectable ? 'available to request only' : 'unavailable'}`} onKeyDown={calendarKeyboard} onClick={() => selectDate(value)}>{i+1}{day?.reason === 'busy' && <span>Booked</span>}</button>; })}
        </div>
        <div className="lq-actions"><button type="button" className="secondary" disabled={locked || calendarBusy} onClick={() => { void loadMonth(month); }}>Refresh availability</button></div>
        <label>Take-off time (Sydney) *<input name="booking-preferred-time" type="time" required value={time} disabled={locked} onChange={event => { clearSignature(); setTime(event.target.value); }} /></label>
        {date && <p role="status">Selected take-off: <strong>{bookingDateLabel(date)}{time ? ` · ${time}` : ' · Choose a time'}</strong> (Sydney). No date is held.</p>}
        {availability && !availability.days.some(day => day.selectable) && <p>No dates are available to request in this month.</p>}
        {!actionContainer && <button id="quote-continue-sign" type="button" disabled={locked || calendarBusy || !selectedIsCurrent || !availability || availabilityExpired} onClick={continueToSign}>Continue to sign</button>}
        </div><div data-quote-booking-sign hidden={view !== 'sign'}>
        {review && <fieldset className="lq-fields lq-booking-sign" disabled={locked}><legend ref={signHeading} tabIndex={-1}>Review and sign</legend><p>{review.snapshot.acknowledgment.text}</p><p>Take-off date and time: <strong>{bookingDateLabel(review.snapshot.preferredDate!)} · {review.snapshot.preferredTime}</strong> (Sydney). Provisional painting amount: <strong>{MONEY.format(review.snapshot.pricing.total! / 100)} incl GST</strong>.</p><label ref={signatureField}>Your full name *<ValidatedInput validation="text" requireLetter required minLength={2} validationLabel="Your full name" name="booking-signature-name" autoComplete="name" maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><fieldset><legend>Signature method</legend><label className="lq-option"><input type="radio" name="booking-signature-method" checked={method === 'drawn'} onChange={() => { setMethod('drawn'); setStrokes([]); }} />Draw signature</label><label className="lq-option"><input type="radio" name="booking-signature-method" checked={method === 'typed'} onChange={() => { setMethod('typed'); setStrokes([]); }} />Use my typed full name as my signature</label></fieldset>{method === 'drawn' && <SignaturePad label="Draw your acknowledgment signature *" strokes={strokes} onChange={setStrokes} disabled={locked} />}<label className="lq-option"><input name="booking-acknowledged" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I acknowledge this estimate, my take-off date and time, and the company assigning the installation visit. *</label>{!actionContainer && <button id="quote-submit-booking" type="button" disabled={locked || !acknowledged || !name.trim() || (method === 'drawn' && !strokes.length)} onClick={submit}>Submit booking request</button>}</fieldset>}
        </div></>}
    </>}
    {active && actionContainer && createPortal(submission ? <span className="lq-received-badge"><CheckCircle2 size={18} aria-hidden="true" />Request received</span> : waitingForEmail ? null : view === 'sign' ? <button data-quote-next id="quote-submit-booking" type="button" disabled={locked || !review || !acknowledged || !name.trim() || (method === 'drawn' && !strokes.length)} onClick={submit}>Submit booking request<ArrowRight size={17} aria-hidden="true" /></button> : <button data-quote-next id="quote-continue-sign" type="button" disabled={locked || !showCalendar || calendarBusy || !selectedIsCurrent || !availability || availabilityExpired} onClick={continueToSign}>{busy ? 'Saving…' : 'Continue to sign'}<ArrowRight size={17} aria-hidden="true" /></button>, actionContainer)}
  </section>;
}
