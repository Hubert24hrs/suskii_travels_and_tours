# @suskii/api-client

Typed client for the Suskii API, shared by web, admin and mobile.

- `src/schema.ts` is **generated** from `apps/api/openapi.json` by openapi-typescript. Never edit it.
- `createApiClient()` wraps openapi-fetch: paths, params, bodies and responses are all typed.
- `createApiHooks()` returns TanStack Query hooks (openapi-react-query).

## Regenerate

```powershell
pnpm generate:api   # builds the API, writes apps/api/openapi.json, regenerates src/schema.ts
```

CI regenerates both files and fails if the committed versions differ, then typechecks this package,
so a contract change that breaks the client fails the build.

## Usage

```ts
import { createApiClient, createApiHooks, isProblemDetails } from '@suskii/api-client';

// Web (cookie transport): the browser sends the httpOnly session cookies; the CSRF cookie value is
// echoed on state-changing requests.
const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL!,
  credentials: 'include',
  getCsrfToken: () => readCookie('__Secure-suskii_csrf'),
});

// Mobile (token transport): the access token comes from expo-secure-store.
const mobileApi = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL!,
  getAccessToken: () => SecureStore.getItemAsync('suskii.accessToken'),
});

const { data, error } = await api.GET('/v1/me');
if (isProblemDetails(error)) console.warn(error.title);

const hooks = createApiHooks(api);
// hooks.useQuery('get', '/v1/me')
```

Errors are RFC 9457 problem details (`application/problem+json`); `isProblemDetails` narrows them.
