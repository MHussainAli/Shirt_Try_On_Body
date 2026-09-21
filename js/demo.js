/**
 * Demo subject: an animated mannequin that produces synthetic pose landmarks.
 * Lets anyone (recruiters, reviewers, people without a webcam) try the full
 * fitting pipeline instantly, and doubles as a deterministic test fixture.
 */
export const DEMO_SIZE = { width: 1280, height: 720 };

export function demoLandmarks(t) {
  const cx = 0.5 + 0.07 * Math.sin(t * 0.8);
  const tilt = 0.07 * Math.sin(t * 1.15 + 0.6);
  const bob = 0.008 * Math.sin(t * 2.3);
  const sw = 0.165 + 0.012 * Math.sin(t * 0.8 + 1); // shoulder width (fraction of W)
  const aspect = DEMO_SIZE.width / DEMO_SIZE.height;

  const sy = 0.3 + bob;
  const torso = 1.4 * sw * aspect; // fraction of H
  const half = sw / 2;
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const set = (i, x, y) => (lm[i] = { x, y, z: 0, visibility: 1 });

  const rot = (dx, dy) => ({
    x: cx + dx * Math.cos(tilt) - dy * Math.sin(tilt) / aspect,
    y: sy + dx * Math.sin(tilt) * aspect + dy * Math.cos(tilt),
  });
  const s1 = rot(-half, 0);
  const s2 = rot(half, 0);
  const hipOffset = torso;
  const h1 = rot(-half * 0.72, hipOffset);
  const h2 = rot(half * 0.72, hipOffset);
  const wave = Math.sin(t * 1.6);
  set(0, cx + tilt * 0.3, sy - 0.17);
  set(11, s1.x, s1.y);
  set(12, s2.x, s2.y);
  set(13, s1.x - 0.05, s1.y + 0.2);
  set(14, s2.x + 0.05, s2.y + 0.2);
  set(15, s1.x - 0.065 - 0.02 * wave, s1.y + 0.4);
  set(16, s2.x + 0.065 + 0.02 * wave, s2.y + 0.4);
  set(23, h1.x, h1.y);
  set(24, h2.x, h2.y);
  return lm;
}

/** Draw a stylised mannequin that matches the landmarks (no shirt). */
export function drawDemoScene(ctx, lm, t) {
  const { width: W, height: H } = DEMO_SIZE;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1b2030');
  bg.addColorStop(1, '#0d111b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // soft studio floor glow
  const glow = ctx.createRadialGradient(W / 2, H * 0.95, 20, W / 2, H * 0.95, W * 0.55);
  glow.addColorStop(0, 'rgba(124,92,255,.28)');
  glow.addColorStop(1, 'rgba(124,92,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const [ls, rs, lh, rh, nose] = [P(11), P(12), P(23), P(24), P(0)];
  const skin = '#c7a48b';
  const skinDark = '#a98770';

  const limb = (a, b, w, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const sw = Math.hypot(rs.x - ls.x, rs.y - ls.y);

  // arms
  limb(ls, P(13), sw * 0.22, skinDark);
  limb(P(13), P(15), sw * 0.18, skinDark);
  limb(rs, P(14), sw * 0.22, skinDark);
  limb(P(14), P(16), sw * 0.18, skinDark);

  // torso
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(ls.x - sw * 0.04, ls.y - sw * 0.02);
  ctx.quadraticCurveTo((ls.x + rs.x) / 2, ls.y - sw * 0.16, rs.x + sw * 0.04, rs.y - sw * 0.02);
  ctx.lineTo(rh.x + sw * 0.06, rh.y);
  ctx.lineTo(lh.x - sw * 0.06, lh.y);
  ctx.closePath();
  ctx.fill();

  // legs hint (shorts) so the figure doesn't float
  const legTop = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  ctx.fillStyle = '#2a3042';
  ctx.fillRect(legTop.x - sw * 0.5, legTop.y - sw * 0.05, sw, H - legTop.y);

  // neck + head
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  limb({ x: mid.x, y: mid.y - sw * 0.02 }, { x: nose.x, y: mid.y - sw * 0.34 }, sw * 0.2, skinDark);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y - sw * 0.06, sw * 0.27, sw * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // hands
  for (const i of [15, 16]) {
    const p = P(i);
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(p.x, p.y, sw * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
}
