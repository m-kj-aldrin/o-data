import { test, expect, beforeEach } from 'bun:test';
import { OdataClient } from '../src';
import { coop_crm_schema } from './test-schema';

let capturedRequests: Request[] = [];

const mockTransport = async (req: Request) => {
  capturedRequests.push(req.clone());
  return new Response(JSON.stringify({}), { status: 200 });
};

const client = new OdataClient(coop_crm_schema, {
  baseUrl: 'https://demo.com/api/data/v9.0/',
  transport: mockTransport,
});

// Batch uses full pathname from request URL (e.g. /api/data/v9.0/incidents), not just entityset path
const batchPathPrefix = '/api/data/v9.0';

beforeEach(() => {
  capturedRequests = [];
});

function getRequestBodyText(req: Request): Promise<string> {
  return req.text();
}

test('$batch - mix queries and CUD into correct groups', async () => {
  const batch = client.batch();

  // GET collection (no changeset)
  batch.entitysets('incidents').query({
    select: ['title'],
  });

  // POST create (changeset)
  batch.entitysets('incidents').create({
    title: 'Created from batch',
  });

  // PATCH update (changeset)
  batch
    .entitysets('incidents')
    .key('guid-123')
    .update({
      title: 'Updated from batch',
    });

  await batch.execute();

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;

  expect(req.method).toBe('POST');
  expect(req.url).toBe('https://demo.com/api/data/v9.0/$batch');

  const contentType = req.headers.get('Content-Type');
  expect(contentType).toContain('multipart/mixed; boundary=');

  const body = await getRequestBodyText(req);

  // Query should be outside any changeset (full path inside batch)
  expect(body).toContain(`GET ${batchPathPrefix}/incidents?$select=title HTTP/1.1`);

  // Create and update should be inside changeset with POST/PATCH (full path)
  expect(body).toContain('Content-Type: multipart/mixed; boundary=changeset_');
  expect(body).toContain(`POST ${batchPathPrefix}/incidents HTTP/1.1`);
  expect(body).toContain(`PATCH ${batchPathPrefix}/incidents(guid-123) HTTP/1.1`);

  // Create body should include the payload
  expect(body).toContain('"title":"Created from batch"');
  expect(body).toContain('"title":"Updated from batch"');
});

test('$batch - delete in changeset', async () => {
  const batch = client.batch();
  batch.entitysets('incidents').key('guid-456').delete();

  await batch.execute();

  expect(capturedRequests.length).toBe(1);
  const body = await getRequestBodyText(capturedRequests[0]!);
  expect(body).toContain(`DELETE ${batchPathPrefix}/incidents(guid-456) HTTP/1.1`);
  expect(body).toContain('Content-ID: 1');
});

test('$batch - execute returns parsed results', async () => {
  const boundary = 'batchresponse_test123';
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: application/json; odata.metadata=minimal',
    'OData-Version: 4.0',
    '',
    '{"@odata.context":"https://demo.com/$metadata#incidents","value":[{"incidentid":"a","title":"First"}]}',
    `--${boundary}`,
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: application/json; odata.metadata=minimal',
    'OData-Version: 4.0',
    '',
    '{"@odata.context":"https://demo.com/$metadata#activitymimeattachments","@odata.count":2,"value":[]}',
    `--${boundary}--`,
  ].join('\r\n');

  const batchClient = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: async () =>
      new Response(multipartBody, {
        status: 200,
        headers: {
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
      }),
  });

  const batch = batchClient.batch();
  batch.entitysets('incidents').query({ select: ['title'] });
  batch.entitysets('incidents').query({ select: ['incidentid'], top: 1 });

  const result = await batch.execute();

  expect(result.ok).toBe(true);
  expect(result.status).toBe(200);
  expect(result.results).toHaveLength(2);

  expect(result.results[0]!.ok).toBe(true);
  expect(result.results[0]!.status).toBe(200);
  expect(result.results[0]!.result).toEqual({
    '@odata.context': 'https://demo.com/$metadata#incidents',
    value: [{ incidentid: 'a', title: 'First' }],
  });

  expect(result.results[1]!.ok).toBe(true);
  expect(result.results[1]!.status).toBe(200);
  expect(result.results[1]!.result).toEqual({
    '@odata.context': 'https://demo.com/$metadata#activitymimeattachments',
    '@odata.count': 2,
    value: [],
  });
});

