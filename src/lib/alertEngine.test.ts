import { describe, it, expect } from 'vitest';
import { evaluate } from './alertEngine';
import type { PriceAlert } from '@/data/types';

describe('alertEngine - evaluate', () => {
  describe('target-above (목표가 이상)', () => {
    it('현재가 >= 목표가이면 true', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-above',
        value: 70000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 70000, changePct: 0 })).toBe(true);
      expect(evaluate(alert, { price: 70001, changePct: 0 })).toBe(true);
    });
    it('현재가 < 목표가이면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-above',
        value: 70000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 69999, changePct: 0 })).toBe(false);
    });
    it('경계값(정확히 목표가) 포함', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-above',
        value: 10000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 10000, changePct: 0 })).toBe(true);
    });
  });

  describe('target-below (목표가 이하)', () => {
    it('현재가 <= 목표가이면 true', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-below',
        value: 50000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 50000, changePct: 0 })).toBe(true);
      expect(evaluate(alert, { price: 49999, changePct: 0 })).toBe(true);
    });
    it('현재가 > 목표가이면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-below',
        value: 50000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 50001, changePct: 0 })).toBe(false);
    });
    it('경계값(정확히 목표가) 포함', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'target-below',
        value: 10000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 10000, changePct: 0 })).toBe(true);
    });
  });

  describe('move-pct (등락률)', () => {
    it('value > 0: changePct >= value이면 true', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'move-pct',
        value: 5,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100, changePct: 5 })).toBe(true);
      expect(evaluate(alert, { price: 100, changePct: 5.1 })).toBe(true);
    });
    it('value > 0: changePct < value이면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'move-pct',
        value: 5,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100, changePct: 4.9 })).toBe(false);
    });
    it('value < 0: changePct <= value이면 true (음수 방향)', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'move-pct',
        value: -3,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100, changePct: -3 })).toBe(true);
      expect(evaluate(alert, { price: 100, changePct: -3.1 })).toBe(true);
    });
    it('value < 0: changePct > value이면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'move-pct',
        value: -3,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100, changePct: -2.9 })).toBe(false);
    });
  });

  describe('high52 (52주 신고가)', () => {
    it('baseline 있고 현재가 > baseline이면 true', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'high52',
        value: 0,
        baseline: 100000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100001, changePct: 0 })).toBe(true);
    });
    it('baseline 있고 현재가 = baseline이면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'high52',
        value: 0,
        baseline: 100000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100000, changePct: 0 })).toBe(false);
    });
    it('baseline 없으면 false', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'high52',
        value: 0,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100001, changePct: 0 })).toBe(false);
    });
    it('baseline < 현재가일 때 true', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'high52',
        value: 0,
        baseline: 50000,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 75000, changePct: 0 })).toBe(true);
    });
  });

  describe('switch default (알 수 없는 kind)', () => {
    it('invalid kind로 evaluate하면 false 반환', () => {
      const alert: PriceAlert = {
        id: '1',
        code: '005930',
        name: 'Samsung',
        market: 'KR',
        kind: 'invalid' as any,
        value: 100,
        createdAt: Date.now(),
      };
      expect(evaluate(alert, { price: 100, changePct: 0 })).toBe(false);
    });
  });
});
