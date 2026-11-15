// 챗봇에 담은 제품 (2026-11-15): 추천 카드의 '챗봇에 담기'로 모으고, 챗봇(chat.js picksHandoff)이 이 제품들로 대화를 시작한다.
// sessionStorage(store 'chatPicks')에 제품 ID 와 이름만 저장한다 → 자동 초기화·로고 누르기 때 함께 지워진다.
// 바뀔 때마다 창에 took:picks-change 를 보낸다 (챗봇 플로팅 버튼의 숫자, 다른 카드의 버튼 모양)
import { store } from './store.js';
import { t } from './i18n.js';
import { toast } from './motion.js';

export const PICK_MAX = 6;

/** 담은 제품 [{ id, name }] (담은 순서) */
export const getPicks = () => (store.get('chatPicks') || []).filter((x) => x && x.id);
export const hasPick = (id) => getPicks().some((x) => x.id === id);

function setPicks(list) {
  store.set('chatPicks', list);
  window.dispatchEvent(new CustomEvent('took:picks-change', { detail: { count: list.length } }));
}

/** 담기 / 빼기. 담았으면 true */
export function togglePick(product, name) {
  const list = getPicks();
  if (list.some((x) => x.id === product.id)) {
    setPicks(list.filter((x) => x.id !== product.id));
    toast(t('pick.removed'));
    return false;
  }
  if (list.length >= PICK_MAX) {
    toast(t('pick.full', { n: PICK_MAX }));
    return false;
  }
  setPicks([...list, { id: product.id, name }]);
  toast(t('pick.added'), { ms: 3000 });
  return true;
}
