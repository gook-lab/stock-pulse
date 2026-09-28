import { describe, it, expect } from 'vitest';
import {
  cellBudget,
  levelOfDetail,
  clampZoom,
  dragMode,
  dragZoomFactor,
  boxesOverlap,
  dedupePois,
} from './siteMapView';

describe('clampZoom — 배율 한계', () => {
  it('범위를 벗어나지 않는다', () => {
    expect(clampZoom(0.01)).toBeCloseTo(0.3);
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(2)).toBe(2);
  });
});

describe('cellBudget — 축소하면 더 많은 구역을 받는다', () => {
  it('축소할수록 상한이 커진다 — 고정값이면 가장자리가 영원히 빈다', () => {
    expect(cellBudget(0.3)).toBeGreaterThan(cellBudget(1));
    expect(cellBudget(1)).toBeGreaterThan(cellBudget(4));
  });

  it('무한정 커지지는 않는다 — 메모리와 Overpass 예산이 있다', () => {
    expect(cellBudget(0.01)).toBeLessThanOrEqual(56);
  });

  it('확대해도 최소한은 유지한다 — 화면 밖으로 나갔다 오면 다시 받아야 하니까', () => {
    expect(cellBudget(8)).toBeGreaterThanOrEqual(10);
  });

  it('기본 배율에서는 기존과 같은 14칸', () => {
    expect(cellBudget(1)).toBe(16);
  });
});

describe('levelOfDetail — 축소하면 덜 그린다', () => {
  it('확대 상태에서는 전부 그린다', () => {
    const lod = levelOfDetail(1.5);
    expect(lod.shadows).toBe(true);
    expect(lod.paths).toBe(true);
    expect(lod.labels).toBe(true);
    expect(lod.minArea).toBe(0);
  });

  it('층 구분선은 이 단지가 먼저, 주변은 더 확대해야 — 선 수가 층수 × 벽 수로 늘어난다', () => {
    expect(levelOfDetail(1.2).floors).toBe(true);
    expect(levelOfDetail(1.2).farFloors).toBe(false);
    expect(levelOfDetail(2).farFloors).toBe(true);
    expect(levelOfDetail(0.9).floors).toBe(false);
  });

  it('외곽선은 확대했을 때만 — 멀리서는 덩어리로 읽혀야 한다', () => {
    expect(levelOfDetail(0.6).edges).toBe(false);
    expect(levelOfDetail(2).edges).toBe(true);
  });

  it('축소하면 그림자부터 끈다 — 볼록껍질이 가장 비싸다', () => {
    expect(levelOfDetail(0.5).shadows).toBe(false);
    expect(levelOfDetail(1).shadows).toBe(true);
  });

  it('많이 축소하면 보행로를 끄고 작은 건물을 버린다', () => {
    const far = levelOfDetail(0.35);
    expect(far.paths).toBe(false);
    expect(far.minArea).toBeGreaterThan(0);
  });

  it('축소할수록 최소 면적 기준이 커진다(단조)', () => {
    const zooms = [0.3, 0.5, 0.8, 1.5];
    const areas = zooms.map(z => levelOfDetail(z).minArea);
    for (let i = 1; i < areas.length; i++)
      expect(areas[i]).toBeLessThanOrEqual(areas[i - 1]);
  });
});

describe('dragMode — 드래그가 무엇을 하는가', () => {
  const none = {};

  it('맨 왼쪽 드래그는 회전 — 이 화면의 주된 행동', () => {
    expect(dragMode(0, none)).toBe('orbit');
  });

  it('Shift 나 가운데 버튼은 이동', () => {
    expect(dragMode(0, { shiftKey: true })).toBe('pan');
    expect(dragMode(1, none)).toBe('pan');
  });

  it('오른쪽 버튼이나 Alt 는 확대 — 3D 뷰어 관례', () => {
    expect(dragMode(2, none)).toBe('zoom');
    expect(dragMode(0, { altKey: true })).toBe('zoom');
    expect(dragMode(0, { metaKey: true })).toBe('zoom');
  });

  it('확대가 이동보다 우선 — Alt+Shift 를 같이 눌러도 하나로 정해진다', () => {
    expect(dragMode(0, { altKey: true, shiftKey: true })).toBe('zoom');
  });
});

describe('dragZoomFactor — 세로 드래그 → 배율', () => {
  it('위로 끌면 확대(1보다 큼), 아래로 끌면 축소', () => {
    expect(dragZoomFactor(-50)).toBeGreaterThan(1);
    expect(dragZoomFactor(50)).toBeLessThan(1);
  });

  it('움직이지 않으면 배율이 그대로', () => {
    expect(dragZoomFactor(0)).toBe(1);
  });

  it('올렸다 같은 만큼 내리면 제자리 — 곱셈이라 대칭이어야 한다', () => {
    expect(dragZoomFactor(-40) * dragZoomFactor(40)).toBeCloseTo(1, 10);
  });

  it('같은 픽셀이면 어느 배율에서든 같은 비율로 변한다', () => {
    const f = dragZoomFactor(-30);
    expect(clampZoom(1 * f) / 1).toBeCloseTo(clampZoom(2 * f) / 2, 6);
  });

  it('한 번에 과하게 튀지 않는다 — 100px 에 약 2배', () => {
    expect(dragZoomFactor(-100)).toBeGreaterThan(1.8);
    expect(dragZoomFactor(-100)).toBeLessThan(2.6);
  });
});

describe('boxesOverlap — 라벨 겹침 판정', () => {
  const b = (x: number, y: number, w = 20, h = 10) => ({ x, y, w, h });

  it('멀면 안 겹친다', () => {
    expect(boxesOverlap(b(0, 0), b(100, 0))).toBe(false);
  });

  it('가로로 반폭 합보다 가까우면 겹친다', () => {
    expect(boxesOverlap(b(0, 0), b(19, 0))).toBe(true);
    expect(boxesOverlap(b(0, 0), b(21, 0))).toBe(false);
  });

  it('세로도 같은 규칙', () => {
    expect(boxesOverlap(b(0, 0), b(0, 9))).toBe(true);
    expect(boxesOverlap(b(0, 0), b(0, 11))).toBe(false);
  });

  it('한 축만 겹치면 안 겹친 것 — 상자는 두 축 모두 겹쳐야 한다', () => {
    expect(boxesOverlap(b(0, 0), b(5, 100))).toBe(false);
  });

  it('대칭이다', () => {
    expect(boxesOverlap(b(0, 0), b(15, 5))).toBe(
      boxesOverlap(b(15, 5), b(0, 0)),
    );
  });
});

describe('dedupePois — 여러 칸에서 온 같은 시설 합치기', () => {
  const poi = (kind: any, name: string | null, x: number, y: number) => ({
    kind,
    name,
    x,
    y,
  });

  it('같은 종류·이름이 가까우면 하나로 — 인접 칸이 겹쳐 주는 경우', () => {
    const out = dedupePois([
      poi('school', '중앙초', 0, 0),
      poi('school', '중앙초', 10, 10),
    ]);
    expect(out).toHaveLength(1);
  });

  it('이름이 같아도 멀면 다른 시설이다', () => {
    const out = dedupePois([
      poi('school', '중앙초', 0, 0),
      poi('school', '중앙초', 500, 0),
    ]);
    expect(out).toHaveLength(2);
  });

  it('종류가 다르면 같은 자리라도 남긴다 — 역 위 상가 같은 경우', () => {
    const out = dedupePois([
      poi('station', '상도', 0, 0),
      poi('mart', '상도', 0, 0),
    ]);
    expect(out).toHaveLength(2);
  });

  it('먼저 온 것을 남긴다 — 단지 payload 가 셀보다 앞선다', () => {
    const out = dedupePois([
      poi('park', '공원', 0, 0),
      poi('park', '공원', 5, 5),
    ]);
    expect(out[0].x).toBe(0);
  });

  it('빈 입력은 빈 배열', () => {
    expect(dedupePois([])).toEqual([]);
  });
});
