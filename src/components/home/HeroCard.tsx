import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { signColor } from '../../lib/colors';
import s from './Home.module.css';

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

/** 스냅샷 시계열 → 스파크라인 패스. 2점 미만이면 null(선을 지어내지 않는다). */
function sparkPath(values: number[], w: number, h: number): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  return values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** 히어로 순자산 카드 — "am I okay?"에 30초 안에 답하는 첫 화면(설계 W2). */
export default function HeroCard() {
  const home = useStore(st => st.home);
  const mode = useStore(st => st.colorMode);

  const series = home?.snapshotSeries ?? [];
  const path = useMemo(
    () =>
      sparkPath(
        series.map(e => e.netWorth),
        600,
        56,
      ),
    [series],
  );
  const manualGap =
    series.some(e => !e.manualIncluded) && series.some(e => e.manualIncluded);

  const day = home?.dayChange ?? null;
  return (
    <section className={`card ${s.heroCard}`}>
      <div className={s.heroTop}>
        <div>
          <div className={s.heroLabel}>
            내 순자산 · 주식 + 예수금 + 수동자산
          </div>
          <div className={`${s.heroValue} mono`}>
            {home?.netWorth != null ? won(home.netWorth) : '-'}
          </div>
          <div
            className={s.heroDay}
            style={
              day
                ? { color: signColor(day.pct, mode) }
                : { color: 'var(--text-mut)' }
            }
          >
            {day
              ? `${day.value > 0 ? '+' : ''}${won(day.value).replace('₩-', '-₩')} (${day.pct > 0 ? '+' : ''}${day.pct}%)`
              : '오늘 등락 - (장 시작 전이거나 데이터 없음)'}
          </div>
        </div>
      </div>
      {path ? (
        <>
          <svg
            className={s.spark}
            viewBox="0 0 600 56"
            preserveAspectRatio="none"
            aria-label="순자산 추세"
          >
            <path
              d={path}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div className={s.heroCaption}>
            최근 {series.length}일 순자산 추세
            {manualGap && ' · 초기 구간은 수동자산 미포함(스냅샷 확장 전 기록)'}
          </div>
        </>
      ) : (
        <div className={s.sparkNote}>
          일일 스냅샷이 이틀 이상 쌓이면 순자산 추세가 여기 그려집니다.
        </div>
      )}
    </section>
  );
}
