import { Bot, X } from 'lucide-react';

import { api } from '../../lib/api';
import { askSuskiiStart } from '../../lib/ask-suskii';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

/**
 * "Ask Suskii" (ADR-109): the one way into the assistant, a button that does not stay put. It
 * starts each visit in a different place and glides to the next one every few seconds; the
 * movement is a CSS animation (`globals.css`), so no page ships any script for it (ADR-013).
 *
 * It is a link to the assistant's own page, rendered on the server only while the API says the
 * assistant is available (ADR-101): an answer the website cannot read shows nothing. The box
 * beside it hides the button for the rest of the visit without a script either (WCAG 2.2.2: what
 * moves can be put away). Pages that carry `NoAskSuskii` never show it.
 */
export async function AskSuskii() {
  if ((await api.agentStatus())?.available !== true) return null;
  const { t } = await getI18n();
  return (
    // A landmark of its own: it is part of no page's content and of no other navigation.
    <aside
      aria-label={t('assistant.open')}
      data-ask-suskii=""
      data-start={askSuskiiStart()}
      className="fixed bottom-4 inset-e-4 z-30 flex items-center print:hidden"
    >
      <input
        id="ask-suskii-hide"
        type="checkbox"
        data-testid="ask-suskii-hide"
        aria-label={t('assistant.hide')}
        className="peer sr-only"
      />
      <AppLink
        href="/assistant"
        data-testid="assistant-open"
        className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary ps-4 pe-12 font-body text-body font-bold text-on-primary shadow-primary-button peer-checked:hidden hover:bg-primary-hover focus-visible:focus-ring active:bg-primary-pressed"
      >
        <Bot aria-hidden="true" className="size-6" />
        {t('assistant.open')}
      </AppLink>
      {/* The visible half of the box above: a press ticks it, and the button is gone. */}
      <label
        htmlFor="ask-suskii-hide"
        className="absolute inset-e-2 flex size-8 cursor-pointer items-center justify-center rounded-pill text-on-primary peer-checked:hidden peer-focus-visible:focus-ring hover:bg-primary-hover"
      >
        <X aria-hidden="true" className="size-4" />
      </label>
    </aside>
  );
}

/**
 * Put on a page where the button must not show: a page that starts a payment (ADR-089), a
 * sign-in form, and the assistant's own pages. The root layout is not rendered again when a
 * visitor moves between pages, so the page says it and the stylesheet hides the button.
 */
export function NoAskSuskii() {
  return <span hidden data-no-ask-suskii="" />;
}
