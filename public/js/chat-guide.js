// 챗봇 빠른 답장 (2026-11-19 사용자 선택 2·4·5·6·7번 중 4·5·6번): '답하며 고르기' 단계형 도우미.
// 챗봇 말풍선 안에 카드 하나가 단계마다 바뀐다. 고른 답은 문장 하나로 만들어 평소처럼 챗봇에게 보낸다(규칙 챗봇이 실제 데이터에서 찾는다).
//  1) 어디에 바르세요?   알약 버튼 (데일리·면접·데이트·결혼식 하객·사진 촬영·상관없어요)
//  2) 원하는 질감은요?   카드형(4번): 지금 색으로 칠한 질감 동그라미 + 이름 + 한 줄 설명 (매트·벨벳·새틴·글로시) + 상관없어요
//  3) 얼마나 진하게요?   슬라이더(5번): 연하게 · 자연스럽게 · 진하게
//  4) 가격대는요?        가격 슬라이더: 5,000~30,000원 사이 어디든(500원 단위) · 끝은 상관없어요 → '이 조건으로 찾기'
// 예: "면접 때 바를 연한 매트 립 2만원 이하로 추천해 줘" (한/영 문장 모두 src/lib/chat.js 로 결과가 나오는 것을 확인했다).
// 진하기는 기준 색이 없으면 그것만으로는 찾지 못해서, 자리·질감·가격을 모두 '상관없어요'로 두면 '데일리'를 같이 넣는다.
// 진행 상태는 그 말풍선(state.messages 의 kind:'guide')에 저장해 화면을 옮겨도 이어진다. 마지막 말풍선일 때만 누를 수 있다.
import { el } from './common.js';
import { C, state, save, track } from './chat-state.js';
import { send } from './chat.js';

const PLACES = [
  { k: 'daily', label: () => C('데일리', 'Everyday'), ko: '데일리로 바를', en: 'for every day' },
  { k: 'interview', label: () => C('면접', 'Interview'), ko: '면접 때 바를', en: 'for a job interview' },
  { k: 'date', label: () => C('데이트', 'Date'), ko: '데이트 때 바를', en: 'for a date' },
  { k: 'wedding', label: () => C('결혼식 하객', 'Wedding guest'), ko: '결혼식 하객으로 바를', en: 'as a wedding guest' },
  { k: 'photo', label: () => C('사진 촬영', 'Photos'), ko: '사진 찍을 때 바를', en: 'for photos' },
  { k: 'any', label: () => C('상관없어요', 'Any'), ko: '', en: '' },
];
const FINISHES = [
  { k: 'matte', label: () => C('매트', 'Matte'), desc: () => C('보송하고 차분하게', 'Soft and powdery'), ko: '매트', en: 'matte' },
  { k: 'velvet', label: () => C('벨벳', 'Velvet'), desc: () => C('부드럽고 보송하게', 'Smooth and soft'), ko: '벨벳', en: 'velvet' },
  { k: 'satin', label: () => C('새틴', 'Satin'), desc: () => C('은은한 윤기', 'A subtle sheen'), ko: '새틴', en: 'satin' },
  { k: 'glossy', label: () => C('글로시', 'Glossy'), desc: () => C('촉촉한 광택', 'Wet shine'), ko: '글로시', en: 'glossy' },
];
const DEPTHS = [
  { label: () => C('연하게', 'Light'), ko: '연한', en: 'light' },
  { label: () => C('자연스럽게', 'Natural'), ko: '자연스러운', en: 'natural' },
  { label: () => C('진하게', 'Deep'), ko: '진한', en: 'deep' },
];
// 진하기 (2026-11-19 사용자 요청: 세 칸 중 하나가 아니라 사이값 어디든): 0(가장 연하게)~100(가장 진하게).
// 고른 값은 답 a.depthV 에 둔다(예전 칸 번호 a.depth 도 읽는다). 챗봇에는 "연한(진하기 20)"처럼 보내고,
// 규칙 챗봇(src/lib/chat-parse.js)이 숫자를 읽어 후보 제품 가운데 그만큼의 명도(L*)에 가까운 것을 고른다
const depthZone = (v) => DEPTHS[v <= 33 ? 0 : v < 67 ? 1 : 2];
const depthOf = (a) => (a.depthV !== undefined ? a.depthV : a.depth !== undefined ? [15, 50, 85][a.depth] ?? 50 : undefined);
const depthLabel = (v) => `${depthZone(v).label()} · ${v}`; // 화면 읽기 프로그램용 (진하기 바 위 큰 글자는 2026-11-19 사용자 요청으로 뺐다)
// 가격대 (2026-11-19 사용자 요청: 사이값 어디든 → 쇼핑몰 가격 필터처럼 최소~최대 범위): 5,000~30,000원을 500원 단위로.
// 왼쪽 끝(5,000원) = 하한 없음, 오른쪽 끝 구간 = 상한 없음(상관없어요). 고른 범위는 답 a.priceRange = [최소, 최대](원, 0 = 없음).
// 챗봇에는 "10,000원 이상 20,000원 이하로"처럼 보낸다(src/lib/chat-parse.js 가 금액을 그대로 읽는다)
const PRICE_MIN = 5000;
const PRICE_MAX = 30000;
const PRICE_STEP = 500;
const PRICE_ANY_AT = PRICE_MAX + 5000; // 이 끝 구간 = 상관없어요
const PRICE_TICKS = [10000, 20000, 30000];
const won = (v) => v.toLocaleString('en-US');
/** 저장된 가격 답 → 원 (0 = 상관없어요). 예전에 저장된 칸 번호(0~3)도 읽는다 */
function priceWon(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (v < 100) return [10000, 20000, 30000, 0][v] ?? fallback;
  return v;
}
/** 저장된 답 → [최소, 최대]. 예전 답(a.price = 최대 금액 하나)도 읽는다 */
function priceRangeOf(a, fallback) {
  if (Array.isArray(a.priceRange)) return a.priceRange;
  if (a.price !== undefined) return [0, priceWon(a.price, 0)];
  return fallback;
}
function priceRangeLabel(lo, hi) {
  if (!lo && !hi) return C('상관없어요', 'Any price');
  if (!lo) return C(`${won(hi)}원 이하`, `Under ₩${won(hi)}`);
  if (!hi) return C(`${won(lo)}원 이상`, `From ₩${won(lo)}`);
  return C(`${won(lo)} ~ ${won(hi)}원`, `₩${won(lo)} – ₩${won(hi)}`);
}
function priceRangeWords(lo, hi) {
  if (!lo && !hi) return { ko: '', en: '' };
  if (!lo) return { ko: `${won(hi)}원 이하로`, en: `under ${won(hi)} won` };
  if (!hi) return { ko: `${won(lo)}원 이상으로`, en: `from ${won(lo)} won` };
  return { ko: `${won(lo)}원 이상 ${won(hi)}원 이하로`, en: `from ${won(lo)} won up to ${won(hi)} won` };
}
const STEPS = 4;
const QUESTIONS = [
  () => C('어디에 바르세요?', 'Where will you wear it?'),
  () => C('원하는 질감은요?', 'Which finish do you like?'),
  () => C('얼마나 진한 색이 좋아요?', 'How deep a color?'),
  () => C('가격대는요?', 'What price range?'),
];
const LIP = '#c94a63'; // 거울에서 고른 색이 없을 때 질감 동그라미·진하기 바에 쓰는 기본 립 색 (실제 색)

/** 단계형 도우미 시작: 챗봇 말풍선 하나를 대화 끝에 더한다 */
export function startGuide(rerender) {
  track('quick_guide');
  state.messages.push({
    role: 'bot', kind: 'guide',
    text: C('몇 가지만 고르면 어울리는 립을 찾아 드릴게요.', "Pick a few things and I'll find lips that suit you."),
    guide: { step: 0, a: {}, done: false },
  });
  save();
  rerender();
}

// ---------- 한 단계만 (빠른 답장 '질감 바꾸기'·'가격대 바꾸기', 2026-11-19 js/chat-quick.js) ----------
// 지금 추천 목록에 이어서 묻는다: "글로시로 바꿔 줘" / "2만원 이하로" (규칙 챗봇이 앞 조건을 이어 받는다)
const SWITCH_KO = { matte: '매트로 바꿔 줘', velvet: '벨벳으로 바꿔 줘', satin: '새틴으로 바꿔 줘', glossy: '글로시로 바꿔 줘' };
export function startMini(which, rerender) {
  track('quick_pick');
  state.messages.push({
    role: 'bot', kind: 'guide',
    text: which === 'finish' ? C('어떤 질감으로 바꿔 볼까요?', 'Which finish would you like?') : C('가격대를 골라 주세요.', 'Pick a price range.'),
    guide: { step: which === 'finish' ? 1 : 3, a: {}, done: false, only: which },
  });
  save();
  rerender();
}
function miniQuery(g) {
  if (g.only === 'finish') {
    const f = FINISHES.find((x) => x.k === g.a.finish);
    return f ? C(SWITCH_KO[f.k], `Switch to ${f.en}`) : '';
  }
  const p = priceRangeWords(...priceRangeOf(g.a, [0, 20000])); // 한 단계만에서는 오른쪽 끝(상관없어요)이 없어 최대 금액이 늘 있다
  return C(p.ko, p.en.replace(/^under/, 'Under'));
}

/** 고른 답 → 챗봇에게 보낼 문장 */
export function guideQuery(a) {
  const place = PLACES.find((p) => p.k === a.place) || PLACES.at(-1);
  const fin = FINISHES.find((f) => f.k === a.finish);
  const dv = depthOf(a);
  const zone = dv === undefined ? DEPTHS[1] : depthZone(dv);
  const price = priceRangeWords(...priceRangeOf(a, [0, 0]));
  // 진하기 숫자는 챗봇이 기준 색 없이도 읽는다 (예전엔 진하기만 남으면 데일리를 같이 보냈다)
  if (C('ko', 'en') === 'en') {
    const words = [dv === undefined ? zone.en : `${zone.en} (depth ${dv})`, fin?.en, 'lip'].filter(Boolean).join(' ');
    return ['Recommend a', words, place.en, price.en].filter(Boolean).join(' ');
  }
  return [place.ko, dv === undefined ? zone.ko : `${zone.ko}(진하기 ${dv})`, fin?.ko, '립', price.ko, '추천해 줘'].filter(Boolean).join(' ');
}

function summary(a) {
  const out = [];
  if (a.place) out.push(PLACES.find((p) => p.k === a.place)?.label());
  if (a.finish) out.push(FINISHES.find((f) => f.k === a.finish)?.label() || C('질감 상관없음', 'Any finish'));
  if (depthOf(a) !== undefined) out.push(depthZone(depthOf(a)).label());
  if (a.priceRange || a.price !== undefined) out.push(priceRangeLabel(...priceRangeOf(a, [0, 0])));
  return out.filter(Boolean);
}

/** 질감 동그라미: 지금 색으로 칠하고 질감마다 빛을 다르게 (CSS .gd-tex[data-f]) */
function texDot(f, hex) {
  const d = el('span', { class: 'gd-tex', 'data-f': f, 'aria-hidden': 'true' });
  d.style.setProperty('--c', hex);
  return d;
}

/** 슬라이더 (진하기·가격). 칸에 붙지 않고 손을 뗀 자리 그대로 고른다 (2026-11-19 사용자 요청 "사이값 어디든").
 *  아래 이름(marks)을 누르면 그 값까지 스르륵 움직인다. 화살표 키는 keyStep 씩.
 *  anyFrom: 이 값보다 크면 '상관없어요'(가격) — 그 구간에서 손을 떼면 맨 끝으로 붙고 고른 값은 0 */
function freeSlider({ min, max, step, value, marks, label, track: trackBg, keyStep, anyFrom, cta, onPick, cls = '', hideNow = false }) {
  const now = el('strong', { class: 'gd-now' });
  const range = el('input', { type: 'range', class: 'gd-range', min: String(min), max: String(max), step: String(step), value: String(value) });
  range.style.setProperty('--track', trackBg);
  let goal = null; // 스르륵 움직이는 중이면 도착할 값 (그 사이 버튼을 눌러도 중간값이 아니라 이 값을 고른다)
  const asPick = (v) => (anyFrom !== undefined && v > anyFrom ? 0 : v);
  const pick = () => asPick(goal ?? Number(range.value));
  const shown = () => asPick(Number(range.value)); // 화면 글자는 손잡이가 지금 있는 값
  const at = () => { const v = shown(); return anyFrom !== undefined && v === 0 ? max : v; };
  // 이름은 손잡이 가운데가 그 값에 올 때의 자리에 (손잡이 42px: 바 양 끝에서 21px 안쪽부터)
  const ticks = marks.map((m) => {
    const b = el('button', { type: 'button', tabindex: '-1', text: m.label, onclick: () => glide(m.v, 280) });
    const k = (m.v - min) / (max - min);
    b.style.left = `calc(${k * 100}% + ${21 - 42 * k}px)`;
    if (k === 0) b.classList.add('start');
    if (k === 1) b.classList.add('end');
    return b;
  });
  const show = () => {
    const text = label(shown());
    if (now.textContent !== text) now.textContent = text;
    ticks.forEach((t, i) => t.classList.toggle('on', marks[i].on ? marks[i].on(shown()) : marks[i].v === at()));
    range.setAttribute('aria-valuetext', text);
  };
  let anim = 0;
  function glide(to, ms = 200) {
    cancelAnimationFrame(anim);
    goal = null;
    const from = Number(range.value);
    if (from === to) return show();
    goal = to;
    const t0 = performance.now();
    const ease = (t) => 1 - (1 - t) ** 3; // 끝에서 천천히 멈춘다
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      range.value = String(from + (to - from) * ease(k));
      if (k < 1) anim = requestAnimationFrame(tick);
      else goal = null;
      show();
    };
    anim = requestAnimationFrame(tick);
  }
  range.addEventListener('pointerdown', () => { cancelAnimationFrame(anim); goal = null; });
  range.addEventListener('input', show);
  if (anyFrom !== undefined) range.addEventListener('change', () => { if (Number(range.value) > anyFrom) glide(max); });
  range.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const v = Number(range.value);
    if (anyFrom !== undefined && (v > anyFrom || (v === anyFrom && d > 0))) { glide(d > 0 ? max : anyFrom, 160); return; }
    glide(Math.max(min, Math.min(anyFrom ?? max, v + d * keyStep)), 160);
  });
  show();
  return el('div', { class: 'gd-slider gd-free ' + cls }, hideNow ? null : now, range,
    el('div', { class: 'gd-ticks', 'aria-hidden': 'true' }, ...ticks),
    el('button', { type: 'button', class: 'gd-cta', text: cta, onclick: () => onPick(pick()) }));
}

/** 가격대 = 쇼핑몰 가격 필터처럼 손잡이 두 개로 범위를 고른다 (2026-11-19 사용자 요청 "price range 느낌").
 *  왼쪽 손잡이 = 최소 금액(맨 왼쪽 5,000원 = 하한 없음), 오른쪽 손잡이 = 최대 금액(withAny 면 맨 오른쪽 끝 = 상한 없음).
 *  두 손잡이 사이는 1,000원 이상 벌어진다. 아래 1만·2만·3만(·상관없음)을 누르면 더 가까운 손잡이가 그 값으로 스르륵 */
function priceRangeSlider({ value: [lo0, hi0], withAny, onPick, cta }) {
  const max = withAny ? PRICE_ANY_AT : PRICE_MAX;
  const GAP = 1000;
  const now = el('strong', { class: 'gd-now' });
  const mk = (cls, v, aria) => el('input', { type: 'range', class: 'gd-range ' + cls, min: String(PRICE_MIN), max: String(max), step: String(PRICE_STEP), value: String(v), 'aria-label': aria });
  const lo = mk('gd-pr-lo', lo0 ? Math.max(PRICE_MIN, Math.min(PRICE_MAX - GAP, lo0)) : PRICE_MIN, C('최소 금액', 'Minimum price'));
  const hi = mk('gd-pr-hi', hi0 ? Math.max(PRICE_MIN + GAP, Math.min(PRICE_MAX, hi0)) : max, C('최대 금액', 'Maximum price'));
  const fill = el('i', { class: 'gd-pr-fill', 'aria-hidden': 'true' });
  const pos = (v) => { const k = (v - PRICE_MIN) / (max - PRICE_MIN); return `calc(${k * 100}% + ${21 - 42 * k}px)`; }; // 손잡이(42px) 가운데 자리
  const goal = new Map(); // 스르륵 움직이는 중이면 도착할 값 (그 사이 버튼을 눌러도 이 값을 고른다)
  const val = (r, live = false) => (live ? Number(r.value) : goal.get(r) ?? Number(r.value));
  // 고른 범위 [최소, 최대] (원, 0 = 그쪽 끝 없음)
  const rangeOf = (live = false) => {
    const a = val(lo, live);
    const b = val(hi, live);
    return [a <= PRICE_MIN ? 0 : a, withAny && b > PRICE_MAX ? 0 : b];
  };
  const marks = [...PRICE_TICKS.map((v) => ({ v, label: C(`${v / 10000}만원`, `₩${v / 1000}k`) })), ...(withAny ? [{ v: max, label: C('상관없음', 'Any') }] : [])]; // 바 아래 이름은 짧게
  const ticks = marks.map((m) => {
    const b = el('button', { type: 'button', tabindex: '-1', text: m.label, onclick: () => tapMark(m.v) });
    b.style.left = pos(m.v);
    if (m.v === max) b.classList.add('end');
    return b;
  });
  const show = () => {
    const [a, b] = rangeOf(true);
    const text = priceRangeLabel(a, b);
    if (now.textContent !== text) now.textContent = text;
    fill.style.left = pos(Number(lo.value));
    fill.style.right = `calc(100% - ${pos(Number(hi.value))})`;
    ticks.forEach((t, i) => t.classList.toggle('on', Number(lo.value) <= marks[i].v && marks[i].v <= Number(hi.value)));
    lo.setAttribute('aria-valuetext', a ? `${won(a)}원` : C('하한 없음', 'No minimum'));
    hi.setAttribute('aria-valuetext', b ? `${won(b)}원` : C('상한 없음', 'No maximum'));
  };
  // 손잡이끼리 넘지 않게 (끌던 쪽을 멈춘다). 3만원을 넘긴 오른쪽 손잡이는 손을 떼면 끝(상관없음)으로
  lo.addEventListener('input', () => { if (Number(lo.value) > Number(hi.value) - GAP) lo.value = String(Number(hi.value) - GAP); show(); });
  hi.addEventListener('input', () => { if (Number(hi.value) < Number(lo.value) + GAP) hi.value = String(Number(lo.value) + GAP); show(); });
  if (withAny) hi.addEventListener('change', () => { if (Number(hi.value) > PRICE_MAX) glide(hi, max); });
  // 겹쳐 있을 때 누른 쪽이 위로
  for (const r of [lo, hi]) r.addEventListener('pointerdown', () => { lo.style.zIndex = r === lo ? '3' : '2'; hi.style.zIndex = r === hi ? '3' : '2'; goal.delete(r); });
  const anim = new Map();
  function glide(r, to, ms = 280) {
    cancelAnimationFrame(anim.get(r));
    goal.delete(r);
    const from = Number(r.value);
    if (from === to) return show();
    goal.set(r, to);
    const t0 = performance.now();
    const ease = (t) => 1 - (1 - t) ** 3;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      r.value = String(from + (to - from) * ease(k));
      if (k < 1) anim.set(r, requestAnimationFrame(tick));
      else goal.delete(r);
      show();
    };
    anim.set(r, requestAnimationFrame(tick));
  }
  // 이름을 누르면 더 가까운 손잡이를 (같은 거리면 오른쪽) 그 값으로. 반대쪽 손잡이를 넘으면 그 앞에서 멈춘다
  function tapMark(v) {
    const a = val(lo);
    const b = val(hi);
    if (v === max || Math.abs(v - b) <= Math.abs(v - a)) glide(hi, Math.max(v, a + GAP));
    else glide(lo, Math.min(v, b - GAP));
  }
  show();
  return el('div', { class: 'gd-slider gd-free gd-prange' }, now,
    el('div', { class: 'gd-pr' }, el('i', { class: 'gd-pr-bar', 'aria-hidden': 'true' }), fill, lo, hi),
    el('div', { class: 'gd-ticks', 'aria-hidden': 'true' }, ...ticks),
    el('button', { type: 'button', class: 'gd-cta', text: cta, onclick: () => onPick(rangeOf()) }));
}

/** 단계형 카드 (말풍선 안). live = 마지막 말풍선이라 누를 수 있다 */
export function guideCard(m, live, rerender) {
  const g = m.guide;
  const hex = state.selectedHex || LIP;
  const picked = summary(g.a);
  const go = (patch, next) => {
    Object.assign(g.a, patch);
    if (g.only) { // 한 단계만: 고르면 바로 보낸다
      g.done = true;
      save();
      const q = miniQuery(g);
      if (q) send(q); else rerender();
      return;
    }
    g.step = next;
    save();
    if (next >= STEPS) {
      g.done = true;
      save();
      send(guideQuery(g.a));
      return;
    }
    rerender();
  };
  if (g.done || !live) {
    return el('div', { class: 'gd gd-off' },
      el('div', { class: 'gd-picked' }, ...(picked.length ? picked : [C('고르다 멈췄어요', 'Stopped midway')]).map((t) => el('span', { text: t }))));
  }
  const step = g.step;
  let body;
  if (step === 0) {
    body = el('div', { class: 'gd-pills' }, ...PLACES.map((p) => el('button', { type: 'button', class: 'gd-pill' + (g.a.place === p.k ? ' on' : ''), text: p.label(),
      onclick: () => go({ place: p.k }, 1) })));
  } else if (step === 1) {
    body = el('div', {},
      el('div', { class: 'gd-cards' }, ...FINISHES.map((f) => el('button', { type: 'button', class: 'gd-card' + (g.a.finish === f.k ? ' on' : ''),
        onclick: () => go({ finish: f.k }, 2) }, texDot(f.k, hex), el('strong', { text: f.label() }), el('span', { text: f.desc() })))),
      g.only ? null : el('button', { type: 'button', class: 'gd-pill gd-any', text: C('상관없어요', 'Any'), onclick: () => go({ finish: 'any' }, 2) }));
  } else if (step === 2) {
    body = freeSlider({ min: 0, max: 100, step: 1, keyStep: 5, value: depthOf(g.a) ?? 50, cta: C('이 정도로', 'This much'), cls: 'gd-depth',
      marks: [0, 50, 100].map((v, i) => ({ v, label: DEPTHS[i].label(), on: (x) => depthZone(x) === DEPTHS[i] })), label: depthLabel, hideNow: true,
      track: `linear-gradient(90deg, color-mix(in srgb, ${hex} 35%, #fff), ${hex}, color-mix(in srgb, ${hex} 55%, #000))`,
      onPick: (v) => go({ depthV: v, depth: undefined }, 3) });
  } else {
    body = priceRangeSlider({ value: priceRangeOf(g.a, [0, g.only ? 20000 : 0]), withAny: !g.only, cta: g.only ? C('이 가격대로', 'This price') : C('이 조건으로 찾기', 'Find with these'),
      onPick: (r) => go({ priceRange: r, price: undefined }, 4) });
  }
  // 한 단계만(빠른 답장): 진행 표시·이전 없이 고르는 칸만
  if (g.only) return el('div', { class: 'gd gd-mini', role: 'group', 'aria-label': QUESTIONS[step]() }, body);
  return el('div', { class: 'gd', role: 'group', 'aria-label': QUESTIONS[step]() },
    el('div', { class: 'gd-head' },
      el('strong', { class: 'gd-q', text: QUESTIONS[step]() }),
      el('span', { class: 'gd-step', text: `${step + 1}/${STEPS}` })),
    el('div', { class: 'gd-dots', 'aria-hidden': 'true' }, ...Array.from({ length: STEPS }, (_, i) => el('i', { class: i <= step ? 'on' : '' }))),
    picked.length ? el('div', { class: 'gd-picked' }, ...picked.map((t) => el('span', { text: t }))) : null,
    body,
    step > 0 ? el('button', { type: 'button', class: 'gd-prev', text: C('← 이전', '← Back'), onclick: () => { g.step -= 1; save(); rerender(); } }) : null);
}
