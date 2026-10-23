import { Pose, Seg, dist, endPose, poseAt } from './geometry';

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
  cache?: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
  linkA: Link | null; // 始点側の接続先
  linkB: Link | null; // 終点側の接続先
}

export interface OpenEnd {
  piece: Piece;
  end: End;
  pose: Pose; // 位置と「レールの外向き」の向き
}

export class Track {
  pieces: Piece[] = [];

  add(seg: Seg): Piece {
    const piece: Piece = { seg, deco: [], linkA: null, linkB: null };
    this.pieces.push(piece);
    return piece;
  }

  clear() {
    this.pieces = [];
  }

  connect(a: Piece, ea: End, b: Piece, eb: End) {
    const link = (p: Piece, e: End, to: Link) => {
      if (e === 'A') p.linkA = to;
      else p.linkB = to;
    };
    link(a, ea, { piece: b, end: eb });
    link(b, eb, { piece: a, end: ea });
  }

  openEnds(): OpenEnd[] {
    const out: OpenEnd[] = [];
    for (const piece of this.pieces) {
      if (!piece.linkA) {
        const s = piece.seg;
        out.push({ piece, end: 'A', pose: { x: s.x, y: s.y, h: s.h + Math.PI } });
      }
      if (!piece.linkB) out.push({ piece, end: 'B', pose: endPose(piece.seg) });
    }
    return out;
  }

  nearestOpenEnd(p: { x: number; y: number }, radius: number, exclude?: (e: OpenEnd) => boolean) {
    let best: OpenEnd | null = null;
    let bestD = radius;
    for (const e of this.openEnds()) {
      if (exclude && exclude(e)) continue;
      const d = dist(e.pose, p);
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
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
