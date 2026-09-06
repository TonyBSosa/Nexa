import { useState } from 'react';
import type { HealthResponse } from '@nexa/shared';
import { ChatTest } from './ChatTest';
import { KnowledgeOperationsTest } from './KnowledgeOperationsTest';

export function App() {
  const [message, setMessage] = useState('API not checked.');
  const [checking, setChecking] = useState(false);

  async function checkHealth() {
    setChecking(true);
    setMessage('Checking API…');
    try {
      const response = await fetch('/api/health', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('API request failed.');
      const health: HealthResponse = await response.json();
      if (health.status !== 'ok' || health.service !== 'nexa-api') {
        throw new Error('Unexpected API response.');
      }
      setMessage(`${health.service}: ${health.status}`);
    } catch {
      setMessage('API unavailable. Start the API and try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <main>
      <h1>NEXA</h1>
      <p>Technical foundation ready</p>
      <ChatTest />
      {import.meta.env.DEV && <KnowledgeOperationsTest />}
      {import.meta.env.DEV && (
        <section aria-label="Development health check">
          <button onClick={() => void checkHealth()} disabled={checking}>
            Check API health
          </button>
          <p role="status">{message}</p>
        </section>
      )}
    </main>
  );
}
