// app/pipeline/page.tsx
import { listDealsByStage, listPipelineStages } from '../../lib/crm/deals';
import { getDevTenantId } from '../../lib/auth/dev-tenant';
import { DealCard } from './DealCard';
import styles from './page.module.css';

export default async function PipelinePage() {
  const tenantId = await getDevTenantId();
  const [stages, dealsByStage] = await Promise.all([
    listPipelineStages(tenantId),
    listDealsByStage(tenantId),
  ]);

  return (
    <div>
      <h1 className={styles.heading}>Pipeline</h1>
      {stages.length === 0 ? (
        <p className={styles.emptyState}>
          No pipeline stages yet. Pipeline stages and deals are created as you add them — check back once your first deal exists.
        </p>
      ) : (
        <div className={styles.board}>
          {stages.map((stage) => {
            const deals = dealsByStage[stage.id] ?? [];
            return (
              <section key={stage.id} className={styles.column}>
                <h2 className={styles.columnHeading}>{stage.name}</h2>
                <div className={styles.cardList}>
                  {deals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} stages={stages} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
