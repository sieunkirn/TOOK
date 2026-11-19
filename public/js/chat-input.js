// 챗봇 화면: 묻는 방법. 마이크로 말하기, 답변 읽어 주기, 화면 터치 키보드.
import { $, store } from './common.js';
import { setupVoiceInput, setupSpeaker } from './voice.js';
import { attachTouchKeyboard } from './touch-keyboard.js';
import { C, STUDIO, log, input, brands } from './chat-state.js';
import { send } from './chat.js';

// ---------- 음성 질문 / 읽어주기 ----------
const ttsBtn = $('tts');
let ttsOn = store.get('chatTts', true);
export const speaker = setupSpeaker({ isOn: () => ttsOn });
function renderTts() {
  ttsBtn.setAttribute('aria-pressed', String(ttsOn));
  ttsBtn.title = ttsOn ? C('답변 읽어 주기 켜짐 (누르면 끔)', 'Read replies aloud: on (tap to turn off)') : C('답변 읽어 주기 꺼짐 (누르면 켬)', 'Read replies aloud: off (tap to turn on)');
}
if (!speaker.supported) {
  ttsOn = false;
  ttsBtn.disabled = true;
}
ttsBtn.addEventListener('click', () => {
  ttsOn = !ttsOn;
  store.set('chatTts', ttsOn);
  if (!ttsOn) speaker.stop();
  renderTts();
});
renderTts();

// 마이크 버튼이 있는 화면만 (챗봇 화면 chat.html 은 2026-11-15 마이크를 뺐다. 합본 studio.html 에는 있다)
const voiceBtn = $('voice');
if (voiceBtn) setupVoiceInput({
  button: voiceBtn,
  input,
  status: $('voice-status'),
  getBrands: () => brands,
  onText: (text) => send(text),
  beforeStart: () => speaker.stop(), // 읽어주는 소리가 마이크로 다시 들어가지 않게 먼저 멈춘다
  onListening: (on) => {
    voiceBtn.classList.toggle('listening', on);
    voiceBtn.title = on ? C('듣는 중 (누르면 멈춤)', 'Listening (tap to stop)') : C('음성으로 질문', 'Ask by voice');
  },
});

// ---------- 입력: 화면 키보드·빠른 답장 (합본 화면은 마이크도) ----------
// 가운데 칸에 직접 쓰고 '보내기'(Enter)로 보낸다
input.readOnly = false;
input.removeAttribute('tabindex');
input.placeholder = voiceBtn ? C('마이크로 말하거나 아래 키보드로 입력하세요', 'Speak into the mic, or type with the keyboard below') : C('여기를 눌러 입력하세요', 'Tap here to type');
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});
// 화면 터치 키보드 (기기 키보드 대신, js/touch-keyboard.js).
// 챗봇 화면(2026-11-19 사용자 요청): 평소에는 닫혀 있고 입력창을 누르면(예시 질문을 눌러 입력창에 써 넣을 때도) 열린다.
// 키보드·입력줄 밖을 누르거나 보내면 닫힌다. 합본(studio.html)은 예전처럼 항상 열어 둔다
const kbd = attachTouchKeyboard({
  input,
  form: $('chat-form'),
  pinned: STUDIO,
  onToggle: (on) => {
    document.body.classList.toggle('kb-open', on);
    if (on) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  },
});
// 입력줄의 보내기 버튼으로 보내도 닫는다 (키보드의 '보내기'는 키보드가 직접 닫는다)
if (!STUDIO) $('chat-form').addEventListener('submit', () => kbd.close());
// 시작 화면 예시를 입력창에 써 넣은 뒤 고칠 수 있게 연다 (chat-start.js). 창에 포커스가 없으면 focus 이벤트가 안 와서 따로 알린다
input.addEventListener('took:kb-open', () => kbd.open());
