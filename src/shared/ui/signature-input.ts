export type SignaturePoint = { x: number; y: number };
export type SignatureSource = number | "keyboard";

const MAX_POINTS = 2000;
const MAX_STROKES = 100;
const validPoint = (point: SignaturePoint) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

/** One input source owns an unfinished stroke until it ends or is cancelled. */
export function createSignatureInput() {
  let active: { source: SignatureSource; points: SignaturePoint[] } | null = null;
  const count = (strokes: SignaturePoint[][]) => strokes.reduce((sum, stroke) => sum + stroke.length, 0) + (active?.points.length ?? 0);
  return {
    source(): SignatureSource | null { return active?.source ?? null; },
    preview(): readonly SignaturePoint[] { return active?.points ?? []; },
    begin(source: SignatureSource, point: SignaturePoint, strokes: SignaturePoint[][], disabled = false): boolean {
      if (disabled) { active = null; return false; }
      if (active || !validPoint(point) || strokes.length >= MAX_STROKES || count(strokes) >= MAX_POINTS) return false;
      active = { source, points: [{ ...point }] };
      return true;
    },
    move(source: SignatureSource, point: SignaturePoint, strokes: SignaturePoint[][], disabled = false): boolean {
      if (disabled) { active = null; return false; }
      if (!active || active.source !== source || !validPoint(point) || count(strokes) >= MAX_POINTS) return false;
      active.points.push({ ...point });
      return true;
    },
    finish(source: SignatureSource, point: SignaturePoint | null, strokes: SignaturePoint[][], disabled = false): SignaturePoint[] | null {
      if (disabled) { active = null; return null; }
      if (!active || active.source !== source) return null;
      if (point && validPoint(point) && count(strokes) < MAX_POINTS) active.points.push({ ...point });
      const completed = active.points;
      active = null;
      return completed.length > 1 && strokes.length < MAX_STROKES ? completed : null;
    },
    cancel(source?: SignatureSource): boolean {
      if (!active || (source !== undefined && active.source !== source)) return false;
      active = null;
      return true;
    },
  };
}

export function signaturePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): SignaturePoint | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}
