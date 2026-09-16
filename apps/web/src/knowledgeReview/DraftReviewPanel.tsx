import { useCallback, useEffect, useState } from 'react';
import type { ChecklistConfirmations, DraftReviewDetail, EvidenceItem, EvidenceType, KnowledgeGapDetail } from '@nexa/shared';
import { DecisionHistory } from './DecisionHistory';
import { EvidenceList } from './EvidenceList';
import { RevisionDiffView } from './RevisionDiffView';
import './knowledgeReview.css';

const confirmationLabels: Array<[keyof ChecklistConfirmations, string]> = [
  ['answerClear', 'La respuesta es clara'],
  ['noImproperConfidentialInfo', 'No contiene información confidencial improcedente'],
  ['readyForReview', 'Está lista para revisión'],
];


/** File-backed evidence types and the accept filter each one offers. */
const fileTypes: Array<[EvidenceType, string, string]> = [
  ['PDF', 'PDF', '.pdf'],
  ['DOCUMENT', 'Documento', '.doc,.docx,.xlsx,.pptx,.odt,.txt,.md'],
  ['IMAGE', 'Imagen', '.png,.jpg,.jpeg,.webp,.gif'],
  ['VIDEO', 'Video', '.mp4,.webm'],
];

/** The API takes the bytes as base64 alongside the metadata. */
async function readAsUpload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { fileName: file.name, mimeType: file.type, sizeBytes: bytes.byteLength, content: btoa(binary) };
}

export function DraftReviewPanel({ gap, refresh }: { gap: KnowledgeGapDetail; refresh: () => Promise<void> }) {
  const [detail, setDetail] = useState<DraftReviewDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actor, setActor] = useState('');
  const [comment, setComment] = useState('');
  const [reviewers, setReviewers] = useState('');
  const [fileType, setFileType] = useState<EvidenceType>('PDF');
  const [fileSource, setFileSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [replacing, setReplacing] = useState<EvidenceItem | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(`/api/knowledge-gaps/${gap.id}/draft-review`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar la revisión del borrador.');
      const body = await response.json() as DraftReviewDetail;
      if (!controller.signal.aborted) setDetail(body);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Error de revisión.');
    });
    return () => controller.abort();
  }, [gap.id, gap.updatedAt, reload]);

  const send = useCallback(async (path: string, body: object, expected = 200) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/knowledge-gaps/${gap.id}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: { message: string } };
      if (response.status !== expected) throw new Error(result.error?.message || 'No se completó la operación.');
      await refresh();
      setReload(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se completó la operación.');
    } finally {
      setBusy(false);
    }
  }, [gap.id, refresh]);

  async function uploadEvidence() {
    if (!file) return;
    await send('/evidence-items', {
      type: fileType, source: fileSource, author: actor,
      evidenceDate: new Date().toISOString().slice(0, 10),
      file: await readAsUpload(file),
    }, 201);
    setFile(null);
  }

  async function replaceEvidence() {
    if (!replacing || !replacementFile) return;
    await send(`/evidence/${replacing.id}/replace`, {
      actor, reason, file: await readAsUpload(replacementFile),
    });
    setReplacing(null);
    setReplacementFile(null);
    setReason('');
  }

  if (!detail) {
    return <div role={error ? 'alert' : 'status'}>{error || 'Cargando revisión del borrador…'}</div>;
  }

  const { state, checklist } = detail;
  const collecting = gap.status === 'IN_PROGRESS' || gap.status === 'KNOWLEDGE_COLLECTED';
  const deciding = gap.status === 'AWAITING_APPROVAL';
  const canDecide = state.assignedReviewers.length === 0 || actor.trim().length > 0;

  function toggle(key: keyof ChecklistConfirmations) {
    void send('/draft-review/checklist', {
      revision: state.revision,
      confirmations: { ...state.confirmations, [key]: !state.confirmations[key] },
    });
  }

  return <section className="kr-panel">
    <h3>Evidencia y revisión del borrador</h3>
    {error && <p className="inline-error" role="alert">{error}</p>}

    <h4>Evidencia recopilada ({detail.evidence.filter(item => item.supersededBy === null).length})</h4>
    <EvidenceList items={detail.evidence} {...(collecting ? { onReplace: setReplacing } : {})} />

    {collecting && <div className="kr-upload">
      <h4>Agregar un archivo como evidencia</h4>
      <label>Tipo
        <select value={fileType} disabled={busy} onChange={event => setFileType(event.target.value as EvidenceType)}>
          {fileTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Fuente
        <input value={fileSource} onChange={event => setFileSource(event.target.value)} maxLength={200} disabled={busy} />
      </label>
      <label>Quién lo aporta
        <input value={actor} onChange={event => setActor(event.target.value)} maxLength={120} disabled={busy} />
      </label>
      <label>Archivo
        <input
          type="file"
          accept={fileTypes.find(([value]) => value === fileType)?.[2]}
          disabled={busy}
          onChange={event => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className="muted-copy">PDF y documentos hasta 10 MB, imágenes 5 MB, video 25 MB.</p>
      <button
        className="button secondary"
        disabled={busy || !file || !fileSource.trim() || !actor.trim()}
        onClick={() => void uploadEvidence()}
      >Adjuntar archivo</button>
    </div>}

    {replacing && <div className="kr-upload">
      <h4>Reemplazar el archivo de una evidencia</h4>
      <p className="muted-copy">
        Se conserva la versión anterior y la nueva queda como versión {replacing.version + 1}.
      </p>
      <label>Quién lo reemplaza
        <input value={actor} onChange={event => setActor(event.target.value)} maxLength={120} disabled={busy} />
      </label>
      <label>Motivo
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={busy} />
      </label>
      <label>Archivo nuevo
        <input type="file" disabled={busy} onChange={event => setReplacementFile(event.target.files?.[0] ?? null)} />
      </label>
      <div className="workflow-controls">
        <button
          className="button primary"
          disabled={busy || !replacementFile || !reason.trim() || !actor.trim()}
          onClick={() => void replaceEvidence()}
        >Confirmar reemplazo</button>
        <button className="button secondary" disabled={busy} onClick={() => setReplacing(null)}>Cancelar</button>
      </div>
    </div>}

    {(collecting || deciding) && <>
      <h4>Lista de verificación</h4>
      <ul className="kr-checklist">
        {checklist.items.map(item => <li key={item.key} className={item.satisfied ? 'kr-checked' : 'kr-unchecked'}>
          {item.kind === 'CONFIRMATION' && confirmationLabels.some(([key]) => key === toConfirmationKey(item.key))
            ? <label>
              <input
                type="checkbox"
                disabled={busy || deciding}
                checked={state.confirmations[toConfirmationKey(item.key)!]}
                onChange={() => toggle(toConfirmationKey(item.key)!)}
              />
              {item.label}
            </label>
            : <span>{item.label}</span>}
          {!item.satisfied && item.reason && <small className="kr-meta">{item.reason}</small>}
        </li>)}
      </ul>
      {checklist.complete
        ? <p role="status">La lista está completa; el borrador puede enviarse a aprobación.</p>
        : <p role="status">Complete la lista antes de enviar el borrador a aprobación.</p>}
    </>}

    {detail.diff && <>
      <h4>Cambios respecto a la revisión anterior</h4>
      <RevisionDiffView diff={detail.diff} />
    </>}

    {gap.status === 'KNOWLEDGE_COLLECTED' && <div className="kr-reviewers">
      <h4>Revisores asignados</h4>
      {state.assignedReviewers.length
        ? <p>{state.assignedReviewers.join(', ')} · propuesto por {state.submittedBy}</p>
        : <p className="kr-empty">Todavía no hay revisores asignados.</p>}
      <label>Quién propone el borrador
        <input value={actor} onChange={event => setActor(event.target.value)} maxLength={120} disabled={busy} />
      </label>
      <label>Revisores, uno por línea
        <textarea value={reviewers} onChange={event => setReviewers(event.target.value)} disabled={busy} />
      </label>
      <p className="muted-copy">Nombre o rol declarado; identidad no verificada en este MVP.</p>
      <button
        className="button secondary"
        disabled={busy || !actor.trim() || !reviewers.trim()}
        onClick={() => void send('/draft-review/reviewers', {
          revision: state.revision,
          submittedBy: actor,
          reviewers: reviewers.split('\n').map(value => value.trim()).filter(Boolean),
        })}
      >Asignar revisores</button>
    </div>}

    {deciding && <div className="kr-decision">
      <h4>Decisión sobre la revisión {state.revisionUnderReview ?? gap.currentDraft?.revision}</h4>
      {state.assignedReviewers.length > 0 && <p className="muted-copy">
        Solo pueden decidir: {state.assignedReviewers.join(', ')}. El autor del borrador no puede decidir.
      </p>}
      <label>Persona que revisa
        <input value={actor} onChange={event => setActor(event.target.value)} maxLength={120} disabled={busy} />
      </label>
      <label>Comentario, obligatorio para solicitar cambios o rechazar
        <textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={2000} disabled={busy} />
      </label>
      <div className="workflow-controls">
        <button
          className="button secondary"
          disabled={busy || !canDecide || !comment.trim()}
          onClick={() => void send('/approval', { decision: 'CHANGES_REQUESTED', draftRevision: gap.currentDraft!.revision, comment, ...(actor.trim() && { actor }) })}
        >Solicitar cambios</button>
        <button
          className="button danger"
          disabled={busy || !canDecide || !comment.trim()}
          onClick={() => void send('/approval', { decision: 'REJECTED', draftRevision: gap.currentDraft!.revision, comment, ...(actor.trim() && { actor }) })}
        >Rechazar</button>
        <button
          className="button primary"
          disabled={busy || !canDecide}
          onClick={() => void send('/approval', { decision: 'APPROVED', draftRevision: gap.currentDraft!.revision, ...(comment.trim() && { comment }), ...(actor.trim() && { actor }) })}
        >Aprobar y publicar</button>
      </div>
    </div>}

    {detail.comments.length > 0 && <>
      <h4>Comentarios sobre el contenido ({detail.comments.length})</h4>
      <ul className="kr-list">
        {detail.comments.map(entry => <li key={entry.id}>
          <strong>{entry.actor}</strong>
          {entry.startLine !== null && <span className="kr-meta"> · líneas {entry.startLine}–{entry.endLine}</span>}
          <p className="kr-text-block">{entry.body}</p>
        </li>)}
      </ul>
    </>}

    <h4>Historial de decisiones</h4>
    <DecisionHistory entries={detail.history} />
  </section>;
}

/** Maps the checklist key to the confirmation it toggles, when it has one. */
function toConfirmationKey(key: string): keyof ChecklistConfirmations | null {
  if (key === 'ANSWER_CLEAR') return 'answerClear';
  if (key === 'NO_IMPROPER_CONFIDENTIAL_INFO') return 'noImproperConfidentialInfo';
  if (key === 'READY_FOR_REVIEW') return 'readyForReview';
  return null;
}
