import type { Messages } from '@suskii/i18n';

/** The landing page's copy only; the rest of the catalog stays on the server. */
export type MetasearchMessages = Record<'pages', Pick<Messages['pages'], 'metasearch'>>;

export const pickMetasearchMessages = (messages: Messages): MetasearchMessages => ({
  pages: { metasearch: messages.pages.metasearch },
});
