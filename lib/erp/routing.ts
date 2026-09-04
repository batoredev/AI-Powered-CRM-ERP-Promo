import { withTenant } from '../db/with-tenant';
import type { BillOfMaterials, BomType } from './bom';

export interface Routing {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface Operation {
  id: string;
  routingId: string;
  workCenterId: string;
  sequence: number;
  name: string;
  durationMinutes: number;
}

export interface NewRouting {
  name: string;
  operations: Array<{ workCenterId: string; sequence: number; name: string; durationMinutes: number }>;
}

function rowToRouting(row: any): Routing {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function rowToOperation(row: any): Operation {
  return {
    id: row.id,
    routingId: row.routing_id,
    workCenterId: row.work_center_id,
    sequence: row.sequence,
    name: row.name,
    durationMinutes: row.duration_minutes,
  };
}

// Local mapper, not imported from bom.ts: rowToBom there is a private,
// unexported helper (matching how every lib/erp/*.ts file keeps its
// row-mapper module-private). attachRouting needs the same shape to
// return an updated BillOfMaterials, so it re-declares an equivalent
// mapping here rather than reaching into bom.ts's internals.
function rowToBillOfMaterials(row: any): BillOfMaterials {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    name: row.name,
    bomType: row.bom_type as BomType,
    routingId: row.routing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRouting(tenantId: string, input: NewRouting): Promise<Routing> {
  return withTenant(tenantId, async (tx) => {
    const [routingRow] = await tx`
      INSERT INTO routing (tenant_id, name)
      VALUES (${tenantId}, ${input.name})
      RETURNING *
    `;

    for (const op of input.operations) {
      await tx`
        INSERT INTO operation (tenant_id, routing_id, work_center_id, sequence, name, duration_minutes)
        VALUES (${tenantId}, ${routingRow.id}, ${op.workCenterId}, ${op.sequence}, ${op.name}, ${op.durationMinutes})
      `;
    }

    return rowToRouting(routingRow);
  });
}

export async function listOperations(tenantId: string, routingId: string): Promise<Operation[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM operation WHERE routing_id = ${routingId} ORDER BY sequence ASC`;
    return rows.map(rowToOperation);
  });
}

export async function getRouting(tenantId: string, id: string): Promise<Routing | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM routing WHERE id = ${id}`;
    return rows.length > 0 ? rowToRouting(rows[0]) : null;
  });
}

export async function attachRouting(
  tenantId: string,
  billOfMaterialsId: string,
  routingId: string,
): Promise<BillOfMaterials | null> {
  // F3: validate the routing belongs to this tenant BEFORE the UPDATE.
  // Without this, a foreign routingId is silently accepted (the UPDATE's
  // WHERE clause only checks billOfMaterialsId), leaving the BoM pointing
  // at a routing_id RLS will never let this tenant read again.
  const routing = await getRouting(tenantId, routingId);
  if (!routing) {
    return null;
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      UPDATE bill_of_materials
      SET routing_id = ${routingId}, updated_at = now()
      WHERE id = ${billOfMaterialsId}
      RETURNING *
    `;
    return rows.length > 0 ? rowToBillOfMaterials(rows[0]) : null;
  });
}
