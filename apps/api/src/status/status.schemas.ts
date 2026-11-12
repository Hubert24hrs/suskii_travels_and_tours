import { z } from 'zod';

import {
  COMPONENT_STATES,
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_STAGES,
  STATUS_COMPONENTS,
  statusIncidentCreateSchema,
  statusIncidentUpdateSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();

export const incidentUpdateEntrySchema = named(
  'StatusIncidentUpdate',
  z.object({
    status: z.enum(STATUS_INCIDENT_STAGES),
    message: z.string(),
    createdAt: timestamp,
  }),
);

/** An incident as the public sees it: no staff names, updates newest first. */
export const statusIncidentSchema = named(
  'StatusIncident',
  z.object({
    id: z.uuid(),
    title: z.string(),
    impact: z.enum(STATUS_INCIDENT_IMPACTS),
    status: z.enum(STATUS_INCIDENT_STAGES),
    components: z.array(z.enum(STATUS_COMPONENTS)),
    startedAt: timestamp,
    resolvedAt: timestamp.nullable(),
    updates: z.array(incidentUpdateEntrySchema),
  }),
);

export const statusPageSchema = named(
  'StatusPage',
  z.object({
    state: z.enum(COMPONENT_STATES).meta({ description: 'The worst state of any component.' }),
    components: z.array(
      z.object({ id: z.enum(STATUS_COMPONENTS), state: z.enum(COMPONENT_STATES) }),
    ),
    incidents: z.array(statusIncidentSchema).meta({
      description: `Open incidents, then incidents resolved in the last days, newest first.`,
    }),
    updatedAt: timestamp.meta({ description: 'When these states were measured.' }),
  }),
);

export const adminIncidentQuerySchema = z.object({
  state: z.enum(['open', 'resolved']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminIncidentParamsSchema = z.object({ id: z.uuid() });

export const adminIncidentPageSchema = named(
  'AdminStatusIncidentPage',
  z.object({ items: z.array(statusIncidentSchema), nextCursor: z.uuid().nullable() }),
);

export const adminIncidentCreateSchema = named('StatusIncidentCreate', statusIncidentCreateSchema);
export const adminIncidentUpdateSchema = named(
  'StatusIncidentUpdateInput',
  statusIncidentUpdateSchema,
);
