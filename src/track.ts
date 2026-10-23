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

const CELL = 64; // 空間グリッドのマス。飾り・レールの円は半径30以下なので隣接マスだけ見ればよい

export class Track {
  pieces: Piece[] = [];
  private grid = new Map<number, Circle[]>(); // 飾りを置く空きの判定を速くするための索引

  add(seg: Seg): Piece {
    const piece: Piece = { seg, deco: [], linkA: null, linkB: null };
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
