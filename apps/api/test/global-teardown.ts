export default async function globalTeardown(): Promise<void> {
  await Promise.all((globalThis.__E2E_CONTAINERS__ ?? []).map((container) => container.stop()));
}
