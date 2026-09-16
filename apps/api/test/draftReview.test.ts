import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { DraftReviewDetail } from '@nexa/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';

const collected = '2026-09-10';

function harness() {
  const db = openDatabase(':memory:');
  const repository = new SQLiteKnowledgeRepository(db);
  const app = createApp(new FakeAgentProvider(), repository);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  return {
    db, repository, base,
    async call(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    },
    close() { server.close(); db.close(); },
  };
}

/** Drives a gap to IN_PROGRESS, where evidence collection is allowed. */
function gapInProgress(db: ReturnType<typeof openDatabase>): string {
  const id = 'gap-draft-review';
  const at = '2026-09-01T00:00:00.000Z';
  db.prepare(`INSERT INTO knowledge_gaps
    (id, originalQuestion, normalizedQuestionKey, title, category, status, priority, occurrences,
     evidenceRevision, suggestedDepartment, suggestedExperts, suggestedActions, selectedAction, createdAt, updatedAt)
    VALUES (?, '¿Cómo se da de baja una impresora?', 'como se da de baja una impresora', 'Baja de impresoras',
     'TI / Equipos', 'IN_PROGRESS', 'MEDIUM', 1, 0, 'TI / Equipos', '[]', '[]', NULL, ?, ?)`).run(id, at, at);
  return id;
}

test('evidence endpoints record types, versions and withdrawal, and invalidate the draft', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);

    const text = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintético)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Se levanta acta y se retira el equipo del inventario.',
    });
    assert.equal(text.status, 201);
    const afterText = text.body as unknown as DraftReviewDetail;
    assert.equal(afterText.evidence.length, 1);
    assert.equal(afterText.evidence[0]!.type, 'MANUAL_TEXT');
    assert.equal(afterText.evidence[0]!.version, 1);
    assert.equal(afterText.evidence[0]!.author, 'Ana Documentación');

    const link = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'LINK', source: 'Intranet (sintética)', author: 'José Andrés Mejía',
      evidenceDate: collected, url: 'https://intranet.vallenorte.example/activos',
    });
    assert.equal(link.status, 201);

    // A file type rejects a mismatched extension.
    const badFile = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'PDF', source: 'Gestión de Activos', author: 'Ana Documentación', evidenceDate: collected,
      file: { fileName: 'acta.docx', mimeType: 'application/pdf', sizeBytes: 1024 },
    });
    assert.equal(badFile.status, 400);

    // Withdrawal needs a justification of at least ten characters.
    const evidenceId = afterText.evidence[0]!.id;
    const shortJustification = await context.call(`/knowledge-gaps/${id}/evidence/${evidenceId}/withdraw`, 'POST', {
      actor: 'Carmen Rivas', justification: 'corto',
    });
    assert.equal(shortJustification.status, 400);

    const revisionBefore = context.repository.getGap(id)!.evidenceRevision;
    const withdrawn = await context.call(`/knowledge-gaps/${id}/evidence/${evidenceId}/withdraw`, 'POST', {
      actor: 'Carmen Rivas', justification: 'El procedimiento cambió y el acta ya no aplica.',
    });
    assert.equal(withdrawn.status, 200);
    const detail = withdrawn.body as unknown as DraftReviewDetail;
    assert.equal(detail.evidence[0]!.withdrawal?.actor, 'Carmen Rivas');
    // Withdrawal advances the evidence revision so an existing draft becomes stale.
    assert.equal(context.repository.getGap(id)!.evidenceRevision, revisionBefore + 1);

    // A withdrawn item cannot be withdrawn twice.
    const twice = await context.call(`/knowledge-gaps/${id}/evidence/${evidenceId}/withdraw`, 'POST', {
      actor: 'Carmen Rivas', justification: 'Intento repetido de retiro del acta.',
    });
    assert.equal(twice.status, 409);
  } finally {
    context.close();
  }
});

test('the checklist reports what is missing and only completes with evidence, draft and confirmations', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    const empty = await context.call(`/knowledge-gaps/${id}/draft-review`);
    assert.equal(empty.status, 200);
    const initial = empty.body as unknown as DraftReviewDetail;
    assert.equal(initial.checklist.complete, false);
    assert.equal(initial.checklist.items[0]!.key, 'HAS_EVIDENCE');
    assert.equal(initial.checklist.items[0]!.satisfied, false);

    await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintético)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Se levanta acta y se retira el equipo del inventario.',
    });

    const withEvidence = await context.call(`/knowledge-gaps/${id}/draft-review`);
    const afterEvidence = withEvidence.body as unknown as DraftReviewDetail;
    assert.equal(afterEvidence.checklist.items[0]!.satisfied, true);
    // Without a draft the source check still fails.
    assert.equal(afterEvidence.checklist.items[1]!.satisfied, false);

    // Confirmations use optimistic concurrency.
    const stale = await context.call(`/knowledge-gaps/${id}/draft-review/checklist`, 'POST', {
      revision: 7, confirmations: { answerClear: true, noImproperConfidentialInfo: true, readyForReview: true },
    });
    assert.equal(stale.status, 409);

    const confirmed = await context.call(`/knowledge-gaps/${id}/draft-review/checklist`, 'POST', {
      revision: 0, confirmations: { answerClear: true, noImproperConfidentialInfo: true, readyForReview: true },
    });
    assert.equal(confirmed.status, 200);
    assert.equal((confirmed.body as unknown as DraftReviewDetail).state.revision, 1);
  } finally {
    context.close();
  }
});

test('reviewer assignment and comments require a draft and reject the author', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintético)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Primera línea del acta.\nSegunda línea del acta.',
    });

    // No draft yet.
    const noDraft = await context.call(`/knowledge-gaps/${id}/draft-review/reviewers`, 'POST', {
      revision: 0, submittedBy: 'Ana Documentación', reviewers: ['Carmen Rivas'],
    });
    assert.equal(noDraft.status, 409);

    const gap = context.repository.getGap(id)!;
    context.repository.transition(id, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
    context.repository.saveDraft(id, gap.evidenceRevision, 'Baja de impresoras', 'Primera línea.\nSegunda línea.');

    const author = await context.call(`/knowledge-gaps/${id}/draft-review/reviewers`, 'POST', {
      revision: 0, submittedBy: 'Ana Documentación', reviewers: ['ana  documentación'],
    });
    assert.equal(author.status, 400, 'el autor no puede revisarse a sí mismo');

    const assigned = await context.call(`/knowledge-gaps/${id}/draft-review/reviewers`, 'POST', {
      revision: 0, submittedBy: 'Ana Documentación', reviewers: ['Carmen Rivas', 'José Andrés Mejía'],
    });
    assert.equal(assigned.status, 200);
    const state = (assigned.body as unknown as DraftReviewDetail).state;
    assert.deepEqual(state.assignedReviewers, ['Carmen Rivas', 'José Andrés Mejía']);
    assert.equal(state.revisionUnderReview, 1);

    const anchored = await context.call(`/knowledge-gaps/${id}/draft-review/comments`, 'POST', {
      actor: 'Carmen Rivas', draftRevision: 1, startLine: 1, endLine: 1, quote: 'Primera', body: 'Aclarar el plazo.',
    });
    assert.equal(anchored.status, 201);
    assert.equal((anchored.body as unknown as DraftReviewDetail).comments.length, 1);

    const outOfRange = await context.call(`/knowledge-gaps/${id}/draft-review/comments`, 'POST', {
      actor: 'Carmen Rivas', draftRevision: 1, startLine: 9, endLine: 9, body: 'Fuera de rango.',
    });
    assert.equal(outOfRange.status, 400);
  } finally {
    context.close();
  }
});
