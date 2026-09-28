/** RFC 9457 problem details, as documented in the OpenAPI components. */
export const PROBLEM_DETAILS_SCHEMA = {
  type: 'object',
  description: 'RFC 9457 problem details (application/problem+json).',
  properties: {
    type: {
      type: 'string',
      description: 'Problem type URN, e.g. urn:suskii:problem:validation-failed',
    },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    requestId: { type: 'string', description: 'Quote this when contacting support.' },
    errors: {
      type: 'array',
      description: 'Field-level validation issues (validation-failed only).',
      items: {
        type: 'object',
        properties: {
          location: { type: 'string', enum: ['body', 'query', 'params'] },
          path: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['location', 'path', 'code', 'message'],
      },
    },
  },
  required: ['type', 'title', 'status'],
} as const;
