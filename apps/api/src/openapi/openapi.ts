import { RequestMethod, VERSION_NEUTRAL, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { z } from 'zod';

import { IS_PUBLIC } from '../auth/decorators';
import { CONTRACT, fileResponses, schemaRegistry, type RouteContract } from '../contract/contract';
import { IS_INTERNAL } from '../internal/internal-route';

import { PROBLEM_DETAILS_SCHEMA } from './problem.schema';

type JsonSchema = Record<string, unknown>;
type VersionValue = string | symbol | (string | symbol)[];
type Io = 'input' | 'output';

interface MediaContent {
  schema: JsonSchema;
}

export interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

export type ResponseObject =
  { description: string; content?: Record<string, MediaContent> } | { $ref: string };

export interface OperationObject {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  security?: Record<string, string[]>[];
  parameters: ParameterObject[];
  requestBody?: { required: boolean; content: Record<string, MediaContent> };
  responses: Record<string, ResponseObject>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OperationObject>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
  security: Record<string, string[]>[];
}

export const ACCESS_TOKEN_COOKIE = '__Secure-suskii_at';

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'Validation failed',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable content',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

/** Formats already express these patterns; the long regexes only add noise to the document. */
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

const FORMATS_WITH_REDUNDANT_PATTERNS = new Set([
  'uuid',
  'email',
  'date-time',
  'date',
  'ipv4',
  'ipv6',
]);

class SchemaCollector {
  readonly components: Record<string, JsonSchema> = {};
  /** Every problem status referenced by an operation gets a reusable response component. */
  readonly problemStatuses = new Set<number>();

  convert(schema: z.ZodType, io: Io): JsonSchema {
    const json = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      metadata: schemaRegistry,
      unrepresentable: 'any',
    }) as JsonSchema;
    const defs = (json.$defs ?? {}) as Record<string, JsonSchema>;
    delete json.$defs;
    delete json.$schema;
    const rename = (id: string): string => (io === 'input' ? `${id}Input` : id);
    for (const [id, def] of Object.entries(defs)) {
      this.components[rename(id)] = this.clean(def, rename);
    }
    return this.clean(json, rename);
  }

  private clean(node: JsonSchema, rename: (id: string) => string): JsonSchema {
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (value === null || typeof value !== 'object') return value;
      const out: JsonSchema = {};
      for (const [key, child] of Object.entries(value as JsonSchema)) {
        if (key === '$schema' || key === '$id') continue;
        if (key === '$ref' && typeof child === 'string' && child.startsWith('#/$defs/')) {
          out.$ref = `#/components/schemas/${rename(child.slice('#/$defs/'.length))}`;
          continue;
        }
        out[key] = visit(child);
      }
      if (typeof out.format === 'string' && FORMATS_WITH_REDUNDANT_PATTERNS.has(out.format))
        delete out.pattern;
      return out;
    };
    return visit(node) as JsonSchema;
  }
}

function joinPath(...segments: (string | undefined)[]): string {
  const path = segments
    .flatMap((segment) => (segment ?? '').split('/'))
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/');
  return `/${path}`;
}

function versionPrefix(version: VersionValue | undefined): string {
  if (version === VERSION_NEUTRAL) return '';
  const value = Array.isArray(version) ? version[0] : version;
  return `v${typeof value === 'string' ? value : '1'}`;
}

function parameters(
  collector: SchemaCollector,
  schema: z.ZodType | undefined,
  location: 'path' | 'query',
): ParameterObject[] {
  if (!schema) return [];
  const json = collector.convert(schema, 'input');
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required ?? []) as string[]);
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: propertySchema,
    ...(typeof propertySchema.description === 'string'
      ? { description: propertySchema.description }
      : {}),
  }));
}

type Access = 'user' | 'public' | 'internal';

function operation(
  collector: SchemaCollector,
  contract: RouteContract,
  method: string,
  access: Access,
): OperationObject {
  const isPublic = access === 'public';
  const responses: Record<string, ResponseObject> = {};
  for (const [status, schema] of Object.entries(contract.responses).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    const fileType = schema ? fileResponses.get(schema) : undefined;
    responses[status] = {
      description: STATUS_TEXT[Number(status)] ?? 'Response',
      ...(fileType
        ? { content: { [fileType]: { schema: { type: 'string', format: 'binary' } } } }
        : schema
          ? { content: { 'application/json': { schema: collector.convert(schema, 'output') } } }
          : {}),
    };
  }
  const errorStatuses = [
    ...new Set([400, ...(contract.errors ?? []), ...(isPublic ? [] : [401]), 429, 500]),
  ].sort((a, b) => a - b);
  for (const status of errorStatuses) {
    collector.problemStatuses.add(status);
    responses[String(status)] = { $ref: `#/components/responses/Problem${status}` };
  }

  const headerParameters: ParameterObject[] = [
    ...(contract.headers ?? []).map((header) => ({
      name: header.name,
      in: 'header' as const,
      required: header.required,
      description: header.description,
      schema: { type: 'string' },
    })),
    ...(contract.idempotent
      ? [
          {
            name: 'Idempotency-Key',
            in: 'header' as const,
            required: true,
            description:
              'Unique key (8-128 chars) per logical operation; retries with the same key replay the first response for 24 hours.',
            schema: { type: 'string', minLength: 8, maxLength: 128 },
          },
        ]
      : []),
    ...(UNSAFE_METHODS.has(method) && access !== 'internal'
      ? [
          {
            name: 'X-CSRF-Token',
            in: 'header' as const,
            required: false,
            description:
              'Required when the request is authenticated with session cookies: echo the csrf cookie value.',
            schema: { type: 'string' },
          },
        ]
      : []),
  ];

  return {
    operationId: contract.operationId,
    summary: contract.summary,
    ...(contract.description ? { description: contract.description } : {}),
    tags: contract.tags,
    ...(isPublic ? { security: [] } : {}),
    ...(access === 'internal' ? { security: [{ internalToken: [] }] } : {}),
    parameters: [
      ...parameters(collector, contract.params, 'path'),
      ...parameters(collector, contract.query, 'query'),
      ...headerParameters,
    ],
    ...(contract.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: collector.convert(contract.body, 'input') } },
          },
        }
      : {}),
    responses,
  };
}

/** Builds the OpenAPI 3.1 document from every route that declares a `@Contract()`. */
export function buildOpenApiDocument(app: INestApplication): OpenApiDocument {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const collector = new SchemaCollector();
  const paths: OpenApiDocument['paths'] = {};
  const seenOperationIds = new Set<string>();

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    const metatype = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;
    const controllerPath = reflector.get<string | undefined>(PATH_METADATA, metatype);
    const controllerVersion = reflector.get<VersionValue | undefined>(VERSION_METADATA, metatype);
    const controllerPublic = reflector.get<boolean | undefined>(IS_PUBLIC, metatype) === true;

    for (const methodName of scanner.getAllMethodNames(Object.getPrototypeOf(instance) as object)) {
      const handler = instance[methodName] as (...args: unknown[]) => unknown;
      const contract = reflector.get<RouteContract | undefined>(CONTRACT, handler);
      if (!contract) continue;
      if (seenOperationIds.has(contract.operationId)) {
        throw new Error(`Duplicate operationId: ${contract.operationId}`);
      }
      seenOperationIds.add(contract.operationId);

      const method =
        RequestMethod[reflector.get<RequestMethod>(METHOD_METADATA, handler)].toLowerCase();
      const version =
        reflector.get<VersionValue | undefined>(VERSION_METADATA, handler) ?? controllerVersion;
      const path = joinPath(
        versionPrefix(version),
        controllerPath,
        reflector.get<string>(PATH_METADATA, handler),
      );
      const isPublic =
        controllerPublic || reflector.get<boolean | undefined>(IS_PUBLIC, handler) === true;
      const isInternal =
        reflector.get<boolean | undefined>(IS_INTERNAL, metatype) === true ||
        reflector.get<boolean | undefined>(IS_INTERNAL, handler) === true;
      const access: Access = isInternal ? 'internal' : isPublic ? 'public' : 'user';
      paths[path] = { ...paths[path], [method]: operation(collector, contract, method, access) };
    }
  }

  const problemResponses = Object.fromEntries(
    [...collector.problemStatuses]
      .sort((a, b) => a - b)
      .map((status) => [
        `Problem${status}`,
        {
          description: STATUS_TEXT[status],
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
          },
        },
      ]),
  );

  const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

  return {
    openapi: '3.1.0',
    info: {
      title: 'Suskii Travels API',
      version: '1.0.0',
      description:
        'One API for the Suskii website, mobile app and admin console. Browser clients authenticate with httpOnly cookies plus an X-CSRF-Token header; mobile clients send a bearer access token. Errors use RFC 9457 problem details.',
    },
    paths: sortKeys(paths),
    components: {
      schemas: sortKeys({ ...collector.components, ProblemDetails: PROBLEM_DETAILS_SCHEMA }),
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: ACCESS_TOKEN_COOKIE },
        internalToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Service token for /v1/internal routes (worker only, ADR-011).',
        },
      },
      responses: problemResponses,
    },
    // Authenticated by default; public operations override with `security: []`.
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  };
}
