'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, ClipboardCheck, Mail, MapPin, Paintbrush, PenLine, ShieldCheck, UserRound } from 'lucide-react';
import { validateQuoteDraft, type QuoteDraftInput } from '../../enquiries/domain';
import { AddressAutocompleteInput } from '@/shared/ui/address-autocomplete-input';
import { ValidatedInput, ValidatedTextarea, getFieldValidationError, reportSectionValidity, type FieldValidationOptions } from '@/shared/ui/validated-input';
import { mergeSelectedAddress, type AddressKind, type AddressSelection } from '@/shared/address';
import type { LiveQuoteRequest } from '../index';
import { LiveRequestDetails } from './request-details';
import { LivePhotoWorkspace } from './live-photo-workspace';
import { BookingFlowPanel } from './booking-flow-panel';
import type { PublicAnalysisJob } from '../domain/photo-workspace';
import { CustomerAccessPanel } from './customer-access-panel';
import { LegacyQuoteRecovery } from './legacy-quote-recovery';
import { SavedPhotoAnalysis } from './saved-photo-analysis';
import { liveRequest, parseLiveRequest, LiveRequestError, intentLabels, surfaceLabels, withWritingSessionLock } from './request-client';
import './live-quote.css';

type Values = { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string; details: string; consent: boolean; intent: string; surfaces: string[]; doorCount: string; drawerCount: string; material: string; colourPreference: string };
const EMPTY: Values = { name: '', email: '', phone: '', siteAddress: '', suburb: '', postcode: '', details: '', consent: false, intent: '', surfaces: [], doorCount: '', drawerCount: '', material: '', colourPreference: '' };
const CONTACT_RULES: Record<'name' | 'email' | 'phone' | 'siteAddress' | 'suburb' | 'postcode' | 'details', FieldValidationOptions> = {
  name: { validationLabel: 'your name', required: true, requireLetter: true, maxLength: 120 },
  email: { validation: 'email', required: true, maxLength: 254 },
  phone: { validation: 'phone', maxLength: 40 },
  siteAddress: { validationLabel: 'the site address', required: true, requireLetter: true, maxLength: 240 },
  suburb: { validationLabel: 'the suburb', required: true, requireLetter: true, maxLength: 100 },
  postcode: { validation: 'postcode', required: true, maxLength: 4 },
  details: { validationLabel: 'project notes', maxLength: 3000, multiline: true },
};
const SERVICE_INPUT_RULES: Record<'doorCount' | 'drawerCount' | 'material' | 'colourPreference', FieldValidationOptions> = {
  doorCount: { validation: 'count', min: 0, max: 500 }, drawerCount: { validation: 'count', min: 0, max: 500 },
  material: { validationLabel: 'cabinet material', maxLength: 100 }, colourPreference: { validationLabel: 'colour or finish', maxLength: 100 },
};
type Pending = { path: string; method: string; body: string; nextStep: number };
const STAGES = [
  { title: 'Your details', description: 'Where is your project?', icon: UserRound },
  { title: 'Your cabinets', description: 'Choose what to refresh', icon: Paintbrush },
  { title: 'Add photos', description: 'Show us your cabinets', icon: Camera },
  { title: 'Your estimate', description: 'Review the painting scope', icon: ClipboardCheck },
  { title: 'Choose a visit', description: 'Your take-off date & time', icon: CalendarDays },
  { title: 'Sign & submit', description: 'Send your booking request', icon: PenLine },
] as const;
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

export function LiveQuoteForm({ legacyRecoveryMode = false, companyBaseUrl = '' }: { legacyRecoveryMode?: boolean; companyBaseUrl?: string }) {
  const [values, setValues] = useState<Values>(EMPTY), [saved, setSaved] = useState<LiveQuoteRequest | null>(null);
  const [step, setStep] = useState(0), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false), [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false), [bookingReadOnly, setBookingReadOnly] = useState(false), [latestAnalysis, setLatestAnalysis] = useState<PublicAnalysisJob | null>(null);
  const [authBusy, setAuthBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false), [accessVersion, setAccessVersion] = useState(0), [accessConflict, setAccessConflict] = useState(false);
  const [bookingActions, setBookingActions] = useState<HTMLDivElement | null>(null);
  const initial = useRef<Promise<LiveQuoteRequest | null> | null>(null), alive = useRef(false), changing = useRef(false);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null), errorBox = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const accessReturn = useRef<{ requestId: string | null; step: number } | null>(null);
  const journeyPosition = useRef<{ requestId: string | null; step: number }>({ requestId: null, step: 0 });
  useEffect(() => { journeyPosition.current = { requestId: saved?.id ?? null, step }; }, [saved?.id, step]);
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
  useEffect(() => { if (error) errorBox.current?.focus({ preventScroll: true }); }, [error]);
  useEffect(() => { viewport.current?.scrollTo({ top: 0, behavior: 'instant' }); heading.current?.focus({ preventScroll: true }); }, [step, accessOpen]);
  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues(current => ({ ...current, [key]: value })); setNotice('Your changes are not saved yet.'); setError('');
  }
  function selectAddress(selection: AddressSelection, kind: AddressKind) {
    setValues(current => ({ ...current, ...mergeSelectedAddress(current, selection, kind) })); setNotice('Address changes are not saved yet.');
  }
  function go(next: number) { setStep(next); setAccessOpen(false); setNotice(''); }
  const bookingStageChanged = useCallback((stage: 'date' | 'sign' | 'complete') => { setStep(stage === 'complete' ? 6 : stage === 'sign' ? 5 : 4); setAccessOpen(false); }, []);
  const recoverBooking = useCallback((target: 'photos' | 'email') => {
    if (target === 'email' && !saved) { accessReturn.current = journeyPosition.current; setAccessOpen(true); return; }
    setStep(target === 'email' ? 4 : 2); setAccessOpen(false);
    if (target === 'email') requestAnimationFrame(() => document.querySelector<HTMLElement>('#quote-email-access [data-quote-access-heading]')?.focus({ preventScroll: true }));
  }, [saved]);
  const bookingVerified = useCallback(() => { setAccessVersion(current => current + 1); }, []);
  function openEmailAccess() { accessReturn.current = journeyPosition.current; setAccessOpen(true); }
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
      setNotice(value.status === 'review_requested' ? 'You asked the company to review this estimate. This is not a signed reservation request. A current numeric estimate can still be approved below to choose a preferred date.' : 'Saved. Your saved details are available to the company.');
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
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
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || changing.current || conflict || expired || accessConflict) return;
    const invalidContact = (Object.entries(CONTACT_RULES) as [keyof typeof CONTACT_RULES, FieldValidationOptions][]).find(([field, rule]) => getFieldValidationError(values[field], rule));
    if (invalidContact) {
      setStep(0); setError(getFieldValidationError(values[invalidContact[0]], invalidContact[1]));
      requestAnimationFrame(() => reportSectionValidity(document.getElementById('quote-details-form')));
      return;
    }
    if (!reportSectionValidity(event.currentTarget as HTMLFormElement)) return;
    if (step === 1 || saved?.payload.service) {
      const invalidService = (Object.entries(SERVICE_INPUT_RULES) as [keyof typeof SERVICE_INPUT_RULES, FieldValidationOptions][]).find(([field, rule]) => getFieldValidationError(values[field], rule));
      if (invalidService) {
        setStep(1); setError(getFieldValidationError(values[invalidService[0]], invalidService[1]));
        requestAnimationFrame(() => reportSectionValidity(document.getElementById('quote-details-form')));
        return;
      }
    }
    try {
      if (!values.consent) throw new Error('Confirm permission for the company to store and review your details.');
      for (const key of ['doorCount', 'drawerCount'] as const) if (step === 1 && values[key] && !/^\d+$/.test(values[key])) throw new Error('Enter whole quantities from 0 to 500, or leave them blank.');
      const payload: QuoteDraftInput = validateQuoteDraft({ contact: { ...values, consent: true }, service: step === 1 || saved?.payload.service ? { serviceId: 'cabinet-painting', intent: values.intent, surfaces: values.surfaces, doorCount: values.doorCount === '' ? null : Number(values.doorCount), drawerCount: values.drawerCount === '' ? null : Number(values.drawerCount), material: values.material, colourPreference: values.colourPreference } : null });
      void send({ path: '/api/quote/requests', method: 'PUT', body: JSON.stringify({ expectedRevision: saved?.revision ?? 0, idempotencyKey: crypto.randomUUID(), payload, storageConsent: true }), nextStep: step === 0 ? 1 : 2 });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please check your entries.'); }
  }
  function requestReview() {
    if (!saved || pending || changing.current || conflict || expired) return;
    void send({ path: '/api/quote/requests/review', method: 'POST', body: JSON.stringify({ expectedRevision: saved.revision, idempotencyKey: crypto.randomUUID() }), nextStep: 2 });
  }
  const locked = accessConflict || bookingReadOnly || legacyRecoveryMode || !ready || busy || Boolean(pending) || conflict || expired;
  const hasUnsavedChanges = JSON.stringify(values) !== JSON.stringify(saved ? valuesOf(saved) : EMPTY);
  function restoreCustomerRequest(request: LiveQuoteRequest) {
    generation.current++; setAccessConflict(false); setError(''); setNotice('Your saved quote has been restored through your verified email.'); setPhotoBusy(false); setBookingBusy(false); setBookingReadOnly(false); setLatestAnalysis(null); adopt(request);
    if (accessReturn.current?.requestId === request.id) setStep(accessReturn.current.step === 5 ? 4 : accessReturn.current.step);
    setAccessOpen(false);
  }
  function confirmBookingRequest(request: LiveQuoteRequest) {
    if (!saved || request.id !== saved.id || request.revision !== saved.revision) { setError('This quote changed during email verification. Your current entries are still here.'); return; }
    setAccessConflict(false); setNotice('Email verified. Choose your preferred visit.');
  }
  function clearPrivateAccess() {
    generation.current++; setAccessConflict(false); setVerifiedEmail(null); setBookingBusy(false); setBookingReadOnly(false); setLatestAnalysis(null); setSaved(null); setValues(EMPTY); setStep(0); setPending(null); setConflict(false); setExpired(true); setReady(true); setPhotoBusy(false);
  }
  function customerSignedOut() {
    clearPrivateAccess(); setExpired(false); setReady(false); setVerifiedEmail(null); setError(''); void restore();
  }
  const addressContext = JSON.stringify([values.siteAddress, values.suburb, values.postcode]);
  const estimateReady = Boolean(latestAnalysis && !latestAnalysis.stale && latestAnalysis.status === 'succeeded' && latestAnalysis.pricing?.status === 'provisional_estimate' && latestAnalysis.pricing.total != null);
  const interactionLocked = locked || authBusy || photoBusy || bookingBusy;
  const navigationLocked = interactionLocked || hasUnsavedChanges;
  const stage = STAGES[Math.min(step, 5)];
  const StageIcon = step === 6 ? Check : stage.icon;
  return <div className="lq-page lq-journey"><div className="lq-shell">
    <section className="lq-card" aria-labelledby="live-quote-title">
      <header className="lq-workspace-header">
        <div><p className="lq-kicker">Kitchen Cabinet Painting</p><h1 id="live-quote-title">Let’s refresh your kitchen.</h1></div>
        {!legacyRecoveryMode && <button type="button" className="secondary lq-access-toggle" aria-expanded={accessOpen} aria-controls="quote-email-access" disabled={busy || photoBusy || (bookingBusy && !accessConflict) || Boolean(pending)} onClick={() => accessOpen ? setAccessOpen(false) : openEmailAccess()}><Mail size={17} aria-hidden="true" />{accessOpen ? 'Back to quote' : 'Open saved quote'}</button>}
      </header>
      <div className="lq-workspace-layout">
        <aside className="lq-journey-sidebar" aria-label="Quote progress and summary">
          <p className="lq-sidebar-title">Your quote, step by step</p>
          <ol className="lq-progress" aria-label="Request progress">{STAGES.map(({ title, description, icon: Icon }, index) => <li key={title} aria-current={!accessOpen && step === index ? 'step' : undefined} data-complete={step > index || undefined}><button type="button" disabled={navigationLocked || legacyRecoveryMode || bookingReadOnly || index === 5 || (index === 1 && !saved) || (index >= 2 && !saved?.payload.service) || (index === 4 && !estimateReady)} onClick={() => go(index)}><span className="lq-step-symbol">{step > index ? <Check size={16} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />}</span><span><strong>{title}</strong><small>{description}</small></span></button></li>)}</ol>
          <div className="lq-project-summary"><div className="lq-summary-icon"><Paintbrush size={22} aria-hidden="true" /></div><p className="lq-kicker">Existing cabinet painting</p><strong className="lq-summary-price">{estimateReady ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(latestAnalysis!.pricing!.total! / 100) : 'From A$1,650'}</strong><span>Including GST{estimateReady ? ' · photo-based estimate' : ' · starting price'}</span><p>Final scope and price are confirmed on site.</p>{saved && <><hr /><p className="lq-summary-name"><UserRound size={15} aria-hidden="true" />{saved.payload.contact.name}</p><p className="lq-summary-address"><MapPin size={15} aria-hidden="true" />{saved.payload.contact.suburb} {saved.payload.contact.postcode}</p><small>Reference {saved.reference}</small></>}</div>
          <p className="lq-private-note"><ShieldCheck size={16} aria-hidden="true" />Your details and photos stay private.</p>
        </aside>
        <div className="lq-workspace-main">
          <div className="lq-stage-top"><span className="lq-stage-icon"><StageIcon size={23} aria-hidden="true" /></span><div><p className="lq-kicker">{accessOpen ? 'Secure email access' : step === 6 ? 'Request received' : `Step ${step + 1} of ${STAGES.length}`}</p><h2 ref={heading} tabIndex={-1}>{accessOpen ? 'Open a saved quote' : step === 6 ? 'Your booking request is saved' : stage.title}</h2></div><span className="lq-save-state"><ShieldCheck size={14} aria-hidden="true" />{busy ? 'Saving…' : hasUnsavedChanges ? 'Unsaved changes' : saved ? 'Saved privately' : 'Private quote'}</span></div>
          <div className="lq-stage-scroll" ref={viewport} data-quote-viewport>
            {!ready && !error && <p role="status">Opening your private request…</p>}
            {error && <div className="lq-error" ref={errorBox} tabIndex={-1} role="alert"><p>{error}</p>
              {pending && <><p>The save could not be confirmed. Retry it before making more changes.</p><button type="button" disabled={busy} onClick={() => void send(pending)}>Retry same save</button></>}
              {conflict && <><p>Your entries are still here. Copy unsaved changes before loading the saved version.</p><button type="button" disabled={busy} onClick={() => void restore()}>Load latest saved details</button></>}
              {expired && <><p>Your private access has ended. Verify your email to reopen a linked quote.</p><button type="button" className="secondary" onClick={openEmailAccess}>Reopen by email</button></>}
              {!ready && !pending && !expired && <button type="button" disabled={busy} onClick={() => void restore()}>Retry opening request</button>}
            </div>}
            {notice && <p className="lq-status" role="status" aria-live="polite">{notice}</p>}
            {accessConflict && !accessOpen && step !== 4 && <p className="lq-notice" role="alert">Another saved quote is active in another tab. Your current entries are still here. Open saved quote to choose which quote to continue.</p>}
            {expired && !error && <div className="lq-notice"><p>Your private access has ended.</p><button type="button" onClick={openEmailAccess}>Reopen by email</button></div>}
            {!legacyRecoveryMode && <div id="quote-email-access" hidden={!accessOpen && step !== 4}><CustomerAccessPanel mode={accessOpen ? 'manage' : 'booking'} active={accessOpen || step === 4} request={saved} disabled={busy || photoBusy || (bookingBusy && !accessConflict && verifiedEmail !== null) || Boolean(pending)} hasUnsavedChanges={hasUnsavedChanges} onRestored={accessOpen ? restoreCustomerRequest : confirmBookingRequest} onPrivateAccessLost={clearPrivateAccess} onBookingVerified={bookingVerified} onRequestConflict={setAccessConflict} onSignedOut={customerSignedOut} onIdentityChange={setVerifiedEmail} onBusyChange={setAuthBusy} /></div>}
            <div hidden={accessOpen}>
            {legacyRecoveryMode ? <><LegacyQuoteRecovery request={saved} companyBaseUrl={companyBaseUrl} />{saved && <LiveRequestDetails request={saved} />}</> : <>
              {step < 2 && <form data-quote-step={step} id="quote-details-form" onSubmit={save} noValidate><fieldset disabled={locked || authBusy || bookingBusy} className="lq-fields">
                {step === 0 ? <>
                  <p className="lq-step-intro">Tell us who to contact and where we’ll be painting. <span>Required fields are marked *.</span></p>
                  <div className="lq-grid">
                    <label>Your name *<ValidatedInput id="live-name" validationLabel="your name" requireLetter required autoComplete="name" maxLength={120} value={values.name} onChange={e => update('name', e.target.value)} /></label>
                    <label>Email *<ValidatedInput id="live-email" validation="email" validationLabel="your email" required type="email" autoComplete="email" maxLength={254} value={values.email} onChange={e => update('email', e.target.value)} /></label>
                  </div>
                  <label>Phone <span className="lq-optional">Optional</span><ValidatedInput id="live-phone" validation="phone" validationLabel="your phone number" type="tel" autoComplete="tel" maxLength={40} value={values.phone} onChange={e => update('phone', e.target.value)} /></label>
                  <div className="lq-address-group"><p className="lq-group-title"><MapPin size={17} aria-hidden="true" />Project address</p>
                    <div><label htmlFor="live-site">Street address *</label><AddressAutocompleteInput id="live-site" required kind="street" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="street-address" maxLength={240} value={values.siteAddress} onChange={e => update('siteAddress', e.target.value)} /></div>
                    <div className="lq-grid"><div><label htmlFor="live-suburb">Suburb *</label><AddressAutocompleteInput id="live-suburb" required kind="suburb" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="address-level2" maxLength={100} value={values.suburb} onChange={e => update('suburb', e.target.value)} /></div><div><label htmlFor="live-postcode">Postcode *</label><AddressAutocompleteInput id="live-postcode" required kind="postcode" addressContext={addressContext} onAddressSelect={selectAddress} autoComplete="postal-code" maxLength={4} pattern="[0-9]{4}" inputMode="numeric" value={values.postcode} onChange={e => update('postcode', e.target.value)} /></div></div>
                  </div>
                  <details className="lq-optional-details"><summary>Add project notes <span>Optional</span></summary><label>Anything we should know?<ValidatedTextarea id="live-details" validationLabel="project notes" rows={3} maxLength={3000} value={values.details} onChange={e => update('details', e.target.value)} /></label></details>
                  <label className="lq-option lq-consent"><input required type="checkbox" checked={values.consent} onChange={e => update('consent', e.target.checked)} /><span>I agree to L&amp;K Group privately saving my details to prepare and review this quote. *</span></label>
                  <p className="lq-muted">You can save and reopen this quote by verifying your email. Until then, access in this browser lasts up to 24 hours.</p>
                </> : <>
                  <p className="lq-step-intro">Choose the finish you have in mind. We’ll assess your <strong>existing cabinets</strong> from your photos.</p>
                  <fieldset><legend>What would you like to do? *</legend><div className="lq-options lq-selection-cards">{Object.entries(intentLabels).map(([value, label]) => <label className="lq-option" key={value} data-selected={values.intent === value || undefined}><input required type="radio" name="live-intent" value={value} checked={values.intent === value} onChange={() => update('intent', value)} /><Paintbrush size={21} aria-hidden="true" /><span>{label}</span></label>)}</div></fieldset>
                  <fieldset><legend>Which surfaces are involved? *</legend><div className="lq-options lq-selection-cards">{Object.entries(surfaceLabels).map(([value, label]) => <label className="lq-option" key={value} data-selected={values.surfaces.includes(value) || undefined}><input type="checkbox" checked={values.surfaces.includes(value)} onChange={() => update('surfaces', values.surfaces.includes(value) ? values.surfaces.filter(x => x !== value) : value === 'unknown' ? ['unknown'] : [...values.surfaces.filter(x => x !== 'unknown'), value])} /><span>{label}</span></label>)}</div></fieldset>
                  <div className="lq-help-card"><Camera size={23} aria-hidden="true" /><div><strong>Not sure of the quantities?</strong><p id="ai-quantity-help">Leave the counts blank. We’ll estimate from your photos and confirm the exact scope on site.</p></div></div>
                  <div className="lq-grid">
                    <label>Cabinet doors <span className="lq-optional">Optional</span><ValidatedInput validation="count" type="text" inputMode="numeric" min={0} max={500} aria-describedby="ai-quantity-help" value={values.doorCount} onChange={e => update('doorCount', e.target.value)} /></label>
                    <label>Drawer fronts <span className="lq-optional">Optional</span><ValidatedInput validation="count" type="text" inputMode="numeric" min={0} max={500} aria-describedby="ai-quantity-help" value={values.drawerCount} onChange={e => update('drawerCount', e.target.value)} /></label>
                    <label>Material <span className="lq-optional">Optional</span><ValidatedInput id="live-material" validationLabel="cabinet material" maxLength={100} value={values.material} onChange={e => update('material', e.target.value)} /></label>
                    <label>Colour or finish <span className="lq-optional">Optional</span><ValidatedInput id="live-colour" validationLabel="colour or finish" maxLength={100} value={values.colourPreference} onChange={e => update('colourPreference', e.target.value)} /></label>
                  </div>
                </>}
              </fieldset></form>}
              {saved?.payload.service && !expired && <>
                <div data-quote-step={2} hidden={step !== 2}><LivePhotoWorkspace key={saved.id} request={saved} readOnly={bookingReadOnly} onAnalysisChange={setLatestAnalysis} disabled={locked || authBusy || bookingBusy || hasUnsavedChanges || step !== 2 || accessOpen} onBusyChange={setPhotoBusy} onSaved={value => { if (value.id === saved.id && value.revision >= saved.revision) { setSaved(value); setValues(current => JSON.stringify(current) === JSON.stringify(valuesOf(saved)) ? valuesOf(value) : current); } }} onAccessLost={() => { clearPrivateAccess(); setError('Your private access has ended. Verify your email to reopen this quote.'); }} /></div>
                <div data-quote-step={3} hidden={step !== 3}>
                  <p className="lq-step-intro">Your photo-based painting estimate. Review the scope before choosing your preferred visit.</p>
                  {estimateReady ? <div className="lq-estimate-hero"><span className="lq-estimate-badge"><Check size={14} aria-hidden="true" />Estimate ready</span><p className="lq-kicker">Estimated painting amount</p><strong>{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(latestAnalysis!.pricing!.total! / 100)}</strong><span>Including GST</span><p>Final quantities, condition and price are confirmed on site. Additional damage may increase the price; extra work and costs will be discussed before proceeding.</p></div> : <div className="lq-help-card"><ClipboardCheck size={25} aria-hidden="true" /><div><strong>We need a little more information</strong><p>{latestAnalysis?.stale ? 'Your details or photos changed. Analyse the current photos for an updated estimate.' : 'Add the requested photos or ask our team to review your project.'}</p></div></div>}
                  {latestAnalysis && <details className="lq-optional-details"><summary>View assessment and price breakdown</summary><SavedPhotoAnalysis job={latestAnalysis} /></details>}
                  {!estimateReady && saved.status === 'draft' && <button type="button" disabled={navigationLocked} onClick={requestReview}>{busy ? 'Sending…' : 'Ask our team to review'}</button>}
                  {saved.status === 'review_requested' && <p className="lq-notice">Your estimate review request is with our team. You can request a visit when a current numeric estimate is ready.</p>}
                  <details className="lq-optional-details"><summary>View saved project details</summary><LiveRequestDetails request={saved} /></details>
                </div>
                <div data-quote-step={step >= 4 ? step : 4} hidden={step < 4}><BookingFlowPanel key={saved.id} accessVersion={accessVersion} request={saved} latest={latestAnalysis} verifiedEmail={verifiedEmail} view={step === 6 ? 'complete' : step === 5 ? 'sign' : 'date'} active={step >= 4 && !accessOpen} actionContainer={bookingActions} disabled={busy || authBusy || photoBusy || hasUnsavedChanges || conflict || accessConflict || expired || Boolean(pending)} onStageChange={bookingStageChanged} onRecovery={recoverBooking} onBusyChange={setBookingBusy} onReadOnlyChange={setBookingReadOnly} onAccessLost={() => { clearPrivateAccess(); setError('Your verified access has ended. Verify your email to reopen this quote.'); }} /></div>
              </>}
            </>}
            </div>
          </div>
          <footer className="lq-stage-actions">
            {accessOpen ? <><span className="lq-muted"><ShieldCheck size={15} aria-hidden="true" />Email verification keeps access to your saved quote.</span><button key="close-saved-quote-management" type="button" className="secondary" disabled={authBusy} onClick={event => { event.preventDefault(); setAccessOpen(false); }}>Back to quote</button></> : legacyRecoveryMode ? <span className="lq-muted">Reopen your quote on the company website.</span> : step < 4 ? <>
              <div>{step > 0 && <button type="button" className="secondary" disabled={navigationLocked} data-quote-back onClick={() => go(step - 1)}><ArrowLeft size={17} aria-hidden="true" />Back</button>}{hasUnsavedChanges && (!locked || (accessConflict && !busy && !pending && !conflict && !expired && !bookingReadOnly)) && <button type="button" className="lq-text-button secondary" disabled={authBusy || photoBusy} onClick={() => { setValues(saved ? valuesOf(saved) : EMPTY); if (!saved) setAccessConflict(false); setNotice('Unsaved changes discarded.'); }}>Discard changes</button>}</div>
              {step < 2 ? <button data-quote-next type="submit" form="quote-details-form" disabled={interactionLocked}>{busy ? 'Saving…' : 'Save & continue'}<ArrowRight size={17} aria-hidden="true" /></button> : step === 2 ? <button type="button" disabled={navigationLocked} data-quote-next onClick={() => go(3)}>{latestAnalysis?.status === 'succeeded' && !latestAnalysis.stale ? 'Review estimate' : 'Request team review'}<ArrowRight size={17} aria-hidden="true" /></button> : <button type="button" disabled={navigationLocked || !estimateReady} data-quote-next onClick={() => go(4)}>Choose a visit<ArrowRight size={17} aria-hidden="true" /></button>}
            </> : <><button type="button" className="secondary" disabled={busy || authBusy || photoBusy || bookingBusy} onClick={() => step === 6 ? openEmailAccess() : step === 5 ? bookingStageChanged('date') : go(3)}>{step === 6 ? <Mail size={17} aria-hidden="true" /> : <ArrowLeft size={17} aria-hidden="true" />}{step === 6 ? 'Manage saved quote' : step === 5 ? 'Change visit' : 'Back to estimate'}</button><div className="lq-booking-action-slot" ref={setBookingActions} /></>}
          </footer>
        </div>
      </div>
    </section>
  </div></div>;
}
