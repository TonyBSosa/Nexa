import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DraftReviewDetail } from '@nexa/shared';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/persistence/database.js';
import { EvidenceFileStore } from '../src/persistence/fileStore.js';
import { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';

const collected = '2026-09-10';

function harness() {
  const db = openDatabase(':memory:');
  // A temporary uploads root keeps the tests away from the repository data directory.
  const uploads = mkdtempSync(join(tmpdir(), 'nexa-uploads-'));
  const repository = new SQLiteKnowledgeRepository(db, () => new Date(), new EvidenceFileStore(uploads));
  const app = createApp(new FakeAgentProvider(), repository);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  const origin = `http://127.0.0.1:${port}`;
  return {
    db, repository, base, uploads, origin,
    async call(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    },
    close() { server.close(); db.close(); rmSync(uploads, { recursive: true, force: true }); },
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

test('the checklist gates submission only for gaps whose draft review was started', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintético)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Se levanta acta y se retira el equipo del inventario.',
    });
    const gap = context.repository.getGap(id)!;
    context.repository.transition(id, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
    context.repository.saveDraft(id, gap.evidenceRevision, 'Baja de impresoras', 'Contenido del borrador.');

    // Touching the panel starts the draft review, which turns the checklist into a gate.
    await context.call(`/knowledge-gaps/${id}/draft-review/checklist`, 'POST', {
      revision: 0, confirmations: { answerClear: false, noImproperConfidentialInfo: false, readyForReview: false },
    });
    const blocked = await context.call(`/knowledge-gaps/${id}/transition`, 'POST', {
      fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL',
    });
    assert.equal(blocked.status, 409);
    assert.match(String((blocked.body.error as { message: string }).message), /Lista de verificación incompleta/);

    const confirmed = await context.call(`/knowledge-gaps/${id}/draft-review/checklist`, 'POST', {
      revision: 1, confirmations: { answerClear: true, noImproperConfidentialInfo: true, readyForReview: true },
    });
    assert.equal(confirmed.status, 200);
    assert.equal((confirmed.body as unknown as DraftReviewDetail).checklist.complete, true);
    const allowed = await context.call(`/knowledge-gaps/${id}/transition`, 'POST', {
      fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL',
    });
    assert.equal(allowed.status, 200);
  } finally {
    context.close();
  }
});

test('assigned reviewers decide with attribution and a gap without them keeps the previous flow', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintético)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Se levanta acta y se retira el equipo del inventario.',
    });
    const gap = context.repository.getGap(id)!;
    context.repository.transition(id, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
    context.repository.saveDraft(id, gap.evidenceRevision, 'Baja de impresoras', 'Contenido del borrador.');
    await context.call(`/knowledge-gaps/${id}/draft-review/reviewers`, 'POST', {
      revision: 0, submittedBy: 'Ana Documentación', reviewers: ['Carmen Rivas'],
    });
    await context.call(`/knowledge-gaps/${id}/draft-review/checklist`, 'POST', {
      revision: 1, confirmations: { answerClear: true, noImproperConfidentialInfo: true, readyForReview: true },
    });
    await context.call(`/knowledge-gaps/${id}/transition`, 'POST', {
      fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL',
    });

    const author = await context.call(`/knowledge-gaps/${id}/approval`, 'POST', {
      decision: 'APPROVED', draftRevision: 1, actor: 'Ana Documentación',
    });
    assert.equal(author.status, 409, 'el autor no decide sobre su propio borrador');

    const stranger = await context.call(`/knowledge-gaps/${id}/approval`, 'POST', {
      decision: 'APPROVED', draftRevision: 1, actor: 'Luis Peña',
    });
    assert.equal(stranger.status, 409, 'solo un revisor asignado decide');

    const approved = await context.call(`/knowledge-gaps/${id}/approval`, 'POST', {
      decision: 'APPROVED', draftRevision: 1, actor: 'carmen  rivas', comment: 'Queda claro.',
    });
    assert.equal(approved.status, 200);

    const detail = await context.call(`/knowledge-gaps/${id}/draft-review`);
    const history = (detail.body as unknown as DraftReviewDetail).history;
    assert.equal(history.length, 1);
    assert.equal(history[0]!.actor, 'carmen rivas');
    assert.equal(history[0]!.decision, 'APPROVED');
  } finally {
    context.close();
  }
});

const pdfBytes = Buffer.from('%PDF-1.4\nacta de baja sintetica\n%%EOF\n', 'utf8');

function pdfUpload(fileName = 'acta-baja.pdf') {
  return { fileName, mimeType: 'application/pdf', sizeBytes: pdfBytes.byteLength, content: pdfBytes.toString('base64') };
}

async function addPdf(context: ReturnType<typeof harness>, id: string, fileName?: string) {
  const created = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
    type: 'PDF', source: 'Gestion de Activos (sintetica)', author: 'Ana Documentación',
    evidenceDate: collected, file: pdfUpload(fileName),
  });
  assert.equal(created.status, 201);
  return (created.body as unknown as DraftReviewDetail).evidence.at(-1)!;
}

test('file evidence stores its bytes and serves them for viewing and downloading', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    const item = await addPdf(context, id);
    assert.equal(item.file?.fileName, 'acta-baja.pdf');
    assert.equal(item.file?.sizeBytes, pdfBytes.byteLength);
    // The bytes landed under the gap directory, named by the evidence id.
    assert.deepEqual(readFileSync(join(context.uploads, id, item.id)), pdfBytes);

    const view = await fetch(context.origin + item.file!.viewUrl);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
    assert.match(view.headers.get('content-disposition') ?? '', /^inline; filename/);
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), pdfBytes);

    const download = await fetch(context.origin + item.file!.downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment; /);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdfBytes);
  } finally {
    context.close();
  }
});

test('file content is validated and a rejected upload leaves no orphan file', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    const base = {
      type: 'PDF', source: 'Gestion de Activos', author: 'Ana Documentación', evidenceDate: collected,
    };

    // sizeBytes must match the decoded length exactly.
    const mismatched = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      ...base, file: { ...pdfUpload(), sizeBytes: pdfBytes.byteLength + 10 },
    });
    assert.equal(mismatched.status, 400);

    // Node's base64 decoder skips invalid characters, so they are rejected first.
    const notBase64 = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      ...base, file: { ...pdfUpload(), content: 'no-es-base64-valido!!' },
    });
    assert.equal(notBase64.status, 400);

    const missingContent = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      ...base, file: { fileName: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: pdfBytes.byteLength },
    });
    assert.equal(missingContent.status, 400);

    assert.equal(existsSync(join(context.uploads, id)), false, 'ninguna solicitud rechazada deja archivos');
  } finally {
    context.close();
  }
});

test('replacing file evidence stores the new bytes and keeps the superseded version', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    const original = await addPdf(context, id, 'acta-v1.pdf');

    const corregido = Buffer.from('%PDF-1.4\nacta corregida con anexo de firmas\n%%EOF\n', 'utf8');
    const replaced = await context.call(`/knowledge-gaps/${id}/evidence/${original.id}/replace`, 'POST', {
      actor: 'Carmen Rivas', reason: 'Se corrigio el anexo de firmas.',
      file: {
        fileName: 'acta-v2.pdf', mimeType: 'application/pdf',
        sizeBytes: corregido.byteLength, content: corregido.toString('base64'),
      },
    });
    assert.equal(replaced.status, 200);
    const items = (replaced.body as unknown as DraftReviewDetail).evidence;
    const anterior = items.find(entry => entry.id === original.id)!;
    const vigente = items.find(entry => entry.version === 2)!;
    assert.equal(anterior.supersededBy, vigente.id);
    assert.equal(vigente.file?.fileName, 'acta-v2.pdf');

    // Both versions keep their own bytes, so the history stays readable.
    assert.deepEqual(readFileSync(join(context.uploads, id, original.id)), pdfBytes);
    assert.deepEqual(readFileSync(join(context.uploads, id, vigente.id)), corregido);
    const antiguo = await fetch(context.origin + anterior.file!.viewUrl);
    assert.deepEqual(Buffer.from(await antiguo.arrayBuffer()), pdfBytes);

    // Only file evidence can be replaced.
    const texto = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Nota de texto.',
    });
    const notaId = (texto.body as unknown as DraftReviewDetail).evidence.at(-1)!.id;
    const rechazado = await context.call(`/knowledge-gaps/${id}/evidence/${notaId}/replace`, 'POST', {
      actor: 'Carmen Rivas', reason: 'Intento sobre evidencia de texto.',
      file: { fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: pdfBytes.byteLength, content: pdfBytes.toString('base64') },
    });
    assert.equal(rechazado.status, 409);
  } finally {
    context.close();
  }
});

test('evidence without a file and unknown identifiers cannot be served', async () => {
  const context = harness();
  try {
    const id = gapInProgress(context.db);
    const created = await context.call(`/knowledge-gaps/${id}/evidence-items`, 'POST', {
      type: 'MANUAL_TEXT', source: 'Soporte de TI (sintetico)', author: 'Ana Documentación',
      evidenceDate: collected, content: 'Evidencia de texto sin archivo.',
    });
    const item = (created.body as unknown as DraftReviewDetail).evidence[0]!;
    assert.equal(item.file, null);

    const sinArchivo = await fetch(`${context.base}/knowledge-gaps/${id}/evidence/${item.id}/file`);
    assert.equal(sinArchivo.status, 404);

    const desconocida = await fetch(`${context.base}/knowledge-gaps/${id}/evidence/no-existe/file`);
    assert.equal(desconocida.status, 404);

    // A traversal attempt never reaches the file system.
    const traversal = await fetch(`${context.base}/knowledge-gaps/${id}/evidence/${encodeURIComponent('../../nexa.db')}/file`);
    assert.ok(traversal.status === 400 || traversal.status === 404, `estado inesperado ${traversal.status}`);
  } finally {
    context.close();
  }
});
