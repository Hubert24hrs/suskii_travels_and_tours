import type { Preview } from '@storybook/react-vite';

import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    // Fail the a11y panel (and the automated story tests) on any violation.
    a11y: { test: 'error' },
    controls: { expanded: true },
  },
};

export default preview;
