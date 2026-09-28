import { color } from '@suskii/design-tokens';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react-native';
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize } from '../lib/icon';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

const ToastContext = createContext<{ toast: (options: ToastOptions) => void } | null>(null);

const icons: Record<ToastVariant, ReactNode> = {
  info: <Info color={color.primary} size={iconSize.md} />,
  success: <CircleCheck color={color.success} size={iconSize.md} />,
  error: <CircleAlert color={color.danger} size={iconSize.md} />,
};

export interface ToastProviderProps {
  children: ReactNode;
  closeLabel: string;
  duration?: number;
}

/** Transient notifications above the bottom safe area, announced to screen readers. */
export function ToastProvider({ children, closeLabel, duration = 5000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { ...options, id }]);
      AccessibilityInfo.announceForAccessibility(
        options.description ? `${options.title}. ${options.description}` : options.title,
      );
      setTimeout(() => dismiss(id), options.duration ?? duration);
    },
    [dismiss, duration],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext value={value}>
      {children}
      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0 gap-2 px-4"
        style={{ paddingBottom: insets.bottom }}
      >
        {toasts.map((entry) => (
          <Animated.View
            key={entry.id}
            entering={FadeInDown}
            exiting={FadeOutDown}
            accessibilityLiveRegion={entry.variant === 'error' ? 'assertive' : 'polite'}
            className="flex-row items-start gap-3 rounded-lg border border-border bg-surface p-4"
          >
            {icons[entry.variant ?? 'info']}
            <View className="flex-1 gap-1">
              <Text className="font-body-bold text-body-sm text-foreground">{entry.title}</Text>
              {entry.description ? (
                <Text className="font-body text-body-sm text-muted">{entry.description}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={() => dismiss(entry.id)}
              className="-m-2 size-12 items-center justify-center"
            >
              <X color={color.muted} size={iconSize.md} />
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </ToastContext>
  );
}

export function useToast(): { toast: (options: ToastOptions) => void } {
  const context = use(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
