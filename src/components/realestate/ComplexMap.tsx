import { useEffect, useRef, useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  fmt,
  scaleColor,
  legendStops,
  readableTextOn,
  SIGNAL_DOMAIN,
  MUTED,
} from '@/lib/colors';
import type { AptComplex, ScreenRank } from '@/data/types';
import { formatSignalValue } from './ComplexList';
import s from './ComplexMap.module.css';
import {
  loadKakaoSdk,
  type KakaoMaps,
  type KakaoMap,
  type LatLng,
  type CustomOverlay,
} from '@/lib/kakaoSdk';

// ───────────────────────────────────────────────────────────────────
// 카카오맵 SDK 싱글턴 로드
// ───────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────
// 헬퍼 함수
// ───────────────────────────────────────────────────────────────────

/** 라벨 실측 크기 — CSS 와 콜리전 그리드가 같은 상수를 봐야 겹침 계산이 맞는다. */
const LABEL_W = 84;
const LABEL_H = 38;
const LABEL_GAP = 6;

/**
 * 거래액(만원) → "억" 표기. 반올림이 아니라 **내림**이다 —
 * 99.95억이 "100억"으로 보이면 실거래를 과대표기하게 된다(부동산에서 더 위험한 방향).
 * 1천만 미만은 억 표기가 "0.0억"으로 붕괴하므로 만원 단위를 유지한다.
 */
function formatAmount(manwon: number | null): string | null {
  if (manwon == null) return null;
  if (manwon < 1000) return `${Math.round(manwon).toLocaleString()}만`;
  const floored = Math.floor((manwon / 10000) * 10) / 10;
  return floored % 1 === 0 ? `${floored}억` : `${floored.toFixed(1)}억`;
}

/** 화면 픽셀 좌표. 폴백: getBounds + 컨테이너 실측 크기로 선형 보간(화면 범위에선 왜곡 무시 가능). */
function getScreenPixel(
  map: KakaoMap,
  latlng: LatLng,
  container: HTMLElement | null,
): { x: number; y: number } | null {
  const ok = (p: { x: number; y: number } | null | undefined) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  try {
    const proj = map.getProjection();
    if (proj?.containerPointFromCoords) {
      const p = ok(proj.containerPointFromCoords(latlng));
      if (p) return p;
    }
  } catch {
    /* 폴백으로 진행 */
  }

  try {
    const b = map.getBounds();
    const sw = b.getSouthWest(),
      ne = b.getNorthEast();
    const w = container?.clientWidth || 0,
      h = container?.clientHeight || 0;
    if (!w || !h) return null; // 크기를 모르면 추측하지 않는다 — 틀린 좌표가 겹침 판정을 오염시킨다
    const x =
      ((latlng.getLng() - sw.getLng()) / (ne.getLng() - sw.getLng())) * w;
    const y =
      h - ((latlng.getLat() - sw.getLat()) / (ne.getLat() - sw.getLat())) * h;
    return ok({ x, y });
  } catch {
    return null;
  }
}

/** 집계 박스 실측 크기 — 라벨과 같은 규칙으로 겹침을 막는다. */
const BOX_W = 76;
const BOX_H = 54;

/**
 * 오버레이 겹침 제거. 앵커에 따라 점유 사각형이 다르다 —
 * 라벨은 yAnchor=1 이라 좌표 위쪽, 집계 박스는 좌표 중앙을 차지한다.
 * 한 점이 아니라 그 사각형이 걸치는 셀을 전부 점유해야 인접 셀 침범이 막힌다.
 */
class CollisionGrid {
  private cells = new Set<string>();
  private readonly cw: number;
  private readonly ch: number;

  constructor(
    private readonly w = LABEL_W,
    private readonly h = LABEL_H,
    gap = LABEL_GAP,
    private readonly anchor: 'bottom' | 'center' = 'bottom',
  ) {
    this.cw = w + gap;
    this.ch = h + gap;
  }

  private range(p: { x: number; y: number }) {
    const top = this.anchor === 'bottom' ? p.y - this.h : p.y - this.h / 2;
    const bottom = this.anchor === 'bottom' ? p.y : p.y + this.h / 2;
    return {
      cx0: Math.floor((p.x - this.w / 2) / this.cw),
      cx1: Math.floor((p.x + this.w / 2) / this.cw),
      cy0: Math.floor(top / this.ch),
      cy1: Math.floor(bottom / this.ch),
    };
  }

  canPlace(p: { x: number; y: number }): boolean {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const r = this.range(p);
    for (let cx = r.cx0; cx <= r.cx1; cx++) {
      for (let cy = r.cy0; cy <= r.cy1; cy++)
        if (this.cells.has(`${cx},${cy}`)) return false;
    }
    return true;
  }

  place(p: { x: number; y: number }): void {
    const r = this.range(p);
    for (let cx = r.cx0; cx <= r.cx1; cx++) {
      for (let cy = r.cy0; cy <= r.cy1; cy++) this.cells.add(`${cx},${cy}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// 집계 박스
// ───────────────────────────────────────────────────────────────────

interface AggregatedDistrict {
  key: string;
  label: string; // 표시명 — '강남' 또는 '대치동'
  gu: string | null;
  umdNm: string | null; // 구 단계에서는 null
  lat: number;
  lng: number;
  value: number;
  count: number;
}

/** 집계 단위. 줌아웃할수록 굵게 묶는다 — 수도권이 보이는 줌에서 동 25개는 한 점에 겹친다. */
type AggLevel = 'gu' | 'dong';

function createAggregates(
  ranks: ScreenRank[],
  byId: Map<string, AptComplex>,
  level: AggLevel,
): AggregatedDistrict[] {
  const groups = new Map<
    string,
    {
      gu: string | null;
      umdNm: string | null;
      lats: number[];
      lngs: number[];
      values: number[];
    }
  >();

  for (const rank of ranks) {
    const apt = byId.get(rank.id);
    if (!apt || apt.lat == null || apt.lng == null || !apt.gu) continue;

    const key = level === 'gu' ? apt.gu : `${apt.gu}|${apt.umdNm}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        gu: apt.gu,
        umdNm: level === 'gu' ? null : apt.umdNm,
        lats: [],
        lngs: [],
        values: [],
      };
      groups.set(key, g);
    }
    g.lats.push(apt.lat);
    g.lngs.push(apt.lng);
    g.values.push(rank.value);
  }

  const out: AggregatedDistrict[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g.values].sort((a, b) => a - b);
    out.push({
      key,
      label: level === 'gu' ? (g.gu ?? '').replace(/구$/, '') : (g.umdNm ?? ''),
      gu: g.gu,
      umdNm: g.umdNm,
      lat: g.lats.reduce((s2, x) => s2 + x, 0) / g.lats.length,
      lng: g.lngs.reduce((s2, x) => s2 + x, 0) / g.lngs.length,
      value: sorted[Math.floor(sorted.length / 2)],
      count: g.values.length,
    });
  }

  // 멤버 수 상위부터 — 값 기준으로 자르면 하락 동네가 지도에서 사라진다
  return out
    .sort((a, b) => b.count - a.count)
    .slice(0, level === 'gu' ? 25 : 30);
}

// ───────────────────────────────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────────────────────────────

export default function ComplexMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const overlaysRef = useRef<CustomOverlay[]>([]);

  const aptScreen = useStore(st => st.aptScreen);
  const aptComplexes = useStore(st => st.aptComplexes);
  const hoveredComplexId = useStore(st => st.hoveredComplexId);
  const selectedComplexId = useStore(st => st.selectedComplexId);
  const selectionSource = useStore(st => st.selectionSource);
  const areaFilter = useStore(st => st.areaFilter);
  const colorMode = useStore(st => st.colorMode);
  const setHoveredComplex = useStore(st => st.setHoveredComplex);
  const selectComplex = useStore(st => st.selectComplex);
  const setAreaFilter = useStore(st => st.setAreaFilter);
  const setAptMapFailed = useStore(st => st.setAptMapFailed);

  const [kakao, setKakao] = useState<KakaoMaps | null>(null);
  const [level, setLevel] = useState(8);
  // 팬만 해도 뷰포트가 바뀐다 — level 이 같아도 idle 마다 오버레이를 다시 걸러야 한다
  const [viewportTick, setViewportTick] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false); // 범례 산식 설명 — 터치에서도 열려야 한다
  // hover 하이라이트는 재구성 없이 이 맵으로 스타일만 바꾼다 (재구성하면 마우스 아래 DOM 이 교체되어 플리커)
  const markerElsRef = useRef(new Map<string, HTMLDivElement>());

  /** 단지 마스터 인덱스 — effect 3곳이 각자 8,748개를 다시 Map 으로 만들던 것을 하나로. */
  const byId = useMemo(() => {
    const m = new Map<string, AptComplex>();
    aptComplexes?.items.forEach(c => m.set(c.aptSeq, c));
    return m;
  }, [aptComplexes]);

  /** 순위 인덱스 — 선택 단지 조회를 find(O(n)) 대신 O(1) 로. */
  const rankById = useMemo(() => {
    const m = new Map<string, ScreenRank>();
    aptScreen?.ranked.forEach(r => m.set(r.id, r));
    return m;
  }, [aptScreen]);

  // 우리가 움직인 idle 인지 사용자가 움직인 idle 인지 구분한다.
  // 사용자가 직접 팬·줌한 뒤에는 필터 변경 자동 맞춤이 지도를 빼앗지 않는다.
  // 불리언 소비 방식은 idle 이 0회(같은 좌표 setCenter)거나 2회(setBounds) 오면 어긋난다 —
  // 시간 창으로 분류해 미발화 시 자연 만료되게 한다.
  const programmaticUntilRef = useRef(0);
  /** 지역 필터가 가리키는 중심 — 사용자가 여기서 벗어나면 선택을 푼다(지도앱의 기본 감각). */
  const areaCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const userMovedRef = useRef(false);

  /** 우리 쪽에서 지도를 움직일 때는 반드시 이걸 통해서 — idle 핸들러가 사용자 이동으로 오인하지 않게. */
  const moveMap = (fn: (map: KakaoMap) => void) => {
    if (!mapRef.current) return;
    programmaticUntilRef.current = Date.now() + 800;
    fn(mapRef.current);
  };

  // ─────────────────── SDK 초기화 ─────────────────────
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // config에서 카카오 키 조회
        const configRes = await fetch('/api/realestate/config');
        if (!configRes.ok) {
          if (isMounted) {
            setAptMapFailed(true);
          }
          return;
        }

        const config = (await configRes.json()) as {
          kakaoJsKey?: string | null;
        };
        if (!config.kakaoJsKey) {
          if (isMounted) {
            setAptMapFailed(true, 'KAKAO_JS_KEY 미설정 (server/.env)');
          }
          return;
        }

        // 사전 점검 — 미등록 도메인이면 카카오가 Referer 를 보고 401 을 준다.
        // 브라우저 직접 fetch 는 CORS 로 원인이 안 보이므로 서버 프록시로 물어본다.
        try {
          const probe = await fetch(
            `/api/realestate/kakao-probe?origin=${encodeURIComponent(location.origin)}`,
          ).then(r => r.json());
          if (!probe.ok) {
            const reason = probe.domainMismatch
              ? `카카오 콘솔에 Web 도메인(${location.origin}) 등록 필요 — 등록 후 새로고침`
              : `카카오 SDK 점검 실패(${probe.status ?? '?'}) — 키·카카오맵 사용 설정 확인`;
            if (isMounted) {
              setAptMapFailed(true, reason);
              useStore.getState().setViewportBounds(null);
            }
            return;
          }
        } catch {
          /* 프록시 실패 시 본 로드로 진행 — 실패해도 아래 catch 가 잡는다 */
        }

        // SDK 로드
        const sdk = await loadKakaoSdk(config.kakaoJsKey);
        if (isMounted) {
          setKakao(sdk);
        }
      } catch (err) {
        // 타임아웃 또는 로드 실패
        if (isMounted) {
          setAptMapFailed(true);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [setAptMapFailed]);

  // ─────────────────── 지도 초기화 ─────────────────────
  useEffect(() => {
    if (!kakao || !containerRef.current) return;

    if (mapRef.current) {
      // 이미 생성됨
      return;
    }

    // 서울시청 좌표
    const center = new kakao.LatLng(37.5665, 126.978);
    const mapInstance = new kakao.Map(containerRef.current, {
      center,
      level: 8,
      draggable: true,
      scrollwheel: true,
    });

    mapRef.current = mapInstance;

    // 줌·팬 종료마다 오버레이 재구성 트리거. level 이 그대로여도 뷰포트는 바뀐다.
    // 프로그램적 이동 시간 창 밖의 idle 만 사용자 이동으로 기록 → 자동 맞춤 중단.
    const onIdle = () => {
      const programmatic = Date.now() <= programmaticUntilRef.current;
      if (!programmatic) userMovedRef.current = true;
      setLevel(mapInstance.getLevel());
      setViewportTick(t => t + 1);

      // 리스트가 화면과 같은 범위를 보게 한다(연동 토글은 리스트가 판단).
      const vb = mapInstance.getBounds();
      useStore.getState().setViewportBounds({
        swLat: vb.getSouthWest().getLat(),
        swLng: vb.getSouthWest().getLng(),
        neLat: vb.getNorthEast().getLat(),
        neLng: vb.getNorthEast().getLng(),
      });

      // 지도앱다운 동작: 사용자가 직접 넓게 보거나(집계 단계) 다른 동네로 옮기면
      // 지역 선택은 스스로 풀린다. 안 그러면 줌아웃했는데 한 동네만 남아 화면이 거짓말을 한다.
      if (programmatic) return;
      const af = useStore.getState().areaFilter;
      if (!af) return;
      const c = areaCenterRef.current;
      const b = mapInstance.getBounds();
      const sw = b.getSouthWest(),
        ne = b.getNorthEast();
      const outOfView =
        !c ||
        c.lat < sw.getLat() ||
        c.lat > ne.getLat() ||
        c.lng < sw.getLng() ||
        c.lng > ne.getLng();
      if (mapInstance.getLevel() >= 7 || outOfView) setAreaFilter(null);
    };

    kakao.event.addListener(mapInstance, 'idle', onIdle);

    // "지도 보기" 토글·반응형 전환으로 컨테이너가 0 → 양수 크기가 되는 순간
    // 카카오 지도는 스스로 모른다 — relayout 없이는 타일이 깨진 채 남는다.
    let hadSize = containerRef.current.clientWidth > 0;
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      const hasSize = el.clientWidth > 0 && el.clientHeight > 0;
      if (hasSize && !hadSize) {
        const center = mapInstance.getCenter();
        programmaticUntilRef.current = Date.now() + 800; // 같은 좌표 setCenter 는 idle 을 안 낼 수 있다 — 시간 창이라 안전
        mapInstance.relayout();
        mapInstance.setCenter(center);
      }
      hadSize = hasSize;
    });
    ro.observe(containerRef.current);

    return () => {
      kakao.event.removeListener(mapInstance, 'idle', onIdle);
      ro.disconnect();
    };
  }, [kakao]);

  // ─────────────────── 오버레이 재구성 ─────────────────────
  // hoveredComplexId 는 의도적으로 deps 에서 뺐다 — hover 마다 재구성하면
  // 마우스 아래 DOM 이 교체되어 mouseout → 재구성 → mouseover 플리커 루프가 된다.
  // 하이라이트는 아래 별도 이펙트가 스타일만 바꾼다.
  useEffect(() => {
    if (!mapRef.current || !kakao || !aptScreen || !aptComplexes) return;

    // 오버레이 DOM 의 리스너는 setMap(null) 로 안 끊긴다 — signal 로 한 번에 정리한다.
    const ac = new AbortController();
    const clear = () => {
      ac.abort();
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      markerElsRef.current.clear();
    };
    clear();

    const currentLevel = mapRef.current.getLevel();
    const bounds = mapRef.current.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const swLat = sw.getLat(),
      swLng = sw.getLng(),
      neLat = ne.getLat(),
      neLng = ne.getLng();
    const inView = (lat: number, lng: number) =>
      lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;
    // 지역 필터는 리스트만이 아니라 지도에도 걸린다 — 둘은 같은 쿼리의 두 뷰다.
    // 리스트는 "중계동 45단지"인데 지도가 서울 전역을 뿌리면 화면이 서로 다른 말을 한다.
    const inArea = (apt: AptComplex) =>
      !areaFilter ||
      (apt.gu === areaFilter.gu &&
        (!areaFilter.umdNm || apt.umdNm === areaFilter.umdNm));

    const signal = aptScreen.signal;
    const domain = SIGNAL_DOMAIN[signal];

    if (currentLevel >= 7) {
      // ─── 집계 박스 — 줌아웃 정도에 따라 구/동 두 단계 ───
      // level 9+ 는 수도권이 통째로 보이는 배율이라 동 25개가 서울 한 점에 겹친다.
      const aggLevel: AggLevel = currentLevel >= 9 ? 'gu' : 'dong';
      const aggs = createAggregates(
        areaFilter
          ? aptScreen.ranked.filter(r => {
              const a = byId.get(r.id);
              return a ? inArea(a) : false;
            })
          : aptScreen.ranked,
        byId,
        aggLevel,
      );

      // 박스도 겹친다 — 라벨과 같은 규칙으로 자리를 다투게 한다(멤버 많은 지역 우선).
      const boxGrid = new CollisionGrid(BOX_W, BOX_H, 6, 'center');

      for (const agg of aggs) {
        if (!inView(agg.lat, agg.lng)) continue;
        const pixel = getScreenPixel(
          mapRef.current,
          new kakao.LatLng(agg.lat, agg.lng),
          containerRef.current,
        );
        if (pixel && !boxGrid.canPlace(pixel)) continue; // 자리가 없으면 그리지 않는다(겹쳐 읽히느니)
        if (pixel) boxGrid.place(pixel);

        // 계산 표본이 너무 적으면 색으로 말하면 안 된다 — 회색 '거래부족'
        const thin = agg.count < 3;
        const base = thin ? MUTED : scaleColor(agg.value, domain, colorMode);
        const bg = thin ? MUTED : `${base}F0`;

        const el = document.createElement('div');
        el.className = s.districtBox;
        el.style.backgroundColor = bg;
        el.style.color = readableTextOn(base); // 밝은 배경에 흰 글씨 대비 붕괴 방지
        el.innerHTML = `
          <div class="${s.districtName}">${agg.label}</div>
          <div class="mono" style="font-size: 13px; font-weight: 700;">${thin ? '거래부족' : formatSignalValue(agg.value, signal)}</div>
          <div style="font-size: 11.5px; opacity: .8;">단지 ${agg.count}</div>
        `;
        el.style.cursor = 'pointer';
        el.addEventListener(
          'click',
          () => {
            // 줌만 하지 않는다 — 리스트도 이 지역으로 좁혀 지도→리스트 방향을 잇는다 (전역 순위는 유지)
            if (agg.gu)
              setAreaFilter(
                agg.umdNm ? { gu: agg.gu, umdNm: agg.umdNm } : { gu: agg.gu },
              );
            moveMap(m => {
              m.setCenter(new kakao.LatLng(agg.lat, agg.lng));
              // 구를 누르면 동이 보이는 배율로, 동을 누르면 단지가 보이는 배율로
              m.setLevel(aggLevel === 'gu' ? 7 : 5);
            });
          },
          { signal: ac.signal },
        );

        const overlay = new kakao.CustomOverlay({
          position: new kakao.LatLng(agg.lat, agg.lng),
          content: el,
          zIndex: 10,
        });
        overlay.setMap(mapRef.current);
        overlaysRef.current.push(overlay);
      }
    } else {
      // ─── 가격 라벨 마커 + 겹침 제거 — 뷰포트 안 후보 정렬 + 그리드 충돌 검사 ───
      const selectedId = useStore.getState().selectedComplexId;

      interface MarkerOpts {
        isGray?: boolean;
        zIndex?: number;
        price?: number | null;
        isLabel?: boolean;
        rank?: ScreenRank;
      }

      const addMarker = (
        apt: AptComplex,
        value: number | null,
        opts?: MarkerOpts,
      ) => {
        if (apt.lat == null || apt.lng == null) return;
        const isGray = opts?.isGray ?? false;
        const isLabel = opts?.isLabel ?? false;
        const zIndex = opts?.zIndex ?? 100;

        const color = isGray ? MUTED : scaleColor(value, domain, colorMode);
        const el = document.createElement('div');

        if (isLabel) {
          // ─── 가격 라벨 (CustomOverlay) ───
          el.className = s.priceLabel;
          el.style.backgroundColor = `${color}F2`; // rgba 동적 합성
          // 꼬리 색상을 위해 CSS 변수로도 저장
          el.style.setProperty('--label-bg', `${color}F2`);
          // 폭을 고정해야 콜리전 그리드(LABEL_W)와 실제 점유 영역이 일치한다
          el.style.width = `${LABEL_W}px`;
          // 밝은 시그널색 위에서는 흰 글씨가 안 읽힌다 — 휘도로 흑/백 전환
          el.style.color = readableTextOn(color);

          const rank = opts?.rank;
          const dealType = aptScreen.dealType;
          const dealStr = dealType === 'trade' ? '매' : '전';
          const amountStr = formatAmount(rank?.amount ?? null) || '정보없음';

          const line1 = document.createElement('div');
          line1.className = s.labelLine1;
          line1.textContent = `${dealStr} ${amountStr}`;

          const line2 = document.createElement('div');
          line2.className = s.labelLine2;
          const areaStr = rank?.area ? `${rank.area}㎡` : '';
          // 96px 라벨에 소수 1자리까지 넣으면 잘린다 — 정밀도는 리스트·상세가 책임진다
          const signalStr =
            value != null
              ? formatSignalValue(value, signal).replace(/\.\d+/, '')
              : '—';
          line2.textContent = areaStr ? `${areaStr} ${signalStr}` : signalStr;

          el.appendChild(line1);
          el.appendChild(line2);

          const tip = document.createElement('span');
          tip.className = s.markerTip;
          const priceTxt =
            rank?.price != null ? ` · 평당 ${fmt(rank.price, 0)}만` : '';
          tip.textContent = `${apt.aptNm}${priceTxt}`;
          el.appendChild(tip);
        } else {
          // ─── 작은 점 (점유된 셀 또는 회색) ───
          el.className = isGray ? `${s.markerDot} ${s.markerDim}` : s.markerDot;
          el.style.backgroundColor = color;

          const tip = document.createElement('span');
          tip.className = s.markerTip;
          if (isGray) {
            tip.textContent = `${apt.aptNm} · 조건 미충족(거래부족·데이터부족)`;
          } else {
            const r = opts?.rank;
            const amountTxt = formatAmount(r?.amount ?? null);
            const head = amountTxt
              ? `${aptScreen.dealType === 'trade' ? '매' : '전'} ${amountTxt}`
              : '';
            const areaTxt = r?.area ? `${r.area}㎡` : '';
            const sigTxt =
              value != null ? formatSignalValue(value, signal) : '조건 미충족';
            const priceTxt =
              opts?.price != null ? `평당 ${fmt(opts.price, 0)}만` : '';
            tip.textContent = [apt.aptNm, head, areaTxt, sigTxt, priceTxt]
              .filter(Boolean)
              .join(' · ');
          }
          el.appendChild(tip);
        }

        const sig = { signal: ac.signal };
        el.addEventListener(
          'mouseover',
          () => setHoveredComplex(apt.aptSeq, 'map'),
          sig,
        );
        el.addEventListener(
          'mouseout',
          () => setHoveredComplex(null, 'map'),
          sig,
        );
        el.addEventListener(
          'click',
          () => selectComplex(apt.aptSeq, 'map'),
          sig,
        );

        const overlay = new kakao.CustomOverlay({
          position: new kakao.LatLng(apt.lat, apt.lng),
          content: el,
          zIndex,
        });
        if (isLabel && overlay.setYAnchor) {
          overlay.setYAnchor(1); // 라벨의 꼬리가 좌표를 가리키도록
        }
        overlay.setMap(mapRef.current);
        overlaysRef.current.push(overlay);
        markerElsRef.current.set(apt.aptSeq, el);
      };

      // ─── 콜리전 그리드로 라벨 배치 ───
      const grid = new CollisionGrid();
      let labelCount = 0;
      const maxLabels = 150;
      const maxCandidates = 500;
      let candidateCount = 0;

      // ranked 순서(=순위 오름차순)대로 순회 — 상위 순위가 라벨 자리를 먼저 가져간다
      for (const rank of aptScreen.ranked) {
        // 전체 캡은 진짜 중단점이다. AND 로 묶으면 캡이 사실상 무효가 된다.
        if (candidateCount >= maxCandidates) break;

        const apt = byId.get(rank.id);
        if (!apt || apt.lat == null || apt.lng == null) continue;
        if (!inArea(apt)) continue;
        if (!inView(apt.lat, apt.lng)) continue;

        candidateCount++;

        // 화면 픽셀 좌표 구하기
        const pixel = getScreenPixel(
          mapRef.current,
          new kakao.LatLng(apt.lat, apt.lng),
          containerRef.current,
        );
        if (!pixel) {
          // 픽셀 좌표 실패 → 점으로 폴백
          addMarker(apt, rank.value, {
            price: rank.price ?? null,
            zIndex: 100,
            rank,
          });
          continue;
        }

        // 그리드 콜리전 체크 — amount 없으면 라벨 건너뛰기
        const canLabel =
          rank.amount != null && grid.canPlace(pixel) && labelCount < maxLabels;
        if (canLabel) {
          // 라벨 배치
          grid.place(pixel);
          labelCount++;
          addMarker(apt, rank.value, {
            price: rank.price ?? null,
            isLabel: true,
            zIndex: 105,
            rank,
          });
        } else {
          // 점으로 폴백
          addMarker(apt, rank.value, {
            price: rank.price ?? null,
            zIndex: 100,
            rank,
          });
        }
      }

      // 선택 단지는 캡·뷰포트와 무관하게 반드시 렌더 — amount 있으면 라벨, 없으면 점
      if (selectedId && !markerElsRef.current.has(selectedId)) {
        const apt = byId.get(selectedId);
        if (apt && apt.lat != null && apt.lng != null) {
          const r = rankById.get(selectedId);
          const useLabel = r && r.amount != null;
          addMarker(apt, r?.value ?? null, {
            price: r?.price ?? null,
            isLabel: useLabel,
            zIndex: 9999,
            rank: r,
          });
        }
      }

      // ─── 회색 마커 (저거래·데이터부족 단지) — 캡 200 ───
      const rankedSet = new Set(aptScreen.ranked.map(r => r.id));
      let shownGray = 0;
      for (const apt of aptComplexes.items) {
        if (shownGray >= 200) break;
        if (rankedSet.has(apt.aptSeq)) continue; // 이미 표시됨
        if (!inArea(apt)) continue;
        if (apt.lat == null || apt.lng == null) continue;
        if (!inView(apt.lat, apt.lng)) continue;
        shownGray++;
        addMarker(apt, null, { isGray: true, zIndex: 50 });
      }
    }

    return clear;
  }, [
    kakao,
    aptScreen,
    aptComplexes,
    // level state 는 표시용(칩)일 뿐 — 재구성은 idle 이 올리는 viewportTick 하나로 트리거한다.
    // 둘 다 걸면 한 프레임 어긋난 이중 재구성이 생긴다.
    viewportTick,
    areaFilter,
    colorMode,
    setHoveredComplex,
    selectComplex,
    setAreaFilter,
  ]);

  // ─────────────────── hover·선택 하이라이트 (리스트 ↔ 마커 양방향) ─────────────────────
  // 라벨과 점 모두 같은 클래스 토글로 동작
  useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      el.classList.toggle(s.markerOn, id === hoveredComplexId);
      el.classList.toggle(s.markerSel, id === selectedComplexId);
    }
  }, [hoveredComplexId, selectedComplexId, viewportTick]);

  // ─────────────────── 리스트발 선택 → 지도가 따라간다 ─────────────────────
  // 지도발 선택(selectionSource==='map')은 무시 — 사용자가 방금 클릭한 자리에서 지도를 빼앗지 않는다.
  useEffect(() => {
    if (
      !kakao ||
      !mapRef.current ||
      !selectedComplexId ||
      selectionSource !== 'list'
    )
      return;
    const apt = byId.get(selectedComplexId);
    if (!apt || apt.lat == null || apt.lng == null) return;
    moveMap(m => {
      if (m.getLevel() >= 7) m.setLevel(5);
      m.panTo(new kakao.LatLng(apt.lat!, apt.lng!));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao, selectedComplexId, selectionSource, aptComplexes]);

  // ─────────────────── 뷰포트 자동 맞춤 — 단일 조정자 ─────────────────────
  // 규칙을 한 곳에 모은다. 두 effect 로 나누면 지역 필터 중 시그널 변경 시
  // 전역 top-50 맞춤이 지역 선택을 빼앗는 경합이 생긴다(리뷰에서 확인된 critical).
  //   · areaFilter 변경        → 항상 그 지역으로 (명시적 사용자 의도)
  //   · 시그널·거래유형 변경    → areaFilter 있으면 그 지역으로(최신 데이터),
  //                              없으면 사용자가 손대지 않았을 때만 top-50 으로
  //   · 첫 로드                → 서울 전역 기본 뷰 유지
  const prevFitKeyRef = useRef<{ query: string; area: string } | null>(null);
  useEffect(() => {
    if (!kakao || !mapRef.current || !aptScreen || !aptComplexes) return;
    const queryKey = `${aptScreen.signal}|${aptScreen.dealType}`;
    const areaKey = areaFilter
      ? `${areaFilter.gu}|${areaFilter.umdNm ?? ''}`
      : '';
    const prev = prevFitKeyRef.current;
    prevFitKeyRef.current = { query: queryKey, area: areaKey };
    if (!prev) return;
    const queryChanged = prev.query !== queryKey;
    const areaChanged = prev.area !== areaKey;
    if (!queryChanged && !areaChanged) return;

    const bounds = new kakao.LatLngBounds();
    let n = 0;
    const extend = (apt: AptComplex) => {
      if (apt.lat != null && apt.lng != null) {
        bounds.extend(new kakao.LatLng(apt.lat, apt.lng));
        n++;
      }
    };

    if (areaFilter) {
      let sumLat = 0,
        sumLng = 0;
      for (const r of aptScreen.ranked) {
        const apt = byId.get(r.id);
        if (!apt || apt.gu !== areaFilter.gu) continue;
        if (areaFilter.umdNm && apt.umdNm !== areaFilter.umdNm) continue;
        extend(apt);
        if (apt.lat != null && apt.lng != null) {
          sumLat += apt.lat;
          sumLng += apt.lng;
        }
      }
      // 이 좌표에서 사용자가 벗어나면 선택을 푼다(onIdle 참조)
      areaCenterRef.current = n ? { lat: sumLat / n, lng: sumLng / n } : null;
    } else if (areaChanged) {
      areaCenterRef.current = null;
      return; // 필터 해제 — 현재 뷰를 유지한다(사용자가 보던 자리를 빼앗지 않음)
    } else if (userMovedRef.current) {
      return; // 사용자가 직접 움직인 뒤에는 전역 자동 맞춤을 하지 않는다
    } else {
      for (const r of aptScreen.ranked.slice(0, 50)) {
        const apt = byId.get(r.id);
        if (apt) extend(apt);
      }
    }
    if (n >= 2) moveMap(m => m.setBounds(bounds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao, aptScreen, aptComplexes, areaFilter]);

  // ─────────────────── 줌 버튼 ─────────────────────
  const handleZoomIn = () => {
    if (mapRef.current) {
      const newLevel = Math.max(1, mapRef.current.getLevel() - 1);
      mapRef.current.setLevel(newLevel);
      setLevel(newLevel);
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      const newLevel = Math.min(14, mapRef.current.getLevel() + 1);
      mapRef.current.setLevel(newLevel);
      setLevel(newLevel);
    }
  };

  // ─────────────────── 범례 — 화면에 실제로 그려진 데이터(aptScreen) 기준 ─────────────────────
  const legendData = useMemo(() => {
    if (!aptScreen) return null;
    return legendStops(SIGNAL_DOMAIN[aptScreen.signal], colorMode);
  }, [aptScreen, colorMode]);

  // 좌표가 없어 지도에서 조용히 빠진 단지 수 — 숨기지 않고 칩으로 알린다.
  const noCoordCount = useMemo(() => {
    if (!aptScreen || !aptComplexes) return 0;
    return aptScreen.ranked.reduce((sum, r) => {
      const apt = byId.get(r.id);
      return sum + (!apt || apt.lat == null ? 1 : 0);
    }, 0);
  }, [aptScreen, aptComplexes]);

  if (!kakao) {
    return null;
  }

  // 지도는 보조 뷰(디자인 D9)지만 통째로 aria-hidden 을 걸면 안 된다 —
  // 하위의 줌 버튼이 "포커스는 가는데 읽히지 않는" 상태가 된다.
  // 접근성 트리에서 빼는 건 마커 캔버스뿐. 마커·동 박스에는 tabIndex 를 주지 않는다(리스트가 정규 조작면).
  return (
    <div className={s.container} role="region" aria-label="단지 지도 (보조 뷰)">
      <div ref={containerRef} className={s.mapContainer} aria-hidden="true" />

      {/* 좌상단 칩 */}
      <div className={s.chipTop}>
        {/* 라벨이 겹쳐 점으로 밀린 단지를 사용자가 "왜 얘만 없지?"로 읽지 않게 규칙을 밝힌다 */}
        {level >= 9
          ? '구 단위 집계 — 확대하면 동 단위'
          : level >= 7
            ? '동 단위 집계 — 확대하면 단지 가격'
            : '가격 라벨 · 겹치면 점으로 — 확대하면 더 보입니다'}
      </div>

      {/* 우상단 줌 버튼 */}
      <div className={s.zoomControls}>
        <button
          className={s.zoomBtn}
          onClick={handleZoomIn}
          aria-label="줌 인"
          title="확대"
        >
          +
        </button>
        <button
          className={s.zoomBtn}
          onClick={handleZoomOut}
          aria-label="줌 아웃"
          title="축소"
        >
          −
        </button>
      </div>

      {/* 좌표 없는 단지 안내 — 지도에서 빠진 만큼을 숨기지 않는다 */}
      {noCoordCount > 0 && (
        <div className={s.noCoordChip}>
          좌표 없음 {noCoordCount.toLocaleString()}단지 제외
        </div>
      )}

      {/* 하단 범례 — 산식 설명은 ⓘ 툴팁으로 (한 줄 4개 정보는 과밀) */}
      {legendData && aptScreen && (
        <div className={s.legendStrip}>
          <div className={s.legendContent}>
            <span className={s.legendLabel}>
              {formatSignalValue(legendData[0].value, aptScreen.signal)}
            </span>
            {legendData.map(stop => (
              <div
                key={stop.value}
                className={s.legendBox}
                style={{ backgroundColor: stop.color }}
              />
            ))}
            <span className={s.legendLabel}>
              {formatSignalValue(
                legendData[legendData.length - 1].value,
                aptScreen.signal,
              )}
            </span>
            <span className={s.legendNote}>
              회색 = 거래 {aptScreen.minDeals}건 미만·데이터 부족
            </span>
            {/* title 툴팁은 마우스에만 있다 — 터치·키보드에서도 열리도록 버튼 토글로 */}
            <button
              type="button"
              className={s.legendInfo}
              aria-expanded={infoOpen}
              aria-label="산식 설명"
              onClick={() => setInfoOpen(v => !v)}
            >
              ⓘ
            </button>
            {infoOpen && (
              <span className={s.legendNote}>
                {aptScreen.dealType === 'rent' ? '전세' : '매매'} 평당가 중앙값
                · 기준월 = 3개월 전 (신고지연 30일 보정)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
