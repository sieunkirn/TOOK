// 브라우저 수집기(shades-collect.browser.js)를 memory 모드로 돌려 받은 JSON 파일 하나를
// 상품별 원자료 파일(src/data/shades-raw/<상품번호>.json)로 나눠 넣는다.
//   npm run shades:import-raw -- <받은 파일 경로>      (그다음 npm run shades:build)
// 실패한 상품은 이미 성공한 자료를 덮어쓰지 않는다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './build-shades-source.js';

const file = process.argv[2];
if (!file) {
  console.error('사용법: npm run shades:import-raw -- <took-shades-raw.json 경로>');
  process.exit(1);
}
const list = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(list)) throw new Error('배열 형식의 수집 파일이 아니에요');
mkdirSync(RAW_DIR, { recursive: true });
let ok = 0, failed = 0, kept = 0;
for (const body of list) {
  if (!/^A\d{9,}$/.test(body?.goodsNo || '')) continue;
  const out = join(RAW_DIR, body.goodsNo + '.json');
  if (body.error) {
    failed++;
    if (existsSync(out) && !JSON.parse(readFileSync(out, 'utf8')).error) { kept++; continue; }
  } else ok++;
  writeFileSync(out, JSON.stringify(body, null, 1) + '\n');
}
console.log(`성공 ${ok}개, 실패 ${failed}개 (그중 예전 성공 자료를 남긴 것 ${kept}개) → ${RAW_DIR}`);
