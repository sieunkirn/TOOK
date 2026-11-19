// 작은 QR 코드 만들기 (2026-11-19 '가져가기' 화면의 '폰으로 가져가기'). 외부 라이브러리 없이 바이트 모드 · 오류 정정 L · 버전 1~6 (최대 134바이트).
// 상품 주소(올리브영 상품 페이지) 한 줄만 담는다. QR 표준(ISO/IEC 18004)의 순서 그대로:
// 데이터 비트 → 리드-솔로몬 오류 정정 → 블록 섞기 → 기능 패턴(파인더·타이밍·정렬) → 지그재그 배치 → 마스크 0 → 형식 정보
// 검증: test/unit.test.js 가 @zxing/library 로 다시 읽어 원래 글과 같은지 본다

// 버전별 [데이터 코드워드 수(블록 하나), 블록 수, 블록당 오류 정정 코드워드 수] (오류 정정 L)
const TABLE = { 1: [19, 1, 7], 2: [34, 1, 10], 3: [55, 1, 15], 4: [80, 1, 20], 5: [108, 1, 26], 6: [68, 2, 18] };

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

/** text → 모듈 격자 (true = 검은 칸). 담을 수 없으면 null */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = Object.keys(TABLE).map(Number).find((v) => bytes.length <= TABLE[v][0] * TABLE[v][1] - 2);
  if (!version) return null;
  const [perBlock, blocks, ecLen] = TABLE[version];
  const capacity = perBlock * blocks;

  // 1) 데이터 비트: 모드(0100) · 글자 수(8비트) · 바이트들 · 끝 표시 · 채우기
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // 2) 블록마다 오류 정정, 3) 섞기
  const divisor = rsDivisor(ecLen);
  const dBlocks = [];
  const eBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const d = data.slice(b * perBlock, (b + 1) * perBlock);
    dBlocks.push(d);
    eBlocks.push(rsRemainder(d, divisor));
  }
  const words = [];
  for (let i = 0; i < perBlock; i++) dBlocks.forEach((d) => words.push(d[i]));
  for (let i = 0; i < ecLen; i++) eBlocks.forEach((e) => words.push(e[i]));

  // 4) 기능 패턴
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const MASK = 0;
  const format = (() => {
    const v = (1 << 3) | MASK; // 오류 정정 L = 01
    let rem = v;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((v << 10) | rem) ^ 0x5412;
  })();
  const fb = (i) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, fb(i));
  set(8, 7, fb(6));
  set(8, 8, fb(7));
  set(7, 8, fb(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
  set(8, size - 8, true); // 늘 검은 칸

  // 5) 지그재그 배치 (오른쪽 아래부터 두 줄씩, 6번 세로줄은 건너뛴다) + 6) 마스크 0
  const all = [];
  words.forEach((w) => { for (let i = 7; i >= 0; i--) all.push(((w >>> i) & 1) === 1); });
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        const bit = k < all.length ? all[k++] : false;
        mod[y][x] = bit !== ((x + y) % 2 === 0);
      }
    }
  }
  return mod;
}

/** text → SVG 문자열 (흰 바탕 + 둘레 여백 4칸). 담을 수 없으면 '' */
export function qrSvg(text, { label = '' } = {}) {
  const m = qrMatrix(text);
  if (!m) return '';
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"${label ? ` aria-label="${label.replace(/"/g, '&quot;')}"` : ''}><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
