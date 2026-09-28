import { toast as hotToast, type Toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { CircleX, TriangleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';

// 단일 토스트 진입점(viviane 패턴). toast.success({ message }) 형태로 호출.
// 스타일: 패널 배경 #141924 + 좌측 3px 액센트 바 + 라운드 11px.
export type ToastType = 'success' | 'error' | 'warning' | 'info';

const STYLE: Record<ToastType, { color: string; icon: ReactNode }> = {
  success: { color: '#16C784', icon: <CircleCheck size={20} /> },
  error: { color: '#EA3943', icon: <CircleX size={20} /> },
  warning: { color: '#E0A838', icon: <TriangleAlert size={20} /> },
  info: { color: '#7C6CFF', icon: <Info size={20} /> },
};

interface ToastAction {
  label: string;
  onClick: () => void;
}

function ToastCard({
  t,
  type,
  title,
  message,
  action,
}: {
  t: Toast;
  type: ToastType;
  title?: string;
  message: string;
  action?: ToastAction;
}) {
  const st = STYLE[type];
  return (
    <AnimatePresence>
      {t.visible && (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className="pointer-events-auto flex min-w-[240px] max-w-[380px] items-start gap-3 border border-line px-4 py-3"
          style={{
            background: '#141924',
            borderRadius: 11,
            borderLeft: `3px solid ${st.color}`,
            boxShadow: '0 8px 28px -6px rgba(0,0,0,.6)',
          }}
        >
          <span style={{ color: st.color }} className="mt-[1px] shrink-0">
            {st.icon}
          </span>
          <div className="min-w-0 flex-1">
            {title && (
              <div className="text-[13px] font-bold leading-tight text-fg">
                {title}
              </div>
            )}
            <div className="text-[12.5px] leading-snug text-sub">{message}</div>
          </div>
          {action && (
            <button
              onClick={() => {
                action.onClick();
                hotToast.dismiss(t.id);
              }}
              className="shrink-0 self-center rounded-lg border border-line bg-panel2 px-2.5 py-1 text-[11.5px] font-bold text-fg hover:border-brand"
            >
              {action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ToastOptions {
  title?: string;
  message: string;
  duration?: number;
  id?: string; // 지정 시 중첩 방지(같은 id 재호출 시 교체)
  action?: ToastAction;
}

const show = (
  type: ToastType,
  { title, message, duration = 2400, id, action }: ToastOptions,
) => {
  if (id) hotToast.dismiss(id);
  return hotToast.custom(
    t => (
      <ToastCard
        t={t}
        type={type}
        title={title}
        message={message}
        action={action}
      />
    ),
    {
      duration,
      id: id || undefined,
    },
  );
};

const toast = {
  success: (o: ToastOptions) => show('success', o),
  error: (o: ToastOptions) => show('error', o),
  warning: (o: ToastOptions) => show('warning', o),
  info: (o: ToastOptions) => show('info', o),
  dismiss: hotToast.dismiss,
};

export default toast;
