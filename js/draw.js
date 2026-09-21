/** Canvas drawing helpers (DOM side). Pure maths lives in fit.js. */
import { LM } from './fit.js';

const BONES = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_HIP],
  [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW],
  [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW],
  [LM.R_ELBOW, LM.R_WRIST],
];

/**
 * Draw a garment with a canvas matrix.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number[]} m [a,b,c,d,e,f] mapping garment-space -> canvas pixels
 */
export function drawGarment(ctx, img, m, alpha = 1) {
  ctx.save();
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export function drawSkeleton(ctx, px) {
  ctx.save();
  ctx.lineWidth = Math.max(2, ctx.canvas.width / 480);
  ctx.strokeStyle = 'rgba(34,211,238,.85)';
  ctx.fillStyle = '#fff';
  for (const [a, b] of BONES) {
    const p = px[a];
    const q = px[b];
    if (!p || !q || p.v < 0.3 || q.v < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  const r = Math.max(3, ctx.canvas.width / 260);
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24]) {
    const p = px[i];
    if (!p || p.v < 0.3) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
