import './style.css';
import { RailDrawer } from './drawer';
import { CAR_BODY_LEN, CAR_BODY_W, drawCar, drawDeco, drawPiece, loadAssets, Assets } from './render';
import { poseAt } from './geometry';
import { spawnDeco } from './scenery';
import { PartKind, PartsLine, Turn, firstSeg } from './parts';
import { Piece, Track } from './track';
import { Train } from './train';

const HOLD_MS = 900;
type Mode = 'rail' | 'parts' | 'go';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

// 置いたレールと飾りは動かないので、画面と同じ大きさの画像に描きためておく。
// 毎フレームはその画像と列車だけを描く(レールが増えても重くならない)
const layer = document.createElement('canvas');
const lctx = layer.getContext('2d')!;
let layerZoom = 1; // layer を描いたときの拡大率
let dirty = true; // 画面を描き直す必要があるか
// 拡大率が変わっている最中に敷いたレール。layer は古い画面範囲の大きさしかなく、
// 範囲の外に敷いた分が欠けるので、倍率が落ち着いて描き直すまでは毎フレーム直接描く
let pending: Piece[] = [];
const hint = document.getElementById('hint')!;
const btnRail = document.getElementById('btn-rail')!;
const btnGo = document.getElementById('btn-go')!;
const btnParts = document.getElementById('btn-parts')!;
const palette = document.getElementById('palette')!;
const btnUndo = document.getElementById('btn-undo')!;
const btnTrash = document.getElementById('btn-trash')!;
const ring = btnTrash.querySelector('.ring') as SVGElement;

const track = new Track();
const line = new PartsLine(track); // パーツモードで置いた1本道
let part: PartKind = 'line';
const turns: Record<'gentle' | 'sharp', Turn> = { gentle: 1, sharp: 1 }; // カーブの左右(1: 右)
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
let overviewZoom = 1; // レールが増えるにつれて縮小していった、全体を見渡す倍率
let reach = { x: 0, y: 0 }; // 画面中心から最も遠いレールまでの距離(縦横別)
// 列車が走っている間は、初期の倍率(1)に戻して列車を画面中央で追いかける。
// off は「画面中心がいま見ている位置」の、画面中心からのずれ(ワールド座標)
let off = { x: 0, y: 0 };
const wantZoom = () => (train ? 1 : overviewZoom);
const toWorld = (sx: number, sy: number) => ({
  x: (sx - vw / 2) / zoom + vw / 2 + off.x,
  y: (sy - vh / 2) / zoom + vh / 2 + off.y,
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
  if (need < overviewZoom) overviewZoom = Math.max(MIN_ZOOM, need * 0.8);
}

const HINTS: Record<Mode, string> = {
  rail: '画面をなぞってレールを敷こう',
  parts: 'パーツを選んで、置きたい場所をタップしよう',
  go: 'レールをタップすると列車が走り出すよ',
};

function setMode(m: Mode) {
  mode = m;
  btnRail.classList.toggle('active', m === 'rail');
  btnGo.classList.toggle('active', m === 'go');
  btnParts.classList.toggle('active', m === 'parts');
  palette.hidden = m !== 'parts';
  if (m !== 'go') train = null;
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
  pending = [];
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, layer.width, layer.height);
  applyView(lctx, layerZoom);
  for (const p of track.pieces) for (const d of p.deco) drawDeco(lctx, assets, d);
  for (const p of track.pieces) drawPiece(lctx, assets, p);
  dirty = true;
}

function applyView(c: CanvasRenderingContext2D, z: number, ox = 0, oy = 0) {
  const k = dpr * z;
  c.setTransform(k, 0, 0, k, dpr * (vw / 2 - z * (vw / 2 + ox)), dpr * (vh / 2 - z * (vh / 2 + oy)));
}

function addToLayer(piece: Piece) {
  applyView(lctx, layerZoom);
  for (const d of piece.deco) drawDeco(lctx, assets, d);
  drawPiece(lctx, assets, piece);
  if (zoom !== wantZoom() || layerZoom !== zoom) pending.push(piece);
  dirty = true;
}

let rail: RailDrawer;

const turnOf = (): Turn => (part === 'gentle' || part === 'sharp' ? turns[part] : 1);

/** 新しく置いたレールの後始末(飾り・ズーム・描画)。なぞり・パーツ両方で使う */
function onPlaced(piece: Piece) {
  spawnDeco(track, piece);
  growView(piece);
  addToLayer(piece);
}

/** パーツモードのタップ: 最初の1個は好きな場所に、2個目以降は端の近くに置く */
function tapPart(sx: number, sy: number) {
  const w = toWorld(sx, sy);
  if (line.empty) {
    onPlaced(line.placeFirst(firstSeg(part, w.x, w.y, turnOf())));
    return;
  }
  const cands = line.candidates(part, turnOf());
  const hit = line.pick(cands, w.x, w.y, 48 / zoom);
  if (!hit) return;
  onPlaced(line.placeAt(hit));
  if (hit.closes) showHint('ぐるっと1周つながった!');
}

function undoPart() {
  if (!line.undo()) return;
  renderLayer();
  dirty = true;
}

function showHint(text: string) {
  hint.textContent = text;
  hint.style.opacity = '1';
  window.setTimeout(() => (hint.style.opacity = '0'), 2500);
}

for (const b of palette.querySelectorAll<HTMLButtonElement>('button[data-part]')) {
  b.addEventListener('click', () => {
    const kind = b.dataset.part as PartKind;
    // 選択中のカーブをもう一度タップすると左右反転
    if (kind === part && (kind === 'gentle' || kind === 'sharp')) {
      turns[kind] = (turns[kind] * -1) as Turn;
      b.classList.toggle('flipped', turns[kind] === -1);
    }
    part = kind;
    palette.querySelectorAll('.part[data-part]').forEach((x) => x.classList.toggle('active', x === b));
    dirty = true;
  });
}
btnUndo.addEventListener('click', undoPart);

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'rail') {
    const w = toWorld(e.clientX, e.clientY);
    rail.down(w.x, w.y);
  } else if (mode === 'parts') {
    tapPart(e.clientX, e.clientY);
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
btnParts.addEventListener('click', () => setMode('parts'));

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
  line.clear();
  train = null;
  reach = { x: 0, y: 0 };
  overviewZoom = 1; // 拡大率も最初に戻す
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

/** 画面に入るレールと飾りだけを直接描く(列車を追うカメラ用。マップが広くても描画量は画面ぶんで済む) */
function drawVisible(c: CanvasRenderingContext2D) {
  const hw = vw / (2 * zoom) + 40;
  const hh = vh / (2 * zoom) + 40;
  const cx = vw / 2 + off.x;
  const cy = vh / 2 + off.y;
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = cy - hh;
  const y1 = cy + hh;
  const seen = track.pieces.filter(
    (p) => p.bb.x1 > x0 && p.bb.x0 < x1 && p.bb.y1 > y0 && p.bb.y0 < y1,
  );
  for (const p of seen) {
    for (const d of p.deco) {
      if (d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1) drawDeco(c, assets, d);
    }
  }
  for (const p of seen) drawPiece(c, assets, p);
}

/** パーツモードで、両端に置いたときの形を半透明で見せる */
function drawGhosts(c: CanvasRenderingContext2D) {
  if (mode !== 'parts' || line.empty) return;
  c.save();
  c.globalAlpha = 0.45;
  for (const cand of line.candidates(part, turnOf())) drawPiece(c, assets, { seg: cand.seg } as Piece);
  c.restore();
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);

  if (train) train.update(dt);
  const cars = train ? train.carsToDraw() : [];
  const follow = train !== null;

  const want = wantZoom();
  const zooming = zoom !== want;
  if (zooming) {
    zoom += (want - zoom) * (1 - Math.exp(-dt * 4));
    if (Math.abs(want - zoom) < 0.002 * want) zoom = want;
    dirty = true;
  }

  // カメラ: 走行中は先頭の車両を画面中央に、そうでなければ中心に戻す
  let tx = 0;
  let ty = 0;
  const lead = cars.find((c) => c.piece) ?? cars[0];
  if (follow && lead) {
    tx = lead.x - vw / 2;
    ty = lead.y - vh / 2;
  } else if (follow) {
    tx = off.x;
    ty = off.y;
  }
  if (off.x !== tx || off.y !== ty) {
    const k = 1 - Math.exp(-dt * 5);
    off.x += (tx - off.x) * k;
    off.y += (ty - off.y) * k;
    if (!follow && Math.abs(off.x) < 0.5 && Math.abs(off.y) < 0.5) off = { x: 0, y: 0 };
    dirty = true;
  }
  const centered = off.x === 0 && off.y === 0;

  if (centered && !zooming && layerZoom !== zoom) {
    renderLayer(); // 拡大率が落ち着いたら、その倍率で描き直して画質を戻す
  }
  if (!dirty && !train) return;
  dirty = false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (centered) {
    // 縮小の途中は、描きためた画像を拡大縮小して使う
    const r = zoom / layerZoom;
    ctx.setTransform(r, 0, 0, r, (canvas.width / 2) * (1 - r), (canvas.height / 2) * (1 - r));
    ctx.drawImage(layer, 0, 0);
    applyView(ctx, zoom);
    for (const p of pending) for (const d of p.deco) drawDeco(ctx, assets, d);
    for (const p of pending) drawPiece(ctx, assets, p);
  } else {
    applyView(ctx, zoom, off.x, off.y);
    drawVisible(ctx);
  }
  drawGhosts(ctx);
  if (train) {
    for (const c of cars) drawCar(ctx, assets.cars[c.idx], c.x, c.y, c.h, c.alpha);
    // 交差で下のレールを走る車両は、上に敷かれたレールの下に隠れるようにする
    const over = new Set<Piece>();
    for (const c of cars) {
      if (!c.piece) continue;
      for (const q of track.coveringPieces(c, c.piece, CAR_BODY_LEN, CAR_BODY_W)) over.add(q);
    }
    [...over].sort((a, b) => a.order - b.order).forEach((q) => drawPiece(ctx, assets, q));
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
    onPlaced,
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
