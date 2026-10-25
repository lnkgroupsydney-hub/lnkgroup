'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useUnsavedChanges } from '@/shared/ui/admin-workspace-state';
import { AdminStatusBadge } from '@/shared/ui/admin';
import { MAX_EXTRA_ITEM_CENTS_TECHNICAL, MAX_EXTRA_ITEMS_TECHNICAL, calculateCompanyRevisionPricing, type CompanyRevision, type CompanyRevisionPayload, type CompanyRevisionState } from '../domain/company-revision';
import { NO_GST_NOTICE } from '../domain/pricing-display.ts';
import { CurrentWorkClient, companyRevisionActions, parseCompanyRevisionState } from './company-revision-client';
import { RevisionComparison, RevisionNotes, revisionDelta, revisionEmailLabel, revisionMoney, revisionReceiptLabel, revisionStatusLabels, revisionStatusTone } from './company-revision-parts';
import { displayTime } from './request-client';

type WorkState = ReturnType<CurrentWorkClient<CompanyRevisionState>['snapshot']>;
type Contact = CompanyRevisionPayload['contact'];
type Extra = { id: string; description: string; amount: string; reason: string };
type Form = { contact: Contact; doorCount: string; drawerCount: string; moderateRepair: boolean; extraItems: Extra[]; customerNote: string };
type Command = 'save' | 'publish' | 'withdraw';
type Conflict = { message: string; attempted: Form; attemptedRevision: number; latest: CompanyRevisionState | null };
type Errors = Record<string, string>;

const contactFields: { key: keyof Contact; label: string; max: number; type?: string }[] = [
  { key: 'name', label: 'Contact name', max: 120 }, { key: 'email', label: 'Contact email', max: 254, type: 'email' }, { key: 'phone', label: 'Phone (optional)', max: 40, type: 'tel' },
  { key: 'siteAddress', label: 'Site address', max: 240 }, { key: 'suburb', label: 'Suburb', max: 100 }, { key: 'postcode', label: 'Postcode', max: 4 },
];
const pathLabels: Record<string, string> = {
  ...Object.fromEntries(contactFields.map(field => [`payload.contact.${field.key}`, field.label])), 'payload.contact.details': 'Project details',
  'payload.quantities.doorCount': 'Cabinet doors', 'payload.quantities.drawerCount': 'Drawer fronts', 'payload.quantities.moderateRepair': 'Moderate coating repair',
  'payload.extraItems': 'Additional items', 'payload.customerNote': 'Note to the customer', reason: 'Reason for this change', revisionId: 'Revised quote version', expectedRevision: 'Revised quote revision',
};
function labelFor(path: string) {
  const extra = path.match(/^payload\.extraItems\.(\d+)(?:\.(\w+))?$/);
  if (!extra) return pathLabels[path] ?? path;
  const part = ({ description: 'description', amountCents: 'amount', reason: 'reason', id: 'identifier' } as Record<string, string>)[extra[2] ?? ''];
  return `Additional item ${Number(extra[1]) + 1}${part ? ` · ${part}` : ''}`;
}
const eligibilityText: Record<string, string> = {
  booking_confirmed: 'The booking is already confirmed, so this quote can no longer be revised here. Changes to a confirmed booking are handled separately.',
  cancellation_started: 'Cancellation has started for this booking, so this quote can no longer be revised.',
  revision_not_eligible: 'A revised quote can be prepared only after the customer has signed and submitted their booking request, and before the booking is confirmed.',
};
const auditLabels: Record<string, string> = { revision_save: 'Draft saved', revision_publish: 'Sent to customer', revision_withdraw: 'Withdrawn', customer_accept: 'Accepted by customer' };

const dollars = (cents: number) => (cents / 100).toFixed(2);
function formFrom(payload: CompanyRevisionPayload): Form {
  const q = payload.quantities;
  return { contact: { ...payload.contact }, doorCount: String(q.doorCount), drawerCount: String(q.drawerCount), moderateRepair: q.moderateRepair, extraItems: payload.extraItems.map(item => ({ id: item.id, description: item.description, amount: dollars(item.amountCents), reason: item.reason })), customerNote: payload.customerNote };
}
const basePayload = (state: CompanyRevisionState) => state.current?.status === 'draft' ? state.current.payload : state.initialPayload ?? null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function count(value: string): number | null { const text = value.trim(); return /^\d{1,3}$/.test(text) && Number(text) <= 500 ? Number(text) : null; }
function cents(value: string): number | null {
  const text = value.trim().replace(/^\$|^A\$/i, '').replaceAll(',', '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return result >= 1 && result <= MAX_EXTRA_ITEM_CENTS_TECHNICAL ? result : null;
}
/** Local checks only catch typing slips; the server validates every field again and calculates every amount. */
function payloadFrom(form: Form): { payload: CompanyRevisionPayload | null; errors: Errors } {
  const errors: Errors = {}, doorCount = count(form.doorCount), drawerCount = count(form.drawerCount);
  if (doorCount === null) errors['payload.quantities.doorCount'] = 'Enter a whole number from 0 to 500.';
  if (drawerCount === null) errors['payload.quantities.drawerCount'] = 'Enter a whole number from 0 to 500.';
  if (doorCount === 0 && drawerCount === 0) errors['payload.quantities.doorCount'] = 'At least one door or drawer front is required.';
  const extraItems = form.extraItems.map((item, index) => {
    const amountCents = cents(item.amount);
    if (!item.description.trim()) errors[`payload.extraItems.${index}.description`] = 'Describe the item for the customer.';
    if (amountCents === null) errors[`payload.extraItems.${index}.amountCents`] = `Enter a positive amount in dollars and cents, up to ${revisionMoney(MAX_EXTRA_ITEM_CENTS_TECHNICAL)}.`;
    if (!item.reason.trim()) errors[`payload.extraItems.${index}.reason`] = 'Explain why the item is needed.';
    return { id: item.id, description: item.description, amountCents: amountCents ?? 0, reason: item.reason };
  });
  if (Object.keys(errors).length) return { payload: null, errors };
  return { payload: { contact: { ...form.contact }, quantities: { doorCount: doorCount!, drawerCount: drawerCount!, moderateRepair: form.moderateRepair }, extraItems, customerNote: form.customerNote }, errors };
}
function changedFields(a: Form, b: Form) {
  const out: string[] = [];
  for (const field of [...contactFields.map(field => field.key), 'details' as const]) if (a.contact[field] !== b.contact[field]) out.push(pathLabels[`payload.contact.${field}`]);
  if (a.doorCount !== b.doorCount) out.push('Cabinet doors'); if (a.drawerCount !== b.drawerCount) out.push('Drawer fronts'); if (a.moderateRepair !== b.moderateRepair) out.push('Moderate coating repair');
  if (!same(a.extraItems, b.extraItems)) out.push('Additional items'); if (a.customerNote !== b.customerNote) out.push('Note to the customer');
  return out;
}
const commandOf = (path?: string): Command => path?.endsWith('/publish') ? 'publish' : path?.endsWith('/withdraw') ? 'withdraw' : 'save';
const commandWords: Record<Command, string> = { save: 'draft save', publish: 'send to customer', withdraw: 'withdrawal' };

export type CompanyRevisionGate = { status: 'checking' | 'unavailable' | 'none' | 'draft' | 'awaiting' | 'accepted'; versionNo?: number; totalCents?: number; publishedAt?: string | null; acceptedVersionNo?: number; acceptedTotalCents?: number; onOpen?: () => void; onRefresh?: () => void };
/** Read-only revision status for the booking confirmation screen. The server still blocks confirmation on its own. */
export function useCompanyRevisionGate(requestId: string, active: boolean, onAccessLost: () => void, onOpen?: () => void): CompanyRevisionGate {
  const [client] = useState(() => new CurrentWorkClient(parseCompanyRevisionState));
  const [actions] = useState(() => companyRevisionActions(client, requestId));
  const [work, setWork] = useState<WorkState>(() => client.snapshot()), alive = useRef(false), access = useRef(onAccessLost);
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);
  const refresh = useCallback(async () => { const snapshot = await actions.detail(); if (!alive.current) return; setWork(snapshot); if (snapshot.phase === 'access_lost') { client.clear(); access.current(); } }, [actions, client]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.clear(); }; }, [client]);
  useEffect(() => { if (!active) return; let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void refresh(); }); return () => { cancelled = true; }; }, [active, refresh]);
  const data = work.data, current = data?.current ?? null, accepted = data?.effectiveAccepted ?? null;
  const base = { onOpen, onRefresh: () => void refresh(), acceptedVersionNo: accepted?.versionNo, acceptedTotalCents: accepted?.totalCents };
  if (!data) return { ...base, status: work.phase === 'error' ? 'unavailable' : 'checking' };
  if (current?.status === 'published') return { ...base, status: 'awaiting', versionNo: current.versionNo, totalCents: current.totalCents, publishedAt: current.publishedAt };
  if (current?.status === 'draft') return { ...base, status: 'draft', versionNo: current.versionNo, totalCents: current.totalCents };
  return { ...base, status: accepted ? 'accepted' : 'none' };
}

function RevisionDialog({ title, children, confirmLabel, cancelLabel, busy, error, reasonError, requireCheck, onSubmit, onClose }: { title: string; children: ReactNode; confirmLabel: string; cancelLabel: string; busy: boolean; error: string; reasonError?: string; requireCheck?: string; onSubmit: (reason: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), id = `cr-dialog${useId().replaceAll(':', '')}`;
  const [reason, setReason] = useState(''), [checked, setChecked] = useState(!requireCheck);
  useEffect(() => { const element = dialog.current; element?.showModal(); heading.current?.focus(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="ems-dialog cr-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-effects`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form aria-busy={busy} noValidate onSubmit={event => { event.preventDefault(); if (busy || !checked || !reason.trim()) return; onSubmit(reason.trim()); }}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{title}</h2>
      <div id={`${id}-effects`}>{children}</div>
      <div className="ems-field"><label htmlFor={`${id}-reason`}>Reason (staff only, recorded in the history)</label><input id={`${id}-reason`} maxLength={500} autoComplete="off" required value={reason} disabled={busy} aria-invalid={Boolean(reasonError) || undefined} aria-describedby={reasonError ? `${id}-reason-error` : undefined} onChange={event => setReason(event.target.value)} />{reasonError && <small id={`${id}-reason-error`} className="cr-field-error">{reasonError}</small>}</div>
      {requireCheck && <label className="cr-check"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />{requireCheck}</label>}
      {error && <p className="ems-feedback ems-feedback--error" role="alert">{error}</p>}
      <p className="sr-only" role="status" aria-live="polite">{busy ? 'Sending the request…' : ''}</p>
      <div className="admin-dialog-actions"><button type="submit" disabled={busy || !checked || !reason.trim()}>{busy ? 'Sending…' : confirmLabel}</button><button type="button" disabled={busy} onClick={onClose}>{cancelLabel}</button></div>
    </form>
  </dialog>;
}

function VersionSummary({ revision, requestId, original = false }: { revision: CompanyRevision; requestId: string; original?: boolean }) {
  return <>
    <div className="cr-version-head"><strong>Version {revision.versionNo}</strong><AdminStatusBadge tone={revisionStatusTone[revision.status]}>{revisionStatusLabels[revision.status]}</AdminStatusBadge></div>
    <p><strong>{revisionMoney(revision.totalCents)}</strong> · {NO_GST_NOTICE.split('.')[0]} · {revisionDelta(revision.comparison.deltaCents)} vs original signed request</p>
    <p className="ems-list-meta">{[revision.publishedAt && `Sent ${displayTime(revision.publishedAt)}`, revision.acceptedAt && `Accepted ${displayTime(revision.acceptedAt)}`, revision.withdrawnAt && `Withdrawn ${displayTime(revision.withdrawnAt)}`].filter(Boolean).join(' · ') || 'Not sent'}{revision.publishedAt || revision.acceptedAt || revision.withdrawnAt ? ' (Sydney)' : ''}</p>
    <p className="ems-list-meta">{revisionEmailLabel(revision)} · {revisionReceiptLabel(revision)}</p>
    {revision.acceptance && <p className="ems-list-meta">Signed by {String((revision.acceptance.signature as { name?: unknown } | undefined)?.name ?? 'the customer')} with a new signature.</p>}
    {!original && <details><summary>Show what changed in version {revision.versionNo}</summary><RevisionComparison comparison={revision.comparison} idPrefix={`cr-${requestId}-v${revision.versionNo}`} level={5} /><RevisionNotes revision={revision} level={6} /></details>}
  </>;
}

/** Company revised quote for a signed booking request. Amounts are always calculated by the server. */
export function CompanyRevisionPanel({ requestId, active, onAccessLost, onOpenBooking }: { requestId: string; active: boolean; onAccessLost: () => void; onOpenBooking?: () => void }) {
  const [client] = useState(() => new CurrentWorkClient(parseCompanyRevisionState));
  const [actions] = useState(() => companyRevisionActions(client, requestId));
  const [work, setWork] = useState<WorkState>(() => client.snapshot());
  const [form, setForm] = useState<Form | null>(null), [baseline, setBaseline] = useState<Form | null>(null), [baseRevision, setBaseRevision] = useState(0), [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({}), [failure, setFailure] = useState(''), [conflict, setConflict] = useState<Conflict | null>(null), [notice, setNotice] = useState(''), [loaded, setLoaded] = useState(false), [accessEnded, setAccessEnded] = useState(false);
  const [dialog, setDialog] = useState<null | 'publish' | 'withdraw'>(null), [dialogError, setDialogError] = useState(''), [dialogReasonError, setDialogReasonError] = useState('');
  const alive = useRef(false), ended = useRef(false), access = useRef(onAccessLost);
  const stateHeading = useRef<HTMLHeadingElement>(null), noticeRef = useRef<HTMLParagraphElement>(null), failureRef = useRef<HTMLDivElement>(null), publishTrigger = useRef<HTMLButtonElement>(null), withdrawTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);
  const focusSoon = (target: { current: HTMLElement | null }) => requestAnimationFrame(() => target.current?.focus());
  // Conditionally rendered targets (conflict, unknown, error, new item) are focused after React commits them.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => { const target = pendingFocus.current, element = target ? document.getElementById(target) : null; if (element) { element.focus(); pendingFocus.current = null; } });
  const focusAfterRender = (name: string) => { pendingFocus.current = `cr-${requestId}-${name}`; };

  const apply = useCallback((snapshot: WorkState) => {
    if (!alive.current || ended.current) return false;
    if (snapshot.phase === 'access_lost') {
      ended.current = true; client.clear(); setAccessEnded(true); setWork(client.snapshot());
      setForm(null); setBaseline(null); setReason(''); setConflict(null); setNotice(''); setErrors({}); setFailure(''); setDialog(null);
      access.current(); return false;
    }
    setWork(snapshot); return true;
  }, [client]);
  const load = useCallback(async (resetForm: boolean) => {
    const read = actions.detail(); setWork(client.snapshot());
    const snapshot = await read;
    if (!apply(snapshot) || snapshot.phase !== 'idle' || !snapshot.data) return null;
    const latest = snapshot.data;
    setConflict(current => current ? { ...current, latest } : current); setLoaded(true);
    if (resetForm) { const payload = basePayload(latest), next = payload ? formFrom(payload) : null; setForm(next); setBaseline(next); setBaseRevision(latest.revision); setReason(''); }
    return latest;
  }, [actions, apply, client]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.clear(); }; }, [client]);
  useEffect(() => {
    if (!active || loaded || ended.current) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(true); });
    return () => { cancelled = true; };
  }, [active, loaded, load]);

  const phase = work.phase, data = work.data, pending = client.pendingRequest();
  const busy = phase === 'saving' || phase === 'loading', locked = busy || phase === 'unknown' || Boolean(pending);
  const current = data?.current ?? null, accepted = data?.effectiveAccepted ?? null;
  const editable = Boolean(data?.eligible && data.canWrite && current?.status !== 'published');
  const dirty = Boolean(form && baseline && (!same(form, baseline) || reason.trim())) || phase === 'saving' || phase === 'unknown' || Boolean(conflict);
  const discard = useCallback(() => { if (client.pendingRequest()) return; setForm(baseline); setReason(''); setConflict(null); setErrors({}); setFailure(''); }, [client, baseline]);
  useUnsavedChanges(`company-revision:${requestId}`, { dirty, busy: phase === 'saving' || phase === 'unknown', onDiscard: discard });

  async function afterCommand(command: Command, snapshot: WorkState, attempted: Form | null, attemptedRevision: number) {
    if (!apply(snapshot)) return;
    if (snapshot.phase === 'saved') {
      const version = (await load(true))?.current?.versionNo;
      setDialog(null); setErrors({}); setFailure(''); setConflict(null);
      // Short confirmation only; the status card below carries the details.
      setNotice(command === 'publish' ? `Version ${version ?? ''} sent.` : command === 'withdraw' ? `Version ${version ?? ''} withdrawn. No withdrawal email is sent to the customer.` : `Draft version ${version ?? ''} saved. Nothing was sent to the customer.`);
      focusSoon(noticeRef);
      return;
    }
    if (snapshot.phase === 'conflict') {
      setDialog(null);
      const code = snapshot.code ?? '';
      if (command === 'save' && attempted && ['revision_conflict', 'idempotency_conflict'].includes(code)) { setConflict({ message: snapshot.error ?? 'The revised quote changed after you opened it.', attempted, attemptedRevision, latest: null }); focusAfterRender('state'); await load(false); return; }
      setFailure(['revision_not_eligible', 'booking_confirmed', 'cancellation_started'].includes(code) ? `${eligibilityText[code] ?? snapshot.error ?? ''} Nothing was changed. The latest status is shown.` : `${snapshot.error ?? 'The revised quote changed.'} Nothing was changed. The latest status is shown below; review it before trying again.`);
      focusAfterRender('failure'); await load(!attempted || command !== 'save'); return;
    }
    if (snapshot.phase === 'error') {
      const fields = (snapshot.fields ?? {}) as Errors;
      if (command !== 'save' && fields.reason) { setDialogReasonError(fields.reason); setDialogError(`${snapshot.error ?? 'The request was not sent.'} Nothing was changed.`); return; }
      setDialog(null); setErrors(fields);
      setFailure(`${snapshot.error ?? 'The request could not be completed.'} Nothing was ${command === 'save' ? 'saved' : 'changed'}.${Object.keys(fields).length ? ` Correct the highlighted fields${command === 'publish' ? ', save the draft, then send it again' : ' and save again'}.` : ' Trying again sends a new request.'}`);
      focusAfterRender('failure'); return;
    }
    if (snapshot.phase === 'unknown') { setDialog(null); focusAfterRender('state'); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || locked || conflict || !editable) return;
    const { payload, errors: local } = payloadFrom(form);
    if (!payload) { setErrors(local); setFailure('Check the highlighted fields. Nothing was saved.'); focusAfterRender('failure'); return; }
    if (!reason.trim()) { setErrors({ reason: 'Enter a reason for this change.' }); setFailure('Enter a reason for this change. Nothing was saved.'); focusAfterRender('failure'); return; }
    setErrors({}); setFailure(''); setNotice('');
    const attempted = structuredClone(form), call = actions.save({ expectedRevision: baseRevision, reason: reason.trim(), payload });
    setWork(client.snapshot());
    await afterCommand('save', await call, attempted, baseRevision);
  }
  async function send(command: 'publish' | 'withdraw', commandReason: string) {
    if (!data || !current || locked) return;
    setDialogError(''); setDialogReasonError(''); setNotice(''); setFailure('');
    const call = actions[command]({ revisionId: current.id, expectedRevision: data.revision, reason: commandReason });
    setWork(client.snapshot());
    await afterCommand(command, await call, null, data.revision);
  }
  async function resolvePending(kind: 'check' | 'retry') {
    const request = client.pendingRequest(); if (!request) return;
    const command = commandOf(request.path), call = kind === 'check' ? actions.check() : actions.retry();
    setWork(client.snapshot());
    const snapshot = await call;
    if (kind === 'check' && snapshot.phase === 'unknown') setNotice('No saved result was found yet. Retry the same request, or check again shortly.');
    await afterCommand(command, snapshot, command === 'save' ? form : null, Number(request.body.expectedRevision));
  }
  function keepMine() {
    const latest = conflict?.latest; if (!latest || locked || latest.current?.status === 'published') return;
    const payload = basePayload(latest);
    setBaseRevision(latest.revision); setBaseline(payload ? formFrom(payload) : null); setConflict(null);
    setNotice(`Your changes are now based on the latest revised quote (revision ${latest.revision}). Review them and save again; this sends a new save request.`); focusSoon(noticeRef);
  }
  async function loadLatest() { if (!conflict?.latest || locked) return; if (await load(true)) { setConflict(null); setNotice(''); } }

  if (accessEnded || phase === 'access_lost') return <section className="ems-panel" aria-label="Revised quote"><p className="ems-feedback" role="alert">Company access ended. Sign in again to work on revised quotes.</p></section>;
  const fid = (name: string) => `cr-${requestId}-${name}`;
  const errorFor = (path: string) => errors[path];
  const invalid = (path: string, name: string, extra = '') => { const describedBy = [errorFor(path) ? `${fid(name)}-error` : '', extra].filter(Boolean).join(' '); return { 'aria-invalid': errorFor(path) ? true : undefined, 'aria-describedby': describedBy || undefined }; };
  const fieldMessage = (path: string, name: string) => errorFor(path) ? <small id={`${fid(name)}-error`} className="cr-field-error">{errorFor(path)}</small> : null;
  // Source issues describe the customer's original request; a draft based on an accepted version already passed every rule.
  const startsFromOriginal = !(current?.status === 'draft' ? current.basedOnRevisionId : accepted), sourceIssues = startsFromOriginal ? data?.sourceIssues ?? [] : [];
  const sourceIssue = (key: keyof Contact) => { const issue = sourceIssues.find(item => item.field === `payload.contact.${key}`); return issue && form && data?.initialPayload && form.contact[key] === data.initialPayload.contact[key] ? issue : undefined; };
  const sourceNote = (key: keyof Contact) => { const issue = sourceIssue(key); return issue ? <small id={`${fid(key)}-source`} className="cr-source-note">Customer’s original value: {issue.message} Correct it before sending.</small> : null; };
  const update = (patch: Partial<Form>) => setForm(previous => previous ? { ...previous, ...patch } : previous);
  const updateExtra = (index: number, patch: Partial<Extra>) => setForm(previous => previous ? { ...previous, extraItems: previous.extraItems.map((item, i) => i === index ? { ...item, ...patch } : item) } : previous);
  const local = form ? payloadFrom(form).payload : null, preview = local ? calculateCompanyRevisionPricing(local) : null;
  const draftSaved = current?.status === 'draft', formChanged = Boolean(form && baseline && !same(form, baseline));
  const latestForm = conflict?.latest && basePayload(conflict.latest) ? formFrom(basePayload(conflict.latest)!) : null;
  const history = [...(data?.revisions ?? [])].sort((a, b) => b.versionNo - a.versionNo);
  const originalTotal = (current ?? history[0])?.comparison.original.totalCents ?? null;
  const audit = (data?.audit ?? []) as { id: string; action: string; reason: string; priorRevision: number; newRevision: number; createdAt: string }[];

  return <div className="cr-panel">
    {phase === 'loading' && !data && <p role="status">Loading the revised quote…</p>}
    {phase === 'error' && !data && <div className="ems-feedback ems-feedback--error" role="alert"><p>{work.error ?? 'The revised quote could not be loaded.'} A revised quote can be prepared only after the customer has signed and submitted their booking request.</p><button type="button" className="ems-button ems-button--secondary" onClick={() => void load(true)}>Retry loading the revised quote</button></div>}

    {data && <section className="ems-panel" aria-labelledby={fid('status')}>
      <div className="ems-actions"><h3 id={fid('status')}>Revised quote</h3>{current ? <AdminStatusBadge tone={revisionStatusTone[current.status]}>Version {current.versionNo} · {revisionStatusLabels[current.status]}</AdminStatusBadge> : <AdminStatusBadge>No revised quote yet</AdminStatusBadge>}</div>
      <p>Prepare a revised quote when the cabinet count, repairs or extra work differ from what the customer signed. The customer has to sign in, review the changes and sign again to accept. Their original signed request, signature, PDF and photos stay unchanged. This is not a contract, work authorisation or invoice.</p>
      <dl className="cr-in-effect"><dt>Amount in effect:</dt><dd>{accepted ? <><strong>{revisionMoney(accepted.totalCents)}</strong> · accepted revised quote version {accepted.versionNo}{accepted.acceptedAt && <span className="ems-list-meta"> · accepted {displayTime(accepted.acceptedAt)} (Sydney)</span>}</> : originalTotal !== null ? <><strong>{revisionMoney(originalTotal)}</strong> · original signed request</> : <>Original signed request · the signed amount is shown in the Booking tab</>}</dd></dl>
      {!data.eligible && <div className="ems-feedback cr-blocked" role="status"><p><strong>Revising is not available.</strong> {eligibilityText[data.eligibilityCode ?? 'revision_not_eligible'] ?? eligibilityText.revision_not_eligible}</p></div>}
      {data.eligible && !data.canWrite && <p className="ems-feedback">You can view revised quotes but cannot change them.</p>}
      <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" disabled={locked} onClick={() => void load(!dirty)}>Refresh revised quote</button>{onOpenBooking && <button type="button" className="ems-button ems-button--secondary" onClick={onOpenBooking}>Go to booking confirmation</button>}</div>
    </section>}

    <p ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className={notice ? 'ems-feedback' : 'sr-only'}>{notice}</p>
    {failure && <div id={fid('failure')} ref={failureRef} tabIndex={-1} role="alert" className="ems-feedback ems-feedback--error"><p>{failure}</p>{Object.keys(errors).length > 0 && <ul>{Object.entries(errors).map(([path, message]) => <li key={path}>{labelFor(path)}: {message}</li>)}</ul>}</div>}
    {phase === 'error' && data && !failure && <div className="ems-feedback ems-feedback--error" role="alert"><p>{work.error ?? 'The revised quote could not be loaded.'} The details below are the last loaded version.</p></div>}

    {phase === 'unknown' && pending && <div className="ems-feedback ems-feedback--error">
      <h4 id={fid('state')} ref={stateHeading} tabIndex={-1}>Result of the {commandWords[commandOf(pending.path)]} is unknown</h4>
      <p role="alert">The request may or may not have been saved. Check the saved result, or send exactly the same request again. Editing stays blocked until the result is known.</p>
      <p className="ems-list-meta">Waiting request: based on revision {String(pending.body.expectedRevision)} · Reason: {String(pending.body.reason)}</p>
      <div className="ems-actions"><button type="button" className="ems-button" onClick={() => void resolvePending('check')}>Check saved result</button><button type="button" className="ems-button ems-button--secondary" onClick={() => void resolvePending('retry')}>Send the same request again</button></div>
    </div>}
    {/* One live region at a time: the open dialog announces its own progress. */}
    <p role="status" aria-live="polite" className={phase === 'saving' && !dialog ? 'cr-progress' : 'sr-only'}>{phase === 'saving' && !dialog ? 'Sending the request…' : ''}</p>

    {data && current?.status === 'published' && <section className="ems-panel" aria-labelledby={fid('published')}>
      <div className="ems-actions"><h3 id={fid('published')}>Waiting for the customer</h3><AdminStatusBadge tone="warning">Booking confirmation blocked</AdminStatusBadge></div>
      <p>Version {current.versionNo} was sent {current.publishedAt ? `${displayTime(current.publishedAt)} (Sydney)` : ''}. The customer needs to sign in, review it and sign again. Booking confirmation stays blocked until they accept. A sent version can’t be edited: withdraw it to make changes, then prepare a new version.</p>
      <p className="ems-list-meta">{revisionEmailLabel(current)} · {revisionReceiptLabel(current)}</p>
      <RevisionComparison comparison={current.comparison} idPrefix={fid('published')} />
      <RevisionNotes revision={current} />
      {data.canWrite && data.eligible && <div className="ems-actions"><button ref={withdrawTrigger} type="button" className="ems-button ems-button--danger" disabled={locked} onClick={() => { setDialogError(''); setDialogReasonError(''); setDialog('withdraw'); }}>Withdraw version {current.versionNo}…</button></div>}
    </section>}

    {data && form && editable && <section className="ems-panel cr-editor" aria-labelledby={fid('editor')}>
      <div className="ems-actions"><h3 id={fid('editor')}>{draftSaved ? `Draft version ${current!.versionNo}` : `New revised quote${current ? ` · version ${current.versionNo + 1}` : ''}`}</h3><AdminStatusBadge tone="warning">Not sent to the customer</AdminStatusBadge></div>
      <p className="ems-list-meta">{draftSaved ? 'Saving updates this draft. Nothing is sent until you choose Send to customer.' : accepted ? `Starts from accepted version ${accepted.versionNo}. Saving creates a draft; nothing is sent to the customer.` : 'Starts from the customer’s signed request. Saving creates a draft; nothing is sent to the customer.'}</p>
      {sourceIssues.length > 0 && <div className="ems-feedback" role="note"><p><strong>Some of the customer’s original details don’t meet the current input rules.</strong> They are kept as they are in this draft, but every contact field must meet the rules before the revised quote can be sent.</p><ul>{sourceIssues.map(issue => <li key={issue.field}>{labelFor(issue.field)}: {issue.message}</li>)}</ul></div>}

      {conflict && <div className="ems-feedback ems-feedback--error">
        <h4 id={fid('state')} ref={stateHeading} tabIndex={-1}>The revised quote changed</h4>
        <p role="alert">{conflict.message} Your changes were not saved and are still in the form.</p>
        <p>You edited from revision {conflict.attemptedRevision}. {conflict.latest ? `The latest saved revision is ${conflict.latest.revision}${conflict.latest.current ? ` (version ${conflict.latest.current.versionNo}, ${revisionStatusLabels[conflict.latest.current.status].toLowerCase()})` : ''}.` : 'The latest details could not be loaded yet.'}</p>
        {latestForm && <p>Fields where your changes differ from the latest: {changedFields(conflict.attempted, latestForm).join(', ') || 'none'}.</p>}
        {conflict.latest?.current?.status === 'published' && <p>The latest version has already been sent, so it can’t be edited. Load the latest to see it.</p>}
        <div className="ems-actions"><button type="button" className="ems-button" disabled={!conflict.latest || locked || conflict.latest.current?.status === 'published'} onClick={keepMine}>Keep my changes on the latest revision</button><button type="button" className="ems-button ems-button--secondary" disabled={!conflict.latest || locked} onClick={() => void loadLatest()}>Discard my changes and load latest</button></div>
      </div>}

      <form onSubmit={event => void save(event)} aria-busy={phase === 'saving'} noValidate>
        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict)}>
          <legend>Quantities and repair</legend>
          <div className="ems-detail-grid">
            <div className="ems-field"><label htmlFor={fid('doors')}>Cabinet doors</label><input id={fid('doors')} inputMode="numeric" maxLength={3} autoComplete="off" value={form.doorCount} {...invalid('payload.quantities.doorCount', 'doors')} onChange={event => update({ doorCount: event.target.value })} />{fieldMessage('payload.quantities.doorCount', 'doors')}</div>
            <div className="ems-field"><label htmlFor={fid('drawers')}>Drawer fronts</label><input id={fid('drawers')} inputMode="numeric" maxLength={3} autoComplete="off" value={form.drawerCount} {...invalid('payload.quantities.drawerCount', 'drawers')} onChange={event => update({ drawerCount: event.target.value })} />{fieldMessage('payload.quantities.drawerCount', 'drawers')}</div>
          </div>
          <label className="cr-check"><input type="checkbox" checked={form.moderateRepair} {...invalid('payload.quantities.moderateRepair', 'repair')} onChange={event => update({ moderateRepair: event.target.checked })} />Include moderate coating repair (once per project)</label>{fieldMessage('payload.quantities.moderateRepair', 'repair')}
          <p className="ems-list-meta">Painting, minimum charge and repair amounts are set by the current price list and calculated on the server.</p>
        </fieldset>

        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict)}>
          <legend>Additional items</legend>
          <p className="ems-list-meta">For work outside the standard price list. Enter a positive amount and a reason; both are shown to the customer. Discounts are not supported yet.</p>
          {errorFor('payload.extraItems') && <p className="cr-field-error" id={fid('extras-error')}>{errorFor('payload.extraItems')}</p>}
          {form.extraItems.map((item, index) => <fieldset key={item.id} className="cr-item"><legend>Additional item {index + 1}</legend>
            <div className="cr-item-grid">
              <div className="ems-field"><label htmlFor={fid(`extra-${index}-description`)}>Description (shown to the customer)</label><input id={fid(`extra-${index}-description`)} maxLength={500} autoComplete="off" value={item.description} {...invalid(`payload.extraItems.${index}.description`, `extra-${index}-description`)} onChange={event => updateExtra(index, { description: event.target.value })} />{fieldMessage(`payload.extraItems.${index}.description`, `extra-${index}-description`)}</div>
              <div className="ems-field"><label htmlFor={fid(`extra-${index}-amount`)}>Amount (A$)</label><input id={fid(`extra-${index}-amount`)} inputMode="decimal" maxLength={12} autoComplete="off" placeholder="0.00" value={item.amount} {...invalid(`payload.extraItems.${index}.amountCents`, `extra-${index}-amount`)} onChange={event => updateExtra(index, { amount: event.target.value })} />{fieldMessage(`payload.extraItems.${index}.amountCents`, `extra-${index}-amount`)}</div>
            </div>
            <div className="ems-field"><label htmlFor={fid(`extra-${index}-reason`)}>Why it’s needed (shown to the customer)</label><input id={fid(`extra-${index}-reason`)} maxLength={500} autoComplete="off" value={item.reason} {...invalid(`payload.extraItems.${index}.reason`, `extra-${index}-reason`)} onChange={event => updateExtra(index, { reason: event.target.value })} />{fieldMessage(`payload.extraItems.${index}.reason`, `extra-${index}-reason`)}{fieldMessage(`payload.extraItems.${index}`, `extra-${index}`)}</div>
            <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" onClick={() => { update({ extraItems: form.extraItems.filter((_, i) => i !== index) }); setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([path]) => !path.startsWith('payload.extraItems')))); }}>Remove additional item {index + 1}</button></div>
          </fieldset>)}
          <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" disabled={form.extraItems.length >= MAX_EXTRA_ITEMS_TECHNICAL} onClick={() => { update({ extraItems: [...form.extraItems, { id: crypto.randomUUID(), description: '', amount: '', reason: '' }] }); focusAfterRender(`extra-${form.extraItems.length}-description`); }}>Add additional item</button></div>
        </fieldset>

        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict)}>
          <legend>Contact and site</legend>
          <p className="ems-list-meta">Changing the email here does not change who is notified. Notices go to the email address the customer verified when they signed.</p>
          <div className="ems-detail-grid">{contactFields.map(field => <div key={field.key} className="ems-field"><label htmlFor={fid(field.key)}>{field.label}</label><input id={fid(field.key)} type={field.type ?? 'text'} maxLength={field.max} autoComplete="off" value={form.contact[field.key]} {...invalid(`payload.contact.${field.key}`, field.key, sourceIssue(field.key) ? `${fid(field.key)}-source` : '')} onChange={event => update({ contact: { ...form.contact, [field.key]: event.target.value } })} />{sourceNote(field.key)}{fieldMessage(`payload.contact.${field.key}`, field.key)}</div>)}</div>
          <div className="ems-field"><label htmlFor={fid('details')}>Project details (optional)</label><textarea id={fid('details')} maxLength={3000} rows={3} value={form.contact.details} {...invalid('payload.contact.details', 'details', sourceIssue('details') ? `${fid('details')}-source` : '')} onChange={event => update({ contact: { ...form.contact, details: event.target.value } })} />{sourceNote('details')}{fieldMessage('payload.contact.details', 'details')}</div>
        </fieldset>

        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict)}>
          <legend>Message and reason</legend>
          <div className="ems-field"><label htmlFor={fid('note')}>Note to the customer (optional, shown on the revised quote)</label><textarea id={fid('note')} maxLength={3000} rows={4} value={form.customerNote} {...invalid('payload.customerNote', 'note')} onChange={event => update({ customerNote: event.target.value })} />{fieldMessage('payload.customerNote', 'note')}</div>
          <div className="ems-field"><label htmlFor={fid('reason')}>Reason for this change (staff only)</label><input id={fid('reason')} maxLength={500} autoComplete="off" value={reason} {...invalid('reason', 'reason', fid('reason-hint'))} onChange={event => setReason(event.target.value)} /><small id={fid('reason-hint')}>Recorded in the revised quote history. Not shown to the customer.</small>{fieldMessage('reason', 'reason')}</div>
        </fieldset>

        <div className="cr-preview" aria-live="polite">
          <p className="ems-list-meta"><strong>{formChanged || !draftSaved ? 'Preview · not saved' : 'Saved draft amount (calculated by the server)'}</strong></p>
          {formChanged || !draftSaved ? (preview ? <><p className="cr-preview-total">{revisionMoney(preview.total)}</p><p className="ems-list-meta">Local preview from the current price list. The server recalculates every amount when you save.</p></> : <p>Complete the quantities and additional items to see a preview.</p>) : <><p className="cr-preview-total">{revisionMoney(current!.pricing.total)}</p><p className="ems-list-meta">{NO_GST_NOTICE}</p></>}
        </div>

        <div className="ems-actions">
          <button className="ems-button" type="submit" disabled={locked || Boolean(conflict) || !formChanged && draftSaved && !reason.trim()}>{phase === 'saving' && commandOf(pending?.path) === 'save' ? 'Saving draft…' : 'Save draft'}</button>
          <button className="ems-button ems-button--secondary" type="button" disabled={locked || Boolean(conflict) || !dirty} onClick={discard}>Discard unsaved changes</button>
        </div>
      </form>

      {draftSaved && <div className="ems-stack">
        <RevisionComparison comparison={current!.comparison} idPrefix={fid('draft')} heading={`Saved draft version ${current!.versionNo} compared with the original signed request`} />
        <RevisionNotes revision={current!} />
        {formChanged && <p className="ems-feedback" role="status">You have unsaved changes. Save the draft before sending it; the customer receives the saved version only.</p>}
        <div className="ems-actions"><button ref={publishTrigger} type="button" className="ems-button" disabled={locked || Boolean(conflict) || formChanged || !data.canWrite} onClick={() => { setDialogError(''); setDialogReasonError(''); setDialog('publish'); }}>Send version {current!.versionNo} to customer…</button></div>
      </div>}
    </section>}

    {data && history.length > 0 && <section className="ems-panel" aria-labelledby={fid('history')}>
      <h3 id={fid('history')}>Versions</h3>
      <ol className="cr-versions" reversed>{history.map(revision => <li key={revision.id}><VersionSummary revision={revision} requestId={requestId} /></li>)}</ol>
      {audit.length > 0 && <details><summary>Revised quote history ({audit.length})</summary><ol className="lq-audit">{[...audit].reverse().map(item => <li key={item.id}>{auditLabels[item.action] ?? item.action} · revision {item.priorRevision} → {item.newRevision} · {displayTime(item.createdAt)} (Sydney){item.action === 'customer_accept' ? ' · Customer' : ` · ${item.reason}`}</li>)}</ol></details>}
    </section>}

    {dialog === 'publish' && current?.status === 'draft' && <RevisionDialog title={`Send version ${current.versionNo} to the customer?`} confirmLabel="Send revised quote" cancelLabel="Keep as draft" busy={phase === 'saving'} error={dialogError} reasonError={dialogReasonError} requireCheck="I checked the quantities, additional items and new total." onClose={() => { setDialog(null); focusSoon(publishTrigger); }} onSubmit={value => void send('publish', value)}>
      <p>New total <strong>{revisionMoney(current.totalCents)}</strong> ({revisionDelta(current.comparison.deltaCents)} compared with the original signed request). {NO_GST_NOTICE}</p>
      <p><strong>What happens</strong></p>
      <ul>
        <li>A notice email is queued for the email address the customer verified when they signed.</li>
        <li>The customer must sign in with an email code, review the changes and sign again to accept.</li>
        <li>Booking confirmation is blocked until the customer accepts this version.</li>
        <li>This version can’t be edited after it is sent. To change it, withdraw it and prepare a new version.</li>
        <li>The original signed request, signature, PDF and photos stay unchanged.</li>
      </ul>
    </RevisionDialog>}
    {dialog === 'withdraw' && current?.status === 'published' && <RevisionDialog title={`Withdraw version ${current.versionNo}?`} confirmLabel="Withdraw revised quote" cancelLabel="Keep it sent" busy={phase === 'saving'} error={dialogError} reasonError={dialogReasonError} onClose={() => { setDialog(null); focusSoon(withdrawTrigger); }} onSubmit={value => void send('withdraw', value)}>
      <p><strong>What happens</strong></p>
      <ul>
        <li>No withdrawal email is sent. A notice email that has not been sent yet is cancelled; one already sent can’t be recalled. Contact the customer separately if needed.</li>
        <li>When the customer signs in, they see that this revised quote was withdrawn.</li>
        <li>The customer can no longer accept version {current.versionNo}.</li>
        <li>{accepted ? `Accepted version ${accepted.versionNo} (${revisionMoney(accepted.totalCents)}) stays in effect.` : 'The original signed request and its estimate stay in effect.'}</li>
        <li>Booking confirmation is no longer blocked by this version. You can prepare a new version afterwards.</li>
      </ul>
    </RevisionDialog>}
  </div>;
}
