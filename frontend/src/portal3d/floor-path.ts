// Where people can walk on the venue's 3D floor (`/venue/floor.json`, from `pipeline/venue_floor.py`): the model
// seen from above as a grid of 25 cm cells, open where there is floor and nothing in the way. The same grid and
// the same search as the module's `venue::floor`, so the medic walks the aisles the way the crowd does.

/** A point on the floor in model metres: x east, z south. */
export type P = [number, number];

type FloorFile = { x0: number; z0: number; cell: number; cols: number; rows: number; runs: number[] };

/** Cells searched around a point that stands where nobody can, for the nearest walkable one: 6 m. */
const SNAP_CELLS = 24;
/** A* takes up to this many cells before giving up on a path. */
const MAX_EXPANDED = 120_000;
/** A clear line keeps this far from closed cells, in metres. */
const HAIR_M = 0.005;
/** A* leans this much on the distance left, which finds a path faster and the string pulling straightens. */
const GREED = 1.3;
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Floor {
  private x0: number;
  private z0: number;
  private cell: number;
  private cols: number;
  private rows: number;
  private open: Uint8Array;

  constructor(f: FloorFile) {
    this.x0 = f.x0; this.z0 = f.z0; this.cell = f.cell; this.cols = f.cols; this.rows = f.rows;
    // Runs of closed and open cells, row by row, starting with a closed run.
    this.open = new Uint8Array(f.cols * f.rows);
    let i = 0;
    f.runs.forEach((n, k) => {
      if (k % 2 === 1) this.open.fill(1, i, i + n);
      i += n;
    });
  }

  /** The venue's floor, or nothing when it has none. */
  static async load(url = '/venue/floor.json'): Promise<Floor | undefined> {
    try {
      return new Floor(await (await fetch(url)).json());
    } catch {
      return undefined;
    }
  }

  private isOpen(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.open[r * this.cols + c] === 1;
  }

  private cellOf([x, z]: P): [number, number] {
    return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)];
  }

  private centre(c: number, r: number): P {
    return [this.x0 + (c + 0.5) * this.cell, this.z0 + (r + 0.5) * this.cell];
  }

  /** The point itself where someone can stand there, else the nearest point of the nearest walkable cell within 6 m. */
  snap(p: P): P {
    const [c, r] = this.cellOf(p);
    if (this.isOpen(c, r)) return p;
    let best: [number, P] | undefined;
    for (let ring = 1; ring <= SNAP_CELLS; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if ((Math.abs(dr) !== ring && Math.abs(dc) !== ring) || !this.isOpen(c + dc, r + dr)) continue;
          const [cx, cz] = this.centre(c + dc, r + dr);
          const h = this.cell * 0.45;
          const q: P = [Math.min(cx + h, Math.max(cx - h, p[0])), Math.min(cz + h, Math.max(cz - h, p[1]))];
          const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
          if (!best || d < best[0]) best = [d, q];
        }
      }
      if (best && Math.sqrt(best[0]) <= (ring - 1) * this.cell) return best[1];
    }
    return best ? best[1] : p;
  }

  /** True when the straight line from `a` to `b` crosses only walkable cells, with a hair to spare on either side. */
  clear(a: P, b: P): boolean {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      const [c, r] = this.cellOf(a);
      return this.isOpen(c, r);
    }
    const nx = (-dz / len) * HAIR_M;
    const nz = (dx / len) * HAIR_M;
    return this.line(a, b)
      && this.line([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz])
      && this.line([a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz]);
  }

  /** True when every cell the segment touches is open; through a corner, both cells beside it count. */
  private line(a: P, b: P): boolean {
    let [c, r] = this.cellOf(a);
    const [ec, er] = this.cellOf(b);
    if (!this.isOpen(c, r) || !this.isOpen(ec, er)) return false;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const sc = dx > 0 ? 1 : -1;
    const sr = dz > 0 ? 1 : -1;
    const edge = (o: number, i: number, s: number) => o + (i + (s > 0 ? 1 : 0)) * this.cell;
    let tx = dx !== 0 ? (edge(this.x0, c, sc) - a[0]) / dx : Infinity;
    const dtx = dx !== 0 ? this.cell / Math.abs(dx) : Infinity;
    let tz = dz !== 0 ? (edge(this.z0, r, sr) - a[1]) / dz : Infinity;
    const dtz = dz !== 0 ? this.cell / Math.abs(dz) : Infinity;
    for (let n = Math.abs(ec - c) + Math.abs(er - r) + 2; n > 0; n--) {
      if ((c === ec && r === er) || Math.min(tx, tz) > 1) break;
      if (Math.abs(tx - tz) < 1e-6) {
        if (!this.isOpen(c + sc, r) || !this.isOpen(c, r + sr)) return false;
        c += sc; r += sr; tx += dtx; tz += dtz;
      } else if (tx < tz) {
        c += sc; tx += dtx;
      } else {
        r += sr; tz += dtz;
      }
      if (!this.isOpen(c, r)) return false;
    }
    return true;
  }

  /** The corners of the shortest walkable way from `a` to `b`, or nothing when no way joins them. */
  path(a: P, b: P): P[] | undefined {
    if (this.clear(a, b)) return [a, b];
    const [sc, sr] = this.cellOf(a);
    const [gc, gr] = this.cellOf(b);
    if (!this.isOpen(sc, sr) || !this.isOpen(gc, gr)) return undefined;
    const cols = this.cols;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return GREED * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
    };
    const g = new Float32Array(cols * this.rows).fill(Infinity);
    const from = new Int32Array(cols * this.rows).fill(-1);
    const heap = new Heap();
    const start = sr * cols + sc;
    const goal = gr * cols + gc;
    g[start] = 0;
    heap.push(h(sc, sr), start);
    let found = false;
    for (let expanded = 0; heap.size && expanded < MAX_EXPANDED;) {
      const [f, cell] = heap.pop();
      if (cell === goal) { found = true; break; }
      const c = cell % cols;
      const r = (cell - c) / cols;
      // A cell queued again with a shorter way since: this entry is stale.
      if (f > g[cell] + h(c, r) + 1e-3) continue;
      expanded++;
      for (const [dc, dr] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.isOpen(nc, nr)) continue;
        // No cutting a corner: a diagonal step needs both cells beside it open.
        if (dc && dr && !(this.isOpen(c + dc, r) && this.isOpen(c, r + dr))) continue;
        const n = nr * cols + nc;
        const ng = g[cell] + (dc && dr ? Math.SQRT2 : 1);
        if (ng < g[n] - 1e-4) {
          g[n] = ng;
          from[n] = cell;
          heap.push(ng + h(nc, nr), n);
        }
      }
    }
    if (!found) return undefined;
    const cells = [goal];
    while (cells[cells.length - 1] !== start) cells.push(from[cells[cells.length - 1]]);
    cells.reverse();
    const pts: P[] = [a, ...cells.slice(1, -1).map(i => this.centre(i % cols, Math.floor(i / cols))), b];
    return this.pull(pts);
  }

  /** The fewest corners of a polyline: from each corner, straight to the farthest later point in plain view. */
  private pull(pts: P[]): P[] {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1;) {
      let j = i + 1;
      while (j + 1 < pts.length && this.clear(pts[i], pts[j + 1])) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

/** A binary min-heap of cells by their score. */
class Heap {
  private f: number[] = [];
  private cells: number[] = [];

  get size() {
    return this.f.length;
  }

  push(f: number, cell: number) {
    let i = this.f.length;
    this.f.push(f);
    this.cells.push(cell);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.f[up] <= f) break;
      this.f[i] = this.f[up];
      this.cells[i] = this.cells[up];
      i = up;
    }
    this.f[i] = f;
    this.cells[i] = cell;
  }

  pop(): [number, number] {
    const top: [number, number] = [this.f[0], this.cells[0]];
    const f = this.f.pop()!;
    const cell = this.cells.pop()!;
    const n = this.f.length;
    if (n) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= n) break;
        if (k + 1 < n && this.f[k + 1] < this.f[k]) k++;
        if (this.f[k] >= f) break;
        this.f[i] = this.f[k];
        this.cells[i] = this.cells[k];
        i = k;
      }
      this.f[i] = f;
      this.cells[i] = cell;
    }
    return top;
  }
}
