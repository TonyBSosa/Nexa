import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiErrorResponse, ChatRequest, ChatResponse } from '@nexa/shared';

const clientSessionStorageKey = 'nexa.clientSessionId';

function getClientSessionId(): string {
  const existing = localStorage.getItem(clientSessionStorageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(clientSessionStorageKey, created);
  return created;
}

export function ChatTest() {
  const [message, setMessage] = useState('¿Qué tóner utiliza la impresora MX550?');
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const request: ChatRequest = { message, clientSessionId: getClientSessionId() };
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(10000),
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

  return (
    <section aria-labelledby="chat-heading" lang="es">
      <h2 id="chat-heading">Prueba de desarrollo del agente</h2>
      <p>FakeAgentProvider: ejemplos sintéticos deterministas, sin IA en vivo. Se guardan consultas y brechas detectadas.</p>
      <ul>
        <li>¿Qué tóner utiliza la impresora MX550?</li>
        <li>¿Cuál es el procedimiento de la empresa para dar de baja una impresora?</li>
        <li>¿Cuál es la capital de Francia?</li>
        <li>simular fallo del agente (solo desarrollo)</li>
      </ul>
      <form onSubmit={(event) => void send(event)}>
        <label htmlFor="question">Pregunta</label><br />
        <textarea id="question" value={message} onChange={(event) => setMessage(event.target.value)} required disabled={loading} />
        <br /><button type="submit" disabled={loading || !message.trim()}>Enviar</button>
      </form>
      {loading && <p role="status">Evaluando pregunta…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <dl>
            <dt>Estado</dt><dd>{result.status}</dd>
            <dt>Respuesta</dt><dd>{result.answer}</dd>
            <dt>Conocimiento suficiente</dt><dd>{String(result.sufficientKnowledge)}</dd>
            <dt>Relevancia organizacional</dt><dd>{result.organizationallyRelevant === null ? 'Desconocida' : String(result.organizationallyRelevant)}</dd>
            <dt>ID de consulta</dt><dd>{result.queryId}</dd>
            {result.knowledgeGapId && <><dt>ID de brecha de conocimiento</dt><dd>{result.knowledgeGapId}</dd></>}
          </dl>
          <h3>Evidencia</h3>
          {result.evidence.length ? <ul>{result.evidence.map((item) => <li key={`${item.sourceId}/${item.documentId ?? item.title}`}>{item.title} ({item.sourceId})</li>)}</ul> : <p>No se recibió evidencia.</p>}
          {result.suggestedCategory && <p>Categoría: {result.suggestedCategory}</p>}
          {result.suggestedDepartment && <p>Departamento: {result.suggestedDepartment}</p>}
          {result.suggestedExperts && <p>Roles ficticios sugeridos: {result.suggestedExperts.join(', ')}</p>}
          {result.suggestedActions && <ul>{result.suggestedActions.map((action) => <li key={action.type}>{action.type}: {action.description}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
