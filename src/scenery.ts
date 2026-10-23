import { RAIL_W, dist, poseAt } from './geometry';
import { Deco, Piece, Track } from './track';

export const TREE_COUNT = 6;
export const HOUSE_COUNT = 5;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** レールを置いたとき、その脇に木か家を建てる(空きがあれば) */
export function spawnDeco(track: Track, piece: Piece) {
  if (Math.random() > 0.75) return;
  const seg = piece.seg;
  for (let i = 0; i < 8; i++) {
    const u = rnd(0.15, 0.85) * seg.len;
    const p = poseAt(seg, u);
    const side = Math.random() < 0.5 ? -1 : 1;
    const isHouse = Math.random() < 0.3;
    const size = isHouse ? rnd(34, 50) : rnd(30, 50);
    const off = RAIL_W / 2 + size / 2 + rnd(6, 40);
    const x = p.x - Math.sin(p.h) * off * side;
    const y = p.y + Math.cos(p.h) * off * side;
    if (clear(track, x, y, size / 2)) {
      const d: Deco = {
        kind: isHouse ? 'house' : 'tree',
        idx: Math.floor(Math.random() * (isHouse ? HOUSE_COUNT : TREE_COUNT)),
        x,
        y,
        rot: isHouse ? p.h + (Math.random() < 0.5 ? 0 : Math.PI) : rnd(0, Math.PI * 2),
        size,
      };
      piece.deco.push(d);
      return;
    }
  }
}

/** レールや他の飾りと重ならないか */
function clear(track: Track, x: number, y: number, r: number) {
  for (const q of track.pieces) {
    for (const d of q.deco) if (dist(d, { x, y }) < r + d.size / 2 + 2) return false;
    const n = Math.max(2, Math.ceil(q.seg.len / 10));
    for (let k = 0; k <= n; k++) {
      if (dist(poseAt(q.seg, (q.seg.len * k) / n), { x, y }) < r + RAIL_W / 2 + 3) return false;
    }
  }
  return true;
}
