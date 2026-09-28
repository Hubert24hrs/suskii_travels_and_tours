/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './node_modules/@suskii/ui-native/src/**/*.{ts,tsx}',
  ],
  // NativeWind's preset first, then the design tokens, which replace Tailwind's default scales.
  presets: [require('nativewind/preset'), require('@suskii/design-tokens/tailwind-preset').default],
};
