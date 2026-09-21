import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFit, applyMatrix, selectAnchors, toPixels, lerpMatrix, DEFAULT_OPTIONS, LM } from '../js/fit.js';
import { OneEuro } from '../js/filters.js';
import { demoLandmarks } from '../js/demo.js';

const meta = { anchors: { sl: [130, 100], sr: [470, 100], hipY: 570 } };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const noOffset = { ...DEFAULT_OPTIONS, offsetY: 0 };

test('shirt shoulders land exactly on the person\'s shoulders', () => {
  const pts = { sl: { x: 400, y: 300 }, sr: { x: 600, y: 300 }, hips: false };
  const { matrix } = computeFit(pts, meta, noOffset);
  const l = applyMatrix(matrix, 130, 100);
  const r = applyMatrix(matrix, 470, 100);
  close(l.x, 400); close(l.y, 300);
  close(r.x, 600); close(r.y, 300);
});

test('rotation follows a tilted shoulder line', () => {
  const pts = { sl: { x: 400, y: 300 }, sr: { x: 500, y: 350 }, hips: false };
  const { matrix } = computeFit(pts, meta, noOffset);
  const l = applyMatrix(matrix, 130, 100);
  const r = applyMatrix(matrix, 470, 100);
  close(l.x, 400); close(l.y, 300);
  close(r.x, 500); close(r.y, 350);
});

test('hip line maps to the detected hips when visible', () => {
  const pts = {
    sl: { x: 400, y: 300 }, sr: { x: 600, y: 300 },
    hl: { x: 430, y: 560 }, hr: { x: 570, y: 560 }, hips: true,
  };
  const { matrix, usedHips } = computeFit(pts, meta, noOffset);
  assert.equal(usedHips, true);
  const mid = applyMatrix(matrix, 300, 570); // centre of the shirt's hip line
  close(mid.x, 500, 1e-4); close(mid.y, 560, 1e-4);
});

test('falls back to a default torso ratio without hips', () => {
  const pts = { sl: { x: 400, y: 300 }, sr: { x: 600, y: 300 }, hips: false };
  const { torsoRatio, matrix } = computeFit(pts, meta, noOffset);
  assert.ok(torsoRatio > 1 && torsoRatio < 2);
  const hip = applyMatrix(matrix, 300, 570);
  close(hip.x, 500, 1e-4);
  close(hip.y, 300 + 200 * torsoRatio, 1e-4);
});

test('size multiplier scales around the shoulder midpoint', () => {
  const pts = { sl: { x: 400, y: 300 }, sr: { x: 600, y: 300 }, hips: false };
  const { matrix } = computeFit(pts, meta, { ...noOffset, size: 1.2 });
  const l = applyMatrix(matrix, 130, 100);
  const r = applyMatrix(matrix, 470, 100);
  close(r.x - l.x, 240, 1e-4);
  close((l.x + r.x) / 2, 500, 1e-4);
});

test('degenerate shoulders return null', () => {
  assert.equal(computeFit({ sl: { x: 1, y: 1 }, sr: { x: 2, y: 1 }, hips: false }, meta), null);
});

test('selectAnchors orders points by screen position, even when mirrored', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[LM.L_SHOULDER] = { x: 0.4, y: 0.3, visibility: 0.9 };
  lm[LM.R_SHOULDER] = { x: 0.6, y: 0.3, visibility: 0.95 };
  lm[LM.L_HIP] = { x: 0.43, y: 0.7, visibility: 0.9 };
  lm[LM.R_HIP] = { x: 0.57, y: 0.7, visibility: 0.9 };
  const a = selectAnchors(toPixels(lm, 1000, 1000, true), 1000, 1000);
  assert.ok(a.sl.x < a.sr.x);
  assert.ok(a.hl.x < a.hr.x);
  assert.equal(a.hips, true);
});

test('hips below the frame are rejected', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  lm[LM.L_SHOULDER] = { x: 0.4, y: 0.3, visibility: 1 };
  lm[LM.R_SHOULDER] = { x: 0.6, y: 0.3, visibility: 1 };
  lm[LM.L_HIP] = { x: 0.43, y: 1.4, visibility: 0.9 };
  lm[LM.R_HIP] = { x: 0.57, y: 1.4, visibility: 0.9 };
  assert.equal(selectAnchors(toPixels(lm, 1000, 1000), 1000, 1000).hips, false);
});

test('One Euro filter reduces jitter on a still signal', () => {
  const f = new OneEuro();
  let raw = 0, smooth = 0, prev = null, prevRaw = null;
  for (let i = 0; i < 200; i++) {
    const x = 100 + (i % 2 ? 2 : -2); // +-2px jitter
    const y = f.filter(x, i / 30);
    if (i > 30) { smooth += Math.abs(y - prev); raw += Math.abs(x - prevRaw); }
    prev = y; prevRaw = x;
  }
  assert.ok(smooth < raw * 0.4, `smoothed jitter ${smooth} vs raw ${raw}`);
});

test('One Euro filter tracks fast motion with little lag', () => {
  const f = new OneEuro();
  let y = 0;
  for (let i = 0; i < 60; i++) y = f.filter(i * 20, i / 30); // 600 px/s
  assert.ok(Math.abs(y - 59 * 20) < 60, `lag too large: ${59 * 20 - y}`);
});

test('lerpMatrix converges and is frame-rate independent', () => {
  const to = [1, 0, 0, 1, 100, 100];
  let a = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 120; i++) a = lerpMatrix(a, to, 1 / 60);
  close(a[4], 100, 0.01);
  const one = lerpMatrix([0, 0, 0, 0, 0, 0], to, 1 / 30);
  let two = lerpMatrix([0, 0, 0, 0, 0, 0], to, 1 / 60);
  two = lerpMatrix(two, to, 1 / 60);
  close(one[4], two[4], 1e-6);
});

test('demo landmarks produce a valid, fittable pose over time', () => {
  for (let t = 0; t < 20; t += 0.5) {
    const px = toPixels(demoLandmarks(t), 1280, 720);
    const pts = selectAnchors(px, 1280, 720);
    assert.ok(pts.hips, `hips should be visible at t=${t}`);
    assert.ok(computeFit(pts, meta, DEFAULT_OPTIONS));
  }
});
