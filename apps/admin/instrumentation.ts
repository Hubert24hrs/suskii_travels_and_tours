import type { Instrumentation } from 'next';

/**
 * Server errors (rendering, route handlers and the proxy) go to Sentry with the route template
 * and the request id the proxy assigned (ADR-046).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { reportError } = await import('./lib/error-reporter');
  const requestId = request.headers['x-request-id'];
  await reportError(error, {
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
    ...(typeof requestId === 'string' ? { requestId } : {}),
  });
};
