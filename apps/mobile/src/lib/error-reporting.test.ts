import { installErrorReporting } from './error-reporting';

jest.mock('../config', () => ({
  appConfig: {
    sentryDsn: 'https://pubkey@o1.ingest.sentry.io/77',
    version: '1.2.3',
    variant: 'preview',
  },
}));

describe('installErrorReporting', () => {
  const original = ErrorUtils.getGlobalHandler();
  afterEach(() => ErrorUtils.setGlobalHandler(original));

  it('reports uncaught errors, then hands them to the previous handler', async () => {
    const fetch = jest.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    global.fetch = fetch;
    const previous = jest.fn();
    ErrorUtils.setGlobalHandler(previous);
    installErrorReporting();

    const error = new Error('render failed for ada@example.com');
    ErrorUtils.getGlobalHandler()(error, false);
    expect(previous).toHaveBeenCalledWith(error, false);
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain('https://o1.ingest.sentry.io/api/77/envelope/?sentry_version=7');
    const event = JSON.parse(init.body.split('\n')[2] ?? '{}') as Record<string, unknown>;
    expect(event).toMatchObject({
      release: '1.2.3',
      environment: 'preview',
      tags: { service: 'mobile', kind: 'uncaught' },
    });
    expect(init.body).not.toContain('ada@example.com');
  });

  it('waits for the report of a fatal error before the app goes down', async () => {
    let sendReport: (response: Response) => void = () => undefined;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => (sendReport = resolve)));
    const previous = jest.fn();
    ErrorUtils.setGlobalHandler(previous);
    installErrorReporting();

    ErrorUtils.getGlobalHandler()(new Error('fatal'), true);
    await Promise.resolve();
    expect(previous).not.toHaveBeenCalled();
    sendReport(new Response(null, { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previous).toHaveBeenCalledTimes(1);
  });
});
