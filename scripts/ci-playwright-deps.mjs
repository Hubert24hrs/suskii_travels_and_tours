#!/usr/bin/env node
/**
 * Chromium's system packages for the Playwright tests in CI.
 *
 * `playwright install-deps` asks apt for Chromium's libraries and a set of fallback fonts. The
 * runner image already carries the libraries, so what apt adds there is the fonts. When the
 * Ubuntu mirrors cannot be reached (on 2026-11-11 their names did not resolve from the hosted
 * runners for over an hour, and every verify job ended before a single test had run), that
 * alone should not fail the job. This script tries apt. When apt fails it starts the browser
 * the tests use on what the image has, says so in a warning, and lets the job go on.
 *
 * Nothing is skipped: a browser that cannot start fails here, and a screenshot that differs
 * without the fonts fails the visual tests, under a warning that says why.
 *
 *   node scripts/ci-playwright-deps.mjs [--package @suskii/ui-web] [--browser chromium]
 *
 * Exits 1 when the packages could not be installed and the browser does not start without them.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** A healthy install takes well under a minute; apt gives up by itself only after ten. */
const INSTALL_TIMEOUT_MS = 6 * 60_000;
const LAUNCH_TIMEOUT_MS = 2 * 60_000;

/** Starts the browser and draws a page: what a test does first. */
export const launchScript = (browser) =>
  [
    "import('playwright').then(async (playwright) => {",
    `  const browser = await playwright[${JSON.stringify(browser)}].launch({`,
    '    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,',
    '  });',
    '  const page = await browser.newPage();',
    "  await page.setContent('<p>ok</p>');",
    '  await browser.close();',
    '});',
  ].join('\n');

/**
 * `installed` when apt did its work, `image` when it could not and the browser starts on what
 * the image has. Throws when neither holds.
 */
export function ensureBrowserDeps({ install, launch, warn }) {
  if (install()) return 'installed';
  if (!launch()) {
    throw new Error(
      'The system packages could not be installed and the browser does not start without them.',
    );
  }
  warn(
    "apt could not install Playwright's system packages (see the log above). The browser starts on the runner image's own libraries, so the job goes on without the fallback fonts apt would have added. A visual test that fails below may be failing for that reason.",
  );
  return 'image';
}

function main() {
  const { values } = parseArgs({
    options: {
      package: { type: 'string', default: '@suskii/ui-web' },
      browser: { type: 'string', default: 'chromium' },
    },
  });
  const inPackage = (args, timeout) =>
    spawnSync('pnpm', ['--filter', values.package, 'exec', ...args], {
      stdio: 'inherit',
      timeout,
    }).status === 0;
  try {
    const outcome = ensureBrowserDeps({
      install: () => inPackage(['playwright', 'install-deps', values.browser], INSTALL_TIMEOUT_MS),
      launch: () => inPackage(['node', '-e', launchScript(values.browser)], LAUNCH_TIMEOUT_MS),
      warn: (message) => console.log(`::warning title=Playwright system packages::${message}`),
    });
    console.log(
      outcome === 'installed'
        ? 'System packages installed.'
        : "Going on with the runner image's own libraries.",
    );
  } catch (error) {
    console.error(`::error title=Playwright system packages::${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
