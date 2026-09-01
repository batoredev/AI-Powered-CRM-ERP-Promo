// app/pipeline/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { moveDealToStage } from '../../lib/crm/deals';
import { getDevTenantId } from '../../lib/auth/dev-tenant';

export async function moveDealAction(dealId: string, stageId: string): Promise<void> {
  const tenantId = await getDevTenantId();
  const moved = await moveDealToStage(tenantId, dealId, stageId);
  if (!moved) {
    throw new Error('Could not move deal — it may have been deleted.');
  }
  revalidatePath('/pipeline');
}
