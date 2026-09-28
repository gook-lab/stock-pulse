import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { motion, useAnimationControls } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { signColor, fmt, HOLD, STATUS_LIVE } from '../../lib/colors';
import {
  Badge,
  MarketChip,
  Segmented,
  SkeletonRows,
} from '@/components/common';
import { useKisTrade, useKisConnected } from '../../lib/kisSocket';
import type { ColorMode } from '../../lib/colors';
import type { WatchItem } from '../../data/types';
import s from './Dashboard.module.css';

type View = 'watch' | 'rank';
type Market = 'all' | 'kospi' | 'kosdaq';
type By = 'amount' | 'volume' | 'up' | 'down';

const VIEWS: { value: View; label: string }[] = [
  { value: 'watch', label: '관심종목' },
  { value: 'rank', label: '순위' },
];
const MARKETS: { value: Market; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'kospi', label: '코스피' },
  { value: 'kosdaq', label: '코스닥' },
];
const SORTS: { value: By; label: string }[] = [
  { value: 'amount', label: '거래대금' },
  { value: 'volume', label: '거래량' },
  { value: 'up', label: '급등' },
  { value: 'down', label: '급락' },
];
const METRIC_HEAD: Record<By, string> = {
  amount: '거래대금',
  volume: '거래량',
  up: '거래대금',
  down: '거래대금',
};

interface RankItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  amount: number;
}
import { fmtVol, fmtAmt } from '../../lib/format';

const sigMeta = (
  sig: string,
  mode: ColorMode,
): { color: string; label: string } => {
  if (sig === 'buy') return { color: signColor(1, mode), label: '매수' };
  if (sig === 'sell') return { color: signColor(-1, mode), label: '매도' };
  return { color: HOLD, label: '중립' };
};

export default function Watchlist() {
  const watchlist = useStore(st => st.watchlist);
  const mode = useStore(st => st.colorMode);
  const refreshWatchlist = useStore(st => st.refreshWatchlist);
  const connected = useKisConnected();
  const [view, setView] = useState<View>('watch');
  const [market, setMarket] = useState<Market>('all');
  const [by, setBy] = useState<By>('amount');
  const [rank, setRank] = useState<RankItem[] | null>(null); // null=로딩

  // 관심종목 15초 폴링
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refreshWatchlist();
    }, 15_000);
    return () => clearInterval(id);
  }, [refreshWatchlist]);

  // 순위(토스식) — 시장·정렬 바뀌면 로드 + 20초 폴링
  useEffect(() => {
    if (view !== 'rank') return;
    let alive = true;
    setRank(null);
    const load = () =>
      fetch(`/api/kr/rank?by=${by}&market=${market}&limit=50`)
        .then(r => {
          if (!r.ok) throw 0;
          return r.json();
        })
        .then(d => {
          if (alive) setRank(Array.isArray(d) ? d : []);
        })
        .catch(() => {
          if (alive) setRank([]);
        });
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [view, market, by]);

  return (
    <section className="card">
      <div className="card-h">
        <Segmented options={VIEWS} value={view} onChange={setView} />
        <span
          className="tag"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: connected ? STATUS_LIVE : 'var(--text-mut)',
              boxShadow: connected ? `0 0 6px ${STATUS_LIVE}` : 'none',
            }}
          />
          {connected ? 'KIS 실시간' : '연결 대기'}
        </span>
      </div>

      {view === 'rank' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Segmented options={MARKETS} value={market} onChange={setMarket} />
          <Segmented options={SORTS} value={by} onChange={setBy} />
        </div>
      )}

      <div className={s.wl}>
        <div className={s.wlHead}>
          <span>종목</span>
          <span className={s.rt}>현재가</span>
          <span className={s.rt}>등락</span>
          <span className={s.rt}>
            {view === 'rank' ? METRIC_HEAD[by] : 'AI'}
          </span>
        </div>
        {view === 'watch' ? (
          watchlist.map(w => <WlRow key={w.code} w={w} mode={mode} />)
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {rank === null ? (
              <SkeletonRows rows={3} />
            ) : rank.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  color: 'var(--text-mut)',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                순위 데이터를 불러오지 못했습니다
              </div>
            ) : (
              rank.map(v => <RankRow key={v.code} v={v} by={by} mode={mode} />)
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function WlRow({ w, mode }: { w: WatchItem; mode: ColorMode }) {
  const selectStock = useStore(st => st.selectStock);
  const alerts = useStore(st => st.alerts);
  const trade = useKisTrade(w.market === 'KR' ? w.code : null);
  const connected = useKisConnected();
  const unavailable = w.unavailable && !trade;
  const price = trade ? trade.price : w.price;
  const changePct = trade ? trade.changePct : w.changePct;
  const live = !!trade && connected; // 연결이 끊기면 마지막 체결이 남아 있어도 도트를 끈다
  const sig = sigMeta(w.aiSignal, mode);
  const hasAlerts = alerts.some(a => a.code === w.code);

  const flash = useAnimationControls();
  const prev = useRef(price);
  useEffect(() => {
    if (prev.current !== price) {
      const dir = price > prev.current ? 1 : -1;
      flash.start({
        backgroundColor: [`${signColor(dir, mode)}22`, 'rgba(0,0,0,0)'],
        transition: { duration: 0.7 },
      });
      prev.current = price;
    }
  }, [price, flash, mode]);

  return (
    <motion.div
      className={s.wlRow}
      animate={flash}
      style={
        unavailable ? { opacity: 0.5 } : undefined
      } /* "-" 행은 흐리게 — 고장이 아니라 대기임을 시각화 */
      onClick={() =>
        selectStock(w.code, {
          name: w.name,
          market: w.market,
          cur: w.cur,
          dec: w.dec,
        })
      }
    >
      <span className={s.wlName}>
        <MarketChip market={w.market} />
        {w.name}
        {live && (
          <span
            title="실시간 체결"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STATUS_LIVE,
              marginLeft: 6,
              display: 'inline-block',
            }}
          />
        )}
        {hasAlerts && (
          <span title="활성 알림">
            <Bell
              size={14}
              style={{
                marginLeft: 6,
                display: 'inline-block',
                color: 'var(--brand)',
              }}
            />
          </span>
        )}
      </span>
      {unavailable ? (
        <>
          <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>
            -
          </span>
          <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>
            -
          </span>
          <span className={`${s.rt} mono`} style={{ color: 'var(--text-mut)' }}>
            -
          </span>
        </>
      ) : (
        <>
          <span className={`${s.rt} mono`}>
            {w.cur}
            {fmt(price, w.dec)}
          </span>
          <span
            className={`${s.rt} mono`}
            style={{ color: signColor(changePct, mode) }}
          >
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
          <span className={s.rt}>
            <Badge color={sig.color}>{sig.label}</Badge>
          </span>
        </>
      )}
    </motion.div>
  );
}

function RankRow({ v, by, mode }: { v: RankItem; by: By; mode: ColorMode }) {
  const selectStock = useStore(st => st.selectStock);
  const metric = by === 'volume' ? fmtVol(v.volume) : fmtAmt(v.amount);
  return (
    <div
      className={s.wlRow}
      onClick={() =>
        selectStock(v.code, {
          name: v.name,
          market: 'KR',
          cur: '₩',
          dec: 0,
          changePct: v.changePct,
        })
      }
    >
      <span className={s.wlName}>
        <span className={s.volRank}>{v.rank}</span>
        <span className={s.volName}>{v.name}</span>
      </span>
      <span className={`${s.rt} mono`}>₩{fmt(v.price, 0)}</span>
      <span
        className={`${s.rt} mono`}
        style={{ color: signColor(v.changePct, mode) }}
      >
        {v.changePct >= 0 ? '+' : ''}
        {v.changePct.toFixed(2)}%
      </span>
      <span className={`${s.rt} mono`} style={{ color: 'var(--text-sub)' }}>
        {metric}
      </span>
    </div>
  );
}
