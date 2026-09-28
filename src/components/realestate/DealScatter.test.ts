import { describe, it, expect } from 'vitest';
import { monthValue, rollingMedian } from './DealScatter';

describe('monthValue — 거래 시점 펼치기', () => {
  it('월이 1 늘면 값도 1 늘어난다 — 3개월 창을 뺄셈으로 잴 수 있어야 한다', () => {
    expect(monthValue('202603', null) - monthValue('202602', null)).toBeCloseTo(
      1,
    );
  });

  it('연말·연초를 건너도 연속이다', () => {
    expect(monthValue('202601', null) - monthValue('202512', null)).toBeCloseTo(
      1,
    );
  });

  it('같은 달이면 일자 순으로 정렬된다', () => {
    expect(monthValue('202603', 5)).toBeLessThan(monthValue('202603', 20));
  });

  it('일자가 없으면 월 시작으로 본다', () => {
    expect(monthValue('202603', null)).toBe(monthValue('202603', 1));
  });
});

describe('rollingMedian — 3개월 이동 중앙값', () => {
  const p = (ym: string, y: number) => ({ t: monthValue(ym, 15), y });

  it('첫 점은 자기 자신이 중앙값', () => {
    expect(rollingMedian([p('202601', 100)])[0]).toBe(100);
  });

  it('3개월 안의 값만 본다 — 오래된 거래는 창에서 빠진다', () => {
    const pts = [
      p('202601', 100),
      p('202602', 200),
      p('202603', 300),
      p('202606', 900),
    ];
    const med = rollingMedian(pts);
    expect(med[2]).toBe(200); // 1·2·3월 중앙값
    expect(med[3]).toBe(900); // 6월은 3개월 창에 혼자
  });

  it('건수 기준 창이 아니다 — 같은 달에 몰린 거래를 모두 포함한다', () => {
    const pts = [
      { t: monthValue('202603', 2), y: 100 },
      { t: monthValue('202603', 10), y: 200 },
      { t: monthValue('202603', 20), y: 300 },
      { t: monthValue('202603', 28), y: 400 },
    ];
    // 최근 3건이면 200·300·400 → 300. 3개월 창이면 네 건 전부 → 250.
    expect(rollingMedian(pts)[3]).toBe(250);
  });

  it('짝수 개는 가운데 두 값의 평균', () => {
    const pts = [p('202601', 100), p('202602', 300)];
    expect(rollingMedian(pts)[1]).toBe(200);
  });

  it('빈 입력은 빈 배열', () => {
    expect(rollingMedian([])).toEqual([]);
  });

  it('원본 순서를 훼손하지 않는다 — 정렬이 in-place 로 새지 않아야 한다', () => {
    const pts = [p('202601', 300), p('202602', 100), p('202603', 200)];
    const before = pts.map(x => x.y);
    rollingMedian(pts);
    expect(pts.map(x => x.y)).toEqual(before);
  });
});
