import { OdataClient } from "@mkja/o-data";
import { schema } from "@mkja/o-data/schema";

const mySchema = schema({
  alias: "myservice",
  namespace: "My.Service",
  entitytypes: {
    Incident: {
      properties: {
        id: { type: "Edm.Guid" },
        title: { type: "Edm.String" },
      },
    },
  },
  entitysets: {
    incidents: {
      entitytype: "Incident",
    },
  },
});

const client = new OdataClient(mySchema, {
  baseUrl: "https://example.com/odata/",
  transport: async () => new Response(JSON.stringify({ value: [] })),
});

export const typedQuery = client.entitysets("incidents").query({
  select: ["id", "title"],
});
