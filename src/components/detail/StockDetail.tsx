import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bell } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { signColor, fmt, type ColorMode } from '../../lib/colors';
import type {
  Candle,
  Level,
  TradeTick,
  StockInfo,
  StockOpinion,
} from '../../data/types';
import {
  Loading,
  EmptyState,
  ErrorState,
  Badge,
  MarketChip,
  PriceChart,
  ReasonList,
  Segmented,
  SkeletonRows,
} from '@/components/common';
import { useKisRealtime, useKrChartAll, useKrIntraday } from '@/lib/kisSocket';
import {
  densify,
  synthIntraday,
  fromIntraday,
  fmtM,
  type Densified,
} from '@/lib/chartSeries';
import { fmtVol, fmtMarketCapEok } from '@/lib/format';
import OrderTicket from './OrderTicket';
import PriceAlertModal from './PriceAlertModal';
import s from './StockDetail.module.css';

// 차트 시리즈 변환(합성 서브포인트·분봉·거래량 규칙)은 src/lib/chartSeries.ts 로 분리 — 단위 테스트로 잠금.

export default function StockDetail() {
  const watchlist = useStore(st => st.watchlist);
  const selectedCode = useStore(st => st.selectedCode);
  const selectStock = useStore(st => st.selectStock);
  const detail = useStore(st => st.detail);
  const portfolio = useStore(st => st.portfolio);
  const loading = useStore(st => st.detailLoading);
  const loadDetail = useStore(st => st.loadDetail);
  const mode = useStore(st => st.colorMode);

  // KIS 실시간/차트는 selectedCode(6자리=국내) 기준 — detail 로드를 기다리지 않고 즉시 전환.
  const isKR = /^\d{6}$/.test(selectedCode);
  const rt = useKisRealtime(isKR ? selectedCode : null);
  const chartAll = useKrChartAll(isKR ? selectedCode : null); // 일/주/월봉(1일~5년 탭)
  const intraday = useKrIntraday(isKR ? selectedCode : null); // 1일 탭 실분봉(실거래량 유일 소스)
  // 종목 기본정보(시총·PER·PBR·EPS·거래량) — KIS 실데이터. 목 DETAIL_META는 실제와 3배 이상 벌어진다.
  const getStockInfo = useStore(st => st.getStockInfo);
  const [info, setInfo] = useState<StockInfo | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 종목 전환 시 외부 조회를 새로 시작하며 이전 종목 값을 비운다 — 채움은 비동기 응답
    setInfo(null);
    if (!isKR) return;
    let alive = true;
    getStockInfo(selectedCode).then(d => {
      if (alive) setInfo(d);
    });
    return () => {
      alive = false;
    };
  }, [selectedCode, isKR, getStockInfo]);
  // 종목별 투자 스코어 — 실측 지표 규칙 기반. 목 detail.ai(고정 점수·문구)를 대체한다.
  const getStockOpinion = useStore(st => st.getStockOpinion);
  const [opinion, setOpinion] = useState<StockOpinion | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 종목 전환 시 외부 조회를 새로 시작하며 이전 종목 값을 비운다 — 채움은 비동기 응답
    setOpinion(null);
    if (!isKR) return;
    let alive = true;
    getStockOpinion(selectedCode).then(d => {
      if (alive) setOpinion(d);
    });
    return () => {
      alive = false;
    };
  }, [selectedCode, isKR, getStockOpinion]);
  const lastClose = chartAll.daily[chartAll.daily.length - 1]?.c;
  const [liveTrades, setLiveTrades] = useState<TradeTick[]>([]);
  /** 호가창 클릭 → 주문 티켓 지정가 채움. seq로 같은 가격 재클릭도 전달된다. */
  const [pickedPrice, setPickedPrice] = useState<{
    price: number;
    seq: number;
  } | null>(null);
  // 종목이 바뀌면 이전 종목의 체결·호가 선택을 렌더 중에 바로 비운다(effect 로 비우면 한 프레임 남는다)
  const [prevCode, setPrevCode] = useState(selectedCode);
  if (selectedCode !== prevCode) {
    setPrevCode(selectedCode);
    setLiveTrades([]);
    setPickedPrice(null);
  }
  const pickPrice = (price: number) =>
    setPickedPrice(prev => ({ price, seq: (prev?.seq ?? 0) + 1 }));

  // 모달
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const alerts = useStore(st => st.alerts);
  const codeAlerts = detail ? alerts.filter(a => a.code === detail.code) : [];

  // 좌측 리스트: 관심 / 코스피·코스닥 시총 TOP 100 (다음 금융, 실시장 데이터)
  const [listTab, setListTab] = useState<'watch' | 'kospi' | 'kosdaq'>('watch');
  const [top, setTop] = useState<
    Record<
      string,
      {
        rank: number;
        code: string;
        name: string;
        price: number;
        changePct: number;
      }[]
    >
  >({});
  useEffect(() => {
    if (listTab === 'watch') return;
    let alive = true;
    const load = () =>
      fetch(`/api/kr/top100?market=${listTab}`)
        .then(r => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then(d => {
          if (alive && Array.isArray(d)) setTop(p => ({ ...p, [listTab]: d }));
        })
        .catch(() => {
          if (alive) setTop(p => ({ ...p, [listTab]: p[listTab] ?? [] }));
        });
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [listTab]);
  useEffect(() => {
    if (rt.trade)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 실시간 체결 스트림(rt.trade)을 표시용 버퍼에 누적한다 — 외부 구독 값 동기화
      setLiveTrades(p =>
        [
          {
            time: rt.trade!.time,
            price: rt.trade!.price,
            qty: rt.trade!.volume,
            side: rt.trade!.side,
          },
          ...p,
        ].slice(0, 30),
      );
  }, [rt.trade]);

  useEffect(() => {
    if (!detail || detail.code !== selectedCode) loadDetail(selectedCode);
  }, [selectedCode, detail, loadDetail]);

  // PriceChart 입력 구성.
  //  KR: 1일=마지막 일봉을 장중 합성, 1주~3개월=일봉 슬라이스, 1년·5년=월봉. densify로 Toss식 촘촘.
  //  US: KIS 데이터 없어 mock 워크(≈50 정규화)를 실가격 스케일로 변환.
  //  소켓 불안정(체결 없음) 시엔 마지막 실제 종가로 폴백(목 금지).
  // 현재가 단일 소스 — 실데이터만. 목 `detail.price`로 폴백하면 삼성전자 78,400 · SK하이닉스
  // 198,500 처럼 실가의 1/3~1/8 값이 "현재가"로 찍힌다(RADIO #2: 없으면 목이 아니라 "-").
  // 관심종목 행은 KIS(국내)·Finnhub(미국) 실시세라 US의 유일한 실가 소스이기도 하다.
  const wl = watchlist.find(w => w.code === selectedCode);
  const wlLive = wl && !wl.unavailable && wl.price > 0 ? wl.price : undefined;
  const live = rt.trade?.price ?? (isKR ? lastClose : undefined) ?? wlLive ?? 0;
  // 전일 종가 — 1일 등락의 기준. 실일봉에서만 뽑는다.
  // 마지막 봉이 오늘이면 그 앞이 전일이고, 장 시작 전이면 마지막 봉이 곧 전일이다.
  const prevClose = (() => {
    const d = chartAll.daily.filter(c => Number.isFinite(c.c) && c.c > 0);
    if (!d.length) return 0;
    const today = new Date().toLocaleDateString('sv-SE').replace(/-/g, ''); // 로컬 날짜 YYYYMMDD
    const lastIsToday = d[d.length - 1].date?.slice(0, 8) === today;
    const prev = lastIsToday ? d[d.length - 2] : d[d.length - 1];
    return prev?.c ?? 0;
  })();
  // 전일 대비 — 실일봉 기준을 우선한다. 목 `detail.changePct`는 실시세와 스케일이 달라
  // SK하이닉스가 실제 +25%인데 화면에 +0.00%로 찍히던 원인이었다.
  const wlPct = wl && !wl.unavailable ? wl.changePct : undefined; // 실패한 행의 목값은 쓰지 않는다
  const realDay =
    isKR && prevClose > 0 && live > 0
      ? { chg: live - prevClose, pct: ((live - prevClose) / prevClose) * 100 }
      : null;
  // 목 `detail.changePct`는 실시세와 무관한 고정값이라 쓰지 않는다 — 실등락이 없으면 0(등락 미표시).
  const dayPct = realDay ? +realDay.pct.toFixed(2) : (wlPct ?? 0);
  const dayChg = realDay ? realDay.chg : (live * dayPct) / (100 + dayPct || 1);
  // 소켓 실시간 데이터 유무(KR) — 없으면 호가/체결을 "-"로.
  const krHasOb =
    isKR &&
    rt.connected &&
    !!rt.orderbook &&
    (rt.orderbook.asks.some(a => a.price > 0) ||
      rt.orderbook.bids.some(b => b.price > 0));
  const krHasTrades = isKR && rt.connected && liveTrades.length > 0;
  // 52주 범위: KR은 실제 월봉 12개(없으면 일봉 전체) 고/저로 계산 — 목 low52/high52는
  // 실시간가와 스케일이 달라 도트가 항상 끝에 클램프되는 시각적 거짓말이 됨.
  const finOhlc = (a: Candle[]) =>
    a.filter(c => Number.isFinite(c.h) && Number.isFinite(c.l));
  const rangeSrc = isKR
    ? finOhlc(chartAll.monthly.slice(-12)).length
      ? finOhlc(chartAll.monthly.slice(-12))
      : finOhlc(chartAll.daily)
    : [];
  // 목 low52/high52(삼성전자 ₩56,448~97,216)는 실가와 스케일이 어긋난다 — 없으면 0 → 화면은 "-".
  const low52 = rangeSrc.length ? Math.min(...rangeSrc.map(c => c.l)) : 0;
  const high52 = rangeSrc.length ? Math.max(...rangeSrc.map(c => c.h)) : 0;
  // 기술적 목표가(볼린저 상단 20D+2σ, 60일 고가 클램프) — server/index.mjs '/api/kr/targets'와 동일 공식 유지.
  // 목 고정 목표가는 실시세와 스케일이 어긋나므로 실데이터 없으면 '-' (동일룰).
  const techTarget = (() => {
    if (!isKR) return null;
    const closes = chartAll.daily
      .slice(-20)
      .map(c => c.c)
      .filter(Number.isFinite);
    if (closes.length < 5) return null;
    const m = closes.reduce((a, b) => a + b, 0) / closes.length;
    const sd = Math.sqrt(
      closes.reduce((a, b) => a + (b - m) ** 2, 0) / closes.length,
    );
    const hi60 = Math.max(
      ...chartAll.daily
        .slice(-60)
        .map(c => c.h)
        .filter(Number.isFinite),
    );
    const raw = Math.min(m + 2 * sd, Number.isFinite(hi60) ? hi60 : Infinity);
    const tick =
      raw >= 100000 ? 500 : raw >= 10000 ? 100 : raw >= 1000 ? 10 : 1;
    return Math.round(raw / tick) * tick;
  })();
  const techUpside =
    techTarget && live > 0
      ? +(((techTarget - live) / live) * 100).toFixed(1)
      : null;
  const pc = useMemo(() => {
    if (!detail) return null;
    const { dec } = detail; // 목 detail.price 는 더 이상 쓰지 않는다(실가는 safeLive)
    const fin = (arr: Candle[]) =>
      arr.filter(c => [c.o, c.h, c.l, c.c].every(n => Number.isFinite(n)));
    const daily = isKR ? fin(chartAll.daily) : [];
    const monthly = isKR ? fin(chartAll.monthly) : [];
    const safeLive = Number.isFinite(live) && live > 0 ? live : lastClose || 0; // 목 폴백 금지
    // 끝점 절벽 방지(handoff 함정 #1): 라인 마지막 값과 실시간가 갭이 3%를 넘으면
    // (스테일/목 라인에 실가 강제 캡 = 수직 스파이크) 덮지 않고 라인 그대로 둔다.
    const nearLive = (last: number) =>
      last > 0 && Math.abs(safeLive - last) / last <= 0.03;
    const cap = (d: Densified) => {
      const last = d.closes[d.closes.length - 1];
      if (d.closes.length && nearLive(last)) {
        d.closes[d.closes.length - 1] = safeLive;
        d.cds[d.cds.length - 1].c = safeLive;
      }
      return d;
    };

    if (daily.length) {
      // ⚠️ 1주~5년의 서브포인트는 시각화용 합성(o/h/l/c는 실제, 거래량은 캔들당 1건만 실재).
      const dPer = (nDays: number, k: number) =>
        cap(densify(daily.slice(-nDays), k));
      const mPer = (nM: number, k: number) =>
        cap(densify(monthly.slice(-nM), k, fmtM));
      // 1일: 실분봉이 있으면 실데이터(라인·캔들·거래량 전부 실측), 없으면 합성 라인 + 거래량 미표시.
      // ⚠️ 분봉이 스로틀로 잘려 유효 캔들이 몇 개뿐이면 점 하나짜리 차트가 된다 —
      //    추세로 읽을 수 없으니 그때는 합성 라인으로 넘긴다(거래량은 자동으로 숨는다).
      const d1real = intraday.candles.length
        ? fromIntraday(intraday.candles)
        : null;
      const d1 = cap(
        d1real && d1real.closes.length >= 10
          ? d1real
          : synthIntraday(daily[daily.length - 1], 78),
      );
      const wk = dPer(5, 9),
        mo = dPer(22, 4),
        q = dPer(Math.min(66, daily.length), 2);
      const yr = monthly.length ? mPer(12, 8) : dPer(daily.length, 2); // 1년: 월봉 12
      const yr5 = monthly.length
        ? mPer(monthly.length, 2)
        : { closes: [], cds: [], vols: [], labels: [] }; // 5년: 전체 월봉
      return {
        series: {
          '1일': d1.closes,
          '1주': wk.closes,
          '1개월': mo.closes,
          '3개월': q.closes,
          '1년': yr.closes,
          '5년': yr5.closes,
        },
        candles: {
          '1일': d1.cds,
          '1주': wk.cds,
          '1개월': mo.cds,
          '3개월': q.cds,
          '1년': yr.cds,
          '5년': yr5.cds,
        },
        volumes: {
          '1일': d1.vols,
          '1주': wk.vols,
          '1개월': mo.vols,
          '3개월': q.vols,
          '1년': yr.vols,
          '5년': yr5.vols,
        },
        labels: {
          '1일': d1.labels,
          '1주': wk.labels,
          '1개월': mo.labels,
          '3개월': q.labels,
          '1년': yr.labels,
          '5년': yr5.labels,
        },
        defaultPeriod: '1일' as const,
      };
    }

    // KR 인데 일봉이 없다 = 조회 실패(KIS 스로틀 등). 목 스케일 라인을 그리면
    // 삼성전자에 ₩85,636 같은 값이 찍히고 X축은 인덱스가 된다 — 실패를 실패로 표시한다.
    if (isKR) return { unavailable: true as const };

    // US: 실 캔들 소스가 없어 목 워크를 **실시세 기준**으로 스케일한다(모양만 합성, 수준은 실가).
    // 목 price로 스케일하면 Apple이 $227(목) 대에 그려진다 — 실제 $309와 다른 종목처럼 보인다.
    if (!(safeLive > 0)) return { unavailable: true as const }; // 실가조차 없으면 그리지 않는다
    // 워크의 **끝점을 실시세에 고정**한다(비율 스케일). 고정 기준선(50)으로 스케일하면 끝점이
    // 실가와 어긋나 헤더 가격이 그 값을 따라간다(실측: Apple 실 $309.38 → 화면 $356.57).
    const scale = (arr: number[]) => {
      if (!arr?.length) return [] as number[];
      const last = arr[arr.length - 1];
      if (!(last > 0)) return [] as number[];
      return arr.map(v => +(safeLive * (v / last)).toFixed(dec));
    };
    return {
      series: {
        '1일': scale(detail.chart['1D']),
        '1주': scale(detail.chart['1W']),
        '1개월': scale(detail.chart['1M']),
        '1년': scale(detail.chart['1Y']),
      },
      candles: undefined,
      volumes: undefined,
      labels: undefined,
      // US 캔들 실소스가 아직 없어 detail.chart(목)를 스케일해 그린다 — "실시간" 배지는 거짓이므로
      // 부동산 상세와 같은 목 배지 패턴을 쓴다(진짜로 오해하면 안 된다).
      liveBadge: '목 데이터',
      liveBadgeTone: 'warn' as const,
      defaultPeriod: '1일' as const,
    };
  }, [
    detail,
    chartAll.daily,
    chartAll.monthly,
    intraday.candles,
    isKR,
    live,
    lastClose,
  ]);

  return (
    <div className={s.grid}>
      {/* 좌: 관심 / 코스피·코스닥 TOP 100 */}
      <aside className="card">
        <div
          className="card-h"
          style={{ whiteSpace: 'nowrap' }}
          title="코스피·코스닥은 시가총액 TOP 100 (실시장 시세)"
        >
          <Segmented
            options={
              [
                { value: 'watch', label: '관심' },
                { value: 'kospi', label: '코스피' },
                { value: 'kosdaq', label: '코스닥' },
              ] as const
            }
            value={listTab}
            onChange={setListTab}
          />
        </div>
        <div
          className={s.list}
          role="listbox"
          aria-label="종목 목록"
          style={
            listTab !== 'watch'
              ? { maxHeight: '70vh', overflowY: 'auto' }
              : undefined
          }
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const rows =
              listTab === 'watch'
                ? watchlist.map(w => ({ code: w.code }))
                : (top[listTab] ?? []);
            const idx = rows.findIndex(r => r.code === selectedCode);
            const next =
              e.key === 'ArrowDown'
                ? Math.min(idx + 1, rows.length - 1)
                : Math.max(idx - 1, 0);
            const t = rows[next] as
              { code: string; name?: string; changePct?: number } | undefined;
            if (t)
              selectStock(
                t.code,
                t.name
                  ? {
                      name: t.name,
                      market: 'KR',
                      cur: '₩',
                      dec: 0,
                      changePct: t.changePct,
                    }
                  : undefined,
              );
          }}
        >
          {listTab === 'watch' ? (
            watchlist.map(w => (
              <button
                key={w.code}
                role="option"
                aria-selected={w.code === selectedCode}
                className={
                  w.code === selectedCode ? `${s.li} ${s.liActive}` : s.li
                }
                onClick={() => selectStock(w.code)}
              >
                <span className={s.liName}>
                  <MarketChip market={w.market} /> {w.name}
                </span>
                {/* 실시세 실패 시 changePct는 목값이 남아 있다 — 그대로 찍으면 실제 +25%인 종목이
                    -2.20%로 보인다(대시보드 Watchlist와 같은 규칙으로 "-" 처리). */}
                <span
                  className="mono"
                  style={{
                    color: w.unavailable
                      ? 'var(--text-mut)'
                      : signColor(w.changePct, mode),
                    fontSize: 12,
                  }}
                >
                  {w.unavailable
                    ? '-'
                    : `${w.changePct >= 0 ? '+' : ''}${w.changePct.toFixed(2)}%`}
                </span>
              </button>
            ))
          ) : top[listTab] === undefined ? (
            <SkeletonRows rows={8} />
          ) : top[listTab]!.length === 0 ? (
            <EmptyState title="순위를 불러오지 못했습니다" />
          ) : (
            top[listTab]!.map(t => (
              <button
                key={t.code}
                role="option"
                aria-selected={t.code === selectedCode}
                className={
                  t.code === selectedCode ? `${s.li} ${s.liActive}` : s.li
                }
                onClick={() =>
                  selectStock(t.code, {
                    name: t.name,
                    market: 'KR',
                    cur: '₩',
                    dec: 0,
                    changePct: t.changePct,
                  })
                }
              >
                <span className={s.liName}>
                  <span
                    className="mono"
                    style={{
                      flex: 'none',
                      width: 22,
                      textAlign: 'center',
                      fontSize: 10,
                      fontWeight: 800,
                      color: 'var(--text-sub)',
                    }}
                  >
                    {t.rank}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.name}
                  </span>
                </span>
                <span
                  className="mono"
                  style={{
                    color: signColor(t.changePct, mode),
                    fontSize: 12,
                    flex: 'none',
                  }}
                >
                  {t.changePct >= 0 ? '+' : ''}
                  {t.changePct.toFixed(2)}%
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 중: 차트/호가/체결 */}
      <main className={s.center}>
        {!detail || loading ? (
          <section className="card">
            {loading ? (
              <Loading />
            ) : (
              <EmptyState
                title="종목을 선택하세요"
                desc="좌측에서 종목을 골라보세요."
              />
            )}
          </section>
        ) : (
          <>
            {pc && 'unavailable' in pc ? (
              <section className="card">
                <div className="card-h">
                  <span className="t">차트</span>
                  <span className="tag">일봉 없음</span>
                </div>
                {chartAll.loading ? (
                  <Loading label="일봉 불러오는 중…" />
                ) : (
                  <ErrorState
                    title="일봉을 불러오지 못했습니다"
                    desc="KIS 조회가 일시적으로 막힐 수 있습니다. 잠시 후 다시 시도하세요."
                    onRetry={chartAll.reload}
                  />
                )}
              </section>
            ) : (
              pc && (
                /* baseValue: 1일 등락은 전일 종가 대비로 고정 — 구간을 좁혀도 기준이 따라 움직이면 안 된다. */
                <PriceChart
                  key={detail.code}
                  name={detail.name}
                  code={detail.code}
                  cur={detail.cur}
                  dec={detail.dec}
                  mode={mode}
                  series={pc.series}
                  candles={pc.candles}
                  volumes={pc.volumes}
                  labels={pc.labels}
                  defaultPeriod={pc.defaultPeriod}
                  height={236}
                  dayChange={dayChg}
                  dayChangePct={dayPct}
                  baseValue={prevClose > 0 ? { '1일': prevClose } : undefined}
                  singlePointNote="이 구간에 표시할 점이 하나뿐입니다 · 구간을 넓히면 추세가 보입니다"
                  liveBadge={pc.liveBadge}
                  liveBadgeTone={pc.liveBadgeTone}
                />
              )
            )}
            <section className="card">
              <div className="card-h">
                <span className="t">52주 범위</span>
                {isKR && (
                  <span className="tag">
                    {rt.connected ? '실시간 연결' : '연결 대기'}
                  </span>
                )}
              </div>
              <Band52
                low={low52}
                high={high52}
                price={live}
                cur={detail.cur}
                dec={detail.dec}
                mode={mode}
              />
            </section>

            <div className={s.obTrades}>
              <section className="card">
                <div className="card-h">
                  <span className="t">호가</span>
                  <span className="tag">
                    {isKR
                      ? rt.connected
                        ? '실시간 연결'
                        : '연결 대기'
                      : 'M3 · 미국 예정'}
                  </span>
                </div>
                {/* 소켓 불안정(KR 실시간 없음) 시 목 대신 "-" 표시 */}
                {isKR ? (
                  krHasOb ? (
                    <Orderbook
                      asks={rt.orderbook!.asks}
                      bids={rt.orderbook!.bids}
                      cur={detail.cur}
                      dec={detail.dec}
                      mode={mode}
                      onPickPrice={pickPrice}
                    />
                  ) : (
                    <DashOrderbook />
                  )
                ) : (
                  <Orderbook
                    asks={detail.asks}
                    bids={detail.bids}
                    cur={detail.cur}
                    dec={detail.dec}
                    mode={mode}
                    onPickPrice={pickPrice}
                  />
                )}
              </section>
              <section className="card">
                <div className="card-h">
                  <span className="t">체결 내역</span>
                  <span className="tag">
                    {isKR ? (krHasTrades ? '실시간' : '연결 대기') : '최근'}
                  </span>
                </div>
                <div className={s.trHead}>
                  <span>시간</span>
                  <span className={s.rt}>체결가</span>
                  <span className={s.rt}>수량</span>
                  <span className={s.rt}>구분</span>
                </div>
                <div className={s.trBody}>
                  {isKR && !krHasTrades ? (
                    <div className={s.dashNote}>
                      실시간 연결 대기 — 체결 데이터 없음
                    </div>
                  ) : (
                    (isKR ? liveTrades : detail.trades).map((t, i) => (
                      <div key={i} className={s.trRow}>
                        <span className={`${s.trTime} mono`}>{t.time}</span>
                        <span
                          className={`${s.rt} mono`}
                          style={{
                            color: signColor(t.side === '매수' ? 1 : -1, mode),
                          }}
                        >
                          {detail.cur}
                          {fmt(t.price, detail.dec)}
                        </span>
                        <span
                          className={`${s.rt} mono`}
                          style={{ color: 'var(--text-sub)' }}
                        >
                          {t.qty.toLocaleString()}
                        </span>
                        <span className={s.rt}>
                          <Badge
                            color={signColor(t.side === '매수' ? 1 : -1, mode)}
                          >
                            {t.side}
                          </Badge>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {/* 우: 주문 티켓 + AI + 정보 */}
      <aside className={s.right}>
        {detail && !loading && (
          <>
            {/* 가격 알림 모달 + 헤더 */}
            <div className="mb-4 flex items-center justify-between px-2">
              <div />
              <button
                onClick={() => setAlertModalOpen(true)}
                className={`rounded-lg p-2 transition-colors ${codeAlerts.length > 0 ? 'bg-brand/20 text-brand' : 'text-sub hover:bg-panel2'}`}
                title="가격 알림"
              >
                <Bell size={20} />
              </button>
            </div>
            <PriceAlertModal
              open={alertModalOpen}
              onOpenChange={setAlertModalOpen}
              code={detail.code}
              name={detail.name}
              market={detail.market}
              high52={high52}
              currentPrice={live}
            />

            <OrderTicket
              code={detail.code}
              name={detail.name}
              market={detail.market}
              price={live}
              orderbook={isKR ? rt.orderbook || undefined : undefined}
              lastTradePrice={lastClose || 0}
              portfolio={portfolio}
              picked={pickedPrice}
            />
            <section className="card">
              {/* 국내는 실측 규칙 기반 스코어(모멘텀·52주 위치·PER·뉴스). 미국은 소스가 없어 "-".
                  목 detail.ai 점수를 실데이터처럼 보여주던 자리다. */}
              <div className="card-h">
                <span className="t">투자 스코어</span>
                <span
                  className="tag"
                  style={{
                    fontSize: 11,
                    color: isKR && opinion ? undefined : 'var(--text-mut)',
                  }}
                >
                  {isKR
                    ? opinion
                      ? `규칙 기반 · ${opinion.stance}`
                      : '집계 중'
                    : '국내만 지원'}
                </span>
              </div>
              <div className={s.aiScore}>
                <span
                  className={`${s.aiNum} mono`}
                  style={
                    isKR && opinion ? undefined : { color: 'var(--text-sub)' }
                  }
                >
                  {isKR ? (opinion ? opinion.score : '-') : '-'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-mut)' }}>
                  / 100
                </span>
              </div>
              <div className={s.aiBar}>
                <div
                  className={s.aiFill}
                  style={{ width: `${isKR && opinion ? opinion.score : 0}%` }}
                />
              </div>
              <div className={s.tgt}>
                {/* 목표주가: KR=기술적 산출(실데이터). 없으면 '-' — 목 고정값과 실시세 혼합 금지 */}
                {isKR ? (
                  <>
                    <div>
                      <div className={s.tgtK}>목표주가 · 기술적</div>
                      <div
                        className={`${s.tgtV} mono`}
                        style={
                          techTarget ? undefined : { color: 'var(--text-sub)' }
                        }
                      >
                        {techTarget
                          ? `${detail.cur}${fmt(techTarget, detail.dec)}`
                          : '-'}
                      </div>
                    </div>
                    <div>
                      <div className={s.tgtK}>상승여력</div>
                      <div
                        className={`${s.tgtV} mono`}
                        style={{
                          color:
                            techUpside == null
                              ? 'var(--text-sub)'
                              : signColor(techUpside, mode),
                        }}
                      >
                        {techUpside == null
                          ? '-'
                          : `${techUpside >= 0 ? '+' : ''}${techUpside}%`}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 미국은 무료 목표주가 소스가 없다 — 목 고정값을 실데이터처럼 쓰지 않는다. */}
                    <div>
                      <div className={s.tgtK}>목표주가</div>
                      <div
                        className={`${s.tgtV} mono`}
                        style={{ color: 'var(--text-sub)' }}
                      >
                        -
                      </div>
                    </div>
                    <div>
                      <div className={s.tgtK}>상승여력</div>
                      <div
                        className={`${s.tgtV} mono`}
                        style={{ color: 'var(--text-sub)' }}
                      >
                        -
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* 근거는 실제로 잰 숫자를 인용한 문장만 — 없으면 아무 말도 하지 않는다. */}
              {isKR && opinion ? (
                <div className={s.reasons}>
                  <ReasonList
                    label="긍정"
                    items={opinion.bull}
                    sign={1}
                    mode={mode}
                  />
                  <ReasonList
                    label="부정"
                    items={opinion.bear}
                    sign={-1}
                    mode={mode}
                  />
                </div>
              ) : (
                <div
                  style={{
                    padding: '10px 0 2px',
                    fontSize: 11,
                    color: 'var(--text-mut)',
                    lineHeight: 1.5,
                  }}
                >
                  {isKR
                    ? '지표를 집계하는 중입니다.'
                    : '해외 종목은 스코어 산출에 필요한 지표 소스가 없습니다.'}
                </div>
              )}
            </section>
            <section className="card">
              <div className="card-h">
                <span className="t">종목 정보</span>
                {isKR && (
                  <span className="tag">
                    {info ? 'KIS 실데이터' : '조회 중'}
                  </span>
                )}
              </div>
              {/* 국내는 KIS 실값만 쓴다. 없으면 "-" — 목 DETAIL_META(시총 468조·PER 12.8)를
                  실제(1,552조·40.45)처럼 보여주던 자리다. 배당은 KIS가 안 줘서 항상 "-". */}
              <div className={s.info}>
                {/* 미국은 무료 펀더멘털 소스가 없다 — 목 `detail.info`(시총 3.4조·PER 등 고정값)를
                    그리면 리서치 탭("-")과 같은 종목이 화면마다 다른 값으로 보인다. 전부 "-". */}
                <Info
                  k="시가총액"
                  v={isKR ? fmtMarketCapEok(info?.marketCapEok) : '-'}
                />
                <Info k="PER" v={isKR ? num1(info?.per) : '-'} />
                <Info k="PBR" v={isKR ? num2(info?.pbr) : '-'} />
                <Info
                  k="EPS"
                  v={isKR ? (info?.eps != null ? fmt(info.eps, 0) : '-') : '-'}
                />
                <Info k="배당" v="-" />
                <Info
                  k="거래량"
                  v={
                    isKR
                      ? info?.volume != null
                        ? fmtVol(info.volume)
                        : '-'
                      : '-'
                  }
                />
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

const num1 = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? v.toFixed(1) : '-';
const num2 = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? v.toFixed(2) : '-';

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoK}>{k}</span>
      <span className={`${s.infoV} mono`}>{v}</span>
    </div>
  );
}

function Band52({
  low,
  high,
  price,
  cur,
  dec,
  mode,
}: {
  low: number;
  high: number;
  price: number;
  cur: string;
  dec: number;
  mode: ColorMode;
}) {
  // 실 범위가 없으면(목 폴백 제거) 밴드를 그리지 않는다 — 0 으로 그리면 도트가 NaN% 로 사라진다.
  if (!(low > 0) || !(high > low)) {
    return (
      <div className={s.band}>
        <span className={`${s.bandV} mono`}>-</span>
      </div>
    );
  }
  const pos = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  // 저가(왼쪽)=하락색 → 고가(오른쪽)=상승색, colorMode 반영.
  const grad = `linear-gradient(90deg, ${signColor(-1, mode)}33, ${signColor(1, mode)}33)`;
  return (
    <div className={s.band}>
      <span className={`${s.bandV} mono`}>
        {cur}
        {fmt(low, dec)}
      </span>
      <div className={s.bandBar} style={{ background: grad }}>
        <div className={s.bandDot} style={{ left: `${pos}%` }} />
      </div>
      <span className={`${s.bandV} mono`}>
        {cur}
        {fmt(high, dec)}
      </span>
    </div>
  );
}

// 소켓 불안정 시 호가 자리표시("-") — 목 데이터로 오해 방지.
function DashOrderbook() {
  return (
    <div className={s.ob}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={s.obRow}>
          <span
            className={`${s.obPx} mono`}
            style={{ color: 'var(--text-mut)' }}
          >
            -
          </span>
          <span
            className={`${s.obQty} mono`}
            style={{ color: 'var(--text-mut)' }}
          >
            -
          </span>
        </div>
      ))}
    </div>
  );
}

function Orderbook({
  asks,
  bids,
  cur,
  dec,
  mode,
  onPickPrice,
}: {
  asks: Level[];
  bids: Level[];
  cur: string;
  dec: number;
  mode: 'global' | 'korea';
  onPickPrice?: (price: number) => void;
}) {
  const maxQty = Math.max(1, ...asks.map(l => l.qty), ...bids.map(l => l.qty));
  const up = signColor(1, mode),
    down = signColor(-1, mode);
  return (
    <div className={s.ob}>
      {[...asks].reverse().map((l, i) => (
        <ObRow
          key={'a' + i}
          level={l}
          max={maxQty}
          color={down}
          side="ask"
          cur={cur}
          dec={dec}
          onPickPrice={onPickPrice}
        />
      ))}
      {bids.map((l, i) => (
        <ObRow
          key={'b' + i}
          level={l}
          max={maxQty}
          color={up}
          side="bid"
          cur={cur}
          dec={dec}
          onPickPrice={onPickPrice}
        />
      ))}
    </div>
  );
}

function ObRow({
  level,
  max,
  color,
  side,
  cur,
  dec,
  onPickPrice,
}: {
  level: Level;
  max: number;
  color: string;
  side: 'ask' | 'bid';
  cur: string;
  dec: number;
  onPickPrice?: (price: number) => void;
}) {
  const w = `${Math.round((level.qty / max) * 100)}%`;
  return (
    <div
      className={s.obRow}
      onClick={() => onPickPrice?.(level.price)}
      style={{ cursor: onPickPrice ? 'pointer' : 'default' }}
    >
      <div
        className={s.obBar}
        style={
          {
            [side === 'ask' ? 'right' : 'left']: 0,
            width: w,
            background: color + '22',
          } as CSSProperties
        }
      />
      <span className={`${s.obPx} mono`} style={{ color }}>
        {cur}
        {fmt(level.price, dec)}
      </span>
      <span className={`${s.obQty} mono`}>{level.qty.toLocaleString()}</span>
    </div>
  );
}
