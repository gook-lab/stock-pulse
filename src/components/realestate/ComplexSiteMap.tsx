import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EmptyState,
  ErrorState,
  Loading,
  Segmented,
  Spinner,
} from '@/components/common';
import {
  solarPosition,
  shadowVector,
  convexHull,
  SUN_PRESETS,
  kstDate,
  type SunPresetKey,
} from '@/lib/sun';
import {
  project,
  unproject,
  metersToLatLng,
  latLngToMeters,
  depthAt,
  northDegrees,
  wallTone,
  ringIsCCW,
  ribbon,
  path,
  clampPitch,
  wrapYaw,
  PITCH_DEFAULT,
  PITCH_MIN,
  PITCH_MAX,
} from '@/lib/iso';
import {
  type Poi,
  POI_ORDER,
  POI_GLYPH,
  POI_LABEL,
  type XY,
  ZOOM_MIN,
  ZOOM_MAX,
  YAW_PER_PX,
  PITCH_PER_PX,
  CELL_TIMEOUT_MS,
  MAX_INFLIGHT,
  EVICT_SLACK,
  clampZoom,
  cellBudget,
  levelOfDetail,
  dragMode,
  dragZoomFactor,
  boxesOverlap,
  dedupePois,
} from './siteMapView';
import s from './ComplexSiteMap.module.css';

/**
 * 단지 배치도 — 건물 외곽선(OSM)을 우리 층수로 압출한 아이소메트릭 뷰.
 *
 * 호갱노노의 3D 조감도를 공공 데이터로 근사한다. three.js 를 쓰지 않는 이유:
 * 아이소메트릭 고정 각도면 SVG 압출로 같은 정보를 주고 번들이 0KB 늘어난다.
 * 회전은 90° 4단계로만 준다 — 좌표를 돌리는 것이 카메라를 돌리는 것과 같아서 렌더러가 필요 없다.
 * (자유 시점이 필요해지면 그때 렌더러를 갈아끼우면 된다 — 데이터 계약은 그대로다.)
 * 좌표 변환·깊이 정렬은 @/lib/iso 에 있다(테스트 대상).
 */

interface Building {
  id: string;
  ring: [number, number][]; // 단지 중심 기준 로컬 미터
  area: number;
  levels: number | null; // OSM 이 아는 층수. 없으면 fallbackLevels
  name: string | null;
  dist: number; // 단지 중심에서의 거리(m)
  apartment: boolean;
}

interface GroundFeature {
  /** path = 보행로·자전거도로(도로와 굵기·색을 나눠야 인도 그물이 화면을 덮지 않는다), rail = 지상 철도 */
  kind: 'green' | 'water' | 'road' | 'path' | 'rail';
  closed: boolean;
  pts: [number, number][];
  width?: number; // 열린 선(길·철도)만
  name?: string; // 큰길만
}

interface BuildingsResult {
  aptSeq: string;
  aptNm: string;
  origin: { lat: number; lng: number };
  radius: number;
  buildings: Building[];
  ground?: GroundFeature[];
  pois?: Poi[];
  fallbackLevels: number | null;
  fetchedAt: string;
}

/** 서버가 격자 칸 단위로 내려주는 주변 지역(`/api/realestate/area`). */
interface AreaCell {
  key: string;
  center: { lat: number; lng: number };
  buildings: Building[];
  ground: GroundFeature[];
  pois?: Poi[];
}

const GROUND_CLASS: Record<GroundFeature['kind'], string> = {
  green: s.green,
  water: s.water,
  road: s.road,
  path: s.path,
  rail: s.rail,
};

/**
 * 벽 그라디언트 정의표. near/far × 3단계 명암 = 6개.
 * stop 색은 인라인 style 로 토큰을 참조한다 — CSS 모듈로 빼면 12개 클래스가 되고,
 * 색 값 자체는 여전히 global.css 에만 있다.
 */
const WALL_GRADS = [
  { id: 'n0', top: '--bld-near-w1', bottom: '--bld-near-base' },
  { id: 'n1', top: '--bld-near-w2', bottom: '--bld-near-base' },
  { id: 'n2', top: '--bld-near-w3', bottom: '--bld-near-base' },
  { id: 'f0', top: '--bld-far-w1', bottom: '--bld-far-base' },
  { id: 'f1', top: '--bld-far-w2', bottom: '--bld-far-base' },
  { id: 'f2', top: '--bld-far-w3', bottom: '--bld-far-base' },
] as const;

const FLOOR_H = 2.8; // 층고(m) — 공동주택 표준
const NEAR_M = 70; // 이 거리 안쪽을 "이 단지"로 본다
/** 화면 이동 속도(초당 화면 높이 비율). 지도 앱처럼 누르는 동안 계속 흐르게 한다. */
const PAN_PER_SEC = 0.9;
/** 방위각 → 한글 8방위. 숫자만 보여주면 "225°" 가 어디인지 읽히지 않는다. */
const compass = (az: number) =>
  ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][
    Math.round((az % 360) / 45) % 8
  ];

interface Props {
  aptSeq: string;
  fallbackFloors: number | null;
  /** 크게보기(모달) — 캔버스를 화면 높이에 맞춰 키운다. */
  large?: boolean;
}

export default function ComplexSiteMap({
  aptSeq,
  fallbackFloors,
  large = false,
}: Props) {
  const [data, setData] = useState<BuildingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 일조 시뮬레이션 — 절기 + 시각. 외부 데이터 없이 태양 궤도로 계산한다.
  const [preset, setPreset] = useState<SunPresetKey>('winter');
  const [hour, setHour] = useState(12);
  /** 시점 — 드래그로 회전(방위·고도), Shift+드래그·방향키로 이동, 휠로 확대. */
  const [cam, setCam] = useState({
    yaw: 0,
    pitch: PITCH_DEFAULT,
    panX: 0,
    panY: 0,
    zoom: 1,
  });
  /** 방향키로 나가면 서버에서 받아오는 주변 격자 칸들. 단지 payload 와 합쳐 한 세계로 그린다. */
  const [cells, setCells] = useState<AreaCell[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    /* 다른 단지를 열면 이전 주변은 **좌표계가 다르다**.
       진행 중이던 구역 요청을 끊고, 늦게 도착하는 응답은 seqRef 로 걸러낸다.
       (끊기만 하면 이미 응답이 온 것은 못 막고, 걸러내기만 하면 쓸데없는 통신이 남는다.) */
    seqRef.current = aptSeq;
    abortRef.current.forEach(c => c.abort());
    abortRef.current.clear();
    pendingRef.current = [];
    inFlightRef.current = 0;
    missRef.current = [];
    setCells([]);
    setCam({ yaw: 0, pitch: PITCH_DEFAULT, panX: 0, panY: 0, zoom: 1 });
    dragRef.current = null; // 끌던 중에 단지가 바뀌면 그 드래그는 이어지면 안 된다
    setDragging(false);
    fetch(`/api/realestate/complex/buildings?id=${encodeURIComponent(aptSeq)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<BuildingsResult>;
      })
      .then(d => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(e => {
        if (alive) {
          setError(String((e as Error)?.message || e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [aptSeq, tick]);

  /** 태양 — 단지 좌표·절기·시각. 동지 저녁처럼 해가 없는 조합은 sun.altitude<=0 으로 걸러진다. */
  const sun = useMemo(() => {
    if (!data?.origin) return null;
    const p = SUN_PRESETS.find(x => x.key === preset)!;
    const when = kstDate(
      new Date().getFullYear(),
      p.month,
      p.day,
      Math.floor(hour),
      (hour % 1) * 60,
    );
    return solarPosition(when, data.origin.lat, data.origin.lng);
  }, [data, preset, hour]);

  /**
   * 단지 payload + 스트리밍으로 받은 주변 칸을 하나의 세계로 합친다.
   * OSM id 로 중복을 걸러야 한다 — 단지가 든 칸은 같은 건물을 다시 준다.
   * 지면은 id 가 없으니 (종류 + 첫 점) 으로 본다: Overpass 는 way 를 자르지 않고 통째로 주므로
   * 두 칸에 걸친 도로는 두 응답에서 완전히 같은 점열로 온다.
   */
  const world = useMemo(() => {
    if (!data?.buildings) return null;
    const seenB = new Set<string>();
    const seenG = new Set<string>();
    const buildings: Building[] = [];
    const ground: GroundFeature[] = [];
    const addB = (b: Building) => {
      if (!seenB.has(b.id)) {
        seenB.add(b.id);
        buildings.push(b);
      }
    };
    const addG = (g: GroundFeature) => {
      const k = `${g.kind}:${g.pts[0]?.[0]},${g.pts[0]?.[1]},${g.pts.length}`;
      if (!seenG.has(k)) {
        seenG.add(k);
        ground.push(g);
      }
    };
    const rawPois: Poi[] = [...(data.pois ?? [])];
    data.buildings.forEach(addB);
    (data.ground ?? []).forEach(addG);
    for (const c of cells) {
      c.buildings.forEach(addB);
      c.ground.forEach(addG);
      rawPois.push(...(c.pois ?? []));
    }
    return {
      buildings,
      ground,
      pois: dedupePois(rawPois),
      homeIds: new Set(data.buildings.map(b => b.id)),
    };
  }, [data, cells]);

  /**
   * 압출 → 화면 좌표. 벽은 깊이 순으로 그려야 앞 건물이 뒤 건물을 가린다.
   *
   * 팬은 여기에 넣지 않는다(방위·고도·줌만 의존). 투영·그림자·정렬은 건물 수백 개에 비싸고
   * 팬은 viewBox 문자열만 바뀌면 되므로, 매 프레임 이걸 다시 돌리면 이동이 끊긴다.
   */
  const lod = useMemo(() => levelOfDetail(cam.zoom), [cam.zoom]);

  const geom = useMemo(() => {
    if (!world?.buildings.length || !data) return null;
    const base = data.fallbackLevels ?? fallbackFloors ?? 5;
    /** 시야 기준 틀은 "이 단지" 건물만으로 잡는다 — 주변이 들어올 때마다 화면이 튀면 안 된다. */
    const framePts: { sx: number; sy: number }[] = [];

    const solids = world.buildings
      .filter(b => b.area >= lod.minArea)
      .map(b => {
        const levels = b.levels ?? base;
        const h = levels * FLOOR_H;
        const near = b.dist <= NEAR_M;
        const ground = b.ring.map(([x, y]) =>
          project(x, y, 0, cam.yaw, cam.pitch),
        );
        const roof = b.ring.map(([x, y]) =>
          project(x, y, h, cam.yaw, cam.pitch),
        );
        if (world.homeIds.has(b.id)) framePts.push(...ground, ...roof);

        // 그림자 — 밑면을 태양 반대편으로 밀고, 원본과 함께 볼록 껍질로 묶어 지면에 눕힌다.
        const sv = sun && lod.shadows ? shadowVector(sun, h) : null;
        const shadow = sv
          ? path(
              convexHull([
                ...b.ring,
                ...b.ring.map(
                  ([x, y]) => [x + sv.dx, y + sv.dy] as [number, number],
                ),
              ]).map(([x, y]) => project(x, y, 0, cam.yaw, cam.pitch)),
            )
          : null;

        // OSM 링 방향은 보장되지 않는다(실측 CW 32%). 방향을 먼저 재고 법선을 그에 맞춘다.
        const ccw = ringIsCCW(b.ring);
        // 벽 4각형 — 각 변마다. 화면 깊이가 큰 변이 뒤쪽이다.
        /* 층 구분선 — 바닥 변과 옥상 변을 층 수만큼 내분한다.
         벽 하나당 path 하나로 묶어야(M/L 서브패스) 20층 건물이 20개 엘리먼트가 되지 않는다. */
        const bandsFor = (gA: XY, gB: XY, rA: XY, rB: XY) => {
          const n = Math.min(levels, 30);
          if (n < 2) return null;
          if (!(near ? lod.floors : lod.farFloors)) return null;
          const parts: string[] = [];
          for (let k = 1; k < n; k++) {
            const t = k / n;
            const ax = gA.sx + (rA.sx - gA.sx) * t,
              ay = gA.sy + (rA.sy - gA.sy) * t;
            const bx = gB.sx + (rB.sx - gB.sx) * t,
              by = gB.sy + (rB.sy - gB.sy) * t;
            parts.push(
              `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`,
            );
          }
          return parts.join(' ');
        };

        const walls = b.ring
          .map(([x1, y1], i) => {
            const [x2, y2] = b.ring[(i + 1) % b.ring.length];
            const j = (i + 1) % ground.length;
            return {
              d: path([ground[i], ground[j], roof[j], roof[i]]),
              bands: bandsFor(ground[i], ground[j], roof[i], roof[j]),
              depth: depthAt((x1 + x2) / 2, (y1 + y2) / 2, cam.yaw),
              // 밝기는 벽의 바깥 법선이 화면에서 어디를 보는가로 정한다 — 회전해도 빛은 화면에 고정.
              tone: wallTone(x1, y1, x2, y2, cam.yaw, ccw),
            };
          })
          .sort((a, b2) => b2.depth - a.depth);

        const cx = b.ring.reduce((t, p) => t + p[0], 0) / b.ring.length;
        const cy = b.ring.reduce((t, p) => t + p[1], 0) / b.ring.length;
        const label = project(cx, cy, h, cam.yaw, cam.pitch);

        return {
          id: b.id,
          near,
          levels,
          area: b.area,
          estimated: b.levels == null, // 우리 층수로 채운 건물은 추정임을 밝힌다
          walls,
          roof: path(roof),
          shadow,
          label,
          /** 접지면 — 벽 아래에 깔아 건물이 땅에 놓인 것처럼 보이게 한다. */
          contact: path(ground),
          depth: depthAt(cx, cy, cam.yaw),
        };
      })
      .sort((a, b2) => b2.depth - a.depth); // 먼 건물 먼저

    // 지면(조경·물·도로) — 압출하지 않고 바닥에 깐다. 도로는 폭을 가진 띠로.
    const groundLayer = world.ground
      .filter(g => lod.paths || g.kind !== 'path')
      .map((g, i) => {
        const poly = g.closed ? g.pts : ribbon(g.pts, g.width ?? 6);
        return {
          key: `${g.kind}-${i}`,
          kind: g.kind,
          d: path(poly.map(([x, y]) => project(x, y, 0, cam.yaw, cam.pitch))),
        };
      });

    /* 라벨 후보 — 투영만 해 둔다. 겹침 회피와 화면 밖 걸러내기는 팬·줌에 따라 달라지므로
       여기(기하)에 두지 않는다. 여기서 걸러 버리면 화면 밖 라벨이 자리를 차지해
       정작 눈앞의 길에 이름이 안 붙는다(실측: 16개 중 5개만 화면 안이었다). */
    const poiCandidates = world.pois
      .map(p => ({ p, s: project(p.x, p.y, 0, cam.yaw, cam.pitch) }))
      .sort((a, b) => POI_ORDER.indexOf(a.p.kind) - POI_ORDER.indexOf(b.p.kind))
      .map(({ p, s: pt }) => ({
        key: `${p.kind}-${p.name ?? ''}-${p.x},${p.y}`,
        kind: p.kind,
        name: p.name,
        sx: pt.sx,
        sy: pt.sy,
      }));

    /* 한 길은 칸마다 잘려 여러 조각으로 들어온다 — 이름당 조각을 모두 남기고
       어느 조각에 붙일지는 화면을 아는 쪽에서 고른다. */
    const roadCandidates = world.ground
      .filter(g => !g.closed && g.name && g.pts.length >= 2)
      .map(g => {
        const mid = g.pts[Math.floor(g.pts.length / 2)];
        const pt = project(mid[0], mid[1], 0, cam.yaw, cam.pitch);
        return { name: g.name as string, sx: pt.sx, sy: pt.sy };
      });

    const pad = 14;
    const xs = framePts.map(p => p.sx),
      ys = framePts.map(p => p.sy);
    const minX = Math.min(...xs) - pad,
      maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad,
      maxY = Math.max(...ys) + pad;

    return {
      solids,
      groundLayer,
      poiCandidates,
      roadCandidates,
      edges: lod.edges,
      frame: {
        w: maxX - minX,
        h: maxY - minY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
      },
      span: Math.max(maxX - minX, maxY - minY),
    };
  }, [world, data, fallbackFloors, sun, cam.yaw, cam.pitch, lod]);

  /** 카메라 — 팬·줌은 viewBox 를 옮기고 좁히는 것뿐이라 기하를 다시 계산하지 않는다. */
  const viewBox = useMemo(() => {
    if (!geom) return '0 0 1 1';
    const { frame } = geom;
    const w = frame.w / cam.zoom,
      h = frame.h / cam.zoom;
    return `${frame.cx + cam.panX - w / 2} ${frame.cy + cam.panY - h / 2} ${w} ${h}`;
  }, [geom, cam.panX, cam.panY, cam.zoom]);

  /**
   * 라벨 배치 — 화면 안만 남기고 겹치는 것을 걸러낸다.
   *
   * 기하(geom)가 아니라 여기서 하는 이유: 무엇이 보이는지는 팬·줌에 달렸고,
   * 화면 밖 라벨이 겹침 판정 자리를 먹으면 정작 눈앞의 길에 이름이 안 붙는다.
   * 후보가 수십 개라 매 프레임 돌려도 싸다(기하 재계산과 달리).
   */
  const labels = useMemo(() => {
    if (!geom) return { pois: [], roads: [] };
    const { frame } = geom;
    const w = frame.w / cam.zoom,
      h = frame.h / cam.zoom;
    const cx = frame.cx + cam.panX,
      cy = frame.cy + cam.panY;
    const margin = 12;
    const onScreen = (x: number, y: number) =>
      Math.abs(x - cx) <= w / 2 + margin && Math.abs(y - cy) <= h / 2 + margin;

    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const fits = (x: number, y: number, bw: number, bh: number) => {
      const box = { x, y, w: bw, h: bh };
      if (taken.some(t => boxesOverlap(t, box))) return false;
      taken.push(box);
      return true;
    };

    const pois = lod.pois
      ? geom.poiCandidates
          .filter(p => onScreen(p.sx, p.sy))
          .filter(p => {
            const label = lod.poiNames && p.name ? p.name : '';
            const bw = 17 + (label ? label.length * 6.2 + 4 : 0);
            return fits(p.sx + (label ? bw / 2 - 8 : 0), p.sy, bw, 18);
          })
          .map(p => ({ ...p, name: lod.poiNames ? p.name : null }))
      : [];

    // 같은 길의 여러 조각 중 화면 중앙에 가장 가까운 것 하나만 고른다.
    const roads = lod.roadNames
      ? Object.values(
          geom.roadCandidates
            .filter(r => onScreen(r.sx, r.sy))
            .reduce<
              Record<
                string,
                { name: string; sx: number; sy: number; d: number }
              >
            >((acc, r) => {
              const d = Math.hypot(r.sx - cx, r.sy - cy);
              if (!acc[r.name] || d < acc[r.name].d) acc[r.name] = { ...r, d };
              return acc;
            }, {}),
        )
          .sort((a, b) => a.d - b.d)
          .filter(r => fits(r.sx, r.sy, r.name.length * 6.4 + 6, 13))
      : [];

    return { pois, roads };
  }, [geom, cam.panX, cam.panY, cam.zoom, lod]);

  /** 이 단지가 화면 밖으로 나갔는가(두 사각형이 안 겹치는가). 나갔으면 돌아갈 길을 준다. */
  const offView = useMemo(() => {
    if (!geom) return false;
    const { frame } = geom;
    return (
      Math.abs(cam.panX) > (frame.w / cam.zoom + frame.w) / 2 ||
      Math.abs(cam.panY) > (frame.h / cam.zoom + frame.h) / 2
    );
  }, [geom, cam.panX, cam.panY, cam.zoom]);

  /**
   * SVG 내용은 기하가 바뀔 때만 만든다. 팬은 viewBox 만 바뀌므로 이 엘리먼트를 재사용해야
   * React 가 건물 수백 개를 매 프레임 다시 훑지 않는다(같은 참조면 서브트리 diff 를 건너뛴다).
   */
  /** 그라디언트 id 는 문서 전역이다 — 단지가 바뀌어도 겹치지 않게 aptSeq 를 붙인다. */
  const gradPrefix = `bw-${aptSeq.replace(/[^\w-]/g, '')}`;

  const sceneNodes = useMemo(() => {
    if (!geom) return null;
    return (
      <>
        {/* 벽 세로 그라디언트 — 위는 면의 톤, 아래는 어두운 바닥색.
            단색 압출은 세워둔 종이처럼 보인다. 색은 전부 토큰 참조다. */}
        <defs>
          {WALL_GRADS.map(g => (
            <linearGradient
              key={g.id}
              id={`${gradPrefix}-${g.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0" style={{ stopColor: `var(${g.top})` }} />
              <stop offset="1" style={{ stopColor: `var(${g.bottom})` }} />
            </linearGradient>
          ))}
        </defs>

        {/* 지면 — 조경·물·도로. 그림자보다 아래에 깔려야 그림자가 잔디 위에 눕는다. */}
        <g className={s.groundLayer}>
          {geom.groundLayer.map(g => (
            <path
              key={g.key}
              d={g.d}
              className={GROUND_CLASS[g.kind] ?? s.road}
            />
          ))}
        </g>

        {/* 그림자는 지면에 눕는다 — 건물보다 먼저 전부 그려야 앞 건물이 뒤 그림자를 덮지 않는다.
            viewBox 계산에는 넣지 않는다(그림자가 길면 뷰가 과하게 축소된다 — 넘치는 부분은 잘린다). */}
        <g className={s.shadowLayer}>
          {geom.solids.map(sd =>
            sd.shadow ? <path key={sd.id} d={sd.shadow} /> : null,
          )}
        </g>

        {geom.solids.map(sd => (
          <g key={sd.id} className={sd.near ? s.near : s.far}>
            <path d={sd.contact} className={s.contact} />
            {sd.walls.map((w, i) => (
              <path
                key={i}
                d={w.d}
                className={geom.edges ? s.wallEdged : s.wall}
                fill={`url(#${gradPrefix}-${sd.near ? 'n' : 'f'}${w.tone})`}
              />
            ))}
            {sd.walls.map((w, i) =>
              w.bands ? (
                <path key={`b${i}`} d={w.bands} className={s.bands} />
              ) : null,
            )}
            <path d={sd.roof} className={s.roof} />
            {sd.near && sd.area > 300 && lod.labels && (
              <text
                x={sd.label.sx}
                y={sd.label.sy - 4}
                className={s.lvl}
                textAnchor="middle"
              >
                {sd.levels}F{sd.estimated ? '*' : ''}
              </text>
            )}
          </g>
        ))}
      </>
    );
  }, [geom, gradPrefix]);

  /**
   * 화면상 북쪽이 향하는 각도(CSS/SVG 회전용, 0 = 위).
   * 회전 기능을 넣으면 "여기가 어디 방향인지"를 잃는다 — 일조 판단은 방향이 전제라 나침반이 필수다.
   */
  const northDeg = useMemo(
    () => northDegrees(cam.yaw, cam.pitch),
    [cam.yaw, cam.pitch],
  );

  /* ── 이동 ────────────────────────────────────────────────────────────────
     방향키를 한 번에 한 칸씩 점프시키면 "단지가 순간이동"한다. 지도 앱처럼
     누르고 있는 동안 계속 흐르게 rAF 로 적분한다(속도는 화면 높이 기준이라 줌과 무관하게 일정). */
  const heldRef = useRef(new Set<string>());
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const stepRef = useRef(200);
  useEffect(() => {
    stepRef.current = ((geom?.span ?? 200) / cam.zoom) * PAN_PER_SEC;
  }, [geom, cam.zoom]);

  const flow = useCallback((ts: number) => {
    const dt = lastTsRef.current
      ? Math.min(0.05, (ts - lastTsRef.current) / 1000)
      : 0;
    lastTsRef.current = ts;
    const held = heldRef.current;
    const dx =
      (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
    const dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
    if (dt && (dx || dy)) {
      const len = Math.hypot(dx, dy); // 대각선이 1.4배 빠르면 안 된다
      const step = stepRef.current * dt;
      setCam(c => ({
        ...c,
        panX: c.panX + (dx / len) * step,
        panY: c.panY + (dy / len) * step,
      }));
    }
    if (held.size) {
      rafRef.current = requestAnimationFrame(flow);
    } else {
      rafRef.current = null;
      lastTsRef.current = 0;
    }
  }, []);

  const startFlow = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flow);
  }, [flow]);

  const stopAll = useCallback(() => {
    heldRef.current.clear();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = 0;
  }, []);

  // 창을 벗어나면 keyup 이 오지 않는다 — 누른 채로 남으면 화면이 혼자 계속 흐른다.
  useEffect(() => {
    window.addEventListener('blur', stopAll);
    return () => {
      window.removeEventListener('blur', stopAll);
      stopAll();
    };
  }, [stopAll]);

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key.startsWith('Arrow')) {
      e.preventDefault(); // 방향키로 페이지가 스크롤되면 조감도를 조작할 수 없다
      heldRef.current.add(e.key);
      startFlow();
      return;
    }
    const zoomBy = (k: number) =>
      setCam(c => ({ ...c, zoom: clampZoom(c.zoom * k) }));
    const once: Record<string, () => void> = {
      '[': () => setCam(c => ({ ...c, yaw: wrapYaw(c.yaw - 15) })),
      ']': () => setCam(c => ({ ...c, yaw: wrapYaw(c.yaw + 15) })),
      ',': () => setCam(c => ({ ...c, pitch: clampPitch(c.pitch - 5) })),
      '.': () => setCam(c => ({ ...c, pitch: clampPitch(c.pitch + 5) })),
      '+': () => zoomBy(1.25),
      '=': () => zoomBy(1.25),
      '-': () => zoomBy(1 / 1.25),
      '0': () =>
        setCam({ yaw: 0, pitch: PITCH_DEFAULT, panX: 0, panY: 0, zoom: 1 }),
    };
    const fn = once[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  };

  const onKeyUp = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key.startsWith('Arrow')) heldRef.current.delete(e.key);
  };

  /* ── 드래그 ──────────────────────────────────────────────────────────────
     3D 뷰어 관례를 따른다: 왼쪽 드래그 = 궤도 회전, Shift(또는 가운데·오른쪽) = 이동.
     이 화면의 주된 행동은 "돌려 보기"라 기본 드래그를 회전에 준다. */
  const svgRef = useRef<SVGSVGElement>(null);
  /** 최신 기하를 참조만 한다 — zoomAt 을 geom 의존으로 두면 회전할 때마다 새로 만들어진다. */
  const geomRef = useRef<typeof geom>(null);
  // 렌더 중이 아니라 커밋 뒤에 쓴다 — 버려진 렌더의 기하가 남으면 확대 기준점이
  // 화면에 없는 상태를 가리킨다.
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  /**
   * 커서(또는 화면 중앙) 아래 지점을 붙잡은 채 확대한다.
   *
   * 배율만 바꾸면 화면 중앙이 고정되고 커서 밑 건물은 옆으로 흘러간다 — 지도·3D 뷰어에서
   * 가장 어색한 축에 든다. 확대 뒤에도 같은 월드 지점이 같은 화면 위치에 오도록 팬을 역산한다.
   */
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const el = svgRef.current;
      // 업데이터 밖에서 읽는다. React 는 업데이터를 두 번 이상 실행할 수 있어서
      // 안에서 ref 를 읽으면 실행 시점마다 다른 값을 볼 수 있다.
      const g = geomRef.current;
      // DOM 측정도 업데이터 밖에서 한 번만 한다 (같은 이유 + 레이아웃 강제 1회)
      const rect = el?.getBoundingClientRect();
      setCam(c => {
        const next = clampZoom(c.zoom * factor);
        if (
          !g ||
          next === c.zoom ||
          !rect ||
          clientX == null ||
          clientY == null
        ) {
          return { ...c, zoom: next };
        }
        if (!rect.width || !rect.height) return { ...c, zoom: next };

        const { frame } = g;
        const w = frame.w / c.zoom,
          h = frame.h / c.zoom; // 현재 viewBox 크기
        const w2 = frame.w / next,
          h2 = frame.h / next; // 확대 후 크기
        const tx = (clientX - rect.left) / rect.width; // 커서의 화면 내 비율
        const ty = (clientY - rect.top) / rect.height;

        // 커서가 가리키는 viewBox 좌표 — 확대 전후로 같아야 한다.
        const px = frame.cx + c.panX - w / 2 + tx * w;
        const py = frame.cy + c.panY - h / 2 + ty * h;
        return {
          ...c,
          zoom: next,
          panX: px - tx * w2 + w2 / 2 - frame.cx,
          panY: py - ty * h2 + h2 / 2 - frame.cy,
        };
      });
    },
    [],
  );
  const dragRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    // 가운데 버튼은 브라우저 자동스크롤을 켠다 — 맵 팬과 동시에 돌면 화면이 제멋대로 흐른다.
    if (e.button === 1) e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, button: e.button };
    setDragging(true);
    // 캡처는 있으면 좋은 것(밖으로 나가도 계속 끌림)이지 필수는 아니다. 실패해도 드래그는 살린다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const from = dragRef.current;
    const el = svgRef.current;
    if (!from || !el || !geom) return;
    const dx = e.clientX - from.x,
      dy = e.clientY - from.y;
    // 모드는 매 이동마다 다시 판단한다 — 끌던 도중 Shift·Alt 를 누르면 그 순간부터 바뀌어야 한다.
    const mode = dragMode(from.button, e);

    if (mode === 'zoom') {
      zoomAt(dragZoomFactor(dy), e.clientX, e.clientY);
    } else if (mode === 'pan') {
      const perPx = geom.frame.w / cam.zoom / (el.clientWidth || 1);
      setCam(c => ({
        ...c,
        panX: c.panX - dx * perPx,
        panY: c.panY - dy * perPx,
      }));
    } else {
      // 오른쪽으로 끌면 시계 반대로 도는 게 "물체를 잡고 돌리는" 감각과 맞는다.
      setCam(c => ({
        ...c,
        yaw: wrapYaw(c.yaw - dx * YAW_PER_PX),
        pitch: clampPitch(c.pitch + dy * PITCH_PER_PX),
      }));
    }
    dragRef.current = { ...from, x: e.clientX, y: e.clientY };
  };
  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  /* 포인터 캡처가 실패하면(브라우저·기기에 따라 던진다) SVG 밖에서 뗀 pointerup 이 오지 않아
     드래그 상태가 그대로 남는다 — 커서가 계속 '잡는 중'이고 다음 클릭이 이상하게 동작한다.
     창 전체에서 끝을 받아 확실히 푼다. */
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, [dragging, endDrag]);

  /**
   * 휠 확대 — 지도·3D 뷰어의 기본 조작. passive:false 여야 페이지 스크롤을 막을 수 있어
   * React 의 onWheel 이 아니라 네이티브 리스너로 단다.
   *
   * hasScene 에 의존해야 한다: 첫 렌더는 로딩 상태라 svg 가 아직 없고,
   * [] 로 두면 그때 한 번 시도하고 끝나 휠이 영원히 안 먹는다(실제로 그랬다).
   */
  const hasScene = !!geom;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      /* 맵 위를 지나가는 스크롤까지 가로채면 긴 상세 페이지를 내려갈 수 없다.
         Ctrl/⌘ 를 쥐었거나 이미 이 캔버스를 만진(포커스) 뒤에만 확대로 해석한다. */
      const engaged = ev.ctrlKey || ev.metaKey || document.activeElement === el;
      if (!engaged) return;
      ev.preventDefault();
      zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX, ev.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasScene, zoomAt]);

  /* ── 주변 스트리밍 ───────────────────────────────────────────────────────
     화면 중앙이 아직 못 받은 격자 칸으로 들어가면 그 칸을 받아온다.
     칸 인덱스 계산을 클라이언트에 복제하지 않는다 — 서버가 준 칸 중심과 크기로
     "이미 덮인 곳인가"만 판단하면 되고, 그래야 격자 정의가 한 곳에만 존재한다. */
  const [streaming, setStreaming] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const cellSizeRef = useRef(200);
  const missRef = useRef<{ x: number; y: number; until: number }[]>([]);

  /** 동시에 받는 구역 수. 하나씩 받으면 0.3× 에서 40칸 채우는 데 3분이 넘는다(실측). */
  const inFlightRef = useRef(0);
  /** 받는 중인 지점들 — 동시 요청이 같은 칸을 겹쳐 받지 않게 "덮인 것"으로 친다. */
  const pendingRef = useRef<{ x: number; y: number }[]>([]);
  /** 실패한 칸의 대기시간이 지나면 이 값이 바뀌어 스트리밍 훅을 다시 깨운다. */
  const [retryTick, setRetryTick] = useState(0);
  /** 재시도 예약 타이머 — 언마운트 시 취소해야 한다(20초짜리라 상세를 닫고 나가도 살아남는다). */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 살아 있는가 + 진행 중인 요청.
   *
   * effect 의 정리 함수에서 abort 하면 안 된다 — 의존성에 카메라가 들어 있어 팬·회전 중
   * 매 프레임 정리가 돌고, 그러면 방금 시작한 구역 요청이 매번 취소되어 영영 안 받아진다.
   * 그래서 **언마운트에서만** 끊고, 응답 처리 직전에 살아 있는지만 확인한다.
   */
  const aliveRef = useRef(true);
  const abortRef = useRef(new Set<AbortController>());
  /** 지금 보고 있는 단지. 응답이 도착했을 때 그 사이 단지가 바뀌지 않았는지 확인한다. */
  const seqRef = useRef(aptSeq);
  useEffect(() => {
    /* 마운트마다 다시 true 로 되돌려야 한다.
       StrictMode(개발)는 mount → cleanup → mount 를 한 번 더 돈다. 정리에서 false 로만 두면
       두 번째 마운트에서 영영 false 로 남아 **받아온 구역을 전부 버린다**
       (실측 증상: 요청은 200 으로 오는데 화면은 계속 "주변 불러오는 중"). */
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      abortRef.current.forEach(c => c.abort());
      abortRef.current.clear();
    };
  }, []);

  /** 구역 하나 받아오기. 성공하면 세계에 합치고, 실패·시간초과는 잠시 뒤 다시 시도한다. */
  const requestCell = useCallback(
    (x: number, y: number, budget: number) => {
      const origin = data?.origin;
      if (!origin) return;
      const { lat, lng } = metersToLatLng(x, y, origin.lat, origin.lng);
      const url =
        `/api/realestate/area?lat=${lat}&lng=${lng}` +
        `&originLat=${origin.lat}&originLng=${origin.lng}`;

      const reqSeq = seqRef.current;
      const target = { x, y };
      pendingRef.current.push(target);
      inFlightRef.current += 1;
      setStreaming(true);

      /* 한 칸이 오래 걸리면(실측 49.7초) 그 슬롯이 계속 막힌다.
       일정 시간이 지나면 끊고 다음 칸으로 넘어간다 — 끊긴 칸은 잠시 뒤 다시 시도한다. */
      const ctl = new AbortController();
      abortRef.current.add(ctl);
      const killer = setTimeout(() => ctl.abort(), CELL_TIMEOUT_MS);

      const retryAfter = (ms: number) => {
        missRef.current.push({ x, y, until: Date.now() + ms });
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(
          () => setRetryTick(t => t + 1),
          ms + 200,
        );
      };

      fetch(url, { signal: ctl.signal })
        .then(async r => {
          if (!r.ok)
            throw new Error(
              (await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`,
            );
          return r.json() as Promise<AreaCell & { cellSize: number }>;
        })
        .then(cell => {
          // 응답이 늦게 오는 사이 다른 단지로 옮겼다면 버린다 — 좌표계가 다르다.
          if (!aliveRef.current || seqRef.current !== reqSeq) return;
          if (cell.cellSize) cellSizeRef.current = cell.cellSize;
          setStreamErr(null);
          setCells(prev => {
            if (prev.some(c => c.key === cell.key)) return prev;
            const next = [...prev, cell];
            /* 퇴출에는 여유를 둔다(이력현상). 줌을 조금만 되돌려도 상한이 줄어드는데
             그때마다 버리면, 다시 확대할 때 방금 버린 칸을 또 받는 왕복이 생긴다. */
            if (next.length <= Math.round(budget * EVICT_SLACK)) return next;
            // 화면에서 먼 칸부터 버린다 — 되돌아가면 캐시라 즉시 다시 들어온다.
            const dist = (c: AreaCell) => {
              const m = latLngToMeters(
                c.center.lat,
                c.center.lng,
                origin.lat,
                origin.lng,
              );
              return Math.hypot(m.x - x, m.y - y);
            };
            return next.sort((a, b) => dist(a) - dist(b)).slice(0, budget);
          });
        })
        .catch(e => {
          if (!aliveRef.current || seqRef.current !== reqSeq) return;
          if ((e as Error)?.name === 'AbortError') {
            retryAfter(8_000);
            return;
          }
          // Overpass 는 붐빌 때 504 를 준다. 카메라가 멈춰 있으면 훅을 깨울 것이 없어 직접 예약한다.
          setStreamErr(String((e as Error)?.message || e));
          retryAfter(20_000);
        })
        .finally(() => {
          clearTimeout(killer);
          abortRef.current.delete(ctl);
          pendingRef.current = pendingRef.current.filter(t => t !== target);
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          if (aliveRef.current && inFlightRef.current === 0)
            setStreaming(false);
        });
    },
    [data],
  );

  useEffect(() => {
    if (!data?.origin || !geom) return;
    const timer = setTimeout(() => {
      // 칸 상한에 닿으면 멈춘다 — 계속 받으면 방금 버린 칸을 다시 받는 왕복이 생긴다.
      // 상한은 줌에 따라 늘어난다(축소하면 화면이 넓어지므로 더 많은 칸이 필요하다).
      const budget = cellBudget(cam.zoom);
      const free = Math.min(
        MAX_INFLIGHT - inFlightRef.current,
        budget - cells.length - inFlightRef.current,
      );
      if (free <= 0) return;

      const half = cellSizeRef.current / 2;
      const now = Date.now();
      missRef.current = missRef.current.filter(m => m.until > now);

      const loaded = cells.map(c =>
        latLngToMeters(
          c.center.lat,
          c.center.lng,
          data.origin.lat,
          data.origin.lng,
        ),
      );
      // 받는 중인 지점도 "덮인 것"으로 봐야 한다 — 아니면 동시 요청이 같은 칸을 겹쳐 받는다.
      const covered = (x: number, y: number) =>
        loaded.some(
          m => Math.abs(x - m.x) <= half && Math.abs(y - m.y) <= half,
        ) ||
        pendingRef.current.some(
          m => Math.abs(x - m.x) <= half && Math.abs(y - m.y) <= half,
        ) ||
        missRef.current.some(
          m => Math.abs(x - m.x) <= half && Math.abs(y - m.y) <= half,
        );

      /* 화면 전체를 격자로 찍어 아직 안 받은 곳 중 화면 중앙에 가까운 순으로 고른다.
         한 번에 하나씩만 받으면 0.3× 에서 40칸을 채우는 데 3분이 넘는다(실측) — 몇 개는 겹쳐 받는다.
         cells 가 바뀌면 이 훅이 다시 돌아 그다음을 채운다(스스로 이어지는 채우기). */
      const vw = geom.frame.w / cam.zoom,
        vh = geom.frame.h / cam.zoom;
      const vx = geom.frame.cx + cam.panX,
        vy = geom.frame.cy + cam.panY;
      // 축소할수록 화면이 넓어지니 표본도 촘촘히 — 간격이 칸(200m)보다 성기면 칸을 건너뛴다.
      const N = Math.min(14, Math.max(8, Math.round(8 / Math.sqrt(cam.zoom))));
      const center = unproject(vx, vy, cam.yaw, cam.pitch);
      const picks: { x: number; y: number; d: number }[] = [];
      for (let a = 0; a < N; a++) {
        for (let b = 0; b < N; b++) {
          const p = unproject(
            vx + ((a + 0.5) / N - 0.5) * vw,
            vy + ((b + 0.5) / N - 0.5) * vh,
            cam.yaw,
            cam.pitch,
          );
          if (covered(p.x, p.y)) continue;
          // 이미 고른 지점과 같은 칸이면 건너뛴다 — 같은 칸을 두 번 요청하지 않는다.
          if (
            picks.some(
              q => Math.abs(p.x - q.x) <= half && Math.abs(p.y - q.y) <= half,
            )
          )
            continue;
          picks.push({
            x: p.x,
            y: p.y,
            d: Math.hypot(p.x - center.x, p.y - center.y),
          });
        }
      }
      if (!picks.length) return;
      picks.sort((a, b) => a.d - b.d);
      for (const pick of picks.slice(0, free))
        requestCell(pick.x, pick.y, budget);
    }, 400); // 이동이 멎은 뒤에 받는다 — 지나가는 칸마다 받으면 Overpass 를 두들긴다
    return () => clearTimeout(timer);
  }, [
    cam.panX,
    cam.panY,
    cam.yaw,
    cam.pitch,
    cam.zoom,
    cells,
    data,
    geom,
    retryTick,
    requestCell,
  ]);

  if (loading)
    return (
      <div className={s.state}>
        <Loading label="건물 외곽선 불러오는 중…" />
      </div>
    );
  if (error) {
    // 좌표가 없는 단지(전체 8,748 중 3개)는 다시 시도해도 소용없다 — 재시도 버튼을 주지 않는다.
    const noCoord = /no coordinates/i.test(error);
    return (
      <div className={s.state}>
        <ErrorState
          title={
            noCoord ? '이 단지는 좌표가 없습니다' : '배치도를 만들지 못했습니다'
          }
          desc={
            noCoord
              ? '주소를 좌표로 바꾸지 못한 단지라 배치도를 그릴 수 없습니다. 실거래·시세 정보는 위에서 그대로 보실 수 있습니다.'
              : `${error} · 건물 외곽선은 OpenStreetMap 에서 가져옵니다(공용 서버라 일시적으로 막힐 수 있습니다).`
          }
          onRetry={noCoord ? undefined : () => setTick(t => t + 1)}
        />
      </div>
    );
  }
  if (!geom) {
    return (
      <div className={s.state}>
        <EmptyState
          title="이 단지 주변의 건물 외곽선이 없습니다"
          desc="OpenStreetMap 에 등록된 건물이 반경 150m 안에 없습니다. 신축 단지에서 자주 있는 일입니다."
        />
      </div>
    );
  }

  const near = geom.solids.filter(x => x.near);
  const estimated = near.filter(x => x.estimated).length;

  return (
    <div className={s.wrap}>
      <div className={s.canvas}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className={[s.svg, large && s.svgLarge, dragging && s.svgDragging]
            .filter(Boolean)
            .join(' ')}
          tabIndex={0}
          role="application"
          aria-label={`${data?.aptNm ?? ''} 단지 배치도 — 건물 ${geom.solids.length}동. 드래그로 회전, 시프트 드래그와 방향키로 이동, 오른쪽 드래그·휠·플러스마이너스로 확대, 쉼표와 마침표로 고도`}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={stopAll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={e => e.preventDefault()}
        >
          {sceneNodes}

          {/* 큰길 이름 — 지면 위, 건물 아래. 길 위에 얹혀야 어느 길인지 읽힌다. */}
          {labels.roads.map(r => (
            <text
              key={r.name}
              x={r.sx}
              y={r.sy}
              className={s.roadName}
              textAnchor="middle"
            >
              {r.name}
            </text>
          ))}

          {/* 인프라 아이콘 — 주석이지 지형이 아니므로 건물 위에 그린다. */}
          {labels.pois.map(p => (
            <g
              key={p.key}
              transform={`translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})`}
              className={p.kind === 'station' ? `${s.poi} ${s.poiKey}` : s.poi}
            >
              <circle r={8.5} className={s.poiBg} />
              <path d={POI_GLYPH[p.kind]} className={s.poiGlyph} />
              {p.name && (
                <text x={12} y={3.4} className={s.poiName}>
                  {p.name}
                </text>
              )}
              <title>{`${POI_LABEL[p.kind]}${p.name ? ` · ${p.name}` : ''}`}</title>
            </g>
          ))}
        </svg>

        {offView && (
          <button
            type="button"
            className={s.recenter}
            onClick={() => setCam(c => ({ ...c, panX: 0, panY: 0 }))}
          >
            ← {data?.aptNm ?? '이 단지'}로
          </button>
        )}

        {/* 배율·시점 표시 — 돌리고 당기는 동안 지금 어디에 있는지 숫자로 확인할 수 있어야 한다. */}
        <div className={s.hud}>
          <button
            type="button"
            className={s.hudBtn}
            onClick={() =>
              setCam(c => ({ ...c, zoom: clampZoom(c.zoom / 1.25) }))
            }
            aria-label="축소"
            disabled={cam.zoom <= ZOOM_MIN + 1e-6}
          >
            −
          </button>
          <span className={`${s.hudZoom} mono`}>
            {cam.zoom.toFixed(cam.zoom < 1 ? 2 : 1)}×
          </span>
          <button
            type="button"
            className={s.hudBtn}
            onClick={() =>
              setCam(c => ({ ...c, zoom: clampZoom(c.zoom * 1.25) }))
            }
            aria-label="확대"
            disabled={cam.zoom >= ZOOM_MAX - 1e-6}
          >
            +
          </button>

          {/* 회전·고도 버튼 — 터치에서는 세로 드래그가 페이지 스크롤이라 고도를 바꿀 방법이 없고,
              키보드만 쓰는 사람도 캔버스에 들어가지 않고 시점을 돌릴 수 있어야 한다. */}
          <span className={s.hudSep} />
          <button
            type="button"
            className={s.hudBtn}
            onClick={() => setCam(c => ({ ...c, yaw: wrapYaw(c.yaw - 15) }))}
            aria-label="왼쪽으로 회전"
          >
            ↺
          </button>
          <button
            type="button"
            className={s.hudBtn}
            onClick={() => setCam(c => ({ ...c, yaw: wrapYaw(c.yaw + 15) }))}
            aria-label="오른쪽으로 회전"
          >
            ↻
          </button>
          <button
            type="button"
            className={s.hudBtn}
            onClick={() =>
              setCam(c => ({ ...c, pitch: clampPitch(c.pitch + 10) }))
            }
            aria-label="위에서 보기"
            disabled={cam.pitch >= PITCH_MAX - 1e-6}
          >
            ⌃
          </button>
          <button
            type="button"
            className={s.hudBtn}
            onClick={() =>
              setCam(c => ({ ...c, pitch: clampPitch(c.pitch - 10) }))
            }
            aria-label="눈높이로 보기"
            disabled={cam.pitch <= PITCH_MIN + 1e-6}
          >
            ⌄
          </button>

          <span className={`${s.hudView} mono`}>
            {Math.round(cam.yaw)}° · {Math.round(cam.pitch)}°
          </span>
        </div>

        {/* 나침반 — 회전해도 방위를 잃지 않게. 좌표계와 무관한 화면 고정 오버레이라 SVG 밖에 둔다. */}
        <svg className={s.compass} viewBox="-14 -14 28 28" aria-hidden="true">
          <circle r="13" className={s.compassBg} />
          <g transform={`rotate(${northDeg.toFixed(1)})`}>
            <path
              d="M 0 -9 L 3.4 2.2 L 0 0.2 L -3.4 2.2 Z"
              className={s.needle}
            />
          </g>
          <text y="11" textAnchor="middle" className={s.compassLabel}>
            N
          </text>
        </svg>
      </div>

      <div className={s.sunBar}>
        <Segmented
          options={SUN_PRESETS.map(p => ({ value: p.key, label: p.label }))}
          value={preset}
          onChange={v => setPreset(v as SunPresetKey)}
        />
        <input
          className={s.slider}
          type="range"
          min={6}
          max={19}
          step={0.5}
          value={hour}
          onChange={e => setHour(Number(e.target.value))}
          aria-label="시각"
        />
        <span className={`${s.sunInfo} mono`}>
          {String(Math.floor(hour)).padStart(2, '0')}:{hour % 1 ? '30' : '00'}
          {sun &&
            (sun.altitude > 0
              ? ` · 고도 ${sun.altitude.toFixed(0)}° ${compass(sun.azimuth)}`
              : ' · 일몰 후')}
        </span>
      </div>

      <div className={s.legend}>
        <span className={s.legendNear}>이 단지 {near.length}동</span>
        <span className={s.legendFar}>
          주변 {geom.solids.length - near.length}동
        </span>
        {cells.length > 0 && (
          <span className={s.legendNote}>+{cells.length}개 구역</span>
        )}
        <span className={s.legendHint}>
          드래그 회전 · <kbd>Shift</kbd>+드래그 이동 · <kbd>우클릭</kbd>·
          <kbd>Alt</kbd>+드래그 확대 · 휠 확대는 <kbd>클릭 후</kbd> 또는{' '}
          <kbd>Ctrl</kbd>+휠 · <kbd>0</kbd> 제자리
        </span>
        {streaming && (
          <span className={s.streamNote}>
            <Spinner size={11} /> 주변 불러오는 중
          </span>
        )}
        {!streaming && streamErr && (
          <span className={s.streamWarn} title={streamErr}>
            주변을 못 받았습니다 · 잠시 후 자동 재시도
          </span>
        )}
        <span className={s.legendNote}>
          외곽선 OpenStreetMap · 층수 OSM 우선 · 그림자는 태양 궤도 계산(층고
          2.8m 가정)
          {estimated > 0 && `, ${estimated}동은 실거래 최고층으로 추정(*)`}
        </span>
      </div>
    </div>
  );
}
