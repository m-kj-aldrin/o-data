import { test, expect, beforeEach } from 'bun:test';
import { OdataClient } from '../src';
import { coop_crm_schema } from './test-schema';

// Each test suite has its own captured URLs array
let capturedUrls: string[] = [];

// Each test suite has its own mock transport
const mockTransport = async (req: Request, init?: RequestInit) => {
  capturedUrls.push(req.url);
  return new Response(JSON.stringify({ value: [] }), { status: 200 });
};

// Each test suite has its own client instance
const client = new OdataClient(coop_crm_schema, {
  baseUrl: 'https://demo.com/api/data/v9.0/',
  transport: mockTransport,
});

// Reset captured URLs before each test
beforeEach(() => {
  capturedUrls = [];
});

// Helper function to parse query string from URL
function parseQueryString(url: string): Record<string, string | undefined> {
  const urlObj = new URL(url);
  const params: Record<string, string | undefined> = {};
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value || undefined;
  });
  return params;
}

// Helper function to get a query parameter value, returning undefined if not present
function getQueryParam(url: string, param: string): string | undefined {
  const urlObj = new URL(url);
  return urlObj.searchParams.get(param) || undefined;
}

// Helper function to get query string from URL
function getQueryString(url: string): string {
  const urlObj = new URL(url);
  return urlObj.search;
}

// ============================================================================
// Collection Query Tests
// ============================================================================

test('collection query - basic select parameter', async () => {
  await client.entitysets('incidents').query({
    select: ['title', 'description'],
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$select']).toBe('title,description');
});

test('collection query - basic expand parameter', async () => {
  await client.entitysets('incidents').query({
    expand: { incident_contact: {} },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$expand']).toBe('incident_contact');
});

test('collection query - expand with nested select', async () => {
    await client.entitysets('incidents').query({
      expand: {
        incident_contact: {
          select: ['email', 'name'],
        },
      },
    });

    expect(capturedUrls.length).toBe(1);
    const url = capturedUrls[0]!;
    const queryParams = parseQueryString(url);
    expect(queryParams['$expand']).toBe('incident_contact($select=email,name)');
  });

test('collection query - top parameter', async () => {
  await client.entitysets('incidents').query({
    top: 10,
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$top']).toBe('10');
});

test('collection query - skip parameter', async () => {
  await client.entitysets('incidents').query({
    skip: 20,
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$skip']).toBe('20');
});

test('collection query - count parameter', async () => {
  await client.entitysets('incidents').query({
    count: true,
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$count']).toBe('true');
});

test('collection query - orderby parameter', async () => {
  await client.entitysets('incidents').query({
    orderby: ['title', 'asc'],
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$orderby']).toBe('title asc');
});

test('collection query - orderby desc parameter', async () => {
  await client.entitysets('incidents').query({
    orderby: ['title', 'desc'],
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$orderby']).toBe('title desc');
});

test('collection query - filter parameter simple equality', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('title', 'eq', 'Test'),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$filter']).toBe("title eq 'Test'");
});

test('collection query - filter parameter comparison operators', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('title', 'ne', 'Other'),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$filter']).toBe("title ne 'Other'");
});

test('collection query - filter parameter and condition', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('title', 'eq', 'Test').and(h.clause('description', 'ne', null)),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  // Note: This will need proper serialization of 'and' conditions
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  if (filterValue) {
    expect(filterValue).toContain('title eq');
    expect(filterValue).toContain('description ne');
  }
});

test('collection query - filter parameter navigation property', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.nav('incident_contact', (nh) => nh.clause('email', 'eq', 'test@example.com')),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  // Note: Navigation filters will need proper path serialization
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  if (filterValue) {
    expect(filterValue).toContain('incident_contact');
    expect(filterValue).toContain('email');
  }
});

test('collection query - filter parameter enum value with member name', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('status', 'eq', 'Active'),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  // Enum values should use FQN format: Namespace.EnumType'MemberName'
  expect(filterValue).toBe("status eq Microsoft.Dynamics.CRM.IncidentStatus'Active'");
});

test('collection query - filter parameter enum value with numeric value', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('status', 'eq', 1), // Resolved = 1
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  // Numeric enum values should be mapped to member names with FQN format
  expect(filterValue).toBe("status eq Microsoft.Dynamics.CRM.IncidentStatus'Resolved'");
});

test('collection query - filter parameter enum value with different members', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('status', 'eq', 'Cancelled'),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  expect(filterValue).toBe("status eq Microsoft.Dynamics.CRM.IncidentStatus'Cancelled'");
});

test('collection query - filter parameter enum value with in operator', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('status', 'in', ['Active', 'Resolved']),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  // Enum values in 'in' operator should each use FQN format
  expect(filterValue).toBe("status in (Microsoft.Dynamics.CRM.IncidentStatus'Active',Microsoft.Dynamics.CRM.IncidentStatus'Resolved')");
});

test('collection query - filter parameter enum value with ne operator', async () => {
  await client.entitysets('incidents').query({
    filter: (h) => h.clause('status', 'ne', 'Cancelled'),
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  const filterValue = queryParams['$filter'];
  expect(filterValue).toBeDefined();
  expect(filterValue).toBe("status ne Microsoft.Dynamics.CRM.IncidentStatus'Cancelled'");
});

test('collection query - multiple parameters combined', async () => {
  await client.entitysets('incidents').query({
    select: ['title'],
    expand: { incident_contact: {} },
    top: 10,
    skip: 5,
    orderby: ['title', 'asc'],
    count: true,
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$select']).toBe('title');
  expect(queryParams['$expand']).toBe('incident_contact');
  expect(queryParams['$top']).toBe('10');
  expect(queryParams['$skip']).toBe('5');
  expect(queryParams['$orderby']).toBe('title asc');
  expect(queryParams['$count']).toBe('true');
});

test('collection query - nested expand with options', async () => {
  await client.entitysets('incidents').query({
    expand: {
      incident_contact: {
        select: ['email'],
        expand: {
          contact_incidents: {},
        },
      },
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$expand']).toBe('incident_contact($select=email;$expand=contact_incidents)');
});

// ============================================================================
// Single Entity Query Tests
// ============================================================================

test('single entity query - basic select parameter', async () => {
  await client.entitysets('incidents').key('guid-123').query({
    select: ['title', 'description'],
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$select']).toBe('title,description');
});

test('single entity query - basic expand parameter', async () => {
  await client.entitysets('incidents').key('guid-123').query({
    expand: { incident_contact: {} },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$expand']).toBe('incident_contact');
});

test('single entity query - expand with nested select', async () => {
  await client.entitysets('incidents').key('guid-123').query({
    expand: {
      incident_contact: {
        select: ['email', 'name'],
      },
    },
  });

  expect(capturedUrls.length).toBe(1);
  const url = capturedUrls[0]!;
  const queryParams = parseQueryString(url);
  expect(queryParams['$expand']).toBe('incident_contact($select=email,name)');
});

test('single entity query - multiple parameters combined', async () => {
    await client.entitysets('incidents').key('guid-123').query({
      select: ['title'],
      expand: { incident_contact: {} },
    });

    expect(capturedUrls.length).toBe(1);
    const url = capturedUrls[0]!;
    const queryParams = parseQueryString(url);
  expect(queryParams['$select']).toBe('title');
  expect(queryParams['$expand']).toBe('incident_contact');
});
