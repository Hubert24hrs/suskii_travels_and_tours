import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';

import * as previewAnnotations from '../../.storybook/preview';

// Apply the same global CSS, decorators and parameters Storybook uses.
const annotations = setProjectAnnotations([previewAnnotations]);

beforeAll(annotations.beforeAll);
