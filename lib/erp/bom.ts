import { withTenant } from '../db/with-tenant';

export type BomType = 'manufacture' | 'kit';

export interface BillOfMaterials {
  id: string;
  tenantId: string;
  productId: string;
  name: string;
  bomType: BomType;
  routingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BomComponent {
  id: string;
  billOfMaterialsId: string;
  componentProductId: string;
  quantity: number;
}

export interface NewBom {
  productId: string;
  name: string;
  bomType: BomType;
  components: Array<{ componentProductId: string; quantity: number }>;
}

function rowToBom(row: any): BillOfMaterials {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    name: row.name,
    bomType: row.bom_type,
    routingId: row.routing_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBomComponent(row: any): BomComponent {
  return {
    id: row.id,
    billOfMaterialsId: row.bill_of_materials_id,
    componentProductId: row.component_product_id,
    quantity: Number(row.quantity),
  };
}

export async function createBom(tenantId: string, input: NewBom): Promise<BillOfMaterials> {
  return withTenant(tenantId, async (tx) => {
    const [bomRow] = await tx`
      INSERT INTO bill_of_materials (tenant_id, product_id, name, bom_type)
      VALUES (${tenantId}, ${input.productId}, ${input.name}, ${input.bomType})
      RETURNING *
    `;

    for (const component of input.components) {
      await tx`
        INSERT INTO bom_component (tenant_id, bill_of_materials_id, component_product_id, quantity)
        VALUES (${tenantId}, ${bomRow.id}, ${component.componentProductId}, ${component.quantity})
      `;
    }

    return rowToBom(bomRow);
  });
}

export async function getBom(tenantId: string, id: string): Promise<BillOfMaterials | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM bill_of_materials WHERE id = ${id}`;
    return rows.length > 0 ? rowToBom(rows[0]) : null;
  });
}

export async function listBomComponents(tenantId: string, billOfMaterialsId: string): Promise<BomComponent[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM bom_component WHERE bill_of_materials_id = ${billOfMaterialsId} ORDER BY id`;
    return rows.map(rowToBomComponent);
  });
}
