import assert from "node:assert/strict";
import test from "node:test";
import {
  GmailApiError,
  listGmailLabels,
  readEnquiryMessagePage,
  type AuthenticatedGmailRequest,
} from "../index.ts";

const encoded = (text: string) => Buffer.from(text).toString("base64url");
const labels = [
  { id: "INBOX", name: "Inbox", type: "system" },
  { id: "Label_enquiries", name: "Enquiries", type: "user" },
];

function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    threadId: `thread_${id}`,
    internalDate: "1780156800000",
    labelIds: ["Label_enquiries"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: 'Alice Example <alice@example.com>' },
        { name: "Subject", value: "Cabinet repaint enquiry" },
      ],
      body: { data: encoded("Please repaint our existing cabinets.") },
    },
    ...overrides,
  };
}

function fakeGmail({
  pages = { "": { messages: [{ id: "a" }], resultSizeEstimate: 1 } },
  details = { a: message("a") } as Record<string, unknown>,
  failures = {} as Record<string, number>,
}: {
  pages?: Record<string, unknown>;
  details?: Record<string, unknown>;
  failures?: Record<string, number>;
} = {}) {
  const calls: string[] = [];
  const request: AuthenticatedGmailRequest = async (path, init) => {
    calls.push(path);
    assert.equal(init?.method, "GET");
    if (failures[path]) return new Response("private upstream error body", { status: failures[path] });
    if (path === "/labels") return Response.json({ labels });
    const url = new URL(path, "https://gmail.googleapis.com");
    if (url.pathname === "/messages") {
      assert.equal(url.searchParams.get("labelIds"), "Label_enquiries");
      assert.equal(url.searchParams.get("q"), "-in:sent -in:drafts");
      assert.equal(url.searchParams.get("includeSpamTrash"), "false");
      return Response.json(pages[url.searchParams.get("pageToken") ?? ""] ?? {});
    }
    const id = url.pathname.split("/")[2];
    assert.equal(url.searchParams.get("format"), "full");
    if (id in details) return Response.json(details[id]);
    return new Response(null, { status: 404 });
  };
  return { request, calls };
}

test("only custom Gmail labels can scope intake", async () => {
  const { request } = fakeGmail();
  assert.deepEqual(await listGmailLabels({ request }), [{ id: "Label_enquiries", name: "Enquiries" }]);
  await assert.rejects(
    readEnquiryMessagePage({ request, labelId: "INBOX" }),
    (error: unknown) => error instanceof GmailApiError && error.code === "invalid_label",
  );
});

test("advances every page, skips already imported boundary IDs, and retains next token", async () => {
  const gmail = fakeGmail({
    pages: {
      "": { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2", resultSizeEstimate: 3 },
      p2: { messages: [{ id: "b" }, { id: "c" }], resultSizeEstimate: 3 },
    },
    details: { a: message("a"), b: message("b"), c: message("c") },
  });
  const imported = new Set<string>();
  const load = (pageToken?: string | null) => readEnquiryMessagePage({
    request: gmail.request,
    labelId: "Label_enquiries",
    pageToken,
    maxResults: 2,
    isAlreadyImported: async (id) => imported.has(id),
  });
  const first = await load();
  assert.equal(first.nextPageToken, "p2");
  assert.deepEqual(first.messages.map((item) => item.messageId), ["a", "b"]);
  first.messages.forEach((item) => imported.add(item.messageId));
  const second = await load(first.nextPageToken);
  assert.deepEqual(second.messages.map((item) => item.messageId), ["c"]);
  assert.equal(second.alreadyImportedCount, 1);
  assert.equal(second.nextPageToken, null);
  assert.equal(gmail.calls.filter((path) => path.startsWith("/messages/b?")).length, 1);
  assert.equal(gmail.calls.filter((path) => path.startsWith("/messages?")).length, 2);
});

test("prefers MIME text/plain, reports attachments without downloading them", async () => {
  const gmail = fakeGmail({
    details: {
      a: message("a", {
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "From", value: '"Alice Example" <alice@example.com>' },
            { name: "Subject", value: "Kitchen" },
          ],
          parts: [
            { mimeType: "text/html", body: { data: encoded("<p>HTML only</p>") } },
            { mimeType: "text/plain", body: { data: encoded("Plain message") } },
            {
              mimeType: "image/jpeg",
              filename: "cabinet.jpg",
              body: { attachmentId: "secret-attachment-id", size: 2048 },
            },
          ],
        },
      }),
    },
  });
  const page = await readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" });
  assert.equal(page.messages[0].bodyText, "Plain message");
  assert.equal(page.messages[0].senderReviewRequired, true);
  assert.equal(page.messages[0].senderEmail, "alice@example.com");
  assert.deepEqual(page.messages[0].attachments, [{ filename: "cabinet.jpg", mimeType: "image/jpeg", size: 2048 }]);
  assert.equal(page.messages[0].attachmentCount, 1);
  assert.equal(gmail.calls.some((path) => path.includes("attachments")), false);
});

test("HTML fallback becomes bounded inert text and does not load remote content", async () => {
  const gmail = fakeGmail({
    details: {
      a: message("a", {
        payload: {
          mimeType: "text/html",
          headers: [{ name: "From", value: "bad@example.com" }],
          body: { data: encoded('<style>private</style><script>steal()</script><p>Hello &amp; welcome</p><img src="https://tracker.example/pixel"><a href="https://evil.example">Reply here</a>') },
        },
      }),
    },
  });
  const page = await readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" });
  assert.match(page.messages[0].bodyText, /Hello & welcome/);
  assert.match(page.messages[0].bodyText, /Reply here/);
  assert.doesNotMatch(page.messages[0].bodyText, /<|https:|steal|private/);
  assert.equal(gmail.calls.length, 3);
});

test("malformed HTML and quoted tag attributes stay bounded and inert", async () => {
  const gmail = fakeGmail({
    details: {
      a: message("a", {
        payload: {
          mimeType: "text/html",
          headers: [{ name: "From", value: "sender@example.com" }],
          body: { data: encoded('<p title="one > two">Safe</p><script>alert(1)</script>' + "<".repeat(90_000)) },
        },
      }),
    },
  });
  const page = await readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" });
  assert.equal(page.messages[0].bodyText, "Safe");
  assert.doesNotMatch(page.messages[0].bodyText, /alert|title|</);
});

test("invalid body encoding and malformed sender remain review items", async () => {
  const gmail = fakeGmail({
    details: {
      a: message("a", {
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Alice <alice@example.com>, Bob <bob@example.com>" },
            { name: "Subject", value: "Subject\r\nX-Injected: yes" },
          ],
          body: { data: "%%%" },
        },
      }),
    },
  });
  const page = await readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" });
  assert.equal(page.messages[0].senderEmail, null);
  assert.equal(page.messages[0].senderReviewRequired, true);
  assert.equal(page.messages[0].bodyStatus, "invalid_encoding");
  assert.equal(page.messages[0].bodyText, "");
  assert.doesNotMatch(page.messages[0].subject, /\r/);
});

test("deleted messages and labelled outbound mail are counted without deleting saved enquiries", async () => {
  const gmail = fakeGmail({
    pages: { "": { messages: [{ id: "gone" }, { id: "a" }] } },
    details: { a: message("a", { labelIds: ["Label_enquiries", "SENT"] }) },
  });
  const page = await readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" });
  assert.deepEqual(page.messages, []);
  assert.equal(page.missingMessageCount, 1);
  assert.equal(page.skippedOutboundCount, 1);
});

test("a failed full-message read rejects the page so its cursor cannot advance", async () => {
  const gmail = fakeGmail({
    pages: { "": { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "later" } },
    details: { a: message("a"), b: message("b") },
    failures: { "/messages/b?format=full": 503 },
  });
  await assert.rejects(
    readEnquiryMessagePage({ request: gmail.request, labelId: "Label_enquiries" }),
    (error: unknown) => error instanceof GmailApiError && error.code === "server_error" && error.stage === "message" && error.retryable,
  );
});

test("401, 403, 429 and 5xx remain distinct, without leaking provider response bodies", async () => {
  const cases = [
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [429, "rate_limited", true],
    [500, "server_error", true],
  ] as const;
  for (const [status, code, retryable] of cases) {
    const request: AuthenticatedGmailRequest = async () => new Response("private response body", { status });
    await assert.rejects(listGmailLabels({ request }), (error: unknown) => {
      assert.ok(error instanceof GmailApiError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.retryable, retryable);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  }
});

test("overlarge and cyclic pages fail visibly instead of silently skipping mail", async () => {
  const overlarge: AuthenticatedGmailRequest = async (path) => path === "/labels"
    ? Response.json({ labels })
    : Response.json({ messages: [], padding: "x".repeat(1_000_000) });
  await assert.rejects(
    readEnquiryMessagePage({ request: overlarge, labelId: "Label_enquiries" }),
    (error: unknown) => error instanceof GmailApiError && error.code === "payload_too_large",
  );
  const cyclic = fakeGmail({ pages: { p2: { messages: [], nextPageToken: "p2" } } });
  await assert.rejects(
    readEnquiryMessagePage({ request: cyclic.request, labelId: "Label_enquiries", pageToken: "p2" }),
    (error: unknown) => error instanceof GmailApiError && error.code === "invalid_response",
  );
});

test("transport authentication failures retain only allowlisted codes and safe messages", async () => {
  const cases = [
    ["google_reconnect_required", false], ["google_temporary", true],
    ["google_configuration", false], ["google_permission_denied", false],
    ["google_invalid_response", false], ["google_not_connected", false],
    ["google_connection_changed", true], ["private-provider-code", true],
  ] as const;
  for (const [code, retryable] of cases) {
    const request: AuthenticatedGmailRequest = async () => {
      throw Object.assign(new Error("private body token=secret"), { code, status: 503 });
    };
    await assert.rejects(listGmailLabels({ request }), (error: unknown) => {
      assert.ok(error instanceof GmailApiError);
      assert.equal(error.code, code === "private-provider-code" ? "network_error" : code);
      assert.equal(error.retryable, retryable);
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
  }
});

test("only a confirmed invalid saved page token receives the cursor recovery code", async () => {
  const cases = [
    { status: 400, pageToken: "expired", details: { message: "Invalid pageToken" }, code: "gmail_invalid_page_token" },
    { status: 400, pageToken: "expired", details: { errors: [{ location: "pageToken", reason: "invalidArgument" }] }, code: "gmail_invalid_page_token" },
    { status: 400, pageToken: undefined, details: { message: "Invalid pageToken" }, code: "http_error" },
    { status: 400, pageToken: "expired", details: { message: "Invalid Argument" }, code: "http_error" },
    { status: 400, pageToken: "expired", details: { errors: [{ location: "labelIds", reason: "invalidArgument" }] }, code: "http_error" },
    { status: 429, pageToken: "expired", details: { message: "Invalid pageToken" }, code: "rate_limited" },
    { status: 503, pageToken: "expired", details: { message: "Invalid pageToken" }, code: "server_error" },
    { status: 400, pageToken: "expired", details: { message: "Invalid pageToken", padding: "x".repeat(20_000) }, code: "http_error" },
  ];
  for (const { status, pageToken, details, code } of cases) {
    const request: AuthenticatedGmailRequest = async (path) => path === "/labels"
      ? Response.json({ labels }) : Response.json({ error: details }, { status });
    await assert.rejects(readEnquiryMessagePage({ request, labelId: "Label_enquiries", pageToken }), (error: unknown) => {
      assert.ok(error instanceof GmailApiError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /expired|Invalid Argument|padding/);
      return true;
    });
  }
});
