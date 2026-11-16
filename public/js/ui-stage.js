// 프로토타입(TOOK_prototype, Figma 900×1440) 화면 틀: 모든 요소를 900×1440 좌표에 그대로 두고,
// 창 크기에 맞게 통째로 줄이거나 키운다 (키오스크 틀 kiosk.html 안에서는 배율 1).
// 남는 곳은 검정 (원본 프로토타입 App.css 와 같은 규칙)
export const W = 900;
export const H = 1440;

export function fitStage(stage) {
  const fit = () => {
    const k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--k', String(k));
  };
  addEventListener('resize', fit);
  fit();
  return () => Number(getComputedStyle(stage).getPropertyValue('--k')) || 1;
}

/** 화면 좌표(clientX/Y) → 900×1440 무대 좌표 */
export function toStage(stage, e) {
  const r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
