// 팔레트 = Find Your Color (TOOK_prototype 4·10·11번 화면 그대로)
// 900×1440 무대(ui-stage.js)에 원본 PNG 좌표 그대로 그린다. 상태(#stage data-mode):
//   arc    4번  아래 굵은 반원 컬러 다이얼 + 유리 손잡이, 흰 하단 시트 가운데 로고 버튼
//   sheet  10번(라이트)·11번(다크) 시트가 올라와 '이 컬러로 제품 찾기'. 오른쪽 위 동그라미 = 다크 모드
//   recs   추천 결과: 시트가 화면 아래 절반(y 720~)을 차지하고, 위에 추천 제품 색 동그라미 줄, 아래 제품 카드 2열 (사용자 레퍼런스)
// (5~9번 링·접힌 다이얼 상태는 2026-11-16 사용자 요청으로 뺐다: "4번만 작동되는 방향으로")
// 조작: 색 띠(반원)는 고정, 유리 손잡이를 끌면 반원을 따라 움직이고 손잡이 아래 색이 기준 색이 된다.
//       반원 위 다른 곳을 누르면 손잡이가 그곳으로 미끄러져 온다. 기준 색과 짙은 단계 3개가 색 동그라미로 나오고 입술에 바로 입힌다.
//       작은 동그라미를 누르면 그 색을 고른다. 시트 버튼(로고/격자)은 시트를 열고 닫는다.
// 예전 팔레트 기능도 이 디자인 안에: 내 톤으로 추천받기(타원 아래 알약 → 제목 아래 결과·추천 컬러 3개), 텍스처(matte 알약),
//       농도(시트 안 슬라이더), 추천 카드 '입술에 발라보기'·'챗봇에 담기', 오른쪽 아래 챗봇 플로팅 버튼(모달), 언어(오른쪽 위)
// 카메라·입술 추적·색 입히기는 lip.js 그대로 (took:apply 이벤트로 색을 보낸다)
import { $, store, api, skeletonCards, tryOnCard, shortName } from './common.js';
import { t as tr, langToggle } from './i18n.js';
import { openChat } from './nav.js'; // 챗봇 모달
import { getPicks } from './chat-picks.js'; // '챗봇에 담기'로 담은 제품
import { listenNfc, resolveTag, createNfcHint } from './nfc.js'; // 제품 NFC 태그 → 그 제품 색을 입술에
import { hexToRgb, rgbToHex } from '../lib/color.js';
import { state as lip } from './lip-state.js';
import { applyLook } from './lip-look.js';
import { REDUCE_MOTION as reduce } from './motion.js';
import { markSvg } from './brand.js';
import { fitStage, toStage } from './ui-stage.js';

const RECOMMEND_COUNT = 6; // 고른 색과 비슷한 제품을 몇 개 보여 줄지
const stage = $('stage');
fitStage(stage);

// ---------- 색 (원본 PNG 에서 잰 값) ----------
// 반원 다이얼: 손잡이 기준 각도(시계 방향 +) → 색. 손잡이 아래 = 기준 색. 한 바퀴 이어진다
const DIAL = [[-180, '#7A2A6A'], [-140, '#8E1C3A'], [-100, '#C8323F'], [-70, '#F04646'], [-50, '#FF4C4C'], [-40, '#FF4242'], [-30, '#FF3737'],
  [-25, '#FF3F3F'], [-20, '#FF5252'], [-15, '#FF6969'], [-10, '#FF8383'], [0, '#FC54A5'], [5, '#FF109C'], [10, '#FF3699'], [15, '#FF6A95'],
  [20, '#FF9692'], [25, '#FFBA8F'], [30, '#FFCF88'], [35, '#FFC279'], [40, '#FFB165'], [45, '#FFA558'], [50, '#FF9B4D'], [70, '#E8803C'],
  [100, '#C06A3A'], [140, '#9A4A50'], [180, '#7A2A6A']].map(([d, h]) => [d, hexToRgb(h)]);
function colorAt(deg) {
  const d = ((deg + 180) % 360 + 360) % 360 - 180;
  for (let i = 1; i < DIAL.length; i++) {
    if (d <= DIAL[i][0]) {
      const [d0, c0] = DIAL[i - 1];
      const [d1, c1] = DIAL[i];
      const k = (d - d0) / (d1 - d0 || 1);
      return { r: c0.r + (c1.r - c0.r) * k, g: c0.g + (c1.g - c0.g) * k, b: c0.b + (c1.b - c0.b) * k };
    }
  }
  return DIAL[DIAL.length - 1][1];
}
// 짙은 단계: 원본 7번 화면 동그라미 #FC54A5 → #A84172 → #4D1E35 → #2A111D (색 × a + 짙은 회색 × (1 - a))
const SHADES = [[0.613, 35], [0.28, 9], [0.149, 5.3]];
function shadesOf(hex) {
  const c = hexToRgb(hex);
  return [hex, ...SHADES.map(([a, g]) => rgbToHex({ r: c.r * a + g * (1 - a), g: c.g * a + g * (1 - a), b: c.b * a + g * (1 - a) }))];
}
/** 반원에서 hex 와 가장 가까운 손잡이 자리 (NFC·내 톤 추천 색 쪽으로 손잡이를 옮길 때) */
function nearestDeg(hex) {
  const c = hexToRgb(hex);
  let best = 0;
  let bd = Infinity;
  for (let d = -46; d <= 46; d += 0.5) { // 손잡이가 갈 수 있는 범위 안에서
    const x = colorAt(d);
    const e = (x.r - c.r) ** 2 + (x.g - c.g) ** 2 + (x.b - c.b) ** 2;
    if (e < bd) { bd = e; best = d; }
  }
  return best;
}

// ---------- 위치 (원본 04.png 좌표) ----------
const G = { cx: 449.5, cy: 1608.5, ro: 427.95, ri: 396.65, ind: -90, dot: { r: 363.5, d: 13, step: 9.27, a: [0.9, 0.86, 0.75, 0.56, 0.3] } };
const HANDLE = { cx: 449.5, cy: 1478, r1: 254.5, r2: 310.5, half: 9, rc: 10 }; // 유리 손잡이 = 다이얼보다 작은 원의 부채꼴
const ROW = { y: 1005, big: { x: 450.5, d: 131, b: 3.5 }, d: 75, off: [150, 260.5, 371.5] }; // 색 동그라미 줄
const SHEET_AT = { arc: [1348.4, 1348.5], sheet: [932.25, 937.5], recs: [720, 720] }; // 하단 시트 윗변 · 가운데 버튼 중심
const WHEEL_TOP = 820; // 다이얼 canvas 가 덮는 범위 (y 820~1440)
const DRAG_ZONE = [1075, 1340]; // 이 높이 사이(색 동그라미 아래 ~ 시트 위) 어디서든 끌면 다이얼이 돈다 (버튼 위는 제외)
const TEXTURES = ['matte', 'glossy', 'satin', 'sheer', 'shimmer']; // lip-engine.js TEXTURES 와 같은 이름
const CHAT_AT = { arc: [818, 1394], sheet: [818, 998], recs: [818, 672] }; // 챗봇 플로팅 버튼 가운데 (시트 위 오른쪽)

// ---------- 상태 ----------
const saved = store.get('fcSel') || {};
const sel = {
  phi: Number.isFinite(saved.phi) ? Math.max(-46, Math.min(46, saved.phi)) : 0, // 손잡이 자리 (위 기준 각도, 손잡이 아래 = DIAL(phi))
  base: saved.base || '#FC54A5',
  i: Number.isInteger(saved.i) ? saved.i : 0, // 고른 동그라미 (0 = 기준 색)
  texture: TEXTURES.includes(saved.texture) ? saved.texture : 'matte', // matte 알약을 누르면 바뀐다. 추천 제품을 발라 보면 그 제형
  exact: saved.exact || null, // NFC·추천 제품처럼 그대로 입힐 색
};
let mode = 'arc';
const list = () => shadesOf(sel.base);
const chosen = () => sel.exact || list()[sel.i];
function save() { store.set('fcSel', { phi: sel.phi, base: sel.base, i: sel.i, texture: sel.texture, exact: sel.exact }); }

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
function setTexture(name) {
  if (!TEXTURES.includes(name)) name = 'matte';
  sel.texture = name;
  lip.texture = name;
  applyLook();
  $('fc-tex-name').textContent = name;
  $('fc-tex').setAttribute('aria-label', tr('fc.texture', { name }));
  save();
}
$('fc-tex').addEventListener('click', () => setTexture(TEXTURES[(TEXTURES.indexOf(sel.texture) + 1) % TEXTURES.length]));

// ---------- 그리기: 다이얼 (canvas) ----------
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
    const grad = ctx.createConicGradient(rad(G.ind - 180), G.cx, cy);
    for (let d = -180; d <= 180; d += 2) {
      const c = colorAt(d); // 색 띠는 고정 (손잡이가 움직인다)
      grad.addColorStop((d + 180) / 360, `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${alpha.toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(G.cx, cy, G.ro, 0, Math.PI * 2);
    ctx.arc(G.cx, cy, G.ri, 0, Math.PI * 2, true);
    ctx.fill();
    for (let k = -4; k <= 4; k++) {
      const a = G.dot.a[Math.abs(k)] * alpha;
      const t = rad(G.ind + k * G.dot.step);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(G.cx + G.dot.r * Math.cos(t), cy + G.dot.r * Math.sin(t), G.dot.d / 2, 0, Math.PI * 2);
      ctx.fill();
    }
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
  Object.assign(handle.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px', clipPath: `path('${d}')`,
    transformOrigin: `${G.cx - x0}px ${G.cy - y0}px` }); // 반원 중심을 축으로 돌려 띠를 따라 움직인다
  handle.querySelector('path').setAttribute('d', d);
})();
const HANDLE_HALF = 7; // 손잡이가 덮는 반원 각도의 절반 (손잡이를 잡았는지 판단)
function moveHandle() { handle.style.transform = `rotate(${sel.phi}deg)`; }
// 손잡이 안쪽 색: 원본처럼 손잡이 아래 띠 색(왼쪽·가운데·오른쪽)을 렌즈처럼 위아래로 늘려 채운다
function tintHandle() {
  const css = (d) => { const c = colorAt(sel.phi + d); return `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`; };
  handle.style.setProperty('--h1', css(-HANDLE.half));
  handle.style.setProperty('--h2', css(0));
  handle.style.setProperty('--h3', css(HANDLE.half));
}

// ---------- 색 동그라미 ----------
const swBox = $('fc-swatches');
const swatches = [0, 1, 2, 3].map((j) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fc-sw';
  b.addEventListener('click', () => onSwatch(j));
  swBox.append(b);
  return b;
});
// 오른쪽 끝(x 785~905)에서 어두워지며 사라지는 동그라미
function edgeFade(x, d) {
  const at = (p) => Math.max(0, Math.min(1, (905 - (x - d / 2 + d * p)) / 120));
  const s = [0, 0.25, 0.5, 0.75, 1].map((p) => `rgba(0,0,0,${at(p).toFixed(3)}) ${p * 100}%`).join(', ');
  return at(0) >= 1 && at(1) >= 1 ? 'none' : `linear-gradient(to right, ${s})`;
}
function placeSwatches() {
  const L = list();
  swatches.forEach((b, j) => {
    const k = j - sel.i;
    const hex = L[j];
    b.style.setProperty('--c', hex);
    b.setAttribute('aria-label', tr('fc.swatch', { hex }));
    b.setAttribute('aria-pressed', String(k === 0 && !sel.exact));
    b.classList.toggle('big', k === 0);
    const o = k === 0 ? 0 : ROW.off[Math.abs(k) - 1];
    const x = ROW.big.x + Math.sign(k) * (o ?? 600);
    const d = k === 0 ? ROW.big.d : ROW.d;
    const show = mode === 'arc' && o !== undefined && x - d / 2 < 900 && x + d / 2 > 0;
    Object.assign(b.style, { left: x - d / 2 + 'px', top: ROW.y - d / 2 + 'px', width: d + 'px', height: d + 'px' });
    b.style.setProperty('--bw', (k === 0 ? ROW.big.b : 0) + 'px');
    b.style.webkitMaskImage = b.style.maskImage = k === 0 ? 'none' : edgeFade(x, d);
    b.classList.toggle('off', !show);
    b.tabIndex = show ? 0 : -1;
  });
}
function onSwatch(j) {
  if (j === sel.i && !sel.exact) return; // 이미 고른 색
  sel.i = j;
  sel.exact = null;
  save();
  placeSwatches();
  toLips();
}

// ---------- 시트·다크 모드 버튼 ----------
const sheet = $('fc-sheet');
const sbtn = $('fc-sbtn');
const GRID_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="currentColor">'
  + [5, 24, 43].flatMap((y) => [5, 24, 43].map((x) => `<circle cx="${x}" cy="${y}" r="4.9"/>`)).join('') + '</g></svg>';
sbtn.innerHTML = `<span class="fc-sbtn-logo">${markSvg()}</span><span class="fc-sbtn-grid">${GRID_SVG}</span>`;
sbtn.addEventListener('click', () => setMode(mode === 'arc' ? 'sheet' : 'arc'));
// 오른쪽 위 동그라미 = 다크 모드 (원본 11번: 다크면 흰 동그라미. 라이트면 테두리만)
const themeBtn = $('fc-theme');
const isDark = () => document.documentElement.dataset.theme === 'dark';
function syncTheme() { themeBtn.setAttribute('aria-pressed', String(isDark())); }
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('took.theme', next); } catch { /* 저장 불가 환경: 이 화면에서만 */ }
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  syncTheme();
});
syncTheme();
$('fc-lang').replaceWith(Object.assign(langToggle('fc-lang'), { id: 'fc-lang' }));
// 챗봇 플로팅 버튼: 누르면 지금 화면 위에 챗봇 모달. 담은 제품 수는 오른쪽 위 숫자
const chatBtn = $('fc-chat');
const badge = $('fc-chat-badge');
chatBtn.addEventListener('click', () => openChat());
function syncPicks(e) {
  const n = getPicks().length;
  badge.textContent = n ? String(n) : '';
  chatBtn.setAttribute('aria-label', tr('fc.chat') + (n ? ` · ${tr('pick.count', { n })}` : ''));
  if (e?.detail?.count) badge.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
}
window.addEventListener('took:picks-change', syncPicks);
syncPicks();
// 내 톤 추천 컬러를 누르면(lip-look.js took:pick) 그 색을 그대로 입히고 다이얼도 가장 가까운 색으로 돌린다
window.addEventListener('took:pick', (e) => {
  const hex = e.detail?.hex;
  if (!hex) return;
  slideTo(nearestDeg(hex));
  setTimeout(() => {
    sel.exact = hex.toUpperCase();
    save();
    placeSwatches();
    window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex, finish: null, quiet: true, source: '내 톤 추천 컬러' } }));
  }, reduce ? 0 : 380);
});

// ---------- 상태 바꾸기 (4번 ↔ 시트 10·11번 ↔ 추천 결과) ----------
function setMode(m, { instant = false } = {}) {
  mode = ['sheet', 'recs'].includes(m) ? m : 'arc';
  stage.dataset.mode = mode;
  stage.dataset.dim = '1'; // 4·10·11번 모두 점 격자가 어두운 상태
  stage.classList.toggle('fc-instant', instant || reduce);
  if (instant || reduce) requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('fc-instant')));
  const to = mode === 'arc' ? 1 : 0;
  if (instant || reduce) { alpha = to; alphaAnim = null; } else alphaAnim = { from: alpha, to, start: performance.now(), ms: 380 };
  redraw();
  handle.classList.toggle('off', mode !== 'arc');
  placeSwatches();
  const [top, btnY] = SHEET_AT[mode];
  sheet.style.top = top + 'px';
  sbtn.style.top = btnY - 68 + 'px';
  sbtn.classList.toggle('logo', mode === 'arc');
  const open = mode !== 'arc';
  sbtn.setAttribute('aria-expanded', String(open));
  sbtn.setAttribute('aria-label', tr(open ? 'fc.sheetClose' : 'fc.sheet'));
  sheet.inert = !open;
  const [cx, cy] = CHAT_AT[mode];
  chatBtn.style.left = cx - 40 + 'px';
  chatBtn.style.top = cy - 40 + 'px';
  wheel.setAttribute('aria-valuetext', chosen());
}

// ---------- 손잡이 옮기기 ----------
// 색 띠(원)는 그대로 있고, 유리 손잡이(네모)가 손가락을 따라 반원 위를 미끄러진다 (2026-11-16 사용자 요청).
// 손잡이 아래 색이 기준 색. 손잡이를 잡고 끌면 그대로 따라오고, 띠의 다른 곳을 누르거나 끌기 시작하면 손잡이가 그곳으로 간다.
// 시트에 가려지지 않는 범위(손잡이 기준 ±LIMIT°) 안에서만 움직인다
const LIMIT = 46;
let drag = null;
let glide = 0; // 톡 누르기 움직임 (requestAnimationFrame id)
const angleOf = (p) => (Math.atan2(p.y - G.cy, p.x - G.cx) * 180) / Math.PI;
const relOf = (p) => ((angleOf(p) - G.ind + 540) % 360) - 180; // 위(손잡이 처음 자리) 기준 각도, 시계 방향 +
const clampH = (h) => Math.max(-LIMIT, Math.min(LIMIT, h));
function stopGlide() { cancelAnimationFrame(glide); glide = 0; }
stage.addEventListener('pointerdown', (e) => {
  if (drag || mode !== 'arc' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.target.closest('button, a')) return;
  const p = toStage(stage, e);
  if (p.y < DRAG_ZONE[0] || p.y > DRAG_ZONE[1]) return;
  e.preventDefault();
  stopGlide();
  const rel = relOf(p);
  // 손잡이 위를 잡았으면 잡은 자리 그대로 끈다 (손잡이가 손가락 쪽으로 튀지 않게)
  const onHandle = Math.abs(rel - sel.phi) <= HANDLE_HALF + 2;
  drag = { id: e.pointerId, offset: onHandle ? sel.phi - rel : 0, moved: 0, last: rel };
  if (!onHandle) slideTo(rel, 220); // 다른 곳을 누르면 손잡이가 그리로 미끄러져 온다
  stage.classList.add('fc-dragging');
  try { stage.setPointerCapture(e.pointerId); } catch { /* 보정 터치(가짜 포인터) */ }
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const rel = relOf(toStage(stage, e));
  drag.moved += Math.abs(rel - drag.last);
  drag.last = rel;
  if (drag.moved < 0.8) return; // 손 떨림은 무시
  stopGlide();
  setHandle(rel + drag.offset);
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  drag = null;
  stage.classList.remove('fc-dragging');
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
// 손잡이를 h 도 자리로 ms 동안 부드럽게 옮긴다 (누르기·키보드·추천 컬러)
function slideTo(h, ms = 320) {
  stopGlide();
  const from = sel.phi;
  const to = clampH(h);
  if (reduce || !ms) { setHandle(to); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    setHandle(from + (to - from) * (1 - (1 - k) ** 3));
    glide = k < 1 ? requestAnimationFrame(step) : 0;
  };
  glide = requestAnimationFrame(step);
}
// 손잡이를 h 도 자리에 둔다. 기준 색이 바뀌면 같은 단계의 동그라미 색으로 입술에
function setHandle(h) {
  h = clampH(h);
  if (h === sel.phi && sel.base === rgbToHex(colorAt(h))) return;
  sel.phi = h;
  sel.base = rgbToHex(colorAt(h));
  sel.exact = null;
  save();
  moveHandle();
  tintHandle();
  placeSwatches();
  wheel.setAttribute('aria-valuetext', chosen());
  toLips();
}
// 키보드: 다이얼에 초점이 있으면 ←→ 로 돌린다
wheel.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); slideTo(sel.phi - 5, 160); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); slideTo(sel.phi + 5, 160); }
});

// ---------- 카메라 ----------
// 카메라 켜기·보이기·안내는 이전 버전처럼 lip.js(lip-camera.js)만 맡는다 (2026-11-16: 이 화면이 따로 감시해 숨기던 코드는 뺐다).
// 영상이 보이면 점 격자는 CSS(.fc-oval:has(#view:not(.hidden)))가 감춘다

// ---------- 로고: 처음으로 (초기화 → 홈 1번 마크 화면부터: 터치 → TOOK 로고 → 시작 버튼) ----------
const logo = $('nav-reset'); // 로고 그림은 palette.html 에 바로 들어 있다 (첫 화면부터 보이게)
logo.addEventListener('click', (e) => {
  e.preventDefault();
  store.clear();
  location.href = 'index.html';
});

// ---------- 제품 찾기 ----------
const recList = $('rec-list');
const recStatus = $('rec-status');
const recDots = $('fc-rec-dots');
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
$('find').addEventListener('click', async () => {
  const hex = chosen();
  setMode('recs');
  recStatus.textContent = tr('fc.searching');
  recDots.replaceChildren();
  recList.replaceChildren(...skeletonCards(4));
  const { ok, body } = await api('api/recommend?' + new URLSearchParams({ hex, limit: RECOMMEND_COUNT }));
  if (!ok) {
    recStatus.textContent = body.error || tr('lip.recFail');
    recList.replaceChildren();
    return;
  }
  recStatus.textContent = body.products.length ? tr('fc.found', { n: body.products.length }) : tr('fc.none');
  showDots(body.products);
  recList.scrollTop = 0;
  recList.replaceChildren(...body.products.map((product) => tryOnCard(product, tryProduct)));
});
// 추천 카드: '입술에 발라보기' · '챗봇에 담기' (담은 제품은 오른쪽 아래 챗봇 버튼으로 이어서 물어본다)
// '입술에 발라보기': 그 제품 색·제형을 그대로 입힌다
function tryProduct(p) {
  sel.exact = p.color_hex;
  if (p.finish) setTexture(p.finish === 'velvet' ? 'matte' : p.finish); // 제품 제형 → 가장 가까운 텍스처
  save();
  placeSwatches();
  window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex: p.color_hex, finish: p.finish, quiet: false, source: shortName(p) } }));
}

// ---------- NFC 태그: 립 제품을 리더기에 올리면 그 제품 색을 바로 입술에 바르고 시트에 제품 카드 ----------
const nfcFlash = createNfcHint($('nfc-hint'), { ms: 3000 });
async function showNfcProduct(id) {
  const found = id ? await api('api/products/' + encodeURIComponent(id)) : null;
  const p = found?.ok ? found.body.product : null;
  if (!p?.color_hex) { nfcFlash(tr('pal.nfcUnknown')); return; }
  sel.base = p.color_hex.toUpperCase();
  sel.i = 0;
  sel.phi = nearestDeg(sel.base);
  moveHandle();
  tintHandle();
  redraw();
  tryProduct(p);
  nfcFlash(tr('pal.nfcApplied', { name: shortName(p) }));
  setMode('recs');
  recStatus.textContent = tr('pal.nfcRead');
  showDots([p]);
  recList.replaceChildren(tryOnCard(p, tryProduct));
}
listenNfc((code) => showNfcProduct(resolveTag(code)));

// ---------- 시작 ----------
lip.texture = sel.texture;
setTexture(sel.texture);
moveHandle();
tintHandle();
setMode(new URLSearchParams(location.search).get('mode'), { instant: true }); // 화면 확인용 ?mode=sheet|recs
toLips();
window.tookFind = { setMode, setHandle, slideTo, sel };
