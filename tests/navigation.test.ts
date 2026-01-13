import { test, expect } from 'bun:test';
import { schema } from '../src/schema';
import { OdataClient } from '../src';

let coop_crm_schema = schema({
  namespace: 'Microsoft.Dynamics.CRM',
  alias: 'mscrm',
  enumtypes: {
    IncidentStatus: {
      isFlags: false,
      members: {
        Active: 0,
        Resolved: 1,
        Cancelled: 2,
      },
    },
  },
  complextypes: {
    Address: {
      street: { type: 'Edm.String' },
      city: { type: 'Edm.String' },
      postalCode: { type: 'Edm.String' },
      country: { type: 'Edm.String' },
    },
  },
  entitytypes: {
    Incident: {
      id: { type: 'Edm.Guid', nullable: false },
      title: { type: 'Edm.String' },
      description: { type: 'Edm.String', nullable: true },
      status: {
        type: 'enum',
        target: 'IncidentStatus',
      },
      incident_contact: {
        type: 'navigation',
        target: 'Contact',
        collection: false,
      },
    },
    Contact: {
      id: { type: 'Edm.Guid' },
      name: { type: 'Edm.String' },
      email: { type: 'Edm.String' },
      phone: { type: 'Edm.String' },
      contact_incidents: {
        type: 'navigation',
        target: 'Incident',
        collection: true,
      },
    },
  },
  entitysets: {
    incidents: {
      entitytype: 'Incident',
    },
    contacts: {
      entitytype: 'Contact',
    },
  },
  actions: {
    assignIncident: {
      type: 'bound',
      collection: false,
      target: 'Incident',
      parameters: {
        assigneeId: { type: 'Edm.Guid' },
        priority: { type: 'Edm.Int32' },
      },
      returnType: { type: 'Edm.Boolean' },
    },
    bulkCreate: {
      type: 'unbound',
      parameters: {
        entities: {
          type: 'Edm.String',
          collection: true,
        },
      },
    },
  },
  functions: {
    getRelatedCount: {
      type: 'bound',
      collection: false,
      target: 'Incident',
      parameters: {
        relationType: { type: 'Edm.String' },
      },
      returnType: { type: 'Edm.Int32' },
    },
    searchEntities: {
      type: 'unbound',
      parameters: {
        query: { type: 'Edm.String' },
        entityTypes: {
          type: 'Edm.String',
          collection: true,
        },
      },
      returnType: {
        type: 'Edm.String',
        collection: true,
      },
    },
  },
  actionImports: {
    BulkCreate: {
      action: 'bulkCreate',
    },
  },
  functionImports: {
    Search: {
      function: 'searchEntities',
    },
  },
});

test('base entityset path construction', async () => {
  const capturedUrls: string[] = [];
  const mockTransport = async (req: Request, init?: RequestInit) => {
    capturedUrls.push(req.url);
    return new Response(JSON.stringify({ value: [] }), { status: 200 });
  };

  const client = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: mockTransport,
  });

  await client.entitysets('incidents').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe('https://demo.com/api/data/v9.0/incidents');
});

test('single entity with key path construction', async () => {
  const capturedUrls: string[] = [];
  const mockTransport = async (req: Request, init?: RequestInit) => {
    capturedUrls.push(req.url);
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const client = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: mockTransport,
  });

  await client.entitysets('incidents').key('guid-123').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe('https://demo.com/api/data/v9.0/incidents(guid-123)');
});

test('single-valued navigation path construction', async () => {
  const capturedUrls: string[] = [];
  const mockTransport = async (req: Request, init?: RequestInit) => {
    capturedUrls.push(req.url);
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const client = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: mockTransport,
  });

  await client.entitysets('incidents').key('guid-123').navigate('incident_contact').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe(
    'https://demo.com/api/data/v9.0/incidents(guid-123)/incident_contact'
  );
});

test('collection-valued navigation path construction', async () => {
  const capturedUrls: string[] = [];
  const mockTransport = async (req: Request, init?: RequestInit) => {
    capturedUrls.push(req.url);
    return new Response(JSON.stringify({ value: [] }), { status: 200 });
  };

  const client = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: mockTransport,
  });

  await client.entitysets('contacts').key('guid-456').navigate('contact_incidents').query({});

  expect(capturedUrls.length).toBe(1);
  expect(capturedUrls[0]).toBe(
    'https://demo.com/api/data/v9.0/contacts(guid-456)/contact_incidents'
  );
});

test('chained navigations path construction', async () => {
  const capturedUrls: string[] = [];
  const mockTransport = async (req: Request, init?: RequestInit) => {
    capturedUrls.push(req.url);
    return new Response(JSON.stringify({ value: [] }), { status: 200 });
  };

  const client = new OdataClient(coop_crm_schema, {
    baseUrl: 'https://demo.com/api/data/v9.0/',
    transport: mockTransport,
  });

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
