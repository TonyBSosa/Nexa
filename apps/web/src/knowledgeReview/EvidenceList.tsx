import { Download, ExternalLink, Eye, FileText, Users } from 'lucide-react';
import type { EvidenceItem, EvidenceType } from '@nexa/shared';
import './knowledgeReview.css';

const typeLabels: Record<EvidenceType, string> = {
  MANUAL_TEXT: 'Texto manual', MEETING_NOTES: 'Notas de reunión', TRANSCRIPT: 'Transcripción',
  PDF: 'PDF', DOCUMENT: 'Documento', IMAGE: 'Imagen', LINK: 'Enlace', VIDEO: 'Video',
  VIDEO_LINK: 'Enlace a video', SNIPPET: 'Fragmento de script o procedimiento',
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidenceBody({ item }: { item: EvidenceItem }) {
  return <>
    {item.content && <p className="kr-text-block">{item.content}</p>}
    {item.url && <a className="kr-link" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{item.url}</a>}
    {item.file && <div className="kr-file">
      <FileText size={15} />
      <span className="kr-file-name">{item.file.fileName}</span>
      <small className="kr-meta">{formatSize(item.file.sizeBytes)}</small>
      <a className="kr-link" href={item.file.viewUrl} target="_blank" rel="noopener noreferrer"><Eye size={13} />Ver</a>
      <a className="kr-link" href={item.file.downloadUrl} download={item.file.fileName}><Download size={13} />Descargar</a>
    </div>}
    {item.meeting && <div className="kr-meeting">
      <span className="kr-meta"><Users size={13} /> {item.meeting.participants.join(', ')}</span>
      <p className="kr-text-block">{item.meeting.summary}</p>
      {item.meeting.agreements.length > 0 && <><span className="context-label">Acuerdos</span><ul className="kr-list">{item.meeting.agreements.map((agreement, index) => <li key={index}>{agreement}</li>)}</ul></>}
      {item.meeting.transcript && <details><summary>Transcripción</summary><p className="kr-text-block">{item.meeting.transcript}</p></details>}
      {item.meeting.recordingUrl && <a className="kr-link" href={item.meeting.recordingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />Grabación</a>}
    </div>}
  </>;
}

export function EvidenceList({ items, showSuperseded = false, onReplace, onWithdraw }: {
  items: EvidenceItem[];
  showSuperseded?: boolean;
  onReplace?: (item: EvidenceItem) => void;
  onWithdraw?: (item: EvidenceItem) => void;
}) {
  const visible = showSuperseded ? items : items.filter((item) => item.supersededBy === null);
  if (!visible.length) return <p className="kr-empty">Todavía no hay evidencia registrada.</p>;
  return <ul className="kr-evidence-list">
    {visible.map((item) => <li key={item.id} className={`kr-evidence${item.withdrawal ? ' kr-withdrawn' : ''}`}>
      <div className="kr-evidence-header">
        <strong>{typeLabels[item.type]}</strong>
        <span className="badge badge-neutral">Versión {item.version}</span>
        {item.withdrawal && <span className="badge badge-red">Retirada</span>}
        {item.supersededBy && <span className="badge badge-amber">Reemplazada</span>}
      </div>
      <small className="kr-meta">
        Fuente: {item.source} · Autor: {item.author ?? 'Sin registrar'} · Fecha: {item.evidenceDate ?? item.createdAt.slice(0, 10)}
        {item.reference && ` · Referencia: ${item.reference}`}
      </small>
      <EvidenceBody item={item} />
      {item.note && <p className="kr-note"><span className="context-label">Nota</span>{item.note}</p>}
      {item.withdrawal && <p className="kr-note"><span className="context-label">Retirada por {item.withdrawal.actor}</span>{item.withdrawal.justification}</p>}
      {!item.withdrawal && !item.supersededBy && (onReplace || onWithdraw) && <div className="kr-evidence-actions">
        {onReplace && item.file && <button type="button" className="button secondary" onClick={() => onReplace(item)}>Reemplazar archivo</button>}
        {onWithdraw && <button type="button" className="button secondary" onClick={() => onWithdraw(item)}>Retirar</button>}
      </div>}
    </li>)}
  </ul>;
}
