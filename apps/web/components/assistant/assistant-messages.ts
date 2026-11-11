import type { Messages } from '@suskii/i18n';

/** Catalog namespaces the assistant's chat needs on the client (ADR-101). */
export type AssistantMessages = Pick<Messages, 'assistant'>;

/** Server components pass this subset to `I18nProvider` (never the whole catalog). */
export const pickAssistantMessages = (messages: Messages): AssistantMessages => ({
  assistant: messages.assistant,
});
