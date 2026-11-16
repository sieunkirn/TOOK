// 홈 = TOOK_prototype(Figma '앱' 페이지) 1~3번 화면 그대로 (2026-11-16). 좌표는 모두 900×1440 무대 기준 (ui-stage.js)
//  1 대기: 검정 화면 가운데 빛나는 마크. 1.5초 뒤 저절로(또는 누르면 바로) 2로 (2026-11-16 사용자 요청)
//  2 로고: 마크가 왼쪽으로 가며 TOOK 글자가 나타난다. 잠시 뒤(또는 누르면) 3으로
//  3 시작: 로고가 위로 올라가며 빛나고 알약 버튼이 나온다.
//     왼쪽 스캔 아이콘 = 카메라로 발라 보기(팔레트 Find Your Color), 오른쪽 음성 아이콘 = AI 뷰티 챗봇
//     버튼은 원본 3번 화면의 세 모양 순서대로 빛난다: 평소(어두운 분홍) → 손가락을 대면(분홍) → 떼는 순간(흰색) → 다음 화면
// 예전 홈(점선 얼굴·시계·버튼 두 개·다크 모드·언어 버튼)은 프로토타입에 없어 뺐다 (git 기록 a840e68 에 있음)
import { store } from './common.js';
import { t, lang, langToggle } from './i18n.js';
import { REDUCE_MOTION as reduce } from './motion.js';
import { logoFull, markGlowSvg } from './brand.js';
import { fitStage } from './ui-stage.js';

document.documentElement.lang = lang(); // 홈은 applyI18n 을 부르지 않아 <html lang> 을 직접 맞춘다
try { sessionStorage.removeItem('took.homeSkipIntro'); } catch { /* 저장 불가 환경 */ }

// 스캔 아이콘: 네 모서리 괄호 (원본 36×35, 선 굵기 3.5)
const SCAN_SVG = '<svg class="hs-ico-scan" viewBox="0 0 36 35" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M2.2 10.6V6.8a4.6 4.6 0 0 1 4.6-4.6h3.6"/><path d="M25.6 2.2h3.6a4.6 4.6 0 0 1 4.6 4.6v3.6"/>'
  + '<path d="M33.8 24.4v3.8a4.6 4.6 0 0 1-4.6 4.6h-3.6"/><path d="M10.4 32.8H6.8a4.6 4.6 0 0 1-4.6-4.6v-3.8"/></g></svg>';
// 음성 아이콘: 둥근 막대 다섯 개 (원본 위치·높이 그대로)
const WAVE_SVG = '<svg class="hs-ico-wave" viewBox="0 0 60 34" aria-hidden="true" focusable="false"><g fill="currentColor">'
  + '<rect x="0" y="12" width="6" height="9" rx="3"/><rect x="11" y="4" width="8" height="25" rx="4"/><rect x="25" y="0" width="7.4" height="33" rx="3.7"/>'
  + '<rect x="38" y="4" width="7.4" height="25" rx="3.7"/><rect x="51" y="9" width="8" height="16" rx="4"/></g></svg>';

const stage = document.getElementById('stage');
fitStage(stage);
stage.innerHTML = `<div class="hs-glowmark" aria-hidden="true">${markGlowSvg()}</div>${logoFull('hs-logo')}
  <div class="hs-start" data-state="a" data-side="scan">
    <div class="hs-glow" aria-hidden="true"><i></i></div>
    <div class="hs-pill" role="group">
      <span class="hs-knob" aria-hidden="true"></span>
      <button type="button" class="hs-opt hs-opt-scan">${SCAN_SVG}</button>
      <button type="button" class="hs-opt hs-opt-voice">${WAVE_SVG}</button>
    </div>
  </div>
  <p class="sr-only" id="hs-help"></p>`;
stage.append(langToggle('hs-lang')); // 한국어/영어 (3번 시작 화면 오른쪽 위에서만 보인다)
const pill = stage.querySelector('.hs-pill');
const box = stage.querySelector('.hs-start'); // 눌린 단계(data-state a·b·c)와 고른 쪽(data-side)
pill.setAttribute('aria-label', t('home.choose'));
stage.querySelector('.hs-opt-scan').setAttribute('aria-label', t('home.toPalette'));
stage.querySelector('.hs-opt-voice').setAttribute('aria-label', t('home.toChat'));
stage.querySelector('#hs-help').textContent = t('home.tapToStart');

// ---------- 1 → 2 → 3 ----------
const MARK_MS = 1500; // 1번 마크 화면을 보여 주는 시간
const LOGO_MS = 1300; // 2번 로고 화면을 보여 주는 시간
let step = 0;
let autoTimer = null;
function go(n, { instant = false } = {}) {
  clearTimeout(autoTimer);
  step = n;
  stage.classList.toggle('hs-instant', instant || reduce);
  stage.dataset.step = String(n);
  if (instant || reduce) requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('hs-instant')));
  if (n === 1) autoTimer = setTimeout(() => go(2), MARK_MS);
  if (n === 2) autoTimer = setTimeout(() => go(3), LOGO_MS);
}
// 1·2번 화면은 아무 곳이나 누르면 다음으로 (원본 프로토타입처럼 손을 뗄 때 한 번만)
stage.addEventListener('pointerup', (e) => {
  if (step === 1) go(2);
  else if (step === 2 && !e.target.closest('.hs-pill')) go(3);
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && step < 3) { e.preventDefault(); go(step + 1); }
});

// ---------- 3번 알약 버튼: 누르는 동안 세 단계로 빛난다 ----------
let pressing = null;
let leaving = false;
const sideOf = (el) => (el?.closest('.hs-opt-voice') ? 'voice' : el?.closest('.hs-opt-scan') ? 'scan' : null);
pill.addEventListener('pointerdown', (e) => {
  if (step !== 3 || leaving) return;
  const side = sideOf(e.target);
  if (!side) return;
  pressing = { side, id: e.pointerId };
  box.dataset.side = side;
  box.dataset.state = 'b';
});
pill.addEventListener('pointerup', (e) => {
  if (!pressing || leaving) return;
  const { side } = pressing;
  pressing = null;
  // 손가락이 버튼 밖으로 나가서 떼면 취소
  const r = pill.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { box.dataset.state = 'a'; return; }
  press(side);
});
pill.addEventListener('pointercancel', () => { pressing = null; if (!leaving) box.dataset.state = 'a'; });
pill.addEventListener('pointerleave', (e) => { if (pressing && e.pointerType === 'mouse') { pressing = null; box.dataset.state = 'a'; } });
// 키보드(Enter·Space)로 누를 때: 같은 세 단계를 짧게 보여 준다
pill.addEventListener('click', (e) => {
  if (e.detail !== 0 || leaving) return;
  const side = sideOf(e.target);
  if (!side) return;
  box.dataset.side = side;
  box.dataset.state = 'b';
  setTimeout(() => press(side), 160);
});

function press(side) {
  if (leaving) return;
  leaving = true;
  box.dataset.side = side;
  box.dataset.state = 'c';
  setTimeout(() => start(side), reduce ? 0 : 320);
}

// ---------- 다음 화면으로 ----------
// 팔레트: 로고가 Find Your Color 화면 왼쪽 위 작은 로고 자리로 줄어들며 날아가고, 나머지는 사라진다
const SMALL_LOGO = { left: 39.8, top: 65.8, k: 190.6 / 612 }; // palette 화면의 로고 (원본 04.png: x 40~229, y 66~110)
function start(where) {
  if (where === 'voice') {
    store.remove('navCurrent.chat.html');
    location.href = 'chat.html';
    return;
  }
  store.remove('navCurrent.palette.html');
  try { sessionStorage.setItem('took.enterFx', '1'); } catch { /* 저장 불가 환경: 팔레트는 그냥 열린다 */ }
  if (reduce) { location.href = 'palette.html'; return; }
  stage.classList.add('hs-leaving');
  const logo = stage.querySelector('.hs-logo');
  // transform 은 로고의 원래 자리(CSS left 144, top 648) 기준이다. 3번 화면에서는 translateY(-268px) 로 올라가 있으므로
  // 그 상태에서 출발해, 원래 자리 기준으로 팔레트 로고 자리(왼쪽 위 39.8, 65.8 · 배율 190.6/612)에 정확히 멈춘다 (transform-origin 0 0)
  const BASE = { left: 144, top: 648 };
  const dx = SMALL_LOGO.left - BASE.left;
  const dy = SMALL_LOGO.top - BASE.top;
  const from = getComputedStyle(logo).transform; // 지금 보이는 자리 그대로 (translateY(-268px))
  logo.style.transition = 'none';
  logo.animate([
    { transform: from === 'none' ? 'translateY(-268px)' : from, filter: 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.88))' },
    { transform: `translate(${dx}px, ${dy}px) scale(${SMALL_LOGO.k})`, filter: 'drop-shadow(0 0 0 rgba(255, 255, 255, 0))' }, // 팔레트 로고는 빛 번짐 없음
  ], { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
  setTimeout(() => { location.href = 'palette.html'; }, 700);
}

// 언어를 바꿔 다시 열렸으면(took.homeFx) 바로 3번(시작 버튼) 화면, 그 밖에(처음·초기화·로고) 1번(마크)부터
let arrive = false;
try {
  arrive = !!sessionStorage.getItem('took.homeFx');
  sessionStorage.removeItem('took.homeFx');
} catch { /* 저장 불가 환경 */ }
const want = Number(new URLSearchParams(location.search).get('step')); // 화면 확인용 ?step=1|2|3
go(want >= 1 && want <= 3 ? want : arrive ? 3 : 1, { instant: true });
window.tookHome = { go };
