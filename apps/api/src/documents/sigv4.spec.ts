import { EMPTY_PAYLOAD_HASH, encodePath, signRequest } from './sigv4';

/**
 * The worked examples in the S3 documentation ("Signature Calculations for the Authorization
 * Header: Transferring Payload in a Single Chunk"), with AWS's example credentials.
 */
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('signRequest (SigV4)', () => {
  it('signs the documented GET Object example', () => {
    const headers = signRequest({
      ...credentials,
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { Range: 'bytes=0-9' },
      payloadHash: EMPTY_PAYLOAD_HASH,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_HASH);
  });

  it('signs the documented PUT Object example', () => {
    const headers = signRequest({
      ...credentials,
      method: 'PUT',
      host: 'examplebucket.s3.amazonaws.com',
      path: encodePath('/test$file.text'),
      headers: {
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('encodes each path segment and keeps the slashes', () => {
    expect(encodePath('/bucket/a b/c$d/e~f.pdf')).toBe('/bucket/a%20b/c%24d/e~f.pdf');
  });
});
