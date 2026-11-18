// NFC 테스트 화면 (nfc-test.html, 2026-11-18 · 직원용)
// 리더기 입력은 손님 화면과 같은 listenNfc 로 듣고, 표 찾기(matchTag)·제품 찾기(findTagProduct)도 같은 함수를 쓴다
import { $, api, el, shortName } from './common.js';
import { listenNfc, matchTag, normalizeTag, findTagProduct, NFC_LABELS, NFC_TAGS } from './nfc.js';

const result = $('nt-result');
const rows = $('nt-rows');
let count = 0;
let hitTimer = 0;

// 등록된 카드 목록 (이름이 붙은 표 줄만)
$('nt-cards').replaceChildren(...Object.entries(NFC_LABELS).map(([key, name]) =>
  el('li', {}, [el('strong', { text: name + ' ' }), el('code', { text: key.length % 2 ? key : key.replace(/(..)(?=.)/g, '$1 ') }), // 글자가 빠진 번호(홀수)는 두 글자씩 끊으면 틀린 자리로 보여서 그대로
    el('span', { class: 'muted', text: ` (${key.length}글자${key.length % 2 ? ', 일부 빠짐' : ''}) · ${NFC_TAGS[key] || ''}` })])));

async function onTag(raw) {
  const code = normalizeTag(raw);
  const key = matchTag(code);
  const name = key ? (NFC_LABELS[key] || '표에 있는 태그') : '등록되지 않은 태그';
  const how = !key ? '표에 없어요' : key === code ? '표의 번호와 똑같아요' : `표의 ${key} 와 같은 카드로 봤어요 (글자 빠짐 감안)`;
  const p = await findTagProduct(code, api).catch(() => null);

  result.replaceChildren(
    el('div', { class: 'nt-card', text: name }),
    el('div', { class: 'nt-num', text: code.length % 2 ? code : code.replace(/(..)(?=.)/g, '$1 ') }),
    el('div', { class: 'nt-meta', text: `${code.length}글자 · ${how}` }),
    p ? el('div', { class: 'nt-prod' }, [
      p.color_hex ? el('span', { class: 'nt-dot', style: `background:${p.color_hex}`, title: p.color_hex }) : null,
      el('div', {}, [el('strong', { text: shortName(p) }), el('span', { class: 'muted', text: p.id })]),
    ].filter(Boolean)) : el('div', { class: 'nt-meta', text: '찾은 제품 없음' }),
  );
  result.classList.add('hit');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => result.classList.remove('hit'), 600);

  if (!count) rows.replaceChildren();
  count++;
  $('nt-count').textContent = `(${count})`;
  rows.prepend(el('tr', {}, [
    el('td', { text: new Date().toLocaleTimeString('ko-KR') }),
    el('td', { text: name + (key && key !== code ? ' (글자 빠짐)' : '') }),
    el('td', { class: 'mono', text: code }),
    el('td', { text: p ? shortName(p) : '-' }),
  ]));
}

listenNfc(onTag);
$('nt-clear').addEventListener('click', () => {
  count = 0;
  $('nt-count').textContent = '';
  rows.replaceChildren(el('tr', { class: 'empty' }, [el('td', { colspan: '4', text: '아직 없어요' })]));
});
$('nt-back').addEventListener('click', () => {
  // 관리자 화면은 맨 위 창에서 연다 (키오스크 틀 안이면 틀 밖으로)
  try { window.top.location.href = new URL('admin.html', window.top.location.href).href; } catch { location.href = 'admin.html'; }
});
