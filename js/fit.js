/**
 * Garment fitting maths. Pure functions only (no DOM) so they are unit-tested
 * in Node (see tests/fit.test.js).
 *
 * Idea: a shirt image defines two shoulder anchors and a hip line. We build an
 * affine transform that maps the shirt's shoulder line onto the person's
 * shoulder line (handles scale + rotation) and the shirt's "shoulder -> hip"
 * axis onto the person's "shoulder -> hip" axis (handles torso length and
 * leaning/shear). The result is a canvas matrix [a, b, c, d, e, f].
 */

export const LM = Object.freeze({
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
});

/** When hips are out of frame we assume this torso/shoulder-width ratio. */
export const DEFAULT_TORSO_RATIO = 1.45;
const MIN_SHOULDER_PX = 8;
const HIP_VISIBILITY = 0.55;

export const DEFAULT_OPTIONS = Object.freeze({
  size: 1.0, // shoulder-width multiplier
  length: 1.0, // torso-length multiplier
  offsetY: -0.04, // vertical nudge in shoulder-widths
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Convert normalised MediaPipe landmarks to canvas pixels.
 * @param {{x:number,y:number,visibility?:number}[]} lm
 */
export function toPixels(lm, width, height, mirror = false) {
  return lm.map((p) => ({
    x: (mirror ? 1 - p.x : p.x) * width,
    y: p.y * height,
    v: p.visibility ?? 1,
  }));
}

/**
 * Pick the landmarks needed for fitting from a pixel landmark array.
 * Left/right are returned in *screen* order so mirroring is irrelevant.
 * @returns {{sl,sr,hl,hr,hips:boolean,confidence:number}|null}
 */
export function selectAnchors(px, width, height) {
  const a = px[LM.L_SHOULDER];
  const b = px[LM.R_SHOULDER];
  if (!a || !b) return null;
  const [sl, sr] = a.x <= b.x ? [a, b] : [b, a];

  const h1 = px[LM.L_HIP];
  const h2 = px[LM.R_HIP];
  let hips = false;
  let hl = null;
  let hr = null;
  if (h1 && h2) {
    [hl, hr] = h1.x <= h2.x ? [h1, h2] : [h2, h1];
    const inFrame = (p) => p.y <= height * 1.02 && p.x >= -width * 0.1 && p.x <= width * 1.1;
    hips = Math.min(h1.v, h2.v) >= HIP_VISIBILITY && inFrame(h1) && inFrame(h2);
  }
  return { sl, sr, hl, hr, hips, confidence: Math.min(a.v, b.v) };
}

/**
 * Build the canvas transform for a garment.
 * @param {{sl,sr,hl,hr,hips:boolean}} pts   smoothed anchor points (pixels)
 * @param {{anchors:{sl:number[],sr:number[],hipY:number}}} meta  garment metadata
 * @param {{size:number,length:number,offsetY:number}} opt
 * @returns {{matrix:number[], torsoRatio:number, usedHips:boolean}|null}
 */
export function computeFit(pts, meta, opt = DEFAULT_OPTIONS) {
  const { sl, sr } = pts;
  const dx = sr.x - sl.x;
  const dy = sr.y - sl.y;
  const sw = Math.hypot(dx, dy);
  if (!(sw >= MIN_SHOULDER_PX)) return null;

  const ux = dx / sw;
  const uy = dy / sw;
  const mid = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };

  let dirX;
  let dirY;
  let torsoRatio;
  if (pts.hips && pts.hl && pts.hr) {
    const hm = { x: (pts.hl.x + pts.hr.x) / 2, y: (pts.hl.y + pts.hr.y) / 2 };
    const vx = hm.x - mid.x;
    const vy = hm.y - mid.y;
    const len = Math.hypot(vx, vy) || 1;
    torsoRatio = clamp(len / sw, 0.9, 2.4);
    dirX = vx / len;
    dirY = vy / len;
  } else {
    // No reliable hips: torso is perpendicular to the shoulder line.
    torsoRatio = DEFAULT_TORSO_RATIO;
    dirX = -uy;
    dirY = ux;
  }

  const { sl: gl, sr: gr, hipY } = meta.anchors;
  const gMidX = (gl[0] + gr[0]) / 2;
  const gMidY = (gl[1] + gr[1]) / 2;
  const gSpan = gr[0] - gl[0];
  const gTorso = hipY - gMidY;

  const sx = (sw * opt.size) / gSpan; // px per garment-x along shoulder axis
  const sy = (sw * torsoRatio * opt.length) / gTorso; // px per garment-y along torso axis

  const a = ux * sx;
  const b = uy * sx;
  const c = dirX * sy;
  const d = dirY * sy;

  const ax = mid.x + dirX * sw * opt.offsetY;
  const ay = mid.y + dirY * sw * opt.offsetY;
  const e = ax - a * gMidX - c * gMidY;
  const f = ay - b * gMidX - d * gMidY;

  return { matrix: [a, b, c, d, e, f], torsoRatio, usedHips: !!pts.hips };
}

/** Exponential smoothing between two matrices, frame-rate independent. */
export function lerpMatrix(from, to, dt, rate = 22) {
  if (!from) return to.slice();
  const k = 1 - Math.exp(-rate * Math.max(dt, 0));
  return from.map((v, i) => v + (to[i] - v) * k);
}

/** Apply a matrix to a point (used by tests and debugging). */
export function applyMatrix(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
