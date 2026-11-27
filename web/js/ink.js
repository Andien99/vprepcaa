// Working space: a graph-paper pad for pen, finger or mouse (the Pixel Practice
// working pane, cut down for the web). Pressure-sensitive pen, stroke eraser, undo,
// clear; S Pen / stylus side button erases. Once a pen is seen, fingers scroll
// instead of drawing (palm rejection). Points are stored as fractions of the pad
// width, so marks stay put when the window is resized.

/** @typedef {{ c: string, w: number, p: number[][] }} Stroke */

const COLOURS = ['#14243A', '#2B5CC8', '#B4372C'];

export class InkPad {
  /**
   * @param {HTMLElement} host element to fill
   * @param {{ height?: number }} [opts]
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.height = opts.height ?? 420;
    /** @type {Stroke[]} */ this.strokes = [];
    /** @type {Stroke[][]} */ this.undoStack = [];
    this.colour = COLOURS[0];
    this.tool = 'pen';
    this.penSeen = false;
    /** @type {Stroke | null} */ this.current = null;
    this.erasing = false;
    host.classList.add('ink');
    host.innerHTML = `
      <div class="ink-tools" role="toolbar" aria-label="Working space tools">
        ${COLOURS.map((c, i) => `<button type="button" class="sw" data-colour="${c}" style="background:${c}" aria-label="${['Black', 'Blue', 'Red'][i]} pen" aria-pressed="${i === 0}"></button>`).join('')}
        <button type="button" class="tool" data-tool="eraser" aria-pressed="false">Eraser</button>
        <button type="button" class="tool" data-act="undo">Undo</button>
        <button type="button" class="tool" data-act="clear">Clear</button>
        <button type="button" class="tool" data-act="grow" title="More room">+ Space</button>
      </div>
      <div class="ink-stage"><canvas></canvas></div>`;
    this.stage = /** @type {HTMLElement} */ (host.querySelector('.ink-stage'));
    this.canvas = /** @type {HTMLCanvasElement} */ (host.querySelector('canvas'));
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    host.querySelector('.ink-tools')?.addEventListener('click', (e) => this.onTool(/** @type {HTMLElement} */ (e.target)));
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this.canvas.addEventListener(ev, (e) => this.onPointer(/** @type {PointerEvent} */ (e)));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.resize();
  }

  /** Strokes for saving between questions. */
  get value() {
    return this.strokes;
  }
  set value(v) {
    this.strokes = Array.isArray(v) ? v : [];
    this.undoStack = [];
    this.redraw();
  }

  onTool(/** @type {HTMLElement} */ b) {
    if (b.dataset.colour) {
      this.colour = b.dataset.colour;
      this.tool = 'pen';
    } else if (b.dataset.tool) this.tool = this.tool === 'eraser' ? 'pen' : 'eraser';
    else if (b.dataset.act === 'undo') {
      const prev = this.undoStack.pop();
      if (prev) this.strokes = prev;
      this.redraw();
    } else if (b.dataset.act === 'clear') {
      if (this.strokes.length) this.undoStack.push(this.strokes.slice());
      this.strokes = [];
      this.redraw();
    } else if (b.dataset.act === 'grow') {
      this.height += 240;
      this.resize();
    }
    this.host.querySelectorAll('.sw').forEach((s) => s.setAttribute('aria-pressed', String(this.tool === 'pen' && /** @type {HTMLElement} */ (s).dataset.colour === this.colour)));
    this.host.querySelector('[data-tool]')?.setAttribute('aria-pressed', String(this.tool === 'eraser'));
  }

  resize() {
    const w = this.stage.clientWidth || 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.height = `${this.height}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.redraw();
  }

  /** @param {PointerEvent} e */
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width, p];
  }

  /** @param {PointerEvent} e */
  onPointer(e) {
    if (e.pointerType === 'pen') {
      this.penSeen = true;
      this.canvas.style.touchAction = 'none';
    }
    // Palm rejection: with a pen around, fingers scroll the page instead of drawing.
    if (e.pointerType === 'touch' && this.penSeen) return;
    const side = (e.pointerType === 'pen' || e.pointerType === 'mouse') && !!(e.buttons & 2 || e.buttons & 32);
    if (e.type === 'pointerdown') {
      this.canvas.setPointerCapture(e.pointerId);
      this.erasing = this.tool === 'eraser' || side;
      this.undoStack.push(this.strokes.slice());
      if (this.undoStack.length > 50) this.undoStack.shift();
      if (this.erasing) this.eraseAt(this.pos(e));
      else {
        this.current = { c: this.colour, w: 2.2, p: [this.pos(e)] };
        this.strokes.push(this.current);
      }
      e.preventDefault();
    } else if (e.type === 'pointermove' && (this.current || this.erasing)) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of events.length ? events : [e]) {
        if (this.erasing) this.eraseAt(this.pos(ce));
        else if (this.current) {
          this.current.p.push(this.pos(ce));
          this.drawLast(this.current);
        }
      }
      e.preventDefault();
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      if (this.current && this.current.p.length === 1) this.current.p.push(this.current.p[0]);
      this.current = null;
      this.erasing = false;
      this.redraw();
    }
  }

  /** Removes whole strokes passing near the point (2% of the pad width). */
  eraseAt(/** @type {number[]} */ pt) {
    const r = 0.02;
    const before = this.strokes.length;
    this.strokes = this.strokes.filter((s) => !s.p.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < r));
    if (this.strokes.length !== before) this.redraw();
  }

  drawSeg(/** @type {Stroke} */ s, /** @type {number} */ i) {
    const W = this.W ?? 600;
    const a = s.p[i - 1];
    const b = s.p[i];
    const ctx = this.ctx;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w * (0.55 + b[2]) * Math.max(1, W / 700);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0] * W, a[1] * W);
    ctx.lineTo(b[0] * W, b[1] * W);
    ctx.stroke();
  }

  drawLast(/** @type {Stroke} */ s) {
    if (s.p.length > 1) this.drawSeg(s, s.p.length - 1);
  }

  redraw() {
    const W = this.W ?? 600;
    this.ctx.clearRect(0, 0, W, this.height);
    for (const s of this.strokes) for (let i = 1; i < s.p.length; i++) this.drawSeg(s, i);
  }
}
