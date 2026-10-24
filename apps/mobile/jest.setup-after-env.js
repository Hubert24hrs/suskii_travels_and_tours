// Runs once Jest's globals exist (Testing Library extends `expect` when it loads).
// Some screens show content only after several fetches in a row (a trip, then the Cars features,
// then ride places). On a busy CI runner the first of these in a file took longer than Testing
// Library's default 1-second wait; give queries 5 seconds (Jest's per-test limit is 20).
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
