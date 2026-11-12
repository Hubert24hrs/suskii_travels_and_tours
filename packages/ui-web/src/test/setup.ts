import { setProjectAnnotations } from '@storybook/react-vite';
import { configure } from 'storybook/test';
import { beforeAll } from 'vitest';

import * as previewAnnotations from '../../.storybook/preview';

// Apply the same global CSS, decorators and parameters Storybook uses.
const annotations = setProjectAnnotations([previewAnnotations]);

beforeAll(annotations.beforeAll);

// Popover and dialog content mounts after an animation frame and a lazy chunk; on a loaded CI
// machine (a full `turbo run` builds Next.js alongside) that took over the default 1 second.
configure({ asyncUtilTimeout: 5000 });
