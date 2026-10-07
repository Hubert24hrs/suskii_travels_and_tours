import {
  WEB_VITALS_DEVICES,
  WEB_VITALS_PAGES,
  WEB_VITAL_MAX,
  WEB_VITAL_NAMES,
  type WebVitalName,
} from '@suskii/shared';
import { z } from 'zod';

import { named } from '../contract/contract';

const metric = <N extends WebVitalName>(name: N) =>
  z.object({
    name: z.literal(name),
    value: z.number().nonnegative().max(WEB_VITAL_MAX[name]),
  });

export const webVitalsReportSchema = named(
  'WebVitalsReport',
  z.object({
    page: z.enum(WEB_VITALS_PAGES).meta({ description: 'The page template, never the URL.' }),
    device: z.enum(WEB_VITALS_DEVICES),
    metrics: z
      .array(
        z.discriminatedUnion('name', [
          metric('LCP'),
          metric('INP'),
          metric('CLS'),
          metric('FCP'),
          metric('TTFB'),
        ]),
      )
      .min(1)
      .max(WEB_VITAL_NAMES.length)
      .refine((items) => new Set(items.map((item) => item.name)).size === items.length, {
        message: 'Each metric at most once per report',
      })
      .meta({
        description:
          'Milliseconds, except CLS (unitless). The latest value of each metric for the page view.',
      }),
  }),
);
