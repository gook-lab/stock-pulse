/** 거래 시점을 "연*12+월 + 일" 로 펼친 연속값. 월 단위 산술이 되므로 3개월 창을 그대로 잴 수 있다. */
export function monthValue(ym: string, day: number | null): number {
  const yy = parseInt(ym.slice(0, 4), 10);
  const mm = parseInt(ym.slice(4, 6), 10);
  return yy * 12 + mm + (day ? (day - 1) / 31 : 0);
}

/**
 * 3개월 이동 중앙값 — "최근 3건"이 아니라 진짜 3개월 창이다.
 * 거래가 몰린 달과 비어 있는 달이 섞여 있어서 건수 기준 창은 기간이 멋대로 늘어난다
 * (서버 시그널 엔진도 기간 기준 중앙값을 쓴다 — 화면과 신호가 어긋나면 안 된다).
 */
export function rollingMedian(
  pts: { t: number; y: number }[],
  months = 3,
): (number | null)[] {
  return pts.map(p => {
    const win = pts.filter(q => q.t <= p.t && q.t > p.t - months).map(q => q.y);
    if (!win.length) return null;
    win.sort((a, b) => a - b);
    const mid = win.length >> 1;
    return win.length % 2 ? win[mid] : (win[mid - 1] + win[mid]) / 2;
  });
}
