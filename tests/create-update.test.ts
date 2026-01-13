import { test, expect, beforeEach } from 'bun:test';
import { OdataClient } from '../src';
import { coop_crm_schema } from './test-schema';

// ============================================================================
// Setup
// ============================================================================

// Capture Request objects (not just URLs)
let capturedRequests: Request[] = [];

// Mock transport that captures requests
const mockTransport = async (req: Request, init?: RequestInit) => {
  // Clone the request to capture it (since body is a stream)
  const clonedReq = req.clone();
  capturedRequests.push(clonedReq);
  
  // Return appropriate status codes
  const method = req.method;
  const status = method === 'POST' ? 201 : method === 'PATCH' ? 204 : 200;
  return new Response(JSON.stringify({}), { status });
};

// Shared client instance
const client = new OdataClient(coop_crm_schema, {
  baseUrl: 'https://demo.com/api/data/v9.0/',
  transport: mockTransport,
});

// Reset captured requests before each test
beforeEach(() => {
  capturedRequests = [];
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract and parse JSON body from request
 */
async function getRequestBody(req: Request): Promise<any> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Assert that a navigation property has been transformed to @odata.bind format
 */
function expectBind(payload: any, navProperty: string, expectedValue: any) {
  const bindKey = `${navProperty}@odata.bind`;
  expect(payload[bindKey]).toEqual(expectedValue);
  expect(payload[navProperty]).toBeUndefined();
}

/**
 * Assert that no bind exists for a navigation property (for deep inserts)
 */
function expectNoBind(payload: any, navProperty: string) {
  const bindKey = `${navProperty}@odata.bind`;
  expect(payload[bindKey]).toBeUndefined();
}

/**
 * Assert that a navigation property contains a nested object (deep insert)
 */
function expectDeepInsert(payload: any, navProperty: string, expectedObject: any) {
  expect(payload[navProperty]).toEqual(expectedObject);
  expectNoBind(payload, navProperty);
}

/**
 * Extract HTTP method from request
 */
function getRequestMethod(req: Request): string {
  return req.method;
}

/**
 * Extract full URL from request
 */
function getRequestUrl(req: Request): string {
  return req.url;
}

/**
 * Extract path from URL (without base URL)
 */
function getRequestPath(req: Request): string {
  const url = new URL(req.url);
  return url.pathname;
}

/**
 * Extract query string from URL
 */
function getQueryString(req: Request): string {
  const url = new URL(req.url);
  return url.search;
}

/**
 * Get header value from request
 */
function getHeader(req: Request, headerName: string): string | null {
  return req.headers.get(headerName);
}

// ============================================================================
// Create Operation Tests
// ============================================================================

test('create - simple create (no navigation)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test Incident',
    description: 'Test description',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  expect(getRequestMethod(req)).toBe('POST');
  expect(getRequestPath(req)).toBe('/incidents');
  
  const body = await getRequestBody(req);
  expect(body.title).toBe('Test Incident');
  expect(body.description).toBe('Test description');
  expect(body.incident_contact).toBeUndefined();
  expect(body['incident_contact@odata.bind']).toBeUndefined();
});

test('create - single-valued navigation bind (string ID)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: 'guid-123',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'incident_contact', '/contacts(guid-123)');
  expect(body.title).toBe('Test');
});

test('create - single-valued navigation bind (numeric ID)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: 42,
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'incident_contact', '/contacts(42)');
});

test('create - single-valued navigation bind (explicit entityset)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: ['contacts', 'guid-123'],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'incident_contact', '/contacts(guid-123)');
});

test('create - collection navigation bind (array of string IDs)', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: ['guid-1', 'guid-2'],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'contact_incidents', ['/incidents(guid-1)', '/incidents(guid-2)']);
});

test('create - collection navigation bind (array of numeric IDs)', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: [1, 2],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'contact_incidents', ['/incidents(1)', '/incidents(2)']);
});

test('create - collection navigation bind (explicit entitysets)', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: [['incidents', 'guid-1'], ['incidents', 'guid-2']],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'contact_incidents', ['/incidents(guid-1)', '/incidents(guid-2)']);
});

test('create - batch reference (single-valued)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: '$1',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'incident_contact', '$1');
});

test('create - batch reference (collection)', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: ['$1', '$2'],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'contact_incidents', ['$1', '$2']);
});

test('create - deep insert (single-valued navigation)', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: {
      name: 'John',
      email: 'john@example.com',
    },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectDeepInsert(body, 'incident_contact', {
    name: 'John',
    email: 'john@example.com',
  });
});

test('create - deep insert with nested navigation bind', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    incident_contact: {
      name: 'John',
      contact_incidents: ['guid-1'],
    },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.incident_contact).toBeDefined();
  expect(body.incident_contact.name).toBe('John');
  expectBind(body.incident_contact, 'contact_incidents', ['/incidents(guid-1)']);
});

test('create - deep insert with nested deep insert', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: [
      {
        title: 'Incident 1',
        incident_contact: { name: 'Jane' },
      },
    ],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(Array.isArray(body.contact_incidents)).toBe(true);
  expect(body.contact_incidents.length).toBe(1);
  expect(body.contact_incidents[0].title).toBe('Incident 1');
  expect(body.contact_incidents[0].incident_contact).toEqual({ name: 'Jane' });
});

test('create - mixed scenario', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    description: 'Description',
    incident_contact: 'guid-123',
    status: 'Active',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.title).toBe('Test');
  expect(body.description).toBe('Description');
  expect(body.status).toBe('Active');
  expectBind(body, 'incident_contact', '/contacts(guid-123)');
});

test('create - with options (select)', async () => {
  await client.entitysets('incidents').create(
    {
      title: 'Test',
    },
    {
      select: ['title', 'description'],
    }
  );

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const queryString = getQueryString(req);
  expect(queryString).toContain('$select=title,description');
  
  const preferHeader = getHeader(req, 'Prefer');
  expect(preferHeader).toContain('return=representation');
});

test('create - with options (prefer return representation)', async () => {
  await client.entitysets('incidents').create(
    {
      title: 'Test',
    },
    {
      prefer: {
        return_representation: true,
      },
    }
  );

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const preferHeader = getHeader(req, 'Prefer');
  expect(preferHeader).toContain('return=representation');
});

// ============================================================================
// Update Operation Tests
// ============================================================================

test('update - simple update (no navigation)', async () => {
  await client.entitysets('incidents').key('guid-123').update({
    title: 'Updated Title',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  expect(getRequestMethod(req)).toBe('PATCH');
  expect(getRequestPath(req)).toBe('/incidents(guid-123)');
  
  const body = await getRequestBody(req);
  expect(body.title).toBe('Updated Title');
});

test('update - single-valued navigation bind', async () => {
  await client.entitysets('incidents').key('guid-123').update({
    incident_contact: 'guid-456',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expectBind(body, 'incident_contact', '/contacts(guid-456)');
});

test('update - set navigation to null', async () => {
  await client.entitysets('incidents').key('guid-123').update({
    incident_contact: null,
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.incident_contact).toBeNull();
  expect(body['incident_contact@odata.bind']).toBeUndefined();
});

test('update - collection navigation replace', async () => {
  await client.entitysets('contacts').key('guid-123').update({
    contact_incidents: { replace: ['guid-1', 'guid-2'] },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(body.contact_incidents.replace).toEqual(['/incidents(guid-1)', '/incidents(guid-2)']);
});

test('update - collection navigation add', async () => {
  await client.entitysets('contacts').key('guid-123').update({
    contact_incidents: { add: ['guid-3'] },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(body.contact_incidents.add).toEqual(['/incidents(guid-3)']);
});

test('update - collection navigation remove', async () => {
  await client.entitysets('contacts').key('guid-123').update({
    contact_incidents: { remove: ['guid-1'] },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(body.contact_incidents.remove).toEqual(['/incidents(guid-1)']);
});

test('update - collection navigation replace with explicit entitysets', async () => {
  await client.entitysets('contacts').key('guid-123').update({
    contact_incidents: { replace: [['incidents', 'guid-1'], ['incidents', 'guid-2']] },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(body.contact_incidents.replace).toEqual(['/incidents(guid-1)', '/incidents(guid-2)']);
});

test('update - collection navigation operations with batch references', async () => {
  await client.entitysets('contacts').key('guid-123').update({
    contact_incidents: { add: ['$1', '$2'] },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  expect(body.contact_incidents).toBeDefined();
  expect(body.contact_incidents.add).toEqual(['$1', '$2']);
});

test('update - with options (select)', async () => {
  await client.entitysets('incidents').key('guid-123').update(
    {
      title: 'Updated',
    },
    {
      select: ['title'],
    }
  );

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const queryString = getQueryString(req);
  expect(queryString).toContain('$select=title');
});

test('update - with options (prefer return representation)', async () => {
  await client.entitysets('incidents').key('guid-123').update(
    {
      title: 'Updated',
    },
    {
      prefer: {
        return_representation: true,
      },
    }
  );

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const preferHeader = getHeader(req, 'Prefer');
  expect(preferHeader).toContain('return=representation');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('create - empty array for collection navigation', async () => {
  await client.entitysets('contacts').create({
    name: 'John',
    contact_incidents: [],
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  // Empty array should be handled gracefully
  expect(body.contact_incidents).toBeDefined();
  expect(Array.isArray(body.contact_incidents)).toBe(true);
  expect(body.contact_incidents.length).toBe(0);
});

test('create - invalid navigation property', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
    non_existent_nav: 'value',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const body = await getRequestBody(req);
  
  // Non-existent navigation should pass through unchanged
  expect(body.non_existent_nav).toBe('value');
  expect(body['non_existent_nav@odata.bind']).toBeUndefined();
});

test('create - Content-Type header', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const contentType = getHeader(req, 'Content-Type');
  expect(contentType).toBe('application/json');
});

test('create - Accept header', async () => {
  await client.entitysets('incidents').create({
    title: 'Test',
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0]!;
  const acceptHeader = getHeader(req, 'Accept');
  expect(acceptHeader).toBe('application/json');
});
