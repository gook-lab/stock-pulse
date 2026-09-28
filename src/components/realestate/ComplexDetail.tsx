import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  Badge,
  Button,
  EmptyState,
  SkeletonText,
  PriceChart,
  HorizontalBars,
  Segmented,
} from '@/components/common';
import toast from '@/lib/toast';
import { httpApi } from '@/data/httpApi';
import type {
  AptComplexDetail,
  SignalKey,
  AreaTier,
  AptDeal,
} from '@/data/types';
import { fmt, scaleColor, SIGNAL_DOMAIN, WARN } from '@/lib/colors';
import DealScatter from './DealScatter';
import ComplexTour from './ComplexTour';
import LoanCalc from './LoanCalc';
import s from './ComplexDetail.module.css';

interface ComplexDetailBodyProps {
  detail: AptComplexDetail;
  selectedArea: number | null;
  onSelectArea: (area: number | null) => void;
}

/** 단지 상세 내용 — 전체 화면 뷰가 감싼다. */
function ComplexDetailBody({
  detail,
  selectedArea,
  onSelectArea,
}: ComplexDetailBodyProps) {
  const screenerQuery = useStore(st => st.screenerQuery);
  const aptScreen = useStore(st => st.aptScreen);
  const colorMode = useStore(st => st.colorMode);
  const aptWatchlist = useStore(st => st.aptWatchlist);
  const toggleAptWatch = useStore(st => st.toggleAptWatch);

  const [deals, setDeals] = useState<AptDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [dealsStale, setDealsStale] = useState(false);

  // 거래 내역 조회
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 단지 전환 시 조회를 새로 시작하며 로딩·이전 값을 초기화한다 — 채움은 비동기 응답
    setDealsLoading(true);
    setDealsError(null);
    httpApi
      .getComplexDeals(detail.aptSeq)
      .then(result => {
        setDeals(
          result.deals.sort((a, b) => {
            const cmp = b.ym.localeCompare(a.ym);
            return cmp !== 0 ? cmp : (b.day ?? 0) - (a.day ?? 0);
          }),
        );
        setDealsStale(result.stale ?? false);
        setDealsLoading(false);
      })
      .catch(e => {
        setDealsError(String((e as Error)?.message || e));
        setDealsLoading(false);
      });
  }, [detail.aptSeq]);

  // ──── 시그널 관련 계산 ────
  const dealType = screenerQuery.dealType;
  const signal = screenerQuery.signal;
  const currentSignals = detail.signals[dealType];
  const signalDomain = SIGNAL_DOMAIN[signal];
  const valueOf = (key: SignalKey): number | null =>
    key === 'jeonseRatio' ? detail.signals.jeonseRatio : currentSignals[key];
  const signalValue = valueOf(signal);

  const rank = aptScreen?.ranked.find(r => r.id === detail.aptSeq);
  const rankText =
    rank && aptScreen
      ? `${rank.rank}위 / ${aptScreen.ranked.length}개`
      : `순위 밖 — 조건 미충족`;

  const timeseriesData = detail.series[dealType === 'trade' ? 't' : 'r'];
  const seriesValues = timeseriesData.map(([price]) => price);
  // 거래 없는 달은 0 이 아니라 null — 0 은 막대로 그릴 값이 아니다(가격 계열과 같은 규칙).
  const volumesValues = timeseriesData.map(([, count]) =>
    count > 0 ? count : null,
  );
  const provisionalFrom = Math.max(0, timeseriesData.length - 2);
  /* 추세선 — 월 1~2건인 달이 많아 월별 중앙값은 4,093 → 10,649 처럼 튄다.
     서버가 상세 응답에서 같은 정의(3개월 창의 모든 거래)로 계산해 준다. */
  const smoothedValues =
    detail.smoothed?.[dealType === 'trade' ? 't' : 'r'] ?? null;
  const trendSeries = smoothedValues?.some(v => v != null)
    ? [
        {
          name: '3개월 이동 중앙값',
          data: smoothedValues,
          color: 'var(--text-sub)',
          width: 1.6,
          dash: '8 5',
        },
      ]
    : [];

  // 기준월 평당가 — 시그널 계산과 같은 규칙(기준월 = 3개월 전, 거래 없는 달은 직전 유효값)
  const basisPrice = (() => {
    for (
      let i = Math.min(detail.months.length - 3, timeseriesData.length - 1);
      i >= 0;
      i--
    ) {
      const p = timeseriesData[i]?.[0];
      if (p != null) return Math.round(p);
    }
    return null;
  })();

  const tierBars = Object.entries(detail.tiers)
    .filter(([, tierData]) => {
      const prices = dealType === 'trade' ? tierData.t : tierData.r;
      return prices[0] != null && prices[1] > 0;
    })
    .map(([tier, tierData]) => {
      const [price, count] = dealType === 'trade' ? tierData.t : tierData.r;
      return {
        label: `${tier}㎡ · ${count}건`,
        value: price ?? 0,
      };
    });

  const dealCount = currentSignals.dealCount;
  const recentDeals = detail.recent.slice(0, 10);

  const formatSignal = (key: SignalKey, v: number | null): string => {
    if (v == null) return '—';
    switch (key) {
      case 'momentum3':
      case 'momentum6':
      case 'momentum12':
        return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
      case 'high52wPct':
        return v === 0 ? '신고가' : `${v.toFixed(1)}%`;
      case 'volumeRatio':
        return `${v.toFixed(2)}×`;
      case 'jeonseRatio':
        return `${Math.round(v * 100)}%`;
      case 'rs':
        return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%p`;
    }
  };

  const signalLabels: Record<SignalKey, string> = {
    momentum3: '3개월 모멘텀',
    momentum6: '6개월 모멘텀',
    momentum12: '12개월 모멘텀',
    high52wPct: '신고가 근접',
    volumeRatio: '거래량 돌파',
    jeonseRatio: '전세가율',
    rs: '상대강도',
  };
  const gridSignals = (Object.keys(signalLabels) as SignalKey[]).map(key => ({
    key,
    label:
      key === 'jeonseRatio' && detail.signals.jeonseRatioTier
        ? `전세가율 · ${detail.signals.jeonseRatioTier}㎡`
        : signalLabels[key],
  }));

  const dealTypeLabel = dealType === 'trade' ? '매매' : '전세/월세';
  const buildYearText = detail.buildYear
    ? `${detail.buildYear}년 준공`
    : '준공연도 미상';

  // ──── 평형 탭 ────
  const areaTiers: AreaTier[] = ['~60', '60~85', '85~135', '135~'];
  const availableTiers = areaTiers.filter(tier => {
    const tierData = detail.tiers[tier];
    if (!tierData) return false;
    const prices = dealType === 'trade' ? tierData.t : tierData.r;
    return prices[0] != null && prices[1] > 0;
  });

  const tierAreas = {
    '~60': 30,
    '60~85': 72,
    '85~135': 110,
    '135~': 150,
  } as Record<AreaTier, number>;

  return (
    <div className={s.body}>
      {/* ① 헤더 */}
      <div className={s.header}>
        <div className={s.titleGroup}>
          <h2 className={s.title}>{detail.aptNm}</h2>
          <button
            onClick={() => toggleAptWatch(detail.aptSeq)}
            className={`${s.watchBtn} ${aptWatchlist.includes(detail.aptSeq) ? s.watchBtnActive : ''}`}
            title={
              aptWatchlist.includes(detail.aptSeq)
                ? '워치리스트에서 제거'
                : '워치리스트에 추가'
            }
            aria-pressed={aptWatchlist.includes(detail.aptSeq)}
            aria-label="관심단지 담기"
          >
            ★
          </button>
        </div>
        <div className={s.badges}>
          {detail.source === 'mock' && <Badge color={WARN}>목 데이터</Badge>}
          {detail.areaTier && <Badge>{detail.areaTier}㎡ 중심</Badge>}
          {detail.lat == null && <Badge>좌표없음</Badge>}
        </div>
        <div className={s.subline}>
          <span>
            {detail.gu} {detail.umdNm}
          </span>
          <span>·</span>
          <span>{detail.roadnm}</span>
          <span>·</span>
          <span>{buildYearText}</span>
        </div>
      </div>

      {/* ② 현재 시그널 */}
      <div className={s.signalSection}>
        <div className={s.currentSignal}>
          <span className={s.signalLabel}>{signalLabels[signal]}</span>
          <div
            className={s.signalValue}
            style={{
              color: scaleColor(signalValue, signalDomain, colorMode),
            }}
          >
            {formatSignal(signal, signalValue)}
          </div>
          <div className={s.rankText}>{rankText}</div>
          <div className={s.rankText}>
            기준월 평당가{' '}
            <span className="mono">
              {basisPrice != null ? `${fmt(basisPrice, 0)}만` : '—'}
            </span>
          </div>
        </div>

        <div className={s.signalGrid}>
          {gridSignals.map(({ key, label }) => {
            const v = valueOf(key);
            return (
              <div key={key} className={s.gridCell}>
                <div className={s.gridLabel}>{label}</div>
                <div
                  className={s.gridValue}
                  style={{
                    color: scaleColor(v, SIGNAL_DOMAIN[key], colorMode),
                  }}
                >
                  {formatSignal(key, v)}
                </div>
              </div>
            );
          })}
        </div>

        <div className={s.dealCount}>{dealCount}건 거래</div>
      </div>

      {/* ③ PriceChart (기존) */}
      <div className={s.chartSection}>
        <PriceChart
          name={detail.aptNm}
          code={detail.aptSeq}
          cur=""
          dec={0}
          series={{ '1년': seriesValues }}
          volumes={{ '1년': volumesValues }}
          labels={{
            '1년': detail.months.map(m => `${m.slice(2, 4)}.${m.slice(4)}`),
          }}
          compareSeries={{ '1년': trendSeries }}
          mode={colorMode}
          defaultPeriod="1년"
          height={220}
          provisionalFrom={provisionalFrom}
          liveBadge="월별 실거래"
          singlePointNote="거래가 한 달에만 있어 추세를 그릴 수 없습니다 · 점 하나가 그 달의 값입니다"
        />
        <div className={s.chartCaption}>
          {dealTypeLabel} 평당가(만원) · 최근 2개월은 신고지연으로 미확정
          {detail.outliers ? ` · 이상치 제외 ${detail.outliers}건` : ''}
        </div>
      </div>

      {/* ④ 평형 탭 + DealScatter */}
      {availableTiers.length > 0 && (
        <div className={s.dealScatterSection}>
          <div className={s.sectionLabel}>평형대별 거래</div>
          <Segmented
            options={availableTiers.map(tier => ({
              label: tier + '㎡',
              value: tier,
            }))}
            value={
              (selectedArea
                ? (Object.keys(tierAreas).find(
                    k => tierAreas[k as AreaTier] === selectedArea,
                  ) as AreaTier)
                : availableTiers[0]) || availableTiers[0]
            }
            onChange={tier =>
              onSelectArea(tier ? tierAreas[tier as AreaTier] : null)
            }
          />
          <DealScatter
            deals={deals}
            selectedArea={selectedArea}
            loading={dealsLoading}
            error={dealsError}
            stale={dealsStale}
            onRetry={() =>
              httpApi
                .getComplexDeals(detail.aptSeq)
                .then(r => {
                  setDeals(
                    r.deals.sort((a, b) => {
                      const cmp = b.ym.localeCompare(a.ym);
                      return cmp !== 0 ? cmp : (b.day ?? 0) - (a.day ?? 0);
                    }),
                  );
                  setDealsStale(r.stale ?? false);
                  setDealsError(null);
                })
                .catch(e => setDealsError(String((e as Error)?.message || e)))
            }
          />
        </div>
      )}

      {/* 단지투어 — 실사 뷰(로드뷰) + 층별 가격 */}
      <ComplexTour detail={detail} />

      {/* ⑤ KB시세 vs 실거래 (데이터 없음 상태) */}
      <div className={s.kbSection}>
        <div className={s.sectionLabel}>KB시세 vs 실거래</div>
        <div className={s.kbDisabled}>
          <div className={s.row}>
            <span>KB시세</span>
            <span className={s.dash}>—</span>
            <span className={s.note}>미연동</span>
          </div>
          <div className={s.row}>
            <span>실거래 매매</span>
            <span className={s.dash}>—</span>
            <span className={s.note}>활용신청 승인 대기</span>
          </div>
        </div>
      </div>

      {/* ⑥ 대출 계산기 */}
      <div className={s.loanSection}>
        <LoanCalc recentPrice={detail.recent[0]?.price ?? null} />
      </div>

      {/* ⑦ HorizontalBars (평형별) */}
      {tierBars.length > 0 && (
        <div className={s.tiersSection}>
          {/* tiers 는 평당가 중앙값이다(types.ts). "평형별 매매 5,030만" 으로 쓰면 총액으로 읽힌다. */}
          <div className={s.tiersLabel}>평형별 {dealTypeLabel} 평당가</div>
          <HorizontalBars
            data={tierBars}
            highlight={
              tierBars.find(
                b =>
                  detail.areaTier && b.label.startsWith(`${detail.areaTier}㎡`),
              )?.label
            }
            format={v => `${fmt(v, 0)}만/평`}
            labelWidth={110}
          />
        </div>
      )}

      {/* ⑧ 최근 거래 테이블 */}
      {recentDeals.length > 0 && (
        <div className={s.tableSection}>
          <div className={s.tableLabel}>최근 거래</div>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>계약일</th>
                <th className={s.th}>유형</th>
                <th className={s.th}>전용</th>
                <th className={s.th}>층</th>
                <th className={s.th}>금액</th>
              </tr>
            </thead>
            <tbody>
              {recentDeals.map((deal, i) => {
                const ym = deal.ym.slice(0, 4) + '.' + deal.ym.slice(4);
                const dateStr = deal.day
                  ? `${ym}.${String(deal.day).padStart(2, '0')}`
                  : ym;
                const kindLabel =
                  deal.kind === 'trade'
                    ? '매매'
                    : deal.monthlyRent && deal.monthlyRent > 0
                      ? '월세'
                      : '전세';
                const areaStr = deal.area ? deal.area.toFixed(1) : '—';
                const floorStr = deal.floor ? String(deal.floor) : '—';
                const priceStr =
                  deal.kind === 'trade' ||
                  deal.monthlyRent === 0 ||
                  deal.monthlyRent == null
                    ? `${fmt(deal.price, 0)}만`
                    : `${fmt(deal.price, 0)}/${fmt(deal.monthlyRent, 0)}`;

                return (
                  <tr key={i} className={s.tr}>
                    <td className={s.td}>{dateStr}</td>
                    <td className={s.td}>{kindLabel}</td>
                    <td className={s.td}>{areaStr}㎡</td>
                    <td className={s.td}>{floorStr}</td>
                    <td className={`${s.td} ${s.tdMoney}`}>{priceStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 단지 상세 — 전체 화면 뷰(주식 탭의 '종목 상세'와 같은 패턴).
 * 모달이 아니라 화면 전환인 이유: 차트·평형별·최근거래를 좁은 폭에 우겨넣으면
 * 시그널 라벨이 세로로 찌그러지고 차트가 읽히지 않는다(380px 시트에서 실제로 그랬다).
 */
export default function ComplexDetail() {
  const selectedComplexId = useStore(st => st.selectedComplexId);
  const selectComplex = useStore(st => st.selectComplex);

  const [detail, setDetail] = useState<AptComplexDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const reqId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedComplexId) {
      reqId.current = null;
      return;
    }
    const id = selectedComplexId;
    reqId.current = id;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 단지 전환 시 조회를 새로 시작하며 로딩·이전 값을 초기화한다 — 채움은 비동기 응답
    setLoading(true);
    setDetail(null);
    setSelectedArea(null);
    httpApi
      .getAptComplex(id)
      .then(d => {
        if (reqId.current === id) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch(e => {
        if (reqId.current !== id) return;
        setLoading(false);
        toast.error({
          message: `단지 상세 조회 실패: ${String((e as Error)?.message || e)}`,
        });
      });
  }, [selectedComplexId]);

  const back = () => selectComplex(null);

  // 모달에서 Esc 로 닫던 습관을 그대로 — 전체 화면에서도 Esc 는 목록 복귀다.
  useEffect(() => {
    if (!selectedComplexId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectComplex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedComplexId, selectComplex]);

  if (!selectedComplexId) return null;

  return (
    <section className={s.pageWrap} aria-label="단지 상세">
      <div className={s.pageHead}>
        <Button variant="subtle" size="sm" onClick={back}>
          ← 스크리너로
        </Button>
      </div>
      {loading ? (
        <SkeletonText lines={10} />
      ) : detail ? (
        <ComplexDetailBody
          detail={detail}
          selectedArea={selectedArea}
          onSelectArea={setSelectedArea}
        />
      ) : (
        <EmptyState
          title="데이터 없음"
          desc="재건축이나 개명으로 인해 조회할 수 없는 단지입니다."
          action={
            <Button variant="subtle" size="sm" onClick={back}>
              스크리너로 돌아가기
            </Button>
          }
        />
      )}
    </section>
  );
}

export { ComplexDetailBody };
