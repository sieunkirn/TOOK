// 팔레트 = Find Your Color (TOOK_prototype 4번 화면)
// 900×1440 무대(ui-stage.js)에 원본 PNG 좌표 그대로 그린다. 상태(#stage data-mode):
//   arc   4번  색 계열 동그라미 5개 + 아래 굵은 반원 농도 바 + 유리 손잡이, 흰 하단 시트 가운데 로고 버튼
//   recs  추천 결과: 로고 버튼을 누르면 시트가 화면 아래 절반(y 720~)까지 바로 올라와 지금 색과 비슷한 제품
//         (위에 추천 제품 색 동그라미 줄, 아래 제품 카드 2열 — 사용자 레퍼런스). 색이 바뀌면 목록도 바로 다시 찾는다
// (5~9번 링·접힌 다이얼, 10·11번 '농도·이 컬러로 제품 찾기' 시트는 2026-11-16 사용자 요청으로 뺐다)
// 색 고르기 (2026-11-16 디자이너 의견 + 사용자 요청): 동그라미 = 색 계열 4개(빨강·핑크·오렌지·누드, 보라는 뺐다), 바 = 고른 계열 안의 세세한 색
//       (왼쪽 연하게 ↔ 오른쪽 진하게). 색은 모두 립 DB(올리브영 립 제품)에 실제로 있는 예쁜 색 7개씩이고, 손잡이는 놓으면 가장 가까운 색 칸에 멈춘다
//       → 입술에 입히는 색·제품을 찾는 색이 늘 DB 에 있는 색. 동그라미 4개도 손잡이와 같은 칸의 색으로 바뀐다(계열을 바꿔도 진하기 그대로).
//       바(띠)는 고정, 유리 손잡이를 끌면 반원을 따라 움직인다. 띠의 다른 곳을 누르면 손잡이가 그 칸으로 미끄러져 온다.
// 얼굴 프레임: 네 모서리 괄호가 카메라에서 찾은 얼굴을 따라가 감싼다 (스마트미러의 얼굴 트래킹 표시). 얼굴이 없으면 제자리에서 숨 쉬듯 빛난다
// 예전 팔레트 기능도 이 디자인 안에: 내 톤으로 추천받기(타원 아래 알약 → 제목 아래 결과·추천 컬러 3개), 텍스처(matte 알약),
//       추천 카드 '입술에 발라보기'·'챗봇에 담기', 오른쪽 아래 챗봇 플로팅 버튼(모달), 언어(오른쪽 위)
// 카메라·입술 추적·색 입히기는 lip.js 그대로 (took:apply 이벤트로 색을 보낸다)
import { $, store, api, skeletonCards, tryOnCard, shortName } from './common.js';
import { t as tr, langToggle } from './i18n.js';
import { openChat } from './nav.js'; // 챗봇 모달
import { getPicks } from './chat-picks.js'; // '챗봇에 담기'로 담은 제품
import { listenNfc, resolveTag, createNfcHint } from './nfc.js'; // 제품 NFC 태그 → 그 제품 색을 입술에
import { hexToRgb } from '../lib/color.js';
import { state as lip } from './lip-state.js';
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
// 손잡이가 움직이는 범위: 위 기준 ±46° (시트에 가려지지 않는 곳). 왼쪽 끝 = 가장 연한 색, 가운데 = 대표 색, 오른쪽 끝 = 가장 진한 색
const LIMIT = 46;
// 계열별 7칸 (연함 → 진함). 모두 src/data/products.oliveyoung.json 의 실제 제품 color_hex 중 맑고 예쁜 색만 골랐다 (2026-11-16).
// 가운데 칸(4번째) = 처음 손잡이 자리 = 계열 대표 색
const FAMILIES = [
  { key: 'red', stops: ['#EB8283', '#E47270', '#E65157', '#DA3B52', '#BA2D3E', '#A52837', '#8A2D37'] },
  { key: 'pink', stops: ['#ECACBA', '#EBA1B4', '#E77492', '#D56287', '#CA3D71', '#AA3D55', '#95314B'] },
  { key: 'orange', stops: ['#EBA798', '#E2825C', '#E07667', '#E56A3B', '#D94D3A', '#B8483F', '#9A4F38'] },
  { key: 'nude', stops: ['#E9B1AE', '#DA9E95', '#DF918D', '#D6867E', '#C67867', '#B66A55', '#A0554A'] },
].map((f) => ({ ...f, rgb: f.stops.map(hexToRgb) }));
const STOPS = 7;
const STEP = (2 * LIMIT) / (STOPS - 1); // 칸 사이 각도
const stopOf = (deg) => Math.max(0, Math.min(STOPS - 1, Math.round((deg + LIMIT) / STEP))); // 손잡이 자리 → 가장 가까운 칸
const degOf = (i) => -LIMIT + i * STEP; // 칸 → 손잡이 자리
const mixRgb = (a, b, k) => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
/** 계열 fam 의 바 위 deg 자리에 그리는 색 (칸 사이는 부드럽게 이어 그린다. 범위 밖은 양 끝 색) */
function famAt(fam, deg) {
  const s = FAMILIES[fam].rgb;
  const t = Math.max(0, Math.min(1, (deg + LIMIT) / (2 * LIMIT))) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(t));
  return mixRgb(s[i], s[i + 1], t - i);
}
/** 계열 fam 의 deg 자리 칸 색 (DB 색 그대로) */
const famHex = (fam, deg) => FAMILIES[fam].stops[stopOf(deg)];
/** hex 와 가장 가까운 계열·칸 (NFC·내 톤 추천 색 쪽으로 옮길 때) */
function nearestPick(hex) {
  const c = hexToRgb(hex);
  let best = { fam: 1, deg: 0 };
  let bd = Infinity;
  FAMILIES.forEach((f, fam) => f.rgb.forEach((x, i) => {
    const e = (x.r - c.r) ** 2 + (x.g - c.g) ** 2 + (x.b - c.b) ** 2;
    if (e < bd) { bd = e; best = { fam, deg: degOf(i) }; }
  }));
  return best;
}

// ---------- 위치 (원본 04.png 좌표) ----------
const G = { cx: 449.5, cy: 1608.5, ro: 427.95, ri: 396.65, ind: -90, dot: { r: 363.5, d: 13, step: 9.27, a: [0.9, 0.86, 0.75, 0.56, 0.3] } };
const HANDLE = { cx: 449.5, cy: 1478, r1: 254.5, r2: 310.5, half: 9, rc: 10 }; // 유리 손잡이 = 다이얼보다 작은 원의 부채꼴
// 색 계열 동그라미 줄: 4개가 늘 제자리에 있고, 고른 계열만 크게 (원본 큰 동그라미 131·흰 테 3.5, 작은 동그라미 75)
const ROW = { y: 1005, x: [187.5, 362.5, 537.5, 712.5], big: { d: 131, b: 3.5 }, d: 75 };
const SHEET_AT = { arc: [1348.4, 1348.5], recs: [720, 720] }; // 하단 시트 윗변 · 가운데 버튼 중심
const WHEEL_TOP = 820; // 다이얼 canvas 가 덮는 범위 (y 820~1440)
const DRAG_ZONE = [1075, 1340]; // 이 높이 사이(색 동그라미 아래 ~ 시트 위) 어디서든 끌면 손잡이가 움직인다 (버튼 위는 제외)
const TEXTURES = ['matte', 'glossy', 'satin', 'sheer', 'shimmer']; // lip-engine.js TEXTURES 와 같은 이름
const CHAT_AT = { arc: [818, 1394], recs: [818, 672] }; // 챗봇 플로팅 버튼 가운데 (시트 위 오른쪽)

// ---------- 상태 ----------
const saved = store.get('fcSel') || {};
const savedFam = FAMILIES.findIndex((f) => f.key === saved.fam);
const sel = {
  fam: savedFam >= 0 ? savedFam : 1, // 고른 계열 (처음 = 핑크)
  phi: Number.isFinite(saved.phi) ? degOf(stopOf(saved.phi)) : 0, // 손잡이 자리 (위 기준 각도, 늘 칸 위. 손잡이 아래 칸 색 = 입술 색)
  texture: TEXTURES.includes(saved.texture) ? saved.texture : 'matte', // matte 알약을 누르면 바뀐다. 추천 제품을 발라 보면 그 제형
  exact: saved.exact || null, // NFC·추천 제품·내 톤 추천처럼 그대로 입힐 색
};
let mode = 'arc';
const dialHex = () => famHex(sel.fam, sel.phi);
const chosen = () => sel.exact || dialHex();
function save() { store.set('fcSel', { fam: FAMILIES[sel.fam].key, phi: sel.phi, texture: sel.texture, exact: sel.exact }); }

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

// ---------- 그리기: 농도 바 (canvas) ----------
const wheel = $('fc-wheel');
const ctx = wheel.getContext('2d');
const S = Math.min(3, Math.max(2, devicePixelRatio || 1)); // 키오스크 틀이 화면을 키우므로 2배 이상으로 그린다
wheel.width = 900 * S;
wheel.height = (1440 - WHEEL_TOP) * S;
const rad = (d) => (d * Math.PI) / 180;
let alpha = 1; // 시트가 열리면 0 으로 사라진다
let alphaAnim = null;
let fade = null; // 계열을 바꾸면 바 색이 이전 계열에서 부드럽게 바뀐다 { from, start, ms, k }
let rafId = 0;
/** 화면에 그리는 바 색 (계열이 바뀌는 중이면 섞어서) */
function shownAt(deg) {
  const c = famAt(sel.fam, deg);
  return fade ? mixRgb(famAt(fade.from, deg), c, fade.k) : c;
}
function frame(now) {
  rafId = 0;
  if (alphaAnim) {
    const k = Math.min(1, (now - alphaAnim.start) / alphaAnim.ms);
    alpha = alphaAnim.from + (alphaAnim.to - alphaAnim.from) * k;
    if (k >= 1) alphaAnim = null;
  }
  if (fade) {
    fade.k = Math.min(1, (now - fade.start) / fade.ms);
    if (fade.k >= 1) fade = null;
    tintHandle();
  }
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, 900, 1440 - WHEEL_TOP);
  if (alpha > 0.002) {
    const cy = G.cy - WHEEL_TOP;
    const grad = ctx.createConicGradient(rad(G.ind - 180), G.cx, cy);
    for (let d = -180; d <= 180; d += 2) {
      const c = shownAt(d); // 띠는 고정 (손잡이가 움직인다)
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
  if (alphaAnim || fade) rafId = requestAnimationFrame(frame);
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
  const css = (d) => { const c = shownAt(sel.phi + d); return `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`; };
  handle.style.setProperty('--h1', css(-HANDLE.half));
  handle.style.setProperty('--h2', css(0));
  handle.style.setProperty('--h3', css(HANDLE.half));
}

// ---------- 색 계열 동그라미 ----------
const swBox = $('fc-swatches');
const swatches = FAMILIES.map((_, j) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fc-sw';
  b.addEventListener('click', () => onSwatch(j));
  swBox.append(b);
  return b;
});
function placeSwatches() {
  const show = mode === 'arc';
  swatches.forEach((b, j) => {
    const on = j === sel.fam;
    const hex = on ? chosen() : famHex(j, sel.phi); // 모든 계열이 손잡이와 같은 칸(진하기)의 색
    const d = on ? ROW.big.d : ROW.d;
    b.style.setProperty('--c', hex);
    b.style.setProperty('--bw', (on ? ROW.big.b : 0) + 'px');
    Object.assign(b.style, { left: ROW.x[j] - d / 2 + 'px', top: ROW.y - d / 2 + 'px', width: d + 'px', height: d + 'px' });
    b.classList.toggle('big', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', tr('fc.family', { name: tr('fc.fam.' + FAMILIES[j].key), hex }));
    b.classList.toggle('off', !show);
    b.tabIndex = show ? 0 : -1;
  });
}
/** 계열 바꾸기 (손잡이 자리는 그대로 = 같은 진하기) */
function setFamily(j, animate = true) {
  if (j === sel.fam) return;
  fade = animate && !reduce ? { from: sel.fam, start: performance.now(), ms: 300, k: 0 } : null;
  sel.fam = j;
  tintHandle();
  redraw();
}
function onSwatch(j) {
  if (j === sel.fam && !sel.exact) return; // 이미 고른 계열
  setFamily(j);
  sel.exact = null;
  save();
  placeSwatches();
  wheel.setAttribute('aria-valuetext', chosen());
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
// 내 톤 추천 컬러를 누르면(lip-look.js took:pick) 그 색을 그대로 입히고 계열·손잡이도 가장 가까운 자리로 옮긴다
window.addEventListener('took:pick', (e) => {
  const hex = e.detail?.hex;
  if (!hex) return;
  const near = nearestPick(hex);
  setFamily(near.fam);
  slideTo(near.deg);
  setTimeout(() => {
    sel.exact = hex.toUpperCase();
    save();
    placeSwatches();
    window.dispatchEvent(new CustomEvent('took:apply', { detail: { hex, finish: null, quiet: true, source: '내 톤 추천 컬러' } }));
    colorChanged();
  }, reduce ? 0 : 380);
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
  if (open) queueRecs(0); // 로고 버튼을 누르면 바로 지금 색의 추천 제품
}

// ---------- 손잡이 옮기기 ----------
// 색 띠(원)는 그대로 있고, 유리 손잡이(네모)가 손가락을 따라 반원 위를 미끄러진다 (2026-11-16 사용자 요청).
// 손잡이를 잡고 끌면 그대로 따라오고, 띠의 다른 곳을 누르거나 끌기 시작하면 손잡이가 그곳으로 간다.
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
  if (!onHandle) slideTo(degOf(stopOf(rel)), 220); // 다른 곳을 누르면 손잡이가 그 칸으로 미끄러져 온다
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
  if (!glide) slideTo(degOf(stopOf(sel.phi)), 160); // 놓으면 가장 가까운 색 칸에 딱 멈춘다
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
// 손잡이를 h 도 자리에 둔다. 손잡이 아래 칸 색이 입술 색 (끄는 동안에는 칸이 바뀔 때만 색이 바뀐다)
function setHandle(h) {
  h = clampH(h);
  if (h === sel.phi && !sel.exact) return;
  const before = chosen();
  sel.phi = h;
  sel.exact = null;
  save();
  moveHandle();
  tintHandle();
  if (chosen() === before) return;
  placeSwatches();
  wheel.setAttribute('aria-valuetext', chosen());
  toLips();
  colorChanged();
}
// 키보드: 바에 초점이 있으면 ←→ 로 한 칸씩 진하기를 바꾼다
wheel.addEventListener('keydown', (e) => {
  const i = stopOf(sel.phi);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); slideTo(degOf(Math.max(0, i - 1)), 160); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); slideTo(degOf(Math.min(STOPS - 1, i + 1)), 160); }
});

// ---------- 카메라 ----------
// 카메라 켜기·보이기·안내는 이전 버전처럼 lip.js(lip-camera.js)만 맡는다 (2026-11-16: 이 화면이 따로 감시해 숨기던 코드는 뺐다)

// ---------- 얼굴 따라가는 프레임 (스마트미러 얼굴 트래킹 표시) ----------
// lip-tracker.js 가 찾은 얼굴 네모(원본 프레임 0~1)를 화면(#view, object-fit: cover) 위치로 옮겨 괄호 네 개를 그 둘레로 붙인다.
// 얼굴이 없으면 원본 4번 자리(HOME)로 천천히 돌아가 숨 쉬듯 빛난다 (CSS .fc-face:not(.fc-tracking))
const faceSec = document.querySelector('.fc-face');
const camArea = document.querySelector('.fc-camarea');
const viewEl = $('view');
const HOME = [248, 356, 654, 841]; // 괄호 네 개가 이루는 네모 = 카메라 칸 (x0, y0, x1, y1)
const MIN_BOX = [200, 236]; // 괄호(66×66)끼리 겹치지 않는 최소 크기
const brs = ['tl', 'tr', 'bl', 'br'].map((k) => faceSec.querySelector('.fc-br-' + k));
const fb = HOME.slice(); // 지금 괄호 네모
let lastGoal = null;
let lastSeen = 0;
// a0~a1 을 최소 길이 min 이상, lo~hi 안으로
function fitSpan(a0, a1, min, lo, hi) {
  if (a1 - a0 < min) { const c = (a0 + a1) / 2; a0 = c - min / 2; a1 = c + min / 2; }
  if (a1 - a0 >= hi - lo) return [lo, hi];
  if (a0 < lo) { a1 += lo - a0; a0 = lo; }
  if (a1 > hi) { a0 -= a1 - hi; a1 = hi; }
  return [a0, a1];
}
function faceGoal() {
  const b = lip.lips?.box;
  if (!b || viewEl.classList.contains('hidden') || !viewEl.width) return null;
  const f = sourceFrame();
  if (!f?.w) return null;
  const rot = ((Number(f.rotate) || 0) % 360 + 360) % 360;
  const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => mapPoint({ x, y }, !!f.mirror, rot));
  const W = camArea.offsetWidth;
  const H = camArea.offsetHeight;
  const cw = viewEl.width;
  const ch = viewEl.height;
  const s = Math.max(W / cw, H / ch);
  const ox = camArea.offsetLeft + (W - cw * s) / 2;
  const oy = camArea.offsetTop + (H - ch * s) / 2;
  const xs = pts.map((p) => ox + p.x * cw * s);
  const ys = pts.map((p) => oy + p.y * ch * s);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;
  x0 -= w * 0.14; x1 += w * 0.14; y0 -= h * 0.12; y1 += h * 0.08; // 얼굴 둘레에 여백
  [x0, x1] = fitSpan(x0, x1, MIN_BOX[0], HOME[0], HOME[2]);
  [y0, y1] = fitSpan(y0, y1, MIN_BOX[1], HOME[1], HOME[3]);
  return [x0, y0, x1, y1];
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
  const near = nearestPick(p.color_hex);
  setFamily(near.fam, false);
  sel.phi = near.deg;
  moveHandle();
  tintHandle();
  redraw();
  tryProduct(p);
  nfcFlash(tr('pal.nfcApplied', { name: shortName(p) }));
  clearTimeout(recTimer);
  recSeq++; // 찾는 중이던 추천은 버리고 이 제품 카드를 보여 준다
  want = shown = chosen();
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
setMode(new URLSearchParams(location.search).get('mode'), { instant: true }); // 화면 확인용 ?mode=recs
toLips();
window.tookFind = { setMode, setHandle, slideTo, onSwatch, sel, chosen, FAMILIES };
