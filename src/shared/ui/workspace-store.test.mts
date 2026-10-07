import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceStore } from "./workspace-store.ts";
import { compatibleAdminPath } from "../../modules/admin-dashboard/presentation/admin-navigation.ts";

test("drafts survive form subscription changes but never enter another workspace", () => {
  const store = createWorkspaceStore();
  const initial = { name: "", revision: 1 };
  let changes = 0;
  const unsubscribe = store.subscribe("client", () => changes++);
  store.set("client", { name: "Draft client", revision: 3 });
  unsubscribe();
  assert.equal(changes, 1);
  assert.deepEqual(store.get("client", initial), { name: "Draft client", revision: 3 });
  assert.deepEqual(createWorkspaceStore().get("client", initial), initial);
  store.clear();
  assert.deepEqual(store.get("client", initial), initial);
});

test("back navigation retains unload protection, while completed/discarded edits clear it", () => {
  const store = createWorkspaceStore();
  let discarded = 0;
  const unmount = store.register("client", { dirty: true, onDiscard: () => discarded++ });
  unmount();
  assert.equal(store.entries(true).length, 0);
  assert.equal(store.entries().length, 1);
  store.register("client", { dirty: true, onDiscard: () => discarded++ });
  store.discardActive();
  assert.equal(discarded, 1);
  assert.equal(store.entries().length, 0);
  store.register("client", { dirty: false, busy: false, onDiscard() {} });
  assert.equal(store.entries().length, 0);
});

test("a stale cleanup cannot remove the latest form guard or discard an in-flight request", () => {
  const store = createWorkspaceStore();
  const oldCleanup = store.register("booking", { dirty: true, onDiscard() {} });
  let discarded = false;
  store.register("booking", { dirty: true, busy: true, onDiscard() { discarded = true; } });
  oldCleanup(); store.discardActive();
  assert.equal(store.entries(true).length, 1);
  assert.equal(discarded, false);
});

test("legacy admin addresses only map to approved internal destinations", () => {
  assert.equal(compatibleAdminPath("/admin", "?google=connected", ""), "/admin/settings#company-connections");
  assert.equal(compatibleAdminPath("/admin", "", "#customers-heading"), "/admin/customers");
  for (const hash of ["#https://example.invalid", "#//example.invalid", "#constructor", "#__proto__", "#unknown"]) {
    assert.equal(compatibleAdminPath("/admin", "?returnTo=https://example.invalid", hash), null);
  }
  assert.equal(compatibleAdminPath("/admin/settings", "?google=connected", ""), null);
});
