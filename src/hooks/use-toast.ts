import * as React from "react";
export type ToastActionElement = React.ReactElement;
export interface ToastProps {
  id?: string;
  title?: string;
  description?: string;
  action?: ToastActionElement;
}
export function useToast() {
  const [toasts, setToasts] = React.useState<ToastProps[]>([]);
  const toast = React.useCallback((props: ToastProps) => {
    setToasts((prev) => [...prev, { ...props, id: String(Date.now()) }]);
  }, []);
  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return { toasts, toast, dismiss };
}
