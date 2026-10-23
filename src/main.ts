import './style.css';
import { RailDrawer } from './drawer';
import { drawCar, drawDeco, drawPiece, loadAssets, Assets } from './render';
import { poseAt } from './geometry';
import { spawnDeco } from './scenery';
import { Piece, Track } from './track';
import { Train } from './train';

const HOLD_MS = 900;
type Mode = 'rail' | 'go';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

// 置いたレールと飾りは動かないので、画面と同じ大きさの画像に描きためておく。
// 毎フレームはその画像と列車だけを描く(レールが増えても重くならない)
const layer = document.createElement('canvas');
const lctx = layer.getContext('2d')!;
let layerZoom = 1; // layer を描いたときの拡大率
let dirty = true; // 画面を描き直す必要があるか
const hint = document.getElementById('hint')!;
const btnRail = document.getElementById('btn-rail')!;
const btnGo = document.getElementById('btn-go')!;
const btnTrash = document.getElementById('btn-trash')!;
const ring = btnTrash.querySelector('.ring') as SVGElement;

const track = new Track();
let assets: Assets;
let mode: Mode = 'rail';
let train: Train | null = null;
let dpr = 1;
let vw = 0;
let vh = 0;

// 画面の拡大率。レールが画面端(10%)に迫ると、画面中心を軸にゆっくり縮小する
const EDGE = 0.1;
const MIN_ZOOM = 0.2;
let zoom = 1;
let targetZoom = 1;
let reach = { x: 0, y: 0 }; // 画面中心から最も遠いレールまでの距離(縦横別)
const toWorld = (sx: number, sy: number) => ({
  x: (sx - (vw / 2) * (1 - zoom)) / zoom,
  y: (sy - (vh / 2) * (1 - zoom)) / zoom,
});

function growView(piece: Piece) {
  const seg = piece.seg;
  for (let k = 0; k <= 4; k++) {
    const p = poseAt(seg, (seg.len * k) / 4);
    reach.x = Math.max(reach.x, Math.abs(p.x - vw / 2));
    reach.y = Math.max(reach.y, Math.abs(p.y - vh / 2));
  }
  const need = Math.min(
    reach.x > 0 ? ((0.5 - EDGE) * vw) / reach.x : Infinity,
    reach.y > 0 ? ((0.5 - EDGE) * vh) / reach.y : Infinity,
  );
  // 端に届いたら、少し余裕を持たせて一気に広げる(何度も細かく縮まないように)
  if (need < targetZoom) targetZoom = Math.max(MIN_ZOOM, need * 0.8);
}

const HINTS: Record<Mode, string> = {
  rail: '画面をなぞってレールを敷こう',
  go: 'レールをタップすると列車が走り出すよ',
};

function setMode(m: Mode) {
  mode = m;
  btnRail.classList.toggle('active', m === 'rail');
  btnGo.classList.toggle('active', m === 'go');
  if (m === 'rail') train = null;
  dirty = true;
  hint.textContent = HINTS[m];
  hint.style.opacity = '1';
  window.setTimeout(() => {
    if (mode === m) hint.style.opacity = '0';
  }, 3500);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = window.innerWidth;
  vh = window.innerHeight;
  for (const c of [canvas, layer]) {
    c.width = Math.round(vw * dpr);
    c.height = Math.round(vh * dpr);
  }
  renderLayer();
}

/** layerZoom の倍率で、すべてのレールと飾りを layer に描き直す */
function renderLayer() {
  layerZoom = zoom;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, layer.width, layer.height);
  applyView(lctx, layerZoom);
  for (const p of track.pieces) for (const d of p.deco) drawDeco(lctx, assets, d);
  for (const p of track.pieces) drawPiece(lctx, assets, p);
  dirty = true;
}

function applyView(c: CanvasRenderingContext2D, z: number) {
  const k = dpr * z;
  c.setTransform(k, 0, 0, k, (dpr * vw * (1 - z)) / 2, (dpr * vh * (1 - z)) / 2);
}

function addToLayer(piece: Piece) {
  applyView(lctx, layerZoom);
  for (const d of piece.deco) drawDeco(lctx, assets, d);
  drawPiece(lctx, assets, piece);
  dirty = true;
}

let rail: RailDrawer;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'rail') {
    const w = toWorld(e.clientX, e.clientY);
    rail.down(w.x, w.y);
  } else {
    const hit = track.nearestOnTrack(toWorld(e.clientX, e.clientY), 40 / zoom);
    if (hit) train = new Train(track, hit.piece, hit.u, assets.cars.length);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'rail' || !canvas.hasPointerCapture(e.pointerId)) return;
  // 速く動かしたときに点が飛ばないよう、取りこぼした分も順に処理する
  const events = e.getCoalescedEvents?.() ?? [];
  for (const ev of events.length ? events : [e]) {
    const w = toWorld(ev.clientX, ev.clientY);
    rail.move(w.x, w.y);
  }
});
const end = () => rail.up();
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

btnRail.addEventListener('click', () => setMode('rail'));
btnGo.addEventListener('click', () => setMode('go'));

// ゴミ箱は長押しで全消去
let holdTimer = 0;
let holdStart = 0;
const setRing = (p: number) => {
  ring.style.strokeDashoffset = String(182 * (1 - p));
};
function holdTick() {
  const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  setRing(p);
  if (p >= 1) {
    clearAll();
    cancelHold();
    return;
  }
  holdTimer = requestAnimationFrame(holdTick);
}
function cancelHold() {
  cancelAnimationFrame(holdTimer);
  holdTimer = 0;
  setRing(0);
}
function clearAll() {
  track.clear();
  train = null;
  reach = { x: 0, y: 0 };
  targetZoom = 1; // 拡大率も最初に戻す
  renderLayer();
  hint.textContent = 'レールを全部消したよ';
  hint.style.opacity = '1';
  window.setTimeout(() => (hint.style.opacity = '0'), 1800);
}
btnTrash.addEventListener('pointerdown', (e) => {
  btnTrash.setPointerCapture(e.pointerId);
  holdStart = performance.now();
  holdTimer = requestAnimationFrame(holdTick);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  btnTrash.addEventListener(ev, () => holdTimer && cancelHold());
}
btnTrash.addEventListener('contextmenu', (e) => e.preventDefault());

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);

  const zooming = zoom !== targetZoom;
  if (zooming) {
    zoom += (targetZoom - zoom) * (1 - Math.exp(-dt * 4));
    if (Math.abs(targetZoom - zoom) < 0.002 * targetZoom) zoom = targetZoom;
    dirty = true;
  } else if (layerZoom !== zoom) {
    renderLayer(); // 拡大率が落ち着いたら、その倍率で描き直して画質を戻す
  }
  if (train) train.update(dt);
  if (!dirty && !train) return;
  dirty = false;

  // 縮小の途中は、描きためた画像を拡大縮小して使う
  const r = zoom / layerZoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(r, 0, 0, r, (canvas.width / 2) * (1 - r), (canvas.height / 2) * (1 - r));
  ctx.drawImage(layer, 0, 0);
  if (train) {
    applyView(ctx, zoom);
    for (const c of train.carsToDraw()) drawCar(ctx, assets.cars[c.idx], c.x, c.y, c.h, c.alpha);
    if (train.finished) {
      train = null;
      dirty = true;
    }
  }
}

loadAssets().then((a) => {
  assets = a;
  rail = new RailDrawer(
    track,
    (piece) => {
      spawnDeco(track, piece);
      growView(piece);
      addToLayer(piece);
    },
    () => {
      track.reindex();
      renderLayer();
    },
    () => zoom,
  );
  resize();
  window.addEventListener('resize', resize);
  setMode('rail');
  requestAnimationFrame(frame);
});
