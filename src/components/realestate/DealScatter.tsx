import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorState, Loading, Badge } from '@/components/common';
import { fmt, WARN } from '@/lib/colors';
import type { AptDeal } from '@/data/types';
import s from './DealScatter.module.css';

interface DealScatterProps {
  deals: AptDeal[];
  selectedArea: number | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
}

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

const H = 240;
const M = { top: 14, right: 14, bottom: 28, left: 52 };
const LOW_FLOOR_MAX = 5;

export default function DealScatter({
  deals,
  selectedArea,
  loading = false,
  error = null,
  stale = false,
  onRetry,
}: DealScatterProps) {
  // 폭은 컨테이너에서 받아 1:1 픽셀로 그린다. viewBox 를 늘리면 글자·점까지 같이 늘어난다.
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const set = () => setW(Math.max(320, el.clientWidth));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => {
    const src = selectedArea
      ? deals.filter(d => d.area != null && Math.abs(d.area - selectedArea) < 5)
      : deals;
    return src
      .filter(d => Number.isFinite(d.price))
      .map(d => ({
        t: monthValue(d.ym, d.day),
        y: d.price,
        floor: d.floor,
        ym: d.ym,
        day: d.day,
      }))
      .sort((a, b) => a.t - b.t);
  }, [deals, selectedArea]);

  const median = useMemo(() => rollingMedian(points), [points]);

  const scale = useMemo(() => {
    if (!points.length) return null;
    const ys = points.map(p => p.y);
    let lo = Math.min(...ys),
      hi = Math.max(...ys);
    if (lo === hi) {
      lo = Math.max(0, lo * 0.9);
      hi = hi * 1.1 || 1;
    } // 거래가 한 건뿐인 평형
    const pad = (hi - lo) * 0.1;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;

    const t0 = points[0].t,
      t1 = points[points.length - 1].t;
    const spanT = t1 - t0 || 1;
    const innerW = w - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    return {
      lo,
      hi,
      t0,
      t1,
      x: (t: number) => M.left + ((t - t0) / spanT) * innerW,
      y: (v: number) => H - M.bottom - ((v - lo) / (hi - lo)) * innerH,
    };
  }, [points, w]);

  if (loading)
    return (
      <div className={s.container}>
        <Loading label="거래 기록 불러오는 중…" />
      </div>
    );
  if (error) {
    return (
      <div className={s.container}>
        <ErrorState
          title="거래 기록을 불러오지 못했습니다"
          desc={error}
          onRetry={onRetry}
        />
      </div>
    );
  }
  if (!points.length || !scale) {
    return (
      <div className={s.container}>
        <EmptyState
          title="거래 기록 없음"
          desc="이 평형대의 실거래 기록이 없습니다. 다른 평형을 선택해 보세요."
        />
      </div>
    );
  }

  // y 격자 — 4구간이면 값을 읽을 수 있고 배경이 시끄럽지 않다.
  const ticks = Array.from(
    { length: 5 },
    (_, i) => scale.lo + ((scale.hi - scale.lo) * i) / 4,
  );
  const ymLabel = (ym: string) => `${ym.slice(2, 4)}.${ym.slice(4)}`;
  const medPath = points
    .map((p, i) =>
      median[i] == null
        ? null
        : `${scale.x(p.t).toFixed(1)},${scale.y(median[i]!).toFixed(1)}`,
    )
    .filter(Boolean)
    .join(' ');

  return (
    <div className={s.container} ref={boxRef}>
      {stale && (
        <div className={s.staleRow}>
          <Badge color={WARN}>배치 재수집 필요</Badge>
        </div>
      )}

      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        className={s.chart}
        role="img"
        aria-label={`실거래 산점도 — ${points.length}건, ${ymLabel(points[0].ym)}부터 ${ymLabel(points[points.length - 1].ym)}까지`}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={M.left}
              y1={scale.y(v)}
              x2={w - M.right}
              y2={scale.y(v)}
              className={s.grid}
            />
            <text
              x={M.left - 8}
              y={scale.y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className={s.label}
            >
              {fmt(Math.round(v / 100) / 100, 1)}억
            </text>
          </g>
        ))}

        <line
          x1={M.left}
          y1={M.top}
          x2={M.left}
          y2={H - M.bottom}
          className={s.axis}
        />
        <line
          x1={M.left}
          y1={H - M.bottom}
          x2={w - M.right}
          y2={H - M.bottom}
          className={s.axis}
        />

        {medPath.includes(' ') && (
          <polyline points={medPath} className={s.median} />
        )}

        {points.map((p, i) => {
          const low =
            p.floor != null && p.floor >= 1 && p.floor <= LOW_FLOOR_MAX;
          // 층 구분에 등락색을 쓰면 안 된다 — colorMode(국제식·한국식)를 바꾸면 층 의미가 뒤집힌다.
          // 층은 방향성이 없는 분류라 같은 브랜드색의 채움/테두리로 나눈다(색맹에게도 구분된다).
          return (
            <circle
              key={i}
              cx={scale.x(p.t)}
              cy={scale.y(p.y)}
              r={low ? 3.6 : 3.2}
              className={low ? s.pointLow : s.point}
            >
              <title>
                {`${ymLabel(p.ym)}.${String(p.day ?? 1).padStart(2, '0')} · ${fmt(p.y, 0)}만원 · ${p.floor != null ? `${p.floor}층` : '층 미상'}`}
              </title>
            </circle>
          );
        })}

        <text
          x={scale.x(scale.t0)}
          y={H - M.bottom + 16}
          textAnchor="start"
          className={s.label}
        >
          {ymLabel(points[0].ym)}
        </text>
        <text
          x={scale.x(scale.t1)}
          y={H - M.bottom + 16}
          textAnchor="end"
          className={s.label}
        >
          {ymLabel(points[points.length - 1].ym)}
        </text>
      </svg>

      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={`${s.legendDot} ${s.dotLow}`} />
          저층(1~{LOW_FLOOR_MAX}층)
        </span>
        <span className={s.legendItem}>
          <span className={`${s.legendDot} ${s.dotHigh}`} />
          중·고층
        </span>
        <span className={s.legendItem}>
          <span className={s.legendLine} />
          3개월 이동 중앙값
        </span>
        <span className={s.legendNote}>
          {points.length}건 · 점에 커서를 올리면 층과 금액
        </span>
      </div>
    </div>
  );
}
