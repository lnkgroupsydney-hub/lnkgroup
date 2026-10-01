"use client";

import { useRef, useState } from "react";
import type { EnquiryInput } from "@/modules/operations";
import "./enquiry-form.css";

type FormValues = Omit<EnquiryInput, "serviceId" | "acknowledgement" | "idempotencyKey" | "doorCount" | "drawerCount"> & {
  doorCount: string;
  drawerCount: string;
  acknowledgement: boolean;
};
type Field = keyof FormValues;
type Errors = Partial<Record<Field, string>>;

const intents = [
  ["full-repainting", "Full cabinet repainting"],
  ["partial-touch-ups", "Partial painting or touch-ups"],
  ["colour-change", "Colour change"],
  ["advice", "I need advice"],
] as const;
const surfaces = [
  ["doors", "Cabinet doors"], ["drawers", "Drawer fronts"],
  ["frames", "Exposed frames"], ["panels", "End panels"],
  ["repairs", "Areas needing repair"], ["unknown", "Not sure yet"],
] as const;
const initialValues: FormValues = {
  projectIntent: "",
  targetSurfaces: [],
  suburb: "",
  postcode: "",
  doorCount: "",
  drawerCount: "",
  material: "",
  colourPreference: "",
  notes: "",
  name: "",
  email: "",
  phone: "",
  siteAddress: "",
  preferredDate: null,
  acknowledgement: false,
};

function readError(response: Response, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return `The request could not be saved (HTTP ${response.status}). Please retry.`;
}

export function EnquiryForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ reference: string; status: string } | null>(null);
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  function update<K extends Field>(field: K, value: FormValues[K]) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSubmitError("");
  }

  function toggleSurface(surface: string) {
    update("targetSurfaces", values.targetSurfaces.includes(surface)
      ? values.targetSurfaces.filter((item) => item !== surface)
      : surface === "unknown" ? ["unknown"] : [...values.targetSurfaces.filter((item) => item !== "unknown"), surface]);
  }

  function validate(targetStep: number): Errors {
    const next: Errors = {};
    if (targetStep === 0) {
      if (!values.projectIntent) next.projectIntent = "Choose what you want to do.";
      if (!values.targetSurfaces.length) next.targetSurfaces = "Choose at least one surface or Not sure yet.";
      if (!values.suburb.trim()) next.suburb = "Enter your suburb.";
      if (!/^\d{4}$/.test(values.postcode.trim())) next.postcode = "Enter a four-digit postcode.";
      for (const field of ["doorCount", "drawerCount"] as const) {
        if (values[field] && (!/^\d+$/.test(values[field]) || Number(values[field]) > 500)) {
          next[field] = "Enter a whole number from 0 to 500, or leave blank if unknown.";
        }
      }
    }
    if (targetStep === 1) {
      if (!values.name.trim()) next.name = "Enter your name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = "Enter a valid email address.";
      if (values.preferredDate && values.preferredDate < new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })) {
        next.preferredDate = "Choose today or a future date, or leave it undecided.";
      }
    }
    if (targetStep === 2 && !values.acknowledgement) next.acknowledgement = "Confirm that this is a request, not a booking.";
    return next;
  }

  function showErrors(next: Errors) {
    setErrors(next);
    window.requestAnimationFrame(() => {
      const first = Object.keys(next)[0];
      const input = first ? (document.getElementById(`enquiry-${first}`) ?? document.querySelector<HTMLInputElement>(`[name="${first}"]`)) : null;
      (input ?? errorRef.current)?.focus();
    });
  }

  function goNext() {
    const next = validate(step);
    if (Object.keys(next).length) { showErrors(next); return; }
    setErrors({});
    setStep((previous) => previous + 1);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function goBack() {
    setErrors({});
    setSubmitError("");
    setStep((previous) => Math.max(0, previous - 1));
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function submit() {
    const next = validate(2);
    if (Object.keys(next).length) { showErrors(next); return; }
    const projectErrors = validate(0);
    const contactErrors = validate(1);
    if (Object.keys(projectErrors).length || Object.keys(contactErrors).length) {
      const firstStep = Object.keys(projectErrors).length ? 0 : 1;
      setStep(firstStep);
      window.requestAnimationFrame(() => showErrors(firstStep === 0 ? projectErrors : contactErrors));
      return;
    }
    const payloadWithoutKey = {
      serviceId: "cabinet-painting" as const,
      projectIntent: values.projectIntent,
      targetSurfaces: values.targetSurfaces,
      suburb: values.suburb.trim(),
      postcode: values.postcode.trim(),
      doorCount: values.doorCount === "" ? null : Number(values.doorCount),
      drawerCount: values.drawerCount === "" ? null : Number(values.drawerCount),
      material: values.material?.trim(),
      colourPreference: values.colourPreference?.trim(),
      notes: values.notes?.trim(),
      name: values.name.trim(),
      email: values.email.trim(),
      phone: values.phone?.trim(),
      siteAddress: values.siteAddress?.trim(),
      preferredDate: values.preferredDate,
      acknowledgement: true as const,
    };
    const fingerprint = JSON.stringify(payloadWithoutKey);
    if (idempotencyRef.current?.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    const payload: EnquiryInput = { ...payloadWithoutKey, idempotencyKey: idempotencyRef.current.key };
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readError(response, body));
      if (!body || typeof body !== "object" || !("status" in body) || body.status !== "submitted" || !("reference" in body) || typeof body.reference !== "string") {
        throw new Error("The server did not confirm that this request was stored. Please retry.");
      }
      setReceipt({ reference: body.reference, status: body.status });
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The request could not be saved. Please retry.");
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (field: Field) => errors[field] ? <span className="enquiry-error" id={`enquiry-${field}-error`}>{errors[field]}</span> : null;
  const fieldProps = (field: Field) => ({ id: `enquiry-${field}`, "aria-invalid": Boolean(errors[field]) as boolean,
    "aria-describedby": errors[field] ? `enquiry-${field}-error` : undefined });

  return (
    <div className="enquiry-page">
      <div className="enquiry-shell">
        <a href="/services/cabinet-painting" className="enquiry-back-link">← Kitchen Cabinet Painting</a>
        {receipt ? (
          <section aria-labelledby="enquiry-title" className="enquiry-card" role="status">
            <p className="enquiry-kicker">Request recorded</p>
            <h1 id="enquiry-title" ref={headingRef} tabIndex={-1}>Thank you. Your request is recorded.</h1>
            <p>Your reference is <strong>{receipt.reference}</strong>. The team still needs to review the scope and contact you. No price or work date has been confirmed, and no email has been sent by this preview.</p>
            <p>Your request is saved privately for company review. Keep your reference for follow-up.</p>
            <a className="enquiry-button" href="/services/cabinet-painting">Back to Kitchen Cabinet Painting</a>
          </section>
        ) : (
          <section aria-labelledby="enquiry-title" className="enquiry-card">
            <p className="enquiry-kicker">Kitchen Cabinet Painting · request for review</p>
            <h1 id="enquiry-title">Tell us about your existing cabinets</h1>
            <p className="enquiry-lead">Share the scope you have in mind. L&K Group will need to assess the surfaces before providing a price or confirming dates.</p>
            <p className="enquiry-notice">Your request is saved privately for company review. It does not send an email, upload photos, calculate a price or make a booking. Photos can be discussed with the team later.</p>
            <ol className="enquiry-progress" aria-label="Request progress">
              {["Project", "Contact & date", "Review"].map((label, index) => (
                <li key={label} aria-current={step === index ? "step" : undefined} className={step === index ? "active" : ""}>{index + 1}. {label}</li>
              ))}
            </ol>
            {step === 0 && <div className="enquiry-step">
              <h2 ref={headingRef} tabIndex={-1}>Your project</h2>
              <fieldset aria-describedby={errors.projectIntent ? "enquiry-projectIntent-error" : undefined}>
                <legend>What would you like to do? <span aria-hidden="true">*</span></legend>
                <div className="enquiry-options">{intents.map(([value, label]) => <label key={value}><input {...fieldProps("projectIntent")} id={`enquiry-projectIntent-${value}`} type="radio" name="projectIntent" value={value} checked={values.projectIntent === value} onChange={() => update("projectIntent", value)} /> {label}</label>)}</div>
                {fieldError("projectIntent")}
              </fieldset>
              <fieldset aria-describedby={errors.targetSurfaces ? "enquiry-targetSurfaces-error" : undefined}>
                <legend>Which surfaces are involved? <span aria-hidden="true">*</span></legend>
                <div className="enquiry-options">{surfaces.map(([value, label]) => <label key={value}><input {...fieldProps("targetSurfaces")} id={`enquiry-targetSurfaces-${value}`} type="checkbox" name="targetSurfaces" value={value} checked={values.targetSurfaces.includes(value)} onChange={() => toggleSurface(value)} /> {label}</label>)}</div>
                {fieldError("targetSurfaces")}
              </fieldset>
              <div className="enquiry-grid">
                <label>Suburb <span aria-hidden="true">*</span><input {...fieldProps("suburb")} aria-label="Suburb" autoComplete="address-level2" maxLength={100} value={values.suburb} onChange={(event) => update("suburb", event.target.value)} />{fieldError("suburb")}</label>
                <label>Postcode <span aria-hidden="true">*</span><input {...fieldProps("postcode")} aria-label="Postcode" inputMode="numeric" autoComplete="postal-code" maxLength={4} value={values.postcode} onChange={(event) => update("postcode", event.target.value)} />{fieldError("postcode")}</label>
                <label>Cabinet doors <span className="enquiry-hint">Leave blank if unknown</span><input {...fieldProps("doorCount")} aria-label="Cabinet doors" type="number" min="0" max="500" step="1" value={values.doorCount} onChange={(event) => update("doorCount", event.target.value)} />{fieldError("doorCount")}</label>
                <label>Drawer fronts <span className="enquiry-hint">Leave blank if unknown</span><input {...fieldProps("drawerCount")} aria-label="Drawer fronts" type="number" min="0" max="500" step="1" value={values.drawerCount} onChange={(event) => update("drawerCount", event.target.value)} />{fieldError("drawerCount")}</label>
                <label>Material <span className="enquiry-hint">Optional; leave blank if unknown</span><input {...fieldProps("material")} maxLength={100} value={values.material} onChange={(event) => update("material", event.target.value)} /></label>
                <label>Colour or finish idea <span className="enquiry-hint">Optional</span><input {...fieldProps("colourPreference")} maxLength={100} value={values.colourPreference} onChange={(event) => update("colourPreference", event.target.value)} /></label>
              </div>
              <label>Anything else we should know? <span className="enquiry-hint">Optional</span><textarea {...fieldProps("notes")} rows={4} maxLength={3000} value={values.notes} onChange={(event) => update("notes", event.target.value)} /></label>
            </div>}
            {step === 1 && <div className="enquiry-step">
              <h2 ref={headingRef} tabIndex={-1}>Contact and preferred date</h2>
              <p>A preferred date is only a request. Scheduling will be reviewed by the team.</p>
              <div className="enquiry-grid">
                <label>Your name <span aria-hidden="true">*</span><input {...fieldProps("name")} aria-label="Your name" autoComplete="name" maxLength={120} value={values.name} onChange={(event) => update("name", event.target.value)} />{fieldError("name")}</label>
                <label>Email <span aria-hidden="true">*</span><input {...fieldProps("email")} aria-label="Email" type="email" autoComplete="email" maxLength={254} value={values.email} onChange={(event) => update("email", event.target.value)} />{fieldError("email")}</label>
                <label>Phone <span className="enquiry-hint">Optional</span><input {...fieldProps("phone")} type="tel" autoComplete="tel" maxLength={40} value={values.phone} onChange={(event) => update("phone", event.target.value)} /></label>
                <label>Preferred date <span className="enquiry-hint">Optional</span><input {...fieldProps("preferredDate")} type="date" value={values.preferredDate ?? ""} onInput={(event) => update("preferredDate", event.currentTarget.value || null)} onChange={(event) => update("preferredDate", event.target.value || null)} />{fieldError("preferredDate")}</label>
              </div>
              <label>Site address <span className="enquiry-hint">Optional at this stage</span><input {...fieldProps("siteAddress")} autoComplete="street-address" maxLength={240} value={values.siteAddress} onChange={(event) => update("siteAddress", event.target.value)} /></label>
            </div>}
            {step === 2 && <div className="enquiry-step">
              <h2 ref={headingRef} tabIndex={-1}>Review your request</h2>
              <dl className="enquiry-review">
                <div><dt>Project</dt><dd>{intents.find(([value]) => value === values.projectIntent)?.[1]}</dd></div>
                <div><dt>Surfaces</dt><dd>{values.targetSurfaces.map((value) => surfaces.find(([item]) => item === value)?.[1] ?? value).join(", ")}</dd></div>
                <div><dt>Location</dt><dd>{values.suburb}, {values.postcode}</dd></div>
                <div><dt>Doors / drawers</dt><dd>{values.doorCount || "Unknown"} / {values.drawerCount || "Unknown"}</dd></div>
                <div><dt>Material / colour</dt><dd>{values.material || "Unknown"} / {values.colourPreference || "Undecided"}</dd></div>
                <div><dt>Contact</dt><dd>{values.name} · {values.email}{values.phone ? ` · ${values.phone}` : ""}</dd></div>
                <div><dt>Preferred date</dt><dd>{values.preferredDate || "Undecided"}</dd></div>
                {values.siteAddress && <div><dt>Site address</dt><dd>{values.siteAddress}</dd></div>}
                {values.notes && <div><dt>Notes</dt><dd>{values.notes}</dd></div>}
              </dl>
              <label className="enquiry-confirm"><input {...fieldProps("acknowledgement")} type="checkbox" checked={values.acknowledgement} onChange={(event) => update("acknowledgement", event.target.checked)} /> I understand this is a request for review, not a quote or confirmed booking.</label>
              {fieldError("acknowledgement")}
              {submitError && <div className="enquiry-error-box" ref={errorRef} tabIndex={-1} role="alert">{submitError} Your entries are still here; retrying will not create a second request.</div>}
            </div>}
            <div className="enquiry-actions">
              {step > 0 && <button type="button" className="enquiry-button enquiry-button-secondary" onClick={goBack} disabled={submitting}>Back</button>}
              {step < 2 ? <button type="button" className="enquiry-button" onClick={goNext}>Continue</button> : <button type="button" className="enquiry-button" onClick={submit} disabled={submitting}>{submitting ? "Saving request…" : "Submit request"}</button>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
