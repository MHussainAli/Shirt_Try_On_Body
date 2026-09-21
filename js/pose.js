/**
 * Thin wrapper around MediaPipe Tasks "PoseLandmarker".
 * Everything runs in the browser (WASM + WebGL); no frame ever leaves the device.
 */
const VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

export const MODELS = {
  lite: `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  full: `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
};

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.variant = null;
    this.delegate = null;
    this.mode = 'VIDEO';
    this._vision = null;
  }

  get ready() {
    return !!this.landmarker;
  }

  /** @param {'lite'|'full'} variant */
  async init(variant = 'lite') {
    if (this.landmarker && this.variant === variant) return;
    if (!this._vision) {
      const vision = await import(/* webpackIgnore: true */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      this._vision = { ...vision, fileset };
    }
    const { PoseLandmarker, fileset } = this._vision;
    const create = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS[variant], delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let next;
    try {
      next = await create('GPU');
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      next = await create('CPU');
      this.delegate = 'CPU';
    }
    this.landmarker?.close();
    this.landmarker = next;
    this.variant = variant;
    this.mode = 'VIDEO';
  }

  async setMode(mode) {
    if (!this.landmarker || this.mode === mode) return;
    await this.landmarker.setOptions({ runningMode: mode });
    this.mode = mode;
  }

  /** @returns {{x:number,y:number,z:number,visibility:number}[]|null} */
  detectVideo(video, timestampMs) {
    const res = this.landmarker.detectForVideo(video, timestampMs);
    return res.landmarks?.[0] ?? null;
  }

  async detectImage(image) {
    await this.setMode('IMAGE');
    const res = this.landmarker.detect(image);
    return res.landmarks?.[0] ?? null;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.variant = null;
  }
}
