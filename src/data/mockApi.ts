// M0 백엔드가 아직 없을 때 쓰는 목 구현. MarketApi 계약을 그대로 만족한다.
// 실백엔드가 준비되면 httpApi.ts로 교체하고 store의 import만 바꾼다.
import { mockComplexes, MOCK_GENERATED_AT, MOCK_DATA_MONTH } from './aptSeed';
import type {
  MarketApi,
  IndexQuote,
  HeatmapNode,
  FearGreed,
  MacroItem,
  WatchItem,
  NewsItem,
  AiOpinion,
  StockDetail,
  ChartPeriod,
  Level,
  TradeTick,
  Portfolio,
  Holding,
  Report,
  RankingItem,
  ScreenQuery,
  ScreenResult,
  KindSignals,
  PortfolioHistoryResult,
} from './types';

const spark = (up: boolean): number[] => {
  const base = up
    ? [22, 20, 21, 15, 16, 11, 12, 7, 4]
    : [5, 7, 6, 10, 11, 15, 14, 18, 21];
  return base;
};

const INDICES: IndexQuote[] = [
  {
    code: 'SPX',
    name: 'S&P 500',
    market: 'US',
    price: 5634.21,
    change: 34.72,
    changePct: 0.62,
    dec: 2,
    spark: spark(true),
  },
  {
    code: 'IXIC',
    name: 'Nasdaq',
    market: 'US',
    price: 18412.5,
    change: 166.1,
    changePct: 0.91,
    dec: 2,
    spark: spark(true),
  },
  {
    code: 'DJI',
    name: 'Dow Jones',
    market: 'US',
    price: 41220.4,
    change: 140.2,
    changePct: 0.34,
    dec: 2,
    spark: spark(true),
  },
  {
    code: 'KOSPI',
    name: 'KOSPI',
    market: 'KR',
    price: 2842.5,
    change: -12.9,
    changePct: -0.45,
    dec: 2,
    spark: spark(false),
  },
  {
    code: 'KOSDAQ',
    name: 'KOSDAQ',
    market: 'KR',
    price: 812.34,
    change: -7.2,
    changePct: -0.88,
    dec: 2,
    spark: spark(false),
  },
  {
    code: 'VIX',
    name: 'VIX 변동성',
    market: 'GL',
    price: 14.82,
    change: -0.49,
    changePct: -3.2,
    dec: 2,
    spark: spark(true),
  },
  {
    code: 'USDKRW',
    name: 'USD/KRW',
    market: 'GL',
    price: 1378.4,
    change: 5.5,
    changePct: 0.4,
    dec: 1,
    spark: spark(false),
  },
];

// Finviz 맵 스타일: 섹터 → 산업 그룹 → 종목. [sym, weight($B), pct, sector, industry, price]
type Row = readonly [string, number, number, string, string, number];
const mk = (
  rows: readonly Row[],
  market: HeatmapNode['market'],
): HeatmapNode[] =>
  rows.map(([symbol, weight, changePct, sector, industry, price]) => ({
    symbol,
    weight,
    changePct,
    sector,
    industry,
    price,
    market,
  }));

const SP500_ROWS = [
  // Technology
  ['NVDA', 3170, -1.56, 'Technology', 'Semiconductors', 208.76],
  ['AVGO', 780, -1.09, 'Technology', 'Semiconductors', 392.47],
  ['AMD', 230, -2.29, 'Technology', 'Semiconductors', 539.69],
  ['QCOM', 190, -2.57, 'Technology', 'Semiconductors', 171.11],
  ['TXN', 170, -3.13, 'Technology', 'Semiconductors', 284.99],
  ['INTC', 90, -2.33, 'Technology', 'Semiconductors', 100.23],
  ['MU', 130, 3.2, 'Technology', 'Semiconductors', 990.21],
  ['MSFT', 3300, -2.24, 'Technology', 'Software', 512.4],
  ['ORCL', 380, -1.4, 'Technology', 'Software', 188.1],
  ['CRM', 270, -0.6, 'Technology', 'Software', 268.3],
  ['ADBE', 240, -0.9, 'Technology', 'Software', 561.2],
  ['AAPL', 3480, -1.3, 'Technology', 'Consumer Electronics', 321.66],
  // Communication Services
  ['GOOGL', 2100, -7.13, 'Communication', 'Internet Content', 244.1],
  ['META', 1300, -3.36, 'Communication', 'Internet Content', 712.5],
  ['NFLX', 300, 0.53, 'Communication', 'Entertainment', 1180.2],
  ['DIS', 200, -3.17, 'Communication', 'Entertainment', 112.4],
  ['TMUS', 250, -0.7, 'Communication', 'Telecom', 232.1],
  ['VZ', 170, -1.06, 'Communication', 'Telecom', 43.2],
  // Consumer Cyclical
  ['AMZN', 2000, -4.57, 'Consumer Cyclical', 'Internet Retail', 218.4],
  ['TSLA', 780, -14.52, 'Consumer Cyclical', 'Auto', 319.69],
  ['HD', 380, -2.03, 'Consumer Cyclical', 'Home Improvement', 388.1],
  ['LOW', 150, -1.19, 'Consumer Cyclical', 'Home Improvement', 241.5],
  ['MCD', 210, -0.29, 'Consumer Cyclical', 'Restaurants', 298.7],
  ['NKE', 120, 0.6, 'Consumer Cyclical', 'Apparel', 78.4],
  // Healthcare
  ['LLY', 800, 1.97, 'Healthcare', 'Drug Manufacturers', 892.1],
  ['JNJ', 380, 1.42, 'Healthcare', 'Drug Manufacturers', 162.3],
  ['ABBV', 320, 1.43, 'Healthcare', 'Drug Manufacturers', 198.7],
  ['MRK', 300, 2.36, 'Healthcare', 'Drug Manufacturers', 118.2],
  ['PFE', 160, 0.77, 'Healthcare', 'Drug Manufacturers', 28.4],
  ['UNH', 480, -1.8, 'Healthcare', 'Healthcare Plans', 512.9],
  // Financial
  ['BRK.B', 900, 0.3, 'Financial', 'Diversified', 478.2],
  ['JPM', 620, 0.48, 'Financial', 'Banks', 268.1],
  ['BAC', 320, -0.55, 'Financial', 'Banks', 48.3],
  ['WFC', 220, -0.27, 'Financial', 'Banks', 78.9],
  ['V', 560, -0.52, 'Financial', 'Credit Services', 342.1],
  ['MA', 430, -0.32, 'Financial', 'Credit Services', 548.7],
  // Industrials
  ['GE', 240, 2.29, 'Industrials', 'Specialty', 218.4],
  ['RTX', 160, 7.33, 'Industrials', 'Aerospace & Defense', 168.2],
  ['BA', 130, 0.3, 'Industrials', 'Aerospace & Defense', 214.5],
  ['CAT', 180, 0.59, 'Industrials', 'Machinery', 428.1],
  ['HON', 140, 0.2, 'Industrials', 'Diversified', 218.7],
  ['UPS', 120, -1.7, 'Industrials', 'Logistics', 118.4],
  // Consumer Defensive
  ['WMT', 640, -0.85, 'Consumer Defensive', 'Discount Stores', 98.2],
  ['COST', 400, -0.14, 'Consumer Defensive', 'Discount Stores', 918.4],
  ['PG', 380, -1.45, 'Consumer Defensive', 'Household', 158.3],
  ['KO', 270, -1.25, 'Consumer Defensive', 'Beverages', 68.1],
  ['PEP', 230, -0.52, 'Consumer Defensive', 'Beverages', 148.7],
  // Energy
  ['XOM', 520, 1.58, 'Energy', 'Oil & Gas Integrated', 118.4],
  ['CVX', 300, 0.75, 'Energy', 'Oil & Gas Integrated', 168.2],
  ['COP', 130, 1.9, 'Energy', 'Oil & Gas E&P', 108.7],
  // Utilities
  ['NEE', 160, 0.42, 'Utilities', 'Regulated Electric', 78.2],
  ['SO', 100, 1.0, 'Utilities', 'Regulated Electric', 92.4],
  ['DUK', 90, 0.4, 'Utilities', 'Regulated Electric', 118.1],
  // Real Estate
  ['PLD', 110, -0.5, 'Real Estate', 'REIT', 118.2],
  ['AMT', 90, -0.9, 'Real Estate', 'REIT', 218.4],
  // Basic Materials
  ['LIN', 220, -0.46, 'Materials', 'Chemicals', 468.2],
  ['SHW', 90, -2.99, 'Materials', 'Specialty Chemicals', 342.1],
] as const satisfies readonly Row[];

// 나스닥 100 — 금융 제외, 기술·성장 중심 가중.
const NASDAQ_ROWS = [
  ['NVDA', 3170, -1.56, 'Technology', 'Semiconductors', 208.76],
  ['AVGO', 780, -1.09, 'Technology', 'Semiconductors', 392.47],
  ['AMD', 230, -2.29, 'Technology', 'Semiconductors', 539.69],
  ['QCOM', 190, -2.57, 'Technology', 'Semiconductors', 171.11],
  ['TXN', 170, -3.13, 'Technology', 'Semiconductors', 284.99],
  ['INTC', 90, -2.33, 'Technology', 'Semiconductors', 100.23],
  ['MU', 130, 3.2, 'Technology', 'Semiconductors', 990.21],
  ['AMAT', 150, -1.8, 'Technology', 'Semiconductors', 218.4],
  ['MSFT', 3300, -2.24, 'Technology', 'Software', 512.4],
  ['ADBE', 240, -0.9, 'Technology', 'Software', 561.2],
  ['CRM', 270, -0.6, 'Technology', 'Software', 268.3],
  ['INTU', 190, -0.4, 'Technology', 'Software', 648.1],
  ['PANW', 130, -2.65, 'Technology', 'Software', 388.2],
  ['CRWD', 110, -3.72, 'Technology', 'Software', 412.5],
  ['AAPL', 3480, -1.3, 'Technology', 'Consumer Electronics', 321.66],
  ['GOOGL', 2100, -7.13, 'Communication', 'Internet Content', 244.1],
  ['META', 1300, -3.36, 'Communication', 'Internet Content', 712.5],
  ['NFLX', 300, 0.53, 'Communication', 'Entertainment', 1180.2],
  ['TMUS', 250, -0.7, 'Communication', 'Telecom', 232.1],
  ['AMZN', 2000, -4.57, 'Consumer Cyclical', 'Internet Retail', 218.4],
  ['TSLA', 780, -14.52, 'Consumer Cyclical', 'Auto', 319.69],
  ['PDD', 190, 1.2, 'Consumer Cyclical', 'Internet Retail', 128.4],
  ['MELI', 110, 0.8, 'Consumer Cyclical', 'Internet Retail', 2180.5],
  ['COST', 400, -0.14, 'Consumer Defensive', 'Discount Stores', 918.4],
  ['PEP', 230, -0.52, 'Consumer Defensive', 'Beverages', 148.7],
  ['MDLZ', 90, 0.3, 'Consumer Defensive', 'Packaged Foods', 68.2],
  ['AMGN', 160, 1.49, 'Healthcare', 'Biotech', 312.4],
  ['GILD', 120, 0.77, 'Healthcare', 'Biotech', 98.1],
  ['ISRG', 180, -1.1, 'Healthcare', 'Medical Devices', 512.8],
  ['VRTX', 110, 0.9, 'Healthcare', 'Biotech', 448.2],
  ['HON', 140, 0.2, 'Industrials', 'Diversified', 218.7],
  ['CMCSA', 130, -1.2, 'Communication', 'Telecom', 38.4],
] as const satisfies readonly Row[];

// KOSPI — 국내 대형주. weight=시총(조원 근사), price=원, 섹터/산업 국문.
const KOSPI_ROWS = [
  ['삼성전자', 468, -6.67, '반도체', 'IT 대형주', 252000],
  ['SK하이닉스', 144, -7.03, '반도체', 'IT 대형주', 1784000],
  ['LG에너지솔루션', 90, -3.2, '2차전지', '에너지', 385000],
  ['삼성바이오로직스', 68, 1.4, '바이오', '헬스케어', 985000],
  ['삼성전자우', 42, -6.1, '반도체', 'IT 대형주', 208000],
  ['현대차', 52, 0.8, '자동차', '운송장비', 248000],
  ['기아', 38, 1.2, '자동차', '운송장비', 108500],
  ['셀트리온', 40, 2.1, '바이오', '헬스케어', 182000],
  ['POSCO홀딩스', 32, -2.4, '철강', '소재', 385000],
  ['NAVER', 34, -1.8, '인터넷', '서비스', 218000],
  ['카카오', 22, -2.6, '인터넷', '서비스', 48500],
  ['KB금융', 36, 0.5, '금융', '은행', 92800],
  ['신한지주', 30, 0.3, '금융', '은행', 58400],
  ['하나금융지주', 22, -0.4, '금융', '은행', 68200],
  ['삼성SDI', 24, -2.9, '2차전지', '에너지', 342000],
  ['LG화학', 26, -1.6, '화학', '소재', 384000],
  ['현대모비스', 20, 0.6, '자동차', '운송장비', 248000],
  ['삼성물산', 24, 0.2, '지주', '유통', 148000],
  ['SK이노베이션', 16, 1.1, '정유', '에너지', 118000],
  ['LG전자', 18, -1.2, '전자', 'IT 대형주', 98500],
  ['크래프톤', 18, 3.4, '게임', '서비스', 388000],
  ['한화에어로스페이스', 20, 5.2, '방산', '운송장비', 618000],
  ['메리츠금융지주', 18, 0.8, '금융', '보험', 118500],
  ['HD현대중공업', 16, 2.8, '조선', '운송장비', 428000],
  ['KT&G', 14, -0.6, '필수소비재', '유통', 108500],
] as const satisfies readonly Row[];

const HEATMAP: HeatmapNode[] = [
  ...mk(SP500_ROWS, 'SP500'),
  ...mk(NASDAQ_ROWS, 'NASDAQ'),
  ...mk(KOSPI_ROWS, 'KOSPI'),
];

const FEAR_GREED: FearGreed = {
  value: 62,
  label: '탐욕',
  prevWeek: 54,
  prevMonth: 41,
  prevYear: 73,
  updatedAt: '2026-07-24T05:30:00Z',
};

const CRYPTO_FG = {
  value: 28,
  label: '공포',
  updatedAt: '2026-07-24T00:00:00Z',
};

const MACRO: MacroItem[] = [
  { key: 'rate', name: '기준금리', value: '2.75%', changePct: 0, flat: true },
  { key: 'gb3y', name: '국고채 3년', value: '3.92%', changePct: 0, flat: true },
  { key: 'us10y', name: '美 국채 10Y', value: '4.28%', changePct: 0.7 },
  {
    key: 'usdkrw',
    name: '원/달러',
    value: '1,466.8',
    changePct: 0,
    flat: true,
  },
  {
    key: 'jpykrw',
    name: '원/엔(100)',
    value: '896.8',
    changePct: 0,
    flat: true,
  },
  { key: 'oil', name: 'WTI 유가', value: '$82.1', changePct: 1.8 },
  { key: 'gold', name: '금 · GLD', value: '$2,412', changePct: 0.4 },
  { key: 'btc', name: '비트코인', value: '$68,240', changePct: 2.6 },
];

// 관심종목 유니버스 — 가격·등락률은 httpApi에서 실시세(Finnhub/KIS)로 덮어쓰고,
// aiSignal도 실시간 등락 기반(모멘텀)으로 재계산한다. 아래 값은 폴백/초기값.
const WATCHLIST: WatchItem[] = [
  {
    code: 'AAPL',
    name: 'Apple',
    market: 'US',
    price: 227.34,
    changePct: 0.8,
    dec: 2,
    cur: '$',
    aiSignal: 'buy',
  },
  {
    code: 'NVDA',
    name: 'NVIDIA',
    market: 'US',
    price: 128.9,
    changePct: 2.9,
    dec: 2,
    cur: '$',
    aiSignal: 'buy',
  },
  {
    code: 'MSFT',
    name: 'Microsoft',
    market: 'US',
    price: 430.5,
    changePct: 0.5,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: 'GOOGL',
    name: 'Alphabet',
    market: 'US',
    price: 178.2,
    changePct: 0.7,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: 'AMZN',
    name: 'Amazon',
    market: 'US',
    price: 195.6,
    changePct: -0.7,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: 'META',
    name: 'Meta',
    market: 'US',
    price: 512.3,
    changePct: 1.2,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: 'TSLA',
    name: 'Tesla',
    market: 'US',
    price: 244.1,
    changePct: -1.9,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: 'AVGO',
    name: 'Broadcom',
    market: 'US',
    price: 168.0,
    changePct: -2.7,
    dec: 2,
    cur: '$',
    aiSignal: 'hold',
  },
  {
    code: '005930',
    name: '삼성전자',
    market: 'KR',
    price: 78400,
    changePct: -1.4,
    dec: 0,
    cur: '₩',
    aiSignal: 'hold',
  },
  {
    code: '000660',
    name: 'SK하이닉스',
    market: 'KR',
    price: 198500,
    changePct: -2.2,
    dec: 0,
    cur: '₩',
    aiSignal: 'sell',
  },
  {
    code: '373220',
    name: 'LG에너지솔루션',
    market: 'KR',
    price: 342000,
    changePct: -3.2,
    dec: 0,
    cur: '₩',
    aiSignal: 'hold',
  },
  {
    code: '035420',
    name: 'NAVER',
    market: 'KR',
    price: 168500,
    changePct: 0.6,
    dec: 0,
    cur: '₩',
    aiSignal: 'hold',
  },
];

const NEWS: NewsItem[] = [
  {
    id: 'n1',
    headline: '연준, 9월 금리 인하 시사 … 나스닥 사상 최고',
    summary: '파월 의장 발언 이후 위험자산 선호 강화. 기술주 중심 상승.',
    source: 'Reuters',
    minutesAgo: 12,
    tickers: ['SPX', 'IXIC'],
    sentiment: 'good',
    group: '오늘',
  },
  {
    id: 'n2',
    headline: '엔비디아, AI 칩 신규 수주 소식에 3% 상승',
    summary: '대형 클라우드 업체 발주 확대 보도. 반도체 섹터 동반 강세.',
    source: 'Bloomberg',
    minutesAgo: 38,
    tickers: ['NVDA'],
    sentiment: 'good',
    group: '오늘',
  },
  {
    id: 'n3',
    headline: '삼성전자 2분기 잠정실적 컨센 하회 … 외인 매도',
    summary: '메모리 회복 지연 우려. 외국인 순매도 지속.',
    source: '연합인포맥스',
    minutesAgo: 62,
    tickers: ['005930'],
    sentiment: 'bad',
    group: '오늘',
  },
  {
    id: 'n4',
    headline: '유가 배럴당 82달러 돌파, 에너지 섹터 강세',
    summary: '공급 차질 우려로 WTI 급등. 정유·에너지주 상승.',
    source: 'CNBC',
    minutesAgo: 120,
    tickers: ['XOM'],
    sentiment: 'neutral',
    group: '오늘',
  },
  {
    id: 'n5',
    headline: '테슬라, 로보택시 이벤트 앞두고 변동성 확대',
    summary: '기대와 우려 교차. 옵션 시장 변동성 상승.',
    source: 'CNBC',
    minutesAgo: 240,
    tickers: ['TSLA'],
    sentiment: 'neutral',
    group: '오늘',
  },
  {
    id: 'n6',
    headline: 'SK하이닉스 HBM 증설 계획 발표 … 목표가 상향',
    summary: '증권가 목표주가 잇단 상향. 중장기 실적 기대.',
    source: 'WSJ',
    minutesAgo: 1500,
    tickers: ['000660'],
    sentiment: 'good',
    group: '어제',
  },
  {
    id: 'n7',
    headline: '애플, 신형 아이폰 판매 호조 … 서비스 매출 사상 최대',
    summary: '중화권 회복. 서비스 부문 마진 개선.',
    source: 'Bloomberg',
    minutesAgo: 1600,
    tickers: ['AAPL'],
    sentiment: 'good',
    group: '어제',
  },
  {
    id: 'n8',
    headline: '미 소비자물가 예상 부합 … 시장 안도',
    summary: 'CPI 컨센서스 부합. 인하 기대 유지.',
    source: 'Reuters',
    minutesAgo: 1700,
    tickers: ['SPX'],
    sentiment: 'neutral',
    group: '어제',
  },
  {
    id: 'n9',
    headline: '원/달러 환율 1,380원 근접 … 수출주 온도차',
    summary: '강달러 지속. 수출주 환효과 vs 수입 부담 혼재.',
    source: '연합인포맥스',
    minutesAgo: 3200,
    tickers: ['USDKRW'],
    sentiment: 'neutral',
    group: '이번주',
  },
  {
    id: 'n10',
    headline: '반도체 업황 바닥 논쟁 … 기관 전망 엇갈려',
    summary: '사이클 저점 판단 상이. 종목별 차별화.',
    source: 'WSJ',
    minutesAgo: 4200,
    tickers: ['005930', '000660'],
    sentiment: 'bad',
    group: '이번주',
  },
];

const AI_OPINION: AiOpinion = {
  score: 64,
  stance: '위험선호 우위 — 탐욕 62, 미 지수 강세 vs 국내 약세',
  markets: [
    { name: '미국', strength: 72 },
    { name: '한국', strength: 43 },
    { name: '원자재', strength: 58 },
  ],
  bull: ['연준 금리 인하 기대', 'AI 반도체 수요 강세'],
  bear: ['국내 실적 부진·외인 매도', '환율 상승 부담'],
};

// --- 종목 상세 목 생성 -------------------------------------------------------

// 코드 → 안정적 시드(차트가 매 렌더 안 바뀌도록).
const seedOf = (code: string): number =>
  [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// 시드 기반 결정적 워크(면적차트용).
function walk(seed: number, n: number, drift: number): number[] {
  let s = seed,
    v = 50;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v += ((s % 100) / 100 - 0.5) * 8 + drift;
    out.push(v);
  }
  return out;
}

const DETAIL_META: Record<
  string,
  {
    name: string;
    market: 'KR' | 'US';
    cur: string;
    dec: number;
    price: number;
    pct: number;
    info: StockDetail['info'];
  }
> = {
  AAPL: {
    name: 'Apple',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 227.34,
    pct: 0.8,
    info: {
      marketCap: '$3.48T',
      per: 34.2,
      pbr: 51.1,
      eps: 6.64,
      div: '0.44%',
      volume: '48.2M',
    },
  },
  NVDA: {
    name: 'NVIDIA',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 128.9,
    pct: 2.9,
    info: {
      marketCap: '$3.17T',
      per: 65.4,
      pbr: 58.9,
      eps: 1.97,
      div: '0.03%',
      volume: '241M',
    },
  },
  TSLA: {
    name: 'Tesla',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 244.1,
    pct: -1.9,
    info: {
      marketCap: '$779B',
      per: 71.8,
      pbr: 12.4,
      eps: 3.4,
      div: '—',
      volume: '92.1M',
    },
  },
  '005930': {
    name: '삼성전자',
    market: 'KR',
    cur: '₩',
    dec: 0,
    price: 78400,
    pct: -1.4,
    info: {
      marketCap: '468조',
      per: 12.8,
      pbr: 1.32,
      eps: 6120,
      div: '2.1%',
      volume: '11.4M',
    },
  },
  '000660': {
    name: 'SK하이닉스',
    market: 'KR',
    cur: '₩',
    dec: 0,
    price: 198500,
    pct: -2.2,
    info: {
      marketCap: '144조',
      per: 9.4,
      pbr: 1.71,
      eps: 21100,
      div: '1.1%',
      volume: '3.8M',
    },
  },
  MSFT: {
    name: 'Microsoft',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 430.5,
    pct: 0.5,
    info: {
      marketCap: '$3.20T',
      per: 37.1,
      pbr: 12.8,
      eps: 11.6,
      div: '0.72%',
      volume: '18.4M',
    },
  },
  GOOGL: {
    name: 'Alphabet',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 178.2,
    pct: 0.7,
    info: {
      marketCap: '$2.19T',
      per: 24.6,
      pbr: 6.9,
      eps: 7.24,
      div: '0.48%',
      volume: '24.1M',
    },
  },
  META: {
    name: 'Meta',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 512.3,
    pct: 1.2,
    info: {
      marketCap: '$1.30T',
      per: 27.4,
      pbr: 8.2,
      eps: 18.7,
      div: '0.40%',
      volume: '12.7M',
    },
  },
  AVGO: {
    name: 'Broadcom',
    market: 'US',
    cur: '$',
    dec: 2,
    price: 168.0,
    pct: -2.7,
    info: {
      marketCap: '$785B',
      per: 62.1,
      pbr: 12.1,
      eps: 2.7,
      div: '1.20%',
      volume: '22.5M',
    },
  },
  '373220': {
    name: 'LG에너지솔루션',
    market: 'KR',
    cur: '₩',
    dec: 0,
    price: 342000,
    pct: -3.2,
    info: {
      marketCap: '80조',
      per: 44.2,
      pbr: 3.1,
      eps: 7740,
      div: '0.1%',
      volume: '0.4M',
    },
  },
  '035420': {
    name: 'NAVER',
    market: 'KR',
    cur: '₩',
    dec: 0,
    price: 168500,
    pct: 0.6,
    info: {
      marketCap: '27조',
      per: 18.9,
      pbr: 1.2,
      eps: 8910,
      div: '0.9%',
      volume: '0.7M',
    },
  },
};

function buildDetail(code: string): StockDetail {
  // DETAIL_META 우선, 없으면 관심종목에서 이름/마켓을 끌어와 합성(코드-이름 불일치 방지).
  const wl = WATCHLIST.find(w => w.code === code);
  const m =
    DETAIL_META[code] ??
    (wl
      ? {
          name: wl.name,
          market: wl.market,
          cur: wl.cur,
          dec: wl.dec,
          price: wl.price,
          pct: wl.changePct,
          info: {
            marketCap: '—',
            per: 0,
            pbr: 0,
            eps: 0,
            div: '—',
            volume: '—',
          },
        }
      : DETAIL_META['005930']);
  const seed = seedOf(code);
  const price = m.price;
  const change = +(price * (m.pct / 100)).toFixed(m.dec);
  const step =
    m.dec === 0
      ? Math.max(10, Math.round(price * 0.0005))
      : +(price * 0.0006).toFixed(m.dec);

  // 호가: 현재가 위 5 매도 / 아래 5 매수
  const asks: Level[] = Array.from({ length: 5 }, (_, i) => ({
    price: +(price + step * (i + 1)).toFixed(m.dec),
    qty: 200 + ((seed >> (i + 1)) % 900),
  }));
  const bids: Level[] = Array.from({ length: 5 }, (_, i) => ({
    price: +(price - step * (i + 1)).toFixed(m.dec),
    qty: 200 + ((seed >> (i + 2)) % 900),
  }));

  const trades: TradeTick[] = Array.from({ length: 18 }, (_, i) => {
    const s = (seed + i * 97) & 0x7fffffff;
    const dp = ((s % 5) - 2) * step;
    return {
      time: `1${4 + (i % 5)}:${String(59 - i).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
      price: +(price + dp).toFixed(m.dec),
      qty: 1 + (s % 400),
      side: s % 2 === 0 ? '매수' : '매도',
    };
  });

  const chart: Record<ChartPeriod, number[]> = {
    '1D': walk(seed, 40, m.pct / 60),
    '1W': walk(seed + 1, 40, m.pct / 40),
    '1M': walk(seed + 2, 44, m.pct / 20),
    '1Y': walk(seed + 3, 52, m.pct / 8),
  };

  const low52 = +(price * 0.72).toFixed(m.dec);
  const high52 = +(price * 1.24).toFixed(m.dec);
  const target = +(price * (1 + (m.pct >= 0 ? 0.14 : 0.06))).toFixed(m.dec);
  const upsidePct = +(((target - price) / price) * 100).toFixed(1);

  return {
    code,
    name: m.name,
    market: m.market,
    cur: m.cur,
    dec: m.dec,
    price,
    change,
    changePct: m.pct,
    low52,
    high52,
    chart,
    asks,
    bids,
    trades,
    ai: {
      score: m.pct >= 0 ? 68 : 44,
      target,
      upsidePct,
      bull:
        m.pct >= 0
          ? ['실적 모멘텀 지속', '섹터 자금 유입']
          : ['밸류에이션 매력 구간', '배당 하방 지지'],
      bear:
        m.pct >= 0
          ? ['단기 과열 부담', '금리 변수']
          : ['외인 매도 지속', '업황 둔화 우려'],
    },
    info: m.info,
  };
}

// --- 포트폴리오 ---------------------------------------------------------------

const FX_USDKRW = 1378.4;

const HOLDINGS: Holding[] = [
  {
    code: 'AAPL',
    name: 'Apple',
    market: 'US',
    qty: 30,
    avg: 198.4,
    price: 227.34,
    cur: '$',
    dec: 2,
  },
  {
    code: 'NVDA',
    name: 'NVIDIA',
    market: 'US',
    qty: 40,
    avg: 102.1,
    price: 128.9,
    cur: '$',
    dec: 2,
  },
  {
    code: 'TSLA',
    name: 'Tesla',
    market: 'US',
    qty: 15,
    avg: 262.0,
    price: 244.1,
    cur: '$',
    dec: 2,
  },
  {
    code: '005930',
    name: '삼성전자',
    market: 'KR',
    qty: 200,
    avg: 71200,
    price: 78400,
    cur: '₩',
    dec: 0,
  },
  {
    code: '000660',
    name: 'SK하이닉스',
    market: 'KR',
    qty: 30,
    avg: 176000,
    price: 198500,
    cur: '₩',
    dec: 0,
  },
];

function buildPortfolio(): Portfolio {
  const krw = (h: Holding, p: number) =>
    h.market === 'US' ? p * FX_USDKRW : p;
  let totalValue = 0,
    principal = 0,
    dayPnl = 0;
  for (const h of HOLDINGS) {
    const valNow = krw(h, h.price) * h.qty;
    const cost = krw(h, h.avg) * h.qty;
    // 일간 손익은 종목 등락률(상세 메타)에서 근사.
    const meta = DETAIL_META[h.code];
    const dayPct = meta ? meta.pct : 0;
    totalValue += valNow;
    principal += cost;
    dayPnl += valNow * (dayPct / (100 + dayPct));
  }
  const pnl = totalValue - principal;
  return {
    fxUsdKrw: FX_USDKRW,
    summary: {
      totalValue: Math.round(totalValue),
      pnl: Math.round(pnl),
      pnlPct: +((pnl / principal) * 100).toFixed(2),
      dayPnl: Math.round(dayPnl),
      dayPnlPct: +((dayPnl / totalValue) * 100).toFixed(2),
      principal: Math.round(principal),
    },
    holdings: HOLDINGS,
  };
}

// --- 리서치 -------------------------------------------------------------------

const RESEARCH: Report[] = [
  {
    code: 'NVDA',
    name: 'NVIDIA',
    stance: 'buy',
    confidence: 82,
    date: '2026-07-24',
    cur: '$',
    dec: 2,
    price: 128.9,
    target: 158,
    upsidePct: 22.6,
    per: 65.4,
    pbr: 58.9,
    marketCap: '$3.17T',
    summary:
      'AI 가속기 수요 사이클의 중심. 데이터센터 매출 성장률이 컨센서스를 상회할 여지.',
    points: [
      '차세대 아키텍처 선점',
      '소프트웨어 생태계 락인',
      '데이터센터 capex 확대 수혜',
    ],
    risks: ['밸류에이션 부담', '경쟁사 추격', '수출 규제 변수'],
  },
  {
    code: 'AAPL',
    name: 'Apple',
    stance: 'buy',
    confidence: 70,
    date: '2026-07-23',
    cur: '$',
    dec: 2,
    price: 227.34,
    target: 259,
    upsidePct: 13.9,
    per: 34.2,
    pbr: 51.1,
    marketCap: '$3.48T',
    summary:
      '서비스 매출 마진 개선과 설치 기반 확대. 하드웨어 교체 수요 안정적.',
    points: ['서비스 고마진 성장', '견고한 현금흐름', '자사주 매입'],
    risks: ['중화권 수요 변동', '규제 리스크'],
  },
  {
    code: '005930',
    name: '삼성전자',
    stance: 'hold',
    confidence: 58,
    date: '2026-07-23',
    cur: '₩',
    dec: 0,
    price: 78400,
    target: 83000,
    upsidePct: 5.9,
    per: 12.8,
    pbr: 1.32,
    marketCap: '468조',
    summary:
      '메모리 업황 회복 지연. 밸류에이션 매력은 있으나 단기 모멘텀 제한적.',
    points: ['낮은 밸류에이션', 'HBM 경쟁력 회복 여지', '배당 하방 지지'],
    risks: ['외인 매도 지속', '업황 둔화', '환율 변수'],
  },
  {
    code: '000660',
    name: 'SK하이닉스',
    stance: 'buy',
    confidence: 75,
    date: '2026-07-22',
    cur: '₩',
    dec: 0,
    price: 198500,
    target: 245000,
    upsidePct: 23.4,
    per: 9.4,
    pbr: 1.71,
    marketCap: '144조',
    summary: 'HBM 증설과 가격 협상력. 메모리 사이클 반등 시 이익 레버리지 큼.',
    points: ['HBM 시장 선점', '이익 레버리지', '증설 로드맵'],
    risks: ['사이클 변동성', '고객 집중도'],
  },
];

// --- 서울 전세 목(백엔드 미기동 시 폴백) ------------------------------------
const SEOUL_RENT: import('./types').SeoulRent = (() => {
  const rows: [string, number, number][] = [
    ['종로구', 7.13, 9.1],
    ['중구', 6.2, 1.2],
    ['용산구', 9.07, -4.4],
    ['성동구', 7.95, 3.5],
    ['광진구', 7.63, 0.3],
    ['동대문구', 5.1, 1.0],
    ['중랑구', 4.2, -0.5],
    ['성북구', 5.3, 0.8],
    ['강북구', 3.9, 0.2],
    ['도봉구', 3.7, -0.3],
    ['노원구', 3.8, 0.5],
    ['은평구', 4.6, 1.1],
    ['서대문구', 5.4, 0.6],
    ['마포구', 7.02, 0.0],
    ['양천구', 5.6, -0.4],
    ['강서구', 4.9, 0.7],
    ['구로구', 4.5, 0.3],
    ['금천구', 4.3, -0.2],
    ['영등포구', 6.1, 1.4],
    ['동작구', 6.4, 0.9],
    ['관악구', 4.7, 0.1],
    ['서초구', 9.8, 2.1],
    ['강남구', 10.45, 10.4],
    ['송파구', 8.2, 1.7],
    ['강동구', 6.0, 0.8],
  ];
  const districts = rows.map(([name, eok, chg]) => ({
    name,
    code: '',
    avgManwon: Math.round(eok * 10000),
    avgEok: eok,
    count: 100,
    changePct: chg,
  }));
  const avgEok = +(
    districts.reduce((s, d) => s + d.avgEok, 0) / districts.length
  ).toFixed(2);
  return {
    month: '202606',
    avgManwon: Math.round(avgEok * 10000),
    avgEok,
    districts,
  };
})();

// 실백엔드처럼 보이도록 약간의 지연을 흉내낸다.
const delay = <T>(v: T, ms = 120): Promise<T> =>
  new Promise(r => setTimeout(() => r(v), ms));

/* ── 부동산 스크리너 목 ─────────────────────────────────────────────────────
   시그널 값은 전부 가짜다. 응답에 source:'mock' 을 실어 화면이 배지를 띄우게 한다.
   순위 로직은 server/realestate/index.mjs 의 screen() 과 동일한 규칙을 따른다
   (null 은 모집단에서 제외, minDeals 미만 제외).                              */
const MOCK_COMPLEXES = mockComplexes();

function mockScreen(q: ScreenQuery): ScreenResult {
  const {
    signal,
    dealType,
    minDeals,
    gu = [],
    areaTier = null,
    sortDir = 'desc',
  } = q;
  let pool = MOCK_COMPLEXES;
  if (gu.length) pool = pool.filter(c => c.gu != null && gu.includes(c.gu));
  if (areaTier) pool = pool.filter(c => c.areaTier === areaTier);

  const valueOf = (c: (typeof pool)[number]) =>
    signal === 'jeonseRatio'
      ? c.signals.jeonseRatio
      : (c.signals[dealType][signal as keyof KindSignals] as number | null);

  const total = pool.length;
  const eligible = pool.filter(
    c => c.signals[dealType].dealCount >= minDeals && valueOf(c) != null,
  );
  const dir = sortDir === 'asc' ? 1 : -1;
  // 기준월 평당가 — 서버 attachPrices 와 같은 규칙(기준월 = 3개월 전, 직전 유효값 backfill)
  const basisPrice = (c: (typeof pool)[number]): number | null => {
    const series = c.series[dealType === 'trade' ? 't' : 'r'];
    for (let i = Math.min(series.length - 3, series.length - 1); i >= 0; i--) {
      if (series[i][0] != null) return Math.round(series[i][0] as number);
    }
    return null;
  };

  // 지도 라벨용 대표 거래 — 목은 rep 이 없으니 평형대 중심값 × 평당가로 총액을 만든다(서버와 같은 표기 재료).
  const AREA_OF: Record<string, number> = {
    '~60': 59,
    '60~85': 84,
    '85~135': 114,
    '135~': 145,
  };
  const repOf = (c: (typeof pool)[number]) => {
    const ppy = basisPrice(c);
    const area = AREA_OF[c.areaTier] ?? null;
    if (ppy == null || area == null) return { amount: null, area: null };
    return { amount: Math.round(ppy * (area / 3.3058)), area };
  };

  const ranked = eligible
    .map(c => ({
      id: c.aptSeq,
      value: valueOf(c) as number,
      deals: c.signals[dealType].dealCount,
      price: basisPrice(c),
      ...repOf(c),
    }))
    .sort((a, b) => (a.value - b.value) * dir)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const byId = new Map(MOCK_COMPLEXES.map(c => [c.aptSeq, c]));
  const guCount = new Map<string, number>();
  for (const r of ranked.slice(0, 50)) {
    const g = byId.get(r.id)?.gu;
    if (g) guCount.set(g, (guCount.get(g) ?? 0) + 1);
  }
  const lead = [...guCount]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g.replace(/구$/, ''));
  const label: Record<string, string> = {
    momentum3: '3개월 모멘텀',
    momentum6: '6개월 모멘텀',
    momentum12: '12개월 모멘텀',
    high52wPct: '신고가 근접',
    volumeRatio: '거래량 돌파',
    jeonseRatio: '전세가율',
    rs: '상대강도',
  };
  // 상세 문구는 서버 headline() 과 같은 분기 — 전세가율·거래량·신고가는 상승/하락 개념이 아니다
  let detail: string;
  if (signal === 'high52wPct')
    detail = `신고가 ${ranked.filter(r => r.value === 0).length}개 단지`;
  else if (signal === 'volumeRatio')
    detail = `평균 3배 이상 ${ranked.filter(r => r.value >= 3).length}개`;
  else if (signal === 'jeonseRatio')
    detail = `80% 이상 ${ranked.filter(r => r.value >= 0.8).length}개`;
  else {
    const up = ranked.filter(r => r.value > 0).length;
    detail = `상승 ${up} / 하락 ${ranked.length - up}`;
  }

  return {
    ranked,
    total,
    nullCount: total - eligible.length,
    signal,
    dealType,
    minDeals,
    headline: ranked.length
      ? {
          text: lead.length
            ? `${label[signal] ?? signal} — ${lead.join('·')}가 주도`
            : (label[signal] ?? signal),
          detail,
          dealType: dealType === 'rent' ? '전세' : '매매',
        }
      : null,
    generatedAt: MOCK_GENERATED_AT,
    dataMonth: MOCK_DATA_MONTH,
    stale: false,
    source: 'mock',
  };
}

export const mockApi: MarketApi = {
  getIndices: () => delay(INDICES),
  getHeatmap: () => delay(HEATMAP),
  getFearGreed: () => delay(FEAR_GREED),
  getCryptoFearGreed: () => delay(CRYPTO_FG),
  getMacro: () => delay(MACRO),
  // 버핏지수는 목값이 없다 — 시총·GDP를 꾸며내면 밸류에이션 판단을 오도한다.
  getBuffett: () => delay({ kr: null, us: null }),
  // 주문은 목으로 성공시키지 않는다 — 계좌에 안 들어간 주문을 체결된 것처럼 보여주면 안 된다.
  placeOrder: () =>
    delay({
      ok: false,
      orderNo: null,
      orderTime: null,
      message: '주문은 백엔드(KIS) 연결이 필요합니다.',
    }),
  getOrderable: () => delay(null),
  // 기본정보는 목으로 만들지 않는다 — 시총·PER을 꾸며내면 투자판단을 오도한다.
  getStockInfo: () => delay(null),
  // 스코어도 목으로 만들지 않는다 — 투자의견을 꾸며내면 안 된다.
  getStockOpinion: () => delay(null),
  getWatchlist: () => delay(WATCHLIST),
  getNews: () => delay(NEWS),
  getAiOpinion: () => delay(AI_OPINION),
  getStockDetail: code => delay(buildDetail(code)),
  getPortfolio: () => delay(buildPortfolio()),
  getResearch: () => delay(RESEARCH),
  getSeoulRent: () => delay(SEOUL_RENT),
  getAptComplexes: () =>
    delay({
      generatedAt: MOCK_GENERATED_AT,
      dataMonth: MOCK_DATA_MONTH,
      etag: 'mock',
      items: MOCK_COMPLEXES.map(
        ({ aptSeq, aptNm, gu, umdNm, lat, lng, buildYear }) => ({
          aptSeq,
          aptNm,
          gu,
          umdNm,
          lat,
          lng,
          buildYear,
        }),
      ),
      source: 'mock' as const,
    }),
  screenApartments: q => delay(mockScreen(q)),
  getAptComplex: aptSeq =>
    delay(MOCK_COMPLEXES.find(c => c.aptSeq === aptSeq) ?? null),
  getComplexDeals: () => delay({ deals: [] }), // 목은 빈 deals
  getRanking: (): Promise<RankingItem[]> => delay([], 120), // unavailable — 목 생성 금지
  getPortfolioHistory: (): Promise<PortfolioHistoryResult> =>
    delay({ entries: [] }), // 목 생성 금지
  // 홈(W2) — 순자산·자산은 목으로 꾸며내지 않는다(RADIO #2). 백엔드 없으면 전부 "-".
  getHome: () =>
    delay({
      netWorth: null,
      dayChange: null,
      allocation: null,
      manualTotal: 0,
      snapshotSeries: [],
      unavailable: true as const,
    }),
  getManualAssets: () => delay([]),
  saveManualAsset: () =>
    Promise.reject(new Error('수동 자산은 백엔드 연결이 필요합니다.')),
  deleteManualAsset: () =>
    Promise.reject(new Error('수동 자산은 백엔드 연결이 필요합니다.')),
  getComplexEstimates: () => delay({}),
};
