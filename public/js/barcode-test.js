// 바코드 카메라 테스트 화면 (barcode-test.html, 2026-11-18 · 직원용)
// 바코드 스캐너 없이 기기 카메라로 바코드를 읽고, 챗봇과 같은 조회(api/products/barcode/)로 등록된 호수인지 보여 준다.
// 카메라 켜는 데 걸린 시간, 읽기까지 걸린 시간, 바코드 종류, 읽은 기록을 남겨 카메라·조명·거리별로 비교할 수 있게 한다.
import { $, api, el, shortName, won } from './common.js';
import { createBarcodeScanner, cameraErrorMessage, decodeImageFile } from './barcode-scan.js';

const CAM_KEY = 'took.barcodeTest.cam'; // 고른 카메라 (이 기기 브라우저에만)
const FORMAT_NAMES = { EAN_13: 'EAN-13', EAN_8: 'EAN-8', UPC_A: 'UPC-A (미국식 12자리)', UPC_E: 'UPC-E', CODE_128: 'CODE-128' };
// 시험용 바코드: 실제 데이터에 있는 번호 3개 + 일부러 등록되지 않은 번호 1개 (검증 숫자는 맞음)
const SAMPLES = ['8809625240172', '8800258089114', '602004106643', '8801234567893'];

const video = $('bt-video');
const guide = $('bt-guide');
const sec = (ms) => (ms / 1000).toFixed(1) + '초';
const clock = () => new Date().toLocaleTimeString('en-GB'); // 14:03:21
const formatName = (f, code) => FORMAT_NAMES[f] || f || ({ 13: 'EAN-13', 12: 'UPC-A (미국식 12자리)', 8: 'EAN-8' }[String(code).length] ?? '-');
const sourceName = (p) => (p.source === 'oliveyoung' ? '올리브영 실데이터' : p.source === 'demo' ? '시연용 가상 데이터' : '테스트용 가상 데이터');
const store = {
  get: () => { try { return localStorage.getItem(CAM_KEY) || ''; } catch { return ''; } },
  set: (v) => { try { localStorage.setItem(CAM_KEY, v); } catch { /* 저장 못 해도 동작 */ } },
};

// ---------- 카메라 ----------
// '걸린 시간'의 기준: 카메라를 켠 때, '다시 읽기'를 누른 때, 직전에 읽은 때 (기준을 같이 적는다.
// 직전 읽기 뒤 시간에는 제품을 바꿔 드는 시간도 들어가므로, 정확히 재려면 '다시 읽기'를 누르고 바로 비춘다)
let since = 0;
let sinceLabel = '켠 뒤';
const markSince = (label) => { since = performance.now(); sinceLabel = label; };
let lastStatus = 0;
const scanner = createBarcodeScanner({
  video,
  onCode: (code, info) => {
    const tookText = `${sinceLabel} ${sec(performance.now() - since)}`;
    markSince('직전 읽기 뒤');
    lookup(code, { via: '카메라', format: info?.format, tookText });
  },
  onProgress: ({ frames, width, height, ms }) => {
    if (ms - lastStatus < 500) return; // 0.5초마다만 고친다
    lastStatus = ms;
    $('bt-status').textContent = `읽는 중 · 영상 ${width}×${height} · 켠 지 ${sec(ms)} · 화면 ${frames}장 확인함`;
  },
});

function setRunning(on) {
  $('bt-start').disabled = on;
  $('bt-stop').disabled = !on;
  $('bt-off').classList.toggle('hidden', on);
  guide.classList.toggle('hidden', !on);
  $('bt-badge').textContent = on ? '읽는 중' : '꺼짐';
}

async function start() {
  const deviceId = $('bt-cams').value || undefined;
  $('bt-start').disabled = true;
  $('bt-status').textContent = '카메라를 켜는 중이에요…';
  const t0 = performance.now();
  try {
    await scanner.start({ deviceId });
  } catch (e) {
    // 고른 카메라가 빠졌으면 기본 카메라로 한 번 더
    if (deviceId && (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError')) {
      $('bt-cams').value = '';
      store.set('');
      return start();
    }
    setRunning(false);
    $('bt-status').textContent = e?.name ? cameraErrorMessage(e) : e.message;
    return;
  }
  const openMs = performance.now() - t0;
  markSince('켠 뒤');
  lastStatus = 0;
  setRunning(true);
  const track = video.srcObject?.getVideoTracks()[0];
  const s = track?.getSettings?.() || {};
  $('bt-status').textContent = `카메라를 켰어요 (${sec(openMs)} 걸림) · ${track?.label || '카메라'} · 영상 ${s.width || video.videoWidth}×${s.height || video.videoHeight}`;
  await listCameras(s.deviceId);
}

function stop() {
  scanner.stop();
  setRunning(false);
  $('bt-status').textContent = '카메라를 껐어요.';
}

// 카메라 목록: 권한을 받은 뒤에야 이름이 보인다
async function listCameras(currentId) {
  const sel = $('bt-cams');
  let cams = [];
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { return; }
  if (!cams.length) return;
  const keep = currentId || sel.value;
  sel.replaceChildren(el('option', { value: '', text: '기본 카메라' }),
    ...cams.map((d, i) => el('option', { value: d.deviceId, text: d.label || `카메라 ${i + 1}` })));
  if (cams.some((d) => d.deviceId === keep)) sel.value = keep;
}

$('bt-start').addEventListener('click', start);
$('bt-stop').addEventListener('click', stop);
$('bt-cams').addEventListener('change', () => {
  store.set($('bt-cams').value);
  if (scanner.isRunning()) { scanner.stop(); start(); }
});

// ---------- 읽은 바코드 조회 ----------
const log = [];

function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new AudioContext());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1500;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
  } catch { /* 소리를 못 내도 화면 표시는 그대로 */ }
}

function flash() {
  guide.classList.add('hit');
  $('bt-badge').textContent = '읽었어요';
  clearTimeout(flash.t);
  flash.t = setTimeout(() => {
    guide.classList.remove('hit');
    if (scanner.isRunning()) $('bt-badge').textContent = '읽는 중';
  }, 700);
}

async function lookup(raw, { via, format, tookText } = {}) {
  const code = String(raw).trim();
  if (via === '카메라') { beep(); flash(); }
  const digits = /^\d{8,14}$/.test(code);
  let product = null;
  let verdict;
  if (!digits) verdict = '바코드 번호 형식이 아니에요 (8~14자리 숫자가 아님)';
  else {
    const r = await api('api/products/barcode/' + code);
    if (!r.ok) verdict = '조회하지 못했어요 (서버 응답 오류)';
    else if (r.body.found) { product = r.body.product; verdict = '등록된 제품이에요'; }
    else verdict = '등록되지 않은 바코드예요';
  }
  const entry = { at: clock(), code, via, format: formatName(format, code), tookText, product, verdict };
  log.unshift(entry);
  if (log.length > 30) log.pop();
  renderResult(entry);
  renderLog();
}

function renderResult(e) {
  const p = e.product;
  const meta = [e.via, e.format, e.tookText, e.at].filter(Boolean).join(' · ');
  const body = [
    el('div', { class: 'label', text: '마지막으로 읽은 바코드' }),
    el('div', { class: 'bt-num', text: e.code }),
    el('div', { class: 'bt-meta', text: meta }),
    el('div', { class: 'bt-verdict', text: e.verdict }),
  ];
  if (p) {
    const shade = p.shade_name ? `호수 ${p.shade_name}${p.shade_count ? ` · ${p.shade_count}가지 중` : ''}` : '호수 정보 없음';
    body.push(el('div', { class: 'bt-prod' },
      p.color_hex ? el('span', { class: 'bt-dot', style: `background:${p.color_hex}`, title: p.color_hex }) : null,
      el('div', {},
        el('strong', { text: `${p.brand} ${p.name}` }),
        el('div', { text: shade }),
        el('div', { class: 'muted small', text: [p.price ? won(p.price) : null, sourceName(p), p.color_source ? '색은 칩 사진 추정값' : null].filter(Boolean).join(' · ') }))));
  } else if (/^\d{8,14}$/.test(e.code)) {
    body.push(el('p', { class: 'muted small', text: '번호는 제대로 읽혔지만 우리 데이터에 없는 제품이에요. 제품 정보를 지어내지 않고 이렇게 안내해요.' }));
  }
  if (e.via === '카메라') {
    body.push(el('button', { type: 'button', class: 'bt-again', text: '같은 바코드 다시 읽기', onclick: () => {
      scanner.forget();
      markSince('다시 읽기 누른 뒤');
      $('bt-status').textContent = '같은 바코드도 다시 읽어요. 바코드를 다시 비춰 주세요.';
    } }));
  }
  $('bt-result').replaceChildren(...body);
}

function renderLog() {
  const rows = log.map((e) => el('tr', {},
    el('td', { text: e.at }),
    el('td', { class: 'mono', text: e.code }),
    el('td', { text: e.format }),
    el('td', { text: e.tookText || '-' }),
    el('td', { text: e.product ? shortName(e.product) : e.verdict })));
  $('bt-rows').replaceChildren(...(rows.length ? rows : [el('tr', { class: 'empty' }, el('td', { colspan: 5, text: '아직 없어요' }))]));
  const found = log.filter((e) => e.product).length;
  $('bt-count').textContent = log.length ? `· ${log.length}번 읽음, 등록 제품 ${found}번` : '';
}

$('bt-clear').addEventListener('click', () => {
  log.length = 0;
  renderLog();
});

// ---------- 카메라 말고: 번호 입력·사진 ----------
$('bt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('bt-input').value.replace(/\s/g, '');
  if (!v) return;
  $('bt-input').value = '';
  lookup(v, { via: '번호 입력' });
});

$('bt-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('bt-status').textContent = '사진에서 바코드를 찾는 중이에요…';
  const t0 = performance.now();
  const code = await decodeImageFile(file).catch(() => null);
  if (!code) { $('bt-status').textContent = '사진에서 바코드를 찾지 못했어요. 바코드가 가운데에 크고 선명하게 나온 사진으로 다시 해 주세요.'; return; }
  const tookText = `사진 읽는 데 ${sec(performance.now() - t0)}`;
  $('bt-status').textContent = `사진에서 읽었어요 (${tookText})`;
  lookup(code, { via: '사진', tookText });
});

// ---------- 시험용 바코드 그리기 (EAN-13, 12자리 UPC-A 는 앞에 0을 붙여 같은 막대) ----------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((s) => s.replace(/./g, (b) => (b === '0' ? '1' : '0')));
const G = R.map((s) => [...s].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 막대 (1=검정) 95칸 */
function ean13Bits(code13) {
  const d = [...code13].map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

function drawBarcode(canvas, code) {
  const bits = ean13Bits(code.length === 12 ? '0' + code : code);
  const m = 6, quiet = 12, top = 24, barH = 240, guardH = 28, textH = 60;
  canvas.width = (bits.length + quiet * 2) * m;
  canvas.height = top + barH + guardH + textH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    ctx.fillRect((quiet + i) * m, top, m, barH + (isGuard ? guardH : 0));
  }
  ctx.font = '600 40px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(code, canvas.width / 2, top + barH + guardH + 44);
}

async function renderSamples() {
  const box = $('bt-samples');
  const names = await Promise.all(SAMPLES.map(async (code) => {
    const r = await api('api/products/barcode/' + code).catch(() => null);
    return r?.ok && r.body.found ? shortName(r.body.product) : '등록 안 된 번호 (일부러)';
  }));
  box.replaceChildren(...SAMPLES.map((code, i) => el('button', {
    type: 'button', 'aria-pressed': 'false',
    onclick: (e) => {
      box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      drawBarcode($('bt-code'), code);
      $('bt-code').classList.remove('hidden');
    },
  }, `${names[i]} · ${code}`)));
}

// ---------- 시작 ----------
$('bt-back').addEventListener('click', () => {
  // 관리자 화면은 맨 위 창에서 연다 (키오스크 틀 안이면 틀 밖으로)
  try { window.top.location.href = new URL('admin.html', window.top.location.href).href; } catch { location.href = 'admin.html'; }
});
const saved = store.get();
if (saved) {
  $('bt-cams').append(el('option', { value: saved, text: '지난번에 고른 카메라' }));
  $('bt-cams').value = saved;
}
renderSamples();
