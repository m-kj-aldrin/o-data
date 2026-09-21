import { OdataClient } from "@mkja/o-data";
import { microsoft_dynamics_crm_schema } from "./generated-o-data-schema.ts";
import { logRequest } from "./log-request.ts";

function cookieHeader(): string {
  return [
    `CrmOwinAuth=${process.env.CrmOwinAuth ?? ""}`,
    `CrmOwinAuthC1=${process.env.CrmOwinAuthC1 ?? ""}`,
    `CrmOwinAuthC2=${process.env.CrmOwinAuthC2 ?? ""}`,
  ].join("; ");
}

const client = new OdataClient(microsoft_dynamics_crm_schema, {
  baseUrl: process.env.COOP_CRM_BASE_URL ?? "https://example.crm.dynamics.com/api/data/v9.0/",
  transport: async (request) => {
    await logRequest(request);
    request.headers.set("Cookie", cookieHeader());
    return fetch(request);
  },
});

void client;

// bun --env-file=.env live.ts
//
// const emails = await client.entitysets("emails").query({
//   select: ["subject", "description"],
//   expand: {
//     regardingobjectid_incident: { select: ["title"] },
//   },
// });
//
// const close = await client.action("CloseIncident", {
//   parameters: {
//     IncidentResolution: { incidentid: "..." },
//     Status: -1,
//   },
// });
