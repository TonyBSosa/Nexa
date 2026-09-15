import { useEffect, useState } from 'react';
import type { ApprovedKnowledgeArticle, KnowledgeGapDetail, ReviewDecision, ReviewDetail, ReviewList, ReviewMetadata } from '@nexa/shared';

const decisions: Array<[ReviewDecision, string]> = [
  ['ACCEPT', 'Aceptar para clasificación'], ['DISCARD_NOT_APPLICABLE', 'Descartar por no aplicar'],
  ['DISCARD_SENSITIVE', 'Descartar por información sensible'], ['DISCARD_IMPROPER', 'Descartar por solicitud improcedente'],
  ['DUPLICATE', 'Marcar como duplicada'],
];
const eventNames: Record<string, string> = Object.fromEntries([...decisions, ['RESTORE', 'Restaurada'], ['RETURN', 'Devuelta a Detectado'], ['CLASSIFY', 'Clasificación confirmada']]);

export function GapReviewPanel({ gap, refresh }: { gap: KnowledgeGapDetail; refresh: () => Promise<void> }) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError('');
    fetch(`/api/knowledge-gaps/${gap.id}/review`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar la revisión.');
      const body = await response.json() as ReviewDetail;
      if (!controller.signal.aborted) setDetail(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Error de revisión.'); });
    return () => controller.abort();
  }, [gap.id, gap.updatedAt, reload]);
  if (!detail) return <div role={error ? 'alert' : 'status'}>{error || 'Cargando revisión…'}{error && <button className="button secondary" onClick={() => setReload(value => value + 1)}>Reintentar</button>}</div>;
  return <ReviewEditor key={`${gap.id}-${detail.review.revision}`} gap={gap} detail={detail} refresh={async () => { await refresh(); setReload(value => value + 1); }} />;
}

function ReviewEditor({ gap, detail, refresh }: { gap: KnowledgeGapDetail; detail: ReviewDetail; refresh: () => Promise<void> }) {
  const review = detail.review;
  const [metadata, setMetadata] = useState<ReviewMetadata>({ revision: review.revision, title: gap.title, category: gap.category ?? '', priority: gap.priority,
    department: gap.suggestedDepartment ?? '', responsible: review.responsible ?? '', experts: gap.suggestedExperts,
    sensitivity: review.sensitivity, targetDate: review.targetDate, importance: review.importance ?? '', relatedGapIds: review.relatedGapIds, relatedArticleIds: review.relatedArticleIds });
  const [actor, setActor] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<ReviewDecision>('ACCEPT');
  const [duplicateOf, setDuplicateOf] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState(detail.similarGaps);
  const [articles, setArticles] = useState<ApprovedKnowledgeArticle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [summary, setSummary] = useState(false);
  const editable = gap.status === 'DETECTED' || gap.status === 'TRIAGED';
  const inactive = review.disposition === 'DISCARDED' || review.disposition === 'DUPLICATE';
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/knowledge', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar el conocimiento publicado.');
      const body = await response.json() as { items: ApprovedKnowledgeArticle[] };
      if (!controller.signal.aborted) setArticles(body.items);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Error al cargar artículos.'); });
    return () => controller.abort();
  }, []);
  function change<K extends keyof ReviewMetadata>(key: K, value: ReviewMetadata[K]) {
    setMetadata(current => ({ ...current, [key]: value })); setDirty(true); setSummary(false);
  }
  async function send(path: string, body: object, method = 'POST') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/knowledge-gaps/${gap.id}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message || 'No se completó la operación.');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se completó la operación.'); }
    finally { setBusy(false); }
  }
  async function searchGaps() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/knowledge-reviews?' + new URLSearchParams({ q: search, pageSize: '50' }));
      if (!response.ok) throw new Error('No se pudieron buscar brechas.');
      const body = await response.json() as ReviewList;
      setMatches(body.items.filter(item => item.id !== gap.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Error de búsqueda.'); }
    finally { setBusy(false); }
  }
  function toggle(key: 'relatedGapIds' | 'relatedArticleIds', id: string) {
    change(key, metadata[key].includes(id) ? metadata[key].filter(value => value !== id) : [...metadata[key], id]);
  }
  return <section className="review-panel">
    <h3>{gap.status === 'DETECTED' ? 'Revisión de solicitud detectada' : gap.status === 'TRIAGED' ? 'Clasificación de la brecha' : 'Registro de revisión y clasificación'}</h3>
    <div className="detail-stats"><div><span>Creación</span><strong>{new Date(gap.createdAt).toLocaleString('es-HN')}</strong></div><div><span>Origen</span><strong>{detail.origin}</strong></div><div><span>Revisión</span><strong>{({ PENDING: 'Pendiente de revisión', ACCEPTED: 'Aceptada', DISCARDED: 'Descartada', DUPLICATE: 'Duplicada' })[review.disposition]}</strong></div></div>
    {detail.sensitiveWarning && <p className="review-warning" role="status">La pregunta podría contener información sensible. Revise su contenido antes de aceptarla. Esta advertencia es orientativa.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {review.reason && <p><strong>Justificación:</strong> {review.reason}</p>}
    {review.duplicateOf && <p>Duplicada de: {review.duplicateOf}</p>}
    {review.classifiedBy && <p>Clasificada por {review.classifiedBy} el {new Date(review.classifiedAt!).toLocaleString('es-HN')}.</p>}
    {editable && <>
      <fieldset disabled={busy || inactive} className="review-fields"><legend>Datos de la brecha</legend>
        <label>Título<input value={metadata.title} onChange={event => change('title', event.target.value)} maxLength={2000} /></label>
        <label>Categoría<input value={metadata.category} onChange={event => change('category', event.target.value)} maxLength={2000} /></label>
        <label>Prioridad<select value={metadata.priority} onChange={event => change('priority', event.target.value as ReviewMetadata['priority'])}><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option></select></label>
        <label>{gap.status === 'DETECTED' ? 'Departamento sugerido' : 'Departamento responsable'}<input value={metadata.department} onChange={event => change('department', event.target.value)} maxLength={2000} /></label>
        {gap.status === 'TRIAGED' && <>
          <label>Responsable principal<input value={metadata.responsible} onChange={event => change('responsible', event.target.value)} maxLength={2000} /></label>
          <label>Expertos sugeridos (uno por línea)<textarea value={metadata.experts.join('\n')} onChange={event => change('experts', event.target.value.split('\n'))} /></label>
          <label>Nivel de sensibilidad<select value={metadata.sensitivity} onChange={event => change('sensitivity', event.target.value as ReviewMetadata['sensitivity'])}><option value="NORMAL">Normal</option><option value="INTERNAL">Interno</option><option value="SENSITIVE">Sensible</option></select></label>
          <label>Fecha objetivo<input type="date" value={metadata.targetDate ?? ''} onChange={event => change('targetDate', event.target.value || null)} /></label>
          <label>Por qué es importante<textarea value={metadata.importance} onChange={event => change('importance', event.target.value)} maxLength={2000} /></label>
        </>}
      </fieldset>
      {!inactive && <>
        <h4>Brechas similares y relaciones</h4><p className="muted-copy">Sugerencias por palabras compartidas; requieren revisión humana. Relacionar no fusiona solicitudes ni ocurrencias.</p>
        <div className="review-search"><label>Buscar otra brecha<input value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary" disabled={busy} onClick={() => void searchGaps()}>Buscar brechas</button></div>
        <div className="review-relations">{matches.map(item => <label key={item.id}><input type="checkbox" disabled={busy} checked={metadata.relatedGapIds.includes(item.id)} onChange={() => toggle('relatedGapIds', item.id)} />{item.title}</label>)}{!matches.length && <p>No hay coincidencias.</p>}
          {metadata.relatedGapIds.filter(id => !matches.some(item => item.id === id)).map(id => <label key={id}><input type="checkbox" checked disabled={busy} onChange={() => toggle('relatedGapIds', id)} />Brecha relacionada: {id}</label>)}
        </div>
        {gap.status === 'TRIAGED' && <><h4>Relacionar conocimiento publicado</h4><div className="review-relations">{articles.map(article => <label key={article.articleId}><input type="checkbox" disabled={busy} checked={metadata.relatedArticleIds.includes(article.articleId)} onChange={() => toggle('relatedArticleIds', article.articleId)} />{article.title}</label>)}{!articles.length && <p>No hay artículos publicados disponibles.</p>}</div></>}
        <button className="button secondary" disabled={busy || !dirty || !metadata.title.trim()} onClick={() => void send('/review', { ...metadata, experts: metadata.experts.map(value => value.trim()).filter(Boolean) }, 'PATCH')}>Guardar datos</button>
        {dirty && <p role="status">Guarde los cambios antes de tomar una decisión.</p>}
      </>}
      <div className="review-search"><label>Persona que realiza la revisión<input value={actor} onChange={event => setActor(event.target.value)} maxLength={2000} disabled={busy} /></label><p className="muted-copy">Nombre o rol declarado; identidad no verificada en este MVP.</p></div>
      {inactive ? <button className="button secondary" disabled={busy || !actor.trim()} onClick={() => void send('/review/decision', { revision: review.revision, decision: 'RESTORE', actor })}>Restaurar para revisión</button> : gap.status === 'DETECTED' ? <>
        <label>Decisión<select value={decision} disabled={busy} onChange={event => setDecision(event.target.value as ReviewDecision)}>{decisions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {decision === 'DUPLICATE' && <label>Brecha original<select value={duplicateOf} onChange={event => setDuplicateOf(event.target.value)} disabled={busy}><option value="">Seleccione una brecha</option>{matches.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
        {decision.startsWith('DISCARD') && <label>Justificación obligatoria<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} placeholder="Explique por qué esta solicitud no debe gestionarse." /></label>}
        <button className="button primary" disabled={busy || dirty || !actor.trim() || (decision.startsWith('DISCARD') && !reason.trim()) || (decision === 'DUPLICATE' && !duplicateOf)} onClick={() => void send('/review/decision', { revision: review.revision, decision, actor, ...(decision.startsWith('DISCARD') && { reason }), ...(decision === 'DUPLICATE' && { duplicateOf }) })}>Confirmar decisión</button>
      </> : <>
        <div className="workflow-controls"><button className="button secondary" disabled={busy || dirty || !actor.trim()} onClick={() => void send('/review/decision', { revision: review.revision, decision: 'RETURN', actor })}>Devolver a Detectado</button>
        <button className="button primary" disabled={busy || dirty || !actor.trim() || !metadata.category.trim() || !metadata.department.trim() || !metadata.responsible.trim() || !metadata.importance.trim()} onClick={() => setSummary(true)}>Revisar resumen de clasificación</button></div>
        {summary && <div className="draft-card"><div><h4>Confirmar clasificación</h4><p><strong>Qué se necesita saber:</strong> {gap.originalQuestion}</p><p><strong>Por qué es importante:</strong> {metadata.importance}</p><p><strong>Quién debe responder:</strong> {metadata.responsible} · {metadata.department}</p><p><strong>Prioridad:</strong> {({ LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' })[metadata.priority]}</p><button className="button primary" disabled={busy || !actor.trim()} onClick={() => void send('/review/classify', { revision: review.revision, actor })}>Confirmar clasificación</button><button className="button secondary" disabled={busy} onClick={() => setSummary(false)}>Volver a editar</button></div></div>}
        {review.classifiedAt && !dirty && <button className="button primary" disabled={busy} onClick={() => void send('/transition', { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' })}>Continuar a Acción propuesta</button>}
      </>}
    </>}
    <details><summary>Historial de decisiones ({detail.history.length})</summary>{detail.history.map(event => <article key={event.id}><strong>{eventNames[event.action] ?? event.action}</strong><p>{event.actor} · {new Date(event.createdAt).toLocaleString('es-HN')}</p>{event.reason && <p>{event.reason}</p>}</article>)}{!detail.history.length && <p>Todavía no hay decisiones registradas.</p>}</details>
  </section>;
}
