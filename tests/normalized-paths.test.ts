import { test, expect } from 'bun:test';
import { OdataClient } from 'o-data';
import { microsoft_dynamics_crm_schema } from '../demo/schema/generated-o-data-schema';

// Helper function to create a client with a mock transport that captures URLs
function createClientWithCapturedUrls(baseUrl: string) {
  const capturedUrls: string[] = [];

  const transport = async (input: Request | URL, init?: RequestInit) => {
    let url: string;
    if (input instanceof Request) {
      url = input.url;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = String(input);
    }
    capturedUrls.push(url);

    // Return appropriate mock responses based on the request
    const request = input instanceof Request ? input : new Request(url, init);
    const method = request.method;
    const contentType = request.headers.get('content-type') || '';

    // Handle batch requests
    if (contentType.includes('multipart/mixed')) {
      // Return a mock batch response
      const boundary = 'batchresponse';
      const batchResponse = [
        `--${boundary}`,
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'HTTP/1.1 200 OK',
        'Content-Type: application/json',
        '',
        JSON.stringify({ value: [] }),
        `--${boundary}--`,
      ].join('\r\n');

      return new Response(batchResponse, {
        status: 200,
        headers: {
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
      });
    }

    // For queries, return collection response
    if (method === 'GET') {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }

    // For creates/updates with return representation, return entity
    if (method === 'POST' || method === 'PATCH') {
      const preferHeader = request.headers.get('Prefer');
      if (preferHeader?.includes('return=representation')) {
        return new Response(JSON.stringify({ id: '123' }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }

    // For deletes
    if (method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  };

  return {
    client: new OdataClient(microsoft_dynamics_crm_schema, { baseUrl, transport }),
    capturedUrls,
    clearUrls: () => (capturedUrls.length = 0),
  };
}

// Helper to check if URL has double slashes (excluding protocol)
function hasDoubleSlashes(url: string): boolean {
  // Remove protocol part (e.g., "https://")
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  // Check for double slashes in the path
  return withoutProtocol.includes('//');
}

// Helper to get path from URL (excluding protocol and query string)
function getPath(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch {
    // If URL parsing fails, try to extract path manually
    const match = url.match(/https?:\/\/[^\/]+(\/.*?)(?:\?|$)/);
    return match && match[1] ? match[1] : '';
  }
}

// ============================================================================
// Tests for baseUrl + path combinations
// ============================================================================

test('baseUrl ending with / + path should normalize to single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('contacts').query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts');
});

test('baseUrl not ending with / + path should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('contacts').query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts');
});

// ============================================================================
// Tests for path + navigation property
// ============================================================================

test('path + navigation property with baseUrl ending with / should join with single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('contacts').key('123').navigate('incident_customer_contacts').query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)/incident_customer_contacts');
});

test('path + navigation property with baseUrl not ending with / should normalize correctly', async () => {
  // This test checks if the path construction handles baseUrl without trailing slash correctly
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('contacts').key('123').navigate('incident_customer_contacts').query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)/incident_customer_contacts');
});

test('nested navigation paths with baseUrl ending with / should be normalized', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client
    .entitysets('incidents')
    .key('789')
    .navigate('customerid_contact')
    .navigate('incident_customer_contacts')
    .query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/incidents(789)/customerid_contact/incident_customer_contacts');
});

test('nested navigation paths with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client
    .entitysets('incidents')
    .key('789')
    .navigate('customerid_contact')
    .navigate('incident_customer_contacts')
    .query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/incidents(789)/customerid_contact/incident_customer_contacts');
});

// ============================================================================
// Tests for path + action/function
// ============================================================================

test('path + action with baseUrl ending with / should join with single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client
    .entitysets('emails')
    .key('email123')
    .action('SendEmail', {
      parameters: { IssueSend: false, TrackingToken: undefined },
    });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/emails(email123)/Microsoft.Dynamics.CRM.SendEmail');
});

test('path + action with baseUrl not ending with / should join with single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client
    .entitysets('emails')
    .key('email123')
    .action('SendEmail', {
      parameters: { IssueSend: false, TrackingToken: undefined },
    });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/emails(email123)/Microsoft.Dynamics.CRM.SendEmail');
});

test('path + function with baseUrl ending with / should join with single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.function('In', {
    parameters: { PropertyName: 'test', PropertyValues: ['a', 'b'] },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe(
    '/api/Microsoft.Dynamics.CRM.In(PropertyName=@PropertyName,PropertyValues=@PropertyValues)'
  );
});

test('path + function with baseUrl not ending with / should join with single /', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.function('In', {
    parameters: { PropertyName: 'test', PropertyValues: ['a', 'b'] },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe(
    '/api/Microsoft.Dynamics.CRM.In(PropertyName=@PropertyName,PropertyValues=@PropertyValues)'
  );
});

test('path + action with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client
    .entitysets('emails')
    .key('email456')
    .action('SendEmail', {
      parameters: { IssueSend: true, TrackingToken: 'token123' },
    });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/emails(email456)/Microsoft.Dynamics.CRM.SendEmail');
});

test('path + action with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client
    .entitysets('emails')
    .key('email456')
    .action('SendEmail', {
      parameters: { IssueSend: true, TrackingToken: 'token123' },
    });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/emails(email456)/Microsoft.Dynamics.CRM.SendEmail');
});

// ============================================================================
// Tests for create/update/delete operations
// ============================================================================

test('create request with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('contacts').create({
    firstname: 'John',
    lastname: 'Doe',
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts');
});

test('create request with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('contacts').create({
    firstname: 'John',
    lastname: 'Doe',
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts');
});

test('update request with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('contacts').key('123').update({
    firstname: 'Jane',
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)');
});

test('update request with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('contacts').key('123').update({
    firstname: 'Jane',
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)');
});

test('delete request with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('contacts').key('123').delete();

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)');
});

test('delete request with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('contacts').key('123').delete();

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/contacts(123)');
});

// ============================================================================
// Edge cases
// ============================================================================

test('baseUrl with multiple trailing slashes should normalize', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api///');

  await client.entitysets('contacts').query({});

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  // The final URL should not have multiple consecutive slashes
  const path = getPath(url);
  // Replace multiple slashes with single slash (but keep protocol)
  const normalizedPath = path.replace(/\/+/g, '/');
  expect(path).toBe(normalizedPath);
});

test('query with expand with baseUrl ending with / should maintain normalized paths', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.entitysets('incidents').query({
    expand: {
      customerid_contact: {},
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/incidents');
});

test('query with expand with baseUrl not ending with / should maintain normalized paths', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.entitysets('incidents').query({
    expand: {
      customerid_contact: {},
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/incidents');
});

test('batch request with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.batch((bb) => {
    return {
      query1: bb.entitysets('contacts').query({}),
    };
  });

  // Batch requests go to $batch endpoint
  const batchUrls = capturedUrls.filter((url) => url.includes('$batch'));
  expect(batchUrls.length).toBeGreaterThan(0);

  // Check the batch URL itself
  const batchUrl = batchUrls[0];
  expect(batchUrl).toBeDefined();
  if (!batchUrl) return;
  expect(hasDoubleSlashes(batchUrl)).toBe(false);
  expect(getPath(batchUrl)).toBe('/api/$batch');
});

test('batch request with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.batch((bb) => {
    return {
      query1: bb.entitysets('contacts').query({}),
    };
  });

  // Batch requests go to $batch endpoint
  const batchUrls = capturedUrls.filter((url) => url.includes('$batch'));
  expect(batchUrls.length).toBeGreaterThan(0);

  // Check the batch URL itself
  const batchUrl = batchUrls[0];
  expect(batchUrl).toBeDefined();
  if (!batchUrl) return;
  expect(hasDoubleSlashes(batchUrl)).toBe(false);
  expect(getPath(batchUrl)).toBe('/api/$batch');
});

test('global action with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.action('CloseIncident', {
    parameters: {
      IncidentResolution: {},
      Status: 1,
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/CloseIncident');
});

test('global action with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.action('CloseIncident', {
    parameters: {
      IncidentResolution: {},
      Status: 1,
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe('/api/CloseIncident');
});

test('global function with baseUrl ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api/');

  await client.function('In', {
    parameters: {
      PropertyName: 'test',
      PropertyValues: ['a'],
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe(
    '/api/Microsoft.Dynamics.CRM.In(PropertyName=@PropertyName,PropertyValues=@PropertyValues)'
  );
});

test('global function with baseUrl not ending with / should normalize correctly', async () => {
  const { client, capturedUrls } = createClientWithCapturedUrls('https://demo.com/api');

  await client.function('In', {
    parameters: {
      PropertyName: 'test',
      PropertyValues: ['a'],
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0];
  expect(url).toBeDefined();
  if (!url) return;
  expect(hasDoubleSlashes(url)).toBe(false);
  expect(getPath(url)).toBe(
    '/api/Microsoft.Dynamics.CRM.In(PropertyName=@PropertyName,PropertyValues=@PropertyValues)'
  );
});
