// 카메라 바코드 스캐너. 윈도우 크롬에는 브라우저 내장 BarcodeDetector 가 없어 ZXing(로컬 제공, public/vendor/zxing)을 쓴다.
// 립 제품 바코드(EAN-13/EAN-8/UPC)와 CODE-128 을 읽는다. 같은 번호가 연달아 읽히면 한 번만 알린다.

let libLoading = null;

export function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!libLoading) {
    libLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/zxing/zxing.min.js', import.meta.url).href;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing 없음')));
      s.onerror = () => reject(new Error('바코드 인식 라이브러리를 불러오지 못했습니다. (npm install 필요)'));
      document.head.append(s);
    }).catch((e) => {
      libLoading = null;
      throw e;
    });
  }
  return libLoading;
}

export function cameraErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '카메라 권한이 거부되었어요. 주소창의 카메라 권한을 허용하거나, 아래에 바코드 번호를 입력해 주세요.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '사용할 수 있는 카메라를 찾지 못했어요. 아래에 바코드 번호를 입력해 주세요.';
    case 'NotReadableError':
      return '카메라를 다른 화면이나 프로그램에서 쓰고 있어요. 그쪽 카메라를 끄고 다시 눌러 주세요.';
    default:
      return '카메라를 켜지 못했어요: ' + (e?.message || e);
  }
}

// 웹캠 영상은 작고 흐리고 잡음이 많아 원본 그대로는 거의 읽히지 않는다(시험: 18가지 중 1가지).
// 프레임마다 아래 변형을 하나씩 돌아가며 읽는다: 원본 / 살짝 흐림(잡음·계단 현상 제거) / 가운데 확대 / 세로로 든 바코드(90° 회전) / 더 흐림
// / 가운데 절반을 흐림 없이 2배 확대(2026-11-18 추가: 바코드가 작거나 흐리고 배경이 넓을 때. 바코드 카메라 테스트 화면의 합성 장면 12가지에서
// 기존 5가지가 모두 놓친 3가지 중 2가지를 읽음, 이것 하나만으로 11가지).
// crop: 가운데 비율, up: 확대 배율, smooth: 흐림(px), rotate: 회전(도)
// avg (2026-11-18 추가): 막대 방향으로 avg 줄씩 평균내 읽는다(ux: 가로만 확대). 잡음은 줄고 막대 폭은 그대로라 흐린 웹캠 영상에 강하고,
// 읽을 줄이 줄어 한 번 읽는 시간도 1/3~1/4. 합성 장면 30가지(막대 1.3~4px, 흐림 0~2px, 잡음, 라벨보다 어두운 배경)에서
// 기존 변형 전부를 합쳐 9가지 → avg 변형 3가지로 13가지. 그래서 avg 변형을 자주, 기존 변형은 사이사이에 돈다.
const AVG = [{ avg: 4 }, { crop: 0.5, avg: 4, ux: 1.5 }, { crop: 0.35, avg: 2, ux: 3 }];
const VARIANTS = [
  ...AVG, {}, ...AVG, { rotate: 90, avg: 4 }, ...AVG, { crop: 0.6, up: 1.6, smooth: 1 }, ...AVG, { smooth: 1 },
  ...AVG, { rotate: 90, smooth: 1 }, ...AVG, { crop: 0.5, up: 2 }, ...AVG, { smooth: 2 }, ...AVG, { crop: 0.6, up: 2, smooth: 1.5 },
  ...AVG, { rotate: 90, crop: 0.5, avg: 2, ux: 1.5 },
];
const MAX_WORK_WIDTH = 1600; // 확대해도 이 폭을 넘지 않게 해 한 번 읽는 시간을 줄인다

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });

// 이미지(카메라 프레임·사진)를 변형해 work 캔버스에 그린다
function drawVariant(src, { crop = 1, up = 1, smooth = 0, rotate = 0 }) {
  const sw = src.width * crop, sh = src.height * crop;
  const sx = (src.width - sw) / 2, sy = (src.height - sh) / 2;
  const k = Math.min(up, MAX_WORK_WIDTH / Math.max(sw, sh));
  const turned = rotate % 180 !== 0;
  work.width = Math.round((turned ? sh : sw) * k);
  work.height = Math.round((turned ? sw : sh) * k);
  workCtx.save();
  workCtx.filter = smooth ? `blur(${smooth}px)` : 'none';
  workCtx.translate(work.width / 2, work.height / 2);
  if (rotate) workCtx.rotate((rotate * Math.PI) / 180);
  workCtx.drawImage(src, sx, sy, sw, sh, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
  workCtx.restore();
  return work;
}

// avg 변형: 캔버스(src)의 가운데(crop)를 막대 방향으로 avg 줄씩 평균낸 밝기 배열로 만든다 (회전 90°면 세로 막대 대신 가로 막대 기준).
// 캔버스 확대(drawImage)는 가로까지 흐려 막대를 뭉개므로 직접 계산한다. ux: 막대를 가로지르는 방향만 선형 확대
function averagedSource(ZXing, src, ctx, { crop = 1, avg = 4, ux = 1, rotate = 0 }) {
  const sw = Math.round(src.width * crop), sh = Math.round(src.height * crop);
  const px = ctx.getImageData(Math.round((src.width - sw) / 2), Math.round((src.height - sh) / 2), sw, sh).data;
  const turned = rotate % 180 !== 0;
  const across = turned ? sh : sw; // 막대를 가로지르는 길이
  const rows = Math.floor((turned ? sw : sh) / avg);
  const w = Math.round(across * ux);
  const out = new Uint8ClampedArray(w * rows);
  const line = new Float32Array(across);
  for (let r = 0; r < rows; r++) {
    line.fill(0);
    for (let j = 0; j < avg; j++) {
      const a = r * avg + j;
      for (let i = 0; i < across; i++) {
        const p = (turned ? i * sw + a : a * sw + i) * 4;
        line[i] += px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114;
      }
    }
    for (let x = 0; x < w; x++) {
      const f = (x + 0.5) / ux - 0.5;
      const i0 = Math.max(0, Math.floor(f)), i1 = Math.min(across - 1, i0 + 1), t = Math.min(1, Math.max(0, f - i0));
      out[r * w + x] = ((1 - t) * line[i0] + t * line[i1]) / avg;
    }
  }
  return new ZXing.RGBLuminanceSource(out, w, rows);
}

// 읽을 바코드 종류. 'retail' = 상품 바코드(EAN·UPC)만: 거울 카메라처럼 늘 켜 두고 읽을 때 엉뚱한 무늬를 잘못 읽지 않게 한다
function makeReader(ZXing, kinds = 'all') {
  const F = ZXing.BarcodeFormat;
  const formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E];
  if (kinds !== 'retail') formats.push(F.CODE_128);
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

/**
 * 사진 파일에서 바코드를 읽는다 (휴대폰 기본 카메라로 찍은 사진 등). 사진은 크고 선명하므로 모든 변형을 차례로 시도한다.
 * 가운데를 크게 잘라 보는 변형을 먼저 해, 사진 속 작은 바코드도 읽히게 한다.
 * @returns {Promise<string|null>}
 */
export async function decodeImageFile(file) {
  const ZXing = await loadZXing();
  const reader = makeReader(ZXing);
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' }); // 휴대폰 사진의 회전 정보 반영
  const tries = [{ crop: 0.5 }, { crop: 0.7 }, {}, { crop: 0.5, smooth: 1 }, { smooth: 1 }, { rotate: 90 }, { crop: 0.5, rotate: 90 }, { smooth: 2 }];
  try {
    for (const v of tries) {
      try {
        return reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(drawVariant(img, v))))).getText();
      } catch {
        // 다음 변형으로
      } finally {
        reader.reset();
      }
    }
    return null;
  } finally {
    img.close?.();
  }
}

// 영상(video)에서 화면을 떠서 VARIANTS 를 하나씩 돌아가며 읽는 루프 (카메라 스캐너·거울 카메라 공통).
// ZXing 의 연속 인식 루프는 첫 프레임 오류에서 조용히 멈추는 경우가 있어, 직접 돈다.
// - interval: 다음 읽기까지 쉬는 시간(ms). busyFactor 를 주면 한 번 읽는 데 걸린 시간 × busyFactor 만큼 더 쉰다
//   (입술 추적과 같이 돌 때 기기가 느려지지 않게)
// - repeatAfter: 같은 번호는 이 시간(ms) 동안 안 보였다가 다시 보여야 또 알린다 (기본: 다른 번호가 나올 때까지 한 번만)
// - active(): false 면 이번 차례는 읽지 않고 쉰다
function readLoop({ video, ZXing, reader, onCode, onProgress, interval = 80, busyFactor = 0, repeatAfter = Infinity, active = null }) {
  const frame = document.createElement('canvas');
  const frameCtx = frame.getContext('2d', { willReadFrequently: true });
  const startedAt = performance.now();
  let running = true;
  let timer = null;
  let last = null;
  let lastSeen = 0;
  let frames = 0;
  let turn = 0;
  const tick = () => {
    if (!running) return;
    let cost = 0;
    if (video.videoWidth && video.videoHeight && (!active || active())) {
      const t0 = performance.now();
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frameCtx.drawImage(video, 0, 0);
      const variant = turn++ % VARIANTS.length;
      const v = VARIANTS[variant];
      try {
        const source = v.avg ? averagedSource(ZXing, frame, frameCtx, v) : new ZXing.HTMLCanvasElementLuminanceSource(drawVariant(frame, v));
        const result = reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source)));
        const code = result.getText();
        const now = performance.now();
        const again = code !== last || now - lastSeen > repeatAfter;
        last = code;
        lastSeen = now;
        if (again) onCode(code, { format: String(ZXing.BarcodeFormat[result.getBarcodeFormat()] ?? ''), variant, frames: frames + 1, ms: now - startedAt });
      } catch {
        // 이 프레임·변형으로는 읽을 수 있는 바코드가 없다
      } finally {
        reader.reset();
      }
      frames++;
      cost = performance.now() - t0;
      onProgress?.({ frames, width: video.videoWidth, height: video.videoHeight, ms: performance.now() - startedAt });
    }
    if (running) timer = setTimeout(tick, interval + cost * busyFactor);
  };
  tick();
  return {
    stop() { running = false; clearTimeout(timer); },
    forget() { last = null; },
  };
}

/**
 * @param {{ video: HTMLVideoElement,
 *   onCode: (code: string, info: { format: string, variant: number, frames: number, ms: number }) => void,
 *   onProgress?: (info: { frames: number, width: number, height: number, ms: number }) => void }} opts
 * start({ deviceId }) 로 카메라를 고를 수 있다 (없거나 빠져 있으면 휴대폰 후면·PC 기본 카메라).
 * start({ stream }) 은 이미 켜진 카메라 영상(예: 팔레트의 입술 카메라)을 같이 쓴다: 카메라를 새로 열지 않고, 끌 때도 그 영상은 그대로 둔다.
 * forget() 은 같은 번호도 다시 알리게 한다.
 */
export function createBarcodeScanner({ video, onCode, onProgress }) {
  let stream = null;
  let owned = false; // 이 스캐너가 연 카메라인지 (빌려 쓴 영상은 끄지 않는다)
  let loop = null;

  async function start({ deviceId, stream: shared } = {}) {
    if (loop) return;
    if (!shared && !navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저 또는 접속 주소에서는 카메라를 쓸 수 없어요. (HTTPS 또는 localhost 필요)');
    const ZXing = await loadZXing();
    const reader = makeReader(ZXing);
    try {
      if (shared) {
        stream = shared;
        owned = false;
      } else {
        // 휴대폰은 후면 카메라, PC 는 웹캠(고른 카메라가 있으면 그것). 바코드는 해상도가 높을수록 잘 읽힌다
        const which = deviceId ? { deviceId: { ideal: deviceId } } : { facingMode: 'environment' };
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...which, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        owned = true;
        // 자동 초점을 지원하는 카메라면 계속 초점을 맞추게 한다 (지원하지 않으면 무시)
        stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      stop(); // 권한 거부·재생 실패 시 켜진 스트림을 정리한다
      throw e;
    }
    loop = readLoop({ video, ZXing, reader, onCode, onProgress });
  }

  function stop() {
    loop?.stop();
    loop = null;
    if (owned) stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    owned = false;
    video.srcObject = null;
  }

  window.addEventListener('pagehide', stop);
  return { start, stop, isRunning: () => !!loop, forget: () => loop?.forget() };
}

/**
 * 이미 켜져 있는 카메라 영상(video)에서 상품 바코드를 계속 찾는다 (팔레트 거울 화면: 입술 카메라 영상을 그대로 쓴다).
 * 카메라를 새로 열지 않고, 기기가 느려지지 않게 천천히(interval) 읽는다. 같은 제품은 repeatAfter 동안 안 보였다가 다시 비춰야 또 알린다.
 * @returns {{ stop: () => void }}
 */
// (2026-11-18) avg 변형은 한 번 읽는 데 20~40ms 라, 0.4초+3배 쉬던 것을 0.2초+2배로 줄여 초당 3~4번 읽는다 (예전 약 1번)
export function watchVideoBarcodes({ video, onCode, interval = 200, busyFactor = 2, repeatAfter = 4000, active = null }) {
  let loop = null;
  let stopped = false;
  loadZXing().then((ZXing) => {
    if (!stopped) loop = readLoop({ video, ZXing, reader: makeReader(ZXing, 'retail'), onCode, interval, busyFactor, repeatAfter, active });
  }).catch(() => { /* 인식 라이브러리를 못 불러오면 바코드 없이 그대로 쓴다 */ });
  const stop = () => { stopped = true; loop?.stop(); };
  window.addEventListener('pagehide', stop);
  return { stop };
}
