// 팔레트 = Find Your Color (TOOK_prototype 4번 화면)
// 900×1440 무대(ui-stage.js)에 원본 PNG 좌표 그대로 그린다. 상태(#stage data-mode):
//   arc   4번  질감 동그라미 줄 + matte 알약 + 아래 굵은 원형 컬러 다이얼 + 유리 손잡이, 흰 하단 시트 가운데 로고 버튼
//   recs  추천 결과: 로고 버튼을 누르면 시트가 화면 아래 절반(y 720~)까지 바로 올라와 지금 색과 비슷한 제품
//         (위에 추천 제품 색 동그라미 줄, 아래 제품 카드 2열 — 사용자 레퍼런스). 색이 바뀌면 목록도 바로 다시 찾는다
// (5~9번 링·접힌 다이얼, 10·11번 '농도·이 컬러로 제품 찾기' 시트는 2026-11-16 사용자 요청으로 뺐다)
// 색 고르기: 색 계열 4개(빨강·핑크·오렌지·누드, 보라는 뺐다) × 연함~진함 7칸 (2026-11-16 디자이너 의견).
//       색은 모두 립 DB(올리브영 립 제품)에 실제로 있는 예쁜 색이고, 다이얼은 놓으면 칸에 딱 멈춘다 → 입술에 입히는 색·제품을 찾는 색이 늘 DB 에 있는 색.
// 다이얼 (2026-11-17 사용자 요청 "원형 그래프로 다이얼처럼 돌아감, 버튼은 가운데·블러 버튼은 그대로, 색상표만 돌아가는"):
//       28칸 원형 그래프가 손가락을 따라 돌고, 유리 손잡이(블러)·흰 점·가운데 로고 버튼은 제자리.
//       손잡이 아래 칸 = 고른 색. 세게 밀면 조금 더 돌다 멈추고, 칸을 톡 누르면 그 칸이 손잡이 아래로 돌아온다.
// 질감 (2026-11-17 사용자 요청 "동그라미가 질감 동그라미, 옆으로 스크롤하면 바뀜"): 동그라미 줄 = 지금 색의 matte·glossy·satin·sheer·shimmer.
//       옆으로 밀면 넘어가고 가운데 큰 동그라미가 고른 질감. 그 아래 matte 알약(이름, 누르면 다음 질감)은 예전 그대로
// 얼굴 프레임: 네 모서리 괄호가 카메라에서 찾은 얼굴을 따라가 감싼다 (스마트미러의 얼굴 트래킹 표시). 얼굴이 없으면 제자리에서 숨 쉬듯 빛난다
//       카메라는 화면 전체 (2026-11-17)
// 예전 팔레트 기능도 이 디자인 안에: 내 톤으로 추천받기(타원 아래 알약 → 제목 아래 결과·추천 컬러 3개), 텍스처,
//       추천 카드 '입술에 발라보기'·'챗봇에 담기', 오른쪽 아래 챗봇 플로팅 버튼(모달). 언어 버튼은 홈에만 (2026-11-17)
// 카메라·입술 추적·색 입히기는 lip.js 그대로 (took:apply 이벤트로 색을 보낸다)
import { $, store, api, skeletonCards, tryOnCard, shortName } from './common.js';
import { t as tr } from './i18n.js';
import { openChat, closeChat } from './nav.js'; // 챗봇 모달 (두 번째 창)
import { getPicks } from './chat-picks.js'; // '챗봇에 담기'로 담은 제품
import { createNfcWindow } from './nfc-window.js'; // NFC 태그 시트 (세 번째 창, 2026-11-19)
import { listenNfc, findTagProduct, createNfcHint } from './nfc.js'; // 제품 NFC 태그 → 그 제품 색을 입술에
import { watchVideoBarcodes } from './barcode-scan.js'; // 거울에 비춘 제품 바코드 → 그 제품 색을 입술에
import { hexToRgb } from '../lib/color.js';
import { state as lip, video } from './lip-state.js';
import { applyLook } from './lip-look.js';
import { sourceFrame } from './lip-camera.js';
import { mapPoint } from './lip-view.js';
import { REDUCE_MOTION as reduce } from './motion.js';
import { markSvg } from './brand.js';
import { fitStage, toStage } from './ui-stage.js';

const RECOMMEND_COUNT = 6; // 고른 색과 비슷한 제품을 몇 개 보여 줄지
const stage = $('stage');
fitStage(stage);

// ---------- 색 계열 ----------
// 계열별 7칸 (연함 → 진함). 모두 src/data/products.oliveyoung.json 의 실제 제품 color_hex 중 맑고 예쁜 색만 골랐다 (2026-11-16).
// 가운데 칸(4번째) = 처음 자리 = 계열 대표 색
const FAMILIES = [
  { key: 'red', stops: ['#EB8283', '#E47270', '#E65157', '#DA3B52', '#BA2D3E', '#A52837', '#8A2D37'] },
  { key: 'pink', stops: ['#ECACBA', '#EBA1B4', '#E77492', '#D56287', '#CA3D71', '#AA3D55', '#95314B'] },
  { key: 'orange', stops: ['#EBA798', '#E2825C', '#E07667', '#E56A3B', '#D94D3A', '#B8483F', '#9A4F38'] },
  { key: 'nude', stops: ['#E9B1AE', '#DA9E95', '#DF918D', '#D6867E', '#C67867', '#B66A55', '#A0554A'] },
].map((f) => ({ ...f, rgb: f.stops.map(hexToRgb) }));
const STOPS = 7;
// 원형 그래프 = 28칸이 한 바퀴. 이웃 칸끼리 색이 이어지게 계열마다 방향을 번갈아 놓는다 (시계 방향):
//   빨강 연함→진함 | 핑크 진함→연함 | 오렌지 연함→진함 | 누드 진함→연함 | (다시 빨강 연함)
const SEGS = FAMILIES.length * STOPS;
const SEG = 360 / SEGS; // 한 칸 각도 (12.86°)
const mod = (n, m) => ((n % m) + m) % m;
const segOf = (fam, k) => fam * STOPS + (fam % 2 ? STOPS - 1 - k : k); // 계열·진하기 → 칸 번호
function pickOf(seg) { // 칸 번호(한 바퀴 넘어도 된다) → 계열·진하기
  const s = mod(seg, SEGS);
  const fam = Math.floor(s / STOPS);
  const j = s % STOPS;
  return { fam, k: fam % 2 ? STOPS - 1 - j : j };
}
const segHex = (seg) => { const p = pickOf(seg); return FAMILIES[p.fam].stops[p.k]; };
/** hex 와 가장 가까운 계열·칸 (NFC·내 톤 추천 색 쪽으로 다이얼을 돌릴 때) */
function nearestPick(hex) {
  const c = hexToRgb(hex);
  let best = { fam: 1, k: 3 };
  let bd = Infinity;
  FAMILIES.forEach((f, fam) => f.rgb.forEach((x, k) => {
    const e = (x.r - c.r) ** 2 + (x.g - c.g) ** 2 + (x.b - c.b) ** 2;
    if (e < bd) { bd = e; best = { fam, k }; }
  }));
  return best;
}

// ---------- 위치 (GP-홈화면 Figma 좌표, 2026-11-18) ----------
// 다이얼 링 = 지름 860.15 원(가운데 450, 1577.47)의 안쪽 33 띠. 흰 점 = (450, 1585.92)에서 반지름 373, 지름 13.56.
// 링 안 검정 반원(dome) = 가운데 (451.08, 1574.79) 반지름 380.65, 위 y 1194.14 투명 → 15.6%(y 1312.83)부터 검정 — 흰 점이 아래로 갈수록 사라진다
const G = { cx: 450, cy: 1577.47, ro: 430.08, ri: 397.08, ind: -90, gap: 0.6, dot: { cx: 450, cy: 1585.92, r: 373, d: 13.56, step: 9.27, n: 5 } };
const DOME = { cx: 451.08, cy: 1574.79, r: 380.65, y0: 1194.14, y1: 1312.83 };
const HANDLE = { cx: 450, cy: 1446.39, r1: 254.5, r2: 310.5, half: 9, rc: 10 }; // 유리 손잡이 = 다이얼보다 작은 원의 부채꼴 (위 가운데 링 위에 고정)
const SHEET_AT = { arc: [1348.385, 1348.385], recs: [720, 720] }; // 하단 시트 윗변 · 가운데 버튼 중심
const WHEEL_TOP = 820; // 다이얼 canvas 가 덮는 범위 (y 820~1440)
const DRAG_ZONE = [1045, 1340]; // 이 높이 사이(색 동그라미 아래 ~ 시트 위) 어디서든 끌면 다이얼이 돈다 (버튼·텍스처 줄 위는 제외)
const TEXTURES = ['matte', 'glossy', 'satin', 'sheer', 'shimmer']; // lip-engine.js TEXTURES 와 같은 이름

// ---------- 상태 ----------
const saved = store.get('fcSel') || {};
const savedFam = FAMILIES.findIndex((f) => f.key === saved.fam);
const savedK = Number.isInteger(saved.k) && saved.k >= 0 && saved.k < STOPS ? saved.k
  : Number.isFinite(saved.phi) ? Math.max(0, Math.min(STOPS - 1, Math.round((saved.phi + 46) / (92 / 6)))) : 3; // 예전 저장값(손잡이 각도 ±46°)도 읽는다
const sel = {
  fam: savedFam >= 0 ? savedFam : 1, // 고른 계열 (처음 = 핑크)
  k: savedK, // 진하기 칸 0(연함)~6(진함). 손잡이 아래 칸 = 입술 색
  texture: TEXTURES.includes(saved.texture) ? saved.texture : 'matte', // 텍스처 줄을 밀면 바뀐다. 추천 제품을 발라 보면 그 제형
  exact: saved.exact || null, // NFC·추천 제품·내 톤 추천처럼 그대로 입힐 색
};
let mode = 'arc';
// 다이얼이 돌아간 각도 (시계 방향 +). 칸 s 의 가운데 = 위(손잡이) 기준 s*SEG + rot → 손잡이 아래 칸 = -rot/SEG
let rot = -segOf(sel.fam, sel.k) * SEG;
const dialHex = () => FAMILIES[sel.fam].stops[sel.k];
const chosen = () => sel.exact || dialHex();
function save() { store.set('fcSel', { fam: FAMILIES[sel.fam].key, k: sel.k, texture: sel.texture, exact: sel.exact }); }
/** 칸 s 와 같은 칸 중 지금 다이얼에서 가장 가까운 번호 (짧은 쪽으로 돌게) */
const nearestSeg = (s) => s + SEGS * Math.round((-rot / SEG - s) / SEGS);

// 입술에 입히기 (lip.js). 끄는 동안 매 프레임 보내지 않도록 다음 화면 갱신에 한 번만
let applyPending = false;
function toLips() {
  if (applyPending) return;
  applyPending = true;
  requestAnimationFrame(() => {
    applyPending = false;
    window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex: chosen(), finish: null, quiet: true, source: 'Find Your Color' } }));
  });
}
/** 텍스처 바꾸기. move = 질감 동그라미 줄도 그 자리로 옮길지 (줄을 밀어서 바꾼 때는 이미 그 자리) */
function setTexture(name, { move = true } = {}) {
  if (!TEXTURES.includes(name)) name = 'matte';
  sel.texture = name;
  lip.texture = name;
  applyLook();
  $('fc-tex-name').textContent = name;
  $('fc-tex').setAttribute('aria-label', tr('fc.texture', { name }));
  swatches.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tex === name)));
  save();
  if (move && !texDrag) texGo(TEXTURES.indexOf(name));
}
// 텍스처 알약 (예전 그대로): 누를 때마다 matte → glossy → satin → sheer → shimmer. 가운데 질감 동그라미도 같이 넘어간다
$('fc-tex').addEventListener('click', () => setTexture(TEXTURES[(TEXTURES.indexOf(sel.texture) + 1) % TEXTURES.length]));

// ---------- 질감 동그라미 (2026-11-17 사용자 요청 "동그라미가 질감 동그라미, 옆으로 스크롤하면 바뀜") ----------
// 지금 색을 질감 5개(matte·glossy·satin·sheer·shimmer)로 그린 동그라미 줄. 원본 4번 줄처럼 고른 질감이 가운데(450) 크게, 나머지는 옆으로 작게·흐리게.
// 줄을 옆으로 밀면 손가락을 따라 넘어가고 가운데에 가장 가까운 동그라미가 지금 질감 (미는 동안에도 바로 입술에),
// 놓으면 하나에 딱 멈춘다(세게 밀면 한두 개 더). 옆 동그라미를 톡 누르면 그게 가운데로.
// (색 계열 동그라미는 뺐다: 계열 4개 × 7칸 색이 모두 다이얼에 있다)
// 터치 보정(touch-calib.js)의 가짜 포인터에서도 되도록 스크롤 대신 포인터 이벤트로 직접 움직인다
const swBox = $('fc-swatches'); // 줄 = y 897.14~1047.14 (css)
// GP-홈화면: 큰 동그라미 131 가운데 (451.08, 972.14), 이웃 75.58 가운데 601.04 → 711.62 → 822.2 (사이 35).
// 오른쪽 줄 위 검정 그라디언트(x 563.25~860, 투명→검정) = 옆 동그라미가 멀수록 어두워진다 (왼쪽도 똑같이)
const ROW = { cx: 451.08, y: 972.14 - 897.14, big: 131, d: 75.58, first: 149.96, gap: 110.58, fade0: 112.17, fadeW: 296.75 };
const TEX_W = 130; // 손가락이 이만큼 움직이면 한 개 넘어간다
const swatches = TEXTURES.map((name) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fc-sw';
  b.tabIndex = -1; // 키보드는 줄(#fc-swatches)에서 ←→
  b.dataset.tex = name;
  b.setAttribute('aria-label', tr('fc.texture', { name }));
  swBox.append(b);
  return b;
});
let texPos = Math.max(0, TEXTURES.indexOf(sel.texture)); // 가운데 온 자리 (소수 = 넘어가는 중)
let texAnim = 0;
let texDrag = null;
const texMax = TEXTURES.length - 1;
/** 가운데에서 d 개 떨어진 동그라미의 가운데 x (원본 간격: 큰 것 옆 151, 그다음부터 110) */
const rowX = (d) => { const a = Math.abs(d); return ROW.cx + Math.sign(d) * (a <= 1 ? a * ROW.first : ROW.first + (a - 1) * ROW.gap); };
function drawTex() {
  swatches.forEach((b, i) => {
    const d = i - texPos;
    const a = Math.abs(d);
    const on = Math.max(0, 1 - a); // 가운데일수록 1 (크기·흰 테·빛 번짐)
    const size = ROW.d + (ROW.big - ROW.d) * on;
    const x = rowX(d);
    const g = Math.max(0, Math.min(1, (Math.abs(x - ROW.cx) - ROW.fade0) / ROW.fadeW)); // 검정 그라디언트가 덮는 정도 (카메라 위라 흐리게 + 어둡게)
    Object.assign(b.style, { left: (x - size / 2).toFixed(1) + 'px', top: (ROW.y - size / 2).toFixed(1) + 'px', width: size.toFixed(1) + 'px', height: size.toFixed(1) + 'px',
      opacity: (1 - g).toFixed(3), filter: g > 0.001 ? `brightness(${(1 - g * 0.6).toFixed(3)})` : '', zIndex: String(10 - Math.round(a)) });
    b.style.setProperty('--on', on.toFixed(3));
  });
}
function texGo(i, ms = 260) {
  cancelAnimationFrame(texAnim);
  texAnim = 0;
  const from = texPos;
  const to = Math.max(0, Math.min(texMax, i));
  if (reduce || !ms || Math.abs(to - from) < 0.001) { texPos = to; drawTex(); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    texPos = from + (to - from) * (1 - (1 - k) ** 3);
    drawTex();
    texAnim = k < 1 ? requestAnimationFrame(step) : 0;
  };
  texAnim = requestAnimationFrame(step);
}
/** 가운데에 온 동그라미가 바뀌었으면 텍스처도 바꾼다 */
function texFollow() {
  const name = TEXTURES[Math.max(0, Math.min(texMax, Math.round(texPos)))];
  if (name !== sel.texture) setTexture(name, { move: false });
}
swBox.addEventListener('pointerdown', (e) => {
  if (texDrag || mode !== 'arc' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  cancelAnimationFrame(texAnim);
  texAnim = 0;
  const p = toStage(stage, e);
  texDrag = { id: e.pointerId, x0: p.x, pos0: texPos, moved: false, btn: e.target.closest('[data-tex]'), track: [[performance.now(), p.x]] };
  stage.classList.add('fc-texdrag');
  try { swBox.setPointerCapture(e.pointerId); } catch { /* 보정 터치(가짜 포인터) */ }
});
swBox.addEventListener('pointermove', (e) => {
  if (!texDrag || e.pointerId !== texDrag.id) return;
  const p = toStage(stage, e);
  const dx = p.x - texDrag.x0;
  if (!texDrag.moved && Math.abs(dx) < 8) return; // 톡 누르기와 구분
  texDrag.moved = true;
  const now = performance.now();
  texDrag.track.push([now, p.x]);
  while (texDrag.track.length > 2 && now - texDrag.track[0][0] > 100) texDrag.track.shift();
  let pos = texDrag.pos0 - dx / TEX_W;
  if (pos < 0) pos = -Math.min(0.35, -pos * 0.35); // 양 끝에서는 고무줄처럼 조금만
  if (pos > texMax) pos = texMax + Math.min(0.35, (pos - texMax) * 0.35);
  texPos = pos;
  drawTex();
  texFollow();
});
function endTex(e, cancelled) {
  if (!texDrag || (e && e.pointerId !== texDrag.id)) return;
  const g = texDrag;
  texDrag = null;
  stage.classList.remove('fc-texdrag');
  let i = Math.round(texPos);
  if (!g.moved && !cancelled) {
    // 톡: 옆 동그라미면 그게 가운데로 (가운데·빈 곳은 그대로)
    const at = g.btn ? TEXTURES.indexOf(g.btn.dataset.tex) : -1;
    if (at >= 0) i = at;
  } else if (g.track.length > 1 && !cancelled) {
    const t = g.track;
    const v = (t.at(-1)[1] - t[0][1]) / Math.max(1, t.at(-1)[0] - t[0][0]); // px/ms
    i = Math.round(texPos - (v * 140) / TEX_W); // 세게 밀면 조금 더
  }
  i = Math.max(0, Math.min(texMax, i));
  texGo(i);
  if (TEXTURES[i] !== sel.texture) setTexture(TEXTURES[i], { move: false });
}
swBox.addEventListener('pointerup', (e) => endTex(e, false));
swBox.addEventListener('pointercancel', (e) => endTex(e, true));
swBox.addEventListener('click', (e) => e.preventDefault()); // 톡은 pointerup 에서 처리했다
swBox.addEventListener('keydown', (e) => {
  const i = TEXTURES.indexOf(sel.texture);
  const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : null;
  if (to === null) return;
  e.preventDefault();
  if (to >= 0 && to <= texMax) setTexture(TEXTURES[to]);
});
let texWheel = 0;
swBox.addEventListener('wheel', (e) => { // PC 마우스 휠·트랙패드
  e.preventDefault();
  texWheel += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(texWheel) < 40) return;
  const i = TEXTURES.indexOf(sel.texture) + Math.sign(texWheel);
  texWheel = 0;
  if (i >= 0 && i <= texMax) setTexture(TEXTURES[i]);
}, { passive: false });

// ---------- 그리기: 원형 컬러 다이얼 (canvas) ----------
const wheel = $('fc-wheel');
const ctx = wheel.getContext('2d');
const S = Math.min(3, Math.max(2, devicePixelRatio || 1)); // 키오스크 틀이 화면을 키우므로 2배 이상으로 그린다
wheel.width = 900 * S;
wheel.height = (1440 - WHEEL_TOP) * S;
const rad = (d) => (d * Math.PI) / 180;
let alpha = 1; // 시트가 열리면 0 으로 사라진다
let alphaAnim = null;
let rafId = 0;
function frame(now) {
  rafId = 0;
  if (alphaAnim) {
    const k = Math.min(1, (now - alphaAnim.start) / alphaAnim.ms);
    alpha = alphaAnim.from + (alphaAnim.to - alphaAnim.from) * k;
    if (k >= 1) alphaAnim = null;
  }
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, 900, 1440 - WHEEL_TOP);
  if (alpha > 0.002) {
    const cy = G.cy - WHEEL_TOP;
    // 원형 그래프: 28칸을 틈(G.gap°)을 두고 한 칸씩. 다이얼이 돌면(rot) 칸이 모두 같이 돈다. 화면에 보이는 위쪽(±80°)만 그린다
    ctx.globalAlpha = alpha;
    for (let s = 0; s < SEGS; s++) {
      const rel = mod(s * SEG + rot + 180, 360) - 180; // 위(손잡이) 기준 칸 가운데 각도
      if (Math.abs(rel) > 80) continue;
      const a0 = rad(G.ind + rel - SEG / 2 + G.gap / 2);
      const a1 = rad(G.ind + rel + SEG / 2 - G.gap / 2);
      ctx.fillStyle = segHex(s);
      ctx.beginPath();
      ctx.arc(G.cx, cy, G.ro, a0, a1);
      ctx.arc(G.cx, cy, G.ri, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    // 흰 점(눈금)은 손잡이처럼 제자리. 그 위를 링 안 검정 반원이 덮어 아래로 갈수록 사라진다 (Figma 와 같은 겹침 순서)
    ctx.fillStyle = '#fff';
    for (let k = -G.dot.n; k <= G.dot.n; k++) {
      const t = rad(G.ind + k * G.dot.step);
      ctx.beginPath();
      ctx.arc(G.dot.cx + G.dot.r * Math.cos(t), G.dot.cy - WHEEL_TOP + G.dot.r * Math.sin(t), G.dot.d / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    const dome = ctx.createLinearGradient(0, DOME.y0 - WHEEL_TOP, 0, DOME.y1 - WHEEL_TOP);
    dome.addColorStop(0, 'rgba(0,0,0,0)');
    dome.addColorStop(1, '#000');
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.arc(DOME.cx, DOME.cy - WHEEL_TOP, DOME.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (alphaAnim) rafId = requestAnimationFrame(frame);
}
function redraw() { if (!rafId) rafId = requestAnimationFrame(frame); }

// ---------- 유리 손잡이 ----------
const handle = $('fc-handle');
(function placeHandle() {
  const h = HANDLE;
  const P = (r, a, ox, oy) => `${(h.cx + r * Math.cos(a) - ox).toFixed(2)} ${(h.cy + r * Math.sin(a) - oy).toFixed(2)}`;
  const pts = [];
  for (const r of [h.r1, h.r2]) for (const a of [G.ind - h.half, G.ind, G.ind + h.half]) pts.push([h.cx + r * Math.cos(rad(a)), h.cy + r * Math.sin(rad(a))]);
  const x0 = Math.min(...pts.map((p) => p[0])) - 2;
  const y0 = Math.min(...pts.map((p) => p[1])) - 2;
  const x1 = Math.max(...pts.map((p) => p[0])) + 2;
  const y1 = Math.max(...pts.map((p) => p[1])) + 2;
  const a1 = rad(G.ind - h.half);
  const a2 = rad(G.ind + h.half);
  const { r1, r2, rc } = h;
  const Q = (r, a) => P(r, a, x0, y0);
  const d = `M${Q(r2, a1 + rc / r2)} A${r2} ${r2} 0 0 1 ${Q(r2, a2 - rc / r2)} Q${Q(r2, a2)} ${Q(r2 - rc, a2)} L${Q(r1 + rc, a2)} Q${Q(r1, a2)} ${Q(r1, a2 - rc / r1)}`
    + ` A${r1} ${r1} 0 0 0 ${Q(r1, a1 + rc / r1)} Q${Q(r1, a1)} ${Q(r1 + rc, a1)} L${Q(r2 - rc, a1)} Q${Q(r2, a1)} ${Q(r2, a1 + rc / r2)} Z`;
  Object.assign(handle.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px', clipPath: `path('${d}')` });
  handle.querySelector('path').setAttribute('d', d);
})();
// 손잡이 안쪽 색: 원본처럼 손잡이 아래 칸 색을 렌즈처럼 늘려 채운다 (가운데 = 고른 칸, 양 끝 = 이웃 칸이 살짝)
function tintHandle() {
  const c = Math.round(-rot / SEG);
  handle.style.setProperty('--h1', segHex(c - 1));
  handle.style.setProperty('--h2', sel.exact && Math.abs(-rot / SEG - c) < 0.01 ? sel.exact : segHex(c));
  handle.style.setProperty('--h3', segHex(c + 1));
}

/** 질감 동그라미 색 = 지금 고른 색 (다이얼·추천 제품·내 톤 추천) */
function placeSwatches() {
  const hex = chosen();
  swatches.forEach((b) => b.style.setProperty('--c', hex));
}
/** 고른 칸 바꾸기 (계열 fam 의 k 번째 진하기). 다이얼이 돌다가 손잡이 아래 칸이 바뀔 때 */
function pick(fam, k) {
  const before = chosen();
  sel.fam = fam;
  sel.k = k;
  sel.exact = null;
  save();
  placeSwatches();
  tintHandle();
  wheel.setAttribute('aria-valuetext', chosen());
  if (chosen() === before) return;
  toLips();
  colorChanged();
}

// ---------- 시트·다크 모드 버튼 ----------
const sheet = $('fc-sheet');
const sbtn = $('fc-sbtn');
const GRID_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="currentColor">'
  + [5, 24, 43].flatMap((y) => [5, 24, 43].map((x) => `<circle cx="${x}" cy="${y}" r="4.9"/>`)).join('') + '</g></svg>';
sbtn.innerHTML = `<span class="fc-sbtn-logo">${markSvg()}</span><span class="fc-sbtn-grid">${GRID_SVG}</span>`;
sbtn.addEventListener('click', () => setMode(mode === 'arc' ? 'recs' : 'arc'));
// (오른쪽 위 다크/화이트 모드 동그라미는 2026-11-16 사용자 요청으로 뺐다)
// (언어 버튼은 2026-11-17 사용자 요청으로 홈에만 — 여기서 바꾸지 않는다)
// 왼쪽 세로 메뉴 (GP-홈화면 2026-11-18): 음성 = 챗봇 모달(예전 오른쪽 아래 플로팅 버튼), 스캔 = 이 화면(추천 결과면 다이얼로 돌아오기),
// 9점 = 지금 색의 추천 제품 열기/닫기(가운데 로고 버튼과 같은 일), 집 = 처음으로(로고와 같은 일). 담은 제품 수는 음성 버튼 오른쪽 위 숫자
const chatBtn = $('fc-chat');
const badge = $('fc-chat-badge');
chatBtn.addEventListener('click', () => { nfcWin.close(); openChat(); });
$('fc-mb-scan').addEventListener('click', () => { if (mode !== 'arc') setMode('arc'); });
$('fc-mb-grid').addEventListener('click', () => setMode(mode === 'arc' ? 'recs' : 'arc'));
$('fc-mb-home').addEventListener('click', (e) => { e.preventDefault(); store.clear(); location.href = 'index.html'; });
function syncPicks(e) {
  const n = getPicks().length;
  badge.textContent = n ? String(n) : '';
  chatBtn.setAttribute('aria-label', tr('fc.chat') + (n ? ` · ${tr('pick.count', { n })}` : ''));
  if (e?.detail?.count) badge.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
}
window.addEventListener('took:picks-change', syncPicks);
syncPicks();
// 내 톤 추천 컬러를 누르면(lip-look.js took:pick) 그 색을 그대로 입히고 다이얼도 가장 가까운 칸으로 돌린다
window.addEventListener('took:pick', (e) => {
  const hex = e.detail?.hex;
  if (!hex) return;
  const near = nearestPick(hex);
  const s = nearestSeg(segOf(near.fam, near.k));
  sel.fam = near.fam;
  sel.k = near.k;
  sel.exact = hex.toUpperCase();
  save();
  placeSwatches();
  spinTo(-s * SEG, 460, false);
  window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex, finish: null, quiet: true, source: '내 톤 추천 컬러' } }));
  colorChanged();
});

// ---------- 상태 바꾸기 (4번 ↔ 추천 결과) ----------
function setMode(m, { instant = false } = {}) {
  mode = m === 'recs' || m === 'sheet' ? 'recs' : 'arc'; // 예전 주소 ?mode=sheet 도 추천 결과로
  stage.dataset.mode = mode;
  stage.dataset.dim = '1'; // 괄호 빛 번짐이 있는 상태 (원본 4번)
  stage.classList.toggle('fc-instant', instant || reduce);
  if (instant || reduce) requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('fc-instant')));
  const to = mode === 'arc' ? 1 : 0;
  if (instant || reduce) { alpha = to; alphaAnim = null; } else alphaAnim = { from: alpha, to, start: performance.now(), ms: 380 };
  redraw();
  handle.classList.toggle('off', mode !== 'arc');
  placeSwatches();
  const [top, btnY] = SHEET_AT[mode];
  sheet.style.top = top + 'px';
  sbtn.style.top = btnY - 67.53 + 'px';
  sbtn.classList.toggle('logo', mode === 'arc');
  const open = mode !== 'arc';
  sbtn.setAttribute('aria-expanded', String(open));
  sbtn.setAttribute('aria-label', tr(open ? 'fc.sheetClose' : 'fc.sheet'));
  const grid = $('fc-mb-grid');
  grid.setAttribute('aria-expanded', String(open));
  grid.setAttribute('aria-label', tr(open ? 'fc.sheetClose' : 'fc.sheet'));
  sheet.inert = !open;
  wheel.setAttribute('aria-valuetext', chosen());
  if (open) queueRecs(0); // 로고 버튼을 누르면 바로 지금 색의 추천 제품
}

// ---------- 다이얼 돌리기 (2026-11-17) ----------
// 유리 손잡이(블러)·흰 점·가운데 로고 버튼은 제자리, 원형 그래프(색 28칸)만 손가락을 따라 돈다.
// 끄는 동안 손잡이 아래 칸이 바뀔 때마다 입술 색도 바로 바뀌고, 놓으면 가장 가까운 칸에 딱 멈춘다 (세게 밀면 조금 더 돌다가).
// 칸을 톡 누르면 그 칸이 손잡이 아래로 돌아온다.
let drag = null;
let spin = 0; // 돌아가는 움직임 (requestAnimationFrame id)
const angleOf = (p) => (Math.atan2(p.y - G.cy, p.x - G.cx) * 180) / Math.PI;
const relOf = (p) => mod(angleOf(p) - G.ind + 180, 360) - 180; // 위(손잡이) 기준 각도, 시계 방향 +
function stopSpin() { cancelAnimationFrame(spin); spin = 0; }
/** 다이얼을 r 도로 돌려 둔다. live = 손잡이 아래 칸이 바뀌면 그 색을 고른다 (손가락으로 돌릴 때). 아니면 그림만 (이미 고른 칸으로 가는 중) */
function setRot(r, live = true) {
  rot = r;
  redraw();
  tintHandle();
  if (!live) return;
  const p = pickOf(Math.round(-rot / SEG));
  if (p.fam !== sel.fam || p.k !== sel.k || sel.exact) pick(p.fam, p.k);
}
/** 다이얼을 to 도까지 ms 동안 부드럽게 돌린다 */
function spinTo(to, ms = 320, live = true) {
  stopSpin();
  const from = rot;
  if (reduce || !ms || Math.abs(to - from) < 0.01) { setRot(to, live); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    setRot(k < 1 ? from + (to - from) * (1 - (1 - k) ** 3) : to, live);
    spin = k < 1 ? requestAnimationFrame(step) : 0;
  };
  spin = requestAnimationFrame(step);
}
stage.addEventListener('pointerdown', (e) => {
  if (drag || mode !== 'arc' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.target.closest('button, a, .fc-swatches, .nt')) return; // .nt = NFC 태그 시트 (위에 떠 있는 동안 다이얼은 안 돈다)
  const p = toStage(stage, e);
  if (p.y < DRAG_ZONE[0] || p.y > DRAG_ZONE[1]) return;
  e.preventDefault();
  stopSpin();
  drag = { id: e.pointerId, p0: p, last: angleOf(p), moved: 0, pending: 0, live: false, track: [[performance.now(), rot]] };
  stage.classList.add('fc-dragging');
  try { stage.setPointerCapture(e.pointerId); } catch { /* 보정 터치(가짜 포인터) */ }
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const a = angleOf(toStage(stage, e));
  const d = mod(a - drag.last + 180, 360) - 180;
  drag.last = a;
  drag.moved += Math.abs(d);
  drag.pending += d;
  if (!drag.live && drag.moved < 1.2) return; // 손 떨림·톡 누르기는 돌리지 않는다
  drag.live = true;
  setRot(rot + drag.pending);
  drag.pending = 0;
  const now = performance.now();
  drag.track.push([now, rot]);
  while (drag.track.length > 2 && now - drag.track[0][0] > 100) drag.track.shift();
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const g = drag;
  drag = null;
  stage.classList.remove('fc-dragging');
  if (!g.live) {
    // 톡: 색 칸 위를 눌렀으면 그 칸이 손잡이 아래로 돌아온다
    const r = Math.hypot(g.p0.x - G.cx, g.p0.y - G.cy);
    if (e?.type === 'pointerup' && r > G.ri - 34 && r < G.ro + 34) {
      const s = Math.round((relOf(g.p0) - rot) / SEG);
      spinTo(-s * SEG, 300);
    }
    return;
  }
  // 놓기: 손가락 속도만큼 조금 더 돌다가 가장 가까운 칸에 멈춘다
  const t = g.track;
  const v = t.length > 1 ? (t.at(-1)[1] - t[0][1]) / Math.max(1, t.at(-1)[0] - t[0][0]) : 0; // 도/ms
  const fling = Math.max(-3 * SEG, Math.min(3 * SEG, v * 160));
  const s = Math.round(-(rot + fling) / SEG);
  spinTo(-s * SEG, Math.min(520, 180 + Math.abs(-s * SEG - rot) * 12));
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
// 키보드: 다이얼에 초점이 있으면 ←→ 로 한 칸씩 (→ = 오른쪽 칸이 손잡이 아래로)
wheel.addEventListener('keydown', (e) => {
  const c = Math.round(-rot / SEG);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); spinTo(-(c - 1) * SEG, 200); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); spinTo(-(c + 1) * SEG, 200); }
});

// ---------- 카메라 ----------
// 카메라 켜기·보이기·안내는 이전 버전처럼 lip.js(lip-camera.js)만 맡는다 (2026-11-16: 이 화면이 따로 감시해 숨기던 코드는 뺐다)

// ---------- 얼굴 따라가는 프레임 (스마트미러 얼굴 트래킹 표시) ----------
// lip-tracker.js 가 찾은 얼굴 네모(원본 프레임 0~1)를 화면(#view, object-fit: cover) 위치로 옮겨 괄호 네 개를 그 둘레로 붙인다.
// 얼굴이 없으면 원본 4번 자리(HOME)로 천천히 돌아가 숨 쉬듯 빛난다 (CSS .fc-face:not(.fc-tracking))
const faceSec = document.querySelector('.fc-face');
const camArea = document.querySelector('.fc-camarea');
const viewEl = $('view');
const HOME = [248, 356, 654, 841]; // 얼굴이 없을 때 괄호 네 개가 이루는 네모 (x0, y0, x1, y1, 원본 4번 자리)
// 괄호가 다닐 수 있는 화면 범위 (카메라가 화면 꽉 차므로 제목 아래 ~ 색 동그라미 위, 2026-11-17). 추천 결과에서는 시트 위 카메라 창 안
// 2026-11-18 GP-홈화면: 왼쪽 세로 메뉴(x ~90)·'내 톤으로 추천받기'(y ~294) 를 비켜서. recs 아래 = 가운데 버튼(y 652~) 위
const TRACK_AREA = { arc: [104, 304, 876, 900], recs: [104, 304, 876, 620] };
const MIN_BOX = [200, 236]; // 괄호(66×66)끼리 겹치지 않는 최소 크기
const brs = ['tl', 'tr', 'bl', 'br'].map((k) => faceSec.querySelector('.fc-br-' + k));
const fb = HOME.slice(); // 지금 괄호 네모
let lastGoal = null;
let lastSeen = 0;
// 추천 결과(시트가 화면 아래 절반)에서는 카메라를 위로 올려 입술이 시트 위 창(y 200~720)에 오게 한다. 입술 위치를 따라 천천히 (손 떨림 정도는 무시)
const LIPS_AT = 540; // 추천 결과에서 입술이 올 높이
let shift = 0; // 지금 카메라를 올린 만큼 (px, 음수 = 위로)
let shiftGoal = 0;
// a0~a1 을 최소 길이 min 이상, lo~hi 안으로
function fitSpan(a0, a1, min, lo, hi) {
  if (a1 - a0 < min) { const c = (a0 + a1) / 2; a0 = c - min / 2; a1 = c + min / 2; }
  if (a1 - a0 >= hi - lo) return [lo, hi];
  if (a0 < lo) { a1 += lo - a0; a0 = lo; }
  if (a1 > hi) { a0 -= a1 - hi; a1 = hi; }
  return [a0, a1];
}
/** 카메라 원본 좌표(0~1) 점들 → 카메라 칸 안 화면 좌표 (#view, object-fit: cover). 영상이 없으면 null */
function toView(points) {
  if (viewEl.classList.contains('hidden') || !viewEl.width) return null;
  const f = sourceFrame();
  if (!f?.w) return null;
  const turn = ((Number(f.rotate) || 0) % 360 + 360) % 360;
  const W = camArea.offsetWidth;
  const H = camArea.offsetHeight;
  const cw = viewEl.width;
  const ch = viewEl.height;
  const s = Math.max(W / cw, H / ch);
  const ox = camArea.offsetLeft + (W - cw * s) / 2;
  const oy = camArea.offsetTop + (H - ch * s) / 2;
  return points.map((q) => { const p = mapPoint(q, !!f.mirror, turn); return { x: ox + p.x * cw * s, y: oy + p.y * ch * s }; });
}
function faceGoal() {
  const b = lip.lips?.box;
  const pts = b && toView([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 }]);
  if (!pts) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;
  x0 -= w * 0.14; x1 += w * 0.14; y0 -= h * 0.12; y1 += h * 0.08; // 얼굴 둘레에 여백
  const area = TRACK_AREA[mode]; // 화면 범위 → 카메라 칸 안 좌표 (추천 결과에서는 칸이 shift 만큼 올라가 있다)
  [x0, x1] = fitSpan(x0, x1, MIN_BOX[0], area[0], area[2]);
  [y0, y1] = fitSpan(y0, y1, MIN_BOX[1], area[1] - shift, area[3] - shift);
  return [x0, y0, x1, y1];
}
/** 카메라를 올릴 만큼: 추천 결과에서 입술(lip-tracker 입술 윤곽 가운데)이 LIPS_AT 에 오게. 얼굴이 없으면 화면 가운데를 올린 만큼 */
function shiftFor() {
  if (mode !== 'recs') return 0;
  const lips = lip.lips?.outer;
  const pts = lips?.length && toView(lips);
  const y = pts ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 720 + 140;
  return Math.max(-640, Math.min(0, LIPS_AT - y));
}
function placeBrackets() {
  const [x0, y0, x1, y1] = fb;
  const at = (el, x, y) => { el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; };
  at(brs[0], x0 - HOME[0], y0 - HOME[1]);
  at(brs[1], x1 - HOME[2], y0 - HOME[1]);
  at(brs[2], x0 - HOME[0], y1 - HOME[3]);
  at(brs[3], x1 - HOME[2], y1 - HOME[3]);
}
function trackFace(now) {
  let goal = faceGoal();
  if (goal) { lastGoal = goal; lastSeen = now; } else if (lastGoal && now - lastSeen < 700) goal = lastGoal; // 잠깐 놓쳐도 바로 돌아가지 않게
  faceSec.classList.toggle('fc-tracking', !!goal);
  const target = goal || HOME;
  const k = goal ? 0.3 : 0.08; // 얼굴은 빠르게 따라가고, 놓치면 천천히 제자리로
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const d = target[i] - fb[i];
    if (!d) continue;
    fb[i] = Math.abs(d) < 0.3 ? target[i] : fb[i] + d * k;
    moved = true;
  }
  if (moved) placeBrackets();
  // 추천 결과: 입술이 시트 위 창 밖으로 꽤 벗어날 때만 목표를 바꾸고(70px), 카메라는 부드럽게 따라간다
  const want = shiftFor();
  if (mode !== 'recs' || Math.abs(want - shiftGoal) > 70) shiftGoal = want;
  if (shift !== shiftGoal) {
    const d = shiftGoal - shift;
    shift = reduce || Math.abs(d) < 0.5 ? shiftGoal : shift + d * 0.12;
    faceSec.style.transform = shift ? `translateY(${shift.toFixed(1)}px)` : '';
  }
  requestAnimationFrame(trackFace);
}
requestAnimationFrame(trackFace);

// ---------- 로고: 처음으로 (초기화 → 홈 1번 마크 화면부터: 터치 → TOOK 로고 → 시작 버튼) ----------
const logo = $('nav-reset'); // 로고 그림은 palette.html 에 바로 들어 있다 (첫 화면부터 보이게)
logo.addEventListener('click', (e) => {
  e.preventDefault();
  store.clear();
  location.href = 'index.html';
});

// ---------- 추천 제품 (실시간) ----------
// 로고 버튼을 누르면 바로 지금 색과 비슷한 제품을 찾는다 (예전 '이 컬러로 제품 찾기' 단계 없음).
// 시트가 열려 있는 동안 색이 바뀌면(내 톤 추천·NFC 등) 목록도 잠깐 뒤 다시 찾는다. 같은 색이면 다시 열어도 그대로 바로 보인다.
// 카드에서 '입술에 발라보기'한 제품 색은 목록을 바꾸지 않는다 (보고 있던 목록이 사라지지 않게)
const recList = $('rec-list');
const recStatus = $('rec-status');
const recDots = $('fc-rec-dots');
let want = chosen(); // 추천할 색: 바·동그라미·내 톤 추천·NFC 로 고른 색
let shown = null; // 지금 목록이 보여 주는 색
let recTimer = 0;
let recSeq = 0; // 늦게 온 이전 응답은 버린다
function colorChanged() {
  want = chosen();
  if (mode === 'recs') queueRecs(250);
}
function queueRecs(ms) {
  clearTimeout(recTimer);
  if (want === shown) return;
  recTimer = setTimeout(loadRecs, ms);
}
// 추천 제품 색 동그라미 줄 (레퍼런스 맨 위 줄): 누르면 그 제품 색을 바르고 카드로 넘어간다
function showDots(products) {
  recDots.replaceChildren(...products.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.setProperty('--c', p.color_hex || '#888');
    b.setAttribute('aria-label', tr('lip.tryOn') + ' · ' + shortName(p));
    b.addEventListener('click', () => {
      tryProduct(p);
      for (const d of recDots.children) d.setAttribute('aria-pressed', String(d === b));
      recList.children[i]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    });
    return b;
  }));
}
async function loadRecs() {
  const hex = want;
  const seq = ++recSeq;
  shown = hex;
  recStatus.textContent = tr('fc.searching');
  recDots.replaceChildren();
  recList.replaceChildren(...skeletonCards(4));
  const { ok, body } = await api('api/recommend?' + new URLSearchParams({ hex, limit: RECOMMEND_COUNT }));
  if (seq !== recSeq) return; // 그새 색이 또 바뀌었다
  if (!ok) {
    shown = null; // 다음에 열면 다시 찾는다
    recStatus.textContent = body.error || tr('lip.recFail');
    recList.replaceChildren();
    return;
  }
  recStatus.textContent = body.products.length ? tr('fc.found', { n: body.products.length }) : tr('fc.none');
  showDots(body.products);
  recList.scrollTop = 0;
  recList.replaceChildren(...body.products.map((product) => tryOnCard(product, tryProduct)));
}
// 추천 카드: '입술에 발라보기' · '챗봇에 담기' (담은 제품은 오른쪽 아래 챗봇 버튼으로 이어서 물어본다)
// '입술에 발라보기': 그 제품 색·제형을 그대로 입힌다
function tryProduct(p, { quiet = false } = {}) { // quiet: 아래 알림 없이 (NFC 시트는 입술 색이 바뀌는 것으로 충분하고, 알림이 시트 버튼을 가린다)
  sel.exact = p.color_hex;
  if (p.finish) setTexture(p.finish === 'velvet' ? 'matte' : p.finish); // 제품 제형 → 가장 가까운 텍스처
  save();
  placeSwatches();
  window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex: p.color_hex, finish: p.finish, quiet, source: shortName(p) } }));
}

// ---------- NFC 태그·바코드: 립 제품을 리더기에 올리거나 바코드를 거울(카메라)에 비추면 그 제품 색을 바로 입술에 바르고 시트에 제품 카드 ----------
const nfcFlash = createNfcHint($('nfc-hint'), { ms: 3000 });
// kind: 'nfc' | 'barcode' (안내 문구만 다르다)
async function showTagProduct(code, kind = 'nfc') {
  const p = await findTagProduct(code, api); // 태그 표·제품 ID·바코드 번호(호수까지) 순서로 찾는다
  if (!p?.color_hex) { nfcFlash(tr(kind === 'barcode' ? 'pal.barcodeUnknown' : 'pal.nfcUnknown')); return; }
  wearProduct(p, kind);
}
// 제품 하나를 거울에서 바로 바르고(다이얼도 가장 가까운 칸으로) 시트에 그 제품 카드 (태그·바코드·NFC 창의 '거울에 발라보기' 공통)
function wearProduct(p, kind = 'nfc') {
  const near = nearestPick(p.color_hex);
  sel.fam = near.fam;
  sel.k = near.k;
  spinTo(-nearestSeg(segOf(near.fam, near.k)) * SEG, 0, false);
  tryProduct(p);
  nfcFlash(tr('pal.nfcApplied', { name: shortName(p) }));
  clearTimeout(recTimer);
  recSeq++; // 찾는 중이던 추천은 버리고 이 제품 카드를 보여 준다
  want = shown = chosen();
  setMode('recs');
  recStatus.textContent = tr(kind === 'barcode' ? 'pal.barcodeRead' : 'pal.nfcRead');
  showDots([p]);
  recList.replaceChildren(tryOnCard(p, tryProduct));
}
// NFC 태그 시트 (세 번째 창, js/nfc-window.js, 2026-11-19): 메뉴 버튼 없이 리더기가 태그를 읽으면 그 제품 색을 바로 입술에 바르고,
// 아래(다이얼 자리)에 시트를 올려 실제 호수 줄을 보여 준다(누를 때마다 입술 색이 바뀜). 얼굴은 가리지 않는다.
// [이 색과 비슷한 립 보기] = 거울의 추천 제품(지금 색), [챗봇에게 물어보기] = 그 제품(고른 호수)을 기준으로 챗봇 창
const nfcWin = createNfcWindow({
  stage,
  onOpen: () => { closeChat(); if (mode !== 'arc') setMode('arc'); },
  onWear: (p) => {
    const near = nearestPick(p.color_hex);
    sel.fam = near.fam;
    sel.k = near.k;
    spinTo(-nearestSeg(segOf(near.fam, near.k)) * SEG, 0, false);
    tryProduct(p, { quiet: true });
  },
  onSimilar: () => { colorChanged(); setMode('recs'); },
  onAsk: (p) => openChat({ base: lineOf(p) }),
});
const tagToWindow = (code) => nfcWin.show(code);
const lineOf = (p) => p.line || p.id; // 호수 상품(OY-…-01)이면 그 제품 줄 (챗봇 기준 제품)
listenNfc(tagToWindow);
// 홈에서 태그하고 넘어온 경우 (home.js 가 took.pendingTag 에 남긴 번호): 들어오자마자 NFC 창에서 그 제품을 보여 준다
{
  let pending = null;
  try { pending = sessionStorage.getItem('took.pendingTag'); sessionStorage.removeItem('took.pendingTag'); } catch { /* 저장 불가 환경 */ }
  if (pending) tagToWindow(pending);
}
// 바코드 (2026-11-18): 입술 카메라 영상을 그대로 써서 상품 바코드(EAN·UPC)를 천천히 계속 찾는다 (카메라를 새로 열지 않음).
// 카메라가 켜져 있을 때만, 화면이 보이고 챗봇 창이 닫혀 있을 때만 읽는다 (챗봇 창은 자기 '바코드 비추기'로 읽는다).
// 같은 제품은 4초 동안 안 보였다가 다시 비춰야 또 바른다
watchVideoBarcodes({
  video,
  active: () => lip.source === 'camera' && !document.hidden && !document.documentElement.classList.contains('chat-modal-open'),
  onCode: (code) => (nfcWin.isOpen() ? nfcWin.show(code) : showTagProduct(code, 'barcode')), // NFC 창이 열려 있으면 그 창에서
});

// ---------- 시작 ----------
lip.texture = sel.texture;
setTexture(sel.texture, { move: false });
drawTex();
tintHandle();
setMode(new URLSearchParams(location.search).get('mode'), { instant: true }); // 화면 확인용 ?mode=recs
toLips();
// 자동 테스트·화면 확인용
window.tookFind = { setMode, spinTo, setTexture, sel, chosen, FAMILIES, SEG, rot: () => rot, segHex, texPos: () => texPos };
