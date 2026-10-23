import locoUrl from './assets/loco.png';
import blueUrl from './assets/car_blue.png';
import greenUrl from './assets/car_green.png';
import redUrl from './assets/car_red.png';
import railUrl from './assets/rail_short.png';
import curveUrl from './assets/rail_curve.png';
import {
  ARC_R,
  ARC_SWEEP,
  LINE_LEN,
  R90,
  RAIL_W,
  SCALE,
  SCALE90,
  SWEEP90,
  Seg,
  poseAt,
} from './geometry';
import { Deco, Piece } from './track';
import { HOUSE_COUNT, TREE_COUNT } from './scenery';

const treeUrls = Object.values(
  import.meta.glob('./assets/tree*.png', { eager: true, query: '?url', import: 'default' }),
) as string[];
const houseUrls = Object.values(
  import.meta.glob('./assets/house*.png', { eager: true, query: '?url', import: 'default' }),
) as string[];
import curve90Url from './assets/rail_curve90.png';

export interface Assets {
  rail: HTMLImageElement;
  curve: HTMLImageElement;
  curve90: HTMLImageElement;
  trees: HTMLImageElement[];
  houses: HTMLImageElement[];
  cars: HTMLImageElement[]; // 先頭から 機関車/青/貨車/赤
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

export async function loadAssets(): Promise<Assets> {
  const all = (urls: string[]) => Promise.all(urls.map(load));
  const [[rail, curve, curve90], cars, trees, houses] = await Promise.all([
    all([railUrl, curveUrl, curve90Url]),
    all([locoUrl, blueUrl, greenUrl, redUrl]),
    all(treeUrls.slice(0, TREE_COUNT)),
    all(houseUrls.slice(0, HOUSE_COUNT)),
  ]);
  return { rail, curve, curve90, trees, houses, cars };
}

// 直線スプライト(75x209)の構造: 上のツメ 0-30 / 本体 30-209(うち下39がくぼみ)
const TAB_H = 30;
const SOCKET_H = 39;
const SPRITE_W = 75;
const SPRITE_H = 209;
const MID_FROM = 40;
const MID_TO = 160;

// カーブスプライトの中心線は中心(415,173)・半径379の円弧で、端は角度 -11° と +19°
const CURVE_C = { x: 415, y: 173 };
const CURVE_A0 = (-11 * Math.PI) / 180;

function drawTab(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  const e = poseAt(seg, seg.len);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.h + Math.PI / 2);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(a.rail, 0, 0, SPRITE_W, TAB_H, -SPRITE_W / 2, -TAB_H, SPRITE_W, TAB_H);
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  const lu = seg.len / SCALE;
  ctx.save();
  ctx.translate(seg.x, seg.y);
  ctx.rotate(seg.h + Math.PI / 2);
  ctx.scale(SCALE, SCALE);
  if (Math.abs(seg.len - LINE_LEN) < 0.6) {
    ctx.drawImage(a.rail, -SPRITE_W / 2, -SPRITE_H);
  } else if (lu > SOCKET_H + 4) {
    // ツメとくぼみはそのまま、真ん中だけ伸縮させる
    ctx.drawImage(a.rail, 0, 0, SPRITE_W, TAB_H, -SPRITE_W / 2, -lu - TAB_H, SPRITE_W, TAB_H);
    ctx.drawImage(a.rail, 0, TAB_H, SPRITE_W, 170 - TAB_H, -SPRITE_W / 2, -lu, SPRITE_W, lu - SOCKET_H);
    ctx.drawImage(a.rail, 0, 170, SPRITE_W, SOCKET_H, -SPRITE_W / 2, -SOCKET_H, SPRITE_W, SOCKET_H);
  } else {
    ctx.drawImage(a.rail, 0, 0, SPRITE_W, TAB_H, -SPRITE_W / 2, -lu - TAB_H, SPRITE_W, TAB_H);
    ctx.drawImage(a.rail, 0, TAB_H, SPRITE_W, SPRITE_H - TAB_H, -SPRITE_W / 2, -lu, SPRITE_W, lu);
  }
  ctx.restore();
}

function drawStandardArc(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  const px = CURVE_C.x - 379 * Math.cos(CURVE_A0);
  const py = CURVE_C.y - 379 * Math.sin(CURVE_A0);
  ctx.save();
  ctx.translate(seg.x, seg.y);
  if (seg.s === 1) {
    ctx.rotate(seg.h + Math.PI / 2 - CURVE_A0);
    ctx.scale(SCALE, SCALE);
  } else {
    ctx.rotate(seg.h + Math.PI / 2 + CURVE_A0);
    ctx.scale(-SCALE, SCALE);
  }
  ctx.drawImage(a.curve, -px, -py);
  ctx.restore();
}

/** 任意の角度のカーブは、直線パーツの木目を円弧に沿って曲げて描く */
function drawBentArc(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  const step = 2; // 画面px
  const du = step / SCALE;
  for (let u = 0; u < seg.len; u += step) {
    const p = poseAt(seg, u);
    const uu = u / SCALE;
    const sy =
      uu < SOCKET_H
        ? SPRITE_H - uu - du
        : MID_TO - ((uu - SOCKET_H) % (MID_TO - MID_FROM)) - du;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.h + Math.PI / 2);
    ctx.drawImage(a.rail, 0, sy, SPRITE_W, du, -RAIL_W / 2, -step - 0.8, RAIL_W, step + 0.8);
    ctx.restore();
  }
  drawTab(ctx, a, seg);
}

// 90度カーブスプライトの中心線は中心(274,276)・半径224の円弧で、始点は左端
const C90 = { x: 274, y: 276, r: 224 };

function drawArc90(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  ctx.save();
  ctx.translate(seg.x, seg.y);
  ctx.rotate(seg.h + Math.PI / 2);
  ctx.scale(seg.s === 1 ? SCALE90 : -SCALE90, SCALE90);
  ctx.drawImage(a.curve90, -(C90.x - C90.r), -C90.y);
  ctx.restore();
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

function drawSeg(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  if (seg.s === 0) {
    drawLine(ctx, a, seg);
    drawTab(ctx, a, seg);
  } else if (near(seg.r, R90) && near(seg.len, R90 * SWEEP90)) drawArc90(ctx, a, seg);
  else if (near(seg.r, ARC_R) && near(seg.len, ARC_R * ARC_SWEEP)) drawStandardArc(ctx, a, seg);
  else drawBentArc(ctx, a, seg);
}

const CACHE_K = 2;

/** 木目を曲げて描く任意角度のカーブは重いので、一度だけ画像にしておく */
export function drawPiece(ctx: CanvasRenderingContext2D, a: Assets, piece: Piece) {
  const seg = piece.seg;
  const standard =
    seg.s === 0 ||
    (near(seg.r, R90) && near(seg.len, R90 * SWEEP90)) ||
    (near(seg.r, ARC_R) && near(seg.len, ARC_R * ARC_SWEEP));
  if (standard) return drawSeg(ctx, a, seg);
  if (!piece.cache) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let u = 0; u <= seg.len + 4; u += 6) {
      const p = poseAt(seg, Math.min(u, seg.len));
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const m = RAIL_W / 2 + 24;
    x0 -= m;
    y0 -= m;
    const w = x1 + m - x0;
    const h = y1 + m - y0;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * CACHE_K);
    canvas.height = Math.ceil(h * CACHE_K);
    const c = canvas.getContext('2d')!;
    c.scale(CACHE_K, CACHE_K);
    c.translate(-x0, -y0);
    drawSeg(c, a, seg);
    piece.cache = { canvas, x: x0, y: y0, w, h };
  }
  const k = piece.cache;
  ctx.drawImage(k.canvas, k.x, k.y, k.w, k.h);
}

export function drawDeco(ctx: CanvasRenderingContext2D, a: Assets, d: Deco) {
  const img = (d.kind === 'tree' ? a.trees : a.houses)[d.idx];
  const w = d.size;
  const h = (d.size * img.height) / img.width;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

const CAR_SCALE = SCALE * 0.733;
export const CAR_SPACING = 226 * CAR_SCALE + 4;

/** 車両を描く。スプライトの下側が進行方向(機関車の煙突側) */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  h: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.translate(x, y);
  ctx.rotate(h - Math.PI / 2);
  const w = img.width * CAR_SCALE;
  const hh = img.height * CAR_SCALE;
  ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
  ctx.restore();
}
