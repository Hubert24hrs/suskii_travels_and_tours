import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';

import { appConfig, setHostedServer } from '../config';
import { discoverHostedServer } from '../lib/hosted-server';
import { renderWithApp } from '../test/app';

import { ServerUnreachable } from './server-unreachable';

jest.mock('../config', () => ({
  appConfig: {
    variant: 'e2e',
    apiBaseUrl: 'http://localhost:4000',
    webBaseUrl: 'http://localhost:3000',
    customServer: false,
    testServerDiscoveryUrl: '',
    testServerStartUrl: '',
  },
  setHostedServer: jest.fn(),
  CLIENT_ID: 'mobile-android/0.1.0',
}));
jest.mock('../lib/hosted-server', () => ({ discoverHostedServer: jest.fn() }));

const m = getMessages('en-NG').mobile;
const config = appConfig as { testServerDiscoveryUrl: string; testServerStartUrl: string };
const HOSTED = {
  api: 'https://calm-river.trycloudflare.com',
  web: 'https://calm-river.trycloudflare.com',
  expiresAt: '2026-10-27T14:00:00Z',
};

describe('ServerUnreachable in the test build', () => {
  afterEach(() => {
    config.testServerDiscoveryUrl = '';
    config.testServerStartUrl = '';
  });

  it('tells the tester to run the stack and leads to Test server', async () => {
    const onRetry = jest.fn();
    await renderWithApp(<ServerUnreachable onRetry={onRetry} />);

    expect(screen.getByRole('alert', { name: m.home.unreachable })).toBeOnTheScreen();
    expect(screen.getByText(m.home.unreachableTestBuild)).toBeOnTheScreen();
    expect(screen.queryByTestId('server-start-test-server')).toBeNull();
    await fireEvent.press(screen.getByTestId('server-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(discoverHostedServer).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('server-set-test-server'));
    expect(router.push).toHaveBeenCalledWith('/account');
  });

  it('offers to start the online test server and looks for it again on Try again', async () => {
    config.testServerDiscoveryUrl = 'https://github.com/o/r/releases/download/test-server/x.json';
    config.testServerStartUrl = 'https://github.com/o/r/actions/workflows/test-server.yml';
    jest.mocked(discoverHostedServer).mockResolvedValue(HOSTED);
    const onRetry = jest.fn();
    await renderWithApp(<ServerUnreachable onRetry={onRetry} />);

    expect(screen.getByText(m.home.unreachableHosted)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('server-start-test-server'));
    expect(openBrowserAsync).toHaveBeenCalledWith(config.testServerStartUrl);

    await fireEvent.press(screen.getByTestId('server-retry'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(discoverHostedServer).toHaveBeenCalledWith(config.testServerDiscoveryUrl);
    expect(setHostedServer).toHaveBeenCalledWith(HOSTED);
  });
});
