// NFC 태그 창 (2026-11-18 사용자 요청 "창이 총 3개: 거울(팔레트) · 챗봇 · NFC 태깅").
// 거울(팔레트)이 바탕이고, 그 위에 뜨는 창이 둘: 챗봇(nav.js 모달)과 이 NFC 창. 왼쪽 세로 메뉴의 세 번째 버튼으로 연다.
// 창이 열려 있는 동안 리더기에 올린 립 제품(또는 거울 카메라에 비춘 바코드)을 이 창에서 보여 준다.
// 창이 닫혀 있을 때 태그하면 예전처럼 거울에서 바로 바른다 (palette.js).
//
// 흐름 (#nw data-state):
//   ready    대기: 립스틱이 리더기 위로 내려와 톡 닿고 물결이 퍼지는 그림이 되풀이된다. "Tag Your Lip" + 3단계 안내
//   product  읽은 제품: 읽는 순간 물결이 터지고, 가운데 원이 제품 색으로 번진다 → 제품 사진·브랜드·이름·호수·제형·가격
//            [거울에 발라보기] 창을 닫고 거울에서 그 색을 바른다 · [챗봇에게 물어보기] 챗봇 창에서 그 제품을 기준으로 대화
//   compare  나란히 비교: 아래 선반의 태그한 제품(최근 3개)을 나란히. 가장 저렴·가장 밝은/진한 색 표시, 각각 발라보기, 챗봇에서 비교 상담
//   unknown  등록되지 않은 태그: 회색 '?' 원이 흔들리고, 4초 뒤 이전 상태로 돌아간다 (제품을 지어내지 않는다)
// 선반은 sessionStorage(store 'nfcShelf')에 둔다 → 자동 초기화·처음으로 때 함께 지워진다.
// 색 원·제품 사진은 실제 색 (팔레트 화면 예외와 같음). 질감 모양은 팔레트 질감 동그라미(.fc-sw[data-tex])를 그대로 쓴다
import { store, api, el, won, shortName, shadeLabelOf } from './common.js';
import { t, setText, brandOf, nameOf, finishText } from './i18n.js';
import { findTagProduct } from './nfc.js';
import { REDUCE_MOTION as reduce } from './motion.js';
import { hexToLab } from '../lib/color.js';

const SHELF_MAX = 3;
const UNKNOWN_MS = 4000;
const SHELF_KEY = 'nfcShelf';

// 아이콘 (흰 선, 메뉴 아이콘과 같은 굵기)
export const NFC_ICON = '<svg viewBox="0 0 46.83 46.83" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">'
  + '<path d="M15.6 18.4Q18.6 23.4 15.6 28.4"/><path d="M21.2 14.6Q26.6 23.4 21.2 32.2"/><path d="M26.8 10.8Q34.6 23.4 26.8 36"/></g></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
// 서 있는 립스틱 (옆모습): 빗면 불릿 · 은색 목 · 유리 케이스. 바닥에 NFC 스티커가 붙어 있다고 본다
const STICK_SVG = '<svg class="nw-stick-svg" viewBox="0 0 100 260" aria-hidden="true" focusable="false"><defs>'
  + '<linearGradient id="nwBullet" x1="0" x2="1"><stop offset="0" stop-color="#ff8cc0"/><stop offset=".45" stop-color="#fc54a5"/><stop offset="1" stop-color="#a32c5e"/></linearGradient>'
  + '<linearGradient id="nwNeck" x1="0" x2="1"><stop offset="0" stop-color="#8d8d8d"/><stop offset=".35" stop-color="#f4f4f4"/><stop offset="1" stop-color="#6f6f6f"/></linearGradient>'
  + '<linearGradient id="nwCase" x1="0" x2="1"><stop offset="0" stop-color="#3a3a3a"/><stop offset=".3" stop-color="#1b1b1b"/><stop offset="1" stop-color="#060606"/></linearGradient></defs>'
  + '<path d="M31 30 Q31 26 35 24.5 L64 10 Q69 8 69 13 V86 H31 Z" fill="url(#nwBullet)"/>'
  + '<path d="M36 30 L60 18 V82 H36 Z" fill="#fff" opacity=".18"/>'
  + '<rect x="24" y="84" width="52" height="30" rx="3" fill="url(#nwNeck)"/>'
  + '<rect x="16" y="112" width="68" height="142" rx="9" fill="url(#nwCase)" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/>'
  + '<rect x="24" y="122" width="5" height="120" rx="2.5" fill="#fff" opacity=".28"/></svg>';

const shortFinish = (f) => (f === 'velvet' ? 'matte' : f); // 질감 동그라미 모양은 팔레트 다섯 가지 중 가장 가까운 것
const lightness = (p) => p.color_lab?.L ?? (p.color_hex ? hexToLab(p.color_hex).L : null);

/** 질감까지 그린 색 원 (팔레트 질감 동그라미 .fc-sw 와 같은 모양) */
function orb(p, cls) {
  const o = el('span', { class: 'fc-sw ' + cls, 'aria-hidden': 'true' });
  o.style.setProperty('--c', p.color_hex);
  o.style.setProperty('--on', '1');
  const tex = shortFinish(p.finish);
  if (tex) o.dataset.tex = tex;
  return o;
}

/**
 * NFC 창 만들기. stage = 팔레트 900×1440 무대.
 * onTry(p): 거울에 발라보기 · onAsk(p): 챗봇에게 물어보기 · onCompareChat(list): 챗봇에서 비교 상담 · onOpen(): 창이 열릴 때(챗봇 창 닫기)
 */
export function createNfcWindow({ stage, onTry, onAsk, onCompareChat, onOpen }) {
  let shelf = (store.get(SHELF_KEY) || []).filter((p) => p && p.id && p.color_hex).slice(-SHELF_MAX);
  let current = null; // 지금 크게 보이는 제품
  let state = 'ready';
  let back = 'ready'; // '등록되지 않은 태그' 뒤에 돌아갈 상태
  let unknownTimer = 0;
  let liveTimer = 0;
  let seq = 0; // 늦게 온 찾기 결과는 버린다

  // ---------- 틀 ----------
  const live = el('span', { class: 'nw-live' }, el('i', { 'aria-hidden': 'true' }), el('span', { class: 'nw-live-text', text: t('nw.live') }));
  const close = el('button', { type: 'button', class: 'nw-close', 'aria-label': t('nw.close'), title: t('nw.close'), onclick: () => api_.close() });
  close.innerHTML = CLOSE_SVG;
  const headIco = el('span', { class: 'nw-head-ico', 'aria-hidden': 'true' });
  headIco.innerHTML = NFC_ICON;
  const head = el('header', { class: 'nw-head' }, headIco, el('strong', { class: 'nw-name', id: 'nw-name', text: t('nw.title') }), live, close);

  // 대기 그림: 리더기(유리 원판) + 물결 3겹 + 내려와 닿는 립스틱
  const stick = el('div', { class: 'nw-stick', 'aria-hidden': 'true' });
  stick.innerHTML = STICK_SVG;
  const art = el('div', { class: 'nw-art', 'aria-hidden': 'true' },
    el('i', { class: 'nw-ring' }), el('i', { class: 'nw-ring' }), el('i', { class: 'nw-ring' }),
    el('div', { class: 'nw-disc' }, el('i', { class: 'nw-disc-glow' }), el('i', { class: 'nw-shadow' })),
    el('i', { class: 'nw-burst' }), stick);
  const intro = el('div', { class: 'nw-intro' },
    el('h2', { class: 'nw-hero', text: 'Tag Your Lip' }),
    el('p', { class: 'nw-hero-sub', text: t('nw.heroSub') }));
  const steps = el('ol', { class: 'nw-steps' }, ...['nw.step1', 'nw.step2', 'nw.step3'].map((k, i) =>
    el('li', {}, el('b', { text: String(i + 1) }), el('span', { text: t(k) }))));
  const barcodeHint = el('p', { class: 'nw-barhint', text: t('nw.barcodeHint') });

  // 읽은 제품
  const aura = el('div', { class: 'nw-aura', 'aria-hidden': 'true' });
  const prodArt = el('div', { class: 'nw-prod-art' });
  const info = el('section', { class: 'nw-info', 'aria-live': 'polite' });

  // 등록되지 않은 태그
  const unknown = el('div', { class: 'nw-unknown' },
    el('span', { class: 'nw-q', 'aria-hidden': 'true', text: '?' }),
    el('strong', { text: t('nw.unknown') }),
    el('p', { text: t('nw.unknownSub') }));

  // 나란히 비교
  const compare = el('section', { class: 'nw-compare', 'aria-label': t('nw.cmpTitle') });

  // 아래 선반: 태그한 제품 (최근 3개) + 나란히 비교 버튼
  const shelfRow = el('div', { class: 'nw-shelf-row' });
  const shelfCount = el('span', { class: 'nw-shelf-count' });
  const cmpBtn = el('button', { type: 'button', class: 'nw-cmp-btn', onclick: () => setState(state === 'compare' ? (current ? 'product' : 'ready') : 'compare') });
  const shelfHint = el('span', { class: 'nw-shelf-hint' });
  const shelfEl = el('footer', { class: 'nw-shelf' },
    el('div', { class: 'nw-shelf-head' }, el('strong', { text: t('nw.shelf') }), shelfCount, shelfHint),
    el('div', { class: 'nw-shelf-body' }, shelfRow, cmpBtn));

  const box = el('div', { class: 'nw-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nw-name' },
    head, aura, art, intro, steps, barcodeHint, prodArt, info, unknown, compare, shelfEl);
  const root = el('div', { class: 'nw', id: 'nw', hidden: '', 'data-state': 'ready' }, box);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) api_.close(); }); // 바깥(흐린 거울)을 누르면 닫는다
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) api_.close(); });
  stage.append(root);

  // ---------- 그리기 ----------
  function setState(s) {
    state = s;
    root.dataset.state = s;
    renderShelf();
    if (s === 'compare') renderCompare();
  }

  function renderProduct(p, { fresh = true } = {}) {
    current = p;
    aura.style.setProperty('--c', p.color_hex);
    const photo = p.image_url ? el('img', { class: 'nw-photo', src: p.image_url, alt: '', draggable: 'false', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null;
    prodArt.replaceChildren(...[el('span', { class: 'nw-eyebrow', text: t('nw.tagged') }), orb(p, 'nw-orb'), photo].filter(Boolean)); // replaceChildren 은 null 을 'null' 글자로 넣는다
    const shade = shadeLabelOf(p);
    const facts = [p.finish && finishText(p.finish), p.price && won(p.price), p.shade_count > 1 && t('nw.shades', { n: p.shade_count })].filter(Boolean);
    const shadeDot = el('i', { 'aria-hidden': 'true' });
    shadeDot.style.background = p.color_hex;
    info.replaceChildren(...[
      el('span', { class: 'nw-brand', text: brandOf(p) }),
      el('strong', { class: 'nw-pname', text: nameOf(p) }),
      shade ? el('span', { class: 'nw-shade' }, shadeDot, shade) : null,
      facts.length ? el('ul', { class: 'nw-facts' }, ...facts.map((f) => el('li', { text: f }))) : null,
      el('div', { class: 'nw-actions' },
        el('button', { type: 'button', class: 'nw-btn nw-btn-pink', onclick: () => { const x = current; api_.close({ quick: true }); onTry(x); } },
          el('span', { class: 'nw-btn-ico', 'aria-hidden': 'true', text: '✦' }), t('nw.try')),
        el('button', { type: 'button', class: 'nw-btn', onclick: () => { const x = current; api_.close({ quick: true }); onAsk(x); } }, t('nw.ask'))),
      el('p', { class: 'nw-more', text: t('nw.more') }),
    ].filter(Boolean));
    if (fresh && !reduce) { // 새로 읽을 때마다 색이 번지는 움직임을 다시
      box.classList.remove('nw-enter');
      void box.offsetWidth;
      box.classList.add('nw-enter');
    }
  }

  function renderShelf() {
    const chips = shelf.map((p) => {
      const dot = orb(p, 'nw-chip-dot');
      return el('button', { type: 'button', class: 'nw-chip', 'aria-pressed': String(state !== 'compare' && current?.id === p.id && sameShade(current, p)), 'aria-label': shortName(p),
        onclick: () => { clearTimeout(unknownTimer); renderProduct(p); setState('product'); } },
      dot, el('span', { class: 'nw-chip-text' }, el('small', { text: brandOf(p) }), el('span', { text: nameOf(p) })));
    });
    const empty = Array.from({ length: SHELF_MAX - shelf.length }, () => el('span', { class: 'nw-slot', 'aria-hidden': 'true' }, el('i')));
    shelfRow.replaceChildren(...chips, ...empty);
    shelfCount.textContent = `${shelf.length}/${SHELF_MAX}`;
    const can = shelf.length >= 2;
    cmpBtn.disabled = !can && state !== 'compare';
    setText(cmpBtn, t(state === 'compare' ? 'nw.compareClose' : 'nw.compare'));
    shelfHint.textContent = can ? '' : t('nw.shelfHint');
  }

  function renderCompare() {
    const list = shelf.slice();
    const prices = list.map((p) => p.price).filter((n) => n > 0);
    const minPrice = prices.length >= 2 && new Set(prices).size > 1 ? Math.min(...prices) : null;
    const ls = list.map(lightness);
    const known = ls.filter((x) => x !== null);
    const spread = known.length >= 2 && Math.max(...known) - Math.min(...known) >= 3; // 거의 같은 밝기면 표시하지 않는다
    const cards = list.map((p, i) => {
      const badges = [
        minPrice !== null && p.price === minPrice && t('nw.cheapest'),
        spread && ls[i] === Math.max(...known) && t('nw.lightest'),
        spread && ls[i] === Math.min(...known) && t('nw.deepest'),
      ].filter(Boolean);
      const shade = shadeLabelOf(p);
      return el('article', { class: 'nw-ccard', style: `--i:${i}` },
        orb(p, 'nw-corb'),
        el('div', { class: 'nw-badges' }, ...badges.map((b) => el('span', { text: b }))),
        el('span', { class: 'nw-cbrand', text: brandOf(p) }),
        el('strong', { class: 'nw-cname', text: nameOf(p) }),
        el('span', { class: 'nw-cshade', text: shade || '' }),
        el('dl', { class: 'nw-cfacts' },
          el('dt', { text: t('nw.finish') }), el('dd', { text: finishText(p.finish) }),
          el('dt', { text: t('nw.price') }), el('dd', { class: 'nw-cprice', text: p.price ? won(p.price) : '-' })),
        el('button', { type: 'button', class: 'nw-btn nw-btn-pink nw-ctry', onclick: () => { api_.close({ quick: true }); onTry(p); } }, t('nw.tryShort')));
    });
    compare.replaceChildren(
      el('h2', { class: 'nw-ctitle', text: t('nw.cmpTitle') }),
      el('p', { class: 'nw-csub', text: t('nw.cmpSub') }),
      el('div', { class: 'nw-cgrid', 'data-n': String(list.length) }, ...cards),
      el('button', { type: 'button', class: 'nw-btn nw-btn-pink nw-cchat', onclick: () => { api_.close({ quick: true }); onCompareChat(list); } }, t('nw.cmpChat')));
  }

  const sameShade = (a, b) => (a?.shade_id || a?.shade_no || '') === (b?.shade_id || b?.shade_no || '');

  function addToShelf(p) {
    shelf = shelf.filter((x) => !(x.id === p.id && sameShade(x, p)));
    shelf.push(p);
    shelf = shelf.slice(-SHELF_MAX);
    store.set(SHELF_KEY, shelf);
  }

  // 읽는 순간: 원판이 번쩍이고 물결이 한 번 크게 퍼진다. 머리의 대기 표시도 '읽었어요'
  function flashHit(ok) {
    if (!reduce) {
      root.classList.remove('nw-hit');
      void root.offsetWidth;
      root.classList.add('nw-hit');
    }
    live.classList.toggle('hit', ok);
    live.classList.toggle('miss', !ok);
    live.querySelector('.nw-live-text').textContent = t(ok ? 'nw.liveHit' : 'nw.liveMiss');
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      live.classList.remove('hit', 'miss');
      live.querySelector('.nw-live-text').textContent = t('nw.live');
    }, 2200);
  }

  // ---------- 밖에서 쓰는 것 ----------
  const api_ = {
    isOpen: () => !root.hidden,
    open() {
      if (!root.hidden) return;
      onOpen?.();
      clearTimeout(unknownTimer);
      root.hidden = false;
      document.documentElement.classList.add('nfc-win-open');
      setState(state === 'unknown' ? back : state);
      if (!reduce) {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        box.animate([{ opacity: 0, transform: 'translateY(28px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
      box.focus({ preventScroll: true });
    },
    /** quick: 다른 화면(거울·챗봇)으로 바로 넘어갈 때는 짧게 */
    close({ quick = false } = {}) {
      if (root.hidden) return;
      document.documentElement.classList.remove('nfc-win-open');
      clearTimeout(unknownTimer);
      if (state === 'unknown') setState(back);
      const done = () => { root.hidden = true; };
      if (reduce) { done(); return; }
      const ms = quick ? 160 : 220;
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in' });
      box.animate([{ transform: 'none' }, { transform: 'translateY(20px) scale(0.985)' }], { duration: ms, easing: 'ease-in' }).finished.then(done, done);
    },
    /** 리더기·바코드로 읽은 번호를 이 창에서 보여 준다 */
    async tag(code) {
      const my = ++seq;
      const p = await findTagProduct(code, api).catch(() => null);
      if (my !== seq) return;
      clearTimeout(unknownTimer);
      if (!p?.color_hex) {
        flashHit(false);
        if (state !== 'unknown') back = state;
        setState('unknown');
        unknownTimer = setTimeout(() => setState(back), UNKNOWN_MS);
        return;
      }
      flashHit(true);
      addToShelf(p);
      renderProduct(p);
      setState('product');
    },
  };
  box.tabIndex = -1;
  if (shelf.length) renderProduct(shelf[shelf.length - 1], { fresh: false }); // 다시 열면 마지막에 읽은 제품부터 (선반은 그대로)
  renderShelf();
  window.tookNfcWin = api_; // 화면 확인·자동 테스트용: tookNfcWin.open(), tookNfcWin.tag('TEST0001')
  return api_;
}
