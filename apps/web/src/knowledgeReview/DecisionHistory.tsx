import type { ApprovalDecision } from '@nexa/shared';
import type { DecisionHistoryEntry } from './types';
import './knowledgeReview.css';

const decisionLabels: Record<ApprovalDecision, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  APPROVED: { label: 'Aprobado', tone: 'green' },
  CHANGES_REQUESTED: { label: 'Cambios solicitados', tone: 'amber' },
  REJECTED: { label: 'Rechazado', tone: 'red' },
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es');
}

export function DecisionHistory({ entries }: { entries: DecisionHistoryEntry[] }) {
  const ordered = [...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (!ordered.length) return <p className="kr-empty">Todavía no hay decisiones registradas.</p>;
  return <ol className="kr-history">
    {ordered.map((entry) => {
      const decision = decisionLabels[entry.decision];
      return <li key={entry.id} className="kr-history-item">
        <div className="kr-history-header">
          <span className={`badge badge-${decision.tone}`}>{decision.label}</span>
          <span>Revisión {entry.draftRevision}</span>
          <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
        </div>
        <small className="kr-meta">{entry.actor ? `Decidido por ${entry.actor}` : 'Revisor no registrado'}</small>
        {entry.comment && <p className="kr-text-block">{entry.comment}</p>}
      </li>;
    })}
  </ol>;
}
