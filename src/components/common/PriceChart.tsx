/**
 * PriceChart — 토스 증권 스타일 가격 차트
 *
 * 기간 탭 · 좌우 드래그 스크럽 · 크로스헤어 툴팁 · 휠/핀치 줌 · 팬 · 구간 미니맵
 * 라인 / 캔들 전환, 거래량 바(스크럽 연동) 포함.
 *
 * 입력 분리 (제스처 충돌 방지)
 *   마우스 : 호버 = 스크럽, 드래그 = 팬, 휠 = 줌
 *   터치   : 드래그 = 스크럽, 두 손가락 = 핀치 줌
 *
 * 사용:
 *   <PriceChart
 *     name="삼성전자" code="005930" cur="₩" dec={0}
 *     series={{ '1일': [...], '1개월': [...] }}
 *     volumes={{ '1일': [...], '1개월': [...] }}
 *     candles={{ '1개월': [{o,h,l,c}, ...] }}   // 선택
 *     mode={colorMode}                          // 'korea' | 'global'
 *   />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { calcMinMax, CompareSeries } from './PriceChart.helpers';
import { brandWithAlpha, colors } from '../../lib/colors';

export type Period = '1일' | '1주' | '1개월' | '3개월' | '1년' | '5년';
export const PERIODS: Period[] = ['1일', '1주', '1개월', '3개월', '1년', '5년'];

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

interface Props {
  name: string;
  code: string;
  cur?: string;
  dec?: number;
  /** 기간별 종가 배열. null 허용 — 거래 없는 달은 선을 끊는다(보간 금지) */
  series: Partial<Record<Period, (number | null)[]>>;
  /** 기간별 거래량 배열(선택). null 허용. */
  volumes?: Partial<Record<Period, (number | null)[]>>;
  /** 기간별 캔들(선택). 있으면 캔들 토글 노출 */
  candles?: Partial<Record<Period, Candle[]>>;
  /** 기간별 X축 라벨(선택). 없으면 인덱스 표시 */
  labels?: Partial<Record<Period, string[]>>;
  /** 기간별 비교 시리즈(선택). 메인 시리즈와 같은 X축을 공유하고 min/max에 포함됨 */
  compareSeries?: Partial<Record<Period, CompareSeries[]>>;
  mode?: 'korea' | 'global';
  defaultPeriod?: Period;
  height?: number;
  /** 전일 대비(기본 헤더 표시용). 기간 탭을 누르면 해당 기간 기준으로 전환. */
  dayChange?: number;
  dayChangePct?: number;
  /**
   * 기간별 등락 기준가. 있으면 스크럽·줌과 무관하게 이 값을 기준으로 등락을 낸다.
   *
   * 주식 1일 차트가 이게 없으면 안 된다. 기본 기준가는 "보이는 구간의 첫 점"이라
   * 구간을 좁히면 기준이 같이 움직이고, 한 점까지 확대하면 base==현재가가 되어 +0.00%가 된다.
   * 1일 등락은 언제나 전일 종가 대비여야 한다.
   */
  baseValue?: Partial<Record<Period, number>>;
  /**
   * 관측이 한 점뿐일 때 아래에 붙일 설명. 도메인마다 이유가 달라 호출자가 준다
   * (월별 실거래는 "그 달에만 거래", 주식은 확대/데이터 부족 — 부동산 문구를 주식에 쓰면 거짓말).
   */
  singlePointNote?: string;
  /** 해당 인덱스부터 끝까지를 미확정 구간으로: 회색 점선 선 + 영역 채움 없음. */
  provisionalFrom?: number;
  /** 헤더 상태 배지 문구. 월별 실거래처럼 "실시간"이 거짓말이 되는 데이터가 덮어쓴다. */
  liveBadge?: string;
  /** 배지 톤. 'warn' = 목/합성 데이터 — 초록(실시간) 배지를 그대로 쓰면 문구만 바꿔도 진짜처럼 보인다. */
  liveBadgeTone?: 'live' | 'warn';
}

const MIN_POINTS = 14;
/** 값 범위 상하 여백(비율). 선이 캔버스 가장자리에 닿지 않게 한다. */
const VALUE_PAD = 0.08;
const MAX_ZOOM = 14;

export default function PriceChart({
  name,
  code,
  cur = '₩',
  dec = 0,
  series,
  volumes,
  candles,
  labels,
  compareSeries,
  mode = 'korea',
  defaultPeriod = '1개월',
  height = 250,
  dayChange,
  dayChangePct,
  baseValue,
  singlePointNote,
  provisionalFrom,
  liveBadge = '실시간',
  liveBadgeTone = 'live',
}: Props) {
  // 등락색은 colors.ts 가 단일 소스다 — 여기서 다시 정의하면 팔레트가 두 곳으로 갈라진다.
  const { up: UP, down: DOWN } = colors(mode);

  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [touched, setTouched] = useState(false); // 기간 탭을 눌렀는지(누르기 전 기본은 전일 대비)
  const [kind, setKind] = useState<'line' | 'candle'>('line');
  const [idx, setIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [start, setStart] = useState(0);
  const [w, setW] = useState(900);

  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const panX = useRef<number | null>(null);

  const full = useMemo(
    () => (series[period] ?? []) as (number | null)[],
    [series, period],
  );
  const N = full.length;
  const cnt = Math.max(MIN_POINTS, Math.round(N / zoom));
  const clampStart = useCallback(
    (v: number) => Math.max(0, Math.min(N - cnt, v)),
    [N, cnt],
  );
  const s0 = clampStart(Math.round(start));

  // 기간 변경 시 초기화
  useEffect(() => {
    setIdx(null);
    setZoom(1);
    setStart(0);
  }, [period]);

  // 현재 period에 데이터가 없으면(종목 전환으로 기간 세트가 바뀐 경우) 가용 기간으로 보정.
  useEffect(() => {
    if (!series[period]?.length) {
      const a = PERIODS.find(p => series[p]?.length);
      if (a && a !== period) setPeriod(a);
    }
  }, [series, period]);

  // 폭 측정
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => setW(Math.max(320, el.clientWidth));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyZoom = useCallback(
    (next: number, anchorT = 0.5) => {
      const z = Math.max(1, Math.min(MAX_ZOOM, next));
      const nextCnt = Math.max(MIN_POINTS, Math.round(N / z));
      const anchor = s0 + anchorT * cnt;
      setZoom(z);
      setStart(Math.max(0, Math.min(N - nextCnt, anchor - anchorT * nextCnt)));
    },
    [N, cnt, s0],
  );

  // 휠 줌 (passive:false 필요 → 네이티브 리스너)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const t = (e.clientX - b.left) / Math.max(1, b.width);
      applyZoom(zoom * (e.deltaY < 0 ? 1.22 : 1 / 1.22), t);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, zoom]);

  const data = full.slice(s0, s0 + cnt);
  const n = data.length;
  const atEnd = s0 + cnt >= N;

  const pad = { l: 6, r: 6, t: 16, b: 12 };
  // null을 제외하고 min/max 계산 (compareSeries 포함)
  const cmpSeries = compareSeries?.[period] ?? [];
  const minMaxResult = calcMinMax(data, cmpSeries);
  const mn = minMaxResult.min;
  const mx = minMaxResult.max;
  /* 값이 하나뿐이면 min===max 라 그 점이 차트 맨 아래에 붙는다(고장으로 보인다).
     스케일만 위아래로 벌려 가운데 오게 하고, 눈금은 그리지 않는다 — 없는 범위를 숫자로 말하면 안 된다. */
  const flat = mx === mn;
  /* 값 범위에 여백을 준다. 최저·최고가 플롯 경계에 딱 붙으면 꺾인 선이 아래위에서
     잘린 것처럼 보인다(실측: 건영 차트의 저점 세 개가 캔버스 바닥에 닿아 있었다). */
  const roomy = (mx - mn) * VALUE_PAD;
  const lo = flat ? mn - Math.max(1, Math.abs(mn) * 0.05) : mn - roomy;
  const hi = flat ? mx + Math.max(1, Math.abs(mx) * 0.05) : mx + roomy;
  const span = hi - lo || 1;
  const X = (i: number) =>
    pad.l + ((w - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const Y = (v: number | null) => {
    if (v == null) return pad.t;
    return pad.t + (height - pad.t - pad.b) * (1 - (v - lo) / span);
  };

  // 기준가: 호출자가 준 기간 기준가(주식 1일 = 전일 종가)가 있으면 그것을, 없으면 보이는 구간 첫 값.
  // 구간 기준으로만 계산하면 확대할 때 기준이 함께 움직여 1일 등락이 전일 대비가 아니게 된다.
  const fixedBase = baseValue?.[period];
  const base =
    fixedBase && fixedBase > 0 ? fixedBase : (data.find(v => v != null) ?? 0);
  // 마지막 **유효값**. 부동산 월별 실거래처럼 최근 달이 null 이면 0 으로 읽혀
  // 헤더가 "0 ▼ -100%" 가 된다(주식은 마지막이 늘 채워져 있어 드러나지 않던 경로).
  const lastValid = (() => {
    for (let i = n - 1; i >= 0; i--)
      if (data[i] != null) return data[i] as number;
    return 0;
  })();
  // idx가 줌/스크롤로 현재 범위를 벗어나도 안전하게(undefined 방지).
  const cur$ = idx == null ? lastValid : (data[idx] ?? lastValid);
  const chg = cur$ - base;
  const pct = base ? (chg / base) * 100 : 0;
  const color = chg >= 0 ? UP : DOWN;

  // 헤더 표시: 스크럽 중=해당 시점, 탭 누르기 전 기본=전일 대비, 탭 선택 후=기간 기준.
  const scrubbing = idx != null;
  const showDay = !scrubbing && !touched && dayChangePct != null;
  const headChg = scrubbing ? chg : showDay ? (dayChange ?? 0) : chg;
  const headPct = scrubbing ? pct : showDay ? (dayChangePct as number) : pct;
  const headColor = headChg >= 0 ? UP : DOWN;

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const t = (clientX - b.left - pad.l) / Math.max(1, b.width - pad.l - pad.r);
    setIdx(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  const doPan = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || panX.current == null) return;
    const dx = clientX - panX.current;
    panX.current = clientX;
    setStart(s => clampStart(s - (dx * cnt) / Math.max(1, el.clientWidth)));
  };
  const doPinch = () => {
    if (ptrs.current.size < 2) return;
    const [a, b2] = [...ptrs.current.values()];
    const d = Math.hypot(a.x - b2.x, a.y - b2.y);
    if (pinchDist.current) {
      const el = wrapRef.current!;
      const r = el.getBoundingClientRect();
      const t = ((a.x + b2.x) / 2 - r.left) / Math.max(1, r.width);
      applyZoom(zoom * (d / pinchDist.current), t);
    }
    pinchDist.current = d;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      pinchDist.current = 0;
      doPinch();
      return;
    }
    if (e.pointerType === 'mouse') {
      panX.current = e.clientX;
      setIdx(null);
    } else pick(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (ptrs.current.has(e.pointerId))
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2) {
      doPinch();
      return;
    }
    if (e.pointerType === 'mouse') {
      panX.current != null ? doPan(e.clientX) : pick(e.clientX);
    } else if (ptrs.current.size === 1) pick(e.clientX);
  };
  const endPointer = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchDist.current = 0;
    panX.current = null;
  };

  // null 은 선을 끊는다(보간 금지). [from, to) 구간의 경로를 만든다.
  const pathOf = (from: number, to: number): string => {
    const parts: string[] = [];
    for (let i = Math.max(0, from); i < Math.min(to, n); i++) {
      const v = data[i];
      if (v == null) continue;
      const resume = parts.length === 0 || i === from || data[i - 1] == null;
      parts.push(`${resume ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    }
    return parts.join(' ');
  };

  // provisionalFrom 은 전체 시계열 인덱스 — 줌·팬 윈도 좌표계로 변환한다.
  const pvFrom = provisionalFrom != null ? provisionalFrom - s0 : null;
  const confirmedEnd = pvFrom != null ? Math.max(0, Math.min(pvFrom, n)) : n; // exclusive

  const line = pathOf(0, confirmedEnd);
  // 미확정 회색 점선 — 마지막 확정점에서 이어 그려야 선이 끊겨 보이지 않는다
  const provisionalLine =
    confirmedEnd < n ? pathOf(Math.max(0, confirmedEnd - 1), n) : '';

  /* 빈 달을 건너뛰는 연결선.
     예전에는 밀도(유효값 70%)로 켜고 껐는데, 밀도가 높아도 구멍은 생긴다
     — 13/17 달이 채워진 단지에서 실선 토막 + 떠 있는 점 하나가 되어 "깨진 차트"로 보였다.
     그래서 항상 그리고, 실선(관측된 연속 구간)과 점선(건너뛴 구간)으로 구분만 한다. */
  const observed: number[] = [];
  for (let i = 0; i < confirmedEnd; i++) if (data[i] != null) observed.push(i);

  const bridge = (() => {
    const parts: string[] = [];
    for (let k = 1; k < observed.length; k++) {
      const a = observed[k - 1],
        b = observed[k];
      if (b === a + 1) continue; // 이어진 달은 실선이 이미 그린다
      parts.push(
        `M ${X(a).toFixed(1)} ${Y(data[a]).toFixed(1)} L ${X(b).toFixed(1)} ${Y(data[b]).toFixed(1)}`,
      );
    }
    return parts.join(' ');
  })();

  /* 영역 채움 — 관측점을 잇는 하나의 면. 세그먼트별로 닫으면 빈 달마다 면이 끊겨
     2점짜리 초록 블록들이 서고(막대그래프처럼 읽힌다), 전체를 한 번에 닫으면
     끊긴 구간을 가로지르는 삼각형이 생긴다. 관측점만 이어 한 면으로 닫으면 둘 다 피한다. */
  const area = (() => {
    if (observed.length < 2) return '';
    const pts = observed.map(i => ({ x: X(i), y: Y(data[i]) }));
    const d = pts
      .map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    return `${d} L ${pts[pts.length - 1].x.toFixed(1)} ${height} L ${pts[0].x.toFixed(1)} ${height} Z`;
  })();

  // 값이 있는 지점을 점으로 — 끊긴 구간이 많으면 선만으로는 "깨진 그래프"처럼 보이고,
  // 홀로 떨어진 한 달(양옆이 모두 빈 달)은 선으로 그릴 수조차 없다.
  const showDots = n <= 40;
  const dots = showDots
    ? data
        .map((v, i) =>
          v == null
            ? null
            : { x: X(i), y: Y(v), provisional: pvFrom != null && i >= pvFrom },
        )
        .filter(
          (d): d is { x: number; y: number; provisional: boolean } => d != null,
        )
    : [];

  // compareSeries 경로 생성 (메인 시리즈와 동일한 스케일 사용)
  const comparePathOf = (
    cmpData: (number | null)[],
    from: number = 0,
    to: number = n,
  ): string => {
    const parts: string[] = [];
    for (let i = Math.max(0, from); i < Math.min(to, n); i++) {
      const v = cmpData[i];
      if (v == null) continue;
      const resume = parts.length === 0 || i === from || cmpData[i - 1] == null;
      parts.push(`${resume ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
    }
    return parts.join(' ');
  };
  const comparePaths = cmpSeries.map(cs => ({
    ...cs,
    path: comparePathOf(cs.data),
  }));

  const gid = `pcg-${code}-${mode}`;

  // 거래량 (null 안전 처리)
  const vols = ((volumes?.[period] ?? []) as (number | null)[]).slice(
    s0,
    s0 + cnt,
  );
  // 0 은 "거래 없음"이다. null 만 걸러내면 빈 달마다 최소높이(1.5px) 막대가 서서
  // 거래가 있었던 것처럼 보인다(부동산 월별 실거래에서 그대로 드러났다).
  const validVols = vols.filter(v => v != null && v > 0) as number[];
  const vmax = Math.max(1, ...validVols);
  const VH = 58;
  const bw = Math.max(1.4, ((w - pad.l - pad.r) / Math.max(1, n)) * 0.62);

  // 캔들
  const cds = (candles?.[period] ?? []).slice(s0, s0 + cnt);
  const hasCandle = (candles?.[period]?.length ?? 0) > 0;

  // 미니맵 — null 은 min/max 에서 빼고, 경로에서도 건너뛴다
  const BH = 36;
  const fullValid = full.filter((v): v is number => v != null);
  const fmn = fullValid.length ? Math.min(...fullValid) : 0,
    fmx = fullValid.length ? Math.max(...fullValid) : 1;
  const fsp = fmx - fmn || 1;
  const BX = (i: number) => 6 + ((w - 12) * i) / Math.max(1, N - 1);
  const BY = (v: number) => 5 + (BH - 10) * (1 - (v - fmn) / fsp);
  const stepI = Math.max(1, Math.round(N / 170));
  const bline = (() => {
    const parts: string[] = [];
    for (let i = 0; i < N; i += stepI) {
      const v = full[i];
      if (v == null) continue;
      parts.push(
        `${parts.length && full[i - stepI] != null ? 'L' : 'M'} ${BX(i).toFixed(1)} ${BY(v).toFixed(1)}`,
      );
    }
    return parts.join(' ');
  })();
  const brushJump = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setStart(
      clampStart(((e.clientX - b.left) / Math.max(1, b.width)) * N - cnt / 2),
    );
  };

  // 구간 고·저 마커. 그려진 것과 같은 소스를 쓴다(캔들 모드면 꼬리 고/저, 라인 모드면 종가).
  // 스크럽 중에는 크로스헤어·툴팁과 겹치므로 숨긴다.
  const hiLo = (() => {
    if (n === 0) return null;
    const useCandle = kind === 'candle' && cds.length > 0;
    let hiI = -1,
      loI = -1,
      hiV = -Infinity,
      loV = Infinity;
    for (let i = 0; i < n; i++) {
      const h = useCandle ? cds[i]?.h : data[i];
      const l = useCandle ? cds[i]?.l : data[i];
      if (h != null && Number.isFinite(h) && h > hiV) {
        hiV = h;
        hiI = i;
      }
      if (l != null && Number.isFinite(l) && l < loV) {
        loV = l;
        loI = i;
      }
    }
    if (hiI < 0 || loI < 0 || hiV === loV) return null; // 평탄 구간이면 표시할 게 없다
    return { hiI, hiV, loI, loV };
  })();

  // 목/합성 데이터는 배지 톤까지 경고색으로 — 문구만 바꾸면 초록 배지가 여전히 "실데이터"라고 말한다.
  const badgeWarn = idx == null && liveBadgeTone === 'warn';

  const label = (i: number) => labels?.[period]?.[i] ?? String(i + 1);
  const money = (v: number) =>
    cur +
    (v ?? 0).toLocaleString('en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  const tickIdx = [
    0,
    Math.round((n - 1) / 3),
    Math.round(((n - 1) * 2) / 3),
    n - 1,
  ];

  /* y축 — 값을 읽을 눈금이 아예 없었다. 호버해야 숫자가 나오는 차트는 절반만 완성된 것이다.
     축 공간을 따로 떼지 않고(다른 화면의 레이아웃을 건드리지 않게) 눈금선 위 오른쪽에 값을 얹는다.
     base 선과 겹치는 눈금은 건너뛴다 — 같은 자리에 선이 두 개 겹치면 지저분하다. */
  const yTicks = (() => {
    if (n === 0 || !Number.isFinite(mn) || !Number.isFinite(mx) || flat)
      return [];
    const baseY = base != null ? Y(base) : null;
    // 0%·100% 는 최고·최저 마커가 이미 값을 말한다 — 같은 숫자를 두 번 쓰지 않는다.
    return [0.25, 0.5, 0.75]
      .map(t => ({ v: mn + (mx - mn) * t, y: Y(mn + (mx - mn) * t) }))
      .filter(tk => baseY == null || Math.abs(tk.y - baseY) > 9);
  })();

  /* 거래량 막대의 방향색 — 직전 **유효** 달과 비교한다.
     null 을 0 으로 읽으면 빈 달 다음 달은 "0 → 4,792" 가 되어 실제로 35% 떨어졌는데도
     상승색이 된다(실측: 한양아파트 25.05·25.10). */
  const dirUp = (i: number) => {
    const v = data[i];
    if (v == null) return true;
    for (let k = i - 1; k >= 0; k--) {
      const p = data[k];
      if (p != null) return v >= p;
    }
    return true;
  };
  const tipX = idx == null ? 0 : Math.max(0, Math.min(w - 124, X(idx) - 62));

  return (
    <section className="rounded-2xl border border-line bg-panel px-[22px] pb-4 pt-5">
      {/* 헤더 */}
      <div className="mb-[18px] flex items-start justify-between gap-4">
        <div>
          <div className="mb-[9px] flex items-center gap-2.5">
            <span className="text-[15px] font-bold text-fg">{name}</span>
            <span className="font-mono text-xs text-mut">{code}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                badgeWarn
                  ? ''
                  : idx == null
                    ? 'border-[rgba(22,199,132,.3)] bg-[rgba(22,199,132,.14)] text-[var(--chart-live)]'
                    : 'border-[rgba(124,108,255,.3)] bg-[var(--brand-16)] text-[var(--chart-scrub)]'
              }`}
              style={
                badgeWarn
                  ? {
                      borderColor:
                        'color-mix(in srgb, var(--warn) 32%, transparent)',
                      background:
                        'color-mix(in srgb, var(--warn) 14%, transparent)',
                      color: 'var(--warn)',
                    }
                  : undefined
              }
            >
              {idx == null ? liveBadge : '과거 시점'}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <span className="font-mono text-[34px] font-extrabold leading-[.92] tracking-tight text-fg">
              {money(cur$)}
            </span>
            <span
              className="mb-[3px] font-mono text-sm font-bold"
              style={{ color: headColor }}
            >
              {/* 소수 종목(dec>0)은 반올림하면 $5.96 이 "6"이 된다 — 표시 자릿수를 통화에 맞춘다. */}
              {headChg >= 0 ? '▲' : '▼'}{' '}
              {Math.abs(headChg).toLocaleString('en-US', {
                minimumFractionDigits: dec,
                maximumFractionDigits: dec,
              })}{' '}
              ({headPct >= 0 ? '+' : ''}
              {headPct.toFixed(2)}%)
            </span>
          </div>
          <div className="mt-[7px] text-[11.5px] text-mut">
            {scrubbing
              ? `${label(s0 + idx)} 시점`
              : showDay
                ? '전일 대비'
                : `${period} 기준`}
          </div>
        </div>
        {hasCandle && (
          <div className="flex gap-[3px] rounded-[10px] border border-line bg-row p-[3px]">
            {(['line', 'candle'] as const).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-[7px] px-[11px] py-[5px] text-xs font-semibold transition-colors ${
                  kind === k
                    ? 'bg-[var(--brand-18)] text-fg'
                    : 'text-sub hover:text-fg'
                }`}
              >
                {k === 'line' ? '라인' : '캔들'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 차트 + 거래량 (같은 포인터 영역) */}
      <div
        ref={wrapRef}
        className="relative w-full cursor-crosshair select-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={e => {
          endPointer(e);
          setIdx(null);
        }}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${w} ${height}`}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.26} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {yTicks.map((tk, k) => (
            <g key={`y${k}`}>
              <line
                x1={pad.l}
                y1={tk.y}
                x2={w - pad.r}
                y2={tk.y}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
              <text
                x={w - pad.r}
                y={tk.y - 3}
                textAnchor="end"
                className="font-mono"
                fontSize={9.5}
                fill="var(--text-mut)"
              >
                {money(Math.round(tk.v))}
              </text>
            </g>
          ))}
          {n > 0 && base != null && (
            <line
              x1={pad.l}
              y1={Y(base)}
              x2={w - pad.r}
              y2={Y(base)}
              stroke="var(--chart-base)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {n === 0 ? null : kind === 'line' || !cds.length ? (
            <>
              {area && <path d={area} fill={`url(#${gid})`} />}
              {bridge && (
                <path
                  d={bridge}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  opacity={0.38}
                  strokeLinecap="round"
                />
              )}
              {line && (
                <path
                  d={line}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {provisionalLine && (
                <path
                  d={provisionalLine}
                  fill="none"
                  stroke="var(--chart-muted)"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray="4 4"
                />
              )}
              {/* 값이 있는 달을 점으로 — 빈 달이 많으면 선만으로는 깨진 그래프처럼 읽히고,
                  양옆이 모두 빈 한 달은 선으로 그릴 수조차 없다. */}
              {dots.map((d, k) => (
                <circle
                  key={k}
                  cx={d.x}
                  cy={d.y}
                  r={2.6}
                  fill={d.provisional ? 'var(--chart-muted)' : color}
                  stroke="var(--bg)"
                  strokeWidth={1.1}
                />
              ))}
              {atEnd && data[n - 1] != null && (
                <circle
                  cx={X(n - 1)}
                  cy={Y(data[n - 1])}
                  r={3.6}
                  fill={color}
                />
              )}
              {comparePaths.map(
                (cp, i) =>
                  cp.path && (
                    <path
                      key={`compare-${i}`}
                      d={cp.path}
                      fill="none"
                      stroke={cp.color}
                      strokeWidth={cp.width ?? 2.2}
                      strokeDasharray={cp.dash}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ),
              )}
            </>
          ) : (
            cds.map((c, i) => {
              const up = c.c >= c.o;
              const col = up ? UP : DOWN;
              const top = Y(Math.max(c.o, c.c)),
                bot = Y(Math.min(c.o, c.c));
              return (
                <g key={i}>
                  <line
                    x1={X(i)}
                    y1={Y(c.h)}
                    x2={X(i)}
                    y2={Y(c.l)}
                    stroke={col}
                    strokeWidth={1}
                  />
                  <rect
                    x={X(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={Math.max(1, bot - top)}
                    fill={col}
                    rx={0.8}
                  />
                </g>
              );
            })
          )}
          {/* 구간 고·저 — 고가는 상단에 붙으므로 라벨을 점 아래로, 저가는 점 위로 둔다(잘림 방지). */}
          {hiLo && !scrubbing && (
            <>
              {(
                [
                  { i: hiLo.hiI, v: hiLo.hiV, tag: '최고', dy: 13 },
                  { i: hiLo.loI, v: hiLo.loV, tag: '최저', dy: -6 },
                ] as const
              ).map(({ i, v, tag, dy }) => {
                const atRight = X(i) > w * 0.72;
                return (
                  <g key={tag} opacity={0.85}>
                    <circle
                      cx={X(i)}
                      cy={Y(v)}
                      r={2.4}
                      fill="var(--text-sub)"
                    />
                    <text
                      x={atRight ? X(i) - 5 : X(i) + 5}
                      y={Y(v) + dy}
                      textAnchor={atRight ? 'end' : 'start'}
                      className="font-mono"
                      fontSize={10}
                      fill="var(--text-sub)"
                    >
                      {tag} {money(v)}
                    </text>
                  </g>
                );
              })}
            </>
          )}
          {idx != null && (
            <>
              <line
                x1={X(idx)}
                y1={pad.t - 6}
                x2={X(idx)}
                y2={height - pad.b + 4}
                stroke="var(--chart-crosshair)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {data[idx] != null && (
                <>
                  <circle
                    cx={X(idx)}
                    cy={Y(data[idx])}
                    r={8}
                    fill={color}
                    fillOpacity={0.18}
                  />
                  <circle
                    cx={X(idx)}
                    cy={Y(data[idx])}
                    r={4.6}
                    fill={color}
                    stroke="var(--bg)"
                    strokeWidth={2.4}
                  />
                </>
              )}
            </>
          )}
        </svg>

        {/* 실거래량이 하나도 없으면 패널 자체를 숨긴다 — 빈 박스에 "평균 0"은 고장처럼 보인다. */}
        {validVols.length > 0 && (
          <>
            <div className="mt-3 flex items-center justify-between px-0.5">
              <span className="text-[10.5px] font-semibold text-mut">
                거래량
              </span>
              <span className="font-mono text-[10.5px] text-sub">
                {idx == null
                  ? `평균 ${validVols.length ? Math.round(validVols.reduce((a, b) => a + b, 0) / validVols.length).toLocaleString() : 0}`
                  : (vols[idx]?.toLocaleString() ?? '—')}
              </span>
            </div>
            <svg
              width="100%"
              height={VH}
              viewBox={`0 0 ${w} ${VH}`}
              className="mt-1.5 block"
            >
              {vols.map((v, i) => {
                if (v == null || v <= 0) return null;
                const up = dirUp(i);
                const h = Math.max(1.5, (v / vmax) * (VH - 10));
                return (
                  <rect
                    key={i}
                    x={X(i) - bw / 2}
                    y={VH - h}
                    width={bw}
                    height={h}
                    rx={Math.min(1.2, bw / 2)}
                    fill={up ? UP : DOWN}
                    fillOpacity={idx == null ? 0.42 : idx === i ? 1 : 0.16}
                  />
                );
              })}
              {idx != null && (
                <line
                  x1={X(idx)}
                  y1={0}
                  x2={X(idx)}
                  y2={VH}
                  stroke="var(--chart-crosshair)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}
            </svg>
          </>
        )}

        {idx != null && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute z-10 rounded-[10px] border border-[var(--chart-base)] bg-[var(--chart-tooltip)] px-2.5 py-2 shadow-2xl"
            style={{ left: tipX, top: -4, minWidth: '124px' }}
          >
            <div className="mb-0.5 text-[10.5px] text-sub">
              {label(s0 + idx)}
            </div>
            {data[idx] == null ? (
              <div className="font-mono text-[13.5px] font-bold text-mut">
                거래 없음
              </div>
            ) : (
              <>
                <div className="font-mono text-[13.5px] font-extrabold text-fg">
                  {money(cur$)}
                </div>
                <div
                  className="mt-0.5 font-mono text-[11px] font-bold"
                  style={{ color }}
                >
                  {pct >= 0 ? '+' : ''}
                  {pct.toFixed(2)}%
                </div>
              </>
            )}
            {comparePaths.map((cp, i) => {
              const v = cp.data[idx];
              return (
                <div
                  key={`compare-tooltip-${i}`}
                  className="mt-1.5 border-t border-[var(--chart-divider)] pt-1.5 text-[10px]"
                >
                  <div className="text-sub" style={{ color: cp.color }}>
                    {cp.name}
                  </div>
                  <div className="font-mono text-[11px] font-bold text-fg">
                    {v == null ? '—' : money(v)}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* X축 */}
      <div className="mt-2 flex justify-between px-0.5">
        {/* 구간이 좁으면 tickIdx가 같은 인덱스로 뭉쳐 같은 라벨이 4번 찍힌다 → 중복은 비운다. */}
        {tickIdx.map((i, k) => {
          const t = label(s0 + i);
          const dup = k > 0 && t === label(s0 + tickIdx[k - 1]);
          return (
            <span key={k} className="font-mono text-[10.5px] text-mut">
              {dup ? '' : t}
            </span>
          );
        })}
      </div>

      {/* 관측이 한 점뿐이면 선도 면도 그릴 수 없다. 빈 차트로 두면 고장으로 읽힌다.
          이유는 도메인마다 달라서 문구는 호출자가 준다(없으면 아무 말도 하지 않는다). */}
      {observed.length === 1 && singlePointNote && (
        <div className="mt-2 text-[10.5px] text-mut">{singlePointNote}</div>
      )}

      {/* 범례 — 선이 둘 이상이면 무엇이 무엇인지 말해야 한다(호버해야 알 수 있으면 범례가 아니다). */}
      {(cmpSeries.length > 0 || bridge) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-mut">
          {cmpSeries.map(cs => (
            <span key={cs.name} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3.5"
                style={{ borderTop: `1.6px dashed ${cs.color}` }}
              />
              {cs.name}
            </span>
          ))}
          {bridge && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3.5"
                style={{ borderTop: `1.5px dotted ${color}`, opacity: 0.6 }}
              />
              거래 없는 달 건너뜀
            </span>
          )}
        </div>
      )}

      {/* 줌 컨트롤 + 미니맵 */}
      <div className="mt-3.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold text-mut">
          구간 선택 · 휠로 확대, 드래그로 이동
        </span>
        <div className="flex items-center gap-1.5">
          <span className="mr-0.5 font-mono text-[11px] text-sub">
            {zoom < 1.05 ? '전체' : `${zoom.toFixed(1)}×`}
          </span>
          <button
            onClick={() => applyZoom(zoom / 1.5)}
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[var(--chart-frame)] bg-panel2 text-sub hover:text-fg"
          >
            −
          </button>
          <button
            onClick={() => applyZoom(zoom * 1.5)}
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[var(--chart-frame)] bg-panel2 text-sub hover:text-fg"
          >
            +
          </button>
          {zoom > 1.05 && (
            <button
              onClick={() => {
                setZoom(1);
                setStart(0);
                setIdx(null);
              }}
              className="h-[26px] rounded-[7px] border border-[var(--chart-frame)] bg-panel2 px-2.5 text-[11px] font-bold text-[var(--chart-scrub)]"
            >
              전체
            </button>
          )}
        </div>
      </div>
      <svg
        width="100%"
        height={BH}
        viewBox={`0 0 ${w} ${BH}`}
        className="mt-2.5 block cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={brushJump}
        onPointerMove={e => e.buttons && brushJump(e)}
      >
        <rect
          x={0}
          y={0}
          width={w}
          height={BH}
          rx={8}
          fill="var(--chart-minimap-bg)"
          stroke="var(--border)"
        />
        <path
          d={bline}
          fill="none"
          stroke="var(--chart-minimap-line)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <rect
          x={BX(s0)}
          y={1}
          width={Math.max(7, BX(Math.min(N - 1, s0 + cnt - 1)) - BX(s0))}
          height={BH - 2}
          rx={6}
          fill={brandWithAlpha(0.15)}
          stroke="var(--brand)"
          strokeWidth={1.2}
        />
      </svg>

      {/* 기간 탭 (데이터 있는 기간만 표시) */}
      <div className="mt-4 flex gap-[3px] rounded-[11px] border border-line bg-row p-1">
        {PERIODS.filter(p => (series[p]?.length ?? 0) > 0).map(p => (
          <button
            key={p}
            onClick={() => {
              setPeriod(p);
              setTouched(true);
            }}
            className={`flex-1 rounded-lg py-[7px] text-[12.5px] font-bold transition-colors ${
              period === p
                ? 'bg-[var(--brand-18)] text-fg'
                : 'text-sub hover:text-fg'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}
