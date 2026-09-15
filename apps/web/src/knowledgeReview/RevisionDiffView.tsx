import type { RevisionDiffViewModel } from './types';
import './knowledgeReview.css';

const markers = { EQUAL: ' ', ADDED: '+', REMOVED: '−' } as const;

export function RevisionDiffView({ diff }: { diff: RevisionDiffViewModel }) {
  const { added, removed, lines } = diff.content;
  const unchanged = !diff.titleChanged && added === 0 && removed === 0;
  return <div className="kr-diff">
    <div className="kr-diff-header">
      <strong>Revisión {diff.fromRevision} → Revisión {diff.toRevision}</strong>
      <span className="kr-diff-counts"><span className="kr-added-count">+{added}</span> <span className="kr-removed-count">−{removed}</span></span>
    </div>
    {diff.titleChanged && <div className="kr-diff-title">
      <span className="context-label">Título</span>
      <div className="kr-diff-line kr-removed"><span className="kr-marker">−</span><span className="kr-text">{diff.title.before}</span></div>
      <div className="kr-diff-line kr-added"><span className="kr-marker">+</span><span className="kr-text">{diff.title.after}</span></div>
    </div>}
    {unchanged
      ? <p className="kr-empty">Las revisiones no tienen diferencias.</p>
      : <div className="kr-diff-body" role="table" aria-label={`Diferencias entre la revisión ${diff.fromRevision} y la ${diff.toRevision}`}>
        {lines.map((line, index) => <div role="row" key={`${line.beforeLine ?? '-'}:${line.afterLine ?? '-'}:${index}`} className={`kr-diff-line kr-${line.type.toLowerCase()}`}>
          <span role="cell" className="kr-line-number">{line.beforeLine ?? ''}</span>
          <span role="cell" className="kr-line-number">{line.afterLine ?? ''}</span>
          <span role="cell" className="kr-marker" aria-label={line.type === 'ADDED' ? 'Agregada' : line.type === 'REMOVED' ? 'Eliminada' : 'Sin cambios'}>{markers[line.type]}</span>
          <span role="cell" className="kr-text">{line.text || ' '}</span>
        </div>)}
      </div>}
  </div>;
}
