import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Loading, ErrorState } from '@/components/common';
import { fmtTril, fmtAsOf, fmtPercentile, barGeometry } from '@/lib/buffett';
import type { BuffettData, BuffettMarket } from '@/data/types';

/**
 * 버핏지수 카드 — 시가총액 ÷ 명목 GDP.
 *
 * 6시간마다만 바뀌는 값이라 대시보드 일괄 로딩(useStore.load)에 끼우지 않고
 * 카드가 직접 가져온다. 첫 페인트를 ECOS·FRED 왕복만큼 늦출 이유가 없다.
 */
export default function BuffettIndex() {
  const refreshBuffett = useStore(st => st.refreshBuffett);
  const [data, setData] = useState<BuffettData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setData(null);
    refreshBuffett()
      .then(setData)
      .catch(() => setFailed(true));
  }, [refreshBuffett]);

  useEffect(load, [load]);

  const markets = data
    ? [data.kr, data.us].filter((m): m is BuffettMarket => m != null)
    : [];

  return (
    <section className="card">
      <div className="card-h">
        <span className="t">버핏지수</span>
        <span className="tag">시가총액 ÷ GDP</span>
      </div>

      {!data && !failed && <Loading label="시총·GDP 불러오는 중…" />}

      {(failed || (data && markets.length === 0)) && (
        <ErrorState
          title="버핏지수를 집계하지 못했습니다"
          desc="한국은행 ECOS·FRED 조회가 실패했습니다. 잠시 후 다시 시도하세요."
          onRetry={load}
        />
      )}

      {markets.map(m => (
        <MarketRow key={m.label} m={m} />
      ))}
    </section>
  );
}

function MarketRow({ m }: { m: BuffettMarket }) {
  const geo = barGeometry(m);
  const pct = fmtPercentile(m.percentile);
  // 등락이 아니라 밸류에이션이므로 signColor를 쓰지 않는다. 10년 분포 상단권만 경고색.
  const hot = m.percentile != null && m.percentile >= 80;
  const accent = hot ? 'var(--warn)' : 'var(--brand)';

  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
        <span
          className="mono"
          style={{ fontSize: 20, fontWeight: 700, color: accent }}
        >
          {m.ratio.toFixed(1)}%
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 2,
          fontSize: 11,
          color: 'var(--text-sub)',
        }}
      >
        <span className="mono">
          {fmtTril(m.cap, m.currency)} ÷ {fmtTril(m.gdp, m.currency)}
        </span>
        {pct && (
          <span style={{ color: hot ? 'var(--warn)' : 'var(--text-sub)' }}>
            {pct}
          </span>
        )}
      </div>

      {geo && (
        <div style={{ marginTop: 8 }}>
          {/* 절대 임계값(<75% 저평가 …)은 현재 구간에서 전부 '거품'으로 뭉개진다.
              대신 같은 시계열 10년 분포 안의 위치를 보여준다. */}
          <div
            style={{
              position: 'relative',
              height: 6,
              borderRadius: 3,
              background: 'var(--row)',
            }}
          >
            {geo.median != null && (
              <div
                title="10년 중앙값"
                style={{
                  position: 'absolute',
                  left: `${geo.median}%`,
                  top: -2,
                  width: 1,
                  height: 10,
                  background: 'var(--text-mut)',
                }}
              />
            )}
            {/* left 를 애니메이션하면 매 프레임 레이아웃이 다시 계산된다.
                트랙 너비와 같은 래퍼를 두고 transform(x) 으로 옮긴다 —
                x 의 % 는 자기 자신의 너비 기준이라 left % 와 같은 위치가 된다.
                합성만 일어나므로 리플로우가 없다. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: `${geo.current}%` }}
              transition={{ duration: 0.4 }}
              style={{
                position: 'absolute',
                left: 0,
                top: -2,
                width: '100%',
                height: 10,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  borderRadius: '50%',
                  background: accent,
                  boxShadow: `0 0 6px ${accent}`,
                }}
              />
            </motion.div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 4,
              fontSize: 10,
              color: 'var(--text-sub)',
            }}
          >
            <span className="mono">{m.min?.toFixed(0)}%</span>
            <span>
              중앙 {m.median?.toFixed(0)}% · {fmtAsOf(m)}
            </span>
            <span className="mono">{m.max?.toFixed(0)}%</span>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          color: 'var(--text-sub)',
          lineHeight: 1.4,
        }}
      >
        {m.note}
      </div>
    </div>
  );
}
