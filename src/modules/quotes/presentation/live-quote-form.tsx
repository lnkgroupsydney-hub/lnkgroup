'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { validateQuoteDraft, type QuoteDraftInput } from '../../enquiries/domain';
import { AddressAutocompleteInput } from '@/shared/ui/address-autocomplete-input';
import { mergeSelectedAddress, type AddressKind, type AddressSelection } from '@/shared/address';
import type { LiveQuoteRequest } from '../index';
import { LiveRequestDetails } from './request-details';
import { LivePhotoWorkspace } from './live-photo-workspace';
import { CustomerAccessPanel } from './customer-access-panel';
import { LegacyQuoteRecovery } from './legacy-quote-recovery';
import { liveRequest, parseLiveRequest, LiveRequestError, intentLabels, surfaceLabels, withWritingSessionLock } from './request-client';
import './live-quote.css';

type Values = { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string; details: string; consent: boolean; intent: string; surfaces: string[]; doorCount: string; drawerCount: string; material: string; colourPreference: string };
const EMPTY: Values = { name: '', email: '', phone: '', siteAddress: '', suburb: '', postcode: '', details: '', consent: false, intent: '', surfaces: [], doorCount: '', drawerCount: '', material: '', colourPreference: '' };
type Pending = { path: string; method: string; body: string; nextStep: number };
function valuesOf(request: LiveQuoteRequest): Values {
  const { contact, service } = request.payload;
  return { ...EMPTY, ...contact, ...(service ?? {}), doorCount: service?.doorCount == null ? '' : String(service.doorCount), drawerCount: service?.drawerCount == null ? '' : String(service.drawerCount) };
}
async function loadSaved(legacyRecoveryMode = false) {
  return withWritingSessionLock(navigator.locks, async () => {
  if (!legacyRecoveryMode) {
    const session = await liveRequest('/api/quote/requests/session', { method: 'POST' });
    if (session.ready !== true) throw new Error('Your private writing session could not be opened. Please retry.');
  }
  const body = await liveRequest('/api/quote/requests');
  return body.request === null ? null : parseLiveRequest(body.request);
  });
}

export function LiveQuoteForm({ previousDemoAvailable = false, legacyRecoveryMode = false, companyBaseUrl = '' }: { previousDemoAvailable?: boolean; legacyRecoveryMode?: boolean; companyBaseUrl?: string }) {
  const [values, setValues] = useState<Values>(EMPTY), [saved, setSaved] = useState<LiveQuoteRequest | null>(null);
  const [step, setStep] = useState(0), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false), [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [authBusy, setAuthBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const initial = useRef<Promise<LiveQuoteRequest | null> | null>(null), alive = useRef(false), changing = useRef(false);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null), errorBox = useRef<HTMLDivElement>(null);
  function adopt(request: LiveQuoteRequest | null) {
    setSaved(request);
    if (request) { setValues(valuesOf(request)); setStep(request.payload.service ? 2 : 1); }
    setReady(true); setConflict(false); setExpired(false); setPending(null);
  }
  useEffect(() => {
    alive.current = true; initial.current ??= loadSaved(legacyRecoveryMode); const version = generation.current;
    let cancelled = false;
    initial.current.then(value => { if (!cancelled && version === generation.current) { adopt(value); if (value) setNotice('Your saved request has been restored. The company can see these saved details.'); } })
      .catch(cause => { if (!cancelled && version === generation.current) { if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { setExpired(true); setReady(true); } setError(cause instanceof Error ? cause.message : 'Could not open your request.'); } });
    return () => { cancelled = true; alive.current = false; };
  }, [legacyRecoveryMode]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues(current => ({ ...current, [key]: value })); setNotice('Your changes are not saved yet.'); setError('');
  }
  function selectAddress(selection: AddressSelection, kind: AddressKind) {
    setValues(current => ({ ...current, ...mergeSelectedAddress(current, selection, kind) })); setNotice('Address changes are not saved yet.');
  }
  function go(next: number) { setStep(next); setNotice(''); requestAnimationFrame(() => heading.current?.focus()); }
  async function restore() {
    if (changing.current) return; changing.current = true; setBusy(true); setError('');
    const version = ++generation.current;
    try {
      const value = await loadSaved(legacyRecoveryMode); if (!alive.current || version !== generation.current) return;
      adopt(value);
      if (value) setNotice('Latest saved details loaded.');
      else { setStep(0); setNotice('A new writing session is ready. The entries still shown here have not been saved in this session.'); }
    } catch (cause) { if (alive.current && version === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load saved details.'); }
    finally { changing.current = false; if (alive.current) setBusy(false); }
  }
  async function send(attempt: Pending) {
    if (changing.current) return; changing.current = true; setBusy(true); setError(''); setNotice(''); setPending(attempt);
    const version = ++generation.current;
    try {
      const body = await liveRequest(attempt.path, { method: attempt.method, headers: { 'content-type': 'application/json', ...(saved ? { 'x-lk-quote-request-id': saved.id } : {}) }, body: attempt.body });
      const value = parseLiveRequest(body.request);
      if (saved && saved.id !== value.id) throw new Error('The saved request did not match. Retry to verify your request.');
      if (!alive.current || version !== generation.current) return;
      adopt(value); setStep(attempt.nextStep);
      setNotice(value.status === 'review_requested' ? 'Your contact and service details have been sent for company review. No price or booking has been confirmed.' : 'Saved. Your saved details are available to the company.');
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) {
      if (!alive.current || version !== generation.current) return;
      if (cause instanceof LiveRequestError && cause.status < 500) {
        setPending(null);
        if (cause.status === 409) setConflict(true);
        if (cause.status === 401 || cause.status === 403) { setExpired(true); setSaved(null); }
      }
      setError(cause instanceof Error ? cause.message : 'Save could not be confirmed. Retry the same save.');
    } finally { changing.current = false; if (alive.current) setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (pending || changing.current || conflict || expired) return;
    try {
      if (!values.consent) throw new Error('Confirm permission for the company to store and review your details.');
      for (const key of ['doorCount', 'drawerCount'] as const) if (step === 1 && values[key] && !/^\d+$/.test(values[key])) throw new Error('Enter whole quantities from 0 to 500, or leave them blank.');
      const payload: QuoteDraftInput = validateQuoteDraft({ contact: { ...values, consent: true }, service: step === 1 ? { serviceId: 'cabinet-painting', intent: values.intent, surfaces: values.surfaces, doorCount: values.doorCount === '' ? null : Number(values.doorCount), drawerCount: values.drawerCount === '' ? null : Number(values.drawerCount), material: values.material, colourPreference: values.colourPreference } : saved?.payload.service ?? null });
      void send({ path: '/api/quote/requests', method: 'PUT', body: JSON.stringify({ expectedRevision: saved?.revision ?? 0, idempotencyKey: crypto.randomUUID(), payload, storageConsent: true }), nextStep: step === 0 ? 1 : 2 });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please check your entries.'); }
  }
  function requestReview() {
    if (!saved || pending || changing.current || conflict || expired) return;
    void send({ path: '/api/quote/requests/review', method: 'POST', body: JSON.stringify({ expectedRevision: saved.revision, idempotencyKey: crypto.randomUUID() }), nextStep: 2 });
  }
  const locked = legacyRecoveryMode || !ready || busy || Boolean(pending) || conflict || expired;
  const hasUnsavedChanges = JSON.stringify(values) !== JSON.stringify(saved ? valuesOf(saved) : EMPTY);
  function restoreCustomerRequest(request: LiveQuoteRequest) {
    generation.current++; setError(''); setNotice('Your saved quote has been restored through your verified email.'); setPhotoBusy(false); adopt(request);
  }
  function clearPrivateAccess() {
    generation.current++; setSaved(null); setValues(EMPTY); setStep(0); setPending(null); setConflict(false); setExpired(true); setReady(true); setPhotoBusy(false);
  }
  function customerSignedOut() {
    clearPrivateAccess(); setExpired(false); setReady(false); setVerifiedEmail(null); setError(''); void restore();
  }
  const addressContext = JSON.stringify([values.siteAddress, values.suburb, values.postcode]);
  return <div className="lq-page"><div className="lq-shell">
    <a href="/services/cabinet-painting">← Kitchen Cabinet Painting</a>
    <section className="lq-card" aria-labelledby="live-quote-title">
      <p className="lq-kicker">Kitchen Cabinet Painting</p><h1 id="live-quote-title">Tell us about your cabinets</h1>
      <p>Save your details, upload cabinet photos and receive an AI assessment of the visible condition and proposed work.</p>
      <p className="lq-notice">Cabinet painting starts from <strong>A$1,650 incl GST</strong> (A$1,500 + GST). Upload your photos for a saved estimate and work details. Estimates may change after an on-site inspection. Saving or analysing does not confirm a contract or booking.</p>
      {legacyRecoveryMode ? <LegacyQuoteRecovery request={saved} companyBaseUrl={companyBaseUrl} /> : <CustomerAccessPanel request={saved} disabled={busy || photoBusy || Boolean(pending)} hasUnsavedChanges={hasUnsavedChanges} onRestored={restoreCustomerRequest} onPrivateAccessLost={clearPrivateAccess} onSignedOut={customerSignedOut} onIdentityChange={setVerifiedEmail} onBusyChange={setAuthBusy} />}
      <ol className="lq-progress" aria-label="Request progress">{['Your details', 'Service details', 'Photos and analysis'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol>
      {!ready && !error && <p role="status">Opening your private request…</p>}
      {error && <div className="lq-error" ref={errorBox} tabIndex={-1} role="alert"><p>{error}</p>
        {pending && <><p>The result is not confirmed. Retry the same save before editing to avoid duplicate changes.</p><button type="button" disabled={busy} onClick={() => void send(pending)}>Retry same save</button></>}
        {conflict && <><p>Your entries are still here. Copy any unsaved changes before loading the latest saved version.</p><button type="button" disabled={busy} onClick={() => void restore()}>Load latest saved details</button></>}
        {expired && <p>Your private writing access has ended. Verify your email above to reopen a previously linked quote. Unlinked older requests need company-assisted recovery; company records are retained.</p>}
        {!ready && !pending && !expired && <button type="button" disabled={busy} onClick={() => void restore()}>Retry opening request</button>}
      </div>}
      <p className="lq-status" role="status" aria-live="polite">{notice}</p>
      {expired && !error && <p className="lq-notice">Your private access has ended. Verify your email above to reopen a linked quote.</p>}
      {hasUnsavedChanges && !locked && <button type="button" className="secondary" disabled={authBusy || photoBusy} onClick={() => { setValues(saved ? valuesOf(saved) : EMPTY); setNotice('Unsaved form changes discarded. Saved company records have not changed.'); }}>Discard unsaved form changes</button>}
      {legacyRecoveryMode ? saved && <LiveRequestDetails request={saved} /> : step < 2 ? <form onSubmit={save}><fieldset disabled={locked || authBusy} className="lq-fields">
        <h2 ref={heading} tabIndex={-1}>{step === 0 ? '1. Your details' : '2. Service details'}</h2>
        {step === 0 ? <>
          <p>Fields marked * are required. This browser can continue an unlinked saved request for up to 24 hours. {verifiedEmail ? `Verified email: ${verifiedEmail}. Link this specific saved quote above to keep access.` : 'Verify the email of your saved quote above to reopen it later.'}</p>
          <div className="lq-grid">
            <label>Your name *<input required autoComplete="name" maxLength={120} value={values.name} onChange={e => update('name', e.target.value)} /></label>
            <label>Email *<input required type="email" autoComplete="email" maxLength={254} value={values.email} onChange={e => update('email', e.target.value)} /></label>
            <label>Phone (optional)<input type="tel" autoComplete="tel" maxLength={40} value={values.phone} onChange={e => update('phone', e.target.value)} /></label>
            <div><label htmlFor="live-site">Site address *</label><AddressAutocompleteInput id="live-site" required kind="street" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="street-address" maxLength={240} value={values.siteAddress} onChange={e => update('siteAddress', e.target.value)} /></div>
            <div><label htmlFor="live-suburb">Suburb *</label><AddressAutocompleteInput id="live-suburb" required kind="suburb" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="address-level2" maxLength={100} value={values.suburb} onChange={e => update('suburb', e.target.value)} /></div>
            <div><label htmlFor="live-postcode">Postcode *</label><AddressAutocompleteInput id="live-postcode" required kind="postcode" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="postal-code" maxLength={4} pattern="[0-9]{4}" inputMode="numeric" value={values.postcode} onChange={e => update('postcode', e.target.value)} /></div>
          </div>
          <p className="lq-muted">Address suggestions send search text to Google when available. You can also enter the address manually.</p>
          <label>Project details (optional)<textarea rows={4} maxLength={3000} value={values.details} onChange={e => update('details', e.target.value)} /></label>
          <label className="lq-option"><input required type="checkbox" checked={values.consent} onChange={e => update('consent', e.target.checked)} />I agree to L&amp;K Group privately saving these details in its company system to prepare and review my quote request. *</label>
        </> : <>
          <p>Service: <strong>Kitchen Cabinet Painting</strong> — painting your existing cabinets.</p>
          <fieldset><legend>What would you like to do? *</legend><div className="lq-options">{Object.entries(intentLabels).map(([value, label]) => <label className="lq-option" key={value}><input required type="radio" name="live-intent" value={value} checked={values.intent === value} onChange={() => update('intent', value)} />{label}</label>)}</div></fieldset>
          <fieldset><legend>Which surfaces are involved? *</legend><div className="lq-options">{Object.entries(surfaceLabels).map(([value, label]) => <label className="lq-option" key={value}><input type="checkbox" checked={values.surfaces.includes(value)} onChange={() => update('surfaces', values.surfaces.includes(value) ? values.surfaces.filter(x => x !== value) : value === 'unknown' ? ['unknown'] : [...values.surfaces.filter(x => x !== 'unknown'), value])} />{label}</label>)}</div></fieldset>
          <div className="lq-grid">
            <label>Cabinet doors (optional)<input type="number" min={0} max={500} step={1} aria-describedby="ai-quantity-help" value={values.doorCount} onChange={e => update('doorCount', e.target.value)} /></label>
            <label>Drawer fronts (optional)<input type="number" min={0} max={500} step={1} aria-describedby="ai-quantity-help" value={values.drawerCount} onChange={e => update('drawerCount', e.target.value)} /></label>
            <label>Material (optional)<input maxLength={100} value={values.material} onChange={e => update('material', e.target.value)} /></label>
            <label>Colour or finish (optional)<input maxLength={100} value={values.colourPreference} onChange={e => update('colourPreference', e.target.value)} /></label>
          </div>
          <p id="ai-quantity-help">Not sure how many? Leave these blank. AI will estimate quantities from your photos for an initial painting price. Exact quantities and the final price will be confirmed on site.</p>
        </>}
        <div className="lq-actions">{step === 1 && <button type="button" className="secondary" onClick={() => go(0)}>Edit your details</button>}<button type="submit">{busy ? 'Saving…' : step === 0 ? 'Save details and continue' : 'Save service details'}</button></div>
      </fieldset></form> : saved && !expired ? <div>
        <h2 ref={heading} tabIndex={-1}>{saved.status === 'review_requested' ? 'Company review requested' : '3. Photos and analysis'}</h2>
        <LiveRequestDetails request={saved} />
        <LivePhotoWorkspace key={saved.id} request={saved} disabled={locked || authBusy} onBusyChange={setPhotoBusy} onSaved={value => { if (value.id === saved.id) { setSaved(value); setValues(valuesOf(value)); } }} onAccessLost={() => { clearPrivateAccess(); setError('Your writing access has ended. Private photos and analysis have been cleared from this screen. Verify your email above to reopen a linked quote.'); }} />
        <p className="lq-notice">To keep this quote and its photos for later, use “Verify email and keep this quote” above. Email verification does not approve the estimate or book a date.</p>
        {saved.status === 'draft' ? <><p>You can correct your saved details before requesting another analysis, or ask the company to review this request.</p><div className="lq-actions"><button type="button" className="secondary" disabled={locked || authBusy || photoBusy} onClick={() => go(0)}>Edit contact details</button><button type="button" className="secondary" disabled={locked || authBusy || photoBusy} onClick={() => go(1)}>Edit service details</button><button type="button" disabled={locked || authBusy || photoBusy || !saved.payload.service} onClick={requestReview}>{busy ? 'Sending…' : 'Request company review'}</button></div></> : <p className="lq-notice">Your saved information and any photo estimate are awaiting company review. They do not confirm a signed contract or booking. Reopen this request above to add photos or correct the saved details.</p>}
      </div> : null}
      {previousDemoAvailable && <details className="lq-previous"><summary>Previous demonstration requests</summary><p><a href="/quote/start?service=cabinet-painting&mode=demo">Open the earlier demonstration workspace</a>. Its saved photos and documents remain separate.</p></details>}
    </section>
  </div></div>;
}
