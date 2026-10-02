"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { QUOTE_PROGRESS, validateQuoteDraft, type QuoteDraft, type QuoteDraftInput } from "../domain/quote-draft";
import { DemoQuoteFlow, loadDemoConfiguration } from "./demo-quote-flow";
import type { DemoSubmissionStatus } from "../domain/demo-submission";
import "./enquiry-form.css";

type Values = {
  name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string;
  details: string; consent: boolean; serviceId: string; intent: string; surfaces: string[];
  doorCount: string; drawerCount: string; material: string; colourPreference: string;
};
type Field = keyof Values;
type FieldErrors = Partial<Record<Field, string>>;
const EMPTY: Values = { name:"", email:"", phone:"", siteAddress:"", suburb:"", postcode:"", details:"", consent:false, serviceId:"", intent:"", surfaces:[], doorCount:"", drawerCount:"", material:"", colourPreference:"" };
const INTENTS = [["full-repainting","Full cabinet repainting"],["partial-touch-ups","Partial painting or touch-ups"],["colour-change","Colour change"],["advice","I need advice"]] as const;
const SURFACES = [["doors","Cabinet doors"],["drawers","Drawer fronts"],["frames","Exposed frames"],["panels","End panels"],["repairs","Areas needing repair"],["unknown","Not sure yet"]] as const;

class DraftRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function parseDraft(value: unknown): QuoteDraft {
  if (!record(value) || typeof value.id !== "string" || !value.id || !Number.isInteger(value.revision) || Number(value.revision) < 1 || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error("The server did not confirm a saved draft. Keep your entries and retry.");
  }
  return { id:value.id, revision:Number(value.revision), savedAt:value.savedAt, payload:validateQuoteDraft(value.payload) };
}
async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, credentials:"same-origin", cache:"no-store", signal:AbortSignal.timeout(25_000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new DraftRequestError(response.status, record(body) && typeof body.error === "string" ? body.error : "Draft storage is unavailable. Keep your entries and retry.");
  if (!record(body)) throw new Error("The server returned an invalid draft response. Please retry.");
  return body;
}
async function loadDraft(): Promise<QuoteDraft | null> {
  const session = await request("/api/quote/draft/session", { method:"POST" });
  if (session.ready !== true) throw new Error("Your private draft session could not be started. Please retry.");
  const body = await request("/api/quote/draft");
  return body.draft === null ? null : parseDraft(body.draft);
}
async function loadPrivateState() {
  const saved = await loadDraft();
  const demo = await loadDemoConfiguration();
  return { saved, demo };
}
function restoredValues(draft: QuoteDraft): Values {
  const { contact, service } = draft.payload;
  return { ...EMPTY, ...contact, ...(service ?? {}), doorCount:service?.doorCount == null ? "" : String(service.doorCount), drawerCount:service?.drawerCount == null ? "" : String(service.drawerCount) };
}
function errorMessage(error: unknown): string {
  return error instanceof DraftRequestError ? error.message : "Your draft could not be loaded or saved. Keep this page open and retry.";
}

export function QuoteDraftForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState("");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [submission, setSubmission] = useState<DemoSubmissionStatus | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const initialization = useRef<ReturnType<typeof loadPrivateState> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // React development remounts share this request instead of issuing competing session cookies.
    initialization.current ??= loadPrivateState();
    initialization.current.then(({saved,demo}) => {
      if (cancelled) return;
      setDemoEnabled(demo.enabled); setRecipientEmail(demo.recipientEmail); setSubmission(demo.submission);
      if (saved) { setValues(restoredValues(saved)); setDraft(saved); setStep(demo.submission ? 5 : saved.payload.service && demo.enabled ? 2 : 1); setNotice(demo.submission ? "Your saved submission has been restored in this browser." : "Your saved draft has been restored in this browser."); }
      setReady(true);
    }).catch((failure: unknown) => { if (!cancelled) setError(errorMessage(failure)); });
    return () => { cancelled = true; };
  }, []);

  function focusHeading() { window.requestAnimationFrame(() => headingRef.current?.focus()); }
  function update<K extends Field>(field: K, value: Values[K]) {
    setValues((current) => ({ ...current, [field]:value }));
    setErrors((current) => ({ ...current, [field]:undefined }));
    setNotice("Your changes are not saved yet.");
    if (!conflict && !expired) setError("");
  }
  function toggleSurface(surface: string) {
    update("surfaces", values.surfaces.includes(surface) ? values.surfaces.filter(item => item !== surface)
      : surface === "unknown" ? ["unknown"] : [...values.surfaces.filter(item => item !== "unknown"), surface]);
  }
  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!values.name.trim()) next.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = "Enter a valid email address.";
    if (!values.siteAddress.trim()) next.siteAddress = "Enter the site address.";
    if (!values.suburb.trim()) next.suburb = "Enter the suburb.";
    if (!/^\d{4}$/.test(values.postcode.trim())) next.postcode = "Enter a four-digit postcode.";
    if (!values.consent) next.consent = "Confirm permission to save your details.";
    if (step === 1) {
      if (values.serviceId !== "cabinet-painting") next.serviceId = "Select Kitchen Cabinet Painting.";
      if (!values.intent) next.intent = "Choose what you would like to do.";
      if (!values.surfaces.length) next.surfaces = "Choose a surface or Not sure yet.";
      for (const field of ["doorCount","drawerCount"] as const) {
        if (values[field] && (!/^\d+$/.test(values[field]) || Number(values[field]) > 500)) next[field] = "Enter a whole number from 0 to 500, or leave blank.";
      }
    }
    return next;
  }
  async function restoreSaved() {
    setBusy(true); setError("");
    try {
      const {saved,demo} = await loadPrivateState();
      setDemoEnabled(demo.enabled); setRecipientEmail(demo.recipientEmail); setSubmission(demo.submission);
      if (saved) {
        setValues(restoredValues(saved)); setDraft(saved); setStep(demo.submission ? 5 : 1);
        setNotice("The latest saved draft has been loaded. Review it before making changes.");
      } else {
        // An expired session starts a new private draft without discarding the visible entries.
        setDraft(null); setStep(0);
        setNotice("A new private draft session is ready. Your entries are still here; save your details to continue.");
      }
      setReady(true); setConflict(false); setExpired(false); setErrors({}); focusHeading();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || conflict || expired) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => {
        const first = Object.keys(nextErrors)[0];
        const element = document.getElementById(`draft-${first}`) ?? document.querySelector<HTMLInputElement>(`[name="${first}"]`);
        (element ?? errorRef.current)?.focus();
      });
      return;
    }
    const payload: QuoteDraftInput = {
      contact:{ name:values.name, email:values.email, phone:values.phone, siteAddress:values.siteAddress, suburb:values.suburb, postcode:values.postcode, details:values.details, consent:true },
      service:step === 0 ? draft?.payload.service ?? null : { serviceId:"cabinet-painting", intent:values.intent, surfaces:values.surfaces, doorCount:values.doorCount === "" ? null : Number(values.doorCount), drawerCount:values.drawerCount === "" ? null : Number(values.drawerCount), material:values.material, colourPreference:values.colourPreference },
    };
    setBusy(true); setError(""); setNotice("");
    try {
      const body = await request("/api/quote/draft", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ expectedRevision:draft?.revision ?? 0, payload }) });
      const saved = parseDraft(body.draft);
      if (saved.revision < (draft?.revision ?? 0) || (draft && saved.id !== draft.id) || JSON.stringify(saved.payload) !== JSON.stringify(validateQuoteDraft(payload))) {
        throw new Error("The server did not confirm these changes.");
      }
      setDraft(saved);
      if (step === 0) { setStep(1); setNotice("Your details were saved. Choose your service details below."); focusHeading(); }
      else if (demoEnabled) { setStep(2); setNotice("Your service details were saved. Review the demonstration quote to continue."); focusHeading(); }
      else setNotice("Your service details were saved privately. Photo upload and assessment are not available in this preview yet. This draft has not been submitted.");
    } catch (failure) {
      if (failure instanceof DraftRequestError && failure.status === 409) {
        setConflict(true); setError("This draft changed in another tab. Your entries are still on this page and were not overwritten. Load the latest saved draft before editing again.");
      } else if (failure instanceof DraftRequestError && failure.status === 401) {
        setExpired(true); setError("Your private draft session expired. Your entries are still on this page. Reopen the session before saving again.");
      } else setError(errorMessage(failure));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }
  const fieldProps = (field: Field) => ({ id:`draft-${field}`, "aria-invalid":Boolean(errors[field]), "aria-describedby":errors[field] ? `draft-${field}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <span className="enquiry-error" id={`draft-${field}-error`}>{errors[field]}</span> : null;
  const progress = demoEnabled ? ["Your details","Service details","Demo quote","Start date","Review & sign","Submitted"] : QUOTE_PROGRESS;

  return <div className="enquiry-page"><div className="enquiry-shell">
    <a href="/services/cabinet-painting" className="enquiry-back-link">← Kitchen Cabinet Painting</a>
    <section aria-labelledby="draft-title" className="enquiry-card">
      <p className="enquiry-kicker">Kitchen Cabinet Painting · {demoEnabled ? "demonstration" : "private draft"}</p>
      <h1 id="draft-title">Start your cabinet painting quote</h1>
      <p className="enquiry-lead">Save your contact and project details first, then choose the cabinet work you have in mind.</p>
      <p className="enquiry-notice">{demoEnabled ? `DEMO ONLY: prices and terms are sample data, not a real quote or contract. Submit to email a signed demonstration to ${recipientEmail} and save a pending company Calendar entry. Company confirmation is still required. Photo upload and AI assessment are not available yet.` : "This preview saves your details and service choices. Photo upload, AI assessment, pricing, date selection, signing and final email submission will follow. Saving a draft does not request or confirm a booking."}</p>
      <ol className="enquiry-progress quote-draft-progress" aria-label="Quote progress">{progress.map((label,index) => <li key={label} aria-current={index === step ? "step" : undefined} className={index === step ? "active" : ""}>{index+1}. {label}{!demoEnabled && index > 1 && <span className="enquiry-hint"> · Coming later</span>}</li>)}</ol>
      {!ready && !error && <p role="status">Opening your private draft…</p>}
      {error && <div className="enquiry-error-box" ref={errorRef} tabIndex={-1} role="alert">
        <p>{error}</p>
        {(conflict || expired) && <p>Loading an existing saved draft replaces the entries shown here. Copy any changes you want to keep first.</p>}
        {(!ready || conflict || expired) && <button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy} onClick={() => void restoreSaved()}>{busy ? "Loading…" : conflict ? "Load latest saved draft" : expired ? "Reopen private session" : "Retry loading draft"}</button>}
      </div>}
      <p className="quote-draft-status" role="status" aria-live="polite">{notice}</p>
      {step >= 2 && draft ? <DemoQuoteFlow key={`${draft.id}:${draft.revision}`} draft={draft} recipientEmail={recipientEmail} initialSubmission={submission} onEdit={() => { setStep(1); setNotice(""); }} onProgress={setStep} /> : <form onSubmit={save} noValidate>
        <fieldset className="quote-draft-fields" disabled={!ready || busy}>
          {step === 0 ? <div className="enquiry-step">
            <h2 ref={headingRef} tabIndex={-1}>1. Your details</h2>
            <p>Required fields are marked *. Your saved draft is available in this browser for up to 24 hours. It has not been sent for company review.</p>
            <div className="enquiry-grid">
              <label>Your name *<input {...fieldProps("name")} autoComplete="name" maxLength={120} value={values.name} onChange={event => update("name",event.target.value)} />{fieldError("name")}</label>
              <label>Email *<input {...fieldProps("email")} type="email" autoComplete="email" maxLength={254} value={values.email} onChange={event => update("email",event.target.value)} />{fieldError("email")}</label>
              <label>Phone <span className="enquiry-hint">Optional</span><input {...fieldProps("phone")} type="tel" autoComplete="tel" maxLength={40} value={values.phone} onChange={event => update("phone",event.target.value)} /></label>
              <label>Site address *<input {...fieldProps("siteAddress")} autoComplete="street-address" maxLength={240} value={values.siteAddress} onChange={event => update("siteAddress",event.target.value)} />{fieldError("siteAddress")}</label>
              <label>Suburb *<input {...fieldProps("suburb")} autoComplete="address-level2" maxLength={100} value={values.suburb} onChange={event => update("suburb",event.target.value)} />{fieldError("suburb")}</label>
              <label>Postcode *<input {...fieldProps("postcode")} inputMode="numeric" autoComplete="postal-code" maxLength={4} value={values.postcode} onChange={event => update("postcode",event.target.value)} />{fieldError("postcode")}</label>
            </div>
            {demoEnabled && <p className="enquiry-hint">For this demonstration, use {recipientEmail} as the email address. The trial email service can only send to that company account.</p>}
            <label>Project details <span className="enquiry-hint">Optional</span><textarea {...fieldProps("details")} rows={4} maxLength={3000} value={values.details} onChange={event => update("details",event.target.value)} /></label>
            <label className="enquiry-confirm"><input {...fieldProps("consent")} type="checkbox" checked={values.consent} onChange={event => update("consent",event.target.checked)} /> I agree to L&K Group saving these details privately to prepare my quote draft. *</label>{fieldError("consent")}
          </div> : <div className="enquiry-step">
            <h2 ref={headingRef} tabIndex={-1}>2. Service details</h2>
            <fieldset><legend>Choose your service *</legend><div className="enquiry-options"><label><input {...fieldProps("serviceId")} name="serviceId" type="radio" checked={values.serviceId === "cabinet-painting"} onChange={() => update("serviceId","cabinet-painting")} /> Kitchen Cabinet Painting</label></div>{fieldError("serviceId")}</fieldset>
            <p>Painting and touch-ups for existing cabinets. New cabinet manufacture and installation are not included.</p>
            <fieldset><legend>What would you like to do? *</legend><div className="enquiry-options">{INTENTS.map(([value,label]) => <label key={value}><input {...fieldProps("intent")} id={`draft-intent-${value}`} name="intent" type="radio" checked={values.intent === value} onChange={() => update("intent",value)} /> {label}</label>)}</div>{fieldError("intent")}</fieldset>
            <fieldset><legend>Which surfaces are involved? *</legend><div className="enquiry-options">{SURFACES.map(([value,label]) => <label key={value}><input {...fieldProps("surfaces")} id={`draft-surfaces-${value}`} name="surfaces" type="checkbox" checked={values.surfaces.includes(value)} onChange={() => toggleSurface(value)} /> {label}</label>)}</div>{fieldError("surfaces")}</fieldset>
            <div className="enquiry-grid">
              <label>Cabinet doors <span className="enquiry-hint">Leave blank if unknown</span><input {...fieldProps("doorCount")} type="number" min="0" max="500" step="1" value={values.doorCount} onChange={event => update("doorCount",event.target.value)} />{fieldError("doorCount")}</label>
              <label>Drawer fronts <span className="enquiry-hint">Leave blank if unknown</span><input {...fieldProps("drawerCount")} type="number" min="0" max="500" step="1" value={values.drawerCount} onChange={event => update("drawerCount",event.target.value)} />{fieldError("drawerCount")}</label>
              <label>Material <span className="enquiry-hint">Optional; leave blank if unknown</span><input {...fieldProps("material")} maxLength={100} value={values.material} onChange={event => update("material",event.target.value)} /></label>
              <label>Colour or finish idea <span className="enquiry-hint">Optional</span><input {...fieldProps("colourPreference")} maxLength={100} value={values.colourPreference} onChange={event => update("colourPreference",event.target.value)} /></label>
            </div>
            <p className="enquiry-notice">{demoEnabled ? "Photo upload and AI assessment are not available yet. Save these service details to continue with the demonstration quote, preferred date and signature." : "Photo upload is the next part of this step and is not available yet. Save these service details to return to your draft later."}</p>
          </div>}
          <div className="enquiry-actions">
            {step === 1 && <button type="button" className="enquiry-button enquiry-button-secondary" onClick={() => { setStep(0); setErrors({}); focusHeading(); }}>Edit your details</button>}
            <button className="enquiry-button" type="submit" disabled={conflict || expired}>{busy ? "Saving…" : step === 0 ? "Save details and continue" : "Save service details"}</button>
          </div>
        </fieldset>
      </form>}
      {draft && step < 5 && <p className="enquiry-hint quote-draft-saved">Last saved: {new Date(draft.savedAt).toLocaleString("en-AU", {timeZone:"Australia/Sydney"})} (Sydney). Only saved changes are restored when you reopen this page.</p>}
    </section>
  </div></div>;
}
