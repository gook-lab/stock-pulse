import { toast as hotToast } from 'react-hot-toast';
import { ToastCard, type ToastType, type ToastAction } from './ToastCard';

// 단일 토스트 진입점(viviane 패턴). toast.success({ message }) 형태로 호출.
// 스타일: 패널 배경 #141924 + 좌측 3px 액센트 바 + 라운드 11px.

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
