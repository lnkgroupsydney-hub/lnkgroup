import type {
  GmailEnquiryCandidate,
  GmailEnquiryPage,
  GmailLabelOption,
} from "../domain/enquiry-candidate.ts";

export type AuthenticatedGmailRequest = (
  /** Path relative to https://gmail.googleapis.com/gmail/v1/users/me */
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export type GmailErrorCode =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "not_found"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "payload_too_large"
  | "invalid_label"
  | "gmail_invalid_page_token"
  | "google_reconnect_required"
  | "google_temporary"
  | "google_configuration"
  | "google_permission_denied"
  | "google_invalid_response"
  | "google_not_connected"
  | "google_connection_changed";

export class GmailApiError extends Error {
  readonly code: GmailErrorCode;
  readonly stage: "labels" | "list" | "message";
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: GmailErrorCode,
    stage: "labels" | "list" | "message",
    status: number | null,
    retryable: boolean,
  ) {
    // Provider responses, URLs and email content may contain private data.
    super(`Gmail ${stage} failed: ${code}`);
    this.name = "GmailApiError";
    this.code = code;
    this.stage = stage;
    this.status = status;
    this.retryable = retryable;
  }
}

interface GmailPart {
  mimeType?: unknown;
  filename?: unknown;
  headers?: unknown;
  body?: unknown;
  parts?: unknown;
}

const MAX_LABEL_JSON_BYTES = 2_000_000;
const MAX_LIST_JSON_BYTES = 1_000_000;
const MAX_MESSAGE_JSON_BYTES = 3_000_000;
const MAX_PARTS = 200;
const MAX_BODY_BYTES = 100_000;
const MAX_BODY_CHARS = 12_000;
const MAX_ERROR_JSON_BYTES = 16_384;
const GOOGLE_TRANSPORT_CODES = new Set<GmailErrorCode>([
  "google_reconnect_required", "google_temporary", "google_configuration",
  "google_permission_denied", "google_invalid_response", "google_not_connected",
  "google_connection_changed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, limit);
}

function apiError(status: number, stage: GmailApiError["stage"]): GmailApiError {
  if (status === 401) return new GmailApiError("unauthorized", stage, status, false);
  if (status === 403) return new GmailApiError("forbidden", stage, status, false);
  if (status === 429) return new GmailApiError("rate_limited", stage, status, true);
  if (status === 404) return new GmailApiError("not_found", stage, status, false);
  if (status >= 500) return new GmailApiError("server_error", stage, status, true);
  return new GmailApiError("http_error", stage, status, false);
}

async function requestJson(
  request: AuthenticatedGmailRequest,
  path: string,
  stage: GmailApiError["stage"],
  maxBytes: number,
  hasPageToken = false,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(path, { method: "GET" });
  } catch (error) {
    if (isRecord(error) && typeof error.code === "string" &&
        GOOGLE_TRANSPORT_CODES.has(error.code as GmailErrorCode)) {
      const code = error.code as GmailErrorCode;
      throw new GmailApiError(code, stage,
        typeof error.status === "number" && Number.isInteger(error.status) ? error.status : null,
        code === "google_temporary" || code === "google_connection_changed");
    }
    throw new GmailApiError("network_error", stage, null, true);
  }
  if (!response.ok) {
    if (response.status === 400 && stage === "list" && hasPageToken) {
      let details: unknown;
      try { details = await readBoundedJson(response, stage, MAX_ERROR_JSON_BYTES); } catch { /* Keep the original HTTP classification. */ }
      if (invalidPageToken(details)) throw new GmailApiError("gmail_invalid_page_token", stage, 400, false);
    }
    throw apiError(response.status, stage);
  }
  return readBoundedJson(response, stage, maxBytes);
}

function invalidPageToken(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.error)) return false;
  const error = data.error;
  const isSpecificMessage = (value: unknown) => typeof value === "string" &&
    /^invalid page\s?token\.?$/i.test(value.trim());
  if (isSpecificMessage(error.message)) return true;
  return Array.isArray(error.errors) && error.errors.some((item: unknown) =>
    isRecord(item) && (isSpecificMessage(item.message) ||
      (item.location === "pageToken" && ["invalid", "invalidArgument", "badRequest"].includes(String(item.reason)))));
}

async function readBoundedJson(response: Response, stage: GmailApiError["stage"], maxBytes: number): Promise<unknown> {

  // A successful provider response still has a hard cap before JSON parsing.
  const reader = response.body?.getReader();
  if (!reader) throw new GmailApiError("invalid_response", stage, response.status, false);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GmailApiError("payload_too_large", stage, response.status, false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof GmailApiError) throw error;
    throw new GmailApiError("network_error", stage, null, true);
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as unknown;
  } catch {
    throw new GmailApiError("invalid_response", stage, response.status, false);
  }
}

/** Only user-created labels are offered so an entire system Inbox cannot be selected. */
export async function listGmailLabels({
  request,
}: {
  request: AuthenticatedGmailRequest;
}): Promise<GmailLabelOption[]> {
  const data = await requestJson(request, "/labels", "labels", MAX_LABEL_JSON_BYTES);
  if (!isRecord(data) || !Array.isArray(data.labels)) {
    throw new GmailApiError("invalid_response", "labels", 200, false);
  }
  return data.labels
    .filter(isRecord)
    .filter((label) => label.type === "user")
    .filter((label) => typeof label.id === "string" && typeof label.name === "string")
    .map((label) => ({
      id: clean(label.id, 256),
      name: clean(label.name, 240),
    }))
    .filter((label) => label.id !== "" && label.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function header(part: GmailPart, name: string): string {
  if (!Array.isArray(part.headers)) return "";
  const item = part.headers.find(
    (value) => isRecord(value) && typeof value.name === "string" && value.name.toLowerCase() === name,
  );
  return isRecord(item) ? clean(item.value, name === "subject" ? 300 : 500) : "";
}

function sender(from: string): { name: string | null; email: string | null } {
  // Reject controls, multiple mailbox syntax and display-only strings. Never
  // treat the From header as proof of identity or a customer merge key.
  const text = clean(from, 500);
  const match = /^(?:"([^"<>]*)"|([^"<>]*))\s*<([^<>\s,;]+@[^<>\s,;]+)>$/.exec(text);
  const bare = /^[^<>\s,;]+@[^<>\s,;]+$/.test(text) ? text : null;
  const email = (match?.[3] ?? bare)?.toLowerCase() ?? null;
  const validEmail = email && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)
    ? email
    : null;
  const name = match ? clean(match[1] ?? match[2], 160) : "";
  return { name: name || null, email: validEmail };
}

function decodeBase64Url(value: unknown, maxBytes: number): Uint8Array | null {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes * 4 / 3) + 4) return null;
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.length % 4 === 1) return null;
  const unpadded = value.replace(/=+$/, "");
  const bytes = Buffer.from(unpadded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length > maxBytes || bytes.toString("base64url") !== unpadded) return null;
  return bytes;
}

function decodeBody(part: GmailPart): string | null {
  if (!isRecord(part.body) || typeof part.body.data !== "string") return null;
  const bytes = decodeBase64Url(part.body.data, MAX_BODY_BYTES);
  if (!bytes) return null;
  const contentType = header(part, "content-type");
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  // Scan once: malformed HTML such as thousands of unmatched '<' characters
  // must not cause repeated full-suffix regex searches on the request thread.
  const output: string[] = [];
  const hidden = new Set(["script", "style", "head", "svg", "noscript"]);
  const breaks = new Set(["br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]);
  let hiddenTag: string | null = null;
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") {
      if (!hiddenTag) output.push(html[i]);
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const commentEnd = html.indexOf("-->", i + 4);
      if (commentEnd < 0) break;
      i = commentEnd + 2;
      continue;
    }
    let end = i + 1;
    let quote: string | null = null;
    while (end < html.length) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      end++;
    }
    if (end === html.length) break;
    let cursor = i + 1;
    while (cursor < end && /\s/.test(html[cursor])) cursor++;
    const closing = html[cursor] === "/";
    if (closing) cursor++;
    while (cursor < end && /\s/.test(html[cursor])) cursor++;
    const nameStart = cursor;
    while (cursor < end && /[A-Za-z0-9]/.test(html[cursor])) cursor++;
    const name = html.slice(nameStart, cursor).toLowerCase();
    if (hiddenTag) {
      if (closing && name === hiddenTag) hiddenTag = null;
    } else if (!closing && hidden.has(name)) {
      hiddenTag = name;
    } else if (breaks.has(name)) {
      output.push("\n");
    } else {
      output.push(" ");
    }
    i = end;
  }
  return output.join("").replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : " ";
  });
}

function parseMessage(data: unknown): GmailEnquiryCandidate {
  if (!isRecord(data) || typeof data.id !== "string" || !data.id ||
      typeof data.threadId !== "string" || !data.threadId || !isRecord(data.payload)) {
    throw new GmailApiError("invalid_response", "message", 200, false);
  }
  const root = data.payload as GmailPart;
  const attachments: GmailEnquiryCandidate["attachments"] = [];
  const plain: string[] = [];
  const html: string[] = [];
  let invalidText = false;
  let unavailableText = false;
  let truncated = false;
  const stack: GmailPart[] = [root];
  let partCount = 0;
  while (stack.length) {
    const part = stack.pop()!;
    if (++partCount > MAX_PARTS) {
      truncated = true;
      break;
    }
    const filename = clean(part.filename, 180);
    const disposition = header(part, "content-disposition").toLowerCase();
    const isAttachment = Boolean(filename) || disposition.startsWith("attachment");
    if (isAttachment) {
      const body = isRecord(part.body) ? part.body : {};
      attachments.push({
        filename: filename || null,
        mimeType: clean(part.mimeType, 120) || null,
        size: typeof body.size === "number" && Number.isSafeInteger(body.size) && body.size >= 0 ? body.size : null,
      });
      continue;
    }
    const mime = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
    if (mime === "text/plain" || mime === "text/html") {
      if (isRecord(part.body) && typeof part.body.data === "string") {
        const decoded = decodeBody(part);
        if (decoded === null) invalidText = true;
        else (mime === "text/plain" ? plain : html).push(decoded);
      } else if (isRecord(part.body) && typeof part.body.attachmentId === "string") {
        unavailableText = true;
      }
    }
    if (Array.isArray(part.parts)) {
      if (part.parts.length > MAX_PARTS - partCount) truncated = true;
      for (let index = Math.min(part.parts.length, MAX_PARTS - partCount) - 1; index >= 0; index--) {
        if (isRecord(part.parts[index])) stack.push(part.parts[index] as GmailPart);
      }
    }
  }
  const source = plain.length ? plain.join("\n") : html.length ? htmlToText(html.join("\n")) : "";
  const bodyText = clean(source.replace(/\n{3,}/g, "\n\n"), MAX_BODY_CHARS);
  const bodyStatus = truncated || source.length > MAX_BODY_CHARS
    ? "truncated"
    : bodyText ? "available" : invalidText ? "invalid_encoding" : unavailableText ? "unavailable" : "empty";
  const from = sender(header(root, "from"));
  const numericDate = typeof data.internalDate === "string" && /^\d{1,16}$/.test(data.internalDate)
    ? Number(data.internalDate)
    : Number.NaN;
  const internalDate = Number.isFinite(numericDate) && numericDate >= 0 && numericDate <= 8_640_000_000_000_000
    ? new Date(numericDate).toISOString()
    : null;
  return {
    messageId: clean(data.id, 256),
    threadId: clean(data.threadId, 256),
    internalDate,
    senderName: from.name,
    senderEmail: from.email,
    senderReviewRequired: true,
    subject: header(root, "subject"),
    bodyText,
    bodyStatus,
    attachments,
    attachmentCount: attachments.length,
  };
}

export async function readEnquiryMessagePage({
  request,
  labelId,
  pageToken,
  maxResults = 50,
  isAlreadyImported,
}: {
  request: AuthenticatedGmailRequest;
  labelId: string;
  pageToken?: string | null;
  maxResults?: number;
  isAlreadyImported?: (messageId: string) => Promise<boolean>;
}): Promise<GmailEnquiryPage> {
  if (!labelId || labelId.length > 256 || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100 ||
      (pageToken != null && (pageToken.length < 1 || pageToken.length > 2048))) {
    throw new GmailApiError("invalid_label", "list", null, false);
  }
  const labels = await listGmailLabels({ request });
  if (!labels.some((label) => label.id === labelId)) {
    throw new GmailApiError("invalid_label", "list", null, false);
  }
  const params = new URLSearchParams({
    labelIds: labelId,
    maxResults: String(maxResults),
    q: "-in:sent -in:drafts",
    includeSpamTrash: "false",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await requestJson(request, `/messages?${params}`, "list", MAX_LIST_JSON_BYTES, Boolean(pageToken));
  if (!isRecord(data) || (data.messages !== undefined && !Array.isArray(data.messages))) {
    throw new GmailApiError("invalid_response", "list", 200, false);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of (data.messages ?? []) as unknown[]) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(item.id)) {
      throw new GmailApiError("invalid_response", "list", 200, false);
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  const nextPageToken = data.nextPageToken === undefined ? null : data.nextPageToken;
  if (nextPageToken !== null && (typeof nextPageToken !== "string" || !nextPageToken ||
      nextPageToken.length > 2048 || nextPageToken === pageToken)) {
    throw new GmailApiError("invalid_response", "list", 200, false);
  }
  const messages: GmailEnquiryCandidate[] = [];
  const rejectedMessages: GmailEnquiryPage["rejectedMessages"] = [];
  let missingMessageCount = 0;
  let alreadyImportedCount = 0;
  let skippedOutboundCount = 0;
  for (const id of ids) {
    if (isAlreadyImported && await isAlreadyImported(id)) {
      alreadyImportedCount++;
      continue;
    }
    try {
      const full = await requestJson(request, `/messages/${encodeURIComponent(id)}?format=full`, "message", MAX_MESSAGE_JSON_BYTES);
      if (isRecord(full) && Array.isArray(full.labelIds) &&
          (full.labelIds.includes("SENT") || full.labelIds.includes("DRAFT"))) {
        skippedOutboundCount++;
        continue;
      }
      const candidate = parseMessage(full);
      if (candidate.messageId !== id) throw new GmailApiError("invalid_response", "message", 200, false);
      messages.push(candidate);
    } catch (error) {
      if (error instanceof GmailApiError && error.code === "not_found") {
        missingMessageCount++;
        continue;
      }
      if (error instanceof GmailApiError && (error.code === "invalid_response" || error.code === "payload_too_large")) {
        rejectedMessages.push({ messageId: id, reason: error.code });
        continue;
      }
      // The caller must not advance its persisted page token on partial failure.
      throw error;
    }
  }
  return {
    messages,
    rejectedMessages,
    nextPageToken,
    resultSizeEstimate: typeof data.resultSizeEstimate === "number" && Number.isSafeInteger(data.resultSizeEstimate)
      ? data.resultSizeEstimate : null,
    missingMessageCount,
    alreadyImportedCount,
    skippedOutboundCount,
  };
}
