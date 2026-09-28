import { describe, it, expect } from 'vitest';
import { calcMinMax } from '../PriceChart.helpers';

describe('PriceChart backward compatibility', () => {
  it('compareSeries 미지정 시 메인 데이터만 기준', () => {
    const data = [100, 200, 150];

    // compareSeries 없음
    const resultWithout = calcMinMax(data, []);

    // compareSeries undefined
    const resultUndefined = calcMinMax(data, undefined);

    // 동일해야 함
    expect(resultWithout.min).toBe(resultUndefined.min);
    expect(resultWithout.max).toBe(resultUndefined.max);
  });

  it('null이 포함된 데이터도 기존과 동일', () => {
    const data = [100, null, 150, 200, null];
    const result = calcMinMax(data, []);
    expect(result.min).toBe(100);
    expect(result.max).toBe(200);
  });

  it('compareSeries가 있어도 메인만으로 충분하면 메인만 사용', () => {
    const data = [100, 200, 150];
    // 메인 범위 내에서만 있는 비교 시리즈
    const compareSeries = [
      { name: 'compare1', data: [110, 190, 140], color: '#FF0000' },
    ];
    const result = calcMinMax(data, compareSeries);
    // 메인과 비교가 모두 포함되어야 함
    expect(result.min).toBe(100);
    expect(result.max).toBe(200);
  });

  it('모든 비교 시리즈가 null인 경우도 처리', () => {
    const data = [100, 200];
    const compareSeries = [
      { name: 'compare1', data: [null, null], color: '#FF0000' },
    ];
    const result = calcMinMax(data, compareSeries);
    expect(result.min).toBe(100);
    expect(result.max).toBe(200);
  });
});
