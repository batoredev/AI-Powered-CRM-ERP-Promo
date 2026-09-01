import { withTenant } from '../db/with-tenant';

export async function nextDocumentNumber(tenantId: string, documentType: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`SELECT next_document_number(${tenantId}, ${documentType}) as n`;
    return Number(row.n);
  });
}
