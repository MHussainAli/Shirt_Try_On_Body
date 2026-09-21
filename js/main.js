/**
 * TailorAI — app controller. Wires camera/demo/photo sources to the pose
 * engine, the fitting maths and the UI.
 */
import { AUTHOR } from './config.js';
import { PoseEngine } from './pose.js';
import { PointFilter } from './filters.js';
import { DEFAULT_OPTIONS, computeFit, lerpMatrix, selectAnchors, toPixels } from './fit.js';
import { drawGarment, drawSkeleton } from './draw.js';
import { DEMO_SIZE, demoLandmarks, drawDemoScene } from './demo.js';
import { garmentFromFile, loadCatalog, loadImage } from './catalog.js';

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'), canvas: $('output'), video: $('video'), hud: $('hud'),
  overlay: $('overlay'), overlayIcon: $('overlayIcon'), overlayTitle: $('overlayTitle'),
  overlayText: $('overlayText'), overlayActions: $('overlayActions'), flash: $('flash'),
  catalog: $('catalog'), shirtName: $('shirtName'),
  btnCamera: $('btnCamera'), btnDemo: $('btnDemo'), btnStop: $('btnStop'),
  btnPrev: $('btnPrev'), btnNext: $('btnNext'), btnSnap: $('btnSnap'),
  btnSkel: $('btnSkel'), btnMirror: $('btnMirror'), btnFull: $('btnFull'),
  photoInput: $('photoInput'), shirtInput: $('shirtInput'),
};
const ctx = el.canvas.getContext('2d', { alpha: false });
const engine = new PoseEngine();

const SMOOTHING = [
  { label: 'Smooth', minCutoff: 0.6, beta: 0.01 },
  { label: 'Balanced', minCutoff: 1.2, beta: 0.02 },
  { label: 'Responsive', minCutoff: 2.5, beta: 0.05 },
];

const state = {
  source: 'idle', // idle | camera | demo | photo  (idle renders the demo scene behind the overlay)
  mirror: true,
  skeleton: false,
  options: { ...DEFAULT_OPTIONS },
  opacity: 1,
  catalog: [],
  index: 0,
  shirt: null,
  shirtImg: null,
  model: 'lite',
  smoothing: 1,
  stream: null,
  photo: null,
  busy: false,
  px: null,
  pts: null,
  matrix: null,
  presence: 0,
  lastSeen: -1e9,
  confidence: 0,
  lastVideoTime: -1,
  fps: 0,
  inferMs: 0,
};

/* ------------------------------------------------------------------ */
/* Smoothing                                                           */
/* ------------------------------------------------------------------ */
class AnchorSmoother {
  constructor(preset) {
    this.f = { sl: new PointFilter(preset), sr: new PointFilter(preset), hl: new PointFilter(preset), hr: new PointFilter(preset) };
  }
  update(a, t) {
    const out = { sl: this.f.sl.filter(a.sl, t), sr: this.f.sr.filter(a.sr, t), hips: a.hips };
    if (a.hips) {
      out.hl = this.f.hl.filter(a.hl, t);
      out.hr = this.f.hr.filter(a.hr, t);
    } else {
      this.f.hl.reset();
      this.f.hr.reset();
    }
    return out;
  }
}
let smoother = new AnchorSmoother(SMOOTHING[state.smoothing]);

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
function setOverlay({ icon = null, spinner = false, title, text, actions = false }) {
  el.overlay.classList.remove('off');
  el.overlayIcon.innerHTML = spinner ? '<div class="spinner"></div>' : icon ?? '👕';
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  el.overlayActions.style.display = actions ? '' : 'none';
}
const hideOverlay = () => el.overlay.classList.add('off');

let toastTimer;
function toast(message) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function resetTracking() {
  state.px = null;
  state.pts = null;
  state.lastSeen = -1e9;
  state.presence = 0;
  state.matrix = null;
  smoother = new AnchorSmoother(SMOOTHING[state.smoothing]);
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */
function renderTile(item, i) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  b.setAttribute('role', 'option');
  b.setAttribute('aria-label', item.name);
  b.title = item.name;
  b.dataset.index = i;
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = '';
  img.loading = 'lazy';
  b.append(img);
  b.addEventListener('click', () => selectShirt(Number(b.dataset.index)));
  el.catalog.append(b);
}

async function selectShirt(i) {
  const n = state.catalog.length;
  if (!n) return;
  state.index = ((i % n) + n) % n;
  const item = state.catalog[state.index];
  state.shirt = { anchors: item.anchors };
  el.shirtName.textContent = item.name;
  [...el.catalog.children].forEach((c, k) => c.setAttribute('aria-selected', String(k === state.index)));
  try {
    state.shirtImg = await loadImage(item.src);
  } catch (e) {
    toast('Could not load that garment.');
  }
}

async function addCustomShirt(file) {
  if (!file) return;
  try {
    const item = await garmentFromFile(file);
    state.catalog.push(item);
    renderTile(item, state.catalog.length - 1);
    await selectShirt(state.catalog.length - 1);
    toast('Custom shirt added — fine-tune it with the Fit sliders.');
  } catch (e) {
    toast(e.message || 'Could not read that image.');
  }
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */
function stopStream() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  el.video.srcObject = null;
}

function goIdle() {
  stopStream();
  state.source = 'idle';
  state.photo = null;
  resetTracking();
  el.canvas.width = DEMO_SIZE.width;
  el.canvas.height = DEMO_SIZE.height;
  el.hud.hidden = true;
  el.btnStop.hidden = true;
  setOverlay({
    title: 'Ready when you are',
    text: 'Start your camera for a live try-on. Video is processed locally and never uploaded.',
    actions: true,
  });
}

function startDemo() {
  stopStream();
  state.source = 'demo';
  state.photo = null;
  resetTracking();
  el.canvas.width = DEMO_SIZE.width;
  el.canvas.height = DEMO_SIZE.height;
  el.hud.hidden = false;
  el.btnStop.hidden = false;
  hideOverlay();
}

async function ensureEngine(message) {
  if (engine.ready && engine.variant === state.model) return true;
  setOverlay({ spinner: true, title: 'Loading pose model…', text: message || 'Downloading the MediaPipe model (about 6 MB, cached afterwards).' });
  try {
    await engine.init(state.model);
    return true;
  } catch (err) {
    console.error(err);
    setOverlay({
      icon: '⚠️',
      title: 'Could not load the pose model',
      text: 'Check your internet connection (the model is fetched from a CDN the first time) and try again — or explore the demo mannequin.',
      actions: true,
    });
    return false;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setOverlay({
      icon: '🔒',
      title: 'Camera not available',
      text: 'Browsers only allow camera access on https:// pages or localhost. Open the site over HTTPS, or use the demo / photo options.',
      actions: true,
    });
    return;
  }
  stopStream();
  setOverlay({ spinner: true, title: 'Starting camera…', text: 'Please allow camera access when your browser asks.' });
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    el.video.srcObject = state.stream;
    await el.video.play();
  } catch (err) {
    const denied = err?.name === 'NotAllowedError';
    setOverlay({
      icon: '📷',
      title: denied ? 'Camera permission needed' : 'Could not start the camera',
      text: denied
        ? 'Allow camera access in your browser’s address bar, then press “Start camera” again. You can also try the demo mannequin or upload a photo.'
        : 'No usable camera was found, or it is in use by another app. You can still try the demo or upload a photo.',
      actions: true,
    });
    stopStream();
    return;
  }
  if (!(await ensureEngine())) {
    stopStream();
    return;
  }
  await engine.setMode('VIDEO');
  resetTracking();
  state.source = 'camera';
  state.lastVideoTime = -1;
  el.hud.hidden = false;
  el.btnStop.hidden = false;
  hideOverlay();
}

async function loadPhoto(file) {
  if (!file) return;
  stopStream();
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!(await ensureEngine('Preparing the pose model for your photo…'))) return;
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    el.canvas.width = w;
    el.canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const lm = await engine.detectImage(el.canvas);
    const anchors = lm && selectAnchors(toPixels(lm, w, h, false), w, h);
    if (!anchors) {
      goIdle();
      setOverlay({ icon: '🧍', title: 'No person found', text: 'Use a photo where your shoulders are clearly visible, facing the camera.', actions: true });
      return;
    }
    state.source = 'photo';
    state.photo = img;
    resetTracking();
    state.px = toPixels(lm, w, h, false);
    state.pts = anchors;
    state.confidence = anchors.confidence;
    state.lastSeen = performance.now();
    el.hud.hidden = false;
    el.btnStop.hidden = false;
    hideOverlay();
  } catch (e) {
    console.error(e);
    toast('Could not open that image.');
  } finally {
    URL.revokeObjectURL(url);
    el.photoInput.value = '';
  }
}

/* ------------------------------------------------------------------ */
/* Frame processing                                                    */
/* ------------------------------------------------------------------ */
function ingest(px, nowMs) {
  const anchors = selectAnchors(px, el.canvas.width, el.canvas.height);
  if (!anchors) return;
  state.px = px;
  state.pts = smoother.update(anchors, nowMs / 1000);
  state.confidence = anchors.confidence;
  state.lastSeen = nowMs;
}

let lastFrame = performance.now();
let hudAt = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  state.fps += (1 / Math.max(dt, 1e-3) - state.fps) * 0.08;

  const W = el.canvas.width;
  const H = el.canvas.height;

  if (state.source === 'camera') {
    const v = el.video;
    if (v.readyState < 2) return;
    if (v.videoWidth && (W !== v.videoWidth || H !== v.videoHeight)) {
      el.canvas.width = v.videoWidth;
      el.canvas.height = v.videoHeight;
    }
    ctx.save();
    if (state.mirror) {
      ctx.translate(el.canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, el.canvas.width, el.canvas.height);
    ctx.restore();

    if (!state.busy && v.currentTime !== state.lastVideoTime && engine.ready) {
      state.lastVideoTime = v.currentTime;
      const t0 = performance.now();
      let lm = null;
      try {
        lm = engine.detectVideo(v, t0);
      } catch (e) {
        console.warn(e);
      }
      state.inferMs += (performance.now() - t0 - state.inferMs) * 0.15;
      if (lm) ingest(toPixels(lm, el.canvas.width, el.canvas.height, state.mirror), now);
    }
  } else if (state.source === 'photo' && state.photo) {
    ctx.drawImage(state.photo, 0, 0, W, H);
  } else {
    // demo / idle: animated mannequin with synthetic landmarks
    const t = now / 1000;
    const lm = demoLandmarks(t);
    drawDemoScene(ctx, lm, t);
    ingest(toPixels(lm, W, H, false), now);
  }

  // --- garment ---------------------------------------------------------
  const photo = state.source === 'photo';
  const visible = !!state.pts && (photo || now - state.lastSeen < 350);
  if (!visible && state.source === 'camera' && state.pts) smoother = new AnchorSmoother(SMOOTHING[state.smoothing]);
  state.presence = photo ? (visible ? 1 : 0) : state.presence + ((visible ? 1 : 0) - state.presence) * (1 - Math.exp(-dt * 10));

  const fit = state.pts && state.shirt ? computeFit(state.pts, state.shirt, state.options) : null;
  if (fit) state.matrix = photo ? fit.matrix : lerpMatrix(state.matrix, fit.matrix, dt);

  if (fit && state.shirtImg && state.presence > 0.02) {
    drawGarment(ctx, state.shirtImg, state.matrix, state.presence * state.opacity);
  }
  if (state.skeleton && state.px && visible) drawSkeleton(ctx, state.px);

  // --- HUD ---------------------------------------------------------------
  if (now - hudAt > 250 && !el.hud.hidden) {
    hudAt = now;
    $('hudFps').textContent = `${Math.round(state.fps)} FPS`;
    $('hudMs').textContent = state.source === 'camera' ? `${state.inferMs.toFixed(1)} ms / pose` : state.source;
    $('hudDelegate').textContent = state.source === 'camera' || photo ? engine.delegate ?? '--' : 'synthetic';
    $('hudConf').textContent = visible ? `tracking: ${Math.round(state.confidence * 100)}%` : 'tracking: searching…';
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */
function snapshot() {
  el.canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tailorai-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

function toggle(button, key) {
  state[key] = !state[key];
  button.setAttribute('aria-pressed', String(state[key]));
}

async function switchModel(variant) {
  state.model = variant;
  document.querySelectorAll('[data-model]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.model === variant)));
  if (!engine.ready) return;
  state.busy = true;
  const wasCamera = state.source === 'camera';
  if (wasCamera) setOverlay({ spinner: true, title: 'Switching model…', text: `Loading the ${variant} pose model.` });
  try {
    await engine.init(variant);
    await engine.setMode(wasCamera ? 'VIDEO' : engine.mode);
  } catch (e) {
    toast('Could not switch model.');
  }
  if (wasCamera) hideOverlay();
  state.busy = false;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function bindSlider(id, outId, apply, format) {
  const input = $(id);
  const out = $(outId);
  const update = () => {
    apply(Number(input.value));
    out.textContent = format(Number(input.value));
  };
  input.addEventListener('input', update);
  update();
  return () => {
    input.value = input.defaultValue;
    update();
  };
}

const resets = [
  bindSlider('rngSize', 'outSize', (v) => (state.options.size = v / 100), (v) => `${v}%`),
  bindSlider('rngLength', 'outLength', (v) => (state.options.length = v / 100), (v) => `${v}%`),
  bindSlider('rngOffset', 'outOffset', (v) => (state.options.offsetY = v / 100), (v) => (v > 0 ? `+${v}` : `${v}`)),
  bindSlider('rngOpacity', 'outOpacity', (v) => (state.opacity = v / 100), (v) => `${v}%`),
];
$('btnResetFit').addEventListener('click', () => resets.forEach((r) => r()));
bindSlider('rngSmooth', 'outSmooth', (v) => { state.smoothing = v; smoother = new AnchorSmoother(SMOOTHING[v]); }, (v) => SMOOTHING[v].label);

document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => switchModel(b.dataset.model)));

el.btnCamera.addEventListener('click', startCamera);
el.btnDemo.addEventListener('click', startDemo);
$('ctaDemo').addEventListener('click', () => {
  $('studio').scrollIntoView({ behavior: 'smooth' });
  startDemo();
});
el.btnStop.addEventListener('click', goIdle);
el.btnPrev.addEventListener('click', () => selectShirt(state.index - 1));
el.btnNext.addEventListener('click', () => selectShirt(state.index + 1));
el.btnSnap.addEventListener('click', snapshot);
el.btnSkel.addEventListener('click', () => toggle(el.btnSkel, 'skeleton'));
el.btnMirror.addEventListener('click', () => toggle(el.btnMirror, 'mirror'));
el.btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.stage.requestFullscreen?.();
});
el.photoInput.addEventListener('change', () => loadPhoto(el.photoInput.files[0]));
el.shirtInput.addEventListener('change', () => {
  addCustomShirt(el.shirtInput.files[0]);
  el.shirtInput.value = '';
});

const drop = document.querySelector('.upload');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => addCustomShirt(e.dataTransfer.files[0]));

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') selectShirt(state.index - 1);
  else if (k === 'd' || k === 'arrowright') selectShirt(state.index + 1);
  else if (k === 's') snapshot();
  else if (k === 'k') toggle(el.btnSkel, 'skeleton');
  else if (k === 'm') toggle(el.btnMirror, 'mirror');
  else if (k === 'f') el.btnFull.click();
});

document.addEventListener('visibilitychange', () => {
  // Free the camera when the tab is hidden for a while; resume on return.
  if (document.hidden) el.video.pause();
  else if (state.source === 'camera') el.video.play().catch(() => {});
});

/* Personalisation from config.js */
document.querySelectorAll('[data-author]').forEach((n) => (n.textContent = AUTHOR[n.dataset.author] ?? ''));
document.querySelectorAll('[data-link]').forEach((a) => {
  const key = a.dataset.link;
  const value = AUTHOR[key];
  if (!value) return;
  a.href = key === 'email' ? `mailto:${value}` : value;
  a.hidden = false;
});

/* Boot */
(async function init() {
  goIdle();
  try {
    state.catalog = await loadCatalog();
    state.catalog.forEach(renderTile);
    await selectShirt(0);
  } catch (e) {
    console.error(e);
    setOverlay({ icon: '⚠️', title: 'Could not load the wardrobe', text: 'Serve the folder over HTTP (e.g. “npm start”) instead of opening index.html directly.', actions: false });
  }
  requestAnimationFrame(tick);

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
