import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { ProblemDetailsException, toProblemDetails } from './problem-details';
import { resolveRequestId } from './request-id';

describe('toProblemDetails', () => {
  it('maps custom problems with type URN and extensions', () => {
    const problem = toProblemDetails(
      new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation',
        'Validation failed',
        undefined,
        {
          errors: [{ path: 'email', message: 'Invalid email' }],
        },
      ),
    );
    expect(problem).toStrictEqual({
      type: 'urn:suskii:problem:validation',
      title: 'Validation failed',
      status: 422,
      errors: [{ path: 'email', message: 'Invalid email' }],
    });
  });

  it('keeps 4xx framework messages but hides 404 paths', () => {
    expect(toProblemDetails(new BadRequestException('Malformed JSON'))).toMatchObject({
      status: 400,
      detail: 'Malformed JSON',
    });
    expect(toProblemDetails(new NotFoundException('Cannot GET /secret/path'))).not.toHaveProperty(
      'detail',
    );
  });

  it('never exposes internals of 5xx or unknown errors', () => {
    expect(
      toProblemDetails(new InternalServerErrorException('db password wrong')),
    ).not.toHaveProperty('detail');
    expect(toProblemDetails(new Error('stack trace here'))).toStrictEqual({
      type: 'urn:suskii:problem:internal-server-error',
      title: 'Internal server error',
      status: 500,
    });
  });

  it('maps exposable middleware errors (malformed JSON, oversized body) to their 4xx status', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toProblemDetails(tooLarge)).toStrictEqual({
      type: 'urn:suskii:problem:payload-too-large',
      title: 'Payload too large',
      status: 413,
    });
    const malformed = Object.assign(new Error('Unexpected token'), { status: 400, expose: true });
    expect(toProblemDetails(malformed)).toMatchObject({ status: 400, title: 'Bad request' });
    const internal = Object.assign(new Error('boom'), { status: 503, expose: false });
    expect(toProblemDetails(internal).status).toBe(500);
  });
});

describe('resolveRequestId', () => {
  it('reuses safe upstream ids and replaces unsafe ones', () => {
    expect(resolveRequestId('abc-123_DEF.456')).toBe('abc-123_DEF.456');
    expect(resolveRequestId('bad id with spaces')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
