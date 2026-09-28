import { BRAND } from '@suskii/shared';
import { render, screen } from '@testing-library/react-native';

import { HomeScreen } from './home-screen';

describe('HomeScreen', () => {
  it('renders the brand as the screen heading', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('header', { name: BRAND.shortName })).toBeOnTheScreen();
  });
});
