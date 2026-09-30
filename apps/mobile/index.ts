// The app's entry: Intl polyfills load before any other module (Hermes, ADR-020), then Expo
// Router starts the app.
import './src/polyfills';
import 'expo-router/entry';
