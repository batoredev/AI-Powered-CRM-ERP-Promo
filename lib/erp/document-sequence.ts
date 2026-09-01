import { withTenant } from '../db/with-tenant';

// NOTE: this opens its own transaction via withTenant and commits on
// return, so a caller cannot enlist this allocation in the same
// transaction as inserting the document row it is numbering. A caller
// that allocates a number here and then fails to insert the document
// leaves a permanent gap in the sequence.
//
// This is normal/acceptable behavior for a sequence generator — it
// matches Postgres's own SERIAL semantics, where nextval() is never
// rolled back either. It is, however, still worth noting: the
// underlying next_document_number() SQL function *is* transactional
// (a rollback of the row that called it restores the counter), so a
// gapless allocate-and-insert pattern is possible in principle — it
// just isn't reachable through this public API today, since
// nextDocumentNumber always opens and commits its own transaction. A
// future invoice/purchase-order sub-plan that needs jurisdictionally
// gapless numbering may want a transaction-accepting variant (e.g.
// nextDocumentNumberTx(tx, tenantId, documentType)) that runs inside
// the caller's own transaction instead.
export async function nextDocumentNumber(tenantId: string, documentType: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`SELECT next_document_number(${tenantId}, ${documentType}) as n`;
    return Number(row.n);
  });
}
