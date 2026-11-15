// 기기 모드와 키오스크 틀: 맨 위 창으로 연 화면을 세로 5:8 틀(kiosk.html) 안으로 옮기고, 새로고침하면 처음 상태로 돌린다.
// 불러오는 순간 동작한다 (common.js 가 가장 먼저 불러온다).
// - 자동 테스트(navigator.webdriver)와 틀 화면(kiosk.html)·preview.html 은 옮기지 않는다
// 주소 값: ?쿼리 → 없으면 #조각
const HASH_PARAMS = (() => { try { return new URLSearchParams(location.hash.replace(/^#/, '')); } catch { return new URLSearchParams(); } })();
export function urlParam(name) {
  const v = new URLSearchParams(location.search).get(name);
  return v !== null ? v : HASH_PARAMS.get(name);
}
// 기기 모드 (주소 뒤 ?device=tablet, localStorage took.deviceMode):
//   tablet = 이 기기는 매장 태블릿 그 자체 (미리보기 틀 없이 화면을 바로 그린다. 모든 화면은 세로 기준).
//   주소 뒤 ?device=tablet 으로도 정하고, ?device=auto 로 해제한다. 손님 휴대폰 모드는 2026-11-11 없앴다
export const DEVICE_MODE = (() => {
  try {
    const want = new URLSearchParams(location.search).get('device');
    if (want === 'tablet') localStorage.setItem('took.deviceMode', want);
    else if (want === 'auto') localStorage.removeItem('took.deviceMode');
    const v = localStorage.getItem('took.deviceMode');
    if (v && v !== 'tablet') localStorage.removeItem('took.deviceMode'); // 예전 휴대폰 모드 설정은 지운다
    return v === 'tablet' ? v : null;
  } catch { return null; }
})();
// 예전 손님 휴대폰 표시(창 이름 took-phone)와 저장값(tookPhone.*)이 남아 있으면 지운다
try {
  if (window.name === 'took-phone') window.name = '';
  Object.keys(localStorage).filter((k) => k.startsWith('tookPhone.')).forEach((k) => localStorage.removeItem(k));
} catch { /* 저장 불가 환경 */ }
/** 이 화면을 탭 크기 틀로 옮기는 중이면 true (곧 다시 열리므로 화면마다 한 번만 할 일은 건너뛴다) */
let MOVING_TO_TAB_FRAME = false;
const TAB_FRAME_SKIP = ['preview.html', 'kiosk.html'];
// 새로고침(F5·새로고침 버튼)하면 처음 상태로: 기기 설정(태블릿 고정)을 풀고, 저장한 상태(took.*)를 비우고
// 첫 화면(시작 화면, 노트북이면 태블릿 미리보기)으로.
// 직원 도구 화면은 그대로. 미리보기(preview.html)는 그 화면 스크립트가 같은 일을 한다
(function reloadToStart() {
  const page = location.pathname.split('/').pop() || 'index.html';
  if (TAB_FRAME_SKIP.includes(page)) return;
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (nav?.type !== 'reload') return;
  if (window.top !== window) return; // 미리보기 틀 안의 화면은 틀(preview.html)이 처음 상태로 되돌린다
  try { localStorage.removeItem('took.deviceMode'); } catch { /* 저장 불가 환경 */ }
  try { window.name = ''; } catch { /* 없음 */ }
  try { Object.keys(sessionStorage).filter((k) => k.startsWith('took.')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* 저장 불가 환경 */ }
  if (page === 'index.html' && !DEVICE_MODE) return; // 이미 첫 화면 (아래 틀 옮기기는 그대로)
  MOVING_TO_TAB_FRAME = true; // 곧 다른 화면으로 가므로 화면마다 한 번만 할 일은 건너뛴다
  location.replace('index.html');
})();
// 세로 비율 고정 (2026-11-13): 노트북·태블릿·휴대폰 모두 세로 5:8(900×1440) 상자 안에서만 보이게
// 맨 위 창으로 연 화면은 고정 비율 틀(kiosk.html) 안으로 옮긴다. 남는 곳은 검게 비운다.
// 자동 테스트(navigator.webdriver)는 지금처럼 틀 없이 연다
(function openInPortraitFrame() {
  const page = location.pathname.split('/').pop() || 'index.html';
  if (window.top !== window || navigator.webdriver || TAB_FRAME_SKIP.includes(page) || MOVING_TO_TAB_FRAME) return;
  MOVING_TO_TAB_FRAME = true;
  location.replace('kiosk.html?page=' + encodeURIComponent(page + location.search));
})();
