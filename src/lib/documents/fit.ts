// Every LOSuite PDF is exactly one page (document templates README, rule 1):
// render, count the pages, and shrink the scale in 3% steps down to 82%. If it
// still spills onto a second page, the export is blocked.

export const FIT_STEP = 0.03
export const FIT_FLOOR = 0.82

/** 100%, 97%, 94% ... 82%. */
export function fitScales(step = FIT_STEP, floor = FIT_FLOOR): number[] {
  const scales: number[] = []
  for (let n = 0; ; n++) {
    const s = Math.round((1 - n * step) * 100) / 100
    if (s < floor - 1e-9) return scales
    scales.push(s)
  }
}

export type FitResult<T> = { ok: true; file: T; scale: number } | { ok: false; pages: number }

/** The largest scale at which the document fits on one page, or how many pages it still needs at the floor. */
export async function fitToOnePage<T>(render: (scale: number) => Promise<T>, countPages: (file: T) => Promise<number>): Promise<FitResult<T>> {
  let pages = 0
  for (const scale of fitScales()) {
    const file = await render(scale)
    pages = await countPages(file)
    if (pages <= 1) return { ok: true, file, scale }
  }
  return { ok: false, pages }
}
