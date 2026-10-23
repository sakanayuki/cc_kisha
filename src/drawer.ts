import {
  LINE_LEN,
  Dubins,
  Pose,
  Seg,
  arcSeg,
  dist,
  dubins,
  dubinsToSegs,
  endPose,
  lineSeg,
} from './geometry';
import { End, OpenEnd, Piece, Track } from './track';

const SNAP_START = 44; // この距離内で線を引き始めると、既存レールの端から続ける
const SNAP_JOIN = 48; // 引いている先がこの距離内に端があると、そこへ繋ぐ
const MAX_JOIN_LEN = 460;
const MAX_REWIND = 8;

/** なぞった線に沿ってレールパーツを並べる */
export class RailDrawer {
  private cursor: Pose | null = null; // 次のパーツを置く位置と向き
  private from: { piece: Piece; end: End } | null = null; // cursor が接している既存パーツ
  private origin: { x: number; y: number } | null = null; // 空きスペースから引き始めた点
  private done = false;
  // 今回のなぞりで置いたパーツと、置く直前の状態(繋ぎ直しで巻き戻すために持つ)
  private stroke: { piece: Piece; from: RailDrawer['from']; cursor: Pose }[] = [];

  constructor(
    private track: Track,
    private onAdd: (seg: Seg) => void,
    private onRemove: () => void,
  ) {}

  down(x: number, y: number) {
    this.done = false;
    this.stroke = [];
    this.cursor = null;
    this.from = null;
    this.origin = null;
    const e = this.track.nearestOpenEnd({ x, y }, SNAP_START);
    if (e) {
      this.cursor = e.pose;
      this.from = { piece: e.piece, end: e.end };
    } else {
      this.origin = { x, y };
    }
  }

  move(x: number, y: number) {
    if (this.done) return;
    const p = { x, y };
    if (!this.cursor) {
      if (this.origin && dist(this.origin, p) >= LINE_LEN * 0.6) {
        this.cursor = {
          x: this.origin.x,
          y: this.origin.y,
          h: Math.atan2(y - this.origin.y, x - this.origin.x),
        };
      } else return;
    }
    if (this.tryJoin(p)) return;
    for (let i = 0; i < 40; i++) if (!this.stepOnce(p)) break;
  }

  up() {
    this.done = true;
    this.cursor = null;
  }

  private place(seg: Seg): Piece {
    const piece = this.track.add(seg);
    this.onAdd(seg);
    this.stroke.push({ piece, from: this.from, cursor: this.cursor! });
    if (this.from) this.track.connect(this.from.piece, this.from.end, piece, 'A');
    this.from = { piece, end: 'B' };
    this.cursor = endPose(seg);
    return piece;
  }

  private stepOnce(p: { x: number; y: number }): boolean {
    const c = this.cursor!;
    const d0 = dist(c, p);
    if (d0 < LINE_LEN * 0.7) return false;
    const cands: { seg: Seg; cost: number }[] = [
      { seg: lineSeg(c), cost: 0 },
      { seg: arcSeg(c, 1), cost: 5 },
      { seg: arcSeg(c, -1), cost: 5 },
    ].map((k) => ({ seg: k.seg, cost: dist(endPose(k.seg), p) + k.cost }));
    cands.sort((a, b) => a.cost - b.cost);
    const best = cands[0];
    // 背後へ引いたときや、ほとんど近づかないときは置かない
    if (d0 - dist(endPose(best.seg), p) < LINE_LEN * 0.4) return false;
    this.place(best.seg);
    return true;
  }

  /** 直近 n 個のパーツを取り消して、置く前の状態に戻す */
  private rewind(n: number) {
    if (n === 0) return;
    const removed = this.stroke.splice(this.stroke.length - n, n);
    for (const r of removed) {
      const link = r.piece.linkA;
      if (link) {
        if (link.end === 'A') link.piece.linkA = null;
        else link.piece.linkB = null;
      }
      this.track.pieces.splice(this.track.pieces.indexOf(r.piece), 1);
    }
    this.from = removed[0].from;
    this.cursor = removed[0].cursor;
    this.onRemove();
  }

  /** 引いている先が既存レールの端に近ければ、隙間なく繋ぐ */
  private tryJoin(p: { x: number; y: number }): boolean {
    const recent = this.stroke.slice(-3).map((s) => s.piece);
    const first = this.stroke.length < 6 && this.stroke.length > 0 ? this.stroke[0].piece : null;
    const skip = (e: OpenEnd) =>
      (this.from !== null && e.piece === this.from.piece) ||
      (first !== null && e.piece === first) ||
      recent.includes(e.piece);
    const e = this.track.nearestOpenEnd(p, SNAP_JOIN, skip);
    if (!e) return false;
    const target: Pose = { x: e.pose.x, y: e.pose.y, h: e.pose.h + Math.PI };

    // 今の位置から繋げなければ、直近のパーツを外した位置からも試す
    let best: { n: number; d: Dubins; from: Pose; cost: number } | null = null;
    let removedLen = 0;
    for (let n = 0; n <= Math.min(MAX_REWIND, this.stroke.length); n++) {
      if (n > 0) removedLen += this.stroke[this.stroke.length - n].piece.seg.len;
      const from = n === 0 ? this.cursor! : this.stroke[this.stroke.length - n].cursor;
      const d = dubins(from, target);
      if (!d || d.total > MAX_JOIN_LEN || d.d1 + d.d2 > Math.PI * 1.3) continue;
      const cost = d.total - removedLen; // 既存の線に対して増える長さ
      if (!best || cost < best.cost - 1) best = { n, d, from, cost };
    }
    if (!best) return false;

    this.rewind(best.n);
    let last = this.from;
    for (const seg of dubinsToSegs(best.from, best.d)) last = { piece: this.place(seg), end: 'B' };
    if (last) this.track.connect(last.piece, last.end, e.piece, e.end);
    this.done = true;
    this.cursor = null;
    return true;
  }
}
