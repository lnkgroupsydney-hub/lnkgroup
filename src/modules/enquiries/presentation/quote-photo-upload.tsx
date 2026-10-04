"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PHOTO_NOTICE_VERSION, QUOTE_PHOTO_LIMITS, type QuotePhoto, type QuotePhotoList, type QuotePhotoManifestEntry } from "../domain/quote-photos";
import "./quote-photo-upload.css";

type LocalPhoto = {
  key: string; file: File; status: "waiting" | "checking" | "uploading" | "error";
  error: string; photoId?: string; reservation?: Record<string, unknown>; reservationUncertain?: boolean; rejected?: boolean;
};
class PhotoRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function failureMessage(failure: unknown) {
  return failure instanceof Error && !(failure instanceof TypeError) && failure.name !== "TimeoutError" ? failure.message : "The photo could not be confirmed as saved. Refresh the list or retry the same file.";
}
async function photoRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new PhotoRequestError(response.status, record(body) && typeof body.error === "string" ? body.error : "Photo storage is unavailable. Please retry.", record(body) && typeof body.code === "string" ? body.code : undefined);
  if (!record(body)) throw new Error("Invalid photo response.");
  return body;
}
const PHOTO_STATES = ["pending", "processing", "attached", "rejected", "retryable_error", "delete_pending", "deleted"];
function parsePhoto(value: unknown): QuotePhoto {
  if (!record(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(value.id) || !PHOTO_STATES.includes(String(value.status)) || !Number.isSafeInteger(value.inputBytes) || Number(value.inputBytes) < 1) throw new Error("The saved photo list could not be verified.");
  if (value.status === "attached" && (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash) || typeof value.processingVersion !== "string" || !value.processingVersion || !Number.isSafeInteger(value.width) || Number(value.width) < 1 || !Number.isSafeInteger(value.height) || Number(value.height) < 1)) throw new Error("The saved photo details could not be verified.");
  return value as unknown as QuotePhoto;
}
function parseRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("The saved photo version could not be verified.");
  return Number(value);
}
function parseList(value: Record<string, unknown>): QuotePhotoList {
  if (!Array.isArray(value.photos) || typeof value.submitted !== "boolean") throw new Error("The photo list could not be verified.");
  return { photos: value.photos.map(parsePhoto), draftRevision: parseRevision(value.draftRevision), submitted: value.submitted };
}
export function photoManifest(photos: QuotePhoto[]): QuotePhotoManifestEntry[] {
  return photos.filter(photo => photo.status === "attached").map(photo => ({photoId: photo.id, contentHash: photo.contentHash!, processingVersion: photo.processingVersion!}));
}
function stateLabel(photo: QuotePhoto) {
  return { pending: "Upload not completed", processing: "Processing — refresh to check", attached: "Saved privately", rejected: "File rejected — remove this item", retryable_error: "Upload interrupted — retry or remove", delete_pending: "Removal is being completed", deleted: "Removed" }[photo.status];
}
function preliminaryError(file: File) {
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) return "HEIC/HEIF is not supported yet. Convert this photo to JPEG or PNG, then choose it again.";
  if (!/\.(jpe?g|png|webp)$/i.test(file.name) || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPEG, PNG or still WebP image. Other files cannot be uploaded.";
  if (file.size === 0 || file.size > QUOTE_PHOTO_LIMITS.maxInputBytes) return `Choose a photo larger than 0 bytes and no larger than ${QUOTE_PHOTO_LIMITS.maxInputBytes / 1024 / 1024} MB.`;
  return "";
}

export function QuotePhotoUpload({ draftRevision, demoEnabled, onRevision, onContinue, onEdit }: {
  draftRevision: number; demoEnabled: boolean;
  onRevision: (revision: number) => void;
  onContinue: (photos: QuotePhotoManifestEntry[], revision: number) => Promise<void>;
  onEdit: () => Promise<void>;
}) {
  const [photos, setPhotos] = useState<QuotePhoto[]>([]);
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false), [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const revision = useRef(draftRevision), active = useRef(true), locked = useRef(false), requestVersion = useRef(0);
  const onRevisionRef = useRef(onRevision);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { onRevisionRef.current = onRevision; }, [onRevision]);
  function acceptRevision(value: number) { revision.current = Math.max(revision.current, value); if (active.current) onRevisionRef.current(revision.current); }
  function updateLocal(key: string, update: Partial<LocalPhoto>) { if (active.current) setLocalPhotos(current => current.map(photo => photo.key === key ? { ...photo, ...update } : photo)); }
  async function refresh() {
    const version = ++requestVersion.current;
    const result = parseList(await photoRequest("/api/quote/photos"));
    if (active.current && version === requestVersion.current) {
      setPhotos(result.photos); setSubmitted(result.submitted); setLoaded(true); acceptRevision(result.draftRevision);
    }
    return result;
  }
  useEffect(() => {
    active.current = true;
    headingRef.current?.focus();
    void refresh().catch(failure => { if (active.current) setError(failureMessage(failure)); }).finally(() => { if (active.current) setLoading(false); });
    return () => { active.current = false; };
    // This component is keyed by draft ID. A revision update must preserve selected files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!photos.some(photo => ["pending", "processing", "delete_pending"].includes(photo.status))) return;
    const timer = window.setInterval(() => {
      if (!locked.current) void refresh().catch(failure => { if (active.current) setError(failureMessage(failure)); });
    }, 5000);
    return () => window.clearInterval(timer);
    // Refresh always reads the current revision and callback through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);
  async function upload(item: LocalPhoto) {
    updateLocal(item.key, {status: "checking", error: ""});
    try {
      if (!item.reservation) {
        const digest = await crypto.subtle.digest("SHA-256", await item.file.arrayBuffer());
        const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        item.reservation = {expectedRevision: revision.current, noticeVersion: PHOTO_NOTICE_VERSION, noticeAccepted: true, fileName: item.file.name, mimeType: item.file.type, inputBytes: item.file.size, sourceHash, idempotencyKey: item.key};
        updateLocal(item.key, {reservation: item.reservation});
      }
      if (!item.photoId) {
        const reserved = await photoRequest("/api/quote/photos", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(item.reservation)});
        item.photoId = parsePhoto(reserved.photo).id; acceptRevision(parseRevision(reserved.draftRevision));
        updateLocal(item.key, {photoId: item.photoId});
      }
      updateLocal(item.key, {status: "uploading"});
      const saved = await photoRequest(`/api/quote/photos/${encodeURIComponent(item.photoId)}/content`, {method: "PUT", headers: {"Content-Type": item.file.type}, body: item.file});
      if (parsePhoto(saved.photo).status !== "attached") throw new Error("Photo processing has not finished.");
      acceptRevision(parseRevision(saved.draftRevision));
      await refresh();
      if (active.current) { setLocalPhotos(current => current.filter(photo => photo.key !== item.key)); setNotice("Your photo was saved privately. Review all saved photos before continuing."); }
    } catch (failure) {
      // A definite first rejection has no reservation to delete. Once any response
      // was lost, retain the exact key/body until the server resolves that outcome.
      if (!item.photoId) {
        const definiteRejection = failure instanceof PhotoRequestError && failure.status >= 400 && failure.status < 500;
        if (definiteRejection && (!item.reservationUncertain || failure.status === 409)) {
          item.reservation = undefined; item.reservationUncertain = false;
          updateLocal(item.key, {reservation: undefined, reservationUncertain: false});
        } else if (item.reservation) {
          item.reservationUncertain = true; updateLocal(item.key, {reservationUncertain: true});
        }
      }
      const rejected = failure instanceof PhotoRequestError && ["source_mismatch", "invalid_image", "unsupported_image", "input_too_large", "image_too_large", "content_conflict"].includes(failure.code ?? "");
      updateLocal(item.key, {status: "error", error: failureMessage(failure), rejected});
      try { await refresh(); } catch { if (active.current) setError("The saved photo list could not be refreshed. Keep this page open and retry."); }
    }
  }
  async function run(items: LocalPhoto[]) {
    if (locked.current || submitted || !noticeAccepted) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try { for (const item of items) { if (!active.current) break; if (item.status !== "error") await upload({...item}); } }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!files.length || locked.current || !noticeAccepted || !loaded || submitted) return;
    const occupied = photos.filter(photo => photo.status !== "deleted").length + localPhotos.filter(photo => !photo.photoId).length;
    if (occupied + files.length > QUOTE_PHOTO_LIMITS.maxFiles) { setError(`Choose fewer photos. This demonstration allows up to ${QUOTE_PHOTO_LIMITS.maxFiles} photos including unfinished uploads.`); return; }
    const items: LocalPhoto[] = files.map(file => { const error = preliminaryError(file); return {key: crypto.randomUUID(), file, status: error ? "error" : "waiting", error}; });
    setLocalPhotos(current => [...current, ...items]); void run(items);
  }
  async function remove(photoId?: string, localKey?: string) {
    if (locked.current || submitted) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const local = localPhotos.find(item => item.key === localKey);
      if (!photoId && local?.reservation) {
        // The reservation may have succeeded even when its response was lost.
        // Resolve the original key/body before deleting; never guess from the list.
        const reserved = await photoRequest("/api/quote/photos", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(local.reservation)});
        photoId = parsePhoto(reserved.photo).id; acceptRevision(parseRevision(reserved.draftRevision));
        updateLocal(local.key, {photoId});
      }
      if (photoId) {
        const result = await photoRequest(`/api/quote/photos/${encodeURIComponent(photoId)}`, {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({expectedRevision: revision.current})});
        parsePhoto(result.photo); acceptRevision(parseRevision(result.draftRevision));
      }
      const latest = await refresh();
      if (active.current) {
        if (localKey) setLocalPhotos(current => current.filter(photo => photo.key !== localKey));
        setNotice(photoId && latest.photos.some(photo => photo.id === photoId) ? "Removal was recorded. Storage cleanup is still in progress; the saved list will refresh shortly." : "The selected item was removed. Saved photos are listed below.");
      }
    } catch (failure) {
      if (active.current) setError(failureMessage(failure));
      // Retain the selected file and recovered ID until deletion is confirmed.
      try { await refresh(); } catch { /* Keep the original operation error visible. */ }
    }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function checkAndContinue() {
    if (locked.current || localPhotos.length) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const latest = await refresh();
      if (latest.photos.some(photo => photo.status !== "attached")) throw new PhotoRequestError(409, "Finish, retry or remove every unfinished photo before continuing.");
      await onContinue(photoManifest(latest.photos), latest.draftRevision);
    } catch (failure) { if (active.current) setError(failureMessage(failure)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function refreshList() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await refresh(); }
    catch (failure) { if (active.current) setError(failureMessage(failure)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function editDetails() {
    if (locked.current || localPhotos.length || submitted) return;
    locked.current = true; setBusy(true); setError("");
    try { await onEdit(); }
    catch (failure) { if (active.current) setError(failureMessage(failure)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  const unfinished = photos.some(photo => photo.status !== "attached") || localPhotos.length > 0;
  const savedCount = photos.filter(photo => photo.status === "attached").length;
  const linkedLocalIds = new Set(localPhotos.map(photo => photo.photoId).filter(Boolean));
  return <div className="enquiry-step quote-photos">
    <h2 ref={headingRef} tabIndex={-1}>3. Service photos</h2>
    <p>Add an overall view, close-ups of the surface and any damaged areas. You may continue without photos for company review. No AI assessment is performed in this demonstration.</p>
    <p className="enquiry-hint">Demonstration limit: {QUOTE_PHOTO_LIMITS.maxFiles} photos, up to {QUOTE_PHOTO_LIMITS.maxInputBytes / 1024 / 1024} MB each ({QUOTE_PHOTO_LIMITS.maxTotalInputBytes / 1024 / 1024} MB total). JPEG, PNG and still WebP only. Convert HEIC/HEIF to JPEG or PNG first. Avoid including people or personal documents.</p>
    <label className="enquiry-confirm"><input type="checkbox" checked={noticeAccepted} disabled={busy || submitted} onChange={event => setNoticeAccepted(event.target.checked)} /> I have permission to share these photos and agree to their private storage for L&amp;K to review this service request. Photos are not sent to AI or used for marketing.</label>
    <p className="enquiry-hint">Saved photos have location metadata removed and may be resized. Only successfully saved photos return after a refresh; unfinished files must be chosen again. Changing photos requires a fresh quote approval and signature.</p>
    {loading && <p role="status">Loading your saved photos…</p>}
    {error && <p className="enquiry-error-box" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {submitted && <p className="enquiry-notice">This request has already been submitted. Its signed photo list is preserved and cannot be edited.</p>}
    <div className="quote-photo-picker"><label>Choose photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!noticeAccepted || busy || !loaded || submitted} onChange={choose} /></label><label>Take a photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!noticeAccepted || busy || !loaded || submitted} onChange={choose} /></label></div>
    <p role="status" aria-live="polite">{savedCount} {savedCount === 1 ? "photo" : "photos"} saved privately{busy ? " · Please wait while the current operation finishes." : ""}</p>
    <ul className="quote-photo-list">
      {photos.filter(photo => !linkedLocalIds.has(photo.id)).map((photo, index) => <li key={photo.id}>
        {photo.status === "attached" && <Image unoptimized src={`/api/quote/photos/${encodeURIComponent(photo.id)}/content`} width={240} height={180} alt={`Saved service photo ${index + 1}`} className="quote-photo-thumbnail" />}
        <strong>Photo {index + 1}</strong><span>{stateLabel(photo)}</span><span className="enquiry-hint">Reference: {photo.id}</span>
        {photo.status !== "attached" && photo.status !== "delete_pending" && <p className="enquiry-hint">After a refresh, an unfinished photo must be removed and selected again. The original file is not kept by this page.</p>}
        <button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || submitted || photo.status === "processing" || photo.status === "delete_pending"} onClick={() => void remove(photo.id)}>Remove photo {index + 1}</button>
      </li>)}
      {localPhotos.map(item => {
        const saved = photos.find(photo => photo.id === item.photoId);
        const rejected = item.rejected || saved?.status === "rejected";
        const processing = saved?.status === "processing" || saved?.status === "delete_pending";
        return <li key={item.key}><strong>{item.file.name}</strong><span>{rejected ? "File rejected — remove this item" : item.status === "error" ? "Not confirmed as saved" : item.status === "checking" ? "Checking file…" : item.status === "uploading" ? "Uploading and validating…" : "Waiting to upload"}</span>{item.error && <p className="enquiry-error" role="status">{item.error}</p>}{rejected && <p className="enquiry-hint">Remove this rejected upload, then choose a corrected or different photo. Retrying the same file cannot resolve this rejection.</p>}{processing && <p className="enquiry-hint">The server is still processing this item. Refresh its saved status before retrying or removing it.</p>}<div className="quote-photo-actions">{item.status === "error" && !preliminaryError(item.file) && !rejected && !processing && <button type="button" className="enquiry-button" disabled={busy || !noticeAccepted || submitted} onClick={() => void run([{...item, status: "waiting"}])}>Retry {item.file.name}</button>}<button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || submitted || processing} onClick={() => void remove(item.photoId, item.key)}>Remove {item.file.name}</button></div></li>;
      })}
    </ul>
    {unfinished && <p className="enquiry-notice">Retry or remove unfinished items before continuing. Photos saved successfully will be kept.</p>}
    <div className="enquiry-actions"><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy || localPhotos.length > 0 || submitted} onClick={() => void editDetails()}>Edit service details</button><button type="button" className="enquiry-button enquiry-button-secondary" disabled={busy} onClick={() => void refreshList()}>Refresh saved photos</button>{(demoEnabled || submitted) && <button type="button" className="enquiry-button" disabled={busy || !loaded || unfinished} onClick={() => void checkAndContinue()}>{busy ? "Checking…" : submitted ? "Restore submitted request" : savedCount ? "Continue with saved photos" : "Continue without photos"}</button>}</div>
    {!demoEnabled && !submitted && <p className="enquiry-notice">Your saved service details and photos can be restored in this browser. Assessment and submission are not enabled for this preview.</p>}
  </div>;
}
