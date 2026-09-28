import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { Badge, Button, EmptyState, ErrorState } from '@/components/common';
import { colors, WARN } from '@/lib/colors';
import toast from '@/lib/toast';
import ScreenerFilters from './ScreenerFilters';
import ComplexList from './ComplexList';
import ComplexMap from './ComplexMap';
import ComplexDetail from './ComplexDetail';
import s from './RealEstate.module.css';

/** 기준일 경과일수. 하루 안이면 0. */
const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/**
 * 헤드라인 "6개월 모멘텀 — 강동·송파가 주도" 에서 주도 지역만 등락색으로 강조.
 */
function Headline({ text, detail }: { text: string; detail: string }) {
  const mode = useStore(st => st.colorMode);
  const setAreaFilter = useStore(st => st.setAreaFilter);
  const m = text.match(/^(.+ — )(.+)(가 주도)$/);
  return (
    <div className={s.headline}>
      <span className={s.hlMain}>
        {m ? (
          <>
            {m[1]}
            {m[2].split('·').map((name, i) => (
              <span key={name}>
                {i > 0 && '·'}
                <button
                  className={s.hlLead}
                  style={{ color: colors(mode).up }}
                  onClick={() => setAreaFilter({ gu: `${name}구` })}
                >
                  {name}
                </button>
              </span>
            ))}
            {m[3]}
          </>
        ) : (
          text
        )}
      </span>
      <span className={s.hlDetail}>{detail}</span>
    </div>
  );
}

/** "지금 갱신" — POST 로 배치를 켜고 status 를 폴링한다. */
function useCollect() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const disposed = useRef(false);

  // 타이머 ref 와 setter 만 쓰므로 참조가 안정적이다 — 마운트 effect 의존성에 넣어도 한 번만 돈다
  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      stop();
    };
  }, [stop]);

  const poll = useCallback(() => {
    stop();
    timer.current = setInterval(async () => {
      try {
        const st = await fetch('/api/realestate/collect/status').then(r =>
          r.json(),
        );
        if (disposed.current) return;
        setMessage(st.message);
        if (!st.running) {
          stop();
          setRunning(false);
          setMessage(null);
          if (st.ok) {
            toast.success({ message: '데이터 갱신 완료' });
            useStore.setState({ aptComplexes: null, aptScreen: null });
            void useStore.getState().loadRealestate();
          } else {
            toast.error({
              message: `갱신 실패: ${st.error ?? '수집 실패 — 이전 데이터 유지'}`,
            });
          }
        }
      } catch {
        /* 서버 재시작 등 */
      }
    }, 2000);
  }, [stop]);

  const start = async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await fetch('/api/realestate/collect', { method: 'POST' }).then(
        x => x.json(),
      );
      if (disposed.current) return;
      setMessage(r.message ?? '수집 시작…');
      poll();
    } catch (e) {
      if (disposed.current) return;
      setRunning(false);
      toast.error({
        message: `갱신 요청 실패: ${String((e as Error)?.message || e)}`,
      });
    }
  };

  useEffect(() => {
    fetch('/api/realestate/collect/status')
      .then(r => r.json())
      .then(st => {
        if (disposed.current) return;
        if (st.running) {
          setRunning(true);
          setMessage(st.message);
          poll();
        }
      })
      .catch(() => {});
  }, [poll]);

  return { running, message, start };
}

export default function RealEstate() {
  const screen = useStore(st => st.aptScreen);
  const needsCollect = useStore(st => st.aptNeedsCollect);
  const error = useStore(st => st.aptError);
  const mapFailed = useStore(st => st.aptMapFailed);
  const mapFailReason = useStore(st => st.aptMapFailReason);
  const loadRealestate = useStore(st => st.loadRealestate);
  const selectedComplexId = useStore(st => st.selectedComplexId);

  const [showMap, setShowMap] = useState(false);
  const collect = useCollect();

  useEffect(() => {
    void loadRealestate();
  }, [loadRealestate]);

  if (needsCollect) {
    return (
      <div className={s.page}>
        <EmptyState
          title="아직 수집된 데이터가 없습니다"
          desc="서울 25구 실거래를 한 번 수집해야 스크리너가 동작합니다. 약 6분 걸립니다."
          action={
            <Button
              variant="primary"
              loading={collect.running}
              onClick={collect.start}
            >
              지금 수집 시작
            </Button>
          }
        />
        {collect.message && (
          <div className={`${s.progress} mono`}>{collect.message}</div>
        )}
      </div>
    );
  }
  if (error && !screen) {
    return (
      <div className={s.page}>
        <ErrorState desc={error} onRetry={() => void loadRealestate()} />
      </div>
    );
  }

  const stale = screen?.stale ?? false;
  const days = screen ? daysSince(screen.generatedAt) : 0;
  const date = screen ? screen.generatedAt.slice(0, 10) : '';

  // 상세는 화면 전환이지만 스크리너를 언마운트하지는 않는다 —
  // 지도 인스턴스가 죽으면 돌아왔을 때 보던 위치·줌이 초기화된다(hidden 이면 살아 있고,
  // 다시 보일 때 ComplexMap 의 ResizeObserver 가 relayout 한다).
  const detailMode = selectedComplexId != null;

  return (
    <div className={s.page}>
      {detailMode && <ComplexDetail />}

      <div hidden={detailMode}>
        <div className={s.head}>
          <span className={s.title}>부동산 스크리너</span>
          <span className={s.chip}>
            서울 25구 · {screen ? screen.total.toLocaleString() : '—'}단지
          </span>
          {screen?.source === 'mock' && <Badge color={WARN}>목 데이터</Badge>}
          {screen?.geocodeDrop && (
            <Badge color={WARN}>
              좌표 확보율 하락 {screen.geocodeDrop.from}% →{' '}
              {screen.geocodeDrop.to}%
            </Badge>
          )}
          {mapFailed && (
            <Badge>
              {mapFailReason ?? '지도를 불러오지 못했습니다'} — 리스트는 정상
              동작합니다
            </Badge>
          )}
          <div className={s.headRight}>
            {screen && (
              <span
                className={s.dateChip}
                style={stale ? { color: WARN, borderColor: WARN } : undefined}
              >
                기준일 {date} · {days}일 경과{stale ? ' · 갱신 지연' : ''}
              </span>
            )}
            <button className={s.mapToggle} onClick={() => setShowMap(v => !v)}>
              {showMap ? '리스트 보기' : '지도 보기'}
            </button>
            <Button
              variant="primary"
              size="sm"
              loading={collect.running}
              onClick={collect.start}
            >
              지금 갱신
            </Button>
          </div>
        </div>
        {collect.running && collect.message && (
          <div className={`${s.progress} mono`}>{collect.message}</div>
        )}

        {screen?.headline && (
          <Headline
            text={screen.headline.text}
            detail={screen.headline.detail}
          />
        )}

        <div
          className={[s.body, mapFailed && s.bodyFull, showMap && s.bodyMap]
            .filter(Boolean)
            .join(' ')}
        >
          <div className={s.left}>
            <ScreenerFilters />
            <ComplexList />
          </div>
          {!mapFailed && (
            <div className={s.right}>
              <ComplexMap />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
