export interface Pose {
  x: number;
  y: number;
  h: number; // 進行方向(rad)。h が増える向きを「右カーブ」とする(画面はy下向き)
}

// スプライト(写真から切り出したPNG)を画面に描くときの倍率と、そこから決まる寸法
export const SCALE = 0.38;
export const RAIL_W = 75 * SCALE;
export const LINE_LEN = 179 * SCALE; // 直線パーツ本体の長さ(ツメを除く)
export const LONG_LEN = (504 * RAIL_W) / 77; // 長い直線パーツ(幅77pxの写真から切り出し)の本体の長さ
export const ARC_R = 379 * SCALE; // カーブパーツの中心線の半径
export const ARC_SWEEP = (30 * Math.PI) / 180;
// 90度カーブは幅97pxの写真から切り出したもの。中心線の半径は224px
export const SCALE90 = RAIL_W / 97;
export const R90 = 224 * SCALE90;
export const SWEEP90 = Math.PI / 2;

/** レール1本分の形状。s=0 は直線、s=±1 は円弧(+1 が右カーブ)。 */
export interface Seg extends Pose {
  s: -1 | 0 | 1;
  len: number; // 弧長
  r: number; // 円弧の半径(直線では 0)
}

const TWO_PI = Math.PI * 2;
export const mod2pi = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

export function poseAt(seg: Seg, u: number): Pose {
  if (seg.s === 0) {
    return { x: seg.x + Math.cos(seg.h) * u, y: seg.y + Math.sin(seg.h) * u, h: seg.h };
  }
  const h2 = seg.h + (seg.s * u) / seg.r;
  const k = seg.r * seg.s;
  return {
    x: seg.x + k * (Math.sin(h2) - Math.sin(seg.h)),
    y: seg.y + k * (Math.cos(seg.h) - Math.cos(h2)),
    h: h2,
  };
}

export const endPose = (seg: Seg): Pose => poseAt(seg, seg.len);

export const lineSeg = (p: Pose, len = LINE_LEN): Seg => ({ x: p.x, y: p.y, h: p.h, s: 0, len, r: 0 });
export const arcSeg = (p: Pose, s: 1 | -1, sweep = ARC_SWEEP, r = ARC_R): Seg => ({
  x: p.x,
  y: p.y,
  h: p.h,
  s,
  len: r * sweep,
  r,
});

const normal = (h: number): [number, number] => [-Math.sin(h), Math.cos(h)];

export interface Dubins {
  s1: 1 | -1;
  d1: number; // 1つ目の円弧の角度
  line: number;
  s2: 1 | -1;
  d2: number;
  total: number;
}

/**
 * start から target(の姿勢)まで「円弧→直線→円弧」で繋ぐ最短経路(Dubins CSC)。
 * レールの端同士を隙間なく繋ぐのに使う。
 */
export function dubins(start: Pose, target: Pose): Dubins | null {
  let best: Dubins | null = null;
  for (const s1 of [1, -1] as const) {
    for (const s2 of [1, -1] as const) {
      const n0 = normal(start.h);
      const n1 = normal(target.h);
      const c1x = start.x + ARC_R * s1 * n0[0];
      const c1y = start.y + ARC_R * s1 * n0[1];
      const c2x = target.x + ARC_R * s2 * n1[0];
      const c2y = target.y + ARC_R * s2 * n1[1];
      const dx = c2x - c1x;
      const dy = c2y - c1y;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      let phis: number[];
      if (s1 === s2) {
        phis = [ang];
      } else {
        if (d < 2 * ARC_R) continue;
        const a = Math.asin((2 * ARC_R * s1) / d);
        phis = [ang + a, ang + Math.PI - a];
      }
      for (const phi of phis) {
        const n = normal(phi);
        const px = c1x - ARC_R * s1 * n[0];
        const py = c1y - ARC_R * s1 * n[1];
        const qx = c2x - ARC_R * s2 * n[0];
        const qy = c2y - ARC_R * s2 * n[1];
        const vx = qx - px;
        const vy = qy - py;
        const perp = vx * n[0] + vy * n[1];
        const line = vx * Math.cos(phi) + vy * Math.sin(phi);
        if (Math.abs(perp) > 0.5 || line < -0.5) continue;
        let d1 = mod2pi(s1 * (phi - start.h));
        let d2 = mod2pi(s2 * (target.h - phi));
        if (d1 > TWO_PI - 1e-3) d1 = 0;
        if (d2 > TWO_PI - 1e-3) d2 = 0;
        if (d1 > Math.PI || d2 > Math.PI) continue;
        const l = Math.max(line, 0);
        const total = ARC_R * (d1 + d2) + l;
        if (!best || total < best.total) best = { s1, d1, line: l, s2, d2, total };
      }
    }
  }
  return best;
}

/** Dubins 経路を Seg の列に展開する(ごく短い部分は省く) */
export function dubinsToSegs(start: Pose, d: Dubins): Seg[] {
  const out: Seg[] = [];
  let p = start;
  const push = (seg: Seg) => {
    out.push(seg);
    p = endPose(seg);
  };
  if (d.d1 > 0.02) push(arcSeg(p, d.s1, d.d1));
  if (d.line > 1) push(lineSeg(p, d.line));
  if (d.d2 > 0.02) push(arcSeg(p, d.s2, d.d2));
  return out;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
