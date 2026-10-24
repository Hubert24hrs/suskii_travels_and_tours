import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';

import { appConfig } from '../../config';
import { testServer } from '../../lib/test-server';
import { renderWithApp } from '../../test/app';

import { TestServerCard } from './test-server-card';

jest.mock('../../config', () => ({
  appConfig: {
    variant: 'e2e',
    apiBaseUrl: 'http://localhost:4000',
    webBaseUrl: 'http://localhost:3000',
    customServer: false,
  },
  CLIENT_ID: 'mobile-android/0.1.0',
}));
/** The mocked config, so a case can switch the build variant. */
const config = appConfig as { variant: string };

const m = getMessages('en-NG').mobile.account.testServer;

describe('TestServerCard', () => {
  beforeEach(() => testServer.clear());

  it('points a test build at the tester’s own stack after checking both addresses', async () => {
    await renderWithApp(<TestServerCard />);
    expect(screen.getByText('In use: http://localhost:4000')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('test-server-api'), '192.168.1.20:4000');
    await fireEvent.press(screen.getByTestId('test-server-save'));
    expect(screen.getByText(m.invalid)).toBeOnTheScreen();
    expect(testServer.read()).toBeNull();

    await fireEvent.changeText(screen.getByTestId('test-server-api'), 'http://192.168.1.20:4000');
    await fireEvent.changeText(screen.getByTestId('test-server-web'), 'http://192.168.1.20:3000');
    await fireEvent.press(screen.getByTestId('test-server-save'));
    expect(await screen.findByText(m.saved)).toBeOnTheScreen();
    expect(testServer.read()).toEqual({
      api: 'http://192.168.1.20:4000',
      web: 'http://192.168.1.20:3000',
    });
  });

  it('shows nothing in builds for the stores', async () => {
    config.variant = 'production';
    try {
      await renderWithApp(<TestServerCard />);
      expect(screen.queryByTestId('test-server')).toBeNull();
    } finally {
      config.variant = 'e2e';
    }
  });
});
