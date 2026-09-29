import { DM_Sans, Plus_Jakarta_Sans } from 'next/font/google';

// Downloaded at build time and self-hosted (no runtime requests to Google). `subsets` only picks
// what is preloaded: the latin-ext faces (Naira sign U+20A6, dot-below letters in Yoruba and Igbo
// names) are still declared and load through unicode-range when a page uses them, off the
// critical path. Variable names match the design-token font stacks (fontFamily.web).
export const headingFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta-sans',
  display: 'swap',
});

export const bodyFont = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});
