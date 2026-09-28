import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { evaluate } from './alertEngine';
import type { PriceAlert } from '@/data/types';
import toast from './toast';

/**
 * 시세 조회 — HTTP 상태를 먼저 본다.
 * res.ok 확인 없이 .json() 하면 500 의 에러 본문(또는 프록시 HTML)이 시세 자리에 들어와
 * 알림 판정이 조용히 틀어진다. 실패는 실패로 던져 상위 재시도·백오프에 맡긴다.
 */
async function fetchQuotes(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, { price: number; changePct: number } | null>> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}
/**
 * 가격 알림 전역 폴링 엔진.
 * 30초마다 활성 알림의 종목 시세를 배치 조회하고 평가한다.
 * document.hidden이면 폴링을 중단한다.
 */
export function useAlertEngine() {
  useEffect(() => {
    let polling = false;
    let failureCount = 0;
    let failureToastShown = false;

    async function poll() {
      // in-flight 가드: 이미 폴링 중이면 스킵
      if (polling) return;

      // document.hidden이면 스킵 (탭이 비활성)
      if (document.hidden) return;

      polling = true;
      try {
        // 폴링 시작 시점의 최신 알림 목록 조회
        const currentAlerts = useStore.getState().alerts;

        // 알림이 없으면 조기 return (인터벌은 유지)
        if (currentAlerts.length === 0) return;

        const krCodes = currentAlerts
          .filter(a => a.market === 'KR')
          .map(a => a.code);
        const usSymbols = currentAlerts
          .filter(a => a.market === 'US')
          .map(a => a.code);

        // AbortSignal.timeout(15_000) 적용
        const abortSignal = AbortSignal.timeout(15_000);

        const [krQuotes, usQuotes] = (await Promise.all([
          krCodes.length
            ? fetchQuotes(
                `/api/kr/quotes?codes=${krCodes.join(',')}`,
                abortSignal,
              )
            : Promise.resolve({}),
          usSymbols.length
            ? fetchQuotes(
                `/api/us/quotes?symbols=${usSymbols.join(',')}`,
                abortSignal,
              )
            : Promise.resolve({}),
        ])) as [
          Record<string, { price: number; changePct: number } | null>,
          Record<string, { price: number; changePct: number } | null>,
        ];

        // 성공 시 실패 카운터 리셋
        failureCount = 0;
        failureToastShown = false;

        // 현재 상태의 알림 다시 조회 (그 사이 removeAlert 될 수 있음)
        const alertsNow = useStore.getState().alerts;

        for (const alert of alertsNow) {
          const quote =
            alert.market === 'KR'
              ? krQuotes?.[alert.code]
              : usQuotes?.[alert.code];
          if (!quote) continue; // 시세 없으면 스킵

          if (evaluate(alert, quote)) {
            // 발화!
            const conditionDesc = getConditionDesc(alert, quote);
            toast.info({
              message: `${alert.name} ${conditionDesc}`,
              duration: 3000,
            });

            // 알림 센터에 기록
            useStore.getState().pushNotification({
              kind: 'price',
              title: `${alert.name} 가격 알림`,
              desc: conditionDesc,
              code: alert.code,
              read: false,
            });

            // 해당 알림 즉시 삭제 (1회성)
            useStore.getState().removeAlert(alert.id);
          }
        }
      } catch (err) {
        // 연속 실패 카운터 증가
        failureCount++;

        // 3회 도달 시 딱 1번 toast 표시 (이후 성공 전까지 반복 금지)
        if (failureCount >= 3 && !failureToastShown) {
          failureToastShown = true;
          toast.warning({
            message: '가격 알림 시세 조회가 계속 실패하고 있습니다.',
          });
        }

        console.debug('[useAlertEngine] poll error:', err);
      } finally {
        polling = false;
      }
    }

    // 초기 한 번 실행
    void poll();

    // 30초마다 폴링
    const intervalId = window.setInterval(() => {
      void poll();
    }, 30_000);

    // visibility 변경 감지 — hidden → visible로 돌아올 때 즉시 폴링
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}

function getConditionDesc(
  alert: PriceAlert,
  quote: { price: number; changePct: number },
): string {
  switch (alert.kind) {
    case 'target-above':
      return `목표가 이상 도달 (${quote.price.toLocaleString()})`;
    case 'target-below':
      return `목표가 이하 도달 (${quote.price.toLocaleString()})`;
    case 'move-pct':
      return `${alert.value > 0 ? '상승' : '하락'} ${Math.abs(alert.value)}% 도달 (${quote.changePct.toFixed(2)}%)`;
    case 'high52':
      return `52주 신고가 돌파 (${quote.price.toLocaleString()})`;
    default:
      return '조건 도달';
  }
}
