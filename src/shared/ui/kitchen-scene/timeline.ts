export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
export const smooth = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** Chapter centres and anchors share the viewport's reading centre.
 * Half a step places the named process inside its operation; switching to the
 * next name happens midway between centres, independent of chapter height.
 */
export function kitchenChapterProgress(centres: readonly number[], readingCentre: number) {
  if (!centres.length || !Number.isFinite(readingCentre) || centres.some((centre) => !Number.isFinite(centre))) return 0
  const last = centres.length - 1
  let chapter = last
  if (readingCentre <= centres[0]) chapter = 0
  else {
    for (let index = 0; index < last; index += 1) {
      if (readingCentre <= centres[index + 1]) {
        const span = centres[index + 1] - centres[index]
        chapter = index + (span > 0 ? clamp01((readingCentre - centres[index]) / span) : 0)
        break
      }
    }
  }
  return Math.min(9, chapter + 0.5)
}

/** All values are derived from absolute scroll position, so reverse scrolling is exact. */
export function kitchenTimeline(input: number) {
  const progress = Number.isFinite(input) ? Math.min(9, Math.max(0, input)) : 0
  const removal = smooth(progress - 1)
  const reassembly = smooth(progress - 8)
  const separated = removal * (1 - reassembly)
  const cleaning = smooth(progress - 2)
  const sanding = smooth(progress - 3)
  const masking = smooth(progress - 4)
  const primer = smooth(progress - 5)
  const firstCoat = smooth((progress - 6) / 0.47)
  const secondCoat = smooth((progress - 6.48) / 0.48)

  return {
    progress,
    inspection: (1 - smooth(progress - 0.45)) * (1 - removal),
    separated,
    cleaning,
    sanding,
    masking: masking * (1 - reassembly),
    primer,
    firstCoat,
    secondCoat,
    patch: smooth((progress - 2.84) / 0.26) * (1 - smooth((progress - 5.15) / 0.7)),
    closeup: Math.max(
      0.76 * smooth((progress - 2.45) / 0.85) * (1 - smooth((progress - 3.65) / 0.85)),
      0.38 * smooth((progress - 5.05) / 0.75) * (1 - smooth((progress - 6.95) / 0.75)),
    ),
    cure: smooth((progress - 7) / 0.4) * (1 - smooth((progress - 8) / 0.45)),
  }
}
