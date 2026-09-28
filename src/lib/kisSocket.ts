// KIS 실시간 — 백엔드 소켓 게이트웨이(SSE) 소비판.
//  브라우저는 백엔드 /api/stream(SSE)에만 붙고, 백엔드가 KIS와 소켓 1개를 유지한다
//  (Toss/Upbit식 팬아웃). 탭마다 KIS 직결 → 재접속 폭주 문제를 서버로 흡수.
//  parseTrade/parseOrderbook는 골든 픽스처 계약용으로 유지(서버 파서와 필드 인덱스 동일).
import { useEffect, useState } from 'react';
import type { Candle } from '../data/types';

export interface Trade {
  code: string;
  time: string;
  price: number;
  changePct: number;
  volume: number;
  side: '매수' | '매도';
}
export interface Level {
  price: number;
  qty: number;
}
export interface Orderbook {
  code: string;
  asks: Level[];
  bids: Level[];
}
/** idle = 이 화면에 실시간 구독 코드가 없어 스트림을 열지 않은 상태 — 장애(disconnected)가 아니다.
 *  홈·뉴스 등 비구독 탭에서 '연결 끊김' 빨간 도트로 오독되던 것을 분리(실측 문의 2026-08-05). */
export type KisState = 'connected' | 'connecting' | 'disconnected' | 'idle';

const isKrCode = (c: string) => /^\d{6}$/.test(c);

class SseClient {
  private es: EventSource | null = null;
  private codes = new Map<string, number>(); // code -> refcount
  private tradeHandlers = new Map<string, Set<(t: Trade) => void>>();
  private obHandlers = new Map<string, Set<(o: Orderbook) => void>>();
  private stateCbs = new Set<(s: KisState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clientId: string | null = null; // 서버가 hello로 부여 — pagehide 비컨용
  state: KisState = 'idle';

  constructor() {
    // 페이지 이탈 시 sendBeacon — TCP close 감지를 기다리지 않고 서버가 KIS 구독 키를 즉시 회수.
    // (unload 계열에서 fetch는 취소될 수 있지만 sendBeacon은 브라우저가 전송을 보장)
    window.addEventListener('pagehide', () => {
      if (this.clientId)
        navigator.sendBeacon(`/api/stream/bye?id=${this.clientId}`);
    });
  }

  private setState(s: KisState) {
    this.state = s;
    this.stateCbs.forEach(cb => cb(s));
  }

  // 구독 코드 집합이 바뀌면 EventSource를 재생성(디바운스로 초기 마운트 배치).
  private scheduleReopen() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reopen(), 100);
  }
  private reopen() {
    // make-before-break: 새 스트림이 hello를 받은 뒤에 이전 스트림을 닫는다 —
    // 종목 전환 시 관심종목 등 나머지 코드의 체결이 끊기는 순단(감사 S6)을 제거.
    const codes = [...this.codes.keys()]; // 디바운스 후 실행 시점의 최신 집합
    const old = this.es;
    let oldClosed = false;
    const closeOld = () => {
      if (!oldClosed) {
        oldClosed = true;
        try {
          old?.close();
        } catch {
          /* noop */
        }
      }
    };
    if (!codes.length) {
      closeOld();
      this.es = null;
      this.setState('idle');
      return;
    }
    const es = new EventSource(`/api/stream?codes=${codes.join(',')}`);
    this.es = es;
    setTimeout(closeOld, 5000); // 새 스트림이 영영 못 열려도 이전 연결이 누수되지 않게
    es.addEventListener('hello', e => {
      this.clientId = JSON.parse((e as MessageEvent).data).id as string;
      closeOld();
    });
    es.addEventListener('state', e =>
      this.setState(JSON.parse((e as MessageEvent).data).state as KisState),
    );
    es.addEventListener('trade', e => {
      const t = JSON.parse((e as MessageEvent).data) as Trade;
      this.tradeHandlers.get(t.code)?.forEach(h => h(t));
    });
    es.addEventListener('orderbook', e => {
      const o = JSON.parse((e as MessageEvent).data) as Orderbook;
      this.obHandlers.get(o.code)?.forEach(h => h(o));
    });
    es.onerror = () => this.setState('connecting'); // EventSource가 자동 재접속
  }

  private addCode(code: string) {
    const n = (this.codes.get(code) || 0) + 1;
    this.codes.set(code, n);
    if (n === 1) this.scheduleReopen();
  }
  private removeCode(code: string) {
    const n = (this.codes.get(code) || 1) - 1;
    if (n <= 0) {
      this.codes.delete(code);
      this.scheduleReopen();
    } else this.codes.set(code, n);
  }

  onTrade(code: string, h: (t: Trade) => void) {
    let set = this.tradeHandlers.get(code);
    if (!set) {
      set = new Set();
      this.tradeHandlers.set(code, set);
    }
    set.add(h);
    this.addCode(code);
    return () => {
      set!.delete(h);
      if (!set!.size) this.tradeHandlers.delete(code);
      this.removeCode(code);
    };
  }
  onOrderbook(code: string, h: (o: Orderbook) => void) {
    let set = this.obHandlers.get(code);
    if (!set) {
      set = new Set();
      this.obHandlers.set(code, set);
    }
    set.add(h);
    this.addCode(code);
    return () => {
      set!.delete(h);
      if (!set!.size) this.obHandlers.delete(code);
      this.removeCode(code);
    };
  }
  onState(cb: (s: KisState) => void) {
    this.stateCbs.add(cb);
    cb(this.state);
    return () => {
      this.stateCbs.delete(cb);
    };
  }
}

let sse: SseClient | null = null;
const getSse = () => (sse ??= new SseClient());

// ---- 파서(계약 잠금, 서버 parseTradeFrame/parseOrderbookFrame과 동일) --------
export function parseTrade(f: string[]): Trade {
  const n = (s: string) => Number(s || 0);
  return {
    code: f[0],
    time: fmtTime(f[1]),
    price: n(f[2]),
    changePct: n(f[5]),
    volume: n(f[12]),
    side: f[21] === '5' ? '매도' : '매수',
  };
}
export function parseOrderbook(f: string[]): Orderbook {
  const n = (s: string) => Number(s || 0);
  const asks: Level[] = [],
    bids: Level[] = [];
  for (let i = 0; i < 5; i++) {
    asks.push({ price: n(f[3 + i]), qty: n(f[23 + i]) });
    bids.push({ price: n(f[13 + i]), qty: n(f[33 + i]) });
  }
  return { code: f[0], asks, bids };
}
function fmtTime(hms: string) {
  return hms && hms.length >= 6
    ? `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`
    : hms || '';
}

/** KR 종목 일/주/월봉 캔들 훅. code=null이면 비활성. */
export function useKrChart(code: string | null, period: 'D' | 'W' | 'M') {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    // 종목·주기 전환 시 이전 데이터 즉시 제거 — 새 조회가 KIS 게이트 큐에서 수 초 걸리는 동안
    // 이전 종목 캔들이 새 종목 이름 아래 그대로 렌더된다(실측: SK하이닉스에 삼성전자 차트·가격).
    setCandles([]);
    if (!code) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/kr/chart?code=${code}&period=${period}`)
      .then(r => r.json())
      .then((rows: Candle[]) => {
        if (alive) setCandles(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (alive) setCandles([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code, period]);
  return { candles, loading };
}

/** KR 일/주/월봉을 한 번에(1일~5년 탭용). code=null이면 비활성.
 *  reload: 조회 실패 시 화면의 재시도 버튼이 다시 받아오게 한다(KIS 스로틀은 일시적). */
export function useKrChartAll(code: string | null) {
  const [data, setData] = useState<{
    daily: Candle[];
    weekly: Candle[];
    monthly: Candle[];
  }>({ daily: [], weekly: [], monthly: [] });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // 종목 전환 시 이전 종목 일/주/월봉 즉시 제거(위 useKrChart와 같은 이유) —
    // lastClose 파생값이 이전 종목 종가로 남아 헤더 가격까지 오염시킨다.
    setData({ daily: [], weekly: [], monthly: [] });
    if (!code) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/kr/chart-all?code=${code}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive)
          setData({
            daily: d?.daily ?? [],
            weekly: d?.weekly ?? [],
            monthly: d?.monthly ?? [],
          });
      })
      .catch(() => {
        if (alive) setData({ daily: [], weekly: [], monthly: [] });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code, tick]);
  return { ...data, loading, reload: () => setTick(t => t + 1) };
}

/** KR 당일 분봉(1일 탭). 실거래량이 담긴 유일한 소스 — 합성 분할은 막대가 전부 같아진다.
 *  서버가 60초 캐시하므로 같은 주기로 갱신한다. code=null이면 비활성. */
export function useKrIntraday(code: string | null) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setCandles([]); // 종목 전환 시 이전 종목 분봉 즉시 제거(useKrChart와 같은 이유)
    if (!code) return;
    let alive = true;
    setLoading(true);
    const load = () =>
      fetch(`/api/kr/intraday?code=${code}`)
        .then(r => r.json())
        .then((rows: Candle[]) => {
          if (alive) setCandles(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          if (alive) setCandles([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    load();
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code]);
  return { candles, loading };
}

/** KIS 소켓 연결 여부(불리언). */
export function useKisConnected() {
  const [c, setC] = useState(false);
  useEffect(() => getSse().onState(st => setC(st === 'connected')), []);
  return c;
}

/** KIS 소켓 상태(connected/connecting/disconnected/idle) — AppBar 배지용. */
export function useKisState(): KisState {
  const [st, setSt] = useState<KisState>('idle');
  useEffect(() => getSse().onState(setSt), []);
  return st;
}

/** KR 종목 실시간 체결만 구독(관심종목/티커용). code=null/비국내면 비활성. */
export function useKisTrade(code: string | null) {
  const [trade, setTrade] = useState<Trade | null>(null);
  useEffect(() => {
    setTrade(null); // 종목 변경 시 이전 체결 즉시 제거(stale 방지)
    if (!code || !isKrCode(code)) return;
    return getSse().onTrade(code, setTrade);
  }, [code]);
  return trade;
}

/** KR 종목 실시간 체결/호가 훅. code=null/비국내면 비활성. */
export function useKisRealtime(code: string | null) {
  const [trade, setTrade] = useState<Trade | null>(null);
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const c = getSse();
    const offS = c.onState(st => setConnected(st === 'connected'));
    setTrade(null);
    setOrderbook(null); // 종목 변경 시 이전 종목 체결/호가 즉시 제거
    if (!code || !isKrCode(code))
      return () => {
        offS();
      };
    const offT = c.onTrade(code, setTrade);
    const offO = c.onOrderbook(code, setOrderbook);
    return () => {
      offT();
      offO();
      offS();
    };
  }, [code]);
  return { trade, orderbook, connected };
}
