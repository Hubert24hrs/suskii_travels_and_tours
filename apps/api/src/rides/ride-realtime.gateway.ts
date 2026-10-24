import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';

import { sessionCookieNames } from '../auth/cookies';
import { SessionService } from '../auth/session.service';
import { AccessTokenService } from '../auth/tokens/access-token.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { carsFeatureEnabled } from '../ground/cars-flags';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

import { driverChannel, rideChannel } from './ride-events.publisher';

export const RIDES_SOCKET_PATH = '/v1/ws/rides';

/** Close codes (4000-4999 are application defined). */
export const WS_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  tooManyConnections: 4429,
  rateLimited: 4408,
  expired: 4419,
} as const;

const AUTH_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 25_000;
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_MESSAGES_PER_SECOND = 20;
const MAX_PAYLOAD_BYTES = 4096;

const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('auth'), token: z.string().min(1).max(4096) }),
  z.strictObject({ type: z.literal('subscribe'), rideId: z.uuid() }),
  z.strictObject({ type: z.literal('unsubscribe'), rideId: z.uuid() }),
]);

interface Client {
  socket: WebSocket;
  userId: string | null;
  sessionId: string | null;
  driverId: string | null;
  channels: Set<string>;
  alive: boolean;
  windowStart: number;
  windowCount: number;
  authTimer: NodeJS.Timeout | null;
  expiryTimer: NodeJS.Timeout | null;
}

/** Answers an upgrade with an HTTP error and drops the connection. */
function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

/** Parses a Cookie header (no decoding beyond what the session cookies need). */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Live ride updates over WebSocket (ADR-052): plain `ws` on the API's HTTP server at
 * `/v1/ws/rides`. Browsers authenticate with the session cookie from an allowed origin; apps
 * send their access token as the first message. A client may follow only rides it rides, drives
 * or is offered (anything else answers `not_found`), and drivers also receive their offers.
 * Messages fan out through Redis pub/sub, so any replica can serve any client.
 */
@Injectable()
export class RideRealtimeGateway implements OnModuleDestroy {
  private readonly logger = new Logger(RideRealtimeGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  private readonly clients = new Map<WebSocket, Client>();
  private readonly followers = new Map<string, Set<Client>>();
  private readonly connections = new Map<string, number>();
  private readonly allowedOrigins: Set<string>;
  private subscriber: Redis | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private server: Server | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {
    this.allowedOrigins = new Set(config.CORS_ORIGINS.map((origin) => new URL(origin).origin));
  }

  /** Handles upgrades on the API's HTTP server (main.ts and the e2e app call this once). */
  attach(server: Server): void {
    if (this.server) return;
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.beat(), PING_INTERVAL_MS);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.server?.off('upgrade', this.onUpgrade);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.wss.clients) socket.terminate();
    this.wss.close();
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber) await subscriber.quit().catch(() => subscriber.disconnect());
  }

  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== RIDES_SOCKET_PATH || !carsFeatureEnabled(this.config, 'rides')) {
      refuse(socket, '404 Not Found');
      return;
    }
    const cookieToken = cookieValue(request.headers.cookie, sessionCookieNames(this.config).access);
    if (cookieToken) {
      // Cookies ride along on cross-site upgrades: only allowed origins may use them.
      const origin = request.headers.origin;
      if (!origin || !this.allowedOrigins.has(origin)) {
        refuse(socket, '403 Forbidden');
        return;
      }
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.onConnection(ws, cookieToken);
    });
  };

  private async onConnection(socket: WebSocket, cookieToken: string | undefined): Promise<void> {
    const client: Client = {
      socket,
      userId: null,
      sessionId: null,
      driverId: null,
      channels: new Set(),
      alive: true,
      windowStart: Date.now(),
      windowCount: 0,
      authTimer: null,
      expiryTimer: null,
    };
    this.clients.set(socket, client);
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => this.cleanup(client));
    socket.on('error', () => socket.terminate());
    socket.on('message', (data, isBinary) => {
      void this.onMessage(client, data, isBinary);
    });
    if (cookieToken) {
      await this.authenticate(client, cookieToken);
    } else {
      client.authTimer = setTimeout(() => {
        if (!client.userId) socket.close(WS_CLOSE.unauthenticated, 'authentication required');
      }, AUTH_TIMEOUT_MS);
    }
  }

  private async onMessage(client: Client, data: RawData, isBinary: boolean): Promise<void> {
    const now = Date.now();
    if (now - client.windowStart >= 1000) {
      client.windowStart = now;
      client.windowCount = 0;
    }
    client.windowCount += 1;
    if (client.windowCount > MAX_MESSAGES_PER_SECOND) {
      client.socket.close(WS_CLOSE.rateLimited, 'too many messages');
      return;
    }
    if (isBinary) {
      this.send(client, { type: 'error', code: 'invalid_message' });
      return;
    }
    let parsed: z.infer<typeof clientMessageSchema>;
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]).toString('utf8');
      parsed = clientMessageSchema.parse(JSON.parse(text));
    } catch {
      this.send(client, { type: 'error', code: 'invalid_message' });
      return;
    }

    if (parsed.type === 'auth') {
      if (client.userId) {
        this.send(client, { type: 'error', code: 'already_authenticated' });
        return;
      }
      await this.authenticate(client, parsed.token);
      return;
    }
    if (!client.userId || !client.sessionId) {
      client.socket.close(WS_CLOSE.unauthenticated, 'authentication required');
      return;
    }
    if (await this.sessions.isRevoked(client.sessionId)) {
      client.socket.close(WS_CLOSE.unauthenticated, 'session ended');
      return;
    }
    if (parsed.type === 'subscribe') {
      if (!(await this.mayFollow(client, parsed.rideId))) {
        this.send(client, { type: 'error', code: 'not_found', rideId: parsed.rideId });
        return;
      }
      await this.follow(client, rideChannel(parsed.rideId));
      this.send(client, { type: 'subscribed', rideId: parsed.rideId });
      return;
    }
    await this.unfollow(client, rideChannel(parsed.rideId));
    this.send(client, { type: 'unsubscribed', rideId: parsed.rideId });
  }

  private async authenticate(client: Client, token: string): Promise<void> {
    if (client.authTimer) clearTimeout(client.authTimer);
    client.authTimer = null;
    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      client.socket.close(WS_CLOSE.unauthenticated, 'invalid token');
      return;
    }
    if (await this.sessions.isRevoked(claims.sid)) {
      client.socket.close(WS_CLOSE.unauthenticated, 'session ended');
      return;
    }
    const count = this.connections.get(claims.sub) ?? 0;
    if (count >= MAX_CONNECTIONS_PER_USER) {
      client.socket.close(WS_CLOSE.tooManyConnections, 'too many connections');
      return;
    }
    if (client.socket.readyState !== WebSocket.OPEN) return;
    this.connections.set(claims.sub, count + 1);
    client.userId = claims.sub;
    client.sessionId = claims.sid;
    // A socket lives no longer than one access token; clients reconnect with a fresh one.
    client.expiryTimer = setTimeout(
      () => client.socket.close(WS_CLOSE.expired, 'token expired'),
      this.config.ACCESS_TOKEN_TTL_SECONDS * 1000,
    );
    client.expiryTimer.unref();
    const driver = claims.roles.includes('driver')
      ? await this.prisma.driver.findUnique({ where: { userId: claims.sub }, select: { id: true } })
      : null;
    if (driver) {
      client.driverId = driver.id;
      await this.follow(client, driverChannel(driver.id));
    }
    this.send(client, { type: 'ready', driver: Boolean(driver) });
  }

  /** The rider, the assigned driver, or a driver holding an open offer for the ride. */
  private async mayFollow(client: Client, rideId: string): Promise<boolean> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { riderUserId: true, driverId: true },
    });
    if (!ride) return false;
    if (ride.riderUserId === client.userId) return true;
    if (!client.driverId) return false;
    if (ride.driverId === client.driverId) return true;
    const offer = await this.prisma.rideOffer.findFirst({
      where: { rideId, driverId: client.driverId, status: 'open' },
      select: { id: true },
    });
    return offer !== null;
  }

  private async follow(client: Client, channel: string): Promise<void> {
    if (client.channels.has(channel)) return;
    client.channels.add(channel);
    let set = this.followers.get(channel);
    if (!set) {
      set = new Set();
      this.followers.set(channel, set);
      await this.ensureSubscriber().subscribe(channel);
    }
    set.add(client);
  }

  private async unfollow(client: Client, channel: string): Promise<void> {
    if (!client.channels.delete(channel)) return;
    const set = this.followers.get(channel);
    set?.delete(client);
    if (set?.size === 0) {
      this.followers.delete(channel);
      await this.subscriber?.unsubscribe(channel).catch(() => undefined);
    }
  }

  private ensureSubscriber(): Redis {
    if (!this.subscriber) {
      const subscriber = this.redis.duplicate({ lazyConnect: false });
      subscriber.on('message', (channel: string, payload: string) => {
        for (const client of this.followers.get(channel) ?? []) {
          if (client.socket.readyState === WebSocket.OPEN) client.socket.send(payload);
        }
      });
      subscriber.on('error', (error: Error) => {
        this.logger.warn({ reason: error.name }, 'ride realtime subscriber error');
      });
      this.subscriber = subscriber;
    }
    return this.subscriber;
  }

  private cleanup(client: Client): void {
    this.clients.delete(client.socket);
    if (client.authTimer) clearTimeout(client.authTimer);
    if (client.expiryTimer) clearTimeout(client.expiryTimer);
    if (client.userId) {
      const left = (this.connections.get(client.userId) ?? 1) - 1;
      if (left <= 0) this.connections.delete(client.userId);
      else this.connections.set(client.userId, left);
    }
    for (const channel of [...client.channels]) void this.unfollow(client, channel);
  }

  /** Pings every socket; one that missed the previous ping, or whose session ended, closes. */
  private beat(): void {
    for (const [socket, client] of this.clients) {
      if (!client.alive) {
        socket.terminate();
        continue;
      }
      client.alive = false;
      socket.ping();
      if (client.sessionId) {
        const sessionId = client.sessionId;
        void this.sessions.isRevoked(sessionId).then(
          (revoked) => {
            if (revoked) socket.close(WS_CLOSE.unauthenticated, 'session ended');
          },
          () => undefined,
        );
      }
    }
  }

  private send(client: Client, message: Record<string, unknown>): void {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(message));
  }
}
