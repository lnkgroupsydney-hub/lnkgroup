import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The portable kit must carry the exact values the EMS admin workspace ships with.
const kit = readFileSync(new URL("./ems-tokens.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/shared/styles/admin-tokens.css", import.meta.url), "utf8");
const tokens = (css: string) => new Map([...css.matchAll(/(--ems-[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim().toLowerCase()]));

test("portable kit tokens match the admin theme", () => {
  const fromKit = tokens(kit), fromApp = tokens(app);
  assert.ok(fromKit.size >= 40, "kit defines the full token set");
  for (const [name, value] of fromKit) assert.equal(fromApp.get(name), value, `${name} differs from admin-tokens.css`);
  // Every literal design value in the app (colours, sizes, weights, font stack) must be in the kit.
  // App-only aliases such as --ems-action: var(--ems-black) and motion/layout settings are not design values.
  for (const [name, value] of fromApp) {
    if (/^#|^\d+px$|^[1-9]\d{2}$|^var\(--font-outfit/.test(value)) assert.ok(fromKit.has(name), `${name} is missing from the kit`);
  }
});

test("portable kit stays scoped and does not touch a host page's :root", () => {
  assert.doesNotMatch(kit, /:root\s*\{/);
  assert.match(kit, /\.ems-theme\s*\{/);
});
