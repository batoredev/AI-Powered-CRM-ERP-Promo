import { withTenant } from '../db/with-tenant';
import { getSubscription } from './subscriptions';

export interface UsageRecord {
  id: string;
  tenantId: string;
  subscriptionId: string;
  quantity: number;
  recordedAt: Date;
  description: string | null;
}

export interface NewUsageRecord {
  subscriptionId: string;
  quantity: number;
  recordedAt: string;
  description?: string;
}

function rowToUsageRecord(row: any): UsageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    quantity: Number(row.quantity),
    recordedAt: row.recorded_at,
    description: row.description,
  };
}

export async function recordUsage(tenantId: string, input: NewUsageRecord): Promise<UsageRecord> {
  const subscription = await getSubscription(tenantId, input.subscriptionId);
  if (!subscription) {
    throw new Error(`Invalid subscription reference: ${input.subscriptionId} does not belong to this tenant`);
  }

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`
      INSERT INTO usage_record (tenant_id, subscription_id, quantity, recorded_at, description)
      VALUES (${tenantId}, ${input.subscriptionId}, ${input.quantity}, ${input.recordedAt}, ${input.description ?? null})
      RETURNING *
    `;
    return rowToUsageRecord(row);
  });
}

export async function listUsageRecords(tenantId: string, subscriptionId: string): Promise<UsageRecord[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT * FROM usage_record WHERE subscription_id = ${subscriptionId} ORDER BY recorded_at ASC`;
    return rows.map(rowToUsageRecord);
  });
}

export async function getTotalUsage(tenantId: string, subscriptionId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`SELECT COALESCE(SUM(quantity), 0) as total FROM usage_record WHERE subscription_id = ${subscriptionId}`;
    return Number(rows[0].total);
  });
}
