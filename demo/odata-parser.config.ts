import { defineConfig } from "../src/parser/config";

export default defineConfig({
  inputPath: "csdl.xml",
  outputPath: ".",
  wantedEntities: [
    "teams",
    "systemusers",
    "queues",
    "contacts",
    "incidents",
    "emails",
    "activitymimeattachments",
    "activityparties",
  ],
  excludeFilters: {
    properties: [
      "adx",
      "lms",
      "msdyn",
      "^coop_(?!customerid$|personalnumber$|kimcustomerid$|resolvedon$)",
    ],
    navigations: ["^coop_(?!customerid$|personalnumber$|kimcustomerid$)"],
    actions: ["adx", "msdyn"],
    functions: ["Retrieve"],
  },
  wantedUnboundActions: ["CloseIncident"],
  wantedUnboundFunctions: ["WhoAmI"],
  mask: {
    boundActionsByEntity: {
      crmbaseentity: "ALL",
      teams: "ALL",
      contacts: "ALL",
      incidents: "ALL",
      systemuser: "ALL",
    },
    boundFunctionsByEntity: {
      incident: "ALL",
    },
    onlyBoundActionsByEntity: {
      emails: ["SendEmail"],
    },
  },
});
