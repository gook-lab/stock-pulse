import { useEffect, useMemo, useState } from 'react';
import {
  Receipt,
  Bell,
  Home as HomeIcon,
  Newspaper,
  type LucideIcon,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { EmptyState, SkeletonRows } from '@/components/common';
import { buildHomeFeed } from '../../lib/homeFeed';
import { signColor } from '../../lib/colors';
import type { HomeFeedItem } from '../../data/types';
import s from './Home.module.css';

// 이모지는 폰트 크기·테마에 반응하지 않는다(F4) — 프로젝트 표준 lucide 아이콘 사용(AppBar 참조).
const ICONS: Record<HomeFeedItem['type'], LucideIcon> = {
  order: Receipt,
  alert: Bell,
  apt: HomeIcon,
  news: Newspaper,
};

function ago(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 타임라인 피드 — 주문·알림·관심단지·보유종목 뉴스, 시간 역순 단일 규칙(설계 W2). */
export default function FeedCard() {
  const loaded = useStore(st => st.loaded);
  const paperOrders = useStore(st => st.paperOrders);
  const notifications = useStore(st => st.notifications);
  const news = useStore(st => st.news);
  const portfolio = useStore(st => st.portfolio);
  const mode = useStore(st => st.colorMode);
  const selectStock = useStore(st => st.selectStock);
  const setTab = useStore(st => st.setTab);

  // "n분 전" 표기용 시계 — 렌더 중 Date.now() 대신 1분마다 갱신한다
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const feed = useMemo(
    () =>
      buildHomeFeed({
        orders: paperOrders,
        notifications,
        news,
        holdings: portfolio?.holdings ?? [],
        now,
      }),
    [paperOrders, notifications, news, portfolio, now],
  );

  const open = (item: HomeFeedItem) => {
    if (!item.ref) return;
    if (item.ref.kind === 'stock') selectStock(item.ref.id);
    else setTab('realestate');
  };

  return (
    <section className="card">
      <div className="card-h">
        <b>내 피드</b>
        <span className="tag">주문 · 알림 · 보유종목 뉴스</span>
      </div>
      {feed.length ? (
        <div className={s.feed}>
          {feed.map(f => {
            const Icon = ICONS[f.type];
            return (
              <button
                key={f.id}
                type="button"
                className={s.feedItem}
                onClick={() => open(f)}
              >
                <span className={s.feedIcon} aria-hidden>
                  <Icon size={14} />
                </span>
                <span className={s.feedBody}>
                  <span
                    className={s.feedTitle}
                    style={
                      f.sentiment && f.sentiment !== 'neutral'
                        ? {
                            color: signColor(
                              f.sentiment === 'good' ? 1 : -1,
                              mode,
                            ),
                          }
                        : undefined
                    }
                  >
                    {f.title}
                  </span>
                  <span className={s.feedMeta}>
                    <span>{ago(f.ts, now)}</span>
                    {f.detail && <span>· {f.detail}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : loaded ? (
        <EmptyState
          title="아직 조용합니다"
          desc="주문을 넣거나 가격 알림을 만들면 여기에 쌓입니다."
        />
      ) : (
        // 뉴스(보유종목 필터)가 아직 안 왔을 수 있다 — 로딩과 빈 상태를 구분(ISSUE-001).
        <SkeletonRows rows={5} />
      )}
    </section>
  );
}
