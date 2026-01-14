import { schema } from '../src/schema';

export const coop_crm_schema = schema({
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
      properties: {
        id: { type: 'Edm.Guid', nullable: true },
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
    },
    Contact: {
      properties: {
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
  },
  ActivityResolution: {
    properties: {
      id: { type: 'Edm.Guid' },
      name: { type: 'Edm.String' },
      description: { type: 'Edm.String' },
      incident: {
        type: 'navigation',
        target: 'Incident',
        collection: false,
      }
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
    CloseIncident: {
      type: 'unbound',
      parameters: {
        IncidentResolution: { type: 'navigation', collection: false, target: 'Incident' },
        Status: { type: 'Edm.Int32' },
      },
    },
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
    CloseIncident: {
      action: 'CloseIncident',
    },
  },
  functionImports: {
    Search: {
      function: 'searchEntities',
    },
  },
});
