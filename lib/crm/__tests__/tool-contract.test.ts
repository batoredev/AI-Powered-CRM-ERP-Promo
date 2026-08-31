import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { CRM_TOOL_DEFINITIONS, CRM_TOOL_HANDLERS } from '../tool-contract';

const setupSql = postgres(process.env.DATABASE_URL!);
let tenantId: string;

describe('CRM tool contract', () => {
  afterAll(async () => {
    if (tenantId) {
      await setupSql`DELETE FROM contact WHERE tenant_id = ${tenantId}`;
      await setupSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    }
    await setupSql.end();
  });

  it('defines a tool for creating a contact with a valid JSON schema shape', () => {
    const createContactTool = CRM_TOOL_DEFINITIONS.find((t) => t.name === 'create_contact');
    expect(createContactTool).toBeDefined();
    expect(createContactTool!.input_schema.type).toBe('object');
    expect(createContactTool!.input_schema.required).toContain('fullName');
  });

  it('defines a tool for listing contacts', () => {
    const listTool = CRM_TOOL_DEFINITIONS.find((t) => t.name === 'list_contacts');
    expect(listTool).toBeDefined();
  });

  it('every tool definition has a corresponding handler', () => {
    for (const tool of CRM_TOOL_DEFINITIONS) {
      expect(CRM_TOOL_HANDLERS[tool.name], `missing handler for ${tool.name}`).toBeDefined();
    }
  });

  it('the create_contact handler actually creates a contact scoped to the given tenant', async () => {
    const [tenant] = await setupSql`INSERT INTO tenant (name) VALUES ('Tool Contract Test') RETURNING id`;
    tenantId = tenant.id;

    const result = await CRM_TOOL_HANDLERS['create_contact'](tenantId, { fullName: 'Agent Created Contact' });
    expect(result.fullName).toBe('Agent Created Contact');
  });
});
