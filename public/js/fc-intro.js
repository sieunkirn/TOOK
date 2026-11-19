// 거울 첫 화면 안내 (2026-11-19 사용자 요청 "거울 첫 화면 안내"): 거울에 처음 들어오면 얼굴이 비친 채로 시작하는 길 세 개를 크게 보여 준다.
//  1 제품 올리기 (NFC 리더기) — 안내만. 실제로 태그하면 안내가 닫히고 NFC 창이 뜬다
//  2 색 돌려 보기 (원형 다이얼) — 누르면 안내가 닫히고 다이얼 손잡이가 몇 번 반짝인다
//  3 추천받기 (AI 뷰티 챗봇의 단계형 질문) — 누르면 챗봇 창
// 한 번 닫으면 처음으로(로고·집 버튼·자동 초기화)가 저장값을 지울 때까지 다시 나오지 않는다 (store 'fcIntroSeen').
// 바탕(어두운 막)이나 '바로 둘러볼게요'를 누르거나, 다이얼을 돌리거나 색이 입혀지면(took:apply) 닫힌다.
import { store } from './common.js';
import { t } from './i18n.js';

const NFC_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">'
  + '<rect x="9" y="6" width="18" height="36" rx="4"/><path d="M33 17a10 10 0 0 1 0 14"/><path d="M38 12a17 17 0 0 1 0 24"/></g></svg>';
const DIAL_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">'
  + '<path d="M8 32a17 17 0 0 1 32 0"/><path d="M24 15v-6"/><circle cx="24" cy="32" r="5"/><path d="M34 9l4 4-4 4"/></g></svg>';
const CHAT_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="currentColor">'
  + '<rect x="9" y="19" width="4" height="10" rx="2"/><rect x="17" y="13" width="4" height="22" rx="2"/><rect x="25" y="9" width="4" height="30" rx="2"/>'
  + '<rect x="33" y="15" width="4" height="18" rx="2"/></g></svg>';
const GO_SVG = '<svg class="fi-go" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {{ stage: HTMLElement, onDial: () => void, onChat: () => void, skip?: boolean }} opts
 * @returns {{ close: () => void, isOpen: () => boolean }}
 */
export function createIntro({ stage, onDial, onChat, skip = false }) {
  let open = false;
  const api = { close, isOpen: () => open };
  if (skip || store.get('fcIntroSeen')) return api;

  const el = document.createElement('section');
  el.className = 'fc-intro';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('fc.introTitle'));
  el.innerHTML = `<div class="fi-dim"></div>
    <div class="fi-box">
      <h2 class="fi-title">${t('fc.introTitle')}</h2>
      <p class="fi-sub">${t('fc.introSub')}</p>
      <div class="fi-card fi-nfc"><span class="fi-ico">${NFC_SVG}</span><span class="fi-text"><strong>${t('fc.introNfc')}</strong><span>${t('fc.introNfcSub')}</span></span><span class="fi-wave" aria-hidden="true"></span></div>
      <button type="button" class="fi-card fi-dial"><span class="fi-ico">${DIAL_SVG}</span><span class="fi-text"><strong>${t('fc.introDial')}</strong><span>${t('fc.introDialSub')}</span></span>${GO_SVG}</button>
      <button type="button" class="fi-card fi-chat"><span class="fi-ico">${CHAT_SVG}</span><span class="fi-text"><strong>${t('fc.introChat')}</strong><span>${t('fc.introChatSub')}</span></span>${GO_SVG}</button>
      <button type="button" class="fi-skip">${t('fc.introSkip')}</button>
    </div>`;
  stage.append(el);
  open = true;
  requestAnimationFrame(() => el.classList.add('on'));

  el.querySelector('.fi-dim').addEventListener('click', () => close());
  el.querySelector('.fi-skip').addEventListener('click', () => close());
  el.querySelector('.fi-dial').addEventListener('click', () => { close(); onDial(); });
  el.querySelector('.fi-chat').addEventListener('click', () => { close(); onChat(); });
  // NFC·바코드·내 톤 추천 등으로 색이 입혀지면 (다이얼 색은 화면이 열릴 때도 입혀지므로 빼고, 다이얼은 돌리는 순간 닫는다: palette.js)
  window.addEventListener('took:apply', (e) => { if (e.detail?.source !== 'Find Your Color') close(); });

  function close() {
    if (!open) return;
    open = false;
    store.set('fcIntroSeen', true);
    el.classList.remove('on');
    el.classList.add('off');
    setTimeout(() => el.remove(), 400);
  }
  return api;
}
