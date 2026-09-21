/**
 * One Euro Filter (Casiez et al., CHI 2012).
 * Adaptive low-pass filter: heavy smoothing when the signal is slow (removes
 * jitter), light smoothing when it moves fast (removes lag). Ideal for
 * landmark streams where a static pose must not shake but motion must feel live.
 */
class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuro {
  /**
   * @param {object} o
   * @param {number} [o.minCutoff=1.2] Hz, lower = smoother at rest
   * @param {number} [o.beta=0.02]    higher = less lag during fast motion
   * @param {number} [o.dCutoff=1.0]  Hz, cutoff for the derivative estimate
   */
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param {number} value @param {number} tSeconds monotonically increasing */
  filter(value, tSeconds) {
    if (this.lastT === null) {
      this.lastT = tSeconds;
      this.x.filter(value, 1);
      this.dx.filter(0, 1);
      return value;
    }
    const dt = Math.max(tSeconds - this.lastT, 1e-3);
    this.lastT = tSeconds;
    const rate = (value - this.x.y) / dt;
    const edx = this.dx.filter(rate, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, OneEuro.alpha(cutoff, dt));
  }
}

/** Smooths a 2D point with two independent One Euro filters. */
export class PointFilter {
  constructor(opts) {
    this.fx = new OneEuro(opts);
    this.fy = new OneEuro(opts);
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
  filter(p, t) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t) };
  }
}
