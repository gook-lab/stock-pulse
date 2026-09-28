import { useEffect, useMemo, useState } from 'react';
import PriceChart, { type Period } from '@/components/common/PriceChart';
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  Segmented,
} from '@/components/common';
import { calculateReturns, calculateExcessReturn } from '@/lib/returns';
import { signColor, fmt } from '@/lib/colors';
import { useStore } from '@/store/useStore';
import type { CompareSeries } from '@/components/common/PriceChart.helpers';
import type { PortfolioHistoryEntry } from '@/data/types';

const PERIOD_OPTIONS = [
  { value: '22', label: '1개월' },
  { value: '66', label: '3개월' },
  { value: '250', label: '1년' },
  { value: '0', label: '전체' },
];

type DayCountStr = '22' | '66' | '250' | '0';

export default function ReturnChart() {
  const mode = useStore(st => st.colorMode);
  const [dayCountStr, setDayCountStr] = useState<DayCountStr>('66'); // 3개월 기본
  const dayCount = parseInt(dayCountStr, 10);
  const [entries, setEntries] = useState<PortfolioHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const api = (await import('@/data/httpApi')).httpApi;
        const result = await api.getPortfolioHistory(dayCount);
        setEntries(result.entries);
      } catch (e) {
        setError(e instanceof Error ? e.message : '로드 실패');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [dayCount]);

  // 표시할 데이터 슬라이스 (dayCount에 맞게)
  const displayEntries = useMemo(() => {
    if (!entries) return [];
    if (dayCount === 0) return entries; // 전체
    return entries.slice(-dayCount);
  }, [entries, dayCount]);

  // 수익률 계산
  const returns = useMemo(() => {
    return calculateReturns(displayEntries);
  }, [displayEntries]);

  // 마지막 값들 (헤더 표시용)
  const lastMyReturn = returns.my[returns.my.length - 1];
  const lastKospiReturn = returns.kospi[returns.kospi.length - 1];
  const lastSpxReturn = returns.spx[returns.spx.length - 1];
  const excessKospi = calculateExcessReturn(lastMyReturn, lastKospiReturn);
  const excessSpx = calculateExcessReturn(lastMyReturn, lastSpxReturn);

  // compareSeries 구성
  const compareSeries = useMemo((): Partial<
    Record<Period, CompareSeries[]>
  > => {
    const series: CompareSeries[] = [];
    if (returns.kospi.length > 0) {
      series.push({
        name: 'KOSPI',
        data: returns.kospi,
        color: 'var(--text-sub)', // 보조 톤 — 회색 계열
      });
    }
    if (returns.spx.length > 0) {
      series.push({
        name: 'S&P 500',
        data: returns.spx,
        color: 'var(--text-mut)', // 더 밝은 회색 계열
      });
    }
    return { '1개월': series, '3개월': series, '1년': series, '5년': series };
  }, [returns]);

  // 로딩 상태
  if (loading) {
    return (
      <section className="card">
        <div className="card-h">
          <span className="t">수익률 비교</span>
        </div>
        <CardSkeleton height={280} />
      </section>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <section className="card">
        <div className="card-h">
          <span className="t">수익률 비교</span>
        </div>
        <ErrorState
          title="데이터 로드 실패"
          desc={error}
          onRetry={() => window.location.reload()}
        />
      </section>
    );
  }

  // 데이터 부족 상태 (2개 미만)
  if (displayEntries.length < 2) {
    const firstDate =
      entries?.[0]?.date ?? new Date().toISOString().split('T')[0];
    const hint =
      entries?.length === 0
        ? '서버가 켜져 있는 동안 매일 자동 기록됩니다'
        : `수집 시작: ${firstDate}`;
    return (
      <section className="card">
        <div className="card-h">
          <span className="t">수익률 비교</span>
        </div>
        <EmptyState title="수익률 이력 수집 중" desc={hint} />
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-h">
        <span className="t">수익률 비교</span>
        <Segmented
          options={PERIOD_OPTIONS}
          value={dayCountStr}
          onChange={v => setDayCountStr(v as DayCountStr)}
        />
      </div>

      {/* 헤더: 기간 수익률 + 초과수익 */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 16,
          flexWrap: 'wrap',
          fontSize: 12,
        }}
      >
        <div>
          <div style={{ color: 'var(--text-mut)', marginBottom: 4 }}>
            내 수익률
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              fontFamily: 'var(--mono)',
              color:
                lastMyReturn != null && lastMyReturn !== 0
                  ? signColor(lastMyReturn, mode)
                  : 'var(--text)',
            }}
          >
            {lastMyReturn != null
              ? `${lastMyReturn >= 0 ? '+' : ''}${fmt(lastMyReturn, 2)}%`
              : '—'}
          </div>
        </div>

        {excessKospi != null && (
          <div>
            <div style={{ color: 'var(--text-mut)', marginBottom: 4 }}>
              KOSPI 초과수익
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                fontFamily: 'var(--mono)',
                color: excessKospi >= 0 ? 'var(--text)' : 'var(--text-sub)',
              }}
            >
              {excessKospi >= 0 ? '+' : ''}
              {fmt(excessKospi, 2)}%p
            </div>
          </div>
        )}

        {excessSpx != null && (
          <div>
            <div style={{ color: 'var(--text-mut)', marginBottom: 4 }}>
              S&P 초과수익
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                fontFamily: 'var(--mono)',
                color: excessSpx >= 0 ? 'var(--text)' : 'var(--text-sub)',
              }}
            >
              {excessSpx >= 0 ? '+' : ''}
              {fmt(excessSpx, 2)}%p
            </div>
          </div>
        )}
      </div>

      {/* 차트 */}
      <PriceChart
        name="포트폴리오"
        code="PORTFOLIO"
        cur="%"
        dec={2}
        series={{
          '1개월': returns.my,
          '3개월': returns.my,
          '1년': returns.my,
          '5년': returns.my,
        }}
        compareSeries={compareSeries}
        mode={mode}
        defaultPeriod="3개월"
        height={250}
      />
    </section>
  );
}
