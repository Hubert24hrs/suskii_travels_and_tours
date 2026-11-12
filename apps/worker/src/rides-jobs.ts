import { UnrecoverableError } from 'bullmq';

import {
  InternalApiError,
  type DriverDocumentScanRun,
  type RideDispatchRun,
  type RidesApi,
} from './internal-api.js';
import { type Logger } from './logger.js';

/**
 * Cars rides (ADR-053): matching runs every few seconds through the API's internal route, which
 * starts scheduled rides, expires unanswered offers, ends searches nobody accepted (refunded in
 * full) and offers each waiting ride to the nearest eligible driver. The API holds a lock, so
 * overlapping runs from several workers do nothing. Driver documents whose background virus
 * scan was lost are scanned again every few minutes.
 */
export const RIDES_QUEUE = 'rides';

export const RIDE_JOB = {
  dispatch: 'rides-dispatch',
  driverDocuments: 'driver-documents-scan',
} as const;

export interface RideJobDeps {
  api: RidesApi;
  logger: Logger;
}

async function sweep<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InternalApiError && !error.retryable) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}

export async function processRideJob(
  job: { name: string },
  deps: RideJobDeps,
): Promise<RideDispatchRun | DriverDocumentScanRun> {
  switch (job.name) {
    case RIDE_JOB.dispatch: {
      const result = await sweep(() => deps.api.dispatchRides());
      if (result.offered > 0 || result.started > 0) deps.logger.debug(result, 'rides dispatched');
      if (result.timedOut > 0) {
        deps.logger.warn({ timedOut: result.timedOut }, 'rides found no driver and were refunded');
      }
      return result;
    }
    case RIDE_JOB.driverDocuments: {
      const result = await sweep(() => deps.api.scanDueDriverDocuments());
      if (result.scanned > 0) deps.logger.info(result, 'driver documents scanned');
      return result;
    }
    default:
      throw new UnrecoverableError(`Unknown rides job: ${job.name}`);
  }
}
