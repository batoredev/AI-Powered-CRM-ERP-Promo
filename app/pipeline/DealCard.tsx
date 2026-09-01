// app/pipeline/DealCard.tsx
'use client';

import type { Deal, PipelineStage } from '../../lib/crm/deals';
import { moveDealAction } from './actions';
import styles from './DealCard.module.css';

function formatValue(deal: Deal): string | null {
  if (deal.valueMinorUnits === null || !deal.currencyCode) return null;
  const amount = deal.valueMinorUnits / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: deal.currencyCode,
    }).format(amount);
  } catch {
    return null;
  }
}

export function DealCard({ deal, stages }: { deal: Deal; stages: PipelineStage[] }) {
  const formattedValue = formatValue(deal);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newStageId = event.target.value;
    if (newStageId === deal.pipelineStageId) return;
    moveDealAction(deal.id, newStageId).catch((err) => {
      console.error('Failed to move deal:', err);
    });
  }

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>{deal.title}</p>
      {formattedValue && <p className={styles.cardValue}>{formattedValue}</p>}
      <label className={styles.selectLabel}>
        <span className={styles.selectLabelText}>Move to stage</span>
        <select
          aria-label={`Move ${deal.title} to stage`}
          className={styles.select}
          value={deal.pipelineStageId}
          onChange={handleChange}
        >
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
