/**
 * Web-data vendor check (ADR-102): asks each vendor whose keys are set whether the key works
 * (a call that fetches no page) and, when `--own-page` names a page of Suskii's own website,
 * reads that one page once through each of them with our adapters, at the lowest proxy class
 * the vendor offers. It prints what came back: the site's status, how long the page is, what
 * the vendor says it cost. It prints no key and no page. CI never runs it; the manual
 * `scrapers-sandbox.yml` workflow does, with the owner's secrets. A vendor whose keys are not
 * set is skipped and named.
 *
 * The request and answer shapes of the five adapters were taken from the vendors' own SDKs,
 * not from a live account. One run of this check with a page is what confirms them, before a
 * vendor goes into `PRICE_INTEL_VENDORS`.
 *
 * `--own-page` is a page you own. This check is not how another company's site is read: that
 * happens only for a site listed and approved in the console, through the router.
 *
 *   pnpm --filter @suskii/api sandbox:scrapers                                  # keys only
 *   pnpm --filter @suskii/api sandbox:scrapers --own-page https://www.example.com/hotels
 *
 * Apify runs an actor and Browse AI a robot, which only their owner can name:
 *   SANDBOX_APIFY_ACTOR_ID=user~actor  SANDBOX_APIFY_INPUT='{"startUrls":[{"url":"{{url}}"}]}'
 *   SANDBOX_BROWSE_AI_ROBOT_ID=<robot id>  SANDBOX_BROWSE_AI_INPUT='{"originUrl":"{{url}}"}'
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { normaliseDomain, type ScrapeVendor } from '@suskii/shared';

import { DEFAULT_SCRAPE_COSTS } from '../src/config/env.schema';
import { ApifyScrapeProvider } from '../src/price-intel/providers/apify-scrape-provider';
import { BrightDataScrapeProvider } from '../src/price-intel/providers/bright-data-scrape-provider';
import { BrowseAiScrapeProvider } from '../src/price-intel/providers/browse-ai-scrape-provider';
import { DirectScrapeProvider } from '../src/price-intel/providers/direct-scrape-provider';
import { FirecrawlScrapeProvider } from '../src/price-intel/providers/firecrawl-scrape-provider';
import { OxylabsScrapeProvider } from '../src/price-intel/providers/oxylabs-scrape-provider';
import {
  pageProblem,
  ScrapeError,
  type ScrapeProvider,
  type ScrapeRequest,
} from '../src/price-intel/scrape-provider';
import { assertFetchable, FetchRefused } from '../src/price-intel/ssrf-guard';

const HEALTH_TIMEOUT_MS = 20_000;
const PAGE_TIMEOUT_MS = 90_000;

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

/** A vendor's settings from the environment: JSON the owner wrote, or nothing. */
function jsonSetting(name: string): Record<string, unknown> | null {
  const raw = env(name);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Reported below without the value.
  }
  throw new Error(`${name} must be a JSON object`);
}

interface Candidate {
  vendor: ScrapeVendor;
  label: string;
  /** What to set to check it. */
  needs: string;
  provider: ScrapeProvider | null;
  /** What the vendor needs to read a page (often nothing), or a sentence on what is missing. */
  settings: Record<string, unknown> | string;
}

function candidates(): Candidate[] {
  const costs = DEFAULT_SCRAPE_COSTS;
  const firecrawl = env('FIRECRAWL_API_KEY');
  const apify = env('APIFY_TOKEN');
  const browseAi = env('BROWSE_AI_API_KEY');
  const oxylabsUser = env('OXYLABS_USERNAME');
  const oxylabsPassword = env('OXYLABS_PASSWORD');
  const brightKey = env('BRIGHT_DATA_API_KEY');
  const brightZone = env('BRIGHT_DATA_ZONE');
  const actorId = env('SANDBOX_APIFY_ACTOR_ID');
  const actorInput = jsonSetting('SANDBOX_APIFY_INPUT');
  const robotId = env('SANDBOX_BROWSE_AI_ROBOT_ID');
  const robotInput = jsonSetting('SANDBOX_BROWSE_AI_INPUT');
  return [
    {
      vendor: 'firecrawl',
      label: 'Firecrawl',
      needs: 'FIRECRAWL_API_KEY',
      provider: firecrawl
        ? new FirecrawlScrapeProvider({ apiKey: firecrawl, costs: costs.firecrawl })
        : null,
      settings: {},
    },
    {
      vendor: 'apify',
      label: 'Apify',
      needs: 'APIFY_TOKEN',
      provider: apify ? new ApifyScrapeProvider({ token: apify, costs: costs.apify }) : null,
      settings:
        actorId && actorInput
          ? { actorId, input: actorInput }
          : 'set SANDBOX_APIFY_ACTOR_ID and SANDBOX_APIFY_INPUT to run an actor',
    },
    {
      vendor: 'browse_ai',
      label: 'Browse AI',
      needs: 'BROWSE_AI_API_KEY',
      provider: browseAi
        ? new BrowseAiScrapeProvider({ apiKey: browseAi, costs: costs.browse_ai })
        : null,
      settings:
        robotId && robotInput
          ? { robotId, inputParameters: robotInput }
          : 'set SANDBOX_BROWSE_AI_ROBOT_ID and SANDBOX_BROWSE_AI_INPUT to run a robot',
    },
    {
      vendor: 'oxylabs',
      label: 'Oxylabs',
      needs: 'OXYLABS_USERNAME and OXYLABS_PASSWORD',
      provider:
        oxylabsUser && oxylabsPassword
          ? new OxylabsScrapeProvider({
              username: oxylabsUser,
              password: oxylabsPassword,
              costs: costs.oxylabs,
            })
          : null,
      settings: {},
    },
    {
      vendor: 'bright_data',
      label: 'Bright Data',
      needs: 'BRIGHT_DATA_API_KEY and BRIGHT_DATA_ZONE',
      provider:
        brightKey && brightZone
          ? new BrightDataScrapeProvider({
              apiKey: brightKey,
              zone: brightZone,
              costs: costs.bright_data,
            })
          : null,
      settings: {},
    },
  ];
}

const failureOf = (error: unknown): string => {
  if (error instanceof ScrapeError) {
    const status = error.detail.httpStatus ? `, status ${error.detail.httpStatus}` : '';
    const reason = error.detail.reason ? `, ${error.detail.reason}` : '';
    return `${error.failure}${status}${reason}`;
  }
  return (error as Error).name;
};

async function checkKey(candidate: Candidate): Promise<boolean> {
  const provider = candidate.provider;
  if (!provider) return false;
  try {
    const health = await provider.health(AbortSignal.timeout(HEALTH_TIMEOUT_MS));
    if (!health.ok) {
      say('- The key was refused, or the account cannot spend.');
      return false;
    }
    say(
      health.remaining === null
        ? '- The key works.'
        : `- The key works. Left on the account: ${health.remaining}.`,
    );
    return true;
  } catch (error) {
    say(`- The account could not be asked: ${failureOf(error)}.`);
    return false;
  }
}

async function readPage(
  provider: ScrapeProvider,
  settings: Record<string, unknown>,
  page: { url: string; domain: string; country: string; locale: string },
): Promise<boolean> {
  const proxyClass = provider.capabilities.proxyClasses[0];
  if (!proxyClass) return false;
  const request: ScrapeRequest = {
    url: page.url,
    product: 'hotel',
    domain: page.domain,
    country: page.country,
    locale: page.locale,
    proxyClass,
    render: false,
    timeoutMs: PAGE_TIMEOUT_MS,
    settings,
  };
  const started = Date.now();
  try {
    const answer = await provider.run(request, AbortSignal.timeout(PAGE_TIMEOUT_MS));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const status = answer.httpStatus === null ? 'not reported' : String(answer.httpStatus);
    say(`- Proxy class ${proxyClass}, ${seconds} s. The site's status: ${status}.`);
    if (answer.html !== null) {
      const structured = /<script[^>]+application\/ld\+json/i.test(answer.html);
      say(
        `- A page came back: ${answer.html.length} characters${structured ? ', with structured data' : ''}.`,
      );
    }
    if (answer.items !== null) say(`- Items came back: ${answer.items.length}.`);
    say(
      answer.costMicroUsd === null
        ? `- The vendor did not say what it cost; the price list says ${provider.estimateCostMicroUsd(request, proxyClass)} micro-dollars.`
        : `- The vendor says it cost ${answer.costMicroUsd} micro-dollars.`,
    );
    const problem = pageProblem(answer);
    if (problem) {
      say(`- Our page check calls this ${problem}: the router would try again or move on.`);
      return false;
    }
    return true;
  } catch (error) {
    say(`- The read failed: ${failureOf(error)}.`);
    return false;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'own-page': { type: 'string' },
      country: { type: 'string', default: 'NG' },
      locale: { type: 'string', default: 'en-NG' },
    },
  });
  const ownPage = present(values['own-page']);
  const country = (values.country ?? 'NG').toUpperCase();
  const locale = values.locale ?? 'en-NG';
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('--country is a two-letter country code');
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale)) throw new Error('--locale looks like en-NG');

  let page: { url: string; domain: string; country: string; locale: string } | null = null;
  if (ownPage) {
    const domain = normaliseDomain(ownPage);
    if (!domain) throw new Error('--own-page must be an https address on a domain name');
    try {
      assertFetchable(ownPage, domain);
    } catch (error) {
      throw new Error(
        `--own-page was refused (${error instanceof FetchRefused ? error.code : 'invalid'}): use an https address with a host name`,
        { cause: error },
      );
    }
    page = { url: ownPage, domain, country, locale };
  }

  say('# Web-data vendor check');
  say();
  say(
    page
      ? `Each vendor reads one page of ${page.domain} once, as a visitor in ${country}.`
      : 'Keys only: no page is read. Pass --own-page with a page of your own website to read one.',
  );
  let ran = 0;
  let failed = 0;
  for (const candidate of candidates()) {
    say();
    say(`## ${candidate.label}`);
    if (!candidate.provider) {
      say(`- Skipped: set ${candidate.needs} to check it.`);
      continue;
    }
    ran++;
    let ok = await checkKey(candidate);
    if (ok && page) {
      if (typeof candidate.settings === 'string') say(`- No page read: ${candidate.settings}.`);
      else ok = await readPage(candidate.provider, candidate.settings, page);
    }
    if (!ok) failed++;
  }

  if (page) {
    // Our own fetcher needs no account: it says who it is and obeys the site's robots file.
    say();
    say('## Direct (our own fetcher)');
    const botUrl = env('PRICE_INTEL_BOT_URL');
    if (!botUrl) say('- Without PRICE_INTEL_BOT_URL it names no page about itself.');
    ran++;
    if (!(await readPage(new DirectScrapeProvider({ botUrl }), {}, page))) failed++;
  }

  say();
  if (ran === 0) say('No vendor had its keys set, so nothing was called.');
  else if (failed === 0) say(`All ${ran} checks passed.`);
  else say(`${failed} of ${ran} checks failed.`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join('\n')}\n`);
  if (ran === 0 || failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
