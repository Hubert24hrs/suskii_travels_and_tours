import { api } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';

import { AssistantLauncher } from './assistant-launcher';
import { pickAssistantMessages } from './assistant-messages';

/**
 * Offers the assistant only while the API says it is available (ADR-101): switched on, not
 * paused and connected. An answer the website cannot read hides it, and nothing of it reaches
 * the page then: no button, no copy and no script. Search, booking and payment never ask.
 */
export async function AssistantEntry() {
  const status = await api.agentStatus();
  if (!status?.available) return null;
  const { t, locale, messages } = await getI18n();
  return (
    <AssistantLauncher
      labels={{
        open: t('assistant.open'),
        title: t('assistant.title'),
        close: t('assistant.close'),
        fullPage: t('assistant.fullPage'),
      }}
      messages={pickAssistantMessages(messages)}
      locale={locale}
      turnstileSiteKey={publicEnv.turnstileSiteKey}
    />
  );
}
