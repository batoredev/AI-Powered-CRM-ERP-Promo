import { withTenant } from '../db/with-tenant';

export type GoodsHandlingMode = 'off' | 'basic_stock' | 'production';
export type BillingMode = 'transactional' | 'effort_based' | 'recurring';

export interface ErpSettings {
  tenantId: string;
  goodsHandling: GoodsHandlingMode;
  billingModes: BillingMode[];
  updatedAt: Date;
}

function rowToErpSettings(row: any): ErpSettings {
  return {
    tenantId: row.tenant_id,
    goodsHandling: row.goods_handling,
    billingModes: row.billing_modes ?? [],
    updatedAt: row.updated_at,
  };
}

export async function getErpSettings(tenantId: string): Promise<ErpSettings> {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx`SELECT * FROM tenant_erp_settings WHERE tenant_id = ${tenantId}`;
    if (existing.length > 0) {
      return rowToErpSettings(existing[0]);
    }
    const [created] = await tx`
      INSERT INTO tenant_erp_settings (tenant_id)
      VALUES (${tenantId})
      ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
      RETURNING *
    `;
    return rowToErpSettings(created);
  });
}

export async function updateErpSettings(
  tenantId: string,
  input: { goodsHandling?: GoodsHandlingMode; billingModes?: BillingMode[] },
): Promise<ErpSettings> {
  // Ensure the settings row exists before updating it. getErpSettings is
  // idempotent and creates a default row on first access for this tenant,
  // so updateErpSettings transparently works even if the caller never read
  // settings first — matching getErpSettings's own documented contract.
  await getErpSettings(tenantId);

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      UPDATE tenant_erp_settings
      SET
        goods_handling = COALESCE(${input.goodsHandling ?? null}, goods_handling),
        billing_modes = COALESCE(${input.billingModes ?? null}, billing_modes),
        updated_at = now()
      WHERE tenant_id = ${tenantId}
      RETURNING *
    `;
    return rowToErpSettings(row);
  });
}
