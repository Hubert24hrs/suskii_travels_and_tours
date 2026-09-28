require('react-native-gesture-handler/jestSetup');

// Reanimated's mock does not implement useReducedMotion yet ("ADD ME IF NEEDED" upstream).
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('@gorhom/bottom-sheet', () => require('@gorhom/bottom-sheet/mock'));
