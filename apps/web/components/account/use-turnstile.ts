'use client';

import { useRef } from 'react';

import { loadTurnstile } from '../home/turnstile';

/** What the API's mock verifier accepts when no site key is configured (local development). */
const DEVELOPMENT_TOKEN = 'development';

/**
 * A Cloudflare Turnstile widget for one form action, rendered when the visitor starts filling in
 * the form so the script never loads on pages nobody uses. Tokens are single use: call `reset`
 * after a refused submit.
 */
export function useTurnstile(siteKey: string, action: string, onError: () => void) {
  const token = useRef<string | null>(siteKey ? null : DEVELOPMENT_TOKEN);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const ensure = () => {
    if (!siteKey || widgetId.current || !containerRef.current) return;
    const element = containerRef.current;
    loadTurnstile()
      .then((turnstile) => {
        widgetId.current = turnstile.render(element, {
          sitekey: siteKey,
          action,
          callback: (value) => {
            token.current = value;
          },
          'expired-callback': () => {
            token.current = null;
          },
        });
      })
      .catch(onError);
  };

  const reset = () => {
    if (!siteKey || !widgetId.current) return;
    token.current = null;
    window.turnstile?.reset(widgetId.current);
  };

  const currentToken = (): string | null => token.current;
  return { containerRef, ensure, reset, currentToken };
}
