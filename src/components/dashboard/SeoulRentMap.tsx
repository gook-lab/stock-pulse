import { useEffect, useMemo, useState } from 'react';
import { geoMercator, geoPath, geoCentroid } from 'd3-geo';
import type { Feature, FeatureCollection } from 'geojson';
import { useStore } from '../../store/useStore';
import { signColor } from '../../lib/colors';
import type { SeoulDistrict } from '../../data/types';
import { Button, Segmented } from '@/components/common';
import s from './SeoulRentMap.module.css';

const W = 500,
  H = 430;
type Metric = 'price' | 'change';

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const priceColor = (t: number) =>
  `rgb(${lerp(30, 124, t)},${lerp(39, 108, t)},${lerp(64, 255, t)})`;
const withAlpha = (hex: string, a: number) =>
  hex +
  Math.round(Math.max(0.12, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
const shortGu = (n: string) => n.replace(/구$/, '');

export default function SeoulRentMap() {
  const seoul = useStore(st => st.seoulRent);
  const mode = useStore(st => st.colorMode);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [metric, setMetric] = useState<Metric>('price');
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    fetch('/maps/seoul-simple.json')
      .then(r => r.json())
      .then(setGeo)
      .catch(() => {});
  }, []);

  const byName = useMemo(() => {
    const m = new Map<string, SeoulDistrict>();
    seoul?.districts.forEach(d => m.set(d.name, d));
    return m;
  }, [seoul]);

  const stats = useMemo(() => {
    const ds = (seoul?.districts ?? []).filter(d => d.count > 0);
    if (!ds.length) return null;
    const byPrice = [...ds].sort((a, b) => b.avgEok - a.avgEok);
    const byMove = [...ds].sort((a, b) => b.changePct - a.changePct);
    const eoks = ds.map(d => d.avgEok).sort((a, b) => a - b);
    const median = eoks[Math.floor(eoks.length / 2)];
    const counts = ds.map(d => d.count).sort((a, b) => a - b);
    const chgs = ds.map(d => d.changePct);
    return {
      ds,
      ranked: byPrice,
      max: byPrice[0],
      min: byPrice[byPrice.length - 1],
      topUp: byMove[0],
      topDown: byMove[byMove.length - 1],
      upCount: ds.filter(d => d.changePct > 0).length,
      downCount: ds.filter(d => d.changePct < 0).length,
      totalCount: ds.reduce((s2, d) => s2 + d.count, 0),
      hottest: [...ds].sort((a, b) => b.count - a.count)[0],
      median,
      ratio: +(byPrice[0].avgEok / byPrice[byPrice.length - 1].avgEok).toFixed(
        1,
      ),
      minEok: eoks[0],
      maxEok: eoks[eoks.length - 1],
      maxCount: counts[counts.length - 1],
      medianCount: counts[Math.floor(counts.length / 2)],
      chgMin: Math.min(...chgs),
      chgMax: Math.max(...chgs),
    };
  }, [seoul]);

  const { paths, labels } = useMemo(() => {
    if (!geo)
      return {
        paths: [] as { name: string; d: string }[],
        labels: [] as { name: string; x: number; y: number }[],
      };
    const proj = geoMercator().fitSize([W, H], geo);
    const path = geoPath(proj);
    return {
      paths: geo.features.map(f => ({
        name: (f.properties as { name: string }).name,
        d: path(f as Feature) || '',
      })),
      labels: geo.features.map(f => {
        const c = proj(geoCentroid(f as Feature));
        return {
          name: (f.properties as { name: string }).name,
          x: c?.[0] ?? 0,
          y: c?.[1] ?? 0,
        };
      }),
    };
  }, [geo]);

  if (seoul?.unavailable)
    return (
      <section className="card">
        <div className="card-h">
          <span className="t">서울 아파트 전세 데이터센터</span>
          <span className="tag mono" style={{ color: signColor(-1, mode) }}>
            ● 연결 끊김
          </span>
        </div>
        <div
          style={{
            padding: '48px 0',
            textAlign: 'center',
            color: 'var(--text-mut)',
            fontSize: 13,
          }}
        >
          <div className="mono" style={{ fontSize: 40, lineHeight: 1 }}>
            -
          </div>
          <div style={{ marginTop: 10 }}>실시간 데이터 연결 안됨</div>
        </div>
      </section>
    );
  if (!seoul || !stats) return null;

  const fillFor = (name: string) => {
    const d = byName.get(name);
    if (!d || !d.count) return 'var(--panel-2)';
    if (metric === 'price') {
      const t =
        stats.maxEok > stats.minEok
          ? (d.avgEok - stats.minEok) / (stats.maxEok - stats.minEok)
          : 0.5;
      return priceColor(t);
    }
    return withAlpha(signColor(d.changePct, mode), Math.abs(d.changePct) / 8);
  };
  const hd = hover ? byName.get(hover) : null;

  return (
    <section className="card">
      <div className="card-h">
        <span className="t">
          서울 아파트 전세 데이터센터 · {seoul.month.slice(0, 4)}.
          {seoul.month.slice(4)}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="tag">data.go.kr 실거래</span>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => useStore.getState().setTab('realestate')}
          >
            단지 스크리너 열기 →
          </Button>
        </span>
      </div>

      <div className={s.layout}>
        {/* 좌: 분석 도표 */}
        <div className={s.left}>
          <div className={s.kpis}>
            <Kpi k="서울 평균 전세" v={`${seoul.avgEok}억`} accent />
            <Kpi k="중위 전세" v={`${stats.median}억`} />
            <Kpi
              k="최고 / 최저 배율"
              v={`${stats.ratio}x`}
              sub={`${shortGu(stats.max.name)} ${stats.max.avgEok} · ${shortGu(stats.min.name)} ${stats.min.avgEok}`}
            />
            <Kpi
              k="상승 / 하락 구"
              v={`${stats.upCount} / ${stats.downCount}`}
              sub={`총 ${stats.totalCount.toLocaleString()}건`}
            />
          </div>

          <div className={s.movers}>
            <div className={s.moverCol}>
              <div className={s.moverH}>전월 상승 TOP</div>
              {stats.ranked
                .slice()
                .sort((a, b) => b.changePct - a.changePct)
                .slice(0, 3)
                .map(d => (
                  <MoverRow key={d.name} d={d} mode={mode} />
                ))}
            </div>
            <div className={s.moverCol}>
              <div className={s.moverH}>전월 하락 TOP</div>
              {stats.ranked
                .slice()
                .sort((a, b) => a.changePct - b.changePct)
                .slice(0, 3)
                .map(d => (
                  <MoverRow key={d.name} d={d} mode={mode} />
                ))}
            </div>
          </div>

          <div className={s.rankH}>
            <span>구별 전세 랭킹 · 정렬</span>
            <Segmented
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'price', label: '평균가' },
                { value: 'change', label: '전월대비' },
              ]}
            />
          </div>
          <div className={s.rankHead}>
            <span>구</span>
            <span>평균 전세</span>
            <span className={s.rt}>거래</span>
            <span className={s.rt}>전월</span>
          </div>
          <div className={s.ranks}>
            {[...stats.ds]
              .sort((a, b) =>
                metric === 'price'
                  ? b.avgEok - a.avgEok
                  : b.changePct - a.changePct,
              )
              .map(d => {
                const t =
                  stats.maxEok > stats.minEok
                    ? (d.avgEok - stats.minEok) / (stats.maxEok - stats.minEok)
                    : 0.5;
                return (
                  <div
                    key={d.name}
                    className={
                      hover === d.name ? `${s.rankRow} ${s.rankOn}` : s.rankRow
                    }
                    onMouseEnter={() => setHover(d.name)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className={s.rankName}>{shortGu(d.name)}</span>
                    <div className={s.rankBarCell}>
                      <div className={s.rankTrack}>
                        <div
                          className={s.rankFill}
                          style={{
                            width: `${8 + t * 92}%`,
                            background: priceColor(t),
                          }}
                        />
                      </div>
                      <span className={`${s.rankVal} mono`}>{d.avgEok}억</span>
                    </div>
                    <span className={`${s.rankCnt} mono`}>
                      {d.count.toLocaleString()}
                    </span>
                    <span
                      className={`${s.rankChg} mono`}
                      style={{
                        color:
                          d.changePct === 0
                            ? 'var(--text-mut)'
                            : signColor(d.changePct, mode),
                      }}
                    >
                      {d.changePct >= 0 ? '+' : ''}
                      {d.changePct}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* 우: 지도 */}
        <div className={s.right}>
          <svg viewBox={`0 0 ${W} ${H}`} className={s.svg}>
            {paths.map(p => (
              <path
                key={p.name}
                d={p.d}
                fill={fillFor(p.name)}
                stroke={hover === p.name ? 'var(--text)' : 'var(--border)'}
                strokeWidth={hover === p.name ? 1.4 : 0.6}
                onMouseEnter={() => setHover(p.name)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            {labels.map(l => {
              const d = byName.get(l.name);
              return (
                <text
                  key={l.name}
                  x={l.x}
                  y={l.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={s.label}
                  pointerEvents="none"
                >
                  <tspan x={l.x} fontSize="8" fontWeight="600">
                    {shortGu(l.name)}
                  </tspan>
                  {d && d.count > 0 && (
                    <tspan
                      x={l.x}
                      dy="8.5"
                      fontSize="6.5"
                      className={s.labelSub}
                    >
                      {d.avgEok}억
                    </tspan>
                  )}
                </text>
              );
            })}
          </svg>
          {hd && (
            <div className={s.tip}>
              <span className={s.tipName}>{hd.name}</span>
              <span className={`${s.tipV} mono`}>{hd.avgEok}억</span>
              <span
                className="mono"
                style={{ color: signColor(hd.changePct, mode), fontSize: 11 }}
              >
                {hd.changePct >= 0 ? '+' : ''}
                {hd.changePct}%
              </span>
              <span className={s.tipCnt}>{hd.count}건</span>
            </div>
          )}
          <div className={s.legend}>
            {metric === 'price' ? (
              <>
                <span>{stats.minEok}억</span>
                {[0, 0.25, 0.5, 0.75, 1].map(t => (
                  <span
                    key={t}
                    className={s.lbox}
                    style={{ background: priceColor(t) }}
                  />
                ))}
                <span>{stats.maxEok}억</span>
                <span className={s.attr}>전세 보증금 평균 · 월세 제외</span>
              </>
            ) : (
              <>
                <span>하락</span>
                <span
                  className={s.lbox}
                  style={{ background: withAlpha(signColor(-1, mode), 1) }}
                />
                <span
                  className={s.lbox}
                  style={{ background: 'var(--panel-2)' }}
                />
                <span
                  className={s.lbox}
                  style={{ background: withAlpha(signColor(1, mode), 1) }}
                />
                <span>상승</span>
                <span className={s.attr}>전월 대비 변동</span>
              </>
            )}
          </div>

          <Quadrant
            stats={stats}
            mode={mode}
            hover={hover}
            setHover={setHover}
          />
          <Histogram ds={stats.ds} hover={hover} setHover={setHover} />
        </div>
      </div>
    </section>
  );
}

function Histogram({
  ds,
  hover,
  setHover,
}: {
  ds: SeoulDistrict[];
  hover: string | null;
  setHover: (n: string | null) => void;
}) {
  const eoks = ds.map(d => d.avgEok);
  const min = Math.floor(Math.min(...eoks)),
    max = Math.ceil(Math.max(...eoks));
  const buckets: { label: number; items: SeoulDistrict[] }[] = [];
  for (let b = min; b < max; b++)
    buckets.push({
      label: b,
      items: ds.filter(d => d.avgEok >= b && d.avgEok < b + 1),
    });
  const maxC = Math.max(1, ...buckets.map(b => b.items.length));
  const hoveredBucket = hover
    ? Math.floor(ds.find(d => d.name === hover)?.avgEok ?? -1)
    : -1;
  return (
    <div className={s.hist}>
      <div className={s.quadH}>전세 보증금 분포 · 구 개수</div>
      <div className={s.histBars}>
        {buckets.map(b => (
          <div
            key={b.label}
            className={s.histCol}
            onMouseEnter={() => b.items[0] && setHover(b.items[0].name)}
            onMouseLeave={() => setHover(null)}
          >
            <div className={s.histCount}>{b.items.length || ''}</div>
            <div
              className={
                b.label === hoveredBucket
                  ? `${s.histBar} ${s.histBarOn}`
                  : s.histBar
              }
              style={{ height: `${(b.items.length / maxC) * 100}%` }}
              title={`${b.label}~${b.label + 1}억: ${b.items.map(d => shortGu(d.name)).join(', ') || '없음'}`}
            />
            <div className={s.histLabel}>{b.label}</div>
          </div>
        ))}
      </div>
      <div className={s.quadNote}>
        가로: 평균 전세(억) · 세로: 해당 구간 구 수
      </div>
    </div>
  );
}

function Quadrant({
  stats,
  mode,
  hover,
  setHover,
}: {
  stats: SeoulStats;
  mode: 'global' | 'korea';
  hover: string | null;
  setHover: (n: string | null) => void;
}) {
  const SW = 500,
    SH = 250,
    pl = 40,
    pr = 14,
    pt = 16,
    pb = 30;
  const yMax = Math.max(3, Math.abs(stats.chgMin), Math.abs(stats.chgMax));
  const x = (c: number) => pl + (c / (stats.maxCount || 1)) * (SW - pl - pr);
  const y = (p: number) => pt + (1 - (p + yMax) / (2 * yMax)) * (SH - pt - pb);
  const r = (eok: number) =>
    3 + ((eok - stats.minEok) / (stats.maxEok - stats.minEok || 1)) * 5;
  const xMid = x(stats.medianCount),
    y0 = y(0);

  return (
    <div className={s.quad}>
      <div className={s.quadH}>시장 포지셔닝 · 거래량 × 전월대비</div>
      <svg viewBox={`0 0 ${SW} ${SH}`} className={s.quadSvg}>
        {/* 사분면 라벨 */}
        <text x={pl + 6} y={pt + 12} className={s.qz}>
          신흥 (거래少·상승)
        </text>
        <text x={SW - pr - 6} y={pt + 12} className={s.qz} textAnchor="end">
          성장 (거래多·상승)
        </text>
        <text x={pl + 6} y={SH - pb - 6} className={s.qz}>
          관망 (거래少·하락)
        </text>
        <text x={SW - pr - 6} y={SH - pb - 6} className={s.qz} textAnchor="end">
          조정 (거래多·하락)
        </text>
        {/* 기준선 */}
        <line
          x1={pl}
          y1={y0}
          x2={SW - pr}
          y2={y0}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <line
          x1={xMid}
          y1={pt}
          x2={xMid}
          y2={SH - pb}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* 축 라벨 */}
        <text x={SW / 2} y={SH - 6} className={s.qax} textAnchor="middle">
          거래량(건) →
        </text>
        <text x={12} y={pt + 4} className={s.qax}>
          전월% ↑
        </text>
        {/* 점 */}
        {stats.ds.map(d => {
          const on = hover === d.name;
          return (
            <g
              key={d.name}
              onMouseEnter={() => setHover(d.name)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={x(d.count)}
                cy={y(d.changePct)}
                r={on ? r(d.avgEok) + 2 : r(d.avgEok)}
                fill={signColor(d.changePct, mode)}
                fillOpacity={on ? 0.95 : 0.62}
                stroke={on ? 'var(--text)' : 'none'}
                strokeWidth="1.2"
              />
              {(on || d.count > stats.medianCount) && (
                <text
                  x={x(d.count)}
                  y={y(d.changePct) - r(d.avgEok) - 3}
                  textAnchor="middle"
                  className={s.qlab}
                >
                  {d.name.replace(/구$/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className={s.quadNote}>점 크기 = 평균 전세가 · 색 = 상승/하락</div>
    </div>
  );
}

// stats 타입 추론용 (Quadrant props 타입 지정)
type SeoulStats = {
  ds: SeoulDistrict[];
  ranked: SeoulDistrict[];
  max: SeoulDistrict;
  min: SeoulDistrict;
  topUp: SeoulDistrict;
  topDown: SeoulDistrict;
  upCount: number;
  downCount: number;
  totalCount: number;
  hottest: SeoulDistrict;
  median: number;
  ratio: number;
  minEok: number;
  maxEok: number;
  maxCount: number;
  medianCount: number;
  chgMin: number;
  chgMax: number;
};

function Kpi({
  k,
  v,
  sub,
  accent,
}: {
  k: string;
  v: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiK}>{k}</div>
      <div
        className={`${s.kpiV} mono`}
        style={{ color: accent ? 'var(--brand)' : 'var(--text)' }}
      >
        {v}
      </div>
      {sub && <div className={s.kpiSub}>{sub}</div>}
    </div>
  );
}

function MoverRow({ d, mode }: { d: SeoulDistrict; mode: 'global' | 'korea' }) {
  return (
    <div className={s.moverRow}>
      <span className={s.moverName}>{shortGu(d.name)}</span>
      <span className={`${s.moverEok} mono`}>{d.avgEok}억</span>
      <span
        className={`${s.moverChg} mono`}
        style={{ color: signColor(d.changePct, mode) }}
      >
        {d.changePct >= 0 ? '+' : ''}
        {d.changePct}%
      </span>
    </div>
  );
}
