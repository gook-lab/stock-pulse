import type { SignalKey } from '@/data/types';

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  momentum3: '3개월 모멘텀',
  momentum6: '6개월 모멘텀',
  momentum12: '12개월 모멘텀',
  high52wPct: '신고가 근접',
  volumeRatio: '거래량 돌파',
  jeonseRatio: '전세가율',
  rs: '상대강도',
};

/** 시그널 값 표기 — 계약 "시그널 표기 공통". */
export function formatSignalValue(
  value: number | null,
  signal: SignalKey,
): string {
  if (value == null) return '—';
  switch (signal) {
    case 'momentum3':
    case 'momentum6':
    case 'momentum12':
    case 'rs':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    case 'high52wPct':
      return value === 0 ? '신고가' : `${value.toFixed(1)}%`;
    case 'volumeRatio':
      return `${value.toFixed(2)}×`;
    case 'jeonseRatio':
      return `${Math.round(value * 100)}%`;
  }
}
