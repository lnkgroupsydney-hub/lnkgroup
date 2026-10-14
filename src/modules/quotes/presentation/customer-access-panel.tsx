'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ValidatedInput, reportSectionValidity } from '@/shared/ui/validated-input';
import { isValidEmail } from '@/shared/validation/input';
import type { LiveQuoteRequest } from '../index';
import { displayTime, LiveRequestError } from './request-client.ts';
import { CUSTOMER_ACCESS_CHANGED, CUSTOMER_NEW_QUOTE_STARTED, CUSTOMER_ACCESS_CHANNEL, CustomerAccessLifetime, EMPTY_CUSTOMER_ACCESS, consumeQuoteHandoff, canStartAnotherQuote, canRecoverExpiredCustomerAccess, customerMutation, parseCustomerAccess, parseCustomerChallenge, readCurrentCustomerRequest, readCustomerAccess, type CustomerAccessState } from './customer-access-client.ts';

export interface CustomerAccessPanelProps {
  mode?: 'manage' | 'booking';
  active?: boolean;
  request: LiveQuoteRequest | null;
  disabled?: boolean;
  hasUnsavedChanges?: boolean;
  initialState?: CustomerAccessState;
  onRestored: (request: LiveQuoteRequest) => void;
  onPrivateAccessLost: (reason?: 'explicit-identity') => void;
  onSignedOut: () => void;
  onIdentityChange: (email: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  onBookingVerified?: () => void;
  onRequestConflict?: (conflict: boolean) => void;
  selectionRequired?: boolean;
  onStartNew?: () => void;
  originTabId?: string;
  pendingProtected?: boolean;
  onWritingSessionChanged?: () => void;
}

export function bookingAccessMatches(request: LiveQuoteRequest | null, state: CustomerAccessState, now = Date.now()) {
  return Boolean(request && state.customer && Date.parse(state.customer.expiresAt) > now && state.customer.email.toLowerCase() === request.payload.contact.email.toLowerCase() && state.currentRequestId === request.id && state.requests.some(item => item.id === request.id));
}
type BookingCodeBinding = { email: string; requestId: string; expectedRevision: number };
export function bookingChallengeMatches(request: LiveQuoteRequest | null, binding: BookingCodeBinding | null) {
  return Boolean(request && binding && request.id === binding.requestId && request.revision === binding.expectedRevision && request.payload.contact.email.toLowerCase() === binding.email.toLowerCase());
}

export function CustomerAccessPanel({ mode = 'manage', active = true, request, disabled = false, hasUnsavedChanges = false, initialState, onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange, onBookingVerified, onRequestConflict, selectionRequired = false, onStartNew, onWritingSessionChanged, originTabId, pendingProtected = false }: CustomerAccessPanelProps) {
  const [access, setAccess] = useState(initialState ?? EMPTY_CUSTOMER_ACCESS), [loaded, setLoaded] = useState(Boolean(initialState));
  const [email, setEmail] = useState(''), [token, setToken] = useState(''), [sentTo, setSentTo] = useState('');
  const [retryAt, setRetryAt] = useState(0), [expiresAt, setExpiresAt] = useState(0), [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [accessExpired, setAccessExpired] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null), [newQuotePrompt, setNewQuotePrompt] = useState(false);
  const lifecycle = useRef(new CustomerAccessLifetime()), running = useRef(false), callbacks = useRef({ onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange, onBookingVerified, onRequestConflict });
  const context = useRef({ mode, active, request });
  const entryCallbacks = useRef({ selectionRequired, onWritingSessionChanged, originTabId });
  const channel = useRef<BroadcastChannel | null>(null), codeInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null);
  const challengeBinding = useRef<BookingCodeBinding | null>(null);
  const prefix = useId();
  useEffect(() => { callbacks.current = { onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange, onBookingVerified, onRequestConflict }; context.current = { mode, active, request }; }, [onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange, onBookingVerified, onRequestConflict, mode, active, request]);
  useEffect(() => { entryCallbacks.current = { selectionRequired, onWritingSessionChanged, originTabId }; }, [selectionRequired, onWritingSessionChanged, originTabId]);
  const resendSeconds = Math.max(0, Math.ceil((retryAt - clock) / 1000)), expired = Boolean(expiresAt && clock >= expiresAt);
  const linked = Boolean(request && access.requests.some(item => item.id === request.id));
  const currentEmail = request?.payload.contact.email ?? '';
  const bookingBindingKey = mode === 'booking' ? JSON.stringify([request?.id, request?.revision, currentEmail]) : '';
  const matchingIdentity = access.customer?.email.toLowerCase() === currentEmail.toLowerCase();
  function apply(state: CustomerAccessState) {
    setAccess(state); setLoaded(true); setAccessExpired(false);
    const confirmed = context.current.mode === 'manage' || bookingAccessMatches(context.current.request, state);
    callbacks.current.onIdentityChange(confirmed ? state.customer?.email ?? null : null);
    if (context.current.mode === 'booking' && confirmed) { callbacks.current.onRequestConflict?.(false); callbacks.current.onBookingVerified?.(); }
  }
  function announceChange() { channel.current?.postMessage(CUSTOMER_ACCESS_CHANGED); }
  function fail(cause: unknown, clearAccess = true) {
    if (clearAccess && cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { apply(EMPTY_CUSTOMER_ACCESS); setAccessExpired(cause.status === 401); if (context.current.request) callbacks.current.onPrivateAccessLost(); else callbacks.current.onRequestConflict?.(true); }
    setError(cause instanceof Error ? cause.message : 'Email access could not be confirmed. Please retry.');
  }
  async function refresh(restore: boolean, changedInAnotherTab = false) {
    const generation = lifecycle.current.begin();
    try {
      const state = await readCustomerAccess();
      if (!lifecycle.current.accepts(generation)) return;
      if (changedInAnotherTab && context.current.request && (!state.customer || state.customer.email.toLowerCase() !== context.current.request.payload.contact.email.toLowerCase() || Date.parse(state.customer.expiresAt) <= Date.now())) callbacks.current.onPrivateAccessLost();
      apply(state);
      if (changedInAnotherTab && (!context.current.request || (state.customer && state.currentRequestId !== context.current.request.id))) { callbacks.current.onRequestConflict?.(true); setError('Another saved quote is active in another tab. Your current entries are still here. Open saved quote to choose explicitly, or verify this quote’s saved email to continue.'); }
      if (restore && context.current.mode === 'manage' && state.currentRequestId) {
        const restored = await readCurrentCustomerRequest(state.currentRequestId);
        if (lifecycle.current.accepts(generation)) callbacks.current.onRestored(restored);
      }
    } catch (cause) { if (lifecycle.current.accepts(generation)) fail(cause); }
  }
  useEffect(() => {
    const lifetime = lifecycle.current; lifetime.reopen();
    let cancelled = false;
    try {
      const restore = consumeQuoteHandoff(window.location, url => window.history.replaceState(null, '', url));
      if (restore) void Promise.resolve().then(() => { if (!cancelled) { setHandoff(restore); setNotice('Verify the email saved with your previous quote to securely reopen it on this company domain.'); } });
    } catch (cause) { void Promise.resolve().then(() => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'The quote recovery link is invalid.'); }); }
    if (typeof BroadcastChannel !== 'undefined') {
      const current = new BroadcastChannel(CUSTOMER_ACCESS_CHANNEL); channel.current = current;
      current.onmessage = event => {
        if (event.data === CUSTOMER_NEW_QUOTE_STARTED || (typeof event.data === 'object' && event.data?.type === CUSTOMER_NEW_QUOTE_STARTED && event.data.source !== entryCallbacks.current.originTabId)) { lifecycle.current.invalidate(); challengeBinding.current = null; setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0); entryCallbacks.current.onWritingSessionChanged?.(); return; }
        if (event.data !== CUSTOMER_ACCESS_CHANGED) return;
        lifecycle.current.invalidate(); challengeBinding.current = null; setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0);
        callbacks.current.onIdentityChange(null); setNotice('Email access changed in another tab. Checking access while keeping your current entries…');
        void refresh(false, true);
      };
    }
    return () => { cancelled = true; lifetime.close(); channel.current?.close(); channel.current = null; callbacks.current.onBusyChange(false); };
    // The panel owns its mount lifecycle; callbacks are read from the current ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const lifetime = lifecycle.current;
    lifetime.invalidate(); challengeBinding.current = null;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0); setError(''); setNotice('');
      if (!initialState) return refresh(false);
    });
    return () => { cancelled = true; lifetime.invalidate(); };
    // A binding or purpose change cancels old challenges. Visibility alone keeps a live code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bookingBindingKey]);
  useEffect(() => {
    let cancelled = false;
    if (mode === 'booking' && active && !initialState) void Promise.resolve().then(() => { if (!cancelled && !running.current && !challengeBinding.current) return refresh(false); });
    return () => { cancelled = true; };
    // Read current access on entering the visit step, without replacing the quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active]);
  useEffect(() => {
    if (!retryAt && !expiresAt) return;
    const tick = () => setClock(Date.now()); tick();
    const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [retryAt, expiresAt]);
  useEffect(() => {
    if (!access.customer) return;
    const timer = setTimeout(() => {
      lifecycle.current.invalidate(); apply(EMPTY_CUSTOMER_ACCESS); setAccessExpired(true); if (context.current.request) callbacks.current.onPrivateAccessLost(); else callbacks.current.onRequestConflict?.(true);
      setNotice('Your email session has expired. Verify your email again to reopen the quotes you linked.');
    }, Math.max(0, Date.parse(access.customer.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [access.customer]);
  useEffect(() => { if (error && active) errorBox.current?.focus(); }, [error, active]);
  async function perform(generation: number, operation: () => Promise<void>, clearAccessOnFailure = true) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); callbacks.current.onBusyChange(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { if (lifecycle.current.accepts(generation)) fail(cause, clearAccessOnFailure); }
    finally { running.current = false; if (lifecycle.current.isOpen()) { setBusy(false); callbacks.current.onBusyChange(false); } }
  }
  function sendCode(event?: FormEvent, bind = false) {
    bind ||= mode === 'booking';
    event?.preventDefault(); if (running.current || disabled || resendSeconds || (bind && (!request || hasUnsavedChanges))) return;
    if (event && !reportSectionValidity(event.currentTarget as HTMLFormElement)) return;
    const rawEmail = bind ? currentEmail : email;
    const target = rawEmail.trim();
    if (pendingProtected && request && target.toLowerCase() !== currentEmail.toLowerCase()) { setError('Confirm or retry the current request before switching customer email.'); return; }
    if (!isValidEmail(rawEmail)) { setError('Enter a valid email address.'); return; }
    const binding = bind && request ? { email: target, requestId: request.id, expectedRevision: request.revision } : challengeBinding.current?.email === target ? challengeBinding.current : null;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      const result = parseCustomerChallenge(await customerMutation('send', { email: target, ...(handoff && !bind ? { handoff } : binding ? { requestId: binding.requestId, expectedRevision: binding.expectedRevision } : {}) }));
      if (!lifecycle.current.accepts(generation)) return;
      challengeBinding.current = binding;
      const now = Date.now(); setClock(now); setSentTo(target); setEmail(target); setToken(''); setRetryAt(now + result.retryAfterSeconds * 1000); setExpiresAt(now + result.expiresInSeconds * 1000);
      setNotice(`A verification code has been sent to ${target}. Check your inbox and spam folder. Codes are single use.`);
      requestAnimationFrame(() => codeInput.current?.focus());
    }, false);
  }
  function verify(event: FormEvent) {
    event.preventDefault(); if (running.current || disabled || expired) return;
    if (!reportSectionValidity(event.currentTarget as HTMLFormElement) || !/^[0-9]{6,8}$/.test(token)) return;
    if (pendingProtected && request && sentTo.toLowerCase() !== currentEmail.toLowerCase()) { setError('Confirm or retry the current request before switching customer email.'); return; }
    const generation = lifecycle.current.begin();
    const binding = challengeBinding.current;
    const booking = mode === 'booking';
    if (booking && (!bookingChallengeMatches(request, binding) || hasUnsavedChanges)) { setError('This quote changed. Save its current details and request a new code.'); return; }
    void perform(generation, async () => {
      const state = parseCustomerAccess(await customerMutation('verify', { token }));
      if (!lifecycle.current.accepts(generation)) return;
      if (booking) {
        const current = context.current.request;
        if (context.current.mode !== 'booking' || !binding || !bookingChallengeMatches(current, binding) || !bookingAccessMatches(current, state)) throw new Error('The code did not confirm access to this quote. Your current quote is still here. Request a new code for its saved email.');
        const restored = await readCurrentCustomerRequest(binding.requestId);
        if (!lifecycle.current.accepts(generation)) return;
        if (restored.revision !== binding.expectedRevision || restored.payload.contact.email.toLowerCase() !== binding.email.toLowerCase()) throw new Error('This saved quote changed during verification. Your entries are still here. Reload the saved details before continuing.');
        apply(state); callbacks.current.onRestored(restored);
        challengeBinding.current = null; setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0);
        setNotice('Email verified. Choose your preferred visit below.'); announceChange(); return;
      }
      challengeBinding.current = null; setHandoff(null); setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0);
      if (state.customer && request && state.customer.email.toLowerCase() !== currentEmail.toLowerCase()) callbacks.current.onPrivateAccessLost('explicit-identity');
      if (state.currentRequestId && !entryCallbacks.current.selectionRequired) {
        callbacks.current.onPrivateAccessLost();
        const restored = await readCurrentCustomerRequest(state.currentRequestId);
        if (!lifecycle.current.accepts(generation)) return;
        apply(state); callbacks.current.onRestored(restored);
      } else apply(state);
      setNotice(state.currentRequestId && !entryCallbacks.current.selectionRequired ? 'Email verified. This saved quote is linked to your email for future access.' : 'Email verified. Choose a linked quote below to continue.'); announceChange();
    }, false);
  }
  function select(requestId: string) {
    const preserveCurrent = selectionRequired && request?.id === requestId;
    if (running.current || disabled || ((hasUnsavedChanges || pendingProtected) && !preserveCurrent)) return;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      await customerMutation('select', { requestId });
      if (!lifecycle.current.accepts(generation)) return;
      if (!preserveCurrent) callbacks.current.onPrivateAccessLost();
      const restored = await readCurrentCustomerRequest(requestId);
      const state = await readCustomerAccess();
      if (!lifecycle.current.accepts(generation)) return;
      apply(state); callbacks.current.onRestored(restored); setNotice('Your saved quote, photos and analysis have been reopened.'); announceChange();
    });
  }
  function continueCurrentQuote() {
    if (running.current || disabled || !request || !matchingIdentity || !linked || access.currentRequestId === request.id) return;
    const expected = request, generation = lifecycle.current.begin();
    void perform(generation, async () => {
      await customerMutation('select', { requestId: expected.id });
      if (!lifecycle.current.accepts(generation)) return;
      const state = await readCustomerAccess();
      if (!lifecycle.current.accepts(generation)) return;
      if (!bookingAccessMatches(expected, state)) throw new Error('Access to this quote could not be confirmed. Your entries are still here.');
      apply(state); callbacks.current.onRequestConflict?.(false); setNotice('You are continuing this quote. Your current entries are unchanged.'); announceChange();
    });
  }
  function logout(action: 'sign-out' | 'start-another' | 'recover-expired' = 'sign-out') {
    const startAnother = action === 'start-another', recoverExpired = action === 'recover-expired';
    if (running.current || disabled || pendingProtected || (startAnother && !canStartAnotherQuote(request ? { id: request.id, email: currentEmail } : null, access, hasUnsavedChanges)) || (recoverExpired && !canRecoverExpiredCustomerAccess(request, access, hasUnsavedChanges, accessExpired))) return;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      const result = await customerMutation('logout', recoverExpired ? { preserveWritingSession: true } : {});
      if (result.signedOut !== true || (recoverExpired && result.writingSessionPreserved !== true)) throw new Error('Sign out could not be confirmed. Please retry.');
      if (!lifecycle.current.accepts(generation)) return;
      apply(EMPTY_CUSTOMER_ACCESS); challengeBinding.current = null; setHandoff(null); setToken(''); setSentTo(''); setEmail(''); setExpiresAt(0); setRetryAt(0); callbacks.current.onSignedOut(); setNewQuotePrompt(false); setNotice(recoverExpired ? 'Expired email access cleared. Reopening this browser’s quote form.' : startAnother ? 'A blank quote form is opening. Your previous linked quote, photos and receipt remain saved; verify its email to reopen it later.' : 'Signed out of customer quote access. Your company records are retained.'); announceChange();
    });
  }
  const locked = disabled || busy || (!loaded && !error);
  if (mode === 'booking') return <section className="lq-customer-access" aria-labelledby={`${prefix}-heading`}>
    <h3 id={`${prefix}-heading`} tabIndex={-1} data-quote-access-heading>{bookingAccessMatches(request, access) ? 'Email confirmed for this quote' : 'Confirm your email to choose a visit'}</h3>
    <p>We’ll use the email saved on this quote for your booking request and receipt.</p>
    {request && <label htmlFor={`${prefix}-saved-email`}>Saved email<ValidatedInput id={`${prefix}-saved-email`} type="email" name="booking-saved-email" value={currentEmail} readOnly /></label>}
    {!loaded && !error && <p role="status">Checking access to this quote…</p>}
    {error && <div ref={errorBox} className="lq-error" role="alert" tabIndex={-1}><p>{error}</p><button type="button" className="secondary" disabled={locked} onClick={() => void refresh(false)}>Check email access again</button></div>}
    {notice && <p className="lq-notice" role="status" aria-live="polite">{notice}</p>}
    {matchingIdentity && linked && access.currentRequestId !== request?.id && <button type="button" className="secondary" disabled={locked} onClick={continueCurrentQuote}>Continue this quote</button>}
    {bookingAccessMatches(request, access) ? <p role="status">You can continue to your date and time below.</p> : <>
      <button type="button" data-quote-email-binding disabled={locked || !request || hasUnsavedChanges || resendSeconds > 0} onClick={() => sendCode(undefined, true)}>{resendSeconds ? `Send another code in ${resendSeconds}s` : sentTo ? 'Send another code' : 'Send verification code'}</button>
      {sentTo && <form className="lq-fields" noValidate onSubmit={verify}><p id={`${prefix}-code-help`}>Enter the code sent to {sentTo}. {expired ? 'This code expired. Request another code.' : 'Check your inbox and spam folder.'}</p><label htmlFor={`${prefix}-code`}>Email verification code<ValidatedInput validation="code" codeLengths={[6, 7, 8]} validationLabel="the email verification code" ref={codeInput} id={`${prefix}-code`} name="customer-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required aria-describedby={`${prefix}-code-help`} value={token} disabled={locked || expired} onChange={event => setToken(event.target.value)} /></label><button type="submit" disabled={locked || expired || !/^[0-9]{6,8}$/.test(token)}>Verify code</button></form>}
    </>}
  </section>;
  return <section className="lq-customer-access" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`} tabIndex={-1} data-quote-access-heading>Save and reopen your quote by email</h2>
    <p>Verify your email to keep access to a saved quote and reopen it on another device. Only quotes you have linked to your verified email appear here.</p>
    {handoff && <p className="lq-notice">You opened a recovery link for a saved quote from the previous site. Enter the email saved on that quote below. Recovery links expire after 15 minutes and can be used once.</p>}
    {!loaded && !error && <p role="status">Checking your email access…</p>}
    {error && <div ref={errorBox} className="lq-error" role="alert" tabIndex={-1}><p>{error}</p><button type="button" className="secondary" disabled={locked} onClick={() => void refresh(false)}>Check email access again</button></div>}
    {canRecoverExpiredCustomerAccess(request, access, hasUnsavedChanges, accessExpired) && <div className="lq-notice"><p>Your email access has expired. Reopen this browser’s form to continue a saved draft or enter a new quote. Saved records and company administrator access stay unchanged.</p><button type="button" className="secondary" disabled={locked} onClick={() => logout('recover-expired')}>Reopen quote form</button></div>}
    {notice && <p className="lq-notice" role="status" aria-live="polite">{notice}</p>}
    {matchingIdentity && linked && access.currentRequestId !== request?.id && <button type="button" className="secondary" disabled={locked} onClick={continueCurrentQuote}>Continue this quote</button>}
    {access.customer ? <>
      <p>Verified email: <strong>{access.customer.email}</strong>. Session ends {displayTime(access.customer.expiresAt)}; you can verify again afterwards.</p>
      {request && !linked && <div className="lq-notice"><p>{matchingIdentity ? 'This browser’s saved quote is not linked to your email yet. Verify its saved email below to keep access.' : 'This browser’s saved quote uses a different email. Verify that saved address below to switch customer access and securely link this quote.'}</p></div>}
      {access.requests.length ? <ul className="lq-customer-list" aria-label="Your linked quotes">{access.requests.map(item => <li key={item.id}><div><strong>{item.reference}</strong><span>{item.status === 'review_requested' ? 'Company review requested' : 'Saved quote'} · Saved {displayTime(item.savedAt)}</span></div><button type="button" className="secondary" disabled={locked || ((hasUnsavedChanges || pendingProtected) && !(selectionRequired && request?.id === item.id)) || (!selectionRequired && request?.id === item.id)} onClick={() => select(item.id)}>{!selectionRequired && request?.id === item.id ? 'Currently open' : 'Open saved quote'}</button></li>)}</ul> : <p>No quotes have been linked to this email yet. A saved quote must be verified while you have access to that specific request. Contact L&amp;K Group if an older unlinked request needs recovery.</p>}
      {hasUnsavedChanges && <p className="lq-muted">Save your current changes before linking or switching quotes.</p>}
      <div className="lq-actions"><button type="button" className="secondary" disabled={locked} onClick={() => void refresh(false)}>Refresh saved quotes</button><button type="button" className="secondary" disabled={locked || pendingProtected} onClick={() => logout()}>Sign out of customer access</button></div>
    </> : <form className="lq-fields" noValidate onSubmit={event => sendCode(event)}><label htmlFor={`${prefix}-email`}>Email for saved quote access<ValidatedInput validation="email" validationLabel="your email" id={`${prefix}-email`} name="customer-email" data-quote-email-binding type="email" autoComplete="email" required maxLength={254} value={email} disabled={locked} onChange={event => { setEmail(event.target.value); setError(''); }} /></label><div className="lq-actions"><button type="submit" disabled={locked || resendSeconds > 0}>{resendSeconds ? `Send another code in ${resendSeconds}s` : 'Send email verification code'}</button></div></form>}
    {request && !linked && <div className="lq-notice"><p>Keep this saved quote for later: verify <strong>{currentEmail}</strong>. Save any changes first.</p><button type="button" data-quote-email-binding disabled={locked || hasUnsavedChanges || resendSeconds > 0} onClick={() => sendCode(undefined, true)}>{resendSeconds ? `Verify saved quote in ${resendSeconds}s` : 'Verify email and keep this quote'}</button></div>}
    {sentTo && <form className="lq-fields" noValidate onSubmit={verify}><p id={`${prefix}-code-help`}>Enter the code sent to {sentTo}. {expired ? 'This code has expired. Request a new code.' : 'The code expires after 15 minutes.'}</p><label htmlFor={`${prefix}-code`}>Email verification code<ValidatedInput validation="code" codeLengths={[6, 7, 8]} validationLabel="the email verification code" ref={codeInput} id={`${prefix}-code`} name="customer-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required aria-describedby={`${prefix}-code-help`} value={token} disabled={locked || expired} onChange={event => setToken(event.target.value)} /></label><div className="lq-actions"><button type="submit" disabled={locked || expired || !/^\d{6,8}$/.test(token)}>Verify code</button></div></form>}
    {onStartNew ? <div className="lq-actions"><button type="button" className="secondary" disabled={locked} onClick={onStartNew}>Start a new quote</button></div> : request && <div className="lq-notice">
      <p>To enter a different client, start a separate quote. Editing these details changes the currently open quote.</p>
      <button type="button" className="secondary" disabled={locked || hasUnsavedChanges || !canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges)} onClick={() => setNewQuotePrompt(true)}>Start a new quote</button>
      {!canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges) && <p>Save or discard form changes and verify the email of this specific quote to link it before starting another. This protects access to its saved records.</p>}
      {newQuotePrompt && <div role="group" aria-label="Confirm starting another quote"><p>Your linked quote, photos and any submitted receipt will stay saved. Starting another signs out of customer quote access and opens a blank form; verify the previous email to reopen it. Company administrator access is unchanged. Other tabs share the same customer access.</p><div className="lq-actions"><button type="button" disabled={locked || !canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges)} onClick={() => logout('start-another')}>Keep saved quote and start new</button><button type="button" className="secondary" disabled={locked} onClick={() => setNewQuotePrompt(false)}>Continue current quote</button></div></div>}
    </div>}
    <p className="lq-muted">Email verification saves access only. Estimate approval, booking and signature are separate next steps.</p>
  </section>;
}
