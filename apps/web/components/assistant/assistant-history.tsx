'use client';

import { useFormatters } from '@suskii/i18n/react';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { hasSession } from '../../lib/session';
import { useHydrated } from '../../lib/use-hydrated';
import { AppLink } from '../app-link';

import { useAssistantT } from './use-assistant-t';

type Summary = Schemas['AgentConversationList']['conversations'][number];

/**
 * A signed-in traveller's earlier conversations with the assistant, read from the API (the
 * browser keeps none). A visitor without a session is told what signing in adds.
 */
export function AssistantHistory({ current }: { current: string | null }) {
  const { t } = useAssistantT();
  const format = useFormatters();
  const signedIn = useHydrated() && hasSession();
  const [conversations, setConversations] = useState<Summary[] | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/agent/conversations')
      .then(({ data }) => {
        if (!cancelled) setConversations(data?.conversations ?? []);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const link =
    'inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring';
  return (
    <section aria-labelledby="assistant-history" className="flex flex-col gap-3">
      <h2 id="assistant-history" className="font-heading text-h3 font-bold text-heading">
        {t('assistant.history')}
      </h2>
      {!signedIn ? (
        <p className="font-body text-body-sm text-foreground">
          {t('assistant.signInForHistory')}{' '}
          <AppLink href="/sign-in?next=/assistant" className={link}>
            {t('assistant.signIn')}
          </AppLink>
        </p>
      ) : conversations === null ? null : conversations.length === 0 ? (
        <p className="font-body text-body-sm text-muted">{t('assistant.noHistory')}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="assistant-history">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="flex flex-col gap-1 border-b border-border pb-2">
              <AppLink
                href={`/assistant?conversation=${conversation.id}`}
                aria-current={conversation.id === current ? 'page' : undefined}
                className={link}
              >
                {t('assistant.conversation', { reference: conversation.reference })}
              </AppLink>
              <span className="font-body text-caption text-muted" suppressHydrationWarning>
                {format.dateTime(conversation.lastMessageAt)}
                {', '}
                {t('assistant.messagesCount', { count: format.number(conversation.messageCount) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
