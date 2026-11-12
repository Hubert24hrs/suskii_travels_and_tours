// The app's entry: Intl polyfills load before any other module (Hermes, ADR-020), error
// reporting is installed (ADR-046), then Expo Router starts the app.
import './src/polyfills';
import './src/error-reporting-setup';
import 'expo-router/entry';
