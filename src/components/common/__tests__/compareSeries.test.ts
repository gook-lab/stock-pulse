import { describe, it, expect } from 'vitest';
import { calcMinMax, pathFromData } from '../PriceChart.helpers';

describe('compareSeries helpers', () => {
  describe('calcMinMax', () => {
    it('메인 데이터만으로 min/max 계산', () => {
      const data = [100, 200, 150, 300, null, 250];
      const result = calcMinMax(data, []);
      expect(result.min).toBe(100);
      expect(result.max).toBe(300);
    });

    it('compareSeries 값들이 min/max에 포함된다', () => {
      const data = [100, 200, 150];
      const compareSeries = [
        { name: 'compare1', data: [50, 400, 200], color: '#FF0000' },
      ];
      const result = calcMinMax(data, compareSeries);
      expect(result.min).toBe(50); // compareSeries의 최솟값
      expect(result.max).toBe(400); // compareSeries의 최댓값
    });

    it('compareSeries 2개 주입 시 모든 값 기준으로 계산된다', () => {
      const data = [100, 200, 150];
      const compareSeries = [
        { name: 'compare1', data: [80, 180, 120], color: '#FF0000' },
        { name: 'compare2', data: [90, 220, 140], color: '#00FF00' },
      ];
      const result = calcMinMax(data, compareSeries);
      // 모든 값: 100, 200, 150, 80, 180, 120, 90, 220, 140
      expect(result.min).toBe(80);
      expect(result.max).toBe(220);
    });

    it('null 값은 min/max 계산에서 제외', () => {
      const data = [100, null, 150, null];
      const compareSeries = [
        { name: 'compare1', data: [50, null, 200, null], color: '#FF0000' },
      ];
      const result = calcMinMax(data, compareSeries);
      // 유효값: 100, 150, 50, 200
      expect(result.min).toBe(50);
      expect(result.max).toBe(200);
    });

    it('모든 값이 null이면 min:0, max:1 반환', () => {
      const data = [null, null];
      const result = calcMinMax(data, []);
      expect(result.min).toBe(0);
      expect(result.max).toBe(1);
    });
  });

  describe('pathFromData', () => {
    const config = {
      data: [100, 200, 150, 300],
      n: 4,
      minMax: { min: 100, max: 300 },
      pad: { l: 6, r: 6, t: 16, b: 12 },
      w: 100,
      height: 250,
    };

    it('정상 데이터로 경로 생성', () => {
      const path = pathFromData(config);
      expect(path).toContain('M'); // 시작
      expect(path).toContain('L'); // 라인
      expect(path.length).toBeGreaterThan(0);
    });

    it('null 구간에서 라인이 끊긴다', () => {
      const dataWithNull = [100, 200, null, 300];
      const configWithNull = {
        ...config,
        data: dataWithNull,
      };
      const path = pathFromData(configWithNull);
      const moveCount = (path.match(/M/g) || []).length;
      expect(moveCount).toBeGreaterThan(1); // 적어도 2개 이상의 M(이동)이 있어야 함
    });

    it('연속된 null은 라인을 계속 끊은 상태 유지', () => {
      const dataWithNulls = [100, null, null, 300];
      const configWithNulls = {
        ...config,
        data: dataWithNulls,
      };
      const path = pathFromData(configWithNulls);
      // 100 포인트와 300 포인트만 연결
      expect(path).toContain('M');
      const parts = path.split('M').filter(p => p.trim().length > 0);
      expect(parts.length).toBeGreaterThan(1);
    });

    it('스케일이 메인 데이터의 min/max 기준으로 적용되어야 한다', () => {
      const dataSmall = [100, 110, 120];
      const configSmall = {
        ...config,
        data: dataSmall,
        minMax: { min: 100, max: 120 },
      };
      const path1 = pathFromData(configSmall);

      // 같은 데이터지만 min/max가 더 크면
      const configLarge = {
        ...configSmall,
        minMax: { min: 0, max: 200 },
      };
      const path2 = pathFromData(configLarge);

      // 경로 문자열이 다르다(Y좌표가 다름)
      expect(path1).not.toBe(path2);
    });
  });

  describe('compareSeries 미지정 시 기존 동작', () => {
    it('compareSeries 미지정 시 메인 데이터만으로 계산', () => {
      const data = [100, 200, 150];
      const resultWithEmpty = calcMinMax(data, []);
      const resultWithoutCompare = calcMinMax(data, undefined);
      // 기존 동작과 동일해야 함
      expect(resultWithEmpty.min).toBe(resultWithoutCompare.min);
      expect(resultWithEmpty.max).toBe(resultWithoutCompare.max);
    });

    it('경로 생성이 단순 데이터일 때와 동일', () => {
      const config = {
        data: [100, 200, 150, 300],
        n: 4,
        minMax: { min: 100, max: 300 },
        pad: { l: 6, r: 6, t: 16, b: 12 },
        w: 100,
        height: 250,
      };
      const path = pathFromData(config);
      // 단순한 라인은 정확히 n개의 L 커맨드를 가져야 함(M으로 시작, L로 연결)
      // 그러나 첫 null이 아니면 M 1개 + L 3개
      const parts = path.split(/[ML]/).filter(p => p.trim().length > 0);
      expect(parts.length).toBe(4); // 4개 포인트의 좌표들
    });
  });
});
