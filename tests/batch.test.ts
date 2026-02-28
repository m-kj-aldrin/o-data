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

