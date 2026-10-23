import './style.css';
import { RailDrawer } from './drawer';
import { drawCar, drawPiece, loadAssets, Assets } from './render';
import { Track } from './track';
import { Train } from './train';

const HOLD_MS = 900;
type Mode = 'rail' | 'go';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hint = document.getElementById('hint')!;
const btnRail = document.getElementById('btn-rail')!;
const btnGo = document.getElementById('btn-go')!;
const btnTrash = document.getElementById('btn-trash')!;
const ring = btnTrash.querySelector('.ring') as SVGElement;

const track = new Track();
const layer = document.createElement('canvas'); // 置いたレールを描きためておく
const lctx = layer.getContext('2d')!;
let assets: Assets;
let mode: Mode = 'rail';
let train: Train | null = null;
let dpr = 1;

const HINTS: Record<Mode, string> = {
  rail: '画面をなぞってレールを敷こう',
  go: 'レールをタップすると列車が走り出すよ',
};

function setMode(m: Mode) {
  mode = m;
  btnRail.classList.toggle('active', m === 'rail');
  btnGo.classList.toggle('active', m === 'go');
  if (m === 'rail') train = null;
  hint.textContent = HINTS[m];
  hint.style.opacity = '1';
  window.setTimeout(() => {
    if (mode === m) hint.style.opacity = '0';
  }, 3500);
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const c of [canvas, layer]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  redrawLayer();
}

function redrawLayer() {
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, layer.width, layer.height);
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of track.pieces) drawPiece(lctx, assets, p.seg);
}

let rail: RailDrawer;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'rail') {
    rail.down(e.clientX, e.clientY);
  } else {
    const hit = track.nearestOnTrack({ x: e.clientX, y: e.clientY }, 40);
    if (hit) train = new Train(track, hit.piece, hit.u, assets.cars.length);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'rail' || !canvas.hasPointerCapture(e.pointerId)) return;
  // 速く動かしたときに点が飛ばないよう、取りこぼした分も順に処理する
  const events = e.getCoalescedEvents?.() ?? [];
  if (events.length) for (const ev of events) rail.move(ev.clientX, ev.clientY);
  else rail.move(e.clientX, e.clientY);
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
  lctx.clearRect(0, 0, layer.width, layer.height);
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(layer, 0, 0);
  if (train) {
    train.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of train.carsToDraw()) drawCar(ctx, assets.cars[c.idx], c.x, c.y, c.h, c.alpha);
    if (train.finished) train = null;
  }
  requestAnimationFrame(frame);
}

loadAssets().then((a) => {
  assets = a;
  rail = new RailDrawer(track, (seg) => drawPiece(lctx, assets, seg), redrawLayer);
  resize();
  window.addEventListener('resize', resize);
  setMode('rail');
  requestAnimationFrame(frame);
});
