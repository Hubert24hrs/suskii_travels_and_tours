import { z } from './zod-setup';

import {
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_MESSAGE_MAX,
  STATUS_INCIDENT_STAGES,
  STATUS_INCIDENT_TITLE_MAX,
  STATUS_COMPONENTS,
} from './status-page';

const componentsSchema = z
  .array(z.enum(STATUS_COMPONENTS))
  .min(1)
  .max(STATUS_COMPONENTS.length)
  .refine((list) => new Set(list).size === list.length, 'Each component once');

/** Public text staff write for the status page: trimmed, not empty, capped. */
const messageSchema = z.string().trim().min(1).max(STATUS_INCIDENT_MESSAGE_MAX);

/** Opening an incident (ADR-087): what is wrong, how badly, where, and the first update. */
export const statusIncidentCreateSchema = z.object({
  title: z.string().trim().min(1).max(STATUS_INCIDENT_TITLE_MAX),
  impact: z.enum(STATUS_INCIDENT_IMPACTS),
  components: componentsSchema,
  status: z.enum(STATUS_INCIDENT_STAGES).exclude(['resolved']),
  message: messageSchema,
});
export type StatusIncidentCreateInput = z.infer<typeof statusIncidentCreateSchema>;

/**
 * An update: the new stage and what travellers should know. Impact and components may change as
 * the picture becomes clearer; `resolved` closes the incident.
 */
export const statusIncidentUpdateSchema = z.object({
  status: z.enum(STATUS_INCIDENT_STAGES),
  message: messageSchema,
  impact: z.enum(STATUS_INCIDENT_IMPACTS).optional(),
  components: componentsSchema.optional(),
});
export type StatusIncidentUpdateInput = z.infer<typeof statusIncidentUpdateSchema>;
