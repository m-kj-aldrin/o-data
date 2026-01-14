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
  const status = method === 'POST' ? 200 : method === 'GET' ? 200 : 200;
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
  // Remove the base URL path to get just the entityset path
  // Base URL is 'https://demo.com/api/data/v9.0/'
  // So we need to extract everything after '/api/data/v9.0'
  const pathname = url.pathname;
  const basePath = '/api/data/v9.0';
  if (pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length);
  }
  return pathname;
}

/**
 * Extract query string from URL
 */
function getQueryString(url: string): string {
  const urlObj = new URL(url);
  return urlObj.search;
}

/**
 * Parse query parameters into object
 */
function parseQueryParams(url: string): Record<string, string> {
  const urlObj = new URL(url);
  const params: Record<string, string> = {};
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

// ============================================================================
// Test Cases
// ============================================================================

test('bound action - uses FQN in URL', async () => {
  await client
    .entitysets('incidents')
    .key('guid-123')
    .action('assignIncident', {
      parameters: {
        assigneeId: 'guid-456',
        priority: 1,
      },
    });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0];

  // Verify method
  expect(getRequestMethod(req)).toBe('POST');

  // Verify URL path contains FQN
  const path = getRequestPath(req);
  expect(path).toBe('/incidents(guid-123)/Microsoft.Dynamics.CRM.assignIncident');

  // Verify body
  const body = await getRequestBody(req);
  expect(body).toEqual({
    assigneeId: 'guid-456',
    priority: 1,
  });
});

test('unbound action - uses import name, no FQN', async () => {
  await client.action('BulkCreate', {
    parameters: {
      entities: ['1', '2', '3'],
    },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0];

  // Verify method
  expect(getRequestMethod(req)).toBe('POST');

  // Verify URL path uses import name (not FQN)
  const path = getRequestPath(req);
  expect(path).toBe('/BulkCreate');
  expect(path).not.toContain('Microsoft.Dynamics.CRM');
  expect(path).not.toContain('bulkCreate');

  // Verify body
  const body = await getRequestBody(req);
  expect(body).toEqual({
    entities: ['1', '2', '3'],
  });
});

test('bound function - uses FQN in URL', async () => {
  await client
    .entitysets('incidents')
    .key('guid-123')
    .function('getRelatedCount', {
      parameters: {
        relationType: 'contact',
      },
    });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0];

  // Verify method
  expect(getRequestMethod(req)).toBe('GET');

  // Verify URL path contains FQN
  const fullUrl = getRequestUrl(req);
  const path = getRequestPath(req);
  expect(path).toBe('/incidents(guid-123)/Microsoft.Dynamics.CRM.getRelatedCount(relationType=@relationType)');

  // Verify query string contains parameter value
  const queryString = getQueryString(fullUrl);
  expect(queryString).toContain('@relationType');
  
  const queryParams = parseQueryParams(fullUrl);
  expect(queryParams['@relationType']).toBe("'contact'");
});

test('unbound function - uses import name, no FQN', async () => {
  await client.function('Search', {
    parameters: {
      query: 'test',
      entityTypes: ['Incident', 'Contact'],
    },
  });

  expect(capturedRequests.length).toBe(1);
  const req = capturedRequests[0];

  // Verify method
  expect(getRequestMethod(req)).toBe('GET');

  // Verify URL path uses import name (not FQN)
  const fullUrl = getRequestUrl(req);
  const path = getRequestPath(req);
  expect(path).toBe('/Search(query=@query,entityTypes=@entityTypes)');
  expect(path).not.toContain('Microsoft.Dynamics.CRM');
  expect(path).not.toContain('searchEntities');

  // Verify query string contains parameter values
  const queryString = getQueryString(fullUrl);
  expect(queryString).toContain('@query');
  expect(queryString).toContain('@entityTypes');
  
  const queryParams = parseQueryParams(fullUrl);
  expect(queryParams['@query']).toBe("'test'");
  // entityTypes should be JSON stringified and URL encoded
  expect(queryParams['@entityTypes']).toContain('Incident');
  expect(queryParams['@entityTypes']).toContain('Contact');
});
