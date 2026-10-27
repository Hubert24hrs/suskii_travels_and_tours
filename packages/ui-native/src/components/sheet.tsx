import { color } from '@suskii/design-tokens';
import { X } from 'lucide-react-native';
import { useContext, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { iconSize } from '../lib/icon';

/** Share of the screen a tall sheet takes, and the most any sheet takes. */
const SHEET_SCREEN_SHARE = 0.9;

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required title, announced when the sheet opens. */
  title: string;
  /** Accessible label for the close button, e.g. "Close". */
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Set for long content (a calendar): the sheet then takes 90% of the screen instead of sizing to
   * its content. Kept as `snapPoints` for compatibility; the values are not read.
   */
  snapPoints?: string[];
  /** Base id for UI tests: the sheet, `{testID}-close` and `{testID}-backdrop`. */
  testID?: string;
}

/**
 * Bottom sheet (date and passenger pickers, filters), built on React Native's own Modal so it
 * opens on every device: it slides up over a dimmed backdrop, and the backdrop, the close button
 * and Android's back button dismiss it. The content scrolls; the footer stays in view.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
  footer,
  snapPoints,
  testID,
}: SheetProps) {
  // Clears Android's navigation bar (edge to edge); zero where no provider is mounted (tests).
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const { height: screenHeight } = useWindowDimensions();
  const limit = screenHeight * SHEET_SCREEN_SHARE;
  const close = () => onOpenChange(false);
  return (
    <Modal
      transparent
      visible={open}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View className="flex-1 justify-end bg-overlay">
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
          onPress={close}
          className="flex-1"
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          className="rounded-t-xl bg-surface"
          style={
            snapPoints
              ? { height: limit, paddingBottom: bottomInset }
              : { maxHeight: limit, paddingBottom: bottomInset }
          }
        >
          <View className="items-center pt-2">
            <View className="h-1 w-10 rounded-pill bg-border-strong" />
          </View>
          <View className="flex-row items-center justify-between gap-4 px-6 pt-2">
            <Text accessibilityRole="header" className="flex-1 font-heading text-h4 text-heading">
              {title}
            </Text>
            <Pressable
              testID={testID ? `${testID}-close` : undefined}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={close}
              hitSlop={8}
              className="size-12 items-center justify-center rounded-pill active:bg-background"
            >
              <X color={color.muted} size={iconSize.lg} />
            </Pressable>
          </View>
          <ScrollView
            className={snapPoints ? 'flex-1' : 'grow-0'}
            contentContainerClassName="gap-4 px-6 pb-4"
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View className="gap-2 px-6 pb-6 pt-2">{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
