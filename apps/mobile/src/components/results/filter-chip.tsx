import { Pressable, Text } from 'react-native';

/** A filter that is on or off, announced as a checkbox (48 px tall for thumbs). */
export function FilterChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      className={
        selected
          ? 'min-h-12 justify-center rounded-pill bg-primary px-4'
          : 'min-h-12 justify-center rounded-pill border border-border-strong px-4'
      }
    >
      <Text
        className={
          selected
            ? 'font-body-bold text-body-sm text-on-primary'
            : 'font-body text-body-sm text-foreground'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
