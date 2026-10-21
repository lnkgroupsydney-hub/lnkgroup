'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ValidatedInput, reportSectionValidity } from '@/shared/ui/validated-input';
import { useUnsavedChanges, useWorkspaceDraft } from '@/shared/ui/admin-workspace-state';
import type { WorkClientState } from '@/modules/enquiries/client';
import type { LiveCompanyBookingState } from '../domain/live-contracts';
import type { CancellationState, SimpleBookingManagement } from '../domain/simple-management';
import { companySegmentLabel, companyTime } from './live-booking-client';
import { CurrentWorkClient, parseSimpleBookingManagement, simpleBookingActions } from './simple-booking-client';

export type SimpleBookingWork = ReturnType<typeof useSimpleBookingWork>;
type WorkState = WorkClientState<SimpleBookingManagement>;

/** One stable command lane for Save draft, cancellation and their result checks. */
export function useSimpleBookingWork(requestId: string, onAccessLost: () => void) {
  const [client] = useState(() => new CurrentWorkClient<SimpleBookingManagement>(parseSimpleBookingManagement));
  const [state, setState] = useState<WorkState>(() => client.snapshot());
  const actions = useMemo(() => { try { return simpleBookingActions(client, requestId); } catch { return null; } }, [client, requestId]);
  const alive = useRef(false), lost = useRef(onAccessLost);
  useEffect(() => { lost.current = onAccessLost; }, [onAccessLost]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.clear(); }; }, [client]);
  const run = useCallback(async (action: () => Promise<WorkState>) => {
    let next: WorkState;
    try {
      const request = action();
      if (alive.current) setState(client.snapshot());
      next = await request;
    } catch (cause) {
      next = { ...client.snapshot(), error: cause instanceof Error ? cause.message : 'This booking request could not start.' };
    }
    if (alive.current) { setState(next); if (next.phase === 'access_lost') lost.current(); }
    return next;
  }, [client]);
  const saving = state.phase === 'saving', uncertain = state.phase === 'unknown';
  useUnsavedChanges(`live-booking.${requestId}.work-guard`, { dirty: uncertain, busy: saving || uncertain, onDiscard: noop });
  return { state, actions, run, saving, uncertain, locked: saving || uncertain };
}
function noop() {}

export type WorkCommand = 'draft' | 'cancel' | 'continue';
const commandNames: Record<WorkCommand, string> = { draft: 'The booking draft', cancel: 'The cancellation request', continue: 'The cancellation continuation' };

export function WorkRecovery({ work, command, message, onResolved }: { work: SimpleBookingWork; command: WorkCommand; message: string; onResolved: (next: WorkState) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  async function resolve(kind: 'check' | 'retry') {
    if (!work.actions) return;
    const next = await work.run(kind === 'check' ? work.actions.check : work.actions.retry);
    onResolved(next);
  }
  return <div className="live-company-error" role="alert" ref={box} tabIndex={-1}>
    <p><strong>Result not confirmed.</strong> {commandNames[command]} was sent, but the result is unknown. It may already be saved. Your entries are locked so the same request can be checked or sent again without repeating it.</p>
    {message && <p>{message}</p>}
    {work.state.code && work.state.code !== 'outcome_unknown' && work.state.error && <p>{work.state.error}</p>}
    <div className="live-company-actions"><button type="button" disabled={work.saving} onClick={() => void resolve('check')}>{work.saving ? 'Checking…' : 'Check saved result'}</button><button type="button" className="secondary" disabled={work.saving} onClick={() => void resolve('retry')}>Send the same request again</button></div>
  </div>;
}

type Eligibility = { allowed: true } | { allowed: false; reason: string; next: string };
export function cancelEligibility(state: LiveCompanyBookingState): Eligibility {
  const booking = state.booking;
  if (!booking) return { allowed: false, reason: 'This booking is not confirmed.', next: 'Unconfirmed drafts are changed by saving a new draft.' };
  if (booking.confirmationBasis !== 'signed_request') return { allowed: false, reason: 'This booking was confirmed with the earlier company proposal process. Cancelling it in the workspace is not available.', next: 'Keep the booking as it is and ask the company owner how it should be handled.' };
  if (booking.status === 'confirming') return { allowed: false, reason: 'Confirmation is still processing.', next: 'Cancellation becomes available after both Google Calendar visits are verified and the confirmation email is accepted. Refresh the status, or retry pending booking processing if it stops.' };
  if (booking.status === 'review_required') return { allowed: false, reason: 'Company calendar review is required first.', next: 'Recheck the confirmed Google visits. Cancellation can start only after the booking is confirmed again.' };
  if (booking.status !== 'confirmed') return { allowed: false, reason: 'Cancellation has already started.', next: 'Follow its progress below.' };
  if (booking.emailStatus !== 'provider_accepted') return { allowed: false, reason: `The confirmation email result is not confirmed yet (${booking.emailStatus.replaceAll('_', ' ')}).`, next: 'Retry pending booking processing first. Cancellation becomes available once the email provider accepts the confirmation.' };
  if (booking.events.length < 2 || booking.events.some(event => !event.verifiedAt)) return { allowed: false, reason: 'Not every Google Calendar visit is verified.', next: 'Recheck the confirmed Google visits first.' };
  return { allowed: true };
}

const progressNames: Record<CancellationState['status'], string> = {
  pending: 'Cancellation accepted · waiting to delete the Google Calendar events',
  processing: 'Deleting the Google Calendar events',
  retrying: 'Calendar deletion not confirmed yet · retrying',
  review_required: 'Company review required · automatic deletion stopped',
  cancelled: 'Booking cancelled',
};
const reviewReasons: Record<string, string> = {
  calendar_target_changed: 'The connected company Google Calendar changed after cancellation started.',
  calendar_changed: 'A company Google Calendar event for this booking was changed outside the workspace.',
  calendar_outcome_unknown: 'Google Calendar did not confirm the deletion.',
};

export function BookingCancellation({ state, work, onChanged, onRefresh, refreshing }: { state: LiveCompanyBookingState; work: SimpleBookingWork; onChanged: () => void; onRefresh: () => void; refreshing: boolean }) {
  const [cancelKey, setCancelKey] = useWorkspaceDraft<string | null>(`live-booking.${state.requestId}.cancel-key`, null);
  const [open, setOpen] = useState(false), [command, setCommand] = useState<WorkCommand | null>(null), [message, setMessage] = useState<{ tone: 'notice' | 'error'; text: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const booking = state.booking, cancellation = state.cancellation ?? null;
  const writable = state.canWrite !== false;
  function finish(form: WorkCommand, next: WorkState) {
    if (next.phase === 'access_lost') { setCancelKey(null); return; }
    if (next.phase === 'unknown') { setCommand(form); setOpen(false); return; }
    setCommand(null);
    if (next.phase === 'saved') {
      if (form === 'cancel' && next.receipt) setCancelKey(next.receipt.idempotencyKey);
      setOpen(false);
      setMessage({ tone: 'notice', text: form === 'cancel' ? 'Cancellation accepted. The Google Calendar events are being deleted. Both visits stay held until each deletion is verified.' : 'Cancellation continued with the original request. Refresh to follow its progress.' });
      onChanged(); return;
    }
    if (next.phase === 'conflict') {
      setOpen(false);
      const text = next.code === 'booking_busy' ? 'Booking processing is still running, for example the confirmation email or calendar check. Wait for it to finish, refresh, then try again.'
        : next.code === 'cancellation_started' ? 'Cancellation has already started for this booking. The latest status is shown.'
        : next.code === 'state_conflict' ? 'This booking can’t be cancelled in its current state. The latest status is shown.'
        : next.code === 'idempotency_conflict' ? 'This request did not match its original attempt, so nothing was saved. Review the latest status before trying again.'
        : 'The booking changed while you were reviewing it. Review the latest status, then cancel again if it is still needed.';
      setMessage({ tone: 'error', text }); onChanged(); requestAnimationFrame(() => trigger.current?.focus()); return;
    }
    if (next.phase === 'error' && form !== 'cancel') setMessage({ tone: 'error', text: `${next.error ?? 'The cancellation could not be continued.'} Nothing was changed. Continuing again sends the same original request.` });
  }

  if (!booking) return null;
  const started = Boolean(cancellation) || booking.status === 'cancel_pending' || booking.status === 'cancelled';
  const recovery = work.uncertain && command ? <WorkRecovery work={work} command={command} message="" onResolved={next => finish(command, next)} /> : null;
  const notice = message && <p className={message.tone === 'error' ? 'live-company-error' : 'live-company-notice'} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>;

  if (started) {
    const status = cancellation?.status ?? (booking.status === 'cancelled' ? 'cancelled' : 'pending');
    const held = cancellation ? cancellation.occupancyHeld : booking.occupancyHeld !== false;
    return <section className="live-company-cancellation" aria-labelledby={`cancel-${state.requestId}-title`}>
      <h4 id={`cancel-${state.requestId}-title`}>Booking cancellation</h4>
      <dl className="live-company-details">
        <div><dt>Status</dt><dd>{progressNames[status]}</dd></div>
        <div><dt>Visit periods</dt><dd>{held ? 'Both visits stay held until every Google Calendar deletion is verified' : 'Released for other bookings'}</dd></div>
        {cancellation && <div><dt>Google Calendar</dt><dd>{cancellation.verifiedDeletedEvents} of {cancellation.totalEvents} event deletions verified</dd></div>}
        {cancellation && <div><dt>Requested</dt><dd>{companyTime(cancellation.requestedAt)} (Sydney)</dd></div>}
        {cancellation?.cancelledAt && <div><dt>Cancelled</dt><dd>{companyTime(cancellation.cancelledAt)} (Sydney)</dd></div>}
        <div><dt>Customer notice</dt><dd>Not sent automatically. Contact the customer separately.</dd></div>
      </dl>
      {status === 'retrying' && <p className="live-company-notice">{reviewReasons[cancellation?.errorCode ?? ''] ?? 'The deletion result is incomplete or unknown.'} Both visits stay held. {cancelKey ? 'Continue the original cancellation, or refresh to see whether the background retry finished.' : 'It retries automatically in the background. It was started in another session, so it can only be continued from there.'}</p>}
      {status === 'review_required' && <p className="live-company-notice">{reviewReasons[cancellation?.errorCode ?? ''] ?? 'The Google Calendar events no longer match this booking.'} No further event is deleted automatically and both visits stay held. Review the company Google Calendar; resolving this is not available in the workspace yet.</p>}
      {status !== 'cancelled' && cancellation && cancellation.verifiedDeletedEvents > 0 && <p className="live-company-notice">One verified deletion does not release a visit. Both visits are released together only after the final check.</p>}
      {status === 'cancelled' && <p className="live-company-notice">Both Google Calendar events were verified as deleted and the visit periods were released. The signed request, estimate and original confirmation document are kept. Restoring or rescheduling a cancelled booking is not available.</p>}
      {notice}{recovery}
      <div className="live-company-actions">
        {status !== 'cancelled' && <button type="button" className="secondary" disabled={refreshing || work.saving} onClick={onRefresh}>{refreshing ? 'Refreshing cancellation status…' : 'Refresh cancellation status'}</button>}
        {status === 'retrying' && cancelKey && writable && <button type="button" disabled={work.locked} onClick={async () => { if (!work.actions) return; setMessage(null); setCommand('continue'); finish('continue', await work.run(() => work.actions!.retryCancellation(cancelKey))); }}>{work.saving && command === 'continue' ? 'Continuing cancellation…' : 'Continue cancellation'}</button>}
      </div>
    </section>;
  }

  const eligibility = cancelEligibility(state);
  return <section className="live-company-cancellation" aria-labelledby={`cancel-${state.requestId}-title`}>
    <h4 id={`cancel-${state.requestId}-title`}>Cancel this booking</h4>
    {eligibility.allowed ? <p>Cancelling deletes both company Google Calendar visits and then releases their periods. The customer is not notified automatically.</p> : <div className="live-company-notice"><p><strong>Cancellation is not available yet.</strong> {eligibility.reason}</p><p>{eligibility.next}</p></div>}
    {notice}{recovery}
    {eligibility.allowed && writable && <div className="live-company-actions"><button type="button" ref={trigger} className="secondary" disabled={work.locked} onClick={() => { setMessage(null); setOpen(true); }}>Cancel booking…</button></div>}
    {open && <CancelBookingDialog state={state} work={work} onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }} onSubmit={async reason => {
      if (!work.actions) return;
      setCommand('cancel');
      finish('cancel', await work.run(() => work.actions!.cancel({ expectedRevision: state.revision, reason })));
    }} />}
  </section>;
}

function CancelBookingDialog({ state, work, onClose, onSubmit }: { state: LiveCompanyBookingState; work: SimpleBookingWork; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), form = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState(''), [acknowledged, setAcknowledged] = useState(false), [submitted, setSubmitted] = useState(false);
  const busy = work.saving, failed = submitted && work.state.phase === 'error', error = failed ? work.state.error ?? 'The cancellation was not sent.' : null, errorHint = work.state.fields ? 'Nothing was cancelled. Correct the highlighted field, then cancel again.' : 'Nothing was cancelled. Cancelling again sends a new request.';
  const reasonError = failed ? work.state.fields?.reason : undefined, reasonId = `cancel-dialog-${state.requestId}-reason`;
  useEffect(() => { const element = dialog.current; element?.showModal(); heading.current?.focus(); return () => element?.close(); }, []);
  const contact = state.submission.snapshot.payload.contact, visits = state.proposal?.segments ?? [];
  return <dialog ref={dialog} className="ems-dialog live-company-cancel-dialog" aria-labelledby={`cancel-dialog-${state.requestId}`} aria-describedby={`cancel-dialog-${state.requestId}-effects`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form ref={form} aria-busy={busy} onSubmit={event => { event.preventDefault(); if (busy || !acknowledged || !reportSectionValidity(form.current)) return; setSubmitted(true); void onSubmit(reason.trim()); }}>
      <h2 id={`cancel-dialog-${state.requestId}`} ref={heading} tabIndex={-1}>Cancel this confirmed booking?</h2>
      <p>{contact.name} · {state.submission.reference}</p>
      <ul>{visits.map((visit, index) => <li key={`${visit.startAt}:${index}`}><strong>{visit.purpose === 'install' ? 'Installation' : visit.purpose === 'take_off' ? 'Take-off' : `Visit ${index + 1}`}: </strong>{companySegmentLabel(visit)}</li>)}</ul>
      <div id={`cancel-dialog-${state.requestId}-effects`}>
        <p><strong>What happens</strong></p>
        <ul>
          <li>Both company Google Calendar events for these visits are deleted.</li>
          <li>Both visit periods stay held until each deletion is verified, then they are released together.</li>
          <li>The customer is <strong>not</strong> notified automatically. Contact them separately.</li>
          <li>The signed request, estimate and confirmation document are kept. A cancelled booking can’t be restored or rescheduled here.</li>
          <li>No refund, fee or contract change is recorded.</li>
        </ul>
      </div>
      <div className="live-company-field"><label htmlFor={`cancel-dialog-${state.requestId}-reason`}>Reason for cancelling (staff only, not shown to the customer)</label><ValidatedInput id={`cancel-dialog-${state.requestId}-reason`} validation="text" validationLabel="the reason for cancelling" required maxLength={500} autoComplete="off" value={reason} disabled={busy} aria-invalid={Boolean(reasonError) || undefined} aria-describedby={reasonError ? `${reasonId}-error` : undefined} onChange={event => setReason(event.target.value)} />{reasonError && <small id={`${reasonId}-error`} className="live-company-field-error">{reasonError}</small>}</div>
      <label className="live-company-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /> I understand the Google Calendar events will be deleted and the customer will not be told automatically.</label>
      {error && <p className="live-company-error" role="alert"><span>{error}</span> <span>{errorHint}</span></p>}
      <p className="sr-only" role="status" aria-live="polite">{busy ? 'Sending the cancellation request…' : ''}</p>
      <div className="live-company-actions"><button type="submit" disabled={busy || !acknowledged || !reason.trim()}>{busy ? 'Sending cancellation…' : 'Cancel booking'}</button><button type="button" className="secondary" disabled={busy} onClick={onClose}>Keep booking</button></div>
    </form>
  </dialog>;
}
