/**
 * Text and exchange-rate check (ADR-091): reads today's rates from Open Exchange Rates and, when
 * `--to` names a phone, sends one test text through Termii and Africa's Talking, all through our
 * own adapters. It prints what came back: the rates our currencies get, and whether each
 * provider accepted the text. It prints no key and only the last three digits of the phone. CI
 * never runs it; the manual `messaging-sandbox.yml` workflow does, with the owner's secrets.
 * A provider whose keys are not set is skipped and named.
 *
 *   pnpm --filter @suskii/api sandbox:messaging                       # exchange rates only
 *   pnpm --filter @suskii/api sandbox:messaging --to +2348012345678   # and one text per provider
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { SUPPORTED_CURRENCIES } from '@suskii/shared';

import { SmsSendError, type SmsProvider } from '../src/notifications/sms';
import { AfricasTalkingSmsProvider, TermiiSmsProvider } from '../src/notifications/sms-providers';
import { FxProviderError, OpenExchangeRatesProvider } from '../src/pricing/fx-providers';

const TIMEOUT_MS = 20_000;
const AT_LIVE_URL = 'https://api.africastalking.com';
const AT_SANDBOX_URL = 'https://api.sandbox.africastalking.com';

const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
  process.stdout.write(`${line}\n`);
};
/** A setting's value, with an empty one read as unset (the .env.example convention). */
const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
};
const env = (name: string): string | undefined => present(process.env[name]);

async function checkRates(): Promise<boolean | null> {
  const appId = env('OPENEXCHANGERATES_APP_ID');
  say('## Exchange rates (Open Exchange Rates)');
  if (!appId) {
    say('- Skipped: set OPENEXCHANGERATES_APP_ID to check it.');
    return null;
  }
  try {
    const snapshot = await new OpenExchangeRatesProvider({
      baseUrl: env('OPENEXCHANGERATES_API_URL') ?? 'https://openexchangerates.org/api',
      appId,
      timeoutMs: TIMEOUT_MS,
    }).latest();
    say(`- Base ${snapshot.base}, published ${snapshot.asOf}.`);
    const missing: string[] = [];
    for (const currency of SUPPORTED_CURRENCIES) {
      const rate = snapshot.rates[currency];
      if (rate) say(`- 1 ${snapshot.base} = ${rate} ${currency}`);
      else missing.push(currency);
    }
    if (missing.length > 0) {
      say(`- Missing: ${missing.join(', ')} (prices in these currencies would fail).`);
      return false;
    }
    return true;
  } catch (error) {
    say(`- Failed: ${error instanceof FxProviderError ? error.code : (error as Error).name}.`);
    return false;
  }
}

async function sendOne(name: string, provider: SmsProvider, to: string): Promise<boolean> {
  try {
    await provider.send({
      to,
      body: 'Suskii Travels test message: your text setup works. No action needed.',
      template: 'sandbox-check',
    });
    say(`- Accepted for the number ending ${to.slice(-3)}. Check the phone (or the simulator).`);
    return true;
  } catch (error) {
    say(
      `- ${name} refused it: ${error instanceof SmsSendError ? error.code : (error as Error).name}.`,
    );
    return false;
  }
}

async function checkTexts(to: string | undefined): Promise<{ ran: number; failed: number }> {
  let ran = 0;
  let failed = 0;
  say('## Texts');
  if (!to) {
    say(
      '- Skipped: pass --to with a phone in international format (+234...) to send one test text per provider.',
    );
    return { ran, failed };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(to))
    throw new Error('--to must be an international number, e.g. +2348012345678');

  say('### Termii');
  const termiiKey = env('TERMII_API_KEY');
  const termiiSender = env('TERMII_SENDER_ID');
  if (!termiiKey || !termiiSender) {
    say('- Skipped: set TERMII_API_KEY and TERMII_SENDER_ID to check it.');
  } else {
    ran++;
    const channel = env('TERMII_CHANNEL') === 'generic' ? 'generic' : 'dnd';
    say(`- Route: ${channel}.`);
    const ok = await sendOne(
      'Termii',
      new TermiiSmsProvider({
        baseUrl: env('TERMII_API_URL') ?? 'https://api.ng.termii.com',
        apiKey: termiiKey,
        senderId: termiiSender,
        channel,
        timeoutMs: TIMEOUT_MS,
      }),
      to,
    );
    if (!ok) failed++;
  }

  say("### Africa's Talking");
  const atUser = env('AFRICASTALKING_USERNAME');
  const atKey = env('AFRICASTALKING_API_KEY');
  if (!atUser || !atKey) {
    say('- Skipped: set AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY to check it.');
  } else {
    ran++;
    const sandbox = atUser === 'sandbox';
    say(`- ${sandbox ? 'Sandbox (messages appear in the simulator only)' : 'Live account'}.`);
    const ok = await sendOne(
      "Africa's Talking",
      new AfricasTalkingSmsProvider({
        baseUrl: sandbox ? AT_SANDBOX_URL : AT_LIVE_URL,
        username: atUser,
        apiKey: atKey,
        senderId: env('AFRICASTALKING_SENDER_ID') ?? null,
        timeoutMs: TIMEOUT_MS,
      }),
      to,
    );
    if (!ok) failed++;
  }
  return { ran, failed };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { to: { type: 'string' } } });
  say('# Text and exchange-rate check');
  say();
  const rates = await checkRates();
  say();
  const texts = await checkTexts(present(values.to));
  const ran = (rates === null ? 0 : 1) + texts.ran;
  const failed = (rates === false ? 1 : 0) + texts.failed;
  say();
  if (ran === 0) say('No provider had its keys set, so nothing was called.');
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join('\n')}\n`);
  if (ran === 0 || failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
