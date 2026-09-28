# @suskii/ui-native

React Native equivalents of `@suskii/ui-web` for the Expo app, styled with NativeWind 4 using the
`@suskii/design-tokens/tailwind-preset`. Shipped as TypeScript source for Metro.

Components: Button, Input, Tabs, SegmentedControl, Combobox, DateRangePicker (month list in a bottom
sheet), PassengerPicker (bottom sheet), Card, DealCard, DestinationCard, Badge, TrustBar, Skeleton
(Reanimated pulse, static under reduced motion), Sheet (`@gorhom/bottom-sheet`), Modal, Toast.

Every interactive element sets an accessibility role, label and state (`selected`, `checked`,
`disabled`, `busy`). Icons take colours and sizes from tokens (`iconColor`, `iconSize`). Labels are
props: no copy lives in the components.

## App requirements

- NativeWind configured with the shared preset and `content` including this package's `src`.
- Root providers: `GestureHandlerRootView`, `BottomSheetModalProvider`, `SafeAreaProvider`, and
  `ToastProvider` if toasts are used.
- Fonts loaded with the family names in `fontFamily.native` (`@expo-google-fonts/plus-jakarta-sans`,
  `@expo-google-fonts/dm-sans`).

## Test

```powershell
pnpm --filter @suskii/ui-native test
```

Jest (`jest-expo`) + React Native Testing Library 14, plus a guard test that fails on hardcoded
colours, lengths or arbitrary Tailwind values in component source.
