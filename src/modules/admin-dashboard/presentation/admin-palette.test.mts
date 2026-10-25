import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../../../shared/styles/admin-tokens.css", import.meta.url), "utf8");
const token = (name: string) => {
  const match = css.match(new RegExp(`--ems-${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing --ems-${name}`);
  return match[1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const text: [string, string][] = [["ink", "surface"], ["ink", "canvas"], ["ink", "field"], ["ink-2", "surface"], ["muted", "surface"], ["muted", "canvas"], ["muted", "field"], ["gold-text", "surface"], ["gold-text", "canvas"], ["gold-text", "gold-tint"], ["rail-text", "black"], ["gold", "black"], ["ink", "gold"], ["success", "success-bg"], ["warning", "warning-bg"], ["danger", "danger-bg"], ["info", "info-bg"], ["neutral", "neutral-bg"]];
const nonText: [string, string][] = [["line-strong", "surface"], ["line-strong", "field"], ["gold-bright", "black"]];

test("EMS text pairs meet WCAG AA 4.5:1", () => {
  for (const [fg, bg] of text) assert.ok(contrast(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}`);
});
test("EMS field borders and focus indicators meet 3:1", () => {
  for (const [fg, bg] of nonText) assert.ok(contrast(token(fg), token(bg)) >= 3, `${fg} on ${bg}`);
});
test("input fields are visibly distinct from cards and the page", () => {
  assert.notEqual(token("field"), token("surface"));
  assert.notEqual(token("field"), token("canvas"));
});
test("admin scope remaps shared site tokens instead of editing the public :root", () => {
  assert.doesNotMatch(css, /:root\s*\{/);
  for (const name of ["background", "surface", "foreground", "muted", "border", "border-strong", "action", "action-hover", "on-action", "focus"]) assert.match(css, new RegExp(`--site-${name}:\\s*var\\(--ems-`));
});
