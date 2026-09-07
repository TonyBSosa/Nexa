import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeGap, KnowledgeGapDetail, KnowledgeGapStatus } from '@nexa/shared';
import { AlertCircle, Check, FileText, RefreshCw, UserRound, Workflow } from 'lucide-react';

const lifecycle: Array<[KnowledgeGapStatus, string]> = [['DETECTED','Detectado'],['TRIAGED','Clasificado'],['ACTION_PROPOSED','Acción propuesta'],['IN_PROGRESS','En progreso'],['KNOWLEDGE_COLLECTED','Conocimiento recopilado'],['AWAITING_APPROVAL','Pendiente de aprobación'],['PUBLISHED','Publicado'],['RESOLVED','Resuelto']];
const statusLabel = Object.fromEntries(lifecycle) as Record<KnowledgeGapStatus, string>;
const demoEvidence = 'Antes de retirar una impresora, Soporte de TI verifica que el equipo ya no esté asignado. Se registra el número de activo y de serie, se actualiza el inventario y se documenta el destino final del equipo.';

function tone(status: KnowledgeGapStatus) { return status === 'RESOLVED' || status === 'PUBLISHED' ? 'green' : status === 'AWAITING_APPROVAL' ? 'amber' : status === 'DETECTED' ? 'red' : 'blue'; }

export function KnowledgeOperationsTest({ initialGapId = '' }: { initialGapId?: string }) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [selectedId, setSelectedId] = useState(initialGapId);
  const [gap, setGap] = useState<KnowledgeGapDetail | null>(null);
  const [actionChoice, setActionChoice] = useState('');
  const [evidence, setEvidence] = useState(demoEvidence);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async (preferredId?: string) => {
    const response = await fetch('/api/knowledge-gaps');
    const body = await response.json() as { items?: KnowledgeGap[]; error?: { message?: string } };
    if (!response.ok || !body.items) throw new Error(body.error?.message ?? 'No se pudieron cargar las brechas.');
    setGaps(body.items);
    setSelectedId(current => preferredId ?? (current || body.items?.[0]?.id || ''));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setGap(null); return; }
    const response = await fetch(`/api/knowledge-gaps/${id}`);
    const body = await response.json() as KnowledgeGapDetail & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? 'No se pudo cargar la brecha.');
    setGap(body);
    setActionChoice(body.selectedAction?.id ?? body.suggestedActions[0]?.id ?? '');
  }, []);

  const refresh = useCallback(async (id?: string) => {
    await loadList(id);
    const target = id ?? selectedId;
    if (target) await loadDetail(target);
  }, [loadDetail, loadList, selectedId]);

  useEffect(() => { setBusy(true); loadList(initialGapId || undefined).catch(reason => setError(reason instanceof Error ? reason.message : 'API no disponible.')).finally(() => setBusy(false)); }, [initialGapId, loadList]);
  useEffect(() => { if (!selectedId) { setGap(null); return; } setBusy(true); loadDetail(selectedId).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar la brecha.')).finally(() => setBusy(false)); }, [loadDetail, selectedId]);

  async function run(path: string, method: 'POST' | 'PATCH', body: object) {
    if (!gap) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/knowledge-gaps/${gap.id}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'La operación no se completó.');
      await refresh(gap.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'La operación no se completó.'); }
    finally { setBusy(false); }
  }

  const action = gap?.suggestedActions.find(item => item.id === actionChoice) ?? gap?.selectedAction ?? gap?.suggestedActions[0];
  const draft = gap?.currentDraft;
  const currentIndex = gap ? lifecycle.findIndex(([status]) => status === gap.status) : -1;

  return <div className="operations-layout"><section className="panel"><div className="operations-heading"><div><h2>Brechas de conocimiento</h2><p>Preguntas que todavía no cuentan con una respuesta aprobada.</p></div><button className="icon-button" onClick={() => void refresh()} disabled={busy} aria-label="Actualizar brechas"><RefreshCw size={16} /></button></div>{error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}<div className="table-wrap"><table><thead><tr><th>Brecha</th><th>Estado</th><th>Ocurrencias</th><th>Prioridad</th><th>Departamento</th></tr></thead><tbody>{gaps.map(item => <tr key={item.id} className={selectedId === item.id ? 'row-selected' : ''} onClick={() => setSelectedId(item.id)}><td className="primary-cell">{item.title}</td><td><span className={`badge badge-${tone(item.status)}`}>{statusLabel[item.status]}</span></td><td>{item.occurrences}</td><td>{item.priority}</td><td>{item.suggestedDepartment ?? 'Sin asignar'}</td></tr>)}{!gaps.length && <tr><td className="empty-cell" colSpan={5}>{busy ? 'Cargando brechas…' : 'No hay brechas. Crea una consulta insuficiente desde el Asistente IA.'}</td></tr>}</tbody></table></div></section>
  {gap && <section className="panel gap-detail"><div className="detail-header"><div><p className="eyebrow">Detalle de la brecha</p><h2>{gap.title}</h2></div><span className={`badge badge-${tone(gap.status)}`}>{statusLabel[gap.status]}</span></div><div className="detail-stats"><div><span>Ocurrencias</span><strong>{gap.occurrences}</strong></div><div><span>Prioridad</span><strong>{gap.priority}</strong></div><div><span>Departamento</span><strong>{gap.suggestedDepartment ?? 'Sin asignar'}</strong></div><div><span>Revisión de evidencia</span><strong>{gap.evidenceRevision}</strong></div></div><h3>Ciclo de recuperación</h3><div className="lifecycle">{lifecycle.map(([status, label], index) => <div className={`lifecycle-step ${index < currentIndex ? 'complete' : index === currentIndex ? 'current' : ''}`} key={status}><div className="lifecycle-marker">{index < currentIndex ? <Check size={13} /> : index + 1}</div><span>{label}</span>{index < lifecycle.length - 1 && <div className="lifecycle-connector" />}</div>)}</div>
  <div className="detail-columns"><div><span className="context-label">Pregunta original</span><p className="detail-text">“{gap.originalQuestion}”</p><span className="context-label">Expertos sugeridos</span>{gap.suggestedExperts.length ? gap.suggestedExperts.map(expert => <div className="expert" key={expert}><span className="avatar small"><UserRound size={13} /></span><div><strong>{expert}</strong><small>Rol sugerido · sin identidad verificada</small></div></div>) : <p className="muted-copy">Sin expertos sugeridos.</p>}</div><div><span className="context-label">Acciones de recuperación</span>{gap.status === 'DETECTED' || gap.status === 'TRIAGED' || gap.status === 'ACTION_PROPOSED' ? <div className="action-options">{gap.suggestedActions.map(item => <button className={actionChoice === item.id ? 'selected' : ''} key={item.id} onClick={() => setActionChoice(item.id)}><span className="action-radio" /><span><strong>{item.description}</strong><small>{item.type.replaceAll('_', ' ')} · acción simulada</small></span></button>)}</div> : action ? <div className="selected-action"><Workflow size={16} /><div><strong>{action.description}</strong><small>{action.approvedAt ? 'Aprobada por una persona · acción simulada' : 'Pendiente de aprobación humana'}</small></div></div> : <p className="muted-copy">Selecciona una propuesta para continuar.</p>}<span className="context-label spaced">Borrador actual</span>{draft ? <div className="draft-card"><FileText size={16} /><div><strong>{draft.title}</strong><small>Revisión {draft.revision} · evidencia {draft.evidenceRevisionUsed}</small><p>{draft.content}</p></div></div> : <p className="muted-copy">Todavía no existe un borrador.</p>}</div></div>
  <div className="workflow-controls">
    {gap.status === 'DETECTED' && <><button className="button secondary" disabled={busy} onClick={() => void run('/triage','PATCH',{ priority:'HIGH', category: gap.category ?? 'TI / Equipos' })}>Guardar clasificación</button><button className="button primary" disabled={busy} onClick={() => void run('/transition','POST',{ fromStatus:'DETECTED', toStatus:'TRIAGED' })}>Confirmar clasificación</button></>}
    {gap.status === 'TRIAGED' && action && <button className="button primary" disabled={busy} onClick={() => void run('/transition','POST',{ fromStatus:'TRIAGED', toStatus:'ACTION_PROPOSED', selectedActionId:action.id })}>Seleccionar acción propuesta</button>}
    {gap.status === 'ACTION_PROPOSED' && action && <button className="button primary" disabled={busy} onClick={() => void run('/transition','POST',{ fromStatus:'ACTION_PROPOSED', toStatus:'IN_PROGRESS', selectedActionId:action.id, approveSimulatedAction:true, humanNote:'Aprobada manualmente desde la interfaz NEXA.' })}>Aprobar e iniciar recuperación</button>}
    {(gap.status === 'IN_PROGRESS' || gap.status === 'KNOWLEDGE_COLLECTED') && <div className="evidence-editor"><label htmlFor="evidence">Información recopilada</label><textarea id="evidence" value={evidence} onChange={event => setEvidence(event.target.value)} /><button className="button secondary" disabled={busy || !evidence.trim()} onClick={() => void run('/evidence','POST',{ content:evidence, origin:'Información sintética ingresada manualmente' })}>Adjuntar evidencia</button></div>}
    {gap.status === 'IN_PROGRESS' && <button className="button primary" disabled={busy || !gap.evidenceRevision} onClick={() => void run('/transition','POST',{ fromStatus:'IN_PROGRESS', toStatus:'KNOWLEDGE_COLLECTED' })}>Confirmar conocimiento recopilado</button>}
    {gap.status === 'KNOWLEDGE_COLLECTED' && <><button className="button secondary" disabled={busy} onClick={() => void run('/draft','POST',{ mode:'GENERATE', evidenceRevision:gap.evidenceRevision })}>Generar nueva revisión</button>{draft && <button className="button primary" disabled={busy} onClick={() => void run('/transition','POST',{ fromStatus:'KNOWLEDGE_COLLECTED', toStatus:'AWAITING_APPROVAL' })}>Enviar a aprobación</button>}</>}
    {gap.status === 'AWAITING_APPROVAL' && draft && <><button className="button secondary" disabled={busy} onClick={() => void run('/approval','POST',{ decision:'CHANGES_REQUESTED', draftRevision:draft.revision, comment:'Preparar una revisión nueva.' })}>Solicitar cambios</button><button className="button danger" disabled={busy} onClick={() => void run('/approval','POST',{ decision:'REJECTED', draftRevision:draft.revision, comment:'Rechazado en revisión humana.' })}>Rechazar</button><button className="button primary" disabled={busy} onClick={() => void run('/approval','POST',{ decision:'APPROVED', draftRevision:draft.revision, comment:'Validado manualmente.' })}><Check size={15} /> Aprobar y publicar</button></>}
    {gap.status === 'PUBLISHED' && <button className="button primary" disabled={busy} onClick={() => void run('/transition','POST',{ fromStatus:'PUBLISHED', toStatus:'RESOLVED' })}>Cerrar brecha explícitamente</button>}
    {gap.status === 'RESOLVED' && <p className="completion-note"><span className="completion-check"><Check size={14} /></span> Esta brecha fue publicada y cerrada explícitamente.</p>}
  </div></section>}</div>;
}
