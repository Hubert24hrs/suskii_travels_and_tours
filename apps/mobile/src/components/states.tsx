import { Button, Card } from '@suskii/ui-native';
import { ActivityIndicator, Text, View } from 'react-native';
import { color } from '@suskii/design-tokens';

/** Centered spinner with a spoken label. */
export function Loading({ label }: { label: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="flex-1 items-center justify-center gap-3 p-6"
    >
      <ActivityIndicator color={color.primary} />
      <Text className="font-body text-body text-muted">{label}</Text>
    </View>
  );
}

export function Notice({
  title,
  body,
  action,
  onAction,
  testID,
}: {
  title?: string;
  body: string;
  action?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View testID={testID} className="p-4">
      <Card className="gap-3 p-4">
        {title ? (
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {title}
          </Text>
        ) : null}
        <Text className="font-body text-body text-foreground">{body}</Text>
        {action && onAction ? (
          <Button variant="ghost" onPress={onAction}>
            {action}
          </Button>
        ) : null}
      </Card>
    </View>
  );
}

/** Shown above content read from the device while the network is unreachable. */
export function OfflineBanner({ label }: { label: string }) {
  return (
    <View accessibilityRole="alert" testID="offline-banner" className="bg-primary-subtle px-4 py-2">
      <Text className="font-body text-body-sm text-foreground">{label}</Text>
    </View>
  );
}
