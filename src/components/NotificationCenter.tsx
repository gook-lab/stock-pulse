import { useEffect, useCallback, type ReactNode } from 'react';
import {
  motion,
  AnimatePresence,
  type TargetAndTransition,
  type Transition,
} from 'framer-motion';
import { TrendingUp, Building2, Bell, Inbox } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useModalOpenSignal } from '@/store/useModalStore';
import { EmptyState } from '@/components/common';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { AppNotification } from '@/data/types';
import s from './NotificationCenter.module.css';

/** prefers-reduced-motion 감지 후 애니메이션 설정을 조정하는 훅 */
type MotionStates = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
};

function useMotionVariant(variants: MotionStates, transition: Transition = {}) {
  const shouldReduce = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  return {
    initial: shouldReduce ? {} : variants.initial,
    animate: shouldReduce ? {} : variants.animate,
    exit: shouldReduce ? {} : variants.exit,
    transition: shouldReduce ? { duration: 0 } : transition,
  };
}

interface NotificationCenterProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function Signal() {
  useModalOpenSignal();
  return null;
}

/** 아이콘은 lucide — 이모지는 OS·폰트마다 모양이 달라 다크 터미널 톤과 어긋난다(PULSE 컨벤션). */
function getIconAndLabel(kind: AppNotification['kind']): {
  icon: ReactNode;
  label: string;
} {
  const size = 17;
  switch (kind) {
    case 'price':
      return { icon: <TrendingUp size={size} />, label: '가격 알림' };
    case 'apt':
      return { icon: <Building2 size={size} />, label: '부동산 알림' };
    case 'sys':
      return { icon: <Bell size={size} />, label: '시스템 알림' };
    default:
      return { icon: <Inbox size={size} />, label: '알림' };
  }
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: AppNotification;
  onClose: () => void;
}) {
  const selectStock = useStore(st => st.selectStock);
  const setTab = useStore(st => st.setTab);
  const markNotificationRead = useStore(st => st.markNotificationRead);

  const { icon, label } = getIconAndLabel(notification.kind);

  const handleClick = () => {
    markNotificationRead(notification.id);

    // 딥링크: kind별로 탭 이동 + 데이터 선택
    if (notification.kind === 'price' && notification.code) {
      selectStock(notification.code);
    } else if (notification.kind === 'apt') {
      setTab('realestate');
    }
    // sys: 이동 없음

    onClose();
  };

  const motionProps = useMotionVariant(
    {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: 20 },
    },
    { duration: 0.2 },
  );

  return (
    <motion.button
      className={`${s.item} ${!notification.read ? s.itemUnread : ''}`}
      onClick={handleClick}
      aria-label={`${label}: ${notification.title}`}
      {...motionProps}
    >
      <div className={s.icon}>{icon}</div>
      <div className={s.textBox}>
        <div className={s.title}>
          {notification.title}
          {!notification.read && <span className={s.newDot} />}
        </div>
        <div className={s.desc}>{notification.desc}</div>
        <div className={s.time}>{formatRelativeTime(notification.at)}</div>
      </div>
    </motion.button>
  );
}

export default function NotificationCenter({
  open,
  onOpenChange,
}: NotificationCenterProps) {
  const notifications = useStore(st => st.notifications);
  const markAllNotificationsRead = useStore(st => st.markAllNotificationsRead);

  const unreadCount = notifications.filter(n => !n.read).length;

  // ESC 키로 닫기
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleMarkAllRead = useCallback(() => {
    markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onOpenChange(false);
    }
  };

  const backdropMotion = useMotionVariant(
    { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
    { duration: 0.2 },
  );

  const drawerMotion = useMotionVariant(
    {
      initial: { opacity: 0, x: '100%' },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: '100%' },
    },
    { type: 'spring', stiffness: 300, damping: 30 },
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <Signal />
          <motion.div
            className={s.backdrop}
            onClick={handleBackdropClick}
            {...backdropMotion}
          />
          <motion.div className={s.drawer} {...drawerMotion}>
            <div className={s.header}>
              <div className={s.headerTitle}>
                알림
                {unreadCount > 0 && (
                  <span className={s.unreadCount}>({unreadCount})</span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  className={s.markAllReadBtn}
                  onClick={handleMarkAllRead}
                  aria-label="모든 알림을 읽음으로 표시"
                >
                  모두 읽음
                </button>
              )}
            </div>

            <div className={s.content}>
              {notifications.length === 0 ? (
                <EmptyState title="알림이 없습니다" />
              ) : (
                <AnimatePresence>
                  {notifications.map(n => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onClose={() => onOpenChange(false)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
