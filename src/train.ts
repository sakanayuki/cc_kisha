import { Pose, poseAt } from './geometry';
import { Link, Piece, Track } from './track';
import { CAR_SPACING } from './render';

interface Item {
  piece: Piece;
  dir: 1 | -1; // 1: 始点→終点 / -1: 終点→始点
  g0: number; // 走行経路上でこのパーツが始まる位置
}

/** タップ位置から進行方向に並べたレールの列(ループなら環状) */
class Run {
  items: Item[] = [];
  total = 0;
  loop = false;
  g = 0; // 列車の先頭の位置(タップ位置)

  /** g の位置にあるパーツ(範囲外は端のパーツ) */
  pieceAt(g: number): Piece {
    if (this.loop) g = ((g % this.total) + this.total) % this.total;
    let it = this.items[0];
    for (const i of this.items) {
      if (i.g0 <= g) it = i;
    }
    return it.piece;
  }

  poseAt(g: number): Pose & { off: boolean } {
    if (this.loop) g = ((g % this.total) + this.total) % this.total;
    if (g < 0) {
      const f = this.items[0];
      const p = travelPose(f, 0);
      return { x: p.x + Math.cos(p.h) * g, y: p.y + Math.sin(p.h) * g, h: p.h, off: false };
    }
    if (g > this.total) {
      const l = this.items[this.items.length - 1];
      const p = travelPose(l, l.piece.seg.len);
      const d = g - this.total;
      return { x: p.x + Math.cos(p.h) * d, y: p.y + Math.sin(p.h) * d, h: p.h, off: true };
    }
    let it = this.items[0];
    for (const i of this.items) {
      if (i.g0 <= g) it = i;
    }
    return { ...travelPose(it, g - it.g0), off: false };
  }
}

/** item の中を travelled だけ進んだ位置の姿勢(進行方向を向く) */
function travelPose(it: Item, travelled: number): Pose {
  const len = it.piece.seg.len;
  if (it.dir === 1) return poseAt(it.piece.seg, travelled);
  const p = poseAt(it.piece.seg, len - travelled);
  return { x: p.x, y: p.y, h: p.h + Math.PI };
}

function next(piece: Piece, dir: 1 | -1): { piece: Piece; dir: 1 | -1 } | null {
  const link: Link | null = dir === 1 ? piece.linkB : piece.linkA;
  if (!link) return null;
  return { piece: link.piece, dir: link.end === 'A' ? 1 : -1 };
}

/** start の先へ辿ったときの列(start 自身は含まない)。環状に戻ったら loop を true にする */
function walk(start: Piece, dir: 1 | -1, max: number) {
  const out: { piece: Piece; dir: 1 | -1 }[] = [];
  let cur = { piece: start, dir };
  let loop = false;
  for (let i = 0; i < max; i++) {
    const n = next(cur.piece, cur.dir);
    if (!n) break;
    if (n.piece === start) {
      loop = true;
      break;
    }
    out.push(n);
    cur = n;
  }
  return { out, loop };
}

const lenOf = (list: { piece: Piece }[]) => list.reduce((s, i) => s + i.piece.seg.len, 0);

function buildRun(track: Track, piece: Piece, u: number): Run {
  const max = track.pieces.length + 1;
  const fwd = walk(piece, 1, max);
  const bwd = walk(piece, -1, max);
  const run = new Run();
  run.loop = fwd.loop;

  // 先に長く続く側へ走らせる
  const ahead = (dir: 1 | -1) => {
    const w = dir === 1 ? fwd : bwd;
    if (w.loop) return Infinity;
    const rest = dir === 1 ? piece.seg.len - u : u;
    return rest + lenOf(w.out);
  };
  const dir: 1 | -1 = ahead(-1) > ahead(1) ? -1 : 1;
  const forward = dir === 1 ? fwd : bwd;
  const backward = dir === 1 ? bwd : fwd;

  const seq: { piece: Piece; dir: 1 | -1 }[] = [];
  if (!run.loop) {
    for (let i = backward.out.length - 1; i >= 0; i--) {
      const b = backward.out[i];
      seq.push({ piece: b.piece, dir: b.dir === 1 ? -1 : 1 });
    }
  }
  const tapIdx = seq.length;
  seq.push({ piece, dir });
  seq.push(...forward.out);

  let g = 0;
  for (const s of seq) {
    run.items.push({ ...s, g0: g });
    g += s.piece.seg.len;
  }
  run.total = g;
  run.g = run.items[tapIdx].g0 + (dir === 1 ? u : piece.seg.len - u);
  run.loop = forward.loop;
  return run;
}

interface CarState {
  fallStart: number | null; // 転倒が始まった時刻
  pose: Pose;
  spin: number;
  side: number;
}

const SPEED = 130;
const FALL_TIME = 1.1;

export interface DrawableCar {
  idx: number;
  x: number;
  y: number;
  h: number;
  alpha: number;
  piece: Piece | null; // 乗っているレール(転倒中は null)
}

export class Train {
  private run: Run;
  private head: number;
  private time = 0;
  private cars: CarState[];

  constructor(track: Track, piece: Piece, u: number, carCount: number) {
    this.run = buildRun(track, piece, u);
    this.head = this.run.g;
    this.cars = Array.from({ length: carCount }, () => ({
      fallStart: null,
      pose: { x: 0, y: 0, h: 0 },
      spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3),
      side: (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 30),
    }));
  }

  get finished() {
    return this.cars.every((c) => c.fallStart !== null && this.time - c.fallStart > FALL_TIME);
  }

  update(dt: number) {
    this.time += dt;
    this.head += SPEED * dt;
    this.cars.forEach((c, i) => {
      if (c.fallStart !== null) return;
      const g = this.head - i * CAR_SPACING;
      if (!this.run.loop && g > this.run.total) {
        c.fallStart = this.time;
        const p = this.run.poseAt(this.run.total);
        c.pose = { x: p.x, y: p.y, h: p.h };
      }
    });
  }

  /** 描画用の各車両の位置。軸間の2点から向きを決めてカーブに沿わせる */
  carsToDraw(): DrawableCar[] {
    const out: DrawableCar[] = [];
    this.cars.forEach((c, i) => {
      if (c.fallStart !== null) {
        const t = this.time - c.fallStart;
        if (t > FALL_TIME) return;
        const k = t / FALL_TIME;
        const d = SPEED * t * 0.45;
        const { x, y, h } = c.pose;
        out.push({
          idx: i,
          x: x + Math.cos(h) * d - Math.sin(h) * c.side * k,
          y: y + Math.sin(h) * d + Math.cos(h) * c.side * k,
          h: h + c.spin * t,
          alpha: 1 - k * k,
          piece: null,
        });
        return;
      }
      const g = this.head - i * CAR_SPACING;
      const a = this.run.poseAt(g + CAR_SPACING * 0.32);
      const b = this.run.poseAt(g - CAR_SPACING * 0.32);
      out.push({
        idx: i,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        h: Math.atan2(a.y - b.y, a.x - b.x),
        alpha: 1,
        piece: this.run.pieceAt(g),
      });
    });
    return out;
  }
}

