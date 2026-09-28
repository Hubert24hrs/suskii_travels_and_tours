import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { color } from '@suskii/design-tokens';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { iconSize } from '../lib/icon';

const styles = StyleSheet.create({
  background: { backgroundColor: color.surface },
  handle: { backgroundColor: color['border-strong'] },
  backdrop: { backgroundColor: color.overlay },
});

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required title, announced when the sheet opens. */
  title: string;
  /** Accessible label for the close button, e.g. "Close". */
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Fixed heights (e.g. ['90%']) instead of sizing to content. */
  snapPoints?: string[];
}

/**
 * Bottom sheet (date and passenger pickers, filters). Requires `BottomSheetModalProvider` and
 * `GestureHandlerRootView` at the app root.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
  footer,
  snapPoints,
}: SheetProps) {
  const ref = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (open) ref.current?.present();
    else ref.current?.dismiss();
  }, [open]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        style={[props.style, styles.backdrop]}
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={() => onOpenChange(false)}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      enableDynamicSizing={!snapPoints}
      {...(snapPoints ? { snapPoints } : {})}
    >
      <BottomSheetScrollView>
        <View accessibilityViewIsModal className="gap-4 px-6 pb-6">
          <View className="flex-row items-center justify-between gap-4">
            <Text accessibilityRole="header" className="flex-1 font-heading text-h4 text-heading">
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={() => onOpenChange(false)}
              className="size-12 items-center justify-center rounded-pill active:bg-background"
            >
              <X color={color.muted} size={iconSize.lg} />
            </Pressable>
          </View>
          {children}
          {footer}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
