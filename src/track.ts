import { Pose, RAIL_W, Seg, dist, endPose, poseAt } from './geometry';

export type End = 'A' | 'B';

export interface Link {
  piece: Piece;
  end: End;
}

export interface Deco {
  kind: 'tree' | 'house';
  idx: number;
  x: number;
  y: number;
  rot: number;
  size: number;
}

export interface Piece {
  seg: Seg;
  order: number; // 敷いた順。大きいほど上に重なる
  bb: { x0: number; y0: number; x1: number; y1: number }; // 画面外の描画を省くための外接矩形
  manual?: boolean; // パーツモードで置いたレール(なぞりモードの接続対象にしない)
  deco: Deco[]; // このレールを敷いたときに周りへ建った木や家
  linkA: Link | null; // 始点側の接続先
  linkB: Link | null; // 終点側の接続先
}

export interface OpenEnd {
  piece: Piece;
  end: End;
  pose: Pose; // 位置と「レールの外向き」の向き
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function boundsOf(seg: Seg) {
  const m = RAIL_W / 2 + 16; // 幅とツメのぶん
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const n = Math.max(2, Math.ceil(seg.len / 12));
  for (let k = 0; k <= n; k++) {
    const p = poseAt(seg, (seg.len * k) / n);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

const CELL = 64; // 空間グリッドのマス。飾り・レールの円は半径30以下なので隣接マスだけ見ればよい

export class Track {
  pieces: Piece[] = [];
  private nextOrder = 0;
  private grid = new Map<number, Circle[]>(); // 飾りを置く空きの判定を速くするための索引

  add(seg: Seg): Piece {
    const piece: Piece = {
      seg,
      order: this.nextOrder++,
      bb: boundsOf(seg),
      deco: [],
      linkA: null,
      linkB: null,
    };
    this.pieces.push(piece);
    this.indexRail(piece);
    return piece;
  }

  clear() {
    this.pieces = [];
    this.grid.clear();
  }

  /** パーツを外したあとに索引を作り直す */
  reindex() {
    this.grid.clear();
    for (const p of this.pieces) {
      this.indexRail(p);
      for (const d of p.deco) this.addCircle(d.x, d.y, d.size / 2);
    }
  }

  private cellKey(cx: number, cy: number) {
    return (cx + 20000) * 40000 + (cy + 20000);
  }

  addCircle(x: number, y: number, r: number) {
    const k = this.cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
    const list = this.grid.get(k);
    if (list) list.push({ x, y, r });
    else this.grid.set(k, [{ x, y, r }]);
  }

  private indexRail(piece: Piece) {
    const n = Math.max(2, Math.ceil(piece.seg.len / 10));
    for (let k = 0; k <= n; k++) {
      const q = poseAt(piece.seg, (piece.seg.len * k) / n);
      this.addCircle(q.x, q.y, RAIL_W / 2 + 3);
    }
  }

  /** (x,y) を中心とする半径 r の円が、レールや他の飾りと重ならないか */
  isClear(x: number, y: number, r: number) {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        const list = this.grid.get(this.cellKey(i, j));
        if (!list) continue;
        for (const c of list) if (Math.hypot(c.x - x, c.y - y) < r + c.r + 2) return false;
      }
    }
    return true;
  }

  /** パーツを取り除く(接続も外す)。索引は作り直す */
  remove(piece: Piece) {
    for (const l of [piece.linkA, piece.linkB]) {
      if (!l) continue;
      if (l.piece.linkA?.piece === piece) l.piece.linkA = null;
      if (l.piece.linkB?.piece === piece) l.piece.linkB = null;
    }
    this.pieces.splice(this.pieces.indexOf(piece), 1);
    this.reindex();
  }

  connect(a: Piece, ea: End, b: Piece, eb: End) {
    const link = (p: Piece, e: End, to: Link) => {
      if (e === 'A') p.linkA = to;
      else p.linkB = to;
    };
    link(a, ea, { piece: b, end: eb });
    link(b, eb, { piece: a, end: ea });
  }

  nearestOpenEnd(p: { x: number; y: number }, radius: number, exclude?: (e: OpenEnd) => boolean) {
    let best: OpenEnd | null = null;
    let bestD = radius;
    const consider = (piece: Piece, end: End, pose: Pose) => {
      if (Math.abs(pose.x - p.x) > bestD || Math.abs(pose.y - p.y) > bestD) return;
      const d = dist(pose, p);
      if (d > bestD) return;
      const e: OpenEnd = { piece, end, pose };
      if (exclude && exclude(e)) return;
      best = e;
      bestD = d;
    };
    for (const piece of this.pieces) {
      const s = piece.seg;
      if (!piece.linkA) consider(piece, 'A', { x: s.x, y: s.y, h: s.h + Math.PI });
      if (!piece.linkB) consider(piece, 'B', endPose(s));
    }
    return best as OpenEnd | null;
  }

  /**
   * 車両(長さ len・幅 wid の長方形)に重なる、base より上のレールを返す。
   * 交差で下をくぐる列車を、上のレールの下に描くために使う。
   */
  coveringPieces(car: Pose & { x: number; y: number }, base: Piece, len: number, wid: number) {
    const out: Piece[] = [];
    const near = new Set<Piece>([base]);
    // つながっているパーツ(2つ先まで)は同じ線路の一部なので上には重ねない
    let frontier = [base];
    for (let i = 0; i < 2; i++) {
      const nx: Piece[] = [];
      for (const q of frontier) {
        for (const l of [q.linkA, q.linkB]) {
          if (l && !near.has(l.piece)) {
            near.add(l.piece);
            nx.push(l.piece);
          }
        }
      }
      frontier = nx;
    }
    const cos = Math.cos(car.h);
    const sin = Math.sin(car.h);
    const rr = RAIL_W * 0.4;
    for (const q of this.pieces) {
      if (q.order <= base.order || near.has(q)) continue;
      const s = q.seg;
      if (Math.hypot(s.x - car.x, s.y - car.y) > s.len + len) continue; // ざっくり遠いものを除く
      const n = Math.max(2, Math.ceil(s.len / 8));
      for (let k = 0; k <= n; k++) {
        const pt = poseAt(s, (s.len * k) / n);
        const dx = pt.x - car.x;
        const dy = pt.y - car.y;
        const along = dx * cos + dy * sin;
        const across = -dx * sin + dy * cos;
        if (Math.abs(along) < len / 2 + rr && Math.abs(across) < wid / 2 + rr) {
          out.push(q);
          break;
        }
      }
    }
    return out;
  }

  /** 点に最も近いレール上の位置(piece と始点からの距離 u) */
  nearestOnTrack(p: { x: number; y: number }, radius: number) {
    let best: { piece: Piece; u: number } | null = null;
    let bestD = radius;
    for (const piece of this.pieces) {
      const step = 6;
      for (let u = 0; u <= piece.seg.len + 0.01; u += step) {
        const q = poseAt(piece.seg, Math.min(u, piece.seg.len));
        const d = dist(q, p);
        if (d < bestD) {
          bestD = d;
          best = { piece, u: Math.min(u, piece.seg.len) };
        }
      }
    }
    return best;
  }
}
