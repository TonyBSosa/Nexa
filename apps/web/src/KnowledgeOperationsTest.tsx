import { useState } from 'react';
import type { KnowledgeGapDetail } from '@nexa/shared';

const demoEvidence = 'Antes de retirar una impresora, Soporte de TI verifica que el equipo ya no esté asignado a un usuario. El número de activo y número de serie se registran. Gestión de Activos actualiza el inventario. Si el equipo contiene almacenamiento interno, TI realiza el borrado correspondiente. Finalmente, Gestión de Activos autoriza la baja y registra el destino del equipo.';

export function KnowledgeOperationsTest() {
  const [gapId, setGapId] = useState('');
  const [gap, setGap] = useState<KnowledgeGapDetail | null>(null);
  const [evidence, setEvidence] = useState(demoEvidence);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!gapId.trim()) return;
    const response = await fetch(`/api/knowledge-gaps/${gapId.trim()}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'No se pudo cargar la brecha.');
    setGap(body as KnowledgeGapDetail);
  }

  async function run(path: string, method: 'POST' | 'PATCH', body: object) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/knowledge-gaps/${gapId}${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'La operación no se completó.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La operación no se completó.');
    } finally {
      setBusy(false);
    }
  }

  async function loadSafely() {
    setBusy(true);
    setError('');
    try { await load(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar la brecha.');
    } finally { setBusy(false); }
  }

  const action = gap?.selectedAction ?? gap?.suggestedActions[0];
  const draft = gap?.currentDraft;

  return (
    <section lang="es" aria-labelledby="operations-heading">
      <h2 id="operations-heading">Prueba de desarrollo: Knowledge Operations</h2>
      <p>Las acciones externas son simuladas. Cada avance requiere una operación humana explícita.</p>
      <label htmlFor="gap-id">ID de brecha</label>{' '}
      <input id="gap-id" value={gapId} onChange={(event) => setGapId(event.target.value)} />{' '}
      <button disabled={busy || !gapId.trim()} onClick={() => void loadSafely()}>Cargar</button>
      {error && <p role="alert">{error}</p>}
      {gap && <>
        <p><strong>Estado:</strong> {gap.status} · <strong>revisión de evidencia:</strong> {gap.evidenceRevision}</p>
        {gap.status === 'DETECTED' && <>
          <button disabled={busy} onClick={() => void run('/triage', 'PATCH', { priority: 'HIGH', category: 'TI / Equipos' })}>Guardar clasificación</button>{' '}
          <button disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'DETECTED', toStatus: 'TRIAGED' })}>Confirmar revisión de brecha</button>
        </>}
        {gap.status === 'TRIAGED' && action && <button disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED', selectedActionId: action.id })}>Seleccionar acción simulada</button>}
        {gap.status === 'ACTION_PROPOSED' && action && <button disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: action.id, approveSimulatedAction: true, humanNote: 'Aprobada manualmente en el harness.' })}>Aprobar e iniciar acción</button>}
        {(gap.status === 'IN_PROGRESS' || gap.status === 'KNOWLEDGE_COLLECTED') && <div>
          <label htmlFor="evidence">Información recopilada</label><br />
          <textarea id="evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          <br /><button disabled={busy || !evidence.trim()} onClick={() => void run('/evidence', 'POST', { content: evidence, origin: 'Información sintética ingresada manualmente' })}>Agregar evidencia</button>
        </div>}
        {gap.status === 'IN_PROGRESS' && <button disabled={busy || !gap.evidenceRevision} onClick={() => void run('/transition', 'POST', { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' })}>Confirmar información recopilada</button>}
        {gap.status === 'KNOWLEDGE_COLLECTED' && <>
          <button disabled={busy} onClick={() => void run('/draft', 'POST', { mode: 'GENERATE', evidenceRevision: gap.evidenceRevision })}>Generar nueva revisión de borrador</button>{' '}
          {draft && <>
            <pre>{draft.content}</pre>
            <button disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' })}>Enviar borrador a revisión</button>
          </>}
        </>}
        {gap.status === 'AWAITING_APPROVAL' && draft && <div>
          <h3>Borrador revisión {draft.revision}</h3>
          <pre>{draft.content}</pre>
          <button disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'APPROVED', draftRevision: draft.revision, comment: 'Validado manualmente.' })}>Aprobar y publicar</button>{' '}
          <button disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'CHANGES_REQUESTED', draftRevision: draft.revision, comment: 'Preparar una revisión nueva.' })}>Solicitar cambios</button>{' '}
          <button disabled={busy} onClick={() => void run('/approval', 'POST', { decision: 'REJECTED', draftRevision: draft.revision, comment: 'Rechazado en revisión humana.' })}>Rechazar revisión</button>
        </div>}
        {gap.status === 'PUBLISHED' && <button disabled={busy} onClick={() => void run('/transition', 'POST', { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' })}>Cerrar brecha explícitamente</button>}
        <details><summary>Detalle persistido</summary><pre>{JSON.stringify(gap, null, 2)}</pre></details>
      </>}
    </section>
  );
}
