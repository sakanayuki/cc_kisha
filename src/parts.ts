import {
  ARC_R,
  ARC_SWEEP,
  LINE_LEN,
  LONG_LEN,
  Pose,
  R90,
  SWEEP90,
  Seg,
  arcSeg,
  dist,
  endPose,
  lineSeg,
  mod2pi,
  poseAt,
} from './geometry';
import { End, OpenEnd, Piece, Track } from './track';

export type PartKind = 'line' | 'long' | 'gentle' | 'sharp';
export type Turn = 1 | -1; // 1: 右カーブ(外向きに進んだとき)

const CLOSE_POS = 3; // ループが閉じたとみなす位置の誤差(px)
const CLOSE_ANGLE = (8 * Math.PI) / 180;

/** pose から先へ向かう seg */
function forward(kind: PartKind, p: Pose, turn: Turn): Seg {
  switch (kind) {
    case 'line':
      return lineSeg(p, LINE_LEN);
    case 'long':
      return lineSeg(p, LONG_LEN);
    case 'gentle':
      return arcSeg(p, turn, ARC_SWEEP, ARC_R);
    case 'sharp':
      return arcSeg(p, turn, SWEEP90, R90);
  }
}

/** end で終わる seg(end の向きは進行方向)。始点は逆算する */
function backward(kind: PartKind, end: Pose, turn: Turn): Seg {
  const probe = forward(kind, { x: 0, y: 0, h: 0 }, turn);
  if (probe.s === 0) {
    return { ...probe, x: end.x - Math.cos(end.h) * probe.len, y: end.y - Math.sin(end.h) * probe.len, h: end.h };
  }
  const h0 = end.h - (probe.s * probe.len) / probe.r;
  const k = probe.r * probe.s;
  return {
    ...probe,
    x: end.x - k * (Math.sin(end.h) - Math.sin(h0)),
    y: end.y - k * (Math.cos(h0) - Math.cos(end.h)),
    h: h0,
  };
}

/** 最初の1個: 真上向きで、中心が (x,y) にくるように置く */
export function firstSeg(kind: PartKind, x: number, y: number, turn: Turn): Seg {
  const seg = forward(kind, { x: 0, y: 0, h: -Math.PI / 2 }, turn);
  const e = endPose(seg);
  return { ...seg, x: x - e.x / 2, y: y - e.y / 2 };
}

export interface Candidate {
  end: OpenEnd; // つなぐ先の端
  seg: Seg;
  far: { pose: Pose; end: End }; // 新しいパーツのもう一方の端(外向き)
  closes: OpenEnd | null; // ループを閉じる相手
}

/** 1本道のパーツ(置いた順) */
export class PartsLine {
  stack: Piece[] = [];

  constructor(private track: Track) {}

  get empty() {
    return this.stack.length === 0;
  }

  openEnds(): OpenEnd[] {
    const out: OpenEnd[] = [];
    for (const piece of this.stack) {
      const s = piece.seg;
      if (!piece.linkA) out.push({ piece, end: 'A', pose: { x: s.x, y: s.y, h: s.h + Math.PI } });
      if (!piece.linkB) out.push({ piece, end: 'B', pose: endPose(s) });
    }
    return out;
  }

  /** 開いている各端に、選択中のパーツを置いたときの形 */
  candidates(kind: PartKind, turn: Turn): Candidate[] {
    const ends = this.openEnds();
    return ends.map((end) => {
      let seg: Seg;
      let far: Candidate['far'];
      if (end.end === 'B') {
        // ツメが出ている端: そこから先へ伸ばす
        seg = forward(kind, end.pose, turn);
        far = { pose: endPose(seg), end: 'B' };
      } else {
        // くぼみの端: 新しいパーツのツメをはめるので、向きを逆にして終点を合わせる。
        // 外向きに「右」へ曲がるパーツは、逆から辿ると左カーブになる
        seg = backward(kind, { x: end.pose.x, y: end.pose.y, h: end.pose.h + Math.PI }, (-turn) as Turn);
        far = { pose: { x: seg.x, y: seg.y, h: seg.h + Math.PI }, end: 'A' };
      }
      const closes =
        ends.find(
          (o) =>
            o !== end &&
            dist(o.pose, far.pose) <= CLOSE_POS &&
            Math.abs(mod2pi(o.pose.h - far.pose.h) - Math.PI) <= CLOSE_ANGLE,
        ) ?? null;
      return { end, seg, far, closes };
    });
  }

  /** (x,y) に最も近い候補(半径 radius 以内)。ゴースト全体のどこをタップしても反応する */
  pick(cands: Candidate[], x: number, y: number, radius: number): Candidate | null {
    let best: Candidate | null = null;
    let bestD = radius;
    for (const c of cands) {
      const n = 6;
      for (let k = 0; k <= n; k++) {
        const d = dist(poseAt(c.seg, (c.seg.len * k) / n), { x, y });
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  /** 最初の1個を置く */
  placeFirst(seg: Seg): Piece {
    const piece = this.track.add(seg);
    piece.manual = true;
    this.stack.push(piece);
    return piece;
  }

  /** 候補を置いて、つなぐ。ループが閉じるならその端ともつなぐ */
  placeAt(c: Candidate): Piece {
    const piece = this.track.add(c.seg);
    piece.manual = true;
    this.stack.push(piece);
    this.track.connect(c.end.piece, c.end.end, piece, c.end.end === 'B' ? 'A' : 'B');
    if (c.closes) this.track.connect(piece, c.far.end, c.closes.piece, c.closes.end);
    return piece;
  }

  /** 最後に置いたパーツを外す */
  undo(): Piece | null {
    const piece = this.stack.pop();
    if (!piece) return null;
    this.track.remove(piece);
    return piece;
  }

  clear() {
    this.stack = [];
  }
}
