// 챗봇 시작 화면 (대화가 아직 없을 때만, 2026-11-17): 아멜리 HEVA 챗봇 시작 화면의 예시 질문 + 입력창. 색과 문구는 TOOK 것.
//  1) 예시 질문: 두 줄(상황 한 줄 + 굵은 질문 한 줄, 질문 아래 형광펜 밑줄)이 3초마다 위로 밀려 올라가며 바뀐다 (0.5초).
//     예시는 열 때마다 섞는다. 줄이나 ↵ 를 누르면 바뀌기를 멈추고, 그 질문을 입력창에 한 글자씩(30ms) 써 넣기만 한다.
//     보내지는 않는다: 손님이 상황 부분(톤·자리·예산 등)을 자기 것으로 고친 뒤 '보내기'로 보낸다. 입력창을 다 지우면 다시 바뀐다.
//  2) 입력창(chat.html 의 chat-form): 테두리·빛 그림자, 오른쪽 보내기 버튼 (글자가 있을 때만 켜짐). 그 아래 화면 키보드는 기존처럼 항상 열려 있다.
//  (아래쪽 Powered by·팔레트 안내 카드·바로 가기 카드는 2026-11-17 사용자 요청으로 뺐다)
// 예시 질문은 대화 칸 자리 위쪽에 둔다 (입력창·키보드는 아래 그대로).
// 첫 질문을 보내면(대화가 생기면) 예시 질문은 숨고 그 자리에 대화가 나온다 (chat-view.js renderLog → syncStart).
// 예시 질문: 매장 손님이 실제로 묻는 말(챗봇 평가 세트 test/eval/chat-cases.json 의 상황·퍼스널 톤·입술 고민·자유 표현 분류)을
// 두 줄로 다듬었다. 규칙 챗봇(src/lib/chat.js)이 올리브영 실제 데이터에서 '조건을 빼고 찾았어요' 없이 제품을 찾아 답하는 말만
// 한/영 모두 확인해 골랐다. 거울(팔레트)에서 발라 본 색이 있으면 '그 색과 비슷한 립' 예시를 맨 앞에 더한다.
import { $, el } from './common.js';
import { C, state, input } from './chat-state.js';

const top = $('cs-top');
const sendBtn = top ? $('chat-send') : null; // 합본(studio.html)의 보내기 버튼은 건드리지 않는다
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROTATE_MS = 3000; // 예시 질문이 바뀌는 간격
const TYPE_MS = 30; // 예시를 입력창에 쓰는 한 글자 간격

// 예시 질문: '상황\n질문' (마지막 줄이 굵은 질문). 첫 줄이 손님이 자기 것으로 고칠 부분이다
const EXAMPLES = C([
  '쿨톤인데 혈색 있어 보이고 싶어.\n어울리는 립 추천해 줘', // 퍼스널 톤
  '가을 웜톤이야.\n어울리는 립 추천해 줘',
  '커피를 자주 마셔.\n잘 안 지워지는 틴트 있어?', // 지속력
  '끈적이는 건 싫어.\n가벼운 글로시 틴트 추천해 줘', // 제형
  '얼굴이 창백해 보여.\n생기 있어 보이는 립 추천해 줘', // 고민
  '다음 주에 면접이 있어.\n단정해 보이는 립 추천해 줘', // 자리
  '결혼식 하객으로 가.\n화사한 립 추천해 줘',
  '사진을 찍을 거야.\n입술이 살아 보이는 색 추천해 줘',
  '친구 생일 선물을 찾고 있어.\n2만원 이하 립 추천해 줘', // 선물·예산
  '롬앤 틴트를 좋아해.\n데일리로 쓸 만한 거 추천해 줘', // 브랜드
], [
  "I'm cool-toned and want a healthy flush.\nRecommend a lip that suits me",
  "I'm an autumn warm tone.\nRecommend a lip that suits me",
  'I drink a lot of coffee.\nRecommend a long-lasting tint',
  "I don't like sticky lips.\nRecommend a light glossy tint",
  'My face looks pale.\nRecommend a lip that looks fresh',
  'I have a job interview next week.\nRecommend a neat-looking lip',
  "I'm a wedding guest.\nRecommend a bright lip",
  "I'm taking photos.\nRecommend a color that makes my lips pop",
  "I'm looking for a friend's birthday gift.\nRecommend a lip under 20,000 won",
  'I like rom&nd tints.\nRecommend one for every day',
]);
// 거울(팔레트·립 매핑)에서 발라 본 색이 있을 때만: 그 색이 기준 색(state.selectedHex)이 된다
const COLOR_EXAMPLE = C('거울에서 발라 본 색이 좋아.\n이 색이랑 비슷한 립 찾아 줘', 'I like the color I tried in the mirror.\nFind lips similar to this color');

// ---------- 예시 질문 ----------
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const examples = [...(state.selectedHex ? [COLOR_EXAMPLE] : []), ...shuffled(EXAMPLES)];
const asked = (text) => text.replace(/\s*\n\s*/g, ' '); // 보낼 때는 한 줄로
let cur = 0;
let rotTimer = 0;
let stopped = false; // 예시를 한 번 누르면 더 바꾸지 않는다
let typing = false;

const slides = examples.map((text) => {
  const lines = text.split('\n');
  const q = lines.pop();
  return el('span', { class: 'cs-slide' },
    el('span', { class: 'cs-ctx', text: lines.join('\n') }),
    el('span', { class: 'cs-q' }, q, el('i', { class: 'cs-hl', 'aria-hidden': 'true' })));
});
const useIcon = el('span', { class: 'cs-use', 'aria-hidden': 'true' });
useIcon.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" focusable="false"><path fill="currentColor" d="M17.26 6.93a.67.67 0 0 0-.5.19.67.67 0 0 0-.19.5q0 .18.01.38.01.2.01.46 0 1.06-.27 1.72-.28.66-.9.97-.63.3-1.69.3H9.62l-1.52.1 1.89-1.71 1.41-1.43a.7.7 0 0 0 .15-.22.7.7 0 0 0 .05-.27.65.65 0 0 0-.19-.48.68.68 0 0 0-.5-.19.7.7 0 0 0-.5.21l-4.18 4.17a.7.7 0 0 0-.23.52q0 .3.23.53l4.18 4.17q.24.23.51.23a.68.68 0 0 0 .5-.19.65.65 0 0 0 .19-.48.7.7 0 0 0-.05-.27.7.7 0 0 0-.15-.22l-1.41-1.44-1.9-1.7 1.52.08h4.21q2.2 0 3.2-1.05Q18 10.75 18 8.5a9 9 0 0 0-.01-.52 3 3 0 0 0-.05-.43 1 1 0 0 0-.1-.3.66.66 0 0 0-.22-.24.65.65 0 0 0-.36-.09z"/></svg>';
const rotator = el('button', { type: 'button', class: 'cs-rot', onclick: () => useExample() },
  el('span', { class: 'cs-rot-box' }, ...slides), useIcon);

function renderSlides() {
  const n = slides.length;
  slides.forEach((s, i) => {
    s.classList.toggle('is-cur', i === cur);
    s.classList.toggle('is-prev', i === (cur - 1 + n) % n && i !== cur);
    s.classList.toggle('is-next', i === (cur + 1) % n && i !== cur);
    s.setAttribute('aria-hidden', String(i !== cur));
  });
  rotator.setAttribute('aria-label', C(`입력창에 예시 질문 넣기: ${asked(examples[cur])}`, `Put this example in the input: ${asked(examples[cur])}`));
}

function startRotate() {
  if (rotTimer || stopped || slides.length < 2) return;
  rotTimer = setInterval(() => { cur = (cur + 1) % slides.length; renderSlides(); }, ROTATE_MS);
}
function stopRotate() {
  clearInterval(rotTimer);
  rotTimer = 0;
}

/** 지금 보이는 예시를 입력창에 한 글자씩 써 넣는다 (보내지 않는다: 손님이 고쳐서 보낸다) */
async function useExample() {
  if (typing || state.typing) return;
  stopped = true;
  stopRotate();
  typing = true;
  const text = asked(examples[cur]);
  if (reduceMotion) input.value = text;
  else {
    let typed = '';
    input.value = ''; // 전에 쓰던 글은 이 예시로 바꾼다
    for (const ch of text) {
      // 쓰는 도중에 손님이 키보드로 입력하면 거기서 멈추고 손님 글을 그대로 둔다
      if (input.value !== typed) break;
      typed += ch;
      input.value = typed;
      syncSend();
      await sleep(TYPE_MS);
    }
  }
  typing = false;
  // 커서를 글 끝에 두어 화면 키보드로 바로 고치거나 이어 쓸 수 있게
  const end = input.value.length;
  input.focus({ preventScroll: true });
  input.setSelectionRange(end, end);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- 입력창 보내기 버튼 ----------
function syncSend() {
  if (sendBtn) sendBtn.disabled = !input.value.trim() || typing;
}
input.addEventListener('input', () => {
  syncSend();
  // 시작 화면에서 넣은 예시를 다 지우면 예시가 다시 바뀌기 시작한다
  if (stopped && !typing && !input.value.trim() && document.body.classList.contains('cs-on')) {
    stopped = false;
    startRotate();
  }
});

if (top) {
  top.append(rotator);
  renderSlides();
}

// 입력창 안내 글: 시작 화면은 HEVA 처럼 '툭에게 물어보기', 대화 화면은 기존 글('아래 키보드로 입력하세요')
const PH_START = C('툭에게 물어보기', 'Ask Took');
let phChat = null;

/** 대화가 없으면 시작 화면, 있으면 대화 화면 (renderLog 가 그릴 때마다 부른다) */
export function syncStart() {
  if (!top) return;
  const on = !state.messages.length;
  document.body.classList.toggle('cs-on', on);
  top.hidden = !on;
  if (phChat === null) phChat = input.placeholder;
  input.placeholder = on ? PH_START : phChat;
  syncSend();
  if (on) startRotate();
  else stopRotate();
}
