import locoUrl from './assets/loco.png';
import blueUrl from './assets/car_blue.png';
import greenUrl from './assets/car_green.png';
import redUrl from './assets/car_red.png';
import railUrl from './assets/rail_short.png';
import curveUrl from './assets/rail_curve.png';
import { ARC_R, ARC_SWEEP, LINE_LEN, RAIL_W, SCALE, Seg, poseAt } from './geometry';

export interface Assets {
  rail: HTMLImageElement;
  curve: HTMLImageElement;
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
  const [rail, curve, ...cars] = await Promise.all(
    [railUrl, curveUrl, locoUrl, blueUrl, greenUrl, redUrl].map(load),
  );
  return { rail, curve, cars };
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

export function drawPiece(ctx: CanvasRenderingContext2D, a: Assets, seg: Seg) {
  if (seg.s === 0) {
    drawLine(ctx, a, seg);
    drawTab(ctx, a, seg);
    return;
  }
  if (Math.abs(seg.len - ARC_R * ARC_SWEEP) < 0.5) drawStandardArc(ctx, a, seg);
  else drawBentArc(ctx, a, seg);
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
