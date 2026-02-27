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

test('base entityset path construction', async () => {
  await client.entitysets('incidents').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe('https://demo.com/api/data/v9.0/incidents');
});

test('single entity with key path construction', async () => {
  await client.entitysets('incidents').key('guid-123').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe('https://demo.com/api/data/v9.0/incidents(guid-123)');
});

test('single-valued navigation path construction', async () => {
  await client.entitysets('incidents').key('guid-123').navigate('incident_contact').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe(
    'https://demo.com/api/data/v9.0/incidents(guid-123)/incident_contact'
  );
});

test('collection-valued navigation path construction', async () => {
  await client.entitysets('contacts').key('guid-456').navigate('contact_incidents').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe(
    'https://demo.com/api/data/v9.0/contacts(guid-456)/contact_incidents'
  );
});

test('chained navigations path construction', async () => {
  await client
    .entitysets('incidents')
    .key('guid-123')
    .navigate('incident_contact')
    .navigate('contact_incidents')
    .query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe(
    'https://demo.com/api/data/v9.0/incidents(guid-123)/incident_contact/contact_incidents'
  );
});
