import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The portable kit must carry the exact values the EMS admin workspace ships with.
const kit = readFileSync(new URL("./ems-tokens.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/modules/admin-dashboard/presentation/admin-theme.css", import.meta.url), "utf8");
const tokens = (css: string) => new Map([...css.matchAll(/(--ems-[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim().toLowerCase()]));

test("portable kit tokens match the admin theme", () => {
  const fromKit = tokens(kit), fromApp = tokens(app);
  assert.ok(fromKit.size >= 40, "kit defines the full token set");
  for (const [name, value] of fromApp) assert.equal(fromKit.get(name), value, `${name} differs from admin-theme.css`);
  for (const name of fromKit.keys()) assert.ok(fromApp.has(name), `${name} is not in admin-theme.css`);
});

test("portable kit stays scoped and does not touch a host page's :root", () => {
  assert.doesNotMatch(kit, /:root\s*\{/);
  assert.match(kit, /\.ems-theme\s*\{/);
});
