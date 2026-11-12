import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DATA_REGISTRY } from './data-registry';
import {
  PROCESSING_ACTIVITIES,
  RECIPIENTS,
  personalDataModels,
  renderRecordsOfProcessing,
  type RecipientId,
} from './processing-records';

const DOC = resolve(__dirname, '../../../../docs/privacy/records-of-processing.md');

describe('records of processing and transfers (ADR-089)', () => {
  it('puts every table that holds personal data in an activity', () => {
    const covered = new Set(PROCESSING_ACTIVITIES.flatMap((activity) => activity.models));
    const missing = personalDataModels().filter((model) => !covered.has(model));
    expect(missing).toEqual([]);
  });

  it('lists only tables that hold personal data', () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const model of activity.models) {
        expect([activity.id, model, DATA_REGISTRY[model].deletion]).not.toEqual([
          activity.id,
          model,
          'none',
        ]);
      }
    }
  });

  it('names every recipient once and uses each one', () => {
    const used = new Set<RecipientId>(PROCESSING_ACTIVITIES.flatMap((a) => a.recipients));
    expect([...used].sort()).toEqual((Object.keys(RECIPIENTS) as RecipientId[]).sort());
    const ids = PROCESSING_ACTIVITIES.map((activity) => activity.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const activity of PROCESSING_ACTIVITIES) {
      expect(new Set(activity.recipients).size).toBe(activity.recipients.length);
      expect(activity.basis.length).toBeGreaterThan(0);
    }
  });

  it('sends personal data abroad only on a stated basis', () => {
    for (const recipient of Object.values(RECIPIENTS)) {
      if (recipient.transfer === 'no_personal_data') continue;
      expect(recipient.location.length).toBeGreaterThan(3);
    }
    // Ad networks receive anything only with marketing consent (ADR-079).
    expect(RECIPIENTS.ad_networks.transfer).toBe('consent');
  });

  it('matches the generated page (run `pnpm --filter @suskii/api privacy:records`)', () => {
    expect(readFileSync(DOC, 'utf8')).toBe(renderRecordsOfProcessing());
  });
});
