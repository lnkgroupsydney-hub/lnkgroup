'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PROJECT_INTENTS, TARGET_SURFACES } from '@/modules/enquiries/domain';
import { useUnsavedChanges } from '@/shared/ui/admin-workspace-state';
import type { LiveQuoteRequest } from '../index';
import { validateStaffQuotePayload, type StaffQuoteDraftDetail, type StaffQuoteDraftPayload } from '../domain/staff-draft';
import { LiveRequestDetails } from './request-details';
import { displayTime, intentLabels, surfaceLabels } from './request-client';
import { CurrentWorkClient, parseStaffQuoteDraft, staffQuoteActions } from './staff-quote-client';

type WorkState = ReturnType<CurrentWorkClient<StaffQuoteDraftDetail>['snapshot']>;
type ContactForm = StaffQuoteDraftPayload['contact'];
type Form = { contact: ContactForm; includeService: boolean; intent: string; surfaces: string[]; doorCount: string; drawerCount: string; material: string; colourPreference: string; internalNotes: string };
type Conflict = { message: string; attempted: Form; attemptedRevision: number; latest: StaffQuoteDraftDetail | null };

const contactFields: { key: keyof ContactForm; label: string; max: number; type?: string; multiline?: boolean }[] = [
  { key: 'name', label: 'Contact name', max: 120 }, { key: 'email', label: 'Email', max: 254, type: 'email' }, { key: 'phone', label: 'Phone (optional)', max: 40, type: 'tel' },
  { key: 'siteAddress', label: 'Site address', max: 240 }, { key: 'suburb', label: 'Suburb', max: 100 }, { key: 'postcode', label: 'Postcode', max: 4 },
  { key: 'details', label: 'Project details (optional)', max: 3000, multiline: true },
];
const fieldLabels: Record<string, string> = { ...Object.fromEntries(contactFields.map(field => [field.key, field.label])), includeService: 'Cabinet painting details', intent: 'Project type', surfaces: 'Surfaces', doorCount: 'Doors', drawerCount: 'Drawer fronts', material: 'Material', colourPreference: 'Colour preference', internalNotes: 'Internal notes' };

const fieldPaths: Record<string, string> = { name: 'payload.contact.name', email: 'payload.contact.email', phone: 'payload.contact.phone', siteAddress: 'payload.contact.siteAddress', suburb: 'payload.contact.suburb', postcode: 'payload.contact.postcode', details: 'payload.contact.details', intent: 'payload.service.intent', doors: 'payload.service.doorCount', drawers: 'payload.service.drawerCount', material: 'payload.service.material', colour: 'payload.service.colourPreference', notes: 'payload.internalNotes', reason: 'reason' };
const pathLabels: Record<string, string> = { ...Object.fromEntries(contactFields.map(field => [fieldPaths[field.key], field.label])), 'payload.service': 'Cabinet painting details', 'payload.service.serviceId': 'Service', 'payload.service.intent': 'Project type', 'payload.service.surfaces': 'Surfaces', 'payload.service.doorCount': 'Doors', 'payload.service.drawerCount': 'Drawer fronts', 'payload.service.material': 'Material', 'payload.service.colourPreference': 'Colour preference', 'payload.internalNotes': 'Internal notes', reason: 'Reason', expectedRevision: 'Internal draft revision' };
function payloadFromSource(source: LiveQuoteRequest): StaffQuoteDraftPayload {
  const { name, email, phone, siteAddress, suburb, postcode, details } = source.payload.contact, service = source.payload.service;
  return { contact: { name, email, phone, siteAddress, suburb, postcode, details }, service: service ? { serviceId: 'cabinet-painting', intent: service.intent, surfaces: [...service.surfaces], doorCount: service.doorCount, drawerCount: service.drawerCount, material: service.material, colourPreference: service.colourPreference } : null, internalNotes: '' };
}
function formFrom(payload: StaffQuoteDraftPayload): Form {
  const service = payload.service;
  return { contact: { ...payload.contact }, includeService: Boolean(service), intent: service?.intent ?? '', surfaces: service ? [...service.surfaces] : [], doorCount: service?.doorCount == null ? '' : String(service.doorCount), drawerCount: service?.drawerCount == null ? '' : String(service.drawerCount), material: service?.material ?? '', colourPreference: service?.colourPreference ?? '', internalNotes: payload.internalNotes };
}
const count = (value: string) => value.trim() === '' ? null : Number(value.trim());
function payloadFrom(form: Form): StaffQuoteDraftPayload {
  return { contact: { ...form.contact }, service: form.includeService ? { serviceId: 'cabinet-painting', intent: form.intent, surfaces: [...form.surfaces], doorCount: count(form.doorCount), drawerCount: count(form.drawerCount), material: form.material, colourPreference: form.colourPreference } : null, internalNotes: form.internalNotes };
}
const initialPayload = (data: StaffQuoteDraftDetail) => data.draft ? data.draft.payload : payloadFromSource(data.source);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function changedFields(a: Form, b: Form) {
  const out: string[] = [];
  for (const field of contactFields) if (a.contact[field.key] !== b.contact[field.key]) out.push(field.label);
  for (const key of ['includeService', 'intent', 'surfaces', 'doorCount', 'drawerCount', 'material', 'colourPreference', 'internalNotes'] as const) if (!same(a[key], b[key])) out.push(fieldLabels[key]);
  return out;
}

/** Staff work copy only. The customer request, its pricing version, signatures and saved PDFs are never written here. */
export function StaffQuoteDraftEditor({ requestId, active, onAccessLost }: { requestId: string; active: boolean; onAccessLost: () => void }) {
  const [client] = useState(() => new CurrentWorkClient(parseStaffQuoteDraft));
  const [actions] = useState(() => staffQuoteActions(client, requestId));
  const [work, setWork] = useState<WorkState>(() => client.snapshot());
  const [form, setForm] = useState<Form | null>(null), [baseline, setBaseline] = useState<Form | null>(null), [baseRevision, setBaseRevision] = useState(0), [reason, setReason] = useState('');
  const [writeFailed, setWriteFailed] = useState(false), [conflict, setConflict] = useState<Conflict | null>(null), [notice, setNotice] = useState(''), [validation, setValidation] = useState(''), [loaded, setLoaded] = useState(false), [accessEnded, setAccessEnded] = useState(false);
  const alive = useRef(false), ended = useRef(false), access = useRef(onAccessLost);
  const writeErrorRef = useRef<HTMLDivElement>(null), stateHeading = useRef<HTMLHeadingElement>(null), noticeRef = useRef<HTMLParagraphElement>(null), validationRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);

  const apply = useCallback((snapshot: WorkState) => {
    if (!alive.current || ended.current) return false;
    if (snapshot.phase === 'access_lost') {
      ended.current = true; setAccessEnded(true); client.clear();
      setWork(client.snapshot()); setForm(null); setBaseline(null); setReason(''); setConflict(null); setNotice(''); setValidation('');
      access.current(); return false;
    }
    setWork(snapshot); return true;
  }, [client]);
  const load = useCallback(async (resetForm: boolean) => {
    setConflict(current => current ? { ...current, latest: null } : current);
    const read = actions.detail(); setWork(client.snapshot());
    const snapshot = await read;
    if (!apply(snapshot) || snapshot.phase !== 'idle' || !snapshot.data) return null;
    const latest = snapshot.data;
    setConflict(current => current ? { ...current, latest } : current);
    setLoaded(true);
    if (resetForm) { const next = formFrom(initialPayload(latest)); setForm(next); setBaseline(next); setBaseRevision(latest.draft?.revision ?? 0); setReason(''); }
    return latest;
  }, [actions, apply, client]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.clear(); }; }, [client]);
  useEffect(() => {
    if (!active || loaded || ended.current) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(true); });
    return () => { cancelled = true; };
  }, [active, loaded, load]);

  const phase = work.phase, data = work.data, locked = phase === 'saving' || phase === 'unknown' || phase === 'loading';
  const dirty = Boolean(form && baseline && (!same(form, baseline) || reason.trim())) || phase === 'saving' || phase === 'unknown' || Boolean(conflict);
  const discard = useCallback(() => { if (client.pendingRequest()) return; setForm(baseline); setReason(''); setConflict(null); setValidation(''); }, [client, baseline]);
  useUnsavedChanges(`staff-quote-draft:${requestId}`, { dirty, busy: phase === 'saving' || phase === 'unknown', onDiscard: discard });

  const fid = (name: string) => `staff-draft-${name}-${requestId}`;
  const fieldError = (key: string) => writeFailed && phase === 'error' ? work.fields?.[(fieldPaths[key] ?? key) as keyof NonNullable<WorkState['fields']>] : undefined;
  // D1: customer values that fail today's rules stay as they are until staff change them. They are not save errors.
  const sourceForm = data ? formFrom(payloadFromSource(data.source)) : null;
  const formValue = (value: Form | null, key: string) => !value ? undefined : key in value.contact ? value.contact[key as keyof ContactForm] : ({ intent: value.intent, doors: value.doorCount, drawers: value.drawerCount, material: value.material, colour: value.colourPreference, surfaces: value.surfaces.join(',') } as Record<string, string>)[key];
  const sourceIssue = (key: string) => { const path = key === 'surfaces' ? 'payload.service.surfaces' : fieldPaths[key] ?? key, issue = data?.sourceIssues?.find(item => item.field === path); return issue && formValue(form, key) === formValue(sourceForm, key) ? issue : undefined; };
  const invalid = (key: string) => { const describedBy = [fieldError(key) ? `${fid(key)}-error` : '', sourceIssue(key) ? `${fid(key)}-source` : ''].filter(Boolean).join(' '); return { ...(fieldError(key) ? { 'aria-invalid': true } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) }; };
  const fieldMessage = (key: string) => { const message = fieldError(key), issue = sourceIssue(key); return <>{issue && <small id={`${fid(key)}-source`} className="staff-draft-source-note">Customer’s original value: {issue.message} Kept as is in this draft; correct it before a revised quote is sent.</small>}{message && <small id={`${fid(key)}-error`} className="staff-draft-field-error">{message}</small>}</>; };
  const focusSoon = (target: { current: HTMLElement | null }) => requestAnimationFrame(() => target.current?.focus());
  async function afterWrite(snapshot: WorkState, attempted: Form, attemptedRevision: number) {
    if (!apply(snapshot)) return;
    setWriteFailed(snapshot.phase === 'error');
    if (snapshot.phase === 'error') focusSoon(writeErrorRef);
    if (snapshot.phase === 'saved') {
      setNotice(`Internal draft saved as revision ${snapshot.receipt?.revision}. The customer's request, pricing, signatures and saved PDFs were not changed, and nothing was sent to the customer.`);
      focusSoon(noticeRef); await load(true);
    } else if (snapshot.phase === 'conflict') {
      setConflict({ message: snapshot.error ?? 'The internal draft changed after you opened it.', attempted, attemptedRevision, latest: null }); focusSoon(stateHeading); await load(false);
    } else if (snapshot.phase === 'unknown') focusSoon(stateHeading);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || locked || conflict || client.pendingRequest() || !data?.canWrite) return;
    const payload = payloadFrom(form);
    try { validateStaffQuotePayload(payload, data.source.payload); }
    catch (cause) { setValidation(`${cause instanceof Error ? cause.message : 'Check the draft details.'} Correct the field and save again.`); focusSoon(validationRef); return; }
    if (!reason.trim()) { setValidation('Enter a reason for this internal draft change.'); focusSoon(validationRef); return; }
    setValidation(''); setNotice(''); setWriteFailed(false);
    const attempted = structuredClone(form), pending = actions.save({ expectedRevision: baseRevision, reason: reason.trim(), payload });
    setWork(client.snapshot());
    await afterWrite(await pending, attempted, baseRevision);
  }
  async function resolvePending(kind: 'check' | 'retry') {
    const request = client.pendingRequest(); if (!request || !form) return;
    const attemptedRevision = Number(request.body.expectedRevision), call = kind === 'check' ? actions.check() : actions.retry();
    setWork(client.snapshot());
    const snapshot = await call;
    if (kind === 'check' && snapshot.phase === 'unknown') setNotice('No saved result was found yet. Retry the same save, or check again shortly.');
    await afterWrite(snapshot, form, attemptedRevision);
  }
  function keepMine() {
    const latest = conflict?.latest;
    if (!latest || locked) return;
    setBaseRevision(latest.draft?.revision ?? 0); setBaseline(formFrom(initialPayload(latest))); setConflict(null);
    setNotice(`Your changes are now based on internal draft revision ${latest.draft?.revision ?? 0}. Review them and save again; this creates a new save request.`); focusSoon(noticeRef);
  }
  async function loadLatest() { if (!conflict?.latest || locked) return; if (await load(true)) { setConflict(null); setNotice(''); } }

  if (accessEnded || phase === 'access_lost') return <section className="ems-panel" aria-label="Internal staff draft"><p className="ems-feedback" role="alert">Company access ended. Sign in again to work on internal drafts.</p></section>;
  const draft = data?.draft ?? null, source = data?.source ?? null, pending = client.pendingRequest();
  const latestForm = conflict?.latest ? formFrom(initialPayload(conflict.latest)) : null;
  const update = (patch: Partial<Form>) => { setForm(current => current ? { ...current, ...patch } : current); setValidation(''); };

  return <div className="ems-stack staff-draft">
    {phase === 'loading' && !data && <p role="status">Loading the internal draft…</p>}
    {phase === 'error' && !writeFailed && <div className="ems-feedback ems-feedback--error" role="alert"><p>{work.error ?? 'The internal draft could not be loaded.'}{data ? ' The details below are the last loaded version.' : ''} Your typed changes are kept.</p>{!pending && <button type="button" className="ems-button ems-button--secondary" onClick={() => void load(!form)}>Retry loading the internal draft</button>}</div>}

    {source && <section className="ems-panel staff-draft-original" aria-labelledby={`staff-draft-original-${requestId}`}>
      <div className="ems-actions"><h3 id={`staff-draft-original-${requestId}`}>Customer request</h3><span className="ems-status">Read only</span></div>
      <p className="ems-list-meta">This is what the customer saved. Its status, pricing version, approvals, signatures and saved PDFs stay with this request and are not edited from the internal draft.</p>
      <details><summary>Show the customer&apos;s saved details (revision {source.revision})</summary><LiveRequestDetails request={source} /></details>
    </section>}

    {data && form && <section className="ems-panel staff-draft-copy" aria-labelledby={`staff-draft-heading-${requestId}`}>
      <div className="ems-actions"><h3 id={`staff-draft-heading-${requestId}`}>Internal draft</h3><span className="ems-status ems-status--warning">Internal only · not visible to customer</span></div>
      <p>A separate working copy for staff. Saving it records a new internal revision only: the customer request, quote amount, pricing version, signatures and saved PDFs stay as they are, and nothing is sent to the customer.</p>
      <p className="ems-list-meta">{draft ? `Internal draft revision ${draft.revision} · last saved ${displayTime(draft.updatedAt)} (Sydney) · started from customer revision ${draft.sourceRevisionAtCreation}` : 'No internal draft has been saved yet. The form starts from the customer’s saved details.'}</p>
      {draft && source && draft.sourceRevisionAtCreation !== source.revision && <p className="ems-feedback">The customer request changed after this internal draft started (customer revision {draft.sourceRevisionAtCreation} → {source.revision}). Compare the customer details above before relying on this draft.</p>}
      {!data.canWrite && <p className="ems-feedback">You can view this internal draft but cannot change it.</p>}
      {data.sourceIssues.length > 0 && <div className="ems-feedback staff-draft-source-issues" role="note" aria-labelledby={`staff-draft-source-${requestId}`}>
        <h4 id={`staff-draft-source-${requestId}`}>The customer’s original request has values that don’t meet the current input rules</h4>
        <p>They are kept as they are in this internal draft, and you can save the draft without changing them. They must be corrected before a revised quote is sent to the customer. Any field you change is checked against the current rules when you save.</p>
        <ul>{data.sourceIssues.map(issue => <li key={issue.field}>{pathLabels[issue.field] ?? issue.field}: {issue.message}</li>)}</ul>
      </div>}

      <p ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className={notice ? 'ems-feedback' : undefined}>{notice}</p>

      {phase === 'unknown' && pending && <div className="ems-feedback ems-feedback--error">
        <h4 ref={stateHeading} tabIndex={-1}>Save result unknown</h4>
        <p role="alert">The internal draft may or may not have been saved. Check the saved result, or retry the same save. Editing and leaving this page stay blocked until the result is known.</p>
        <p className="ems-list-meta">Waiting request: based on internal revision {String(pending.body.expectedRevision)} · Reason: {String(pending.body.reason)}</p>
        <div className="ems-actions"><button type="button" className="ems-button" onClick={() => void resolvePending('check')}>Check saved result</button><button type="button" className="ems-button ems-button--secondary" onClick={() => void resolvePending('retry')}>Retry unchanged save</button></div>
      </div>}

      {conflict && <div className="ems-feedback ems-feedback--error">
        <h4 ref={stateHeading} tabIndex={-1}>The internal draft changed</h4>
        <p role="alert">{conflict.message} Your changes were not saved and are still in the form.</p>
        <p>You edited from internal revision {conflict.attemptedRevision}. {conflict.latest?.draft ? `The latest saved internal draft is revision ${conflict.latest.draft.revision}, saved ${displayTime(conflict.latest.draft.updatedAt)} (Sydney).` : conflict.latest ? 'There is no saved internal draft in the latest details.' : 'The latest internal draft could not be loaded yet.'}</p>
        {latestForm && <p>Fields where your changes differ from the latest draft: {changedFields(conflict.attempted, latestForm).join(', ') || 'none'}.</p>}
        <div className="ems-actions"><button type="button" className="ems-button" disabled={!conflict.latest || locked} onClick={keepMine}>Keep my changes on the latest revision</button><button type="button" className="ems-button ems-button--secondary" disabled={!conflict.latest || locked} onClick={() => void loadLatest()}>Discard my changes and load latest</button></div>
      </div>}

      <form onSubmit={event => void save(event)} aria-busy={phase === 'saving'} noValidate>
        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict) || !data.canWrite}>
          <legend>Contact and site</legend>
          <div className="ems-detail-grid">{contactFields.filter(field => !field.multiline).map(field => <div key={field.key} className="ems-field"><label htmlFor={fid(field.key)}>{field.label}</label><input id={fid(field.key)} {...invalid(field.key)} type={field.type ?? 'text'} maxLength={field.max} autoComplete="off" value={form.contact[field.key]} onChange={event => update({ contact: { ...form.contact, [field.key]: event.target.value } })} />{fieldMessage(field.key)}</div>)}</div>
          <div className="ems-field"><label htmlFor={fid('details')}>Project details (optional)</label><textarea id={fid('details')} {...invalid('details')} maxLength={3000} rows={4} value={form.contact.details} onChange={event => update({ contact: { ...form.contact, details: event.target.value } })} />{fieldMessage('details')}</div>
        </fieldset>
        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict) || !data.canWrite}>
          <legend>Cabinet painting details</legend>
          <label className="staff-draft-check"><input type="checkbox" checked={form.includeService} onChange={event => update({ includeService: event.target.checked })} />Include cabinet painting details in this draft</label>
          {form.includeService && <>
            <div className="ems-field"><label htmlFor={fid('intent')}>Project type</label><select id={fid('intent')} {...invalid('intent')} value={form.intent} onChange={event => update({ intent: event.target.value })}><option value="">Choose a project type</option>{PROJECT_INTENTS.map(value => <option key={value} value={value}>{intentLabels[value] ?? value}</option>)}</select>{fieldMessage('intent')}</div>
            <fieldset className="ems-fieldset staff-draft-surfaces"><legend>Surfaces</legend>{TARGET_SURFACES.map(value => <label key={value} className="staff-draft-check"><input type="checkbox" checked={form.surfaces.includes(value)} onChange={event => update({ surfaces: event.target.checked ? (value === 'unknown' ? ['unknown'] : [...form.surfaces.filter(item => item !== 'unknown'), value]) : form.surfaces.filter(item => item !== value) })} />{surfaceLabels[value] ?? value}</label>)}</fieldset>
            <div className="ems-detail-grid">
              <div className="ems-field"><label htmlFor={fid('doors')}>Doors (optional)</label><input id={fid('doors')} {...invalid('doors')} inputMode="numeric" maxLength={3} value={form.doorCount} onChange={event => update({ doorCount: event.target.value })} />{fieldMessage('doors')}</div>
              <div className="ems-field"><label htmlFor={fid('drawers')}>Drawer fronts (optional)</label><input id={fid('drawers')} {...invalid('drawers')} inputMode="numeric" maxLength={3} value={form.drawerCount} onChange={event => update({ drawerCount: event.target.value })} />{fieldMessage('drawers')}</div>
              <div className="ems-field"><label htmlFor={fid('material')}>Material (optional)</label><input id={fid('material')} {...invalid('material')} maxLength={100} value={form.material} onChange={event => update({ material: event.target.value })} />{fieldMessage('material')}</div>
              <div className="ems-field"><label htmlFor={fid('colour')}>Colour preference (optional)</label><input id={fid('colour')} {...invalid('colour')} maxLength={100} value={form.colourPreference} onChange={event => update({ colourPreference: event.target.value })} />{fieldMessage('colour')}</div>
            </div>
          </>}
        </fieldset>
        <fieldset className="ems-fieldset" disabled={locked || Boolean(conflict) || !data.canWrite}>
          <legend>Staff notes</legend>
          <div className="ems-field"><label htmlFor={fid('notes')}>Internal notes (optional, staff only)</label><textarea id={fid('notes')} {...invalid('notes')} maxLength={3000} rows={4} value={form.internalNotes} onChange={event => update({ internalNotes: event.target.value })} />{fieldMessage('notes')}</div>
          <div className="ems-field"><label htmlFor={`staff-draft-reason-${requestId}`}>Reason for this change</label><input id={`staff-draft-reason-${requestId}`} aria-describedby={`staff-draft-reason-hint-${requestId}${fieldError('reason') ? ` ${fid('reason')}-error` : ''}`} aria-invalid={Boolean(fieldError('reason'))} maxLength={500} autoComplete="off" value={reason} onChange={event => { setReason(event.target.value); setValidation(''); }} /><small id={`staff-draft-reason-hint-${requestId}`}>Recorded in the internal draft history.</small>{fieldMessage('reason')}</div>
        </fieldset>
        {phase === 'error' && writeFailed && <div ref={writeErrorRef} tabIndex={-1} role="alert" className="ems-feedback ems-feedback--error"><p>The internal draft was not saved: {work.error}</p>{work.fields && Object.keys(work.fields).length > 0 && <ul>{Object.entries(work.fields).map(([path, message]) => <li key={path}>{pathLabels[path] ?? path}: {message}</li>)}</ul>}<p>Correct the details and save again. Saving again creates a new request; nothing from this attempt was stored.</p></div>}
        {validation && <p ref={validationRef} tabIndex={-1} role="alert" className="ems-feedback ems-feedback--error">{validation}</p>}
        <div className="ems-actions">
          <button className="ems-button" type="submit" disabled={locked || Boolean(conflict) || !data.canWrite}>{phase === 'saving' ? 'Saving internal draft…' : 'Save internal draft'}</button>
          <button className="ems-button ems-button--secondary" type="button" disabled={locked || Boolean(conflict) || !dirty} onClick={discard}>Discard unsaved changes</button>
        </div>
      </form>

      {data.audit.length > 0 && <details><summary>Internal draft history ({data.audit.length})</summary><ol className="lq-audit">{data.audit.slice(0, 10).map(item => <li key={item.id}>Revision {item.priorRevision} → {item.revision} · {displayTime(item.createdAt)} (Sydney) · {item.reason}</li>)}</ol></details>}
    </section>}
  </div>;
}
