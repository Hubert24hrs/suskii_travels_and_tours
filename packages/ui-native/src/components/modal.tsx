import { color } from '@suskii/design-tokens';
import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal as NativeModal, Pressable, Text, View } from 'react-native';

import { iconSize } from '../lib/icon';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Centred dialog (e.g. price-change consent). Android back and the close button dismiss it. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
}: ModalProps) {
  return (
    <NativeModal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 justify-center bg-overlay px-4">
        <View accessibilityViewIsModal className="gap-4 rounded-xl bg-surface p-6">
          <View className="flex-row items-start justify-between gap-4">
            <Text accessibilityRole="header" className="flex-1 font-heading text-h4 text-heading">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={() => onOpenChange(false)}
              className="-m-2 size-12 items-center justify-center rounded-pill active:bg-background"
            >
              <X color={color.muted} size={iconSize.lg} />
            </Pressable>
          </View>
          {description ? (
            <Text className="font-body text-body-sm text-muted">{description}</Text>
          ) : null}
          {children}
          {footer ? <View className="gap-2">{footer}</View> : null}
        </View>
      </View>
    </NativeModal>
  );
}
