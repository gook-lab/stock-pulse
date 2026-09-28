import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { heatColor, signColor, fmt } from '../../lib/colors';
import { treemap, type Rect } from '../../lib/treemap';
import type { HeatmapNode, HeatmapMarket } from '../../data/types';
import type { ColorMode } from '../../lib/colors';
import { Segmented } from '@/components/common';
import s from './Dashboard.module.css';

const MARKETS: { value: HeatmapMarket; label: string }[] = [
  { value: 'SP500', label: 'S&P 500' },
  { value: 'NASDAQ', label: '나스닥 100' },
  { value: 'KOSPI', label: '코스피' },
];
const priceFmt = (market: HeatmapMarket, price: number) =>
  market === 'KOSPI' ? `₩${fmt(price, 0)}` : `$${fmt(price, 2)}`;

// KOSPI 히트맵 종목명 → 법정 종목코드(KIS 실시세용)
const KOSPI_CODES: Record<string, string> = {
  삼성전자: '005930',
  SK하이닉스: '000660',
  LG에너지솔루션: '373220',
  삼성바이오로직스: '207940',
  삼성전자우: '005935',
  현대차: '005380',
  기아: '000270',
  셀트리온: '068270',
  POSCO홀딩스: '005490',
  NAVER: '035420',
  카카오: '035720',
  KB금융: '105560',
  신한지주: '055550',
  하나금융지주: '086790',
  삼성SDI: '006400',
  LG화학: '051910',
  현대모비스: '012330',
  삼성물산: '028260',
  SK이노베이션: '096770',
  LG전자: '066570',
  크래프톤: '259960',
  한화에어로스페이스: '012450',
  메리츠금융지주: '138040',
  HD현대중공업: '329180',
  'KT&G': '033780',
};

const W = 1000,
  H = 640,
  GAP = 2,
  SECLAB = 15,
  INDLAB = 11;

interface Placed {
  node: HeatmapNode;
  r: Rect;
}
type Group<T> = { name: string; items: T[]; total: number };

function groupBy<T>(
  arr: T[],
  key: (t: T) => string,
  weight: (t: T) => number,
): Group<T>[] {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = key(it);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return [...m.entries()].map(([name, items]) => ({
    name,
    items,
    total: items.reduce((a, b) => a + weight(b), 0),
  }));
}

// 심볼 시드 기반 결정적 스파크라인 포인트
function sparkPoints(sym: string, up: boolean, w = 40, h = 14): string {
  let seed = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const n = 16,
    vals: number[] = [];
  let v = 50;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    v += ((seed % 100) / 100 - 0.5) * 12 + (up ? 1.2 : -1.2);
    vals.push(v);
  }
  const mn = Math.min(...vals),
    mx = Math.max(...vals),
    rg = mx - mn || 1;
  return vals
    .map(
      (x, i) =>
        `${((i / (n - 1)) * w).toFixed(1)},${(h - ((x - mn) / rg) * (h - 2) - 1).toFixed(1)}`,
    )
    .join(' ');
}

export default function Heatmap() {
  const heatmap = useStore(st => st.heatmap);
  const mode = useStore(st => st.colorMode);
  const [market, setMarket] = useState<HeatmapMarket>('SP500');
  const [hover, setHover] = useState<HeatmapNode | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [quotes, setQuotes] = useState<
    Record<string, { price: number; changePct: number }>
  >({});
  const [failed, setFailed] = useState(false); // 실시세 연결 실패 → 색 죽이고 "-"
  /** 실시세를 실제로 받은 심볼. null = 아직 첫 응답 전(로딩).
   *  응답이 와도 여기 없는 심볼은 목 등락이 남은 타일이다 — 색·%를 그리면 실데이터로 오독된다
   *  (실측: KIS 스로틀 순간 삼성전자 실제 -3.44%가 목 -6.7%로 표시). RADIO #2. */
  const [liveSyms, setLiveSyms] = useState<Set<string> | null>(null);
  /** 실 시가총액(블록 크기). 전량 확보했을 때만 쓴다 — 일부만 실값이면 목 가중과 스케일이 섞여
   *  트리맵이 통째로 뒤틀린다. 단위는 시장 안에서만 일관되면 되므로(상대 비율) 환산하지 않는다. */
  const [weights, setWeights] = useState<Record<string, number> | null>(null);

  // 실시세 병합 — 미국은 Finnhub, KOSPI는 KIS(이름→코드).
  useEffect(() => {
    setQuotes({});
    setFailed(false);
    setLiveSyms(null);
    const marketNodes = heatmap.filter(n => n.market === market);
    if (!marketNodes.length) return;
    let alive = true;
    const ok = (r: Response) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    // 응답이 성공(200)이어도 스로틀 순간엔 값이 전부/일부 null이다. 받은 심볼만 live로 올리고,
    // 하나도 못 받았으면 실패와 동일하게 처리한다(빈 성공을 정상으로 취급하면 목이 화면에 남는다).
    const apply = (
      byName: Record<string, { price: number; changePct: number }>,
    ) => {
      const syms = Object.keys(byName);
      if (!syms.length) {
        setFailed(true);
        return;
      }
      setQuotes(byName);
      setLiveSyms(new Set(syms));
      setFailed(false);
    };
    const load = () => {
      if (market === 'KOSPI') {
        const codes = marketNodes
          .map(n => KOSPI_CODES[n.symbol])
          .filter(Boolean);
        fetch(`/api/kr/quotes?codes=${codes.join(',')}`)
          .then(ok)
          .then(
            (
              q: Record<string, { price: number; changePct: number } | null>,
            ) => {
              if (!alive) return;
              const byName: Record<
                string,
                { price: number; changePct: number }
              > = {};
              marketNodes.forEach(n => {
                const c = KOSPI_CODES[n.symbol];
                if (c && q[c])
                  byName[n.symbol] = {
                    price: q[c]!.price,
                    changePct: q[c]!.changePct,
                  };
              });
              apply(byName);
            },
          )
          .catch(() => {
            if (alive) setFailed(true);
          });
      } else {
        const syms = [...new Set(marketNodes.map(n => n.symbol))];
        fetch(`/api/heatmap/quotes?symbols=${syms.join(',')}`)
          .then(ok)
          .then(q => {
            if (alive) apply(q || {});
          })
          .catch(() => {
            if (alive) setFailed(true);
          });
      }
    };
    load();
    // 60초 폴링 — 1회성이면 히트맵이 하루 종일 첫 스냅샷에 얼어 있는다(소켓 감사 S3)
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [market, heatmap]);

  // 블록 크기: 실 시가총액(미국 Finnhub profile2 · 코스피 Daum). 목 weight는 폴백.
  useEffect(() => {
    setWeights(null);
    const marketNodes = heatmap.filter(n => n.market === market);
    if (!marketNodes.length) return;
    let alive = true;
    const ok = (r: Response) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    const apply = (bySymbol: Record<string, number>) => {
      if (!alive) return;
      // 한 종목이라도 빠지면 전부 목 가중을 쓴다(스케일 혼합 방지).
      setWeights(
        marketNodes.every(n => bySymbol[n.symbol] > 0) ? bySymbol : null,
      );
    };
    if (market === 'KOSPI') {
      fetch('/api/kr/top100?market=kospi')
        .then(ok)
        .then((rows: { code: string; marketCap?: number }[]) => {
          const byCode = new Map(rows.map(r => [r.code, r.marketCap]));
          const out: Record<string, number> = {};
          marketNodes.forEach(n => {
            const cap = byCode.get(KOSPI_CODES[n.symbol]);
            if (cap) out[n.symbol] = cap;
          });
          apply(out);
        })
        .catch(() => {
          /* 목 가중 유지 */
        });
    } else {
      const syms = [...new Set(marketNodes.map(n => n.symbol))];
      fetch(`/api/heatmap/weights?symbols=${syms.join(',')}`)
        .then(ok)
        .then((w: Record<string, number>) => apply(w || {}))
        .catch(() => {
          /* 목 가중 유지 */
        });
    }
    return () => {
      alive = false;
    };
  }, [market, heatmap]);

  const nodes = useMemo(
    () =>
      heatmap
        .filter(n => n.market === market)
        .map(n => {
          const q = quotes[n.symbol];
          const w = weights?.[n.symbol];
          if (!q && !w) return n;
          return {
            ...n,
            ...(q && { price: q.price, changePct: q.changePct }),
            ...(w && { weight: w }),
          };
        }),
    [heatmap, market, quotes, weights],
  );

  const { tiles, secLabels, indLabels } = useMemo(() => {
    const sectors = groupBy(
      nodes,
      n => n.sector,
      n => n.weight,
    ).sort((a, b) => b.total - a.total);
    const secRects = treemap(sectors, g => g.total, { x: 0, y: 0, w: W, h: H });
    const tiles: Placed[] = [];
    const secLabels: { name: string; r: Rect }[] = [];
    const indLabels: { name: string; r: Rect }[] = [];

    for (const sr of secRects) {
      const si: Rect = {
        x: sr.x + GAP,
        y: sr.y + GAP,
        w: sr.w - GAP * 2,
        h: sr.h - GAP * 2,
      };
      const secLab = si.w > 90 && si.h > 48;
      if (secLab) secLabels.push({ name: sr.item.name, r: si });
      const secInner: Rect = secLab
        ? { x: si.x, y: si.y + SECLAB, w: si.w, h: si.h - SECLAB }
        : si;

      const industries = groupBy(
        sr.item.items,
        n => n.industry,
        n => n.weight,
      ).sort((a, b) => b.total - a.total);
      const indRects = treemap(industries, g => g.total, secInner);
      for (const ir of indRects) {
        const ii: Rect = { x: ir.x + 1, y: ir.y + 1, w: ir.w - 2, h: ir.h - 2 };
        const indLab = ii.w > 74 && ii.h > 34;
        if (indLab) indLabels.push({ name: ir.item.name, r: ii });
        const indInner: Rect = indLab
          ? { x: ii.x, y: ii.y + INDLAB, w: ii.w, h: ii.h - INDLAB }
          : ii;
        const nodeRects = treemap(ir.item.items, n => n.weight, indInner);
        for (const nr of nodeRects) tiles.push({ node: nr.item, r: nr });
      }
    }
    return { tiles, secLabels, indLabels };
  }, [nodes]);

  const peers = useMemo(
    // 툴팁 동종 목록도 실시세 확보 종목만 — 목 숫자가 실값 옆에 나란히 서면 구별이 안 된다.
    () =>
      hover
        ? nodes
            .filter(
              n =>
                n.sector === hover.sector &&
                n.industry === hover.industry &&
                (!liveSyms || liveSyms.has(n.symbol)),
            )
            .sort((a, b) => b.weight - a.weight)
        : [],
    [hover, nodes, liveSyms],
  );

  /** 이 타일에 색·등락을 그려도 되나 — 실시세를 받은 심볼만 true. 로딩(null)·미수신은 회색 "-". */
  const isLive = (sym: string) =>
    !failed && liveSyms != null && liveSyms.has(sym);

  const pct = (v: number, base: number) => `${(v / base) * 100}%`;

  return (
    <section className="card">
      <div className="card-h">
        <span className="t">마켓 맵</span>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {/* 블록 크기가 실 시총인지 목 가중인지 밝힌다 — 크기는 이 화면의 핵심 정보다. */}
          <span
            className="tag"
            style={{ fontSize: 11, color: weights ? undefined : 'var(--warn)' }}
          >
            {weights ? '크기 = 실 시가총액' : '크기 = 목 가중'}
          </span>
          <Segmented options={MARKETS} value={market} onChange={setMarket} />
        </span>
      </div>
      <div
        className={s.tmap}
        style={{ aspectRatio: `${W} / ${H}` }}
        onMouseMove={e => setCursor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
      >
        {secLabels.map(l => (
          <div
            key={l.name}
            className={s.secLabel}
            style={{
              left: pct(l.r.x, W),
              top: pct(l.r.y, H),
              width: pct(l.r.w, W),
            }}
          >
            {l.name}
          </div>
        ))}
        {indLabels.map((l, i) => (
          <div
            key={l.name + i}
            className={s.indLabel}
            style={{
              left: pct(l.r.x, W),
              top: pct(l.r.y, H),
              width: pct(l.r.w, W),
            }}
          >
            {l.name}
          </div>
        ))}
        {tiles.map(({ node, r }) => {
          const ms = Math.min(r.w, r.h);
          // 폭·높이를 각각 본다. 좌표계는 1000×640 이고 실제 렌더 폭은 컨테이너에 비례하는데,
          // Comm./Energy 처럼 얇은 슬리버는 심볼 4~5자가 타일을 넘겨 잘려 나온다.
          // 잘린 글자는 정보가 아니라 소음이라 아예 숨기고 hover 툴팁에 맡긴다.
          const showSym = r.h > 20 && r.w > 34;
          const showPct = r.h > 34 && r.w > 46;
          const fontSym = Math.max(7, Math.min(15, ms * 0.24));
          const live = isLive(node.symbol);
          return (
            <div
              key={node.symbol}
              className={s.tmapTile}
              style={{
                left: pct(r.x + GAP / 2, W),
                top: pct(r.y + GAP / 2, H),
                width: pct(Math.max(0, r.w - GAP), W),
                height: pct(Math.max(0, r.h - GAP), H),
                background: live
                  ? heatColor(node.changePct, mode)
                  : 'var(--panel-2)',
              }}
              onMouseEnter={() => live && setHover(node)}
            >
              {showSym && (
                <span
                  className={s.tmapSym}
                  style={{
                    fontSize: `${fontSym}px`,
                    color: live ? undefined : 'var(--text-mut)',
                  }}
                >
                  {node.symbol}
                </span>
              )}
              {showPct && live && (
                <span
                  className={s.tmapPct}
                  style={{ fontSize: `${Math.max(7, fontSym * 0.72)}px` }}
                >
                  {node.changePct >= 0 ? '+' : ''}
                  {node.changePct.toFixed(1)}%
                </span>
              )}
              {showPct && !live && (
                <span
                  className={s.tmapPct}
                  style={{
                    fontSize: `${Math.max(7, fontSym * 0.72)}px`,
                    color: 'var(--text-mut)',
                  }}
                >
                  -
                </span>
              )}
            </div>
          );
        })}
        {hover && !failed && (
          <HeatTooltip
            node={hover}
            peers={peers}
            cursor={cursor}
            mode={mode}
            market={market}
          />
        )}
        {failed && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(10,13,20,0.55)',
              color: 'var(--text-mut)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            실시간 시세 연결 안됨
          </div>
        )}
      </div>
      <div className={s.legend}>
        <span>-3%</span>
        {[-3, -1.5, 0, 1.5, 3].map(p => (
          <span
            key={p}
            className={s.lbox}
            style={{ background: heatColor(p, mode) }}
          />
        ))}
        <span>+3%</span>
      </div>
    </section>
  );
}

function Spark({
  sym,
  up,
  mode,
}: {
  sym: string;
  up: boolean;
  mode: ColorMode;
}) {
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" className={s.htSpark}>
      <polyline
        points={sparkPoints(sym, up)}
        fill="none"
        stroke={signColor(up ? 1 : -1, mode)}
        strokeWidth="1"
      />
    </svg>
  );
}

function HeatTooltip({
  node,
  peers,
  cursor,
  mode,
  market,
}: {
  node: HeatmapNode;
  peers: HeatmapNode[];
  cursor: { x: number; y: number };
  mode: ColorMode;
  market: HeatmapMarket;
}) {
  const TW = 290,
    maxRows = 14;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const left = cursor.x + TW + 20 > vw ? cursor.x - TW - 14 : cursor.x + 14;
  const estH = 70 + Math.min(peers.length, maxRows) * 22;
  const top = Math.min(Math.max(12, cursor.y - 20), vh - estH - 12);
  return (
    <div className={s.htTip} style={{ left, top, width: TW }}>
      <div className={s.htHead}>
        {node.sector.toUpperCase()} · {node.industry.toUpperCase()}
      </div>
      <div className={s.htHero}>
        <span className={s.htHeroSym}>{node.symbol}</span>
        <Spark sym={node.symbol} up={node.changePct >= 0} mode={mode} />
        <span className={`${s.htHeroPx} mono`}>
          {priceFmt(market, node.price)}
        </span>
        <span
          className={`${s.htHeroChg} mono`}
          style={{ color: signColor(node.changePct, mode) }}
        >
          {node.changePct >= 0 ? '+' : ''}
          {node.changePct.toFixed(2)}%
        </span>
      </div>
      <div className={s.htRows}>
        {peers.slice(0, maxRows).map(p => (
          <div
            key={p.symbol}
            className={
              p.symbol === node.symbol ? `${s.htRow} ${s.htRowOn}` : s.htRow
            }
          >
            <span className={s.htSym}>{p.symbol}</span>
            <Spark sym={p.symbol} up={p.changePct >= 0} mode={mode} />
            <span className={`${s.htPx} mono`}>
              {priceFmt(market, p.price)}
            </span>
            <span
              className={`${s.htChg} mono`}
              style={{ color: signColor(p.changePct, mode) }}
            >
              {p.changePct >= 0 ? '+' : ''}
              {p.changePct.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
