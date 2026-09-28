import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  RequestMethod,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { z } from 'zod';

import { ProblemDetailsException } from '../common/problem-details';

import { CONTRACT, type RouteContract } from './contract';

export interface ValidationIssue {
  location: 'body' | 'query' | 'params';
  path: string;
  code: string;
  message: string;
}

function validate(
  schema: z.ZodType | undefined,
  value: unknown,
  location: ValidationIssue['location'],
  issues: ValidationIssue[],
): unknown {
  if (!schema) return value;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    // Messages and codes only: never echo the submitted value (it may be a password).
    issues.push({ location, path: issue.path.join('.'), code: issue.code, message: issue.message });
  }
  return value;
}

@Injectable()
export class ContractInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ContractInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT, handler);
    if (!contract || context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const issues: ValidationIssue[] = [];
    const params = validate(contract.params, request.params, 'params', issues);
    const query = validate(contract.query, request.query, 'query', issues);
    const body = validate(contract.body, request.body ?? {}, 'body', issues);
    if (issues.length > 0) {
      throw new ProblemDetailsException(
        HttpStatus.BAD_REQUEST,
        'validation-failed',
        'Validation failed',
        'One or more fields are invalid.',
        { errors: issues },
      );
    }
    request.params = params as Request['params'];
    // Express 5 exposes `query` as a getter; redefine it with the parsed value.
    Object.defineProperty(request, 'query', { value: query, writable: true, configurable: true });
    request.body = body;

    const explicitCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, handler);
    const isPost =
      this.reflector.get<RequestMethod>(METHOD_METADATA, handler) === RequestMethod.POST;
    const declared = explicitCode ?? (isPost ? HttpStatus.CREATED : HttpStatus.OK);

    return next.handle().pipe(
      map((data: unknown) => {
        const response = http.getResponse<Response>();
        // Handlers may set a status explicitly (e.g. readiness 503); otherwise use the declared one.
        const current: number = response.statusCode;
        const status = current === Number(HttpStatus.OK) ? declared : current;
        if (!(status in contract.responses)) {
          this.logger.error(`${contract.operationId} returned undocumented status ${status}`);
          throw new InternalServerErrorException();
        }
        const schema = contract.responses[status];
        if (!schema) return undefined;
        const result = schema.safeParse(data);
        if (!result.success) {
          this.logger.error(
            { issues: result.error.issues },
            `${contract.operationId} response violates its contract`,
          );
          throw new InternalServerErrorException();
        }
        return result.data;
      }),
    );
  }
}
