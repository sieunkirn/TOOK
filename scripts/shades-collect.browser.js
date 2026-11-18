// 호수 수집기 (브라우저용). www.oliveyoung.co.kr 의 아무 페이지에서 실행한다 (개발자 도구 콘솔에 붙여 넣기).
// 상품 상세 페이지 HTML 안의 옵션 데이터(옵션 이름·표준 바코드·색상 칩 사진)를 읽고,
// 색상 칩 사진에서 대표색과 판정용 수치(흰 바탕 비율·회색 비율)를 계산해 로컬 수집 서버로 보낸다.
//   1) 터미널: npm run shades:server      (http://localhost:8766)
//   2) 올리브영 페이지 콘솔: 이 파일 내용을 붙여 넣고 → tookCollect() 실행
//   서버로 못 보내는 브라우저면: tookCollect({ memory: true, only: [...상품번호] }) → 끝나면 tookDownload()
//      → npm run shades:import-raw -- <받은 파일>  (2026-11-17 첫 수집은 이 방법으로 했다)
//   진행 상황: window.__tookCollect   (멈추기: window.__tookCollect.stop = true)
// 서버에 무리를 주지 않도록 상품 사이에 기본 3초씩 쉰다. 이미 모은 상품은 서버가 알려 주므로 건너뛴다.
// 판정(쓸 수 있는 색인지)은 여기서 하지 않고 scripts/build-shades-source.js 가 한다 (기준을 바꿔도 다시 모을 필요 없음).
(() => {
  const SINK = 'http://localhost:8766';
  const IMG_BASE = 'https://image.oliveyoung.co.kr/cfimages/cf-goods/uploads/images/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // sRGB → Lab (판정용 회색 비율 계산)
  const lab = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const R = f(r), G = f(g), B = f(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
  };

  // 칩 사진 → 대표색(흰 바탕을 빼고 밝기 순 가운데 40% 평균) + 흰 바탕 비율 + 회색(무채색) 비율
  async function measure(path) {
    const blob = await (await fetch(IMG_BASE + path + '?RS=120x0&QT=95', { mode: 'cors' })).blob();
    const bm = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bm.width, bm.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bm, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const px = [];
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const p = [d[i], d[i + 1], d[i + 2]];
      const mx = Math.max(...p), mn = Math.min(...p);
      if (mn > 225 && mx - mn < 18) { white++; continue; }
      px.push(p);
    }
    const n = d.length / 4;
    if (!px.length) return { hex: null, white: 1, grey: 1 };
    const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    px.sort((a, b) => lum(a) - lum(b));
    const mid = px.slice(Math.floor(px.length * 0.3), Math.floor(px.length * 0.7));
    const avg = [0, 1, 2].map((k) => Math.round(mid.reduce((s, p) => s + p[k], 0) / Math.max(1, mid.length)));
    const grey = px.filter((p) => { const L = lab(p); return Math.hypot(L[1], L[2]) < 10; }).length / px.length;
    return {
      hex: '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(),
      white: +(white / n).toFixed(3), grey: +grey.toFixed(3),
    };
  }

  // 상세 페이지 HTML 안의 옵션 데이터 (같은 옵션이 여러 번 나오므로 옵션 번호로 한 번만)
  function parseOptions(html, goodsNo) {
    const h = html.replace(/\\"/g, '"');
    const re = /\{"goodsNumber":"(A\d+)","optionNumber":"(\d+)","standardCode":"([^"]*)","optionName":"((?:[^"\\]|\\.)*)"[\s\S]*?"optionImage":(null|\{"url":"[^"]*","path":"([^"]*)"\}),"colorChipImage":(null|\{"url":"[^"]*","path":"([^"]*)"\})[\s\S]*?"soldOutFlag":(true|false)/g;
    const map = new Map();
    let m;
    while ((m = re.exec(h))) {
      if (m[1] !== goodsNo || map.has(m[2])) continue;
      let alt = m[4];
      try { alt = JSON.parse('"' + alt + '"'); } catch { /* & 같은 이스케이프를 풀지 못하면 그대로 */ }
      map.set(m[2], { opt: m[2], barcode: m[3] || null, alt, img: m[8] || m[6] || null, chip: !!m[8], soldOut: m[9] === 'true' });
    }
    return [...map.values()];
  }

  async function collectOne(goodsNo) {
    const res = await fetch('/store/goods/getGoodsDetail.do?goodsNo=' + goodsNo);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    if (!html.includes('goodsNumber')) throw new Error('옵션 데이터 없음 (차단 화면일 수 있음)');
    const options = parseOptions(html, goodsNo);
    // 칩 사진(이미지 서버)은 8장씩 한꺼번에 잰다. 상세 페이지 요청 사이의 쉬는 시간은 tookCollect 의 delayMs
    for (let i = 0; i < options.length; i += 8) {
      await Promise.all(options.slice(i, i + 8).map(async (o) => {
        try { Object.assign(o, o.img ? await measure(o.img) : { hex: null }); } catch (e) { o.err = String(e).slice(0, 80); }
      }));
    }
    return options;
  }

  // 수집 서버로 바로 보낸다. 브라우저가 공개 사이트 → localhost 요청을 막으면(Chrome 로컬 네트워크 보호, Claude 앱 브라우저 창 등)
  // 허용을 누르거나, memory 모드로 모아 tookDownload() 로 받는다
  async function call(path, body) {
    const r = await fetch(SINK + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    if (!r.ok) throw new Error('수집 서버 응답 ' + r.status);
    return r.json();
  }
  const post = (path, body) => call(path, body);

  // memory: true → 서버로 보내지 않고 이 창에 모아 둔다 (브라우저가 localhost 요청을 막을 때).
  // 다 모으면 tookDownload() 로 JSON 파일 하나로 받아서 npm run shades:import-raw <파일> 로 넣는다
  window.__tookResults ||= [];
  window.tookCollect = async ({ delayMs = 3000, only = null, memory = false } = {}) => {
    const todo = only || (await call('/todo')).todo;
    const st = (window.__tookCollect = { total: todo.length, done: 0, failed: [], stop: false, running: true });
    const save = memory ? async (body) => { window.__tookResults.push(body); } : (body) => post('/collect', body);
    for (const goodsNo of todo) {
      if (st.stop) break;
      st.current = goodsNo;
      try {
        const options = await collectOne(goodsNo);
        await save({ goodsNo, collected_at: new Date().toISOString(), options });
      } catch (e) {
        st.failed.push(goodsNo + ' ' + e.message);
        await save({ goodsNo, collected_at: new Date().toISOString(), error: e.message }).catch(() => {});
      }
      st.done++;
      await sleep(delayMs);
    }
    st.running = false;
    return st;
  };
  window.tookDownload = (name = 'took-shades-raw.json') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(window.__tookResults)], { type: 'application/json' }));
    a.download = name;
    a.click();
    return window.__tookResults.length;
  };
})();
