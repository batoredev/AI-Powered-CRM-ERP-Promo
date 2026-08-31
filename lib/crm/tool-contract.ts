import { createContact, listContacts, getContact } from './contacts';
import { createDeal, listDealsByStage, moveDealToStage, listPipelineStages } from './deals';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

// One shared tool set spanning CRM (this file). ERP tools join this array
// in a later phase — design spec §5 describes this as one unified tool
// set, not per-domain silos, so the agent can act across both in a single
// turn once Phase 3 adds ERP tools here too.
export const CRM_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_contact',
    description: 'Create a new CRM contact for the current tenant.',
    input_schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: "The contact's full name" },
        email: { type: 'string', description: "The contact's email address" },
        phone: { type: 'string', description: "The contact's phone number" },
        company: { type: 'string', description: "The contact's company name" },
      },
      required: ['fullName'],
    },
  },
  {
    name: 'list_contacts',
    description: 'List all CRM contacts for the current tenant.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_contact',
    description: 'Fetch a single CRM contact by id.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The contact id (UUID)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in the sales pipeline, attached to a contact and a pipeline stage.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact this deal belongs to' },
        pipelineStageId: { type: 'string', description: 'The pipeline stage id to place this deal in' },
        title: { type: 'string', description: 'A short title describing the deal' },
        valueMinorUnits: { type: 'number', description: 'Deal value in minor currency units (e.g. cents)' },
        currencyCode: { type: 'string', description: 'ISO currency code, e.g. USD' },
      },
      required: ['contactId', 'pipelineStageId', 'title'],
    },
  },
  {
    name: 'list_deals_by_stage',
    description: 'List all deals for the current tenant, grouped by pipeline stage id.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'move_deal_to_stage',
    description: "Move a deal to a different pipeline stage (e.g. advancing it through the sales pipeline).",
    input_schema: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'The deal to move' },
        stageId: { type: 'string', description: 'The pipeline stage id to move it to' },
      },
      required: ['dealId', 'stageId'],
    },
  },
  {
    name: 'list_pipeline_stages',
    description: 'List the current tenant\'s pipeline stages in order.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

type ToolHandler = (tenantId: string, input: any) => Promise<any>;

export const CRM_TOOL_HANDLERS: Record<string, ToolHandler> = {
  create_contact: (tenantId, input) => createContact(tenantId, input),
  list_contacts: (tenantId) => listContacts(tenantId),
  get_contact: (tenantId, input) => getContact(tenantId, input.id),
  create_deal: (tenantId, input) => createDeal(tenantId, input),
  list_deals_by_stage: (tenantId) => listDealsByStage(tenantId),
  move_deal_to_stage: (tenantId, input) => moveDealToStage(tenantId, input.dealId, input.stageId),
  list_pipeline_stages: (tenantId) => listPipelineStages(tenantId),
};
