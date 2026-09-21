import { OdataClient } from "@mkja/o-data";
import { microsoft_dynamics_crm_schema } from "./generated-o-data-schema.ts";
import { logRequest } from "./log-request.ts";

const client = new OdataClient(microsoft_dynamics_crm_schema, {
  baseUrl: "https://demo.com/api/data/v9.0/",
  transport: async (request) => {
    await logRequest(request);
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});

export const collectionQuery = client.entitysets("emails").query({
  select: ["subject", "description"],
  expand: {
    regardingobjectid_incident: {
      select: ["title"],
    },
  },
});

export const bindUpdate = client.entitysets("emails").key("123").update({
  regardingobjectid_incident: "id",
});

export const collectionNavUpdate = client.entitysets("emails").key("123").update({
  email_activity_parties: [
    { participationtypemask: 1, partyid_contact: "some-id" },
    { participationtypemask: 1, partyid_queue: "queue-id" },
    { participationtypemask: 2, addressused: "blabla@bla.com" },
  ],
});