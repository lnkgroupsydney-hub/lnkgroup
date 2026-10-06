/** Keep the provider SVG inside an image, never inject it as document markup. */
export function authenticatorQrImage(value: string): string | null {
  if (/^data:image\/svg\+xml(?:;(?:charset=)?utf-8)?;base64,[a-z0-9+/]+={0,2}$/i.test(value)) return value;

  // auth-js wraps raw XML with `;utf-8,`. Encode the SVG payload so characters
  // such as # in colours cannot become a URL fragment and truncate the image.
  const payload = value.replace(/^data:image\/svg\+xml(?:;(?:charset=)?utf-8)?,/i, "");
  let svg = payload;
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) {
    try { svg = decodeURIComponent(payload); } catch { return null; }
  }
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
