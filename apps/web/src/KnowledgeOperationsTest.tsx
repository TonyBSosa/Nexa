import { useCallback, useEffect, useState } from 'react';
import type {
  ContactPerson, KnowledgeGap, KnowledgeGapDetail, KnowledgeGapStatus,
  RecoveryAction, RecoveryActionExecutionStatus, SuggestedActionType,
} from '@nexa/shared';
import {
  AlertCircle, Check, ClipboardList, Copy, FileText, Mail,
  Phone, RefreshCw, Trash2, UserRound, Workflow,
} from 'lucide-react';
import { GapReviewPanel } from './GapReviewPanel';

const lifecycle: Array<[KnowledgeGapStatus, string]> = [
  ['DETECTED', 'Detectado'], ['TRIAGED', 'Clasificado'], ['ACTION_PROPOSED', 'Acción propuesta'],
  ['IN_PROGRESS', 'En progreso'], ['KNOWLEDGE_COLLECTED', 'Conocimiento recopilado'],
  ['AWAITING_APPROVAL', 'Pendiente de aprobación'], ['PUBLISHED', 'Publicado'], ['RESOLVED', 'Resuelto'],
];
const statusLabel = Object.fromEntries(lifecycle) as Record<KnowledgeGapStatus, string>;
const actionTypeLabels: Record<SuggestedActionType, string> = {
  REQUEST_INFORMATION: 'Solicitar información',
  DRAFT_EMAIL: 'Preparar correo',
  REQUEST_DOCUMENT: 'Solicitar documento',
  PROPOSE_MEETING: 'Programar reunión',
  CREATE_DOCUMENTATION_TASK: 'Crear tarea de documentación',
};
const executionLabels: Record<RecoveryActionExecutionStatus, string> = {
  PENDING: 'Pendiente',
  SENT: 'Enviada',
  WAITING_RESPONSE: 'Esperando respuesta',
  RESPONDED: 'Respondida',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};
const availabilityLabels: Record<ContactPerson['availability'], string> = {
  AVAILABLE: 'Disponible', BUSY: 'Ocupado', AWAY: 'Ausente', UNKNOWN: 'Sin estado',
};

function tone(status: KnowledgeGapStatus) {
  return status === 'RESOLVED' || status === 'PUBLISHED' ? 'green'
    : status === 'AWAITING_APPROVAL' ? 'amber'
      : status === 'DETECTED' ? 'red' : 'blue';
}

function emptyDraft(action?: RecoveryAction | null) {
  return {
    recipient: action?.recipient ?? '',
    subject: action?.subject ?? '',
    description: action?.description ?? '',
    objective: action?.objective ?? '',
    dueAt: action?.dueAt ? action.dueAt.slice(0, 16) : '',
    notes: action?.notes ?? '',
    agenda: action?.agenda ?? '',
    meetingLink: action?.meetingLink ?? '',
    meetingAt: action?.meetingAt ? action.meetingAt.slice(0, 16) : '',
    participants: action?.participants?.join(', ') ?? '',
    externalTaskReference: action?.externalTaskReference ?? '',
    responsible: action?.responsible ?? '',
    preparedEmailBody: action?.preparedEmailBody ?? '',
    reminderNote: action?.reminderNote ?? '',
    responseAttachment: action?.responseAttachment ?? '',
    cancelReason: action?.cancelReason ?? '',
    humanNote: action?.humanNote ?? '',
  };
}

type ActionForm = ReturnType<typeof emptyDraft>;

function toIso(local: string): string | null {
  if (!local.trim()) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function KnowledgeOperationsTest({ initialGapId = '' }: { initialGapId?: string }) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [selectedId, setSelectedId] = useState(initialGapId);
  const [gap, setGap] = useState<KnowledgeGapDetail | null>(null);
  const [actionChoice, setActionChoice] = useState('');
  const [form, setForm] = useState<ActionForm>(emptyDraft());
  const [evidence, setEvidence] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [strategyNote, setStrategyNote] = useState('');
  const [manualType, setManualType] = useState<SuggestedActionType>('REQUEST_INFORMATION');
  const [manualDescription, setManualDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [filters, setFilters] = useState({ q: '', disposition: '', priority: '', department: '', from: '', to: '', status: '' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dispositions, setDispositions] = useState<Record<string, string>>({});

  const loadList = useCallback(async (preferredId?: string) => {
    const params = new URLSearchParams({ page: String(page), pageSize: '10' });
    for (const [key, value] of Object.entries(appliedFilters)) if (value) params.set(key, value);
    const response = await fetch('/api/knowledge-reviews?' + params);
    const body = await response.json() as { items?: Array<KnowledgeGap & { reviewDisposition: string }>; total?: number; error?: { message?: string } };
    if (!response.ok || !body.items) throw new Error(body.error?.message ?? 'No se pudieron cargar las brechas.');
    setGaps(body.items);
    setTotal(body.total ?? 0);
    setDispositions(Object.fromEntries(body.items.map(item => [item.id, item.reviewDisposition])));
    setSelectedId(current => {
      if (preferredId && body.items!.some(item => item.id === preferredId)) return preferredId;
      if (current && body.items!.some(item => item.id === current)) return current;
      return body.items![0]?.id ?? '';
    });
  }, [page, appliedFilters]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setGap(null); return; }
    const response = await fetch(`/api/knowledge-gaps/${id}`);
    const body = await response.json() as KnowledgeGapDetail & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? 'No se pudo cargar la brecha.');
    setGap(body);
    const chosen = body.selectedAction?.id
      ?? body.suggestedActions.find(item => !item.discarded)?.id
      ?? '';
    setActionChoice(chosen);
    const action = body.suggestedActions.find(item => item.id === chosen) ?? body.selectedAction;
    setForm(emptyDraft(action));
  }, []);

  const refresh = useCallback(async (id?: string) => {
    await loadList(id);
    const target = id ?? selectedId;
    if (target) await loadDetail(target);
  }, [loadDetail, loadList, selectedId]);

  useEffect(() => {
    setBusy(true);
    loadList(initialGapId || undefined)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'API no disponible.'))
      .finally(() => setBusy(false));
  }, [initialGapId, loadList]);

  useEffect(() => {
    if (!selectedId) { setGap(null); return; }
    setBusy(true);
    loadDetail(selectedId)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo cargar la brecha.'))
      .finally(() => setBusy(false));
  }, [loadDetail, selectedId]);

  async function run(path: string, method: 'POST' | 'PATCH', body?: object): Promise<boolean> {
    if (!gap) return false;
    setBusy(true); setError(''); setCopyNotice('');
    try {
      const init: RequestInit = { method };
      if (body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`/api/knowledge-gaps/${gap.id}${path}`, init);
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'La operación no se completó.');
      await refresh(gap.id);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La operación no se completó.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function selectAction(action: RecoveryAction) {
    setActionChoice(action.id);
    setForm(emptyDraft(action));
  }

  async function saveActionEdits() {
    if (!action) return;
    await run('/action', 'PATCH', {
      actionId: action.id,
      recipient: form.recipient || null,
      subject: form.subject || null,
      description: form.description,
      objective: form.objective || null,
      dueAt: toIso(form.dueAt),
      notes: form.notes || null,
      agenda: form.agenda || null,
      meetingLink: form.meetingLink || null,
      meetingAt: toIso(form.meetingAt),
      participants: form.participants.split(',').map(item => item.trim()).filter(Boolean),
      externalTaskReference: form.externalTaskReference || null,
      responsible: form.responsible || null,
      preparedEmailBody: form.preparedEmailBody || null,
      reminderNote: form.reminderNote || null,
      responseAttachment: form.responseAttachment || null,
      cancelReason: form.cancelReason || null,
      humanNote: form.humanNote || null,
    });
  }

  async function setExecution(status: RecoveryActionExecutionStatus) {
    if (!action) return;
    if (status === 'CANCELLED' && !form.cancelReason.trim()) {
      setError('Escriba una justificación antes de cancelar la acción.');
      return;
    }
    await run('/action', 'PATCH', {
      actionId: action.id,
      executionStatus: status,
      ...(status === 'SENT' ? { sentAt: new Date().toISOString() } : {}),
      ...(status === 'RESPONDED' ? { respondedAt: new Date().toISOString() } : {}),
      ...(status === 'CANCELLED' ? { cancelReason: form.cancelReason.trim() } : {}),
    });
  }

  async function copyEmail() {
    const text = [
      `Para: ${form.recipient}`,
      `Asunto: ${form.subject}`,
      '',
      form.preparedEmailBody || form.description,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice('Correo preparado copiado al portapapeles. No se envió automáticamente.');
    } catch {
      setCopyNotice('No se pudo copiar. Seleccione y copie el texto manualmente.');
    }
  }

  const visibleActions = gap?.suggestedActions.filter(item => !item.discarded) ?? [];
  const action = gap?.suggestedActions.find(item => item.id === actionChoice) ?? gap?.selectedAction ?? visibleActions[0];
  const draft = gap?.currentDraft;
  const currentIndex = gap ? lifecycle.findIndex(([status]) => status === gap.status) : -1;
  const stageThree = gap && (gap.status === 'TRIAGED' || gap.status === 'ACTION_PROPOSED');
  const stageFour = gap && gap.status === 'IN_PROGRESS';
  const canEditAction = gap && (gap.status === 'TRIAGED' || gap.status === 'ACTION_PROPOSED' || gap.status === 'IN_PROGRESS');

  return (
    <div className="operations-layout">
      <section className="panel">
        <div className="operations-heading">
          <div>
            <h2>Brechas de conocimiento</h2>
            <p>Revisa solicitudes detectadas, clasifica las aceptadas y gestiona la recuperación.</p>
          </div>
          <button className="icon-button" onClick={() => { setBusy(true); setError(''); void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Error al actualizar.')).finally(() => setBusy(false)); }} disabled={busy} aria-label="Actualizar brechas">
            <RefreshCw size={16} />
          </button>
        </div>
        <form className="review-filters" onSubmit={event => { event.preventDefault(); setError(''); setPage(1); setAppliedFilters({ ...filters }); }}>
          <label>Buscar por texto<input value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} /></label>
          <label>Revisión<select value={filters.disposition} onChange={event => setFilters({ ...filters, disposition: event.target.value })}><option value="">Todas</option><option value="PENDING">Pendientes de revisión</option><option value="ACCEPTED">Aceptadas</option><option value="DISCARDED">Descartadas</option><option value="DUPLICATE">Duplicadas</option></select></label>
          <label>Prioridad<select value={filters.priority} onChange={event => setFilters({ ...filters, priority: event.target.value })}><option value="">Todas</option><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option></select></label>
          <label>Departamento<input value={filters.department} onChange={event => setFilters({ ...filters, department: event.target.value })} placeholder="Nombre exacto" /></label>
          <label>Desde<input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
          <label>Estado<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{lifecycle.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="button secondary" disabled={busy}>Aplicar filtros</button>
        </form>
        {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brecha</th><th>Estado / revisión</th><th>Ocurrencias</th><th>Prioridad</th><th>Departamento</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map(item => (
                <tr key={item.id} className={selectedId === item.id ? 'row-selected' : ''}>
                  <td className="primary-cell"><button className="text-button" disabled={busy} onClick={() => setSelectedId(item.id)}>{item.title}</button></td>
                  <td>
                    <span className={`badge badge-${tone(item.status)}`}>{statusLabel[item.status]}</span>
                    {dispositions[item.id] === 'DISCARDED' ? ' · Descartada' : dispositions[item.id] === 'DUPLICATE' ? ' · Duplicada' : dispositions[item.id] === 'PENDING' ? ' · Pendiente de revisión' : ''}
                  </td>
                  <td>{item.occurrences}</td>
                  <td>{item.priority}</td>
                  <td>{item.suggestedDepartment ?? 'Sin asignar'}</td>
                </tr>
              ))}
              {!gaps.length && (
                <tr>
                  <td className="empty-cell" colSpan={5}>
                    {busy ? 'Cargando brechas…' : error ? 'No se pudo cargar el listado.' : 'No hay solicitudes que coincidan con los filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="review-pagination">
          <button className="button secondary" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
          <span aria-live="polite">Página {page} · {total} solicitudes</span>
          <button className="button secondary" disabled={busy || page * 10 >= total} onClick={() => setPage(value => value + 1)}>Siguiente</button>
        </div>
      </section>

      {gap && (
        <section className="panel gap-detail">
          <div className="detail-header">
            <div>
              <p className="eyebrow">Detalle de la brecha</p>
              <h2>{gap.title}</h2>
            </div>
            <span className={`badge badge-${tone(gap.status)}`}>{statusLabel[gap.status]}</span>
          </div>

          <div className="detail-stats">
            <div><span>Ocurrencias</span><strong>{gap.occurrences}</strong></div>
            <div><span>Prioridad</span><strong>{gap.priority}</strong></div>
            <div><span>Departamento</span><strong>{gap.suggestedDepartment ?? 'Sin asignar'}</strong></div>
            <div><span>Revisión de evidencia</span><strong>{gap.evidenceRevision}</strong></div>
          </div>

          <h3>Ciclo de recuperación</h3>
          <div className="lifecycle">
            {lifecycle.map(([status, label], index) => (
              <div className={`lifecycle-step ${index < currentIndex ? 'complete' : index === currentIndex ? 'current' : ''}`} key={status}>
                <div className="lifecycle-marker">{index < currentIndex ? <Check size={13} /> : index + 1}</div>
                <span>{label}</span>
                {index < lifecycle.length - 1 && <div className="lifecycle-connector" />}
              </div>
            ))}
          </div>

          <div className="human-gate" role="note">
            <AlertCircle size={16} />
            <div>
              <strong>Ninguna acción externa se ejecuta sin confirmación humana.</strong>
              <p>Correos, reuniones, solicitudes y tareas se preparan o registran en NEXA. Outlook, Gmail y Zoom quedan como ampliación posterior.</p>
            </div>
          </div>

          <div className="detail-columns">
            <div>
              <span className="context-label">Pregunta original</span>
              <p className="detail-text">“{gap.originalQuestion}”</p>

              <span className="context-label">Departamento responsable</span>
              <p className="detail-text">{gap.suggestedDepartment ?? 'Sin departamento asignado todavía.'}</p>

              <span className="context-label">Personas de contacto</span>
              {gap.contacts.length ? gap.contacts.map(contact => (
                <div className="contact-card" key={contact.id}>
                  <span className="avatar small"><UserRound size={13} /></span>
                  <div>
                    <strong>{contact.name}</strong>
                    <small>{contact.title} · {contact.department}</small>
                    <small><Mail size={11} /> {contact.email}</small>
                    {contact.phone && <small><Phone size={11} /> {contact.phone}</small>}
                    <span className={`badge badge-${contact.availability === 'AVAILABLE' ? 'green' : contact.availability === 'BUSY' ? 'amber' : 'neutral'}`}>
                      {availabilityLabels[contact.availability]}
                    </span>
                  </div>
                </div>
              )) : <p className="muted-copy">Sin contactos sintéticos asociados todavía.</p>}

              <span className="context-label spaced">Información faltante</span>
              <p className="detail-text missing-info">{gap.missingInformation}</p>
            </div>

            <div>
              <span className="context-label">Acciones de recuperación</span>
              {(gap.status === 'DETECTED' || stageThree) && (
                <div className="action-options">
                  {visibleActions.map(item => (
                    <div className={`action-option-row ${actionChoice === item.id ? 'selected' : ''}`} key={item.id}>
                      <button type="button" className={actionChoice === item.id ? 'selected' : ''} onClick={() => selectAction(item)}>
                        <span className="action-radio" />
                        <span>
                          <strong>{item.description}</strong>
                          <small>{actionTypeLabels[item.type]}</small>
                        </span>
                      </button>
                      {stageThree && (
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          disabled={busy || visibleActions.length <= 1}
                          aria-label="Descartar sugerencia"
                          onClick={() => void run(`/actions/${item.id}/discard`, 'POST')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!stageThree && gap.status !== 'DETECTED' && action && (
                <div className="selected-action">
                  <Workflow size={16} />
                  <div>
                    <strong>{action.description}</strong>
                    <small>
                      {actionTypeLabels[action.type]}
                      {' · '}
                      {action.approvedAt ? 'Confirmada por una persona' : 'Pendiente de confirmación humana'}
                      {action.executionStatus ? ` · ${executionLabels[action.executionStatus]}` : ''}
                    </small>
                  </div>
                </div>
              )}

              {stageThree && (
                <div className="manual-action">
                  <span className="context-label spaced">Crear acción manual</span>
                  <select value={manualType} onChange={event => setManualType(event.target.value as SuggestedActionType)}>
                    {Object.entries(actionTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <input
                    value={manualDescription}
                    onChange={event => setManualDescription(event.target.value)}
                    placeholder="Descripción de la acción manual"
                  />
                  <button
                    className="button secondary"
                    disabled={busy || !manualDescription.trim()}
                    onClick={() => void run('/actions', 'POST', { type: manualType, description: manualDescription }).then(ok => { if (ok) setManualDescription(''); })}
                  >
                    Agregar acción manual
                  </button>
                </div>
              )}

              <span className="context-label spaced">Borrador actual</span>
              {draft ? (
                <div className="draft-card">
                  <FileText size={16} />
                  <div>
                    <strong>{draft.title}</strong>
                    <small>Revisión {draft.revision} · evidencia {draft.evidenceRevisionUsed}</small>
                    <p>{draft.content}</p>
                  </div>
                </div>
              ) : <p className="muted-copy">Todavía no existe un borrador.</p>}
            </div>
          </div>

          {canEditAction && action && (
            <div className="action-editor">
              <div className="panel-heading">
                <h2>{stageFour ? 'Seguimiento de la acción' : 'Editar acción propuesta'}</h2>
              </div>
              <div className="form-grid">
                <label>Destinatario<input value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} /></label>
                <label>Responsable<input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></label>
                <label>Asunto<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
                <label>Fecha límite<input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} /></label>
                <label className="full">Descripción<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
                <label className="full">Objetivo<textarea value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })} /></label>
                <label className="full">Notas<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
                {(action.type === 'PROPOSE_MEETING' || stageFour) && (
                  <>
                    <label className="full">Agenda<textarea value={form.agenda} onChange={e => setForm({ ...form, agenda: e.target.value })} /></label>
                    <label>Enlace de reunión<input value={form.meetingLink} onChange={e => setForm({ ...form, meetingLink: e.target.value })} placeholder="https://…" /></label>
                    <label>Fecha y hora de reunión<input type="datetime-local" value={form.meetingAt} onChange={e => setForm({ ...form, meetingAt: e.target.value })} /></label>
                    <label className="full">Participantes<input value={form.participants} onChange={e => setForm({ ...form, participants: e.target.value })} placeholder="Separados por coma" /></label>
                  </>
                )}
                {(action.type === 'DRAFT_EMAIL' || action.type === 'REQUEST_INFORMATION' || action.type === 'REQUEST_DOCUMENT' || stageFour) && (
                  <label className="full">Correo preparado<textarea value={form.preparedEmailBody} onChange={e => setForm({ ...form, preparedEmailBody: e.target.value })} rows={6} /></label>
                )}
                {(action.type === 'CREATE_DOCUMENTATION_TASK' || stageFour) && (
                  <label className="full">Tarea externa / referencia<input value={form.externalTaskReference} onChange={e => setForm({ ...form, externalTaskReference: e.target.value })} placeholder="Enlace o ID de tarea externa" /></label>
                )}
                {stageFour && (
                  <>
                    <label className="full">Recordatorio<textarea value={form.reminderNote} onChange={e => setForm({ ...form, reminderNote: e.target.value })} /></label>
                    <label className="full">Respuesta recibida / adjunto textual<textarea value={form.responseAttachment} onChange={e => setForm({ ...form, responseAttachment: e.target.value })} /></label>
                    <label className="full">Justificación de cancelación<textarea value={form.cancelReason} onChange={e => setForm({ ...form, cancelReason: e.target.value })} /></label>
                  </>
                )}
              </div>
              <div className="editor-actions">
                <button className="button secondary" disabled={busy} onClick={() => void saveActionEdits()}>Guardar cambios de la acción</button>
                {(action.type === 'DRAFT_EMAIL' || action.type === 'REQUEST_INFORMATION' || action.type === 'REQUEST_DOCUMENT') && (
                  <button className="button secondary" disabled={busy} onClick={() => void copyEmail()}><Copy size={14} /> Copiar correo preparado</button>
                )}
              </div>
              {copyNotice && <p className="muted-copy">{copyNotice}</p>}
            </div>
          )}

          {stageFour && action && (
            <div className="progress-panel">
              <div className="panel-heading"><h2>Estado de la acción</h2></div>
              <div className="status-chips">
                {(Object.keys(executionLabels) as RecoveryActionExecutionStatus[]).map(status => (
                  <button
                    key={status}
                    type="button"
                    className={`status-chip ${action.executionStatus === status ? 'active' : ''}`}
                    disabled={busy || (status === 'CANCELLED' && !form.cancelReason.trim())}
                    onClick={() => void setExecution(status)}
                  >
                    {executionLabels[status]}
                  </button>
                ))}
              </div>

              <div className="panel-heading spaced-heading"><h2>Línea de tiempo</h2></div>
              <div className="activity-list">
                {gap.activity.map(event => (
                  <div className="activity" key={event.id}>
                    <span className="activity-icon"><ClipboardList size={14} /></span>
                    <div>
                      <strong>{event.summary}</strong>
                      {event.detail && <p>{event.detail}</p>}
                    </div>
                    <time>{new Date(event.createdAt).toLocaleString('es')}</time>
                  </div>
                ))}
                {!gap.activity.length && <p className="empty-cell">Todavía no hay actividad registrada.</p>}
              </div>

              <div className="evidence-editor activity-editor">
                <label htmlFor="activity-note">Registrar avance o nota</label>
                <textarea id="activity-note" value={activityNote} onChange={e => setActivityNote(e.target.value)} placeholder="Avance, recordatorio o nota de seguimiento." />
                <button
                  className="button secondary"
                  disabled={busy || !activityNote.trim()}
                  onClick={() => void run('/activity', 'POST', { summary: activityNote, type: 'NOTE' }).then(ok => { if (ok) setActivityNote(''); })}
                >
                  Guardar nota
                </button>
              </div>

              <div className="strategy-return">
                <label htmlFor="strategy-note">Cambiar estrategia (regresar a Acción propuesta)</label>
                <textarea id="strategy-note" value={strategyNote} onChange={e => setStrategyNote(e.target.value)} placeholder="Justifique por qué debe cambiarse la estrategia." />
                <button
                  className="button danger"
                  disabled={busy || !strategyNote.trim()}
                  onClick={() => void run('/transition', 'POST', {
                    fromStatus: 'IN_PROGRESS',
                    toStatus: 'ACTION_PROPOSED',
                    humanNote: strategyNote,
                  }).then(ok => { if (ok) setStrategyNote(''); })}
                >
                  Regresar a Acción propuesta
                </button>
              </div>
            </div>
          )}

          <div className="workflow-controls">
            <GapReviewPanel gap={gap} refresh={() => refresh(gap.id)} />
            {gap.status === 'TRIAGED' && action && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void run('/transition', 'POST', { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED', selectedActionId: action.id })}
              >
                Seleccionar acción propuesta
              </button>
            )}
            {gap.status === 'ACTION_PROPOSED' && action && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void run('/transition', 'POST', {
                  fromStatus: 'ACTION_PROPOSED',
                  toStatus: 'IN_PROGRESS',
                  selectedActionId: action.id,
                  approveSimulatedAction: true,
                  humanNote: form.humanNote || 'Aprobada manualmente desde la interfaz NEXA.',
                })}
              >
                <Check size={15} /> Confirmar e iniciar recuperación simulada
              </button>
            )}
            {(gap.status === 'IN_PROGRESS' || gap.status === 'KNOWLEDGE_COLLECTED') && (
              <div className="evidence-editor">
                <label htmlFor="evidence">Información recopilada</label>
                <textarea id="evidence" value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Agrega información verificable y su contexto de origen." />
                <button className="button secondary" disabled={busy || !evidence.trim()} onClick={() => void run('/evidence', 'POST', { content: evidence, origin: 'Información ingresada manualmente' })}>Adjuntar evidencia</button>
              </div>
            )}
            {gap.status === 'IN_PROGRESS' && (
              <button className="button primary" disabled={busy || !gap.evidenceRevision} onClick={() => void run('/transition', 'POST', { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' })}>
                Confirmar conocimiento recopilado
              </button>
            )}
            {gap.status === 'KNOWLEDGE_COLLECTED' && (
              <>
                <button className="button secondary" disabled={busy} onClick={() => void run('/draft', 'POST', { mode: 'GENERATE', evidenceRevision: gap.evidenceRevision })}>Generar nueva revisión</button>
                {draft && <button className="button primary" disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' })}>Enviar a aprobación</button>}
              </>
            )}
            {gap.status === 'AWAITING_APPROVAL' && draft && (
              <>
                <button className="button secondary" disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'CHANGES_REQUESTED', draftRevision: draft.revision, comment: 'Preparar una revisión nueva.' })}>Solicitar cambios</button>
                <button className="button danger" disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'REJECTED', draftRevision: draft.revision, comment: 'Rechazado en revisión humana.' })}>Rechazar</button>
                <button className="button primary" disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'APPROVED', draftRevision: draft.revision, comment: 'Validado manualmente.' })}><Check size={15} /> Aprobar y publicar</button>
              </>
            )}
            {gap.status === 'PUBLISHED' && (
              <button className="button primary" disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' })}>Cerrar brecha explícitamente</button>
            )}
            {gap.status === 'RESOLVED' && (
              <p className="completion-note"><span className="completion-check"><Check size={14} /></span> Esta brecha fue publicada y cerrada explícitamente.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
