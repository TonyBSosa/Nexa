import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiErrorResponse, ChatRequest, ChatResponse } from '@nexa/shared';
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Lightbulb, Sparkles, UserRound } from 'lucide-react';

const clientSessionStorageKey = 'nexa.clientSessionId';

function getClientSessionId(): string {
  const existing = localStorage.getItem(clientSessionStorageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(clientSessionStorageKey, created);
  return created;
}

export function ChatTest({ onOpenGap }: { onOpenGap?: (id: string) => void }) {
  const [message, setMessage] = useState('¿Qué tóner utiliza la impresora MX550?');
  const [submitted, setSubmitted] = useState('');
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    setSubmitted(cleanMessage);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const request: ChatRequest = { message: cleanMessage, clientSessionId: getClientSessionId() };
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(120_000),
      });
      const body: ChatResponse | ApiErrorResponse = await response.json();
      if ('queryId' in body) setResult(body);
      if (!response.ok) setError(body.error?.message ?? 'No se pudo procesar la pregunta.');
    } catch {
      setError('API no disponible o respuesta no válida. Inicie la API e inténtelo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  const sufficient = result?.status === 'SUFFICIENT';
  return <div className="assistant-layout"><section className="panel conversation"><div className="conversation-head"><div><span className="badge badge-green">● En línea</span><h2>Asistente de conocimiento</h2></div><span className="muted-cell">Conectado al API de NEXA</span></div><div className="messages">
    {!submitted && <div className="assistant-welcome"><span className="nexa-avatar"><Sparkles size={17} /></span><div><h2>¿Qué necesitas saber?</h2><p>Consulta procedimientos y conocimiento aprobado de tu organización.</p><div className="prompt-list"><button onClick={() => setMessage('¿Qué tóner utiliza la impresora MX550?')}>¿Qué tóner utiliza la impresora MX550?</button><button onClick={() => setMessage('¿Cuál es el procedimiento de la empresa para dar de baja una impresora?')}>¿Cómo se da de baja una impresora?</button></div></div></div>}
    {submitted && <div className="message user"><span className="avatar small"><UserRound size={14} /></span><div><span className="message-label">Tú</span><p>{submitted}</p></div></div>}
    {loading && <div className="message"><span className="nexa-avatar"><Sparkles size={15} /></span><div><span className="message-label">NEXA</span><p className="typing">Evaluando conocimiento organizacional…</p></div></div>}
      {result && <div className="message"><span className={`nexa-avatar ${sufficient ? '' : 'warning'}`}>{sufficient ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span><div className="message-body"><span className="message-label">NEXA <span className={`badge badge-${sufficient ? 'green' : result.status === 'FAILURE' ? 'red' : 'amber'}`}>{sufficient ? 'Conocimiento suficiente' : result.status === 'FAILURE' ? 'Evaluación no confirmada' : result.organizationallyRelevant ? 'Conocimiento insuficiente' : 'Fuera del alcance'}</span></span><p>{result.answer}</p>
      {result.knowledgeGapId && <button className="gap-callout" onClick={() => onOpenGap?.(result.knowledgeGapId!)}><AlertCircle size={16} /><span><strong>Brecha de conocimiento creada</strong><small>ID: {result.knowledgeGapId}</small></span><ArrowRight size={15} /></button>}
      {result.evidence.map((item, index) => <div className="evidence" key={`${item.sourceId}-${item.documentId ?? item.articleId ?? index}`}><FileText size={16} /><span><strong>{item.title}</strong><small>{item.sourceId}{item.articleRevision ? ` · revisión ${item.articleRevision}` : ''}</small></span></div>)}
      {(result.suggestedCategory || result.suggestedDepartment || result.suggestedExperts?.length) && <div className="suggestion-meta"><strong>Contexto sugerido</strong><span>{[result.suggestedCategory, result.suggestedDepartment, result.suggestedExperts?.join(', ')].filter(Boolean).join(' · ')}</span></div>}
      {result.suggestedActions?.length && <div className="recovery-suggestions"><strong><Lightbulb size={14} /> Acciones de recuperación sugeridas</strong>{result.suggestedActions.map((action, index) => <p key={`${action.type}-${index}`}><span>{action.type.replaceAll('_', ' ')}</span>{action.description}</p>)}</div>}
      <small className="query-id">Consulta {result.queryId} · relevancia organizacional: {result.organizationallyRelevant === null ? 'desconocida' : result.organizationallyRelevant ? 'sí' : 'no'}</small>
    </div></div>}
    {error && !result && <div className="inline-error" role="alert"><AlertCircle size={17} />{error}</div>}
  </div><form className="composer" onSubmit={(event) => void send(event)}><label className="sr-only" htmlFor="question">Pregunta</label><input id="question" value={message} onChange={event => setMessage(event.target.value)} placeholder="Pregunta a NEXA sobre tu organización…" disabled={loading} /><button aria-label="Enviar pregunta" disabled={loading || !message.trim()}><ArrowRight size={18} /></button></form></section>
  <aside className="context-panel"><h3>Contexto de respuesta</h3><div className="context-section"><span className="context-label">Estado</span><p>{result ? sufficient ? 'La respuesta usa conocimiento suficiente y trazable.' : result.organizationallyRelevant ? 'La consulta reveló conocimiento que debe recuperarse.' : 'La consulta no corresponde al conocimiento organizacional disponible.' : 'Envía una pregunta para evaluar el conocimiento disponible.'}</p></div><div className="context-section"><span className="context-label">Pruebas rápidas</span><button onClick={() => setMessage('¿Qué tóner utiliza la impresora MX550?')}>MX550 → NX-550 Black</button><button onClick={() => setMessage('¿Cuál es el procedimiento de la empresa para dar de baja una impresora?')}>Crear una brecha</button><button onClick={() => setMessage('simular fallo del agente')}>Simular indisponibilidad</button></div></aside></div>;
}
