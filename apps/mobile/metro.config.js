const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Expo detects the pnpm monorepo automatically (watch folders and node_modules paths).
module.exports = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
