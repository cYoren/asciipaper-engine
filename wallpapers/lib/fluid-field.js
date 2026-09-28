// FluidField: a small, cheap liquid the pointer stirs. Pointer strokes push the fluid and leave ink;
// both drift and fade. Wallpapers sample it as a texture (see texture()) to bend and light what they
// draw, the way fluid.html and yin-yang.html do. Ported verbatim from asciify-engine
// src/surface/fluid-field.ts (MIT, (c) ayangabryl; see asciify-engine-MIT.txt).
export class FluidField {
  constructor(aspect = 1, decayRate = 3.5, continuousWake = false) {
    this.continuousWake = continuousWake; this.decayRate = decayRate;
    this.aspect = Math.max(.25, Math.min(4, aspect));
    const resolution = continuousWake ? 96 : 64;
    this.columns = this.aspect >= 1 ? resolution : Math.round(resolution * this.aspect);
    this.rows = this.aspect >= 1 ? Math.round(resolution / this.aspect) : resolution;
    this.front = new Float32Array(this.columns * this.rows * 3); this.back = new Float32Array(this.front.length);
    this.strokes = []; this.advected = [0, 0, 0]; this.previous = null; this.energy = 0;
  }
  get active() { return this.energy > .0005 || this.strokes.length > 0; }
  move(x, y, strength = 1) {
    if (!Number.isFinite(x + y)) return;
    if (this.continuousWake && !this.previous) { this.previous = { x, y }; return; }
    const previous = this.previous ?? { x: x - .004, y: y - .001 };
    const dx = Math.max(-.09, Math.min(.09, (x - previous.x) * strength));
    const dy = Math.max(-.09, Math.min(.09, (y - previous.y) * strength));
    this.previous = { x, y };
    if (Math.abs(dx) + Math.abs(dy) < .0001) return;
    const speed = Math.min(1, Math.hypot(dx * this.aspect, dy) * 25 + .06);
    this.strokes.push({ x, y, dx, dy, speed, fromX: previous.x, fromY: previous.y });
    if (this.strokes.length > 12) this.strokes.shift();
  }
  leave() { this.previous = null; }
  clear() { this.front.fill(0); this.back.fill(0); this.strokes.length = 0; this.previous = null; this.energy = 0; }
  read(data, x, y, out) {
    const gx = Math.max(0, Math.min(this.columns - 1.001, x * (this.columns - 1)));
    const gy = Math.max(0, Math.min(this.rows - 1.001, y * (this.rows - 1)));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const top = (iy * this.columns + ix) * 3, bottom = top + this.columns * 3, lw = 1 - fx, tw = 1 - fy;
    out[0] = (data[top] * lw + data[top + 3] * fx) * tw + (data[bottom] * lw + data[bottom + 3] * fx) * fy;
    out[1] = (data[top + 1] * lw + data[top + 4] * fx) * tw + (data[bottom + 1] * lw + data[bottom + 4] * fx) * fy;
    out[2] = (data[top + 2] * lw + data[top + 5] * fx) * tw + (data[bottom + 2] * lw + data[bottom + 5] * fx) * fy;
  }
  sample(x, y, out) { this.read(this.front, x, y, out); }
  step(seconds) {
    if (!this.active) return;
    const dt = Math.max(0, Math.min(.05, seconds));
    const decay = Math.exp(-dt * this.decayRate), inkDecay = Math.exp(-dt * (this.decayRate + .5));
    const xScale = Math.max(1, this.aspect), yScale = Math.max(1, 1 / this.aspect);
    let peak = 0;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      const i = (y * this.columns + x) * 3, u = x / (this.columns - 1), v = y / (this.rows - 1);
      const transport = this.continuousWake ? .65 : 2;
      this.read(this.front, u - this.front[i] * dt * transport, v - this.front[i + 1] * dt * transport, this.advected);
      let dx = this.advected[0] * decay, dy = this.advected[1] * decay, ink = this.advected[2] * inkDecay;
      for (const stroke of this.strokes) {
        let rx = (u - stroke.x) * xScale, ry = (v - stroke.y) * yScale;
        if (this.continuousWake) {
          const ax = (u - stroke.fromX) * xScale, ay = (v - stroke.fromY) * yScale;
          const bx = (stroke.x - stroke.fromX) * xScale, by = (stroke.y - stroke.fromY) * yScale;
          const along = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by || 1)));
          rx = ax - bx * along; ry = ay - by * along;
          const distance = rx * rx + ry * ry;
          if (distance > .0225) continue;
          const weight = Math.exp(-distance / .0032), travel = Math.hypot(stroke.dx * xScale, stroke.dy * yScale);
          const curl = Math.min(.025, travel * .55);
          dx += (stroke.dx * 4.2 - ry * curl) * weight; dy += (stroke.dy * 4.2 + rx * curl) * weight;
          ink = Math.max(ink, Math.min(.7, travel * 18) * weight);
          continue;
        }
        const distance = rx * rx + ry * ry;
        if (distance > .045) continue;
        const weight = Math.exp(-distance / .0075), speed = stroke.speed;
        dx += (stroke.dx * 2.8 - ry * speed * .16) * weight; dy += (stroke.dy * 2.8 + rx * speed * .16) * weight;
        ink += speed * weight * .3;
      }
      this.back[i] = Math.max(-.18, Math.min(.18, dx)); this.back[i + 1] = Math.max(-.18, Math.min(.18, dy));
      this.back[i + 2] = Math.min(.8, ink);
      peak = Math.max(peak, Math.abs(dx), Math.abs(dy), ink);
    }
    [this.front, this.back] = [this.back, this.front];
    this.strokes.length = 0; this.energy = peak;
    if (!this.active) this.clear();
  }
}

// [dx, dy, ink] per cell, packed into RGBA bytes for scene.texture(): dx, dy in +-.18, ink in 0..0.8.
export function texture(field, bytes) {
  const f = field.front;
  for (let i = 0, o = 0, n = f.length; i < n; i += 3, o += 4) {
    bytes[o] = 127.5 + f[i] / .36 * 255; bytes[o + 1] = 127.5 + f[i + 1] / .36 * 255; bytes[o + 2] = f[i + 2] / .8 * 255;
  }
  return bytes;
}
