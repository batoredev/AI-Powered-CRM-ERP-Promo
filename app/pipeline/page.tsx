// app/pipeline/page.tsx
import { listDealsByStage, listPipelineStages } from '../../lib/crm/deals';
import { getDevTenantId } from '../../lib/auth/dev-tenant';
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
      <div className={styles.board}>
        {stages.map((stage) => {
          const deals = dealsByStage[stage.id] ?? [];
          return (
            <section key={stage.id} className={styles.column}>
              <h2 className={styles.columnHeading}>{stage.name}</h2>
              <div className={styles.cardList}>
                {deals.map((deal) => (
                  <div key={deal.id} className={styles.card}>
                    <p className={styles.cardTitle}>{deal.title}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
