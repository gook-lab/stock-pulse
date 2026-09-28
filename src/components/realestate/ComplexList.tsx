import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from '@/store/useStore';
import {
  Badge,
  Bar,
  Button,
  EmptyState,
  SkeletonRows,
} from '@/components/common';
import { fmt, scaleColor, signColor, SIGNAL_DOMAIN, WARN } from '@/lib/colors';
import type { ColorDomain, ColorMode } from '@/lib/colors';
import type { AptComplex, ScreenRank, SignalKey } from '@/data/types';
import s from './ComplexList.module.css';
import { SIGNAL_LABELS, formatSignalValue } from './ComplexList.helpers';

/** 지난 갱신 대비 Δ. 시그널 값의 차이 그대로 — 비율의 비율을 만들지 않는다. */
function formatDelta(diff: number, signal: SignalKey): string {
  const sign = diff >= 0 ? '+' : '';
  if (signal === 'volumeRatio') return `Δ${sign}${diff.toFixed(2)}×`;
  if (signal === 'jeonseRatio') return `Δ${sign}${Math.round(diff * 100)}%p`;
  return `Δ${sign}${diff.toFixed(1)}%p`;
}

/** 바 길이 — 계약의 바 공식. 값이 null 이면 0. */
function barFraction(value: number | null, d: ColorDomain): number {
  if (value == null) return 0;
  const f = d.bipolar
    ? Math.abs(value - d.mid) / (value >= d.mid ? d.max - d.mid : d.mid - d.min)
    : (value - d.min) / (d.max - d.min);
  return Math.max(0, Math.min(1, f));
}

interface RowProps {
  refKey: string; // 관심단지·본 리스트에 같은 단지가 둘 다 있을 수 있어 섹션 접두
  aptSeq: string;
  rank: ScreenRank | null; // ranked 에 없으면 null — 조건 미충족·소멸 단지
  master: AptComplex | undefined;
  signal: SignalKey;
  domain: ColorDomain;
  mode: ColorMode;
  /** 지도가 죽어 있으면 좌표없음 배지는 소음일 뿐이다 — 지도 활성 시에만 표시 */
  showCoordBadge: boolean;
  watched: boolean;
  hovered: boolean;
  tabbable: boolean; // roving tabindex — 이 행이 탭 대상인지
  delta: number | null; // 지난 갱신 대비. 관심단지 행에서만 값이 온다
  registerRef: (key: string, el: HTMLDivElement | null) => void;
  onArrow: (key: string, dir: 1 | -1) => void;
  onFocused: (refKey: string) => void; // 포커스 받으면 부모 activeKey 업데이트
}

/**
 * 리스트 행. 컴포넌트 밖에 정의한다 — 부모 렌더마다 컴포넌트 타입이 새로 만들어지면
 * React 가 행을 전부 재마운트해서 키보드 포커스가 날아간다.
 */
const Row = React.memo(function Row({
  refKey,
  aptSeq,
  rank,
  master,
  signal,
  domain,
  mode,
  showCoordBadge,
  watched,
  hovered,
  tabbable,
  delta,
  registerRef,
  onArrow,
  onFocused,
}: RowProps) {
  const selectComplex = useStore(st => st.selectComplex);
  const setHoveredComplex = useStore(st => st.setHoveredComplex);
  const toggleAptWatch = useStore(st => st.toggleAptWatch);
  const ref = useRef<HTMLDivElement | null>(null);

  // 지도발 hover 만 스크롤 — 리스트 자체 hover 에서 스크롤이 튀면 마우스 아래 행이 바뀌어 버린다
  useEffect(() => {
    if (hovered && useStore.getState().hoverSource === 'map') {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [hovered]);

  const value = rank?.value ?? null;
  const color = scaleColor(value, domain, mode);
  const missing = !master && !rank; // 배치에서 사라진 관심단지 (미해결결정 3 — 지우지 않고 남긴다)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onArrow(refKey, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onArrow(refKey, -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectComplex(aptSeq);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggleAptWatch(aptSeq);
    }
  };

  return (
    <div
      ref={el => {
        ref.current = el;
        registerRef(refKey, el);
      }}
      className={hovered ? `${s.row} ${s.rowHover}` : s.row}
      onMouseEnter={() => setHoveredComplex(aptSeq)}
      onMouseLeave={() => setHoveredComplex(null)}
      onFocus={() => {
        setHoveredComplex(aptSeq);
        onFocused(refKey);
      }}
      onClick={() => selectComplex(aptSeq)}
      onKeyDown={onKeyDown}
      tabIndex={tabbable ? 0 : -1}
      role="button"
      aria-label={`${master?.aptNm ?? aptSeq} ${formatSignalValue(value, signal)}`}
    >
      <span className={`${s.rank} mono`}>{rank ? rank.rank : '—'}</span>

      <div className={s.nameCol}>
        {master ? (
          <>
            <span className={s.name}>{master.aptNm}</span>
            {master.gu && <span className={s.gu}>{master.gu}</span>}
            {showCoordBadge && master.lat == null && <Badge>좌표없음</Badge>}
          </>
        ) : (
          <>
            <span className={`${s.code} mono`}>{aptSeq}</span>
            {missing && <Badge>데이터 없음</Badge>}
          </>
        )}
      </div>

      <div className={s.barCell}>
        <Bar
          fraction={barFraction(value, domain)}
          color={color}
          className={s.bar}
        />
        <span className={`${s.value} mono`} style={{ color }}>
          {formatSignalValue(value, signal)}
          {delta != null && (
            <span className={s.delta} style={{ color: signColor(delta, mode) }}>
              {' '}
              {formatDelta(delta, signal)}
            </span>
          )}
        </span>
      </div>

      {/* 기준월 평당가 — 시그널 %만으로는 "얼마짜리 단지"인지 알 수 없다 */}
      <span className={`${s.price} mono`}>
        {rank?.price != null ? `${fmt(rank.price, 0)}만` : '—'}
      </span>

      <span className={`${s.deals} mono`}>{rank ? rank.deals : '—'}</span>

      <button
        className={s.watchBtn}
        style={watched ? { color: WARN } : undefined}
        onClick={e => {
          e.stopPropagation();
          toggleAptWatch(aptSeq);
        }}
        aria-pressed={watched}
        title={watched ? '관심 해제' : '관심 담기'}
      >
        ★
      </button>
    </div>
  );
});

export default function ComplexList() {
  const screen = useStore(st => st.aptScreen);
  const loading = useStore(st => st.aptScreenLoading);
  const complexes = useStore(st => st.aptComplexes);
  const watchlist = useStore(st => st.aptWatchlist);
  const snapshot = useStore(st => st.aptSnapshot);
  const hoveredId = useStore(st => st.hoveredComplexId);
  const query = useStore(st => st.screenerQuery);
  const mode = useStore(st => st.colorMode);
  const mapFailed = useStore(st => st.aptMapFailed);
  const areaFilter = useStore(st => st.areaFilter);
  const setAreaFilter = useStore(st => st.setAreaFilter);
  const viewportBounds = useStore(st => st.viewportBounds);
  const viewportSync = useStore(st => st.viewportSync);
  const setViewportSync = useStore(st => st.setViewportSync);

  const [visible, setVisible] = useState(50);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 정규 조작면의 ↑↓ 이동 — 관심단지 → 본 리스트로 이어지는 하나의 순서
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const orderRef = useRef<string[]>([]);

  // 조건이 바뀌면 보이는 개수를 처음으로 — 렌더 중에 이전 조건과 비교해 조정한다
  const resetKey = [
    query.signal,
    query.dealType,
    query.minDeals,
    areaFilter,
    query.areaTier,
  ] as const;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey.some((v, i) => !Object.is(v, prevResetKey[i]))) {
    setPrevResetKey(resetKey);
    setVisible(50);
  }

  const masterMap = useMemo(() => {
    const m = new Map<string, AptComplex>();
    complexes?.items.forEach(c => m.set(c.aptSeq, c));
    return m;
  }, [complexes]);

  const rankedMap = useMemo(() => {
    const m = new Map<string, ScreenRank>();
    screen?.ranked.forEach(r => m.set(r.id, r));
    return m;
  }, [screen]);

  // 지역 필터(지도 동 박스·헤드라인 구 클릭)는 클라이언트에서 좁힌다 —
  // 서버로 보내면 순위가 지역 안에서 재번호되어 "서울 전체 N위"라는 스크리너 문장이 깨진다.
  // ⚠ 모든 훅은 아래 조기 반환(!screen)보다 앞에 있어야 한다 — 훅 순서 규칙.
  const areaRanked = useMemo(() => {
    const ranked = screen?.ranked ?? [];
    const byArea = areaFilter
      ? ranked.filter(r => {
          const m = masterMap.get(r.id);
          return (
            m?.gu === areaFilter.gu &&
            (!areaFilter.umdNm || m?.umdNm === areaFilter.umdNm)
          );
        })
      : ranked;
    // 뷰포트 연동 — 지도가 보여주는 범위와 리스트를 일치시킨다.
    // 서버 bbox 가 아니라 클라이언트 필터인 이유: 서버가 자르면 순위가 화면 안에서
    // 1부터 다시 매겨져 "서울 전체 415위"라는 스크리너의 문장이 사라진다.
    if (!viewportSync || !viewportBounds || mapFailed) return byArea;
    const { swLat, swLng, neLat, neLng } = viewportBounds;
    return byArea.filter(r => {
      const m = masterMap.get(r.id);
      return (
        m?.lat != null &&
        m.lng != null &&
        m.lat >= swLat &&
        m.lat <= neLat &&
        m.lng >= swLng &&
        m.lng <= neLng
      );
    });
  }, [screen, areaFilter, masterMap, viewportSync, viewportBounds, mapFailed]);

  const registerRef = useCallback((key: string, el: HTMLDivElement | null) => {
    rowRefs.current.set(key, el);
  }, []);

  const onArrow = useCallback((key: string, dir: 1 | -1) => {
    const order = orderRef.current;
    const i = order.indexOf(key);
    if (i < 0) return;
    for (let j = i + dir; j >= 0 && j < order.length; j += dir) {
      const el = rowRefs.current.get(order[j]);
      if (el) {
        el.focus();
        return;
      }
    }
  }, []);

  const onFocused = useCallback((refKey: string) => {
    setActiveKey(refKey);
  }, []);

  const visibleRanks = areaRanked.slice(0, visible);

  // ↑↓ 이동 순서 = 이번 렌더에 실제로 그려지는 행 순서.
  // 렌더 중에 ref 로 쓰지 않는다 — React 가 렌더를 버리면 커밋되지 않은 순서가
  // ref 에 남는다. 렌더에서는 순수한 값을 쓰고, 핸들러용 ref 는 커밋 뒤에 맞춘다.
  // ⚠️ 훅이라 조기 return 보다 위에 있어야 한다.
  const order = screen
    ? [...watchlist.map(id => `w:${id}`), ...visibleRanks.map(r => `r:${r.id}`)]
    : [];
  useLayoutEffect(() => {
    orderRef.current = order;
  });

  if (!screen)
    return (
      <div className={s.container}>
        <SkeletonRows rows={12} />
      </div>
    );

  const { signal } = screen;
  const domain = SIGNAL_DOMAIN[signal];

  // 유효 키: order 에 있는 key 만 tabbable. 필터 변경으로 사라지면 첫 행.
  const validKey =
    activeKey && order.includes(activeKey) ? activeKey : (order[0] ?? null);

  // 지난 갱신 대비 — 같은 시그널·거래유형의 스냅샷 쌍이 있을 때만 (다른 시그널 값끼리 Δ 금지)
  const canDelta =
    snapshot.cur &&
    snapshot.prev &&
    snapshot.cur.signal === signal &&
    snapshot.prev.signal === signal &&
    snapshot.cur.dealType === screen.dealType &&
    snapshot.prev.dealType === screen.dealType;
  const deltaOf = (id: string): number | null => {
    if (!canDelta) return null;
    const cur = snapshot.cur!.values[id],
      prev = snapshot.prev!.values[id];
    return cur != null && prev != null ? cur - prev : null;
  };

  const rowCommon = {
    signal,
    domain,
    mode,
    registerRef,
    onArrow,
    onFocused,
    showCoordBadge: !mapFailed,
  };

  return (
    <div className={s.container}>
      {watchlist.length > 0 && (
        <div className={s.watchSection}>
          <div className={s.watchHeader}>
            <span style={{ color: WARN }}>★</span>
            <span className={s.watchTitle}>내 관심단지 {watchlist.length}</span>
            {canDelta && (
              <span className={s.watchSubtitle}>· 지난 갱신 대비</span>
            )}
          </div>
          <div
            className={
              loading ? `${s.listWrapper} ${s.listLoading}` : s.listWrapper
            }
          >
            {watchlist.map(id => (
              <Row
                key={`w:${id}`}
                refKey={`w:${id}`}
                aptSeq={id}
                rank={rankedMap.get(id) ?? null}
                master={masterMap.get(id)}
                watched
                hovered={hoveredId === id}
                tabbable={validKey === `w:${id}`}
                delta={deltaOf(id)}
                {...rowCommon}
              />
            ))}
          </div>
        </div>
      )}

      {screen.ranked.length === 0 ? (
        <EmptyState
          title="조건에 맞는 단지가 없습니다"
          desc={
            query.dealType === 'trade' || query.signal === 'jeonseRatio'
              ? // 전세가율은 매매·전세 양쪽이 필요 — 매매가 없으면 계산 가능 단지가 0이다
                '매매 실거래 데이터가 아직 없습니다. data.go.kr 활용신청 승인 후 pnpm collect --with-trade 를 실행하세요.'
              : '최소거래 조건을 완화해 보세요.'
          }
        />
      ) : (
        <>
          {/* 화면 연동 — 지도가 보여주는 범위와 리스트를 맞춘다.
              전역 카운트를 함께 적어 "서울 전체 중 지금 여기"라는 감각을 잃지 않게 한다. */}
          {!mapFailed && (
            <div className={s.areaChipRow}>
              <button
                className={
                  viewportSync ? `${s.syncChip} ${s.syncOn}` : s.syncChip
                }
                onClick={() => setViewportSync(!viewportSync)}
                aria-pressed={viewportSync}
              >
                {viewportSync ? '✓ 화면 영역만' : '화면 영역만'}
              </button>
              <span className={s.syncCount}>
                {viewportSync && viewportBounds ? (
                  <>
                    화면 안{' '}
                    <span className="mono">
                      {areaRanked.length.toLocaleString()}
                    </span>{' '}
                    · 서울 전체{' '}
                    <span className="mono">
                      {screen.ranked.length.toLocaleString()}
                    </span>
                  </>
                ) : (
                  <>
                    서울 전체{' '}
                    <span className="mono">
                      {screen.ranked.length.toLocaleString()}
                    </span>
                    개
                  </>
                )}
              </span>
            </div>
          )}

          {areaFilter && (
            <div className={s.areaChipRow}>
              <span className={s.areaChip}>
                {areaFilter.gu}
                {areaFilter.umdNm ? ` ${areaFilter.umdNm}` : ''} · 단지{' '}
                <span className="mono">
                  {areaRanked.length.toLocaleString()}
                </span>
              </span>
              <button
                className={s.areaClear}
                onClick={() => setAreaFilter(null)}
                aria-label="지역 필터 해제"
              >
                해제 ✕
              </button>
            </div>
          )}

          {!areaFilter &&
          viewportSync &&
          viewportBounds &&
          areaRanked.length === 0 &&
          screen.ranked.length > 0 ? (
            <EmptyState
              title="이 화면 영역에는 조건을 만족하는 단지가 없습니다"
              desc={`지도를 옮기거나 축소해 보세요. 서울 전체로는 ${screen.ranked.length.toLocaleString()}개가 조건을 만족합니다.`}
              action={
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setViewportSync(false)}
                >
                  서울 전체 보기
                </Button>
              }
            />
          ) : areaFilter && areaRanked.length === 0 ? (
            <EmptyState
              title="이 지역에 조건을 만족하는 단지가 없습니다"
              desc="지역 필터를 해제하거나 최소거래 조건을 완화해 보세요."
              action={
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setAreaFilter(null)}
                >
                  지역 필터 해제
                </Button>
              }
            />
          ) : (
            <>
              <div className={s.headerRow}>
                <span>순위</span>
                <span>단지</span>
                <span>{SIGNAL_LABELS[signal]}</span>
                <span className={s.headPrice}>평당가</span>
                <span className={s.headDeals}>거래</span>
              </div>

              <div
                className={
                  loading ? `${s.listWrapper} ${s.listLoading}` : s.listWrapper
                }
              >
                {visibleRanks.map(r => (
                  <Row
                    key={`r:${r.id}`}
                    refKey={`r:${r.id}`}
                    aptSeq={r.id}
                    rank={r}
                    master={masterMap.get(r.id)}
                    watched={watchlist.includes(r.id)}
                    hovered={hoveredId === r.id}
                    tabbable={validKey === `r:${r.id}`}
                    delta={null}
                    {...rowCommon}
                  />
                ))}
              </div>

              {visible < areaRanked.length && (
                <Button
                  variant="subtle"
                  block
                  onClick={() => setVisible(v => v + 50)}
                >
                  더 보기 {Math.min(50, areaRanked.length - visible)}개
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
