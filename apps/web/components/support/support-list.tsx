'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { hasSession } from '../../lib/session';
import { AppLink } from '../app-link';

import { STATUS_VARIANT } from './support-conversation';
import { useSupportT } from './use-support-t';

type Summary = Schemas['SupportConversationSummary'];

/** The signed-in traveller's conversations (ADR-083); nothing for visitors without a session. */
export function SupportList() {
  const { t } = useSupportT();
  const format = useFormatters();
  const [conversations, setConversations] = useState<Summary[] | null>(null);

  useEffect(() => {
    if (!hasSession()) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/support/conversations')
      .then(({ data }) => {
        if (!cancelled && data) setConversations(data.conversations);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (conversations === null) return null;
  return (
    <section aria-labelledby="support-list" className="flex flex-col gap-3">
      <h2 id="support-list" className="font-heading text-h3 font-bold text-heading">
        {t('support.list.heading')}
      </h2>
      {conversations.length === 0 ? (
        <p className="font-body text-body-sm text-muted">{t('support.list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <AppLink
                  href={`/support/${conversation.id}`}
                  className="font-body text-body font-bold text-primary underline"
                >
                  {t('support.conversation.title', { reference: conversation.reference })}
                </AppLink>
                <span className="flex flex-wrap items-center gap-2">
                  {conversation.unread ? (
                    <Badge variant="warning">{t('support.unread')}</Badge>
                  ) : null}
                  <Badge variant={STATUS_VARIANT[conversation.status]}>
                    {t(`support.status.${conversation.status}`)}
                  </Badge>
                  <span className="font-body text-body-sm text-muted" suppressHydrationWarning>
                    {format.dateTime(conversation.lastMessageAt)}
                  </span>
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
