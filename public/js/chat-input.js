// 챗봇 화면: 묻는 방법. 마이크로 말하기, 답변 읽어 주기, 화면 터치 키보드.
import { $, store } from './common.js';
import { setupVoiceInput, setupSpeaker } from './voice.js';
import { attachTouchKeyboard } from './touch-keyboard.js';
import { C, log, input, brands } from './chat-state.js';
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
input.placeholder = voiceBtn ? C('마이크로 말하거나 아래 키보드로 입력하세요', 'Speak into the mic, or type with the keyboard below') : C('아래 키보드로 입력하세요', 'Type with the keyboard below');
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});
// 화면 터치 키보드: 입력줄 아래에 한/영 키보드를 항상 열어 둔다 (2026-11-11 고정, 기기 키보드 대신, js/touch-keyboard.js)
attachTouchKeyboard({
  input,
  form: $('chat-form'),
  pinned: true,
  onToggle: (on) => { if (on) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); },
});
