import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { type WorkerComponent } from './lifecycle.js';

export interface HealthServer extends WorkerComponent {
  /** Port actually bound (useful when configured with 0 in tests). */
  port(): number;
}

/**
 * Minimal liveness endpoint so orchestrators (Cloud Run, ECS, Kubernetes) can probe
 * the worker. Responds to GET /health only; everything else is 404.
 */
export function createHealthServer(port: number): HealthServer {
  const server: Server = createServer((req, res) => {
    const isHealth = req.method === 'GET' && req.url === '/health';
    res.writeHead(isHealth ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(isHealth ? { status: 'ok' } : { status: 'not_found' }));
  });

  return {
    name: 'health-server',
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.off('error', reject);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    port: () => (server.address() as AddressInfo | null)?.port ?? port,
  };
}
