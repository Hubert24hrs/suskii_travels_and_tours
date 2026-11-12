import { DM_Sans, Plus_Jakarta_Sans } from 'next/font/google';

// Downloaded at build time and self-hosted (no runtime requests to Google). latin-ext covers the
// Naira sign (U+20A6) and the dot-below letters in Yoruba and Igbo names (U+1E00-1E9F).
// Variable names match the design-token font stacks (@suskii/design-tokens fontFamily.web).
export const headingFont = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
});

export const bodyFont = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-dm-sans',
  display: 'swap',
});
