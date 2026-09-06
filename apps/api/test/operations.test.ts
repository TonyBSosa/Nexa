import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { knowledgeGapStatuses } from '@nexa/shared';
import type { ApprovalResult, ChatResponse, KnowledgeDraft, KnowledgeGapDetail, QuestionAssessment } from '@nexa/shared';
import type { AgentProvider } from '../src/integrations/agent/AgentProvider.js';
import { createApp } from '../src/app.js';
import { assertOperationTransition, DomainError } from '../src/domain/workflow.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import { openDatabase } from '../src/persistence/database.js';
import { PersistenceError, SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { ChatService } from '../src/services/chat.js';
import { KnowledgeOperationsService } from '../src/services/knowledgeOperations.js';

const question = '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?';
const evidenceText = 'Antes de retirar una impresora, Soporte de TI verifica que el equipo ya no esté asignado a un usuario. El número de activo y número de serie se registran. Gestión de Activos actualiza el inventario. Si el equipo contiene almacenamiento interno, TI realiza el borrado correspondiente. Finalmente, Gestión de Activos autoriza la baja y registra el destino del equipo.';

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const provider = new FakeAgentProvider(true);
  const repository = new SQLiteKnowledgeRepository(db);
  const chat = new ChatService(provider, repository);
  const operations = new KnowledgeOperationsService(provider, repository);
  return { db, repository, chat, operations, provider };
}

async function gapFixture(t: TestContext) {
  const result = fixture(t);
  const response = await result.chat.chat({ message: question });
  assert.ok(response.knowledgeGapId);
  return { ...result, gapId: response.knowledgeGapId };
}

function prepareForEvidence(repository: SQLiteKnowledgeRepository, operations: KnowledgeOperationsService, gapId: string) {
  assert.throws(() => operations.transition(gapId, { fromStatus: 'DETECTED', toStatus: 'IN_PROGRESS' }), DomainError);
  const triaged = operations.triage(gapId, { priority: 'HIGH', category: 'TI / Equipos' });
  assert.equal(triaged.status, 'DETECTED');
  operations.transition(gapId, { fromStatus: 'DETECTED', toStatus: 'TRIAGED' });
  const action = triaged.suggestedActions[0]!;
  assert.equal(operations.transition(gapId, {
    fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED', selectedActionId: action.id,
  }).status, 'ACTION_PROPOSED');
  assert.throws(() => operations.transition(gapId, {
    fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: action.id,
  }), DomainError);
  assert.equal(operations.transition(gapId, {
    fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: action.id,
    approveSimulatedAction: true, humanNote: 'Acción simulada aprobada por una persona.',
  }).status, 'IN_PROGRESS');
  assert.ok(repository.getGap(gapId)?.selectedAction?.approvedAt);
}

test('full human-controlled workflow versions evidence and drafts, publishes, resolves, and enables retrieval', async (t) => {
  const { repository, chat, operations, gapId } = await gapFixture(t);
  prepareForEvidence(repository, operations, gapId);
  await assert.rejects(operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 }), DomainError);

  const evidence1 = operations.addEvidence(gapId, { content: evidenceText, origin: 'Respuesta sintética de Soporte de TI' });
  const evidence2 = operations.addEvidence(gapId, { content: 'Gestión de Activos conserva el registro final.', origin: 'Nota manual sintética' });
  assert.equal(evidence1.revision, 1);
  assert.equal(evidence2.revision, 2);
  assert.equal(repository.getGap(gapId)?.status, 'IN_PROGRESS');
  operations.transition(gapId, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });

  const draft1 = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 2 });
  assert.equal(draft1.revision, 1);
  assert.equal(draft1.evidenceRevisionUsed, 2);
  assert.match(draft1.content, /Soporte de TI verifica/);
  assert.equal(repository.getGap(gapId)?.status, 'KNOWLEDGE_COLLECTED');
  operations.transition(gapId, { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' });

  const changes = operations.approval(gapId, { decision: 'CHANGES_REQUESTED', draftRevision: 1, comment: 'Aclarar el cierre.' });
  assert.equal(changes.gapStatus, 'KNOWLEDGE_COLLECTED');
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: 1 }), DomainError);
  operations.addEvidence(gapId, { content: 'El registro final incluye el destino del equipo.', origin: 'Aclaración sintética' });
  assert.equal(repository.getGap(gapId)?.evidenceRevision, 3);

  const draft2 = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 3 });
  assert.equal(draft2.revision, 2);
  assert.equal(repository.getGap(gapId)?.drafts[0]?.evidenceRevisionUsed, 2);
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: 1 }), DomainError);
  operations.transition(gapId, { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' });
  const rejected = operations.approval(gapId, { decision: 'REJECTED', draftRevision: 2, comment: 'Revisar redacción.' });
  assert.equal(rejected.gapStatus, 'KNOWLEDGE_COLLECTED');
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: 2 }), DomainError);

  const draft3 = await operations.draft(gapId, {
    mode: 'SAVE', evidenceRevision: 3, title: draft2.title, content: `${draft2.content}\nRevisión humana aplicada.`,
  });
  assert.equal(draft3.revision, 3);
  operations.transition(gapId, { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' });
  const published = operations.approval(gapId, { decision: 'APPROVED', draftRevision: 3, comment: 'Validado por una persona.' });
  assert.equal(published.gapStatus, 'PUBLISHED');
  assert.ok(published.publication);
  assert.equal(repository.listApprovedKnowledge().length, 1);
  assert.equal(repository.getGap(gapId)?.status, 'PUBLISHED');
  const retry = operations.approval(gapId, { decision: 'APPROVED', draftRevision: 3 });
  assert.equal(retry.publication?.articleId, published.publication.articleId);
  assert.equal(repository.getGap(gapId)?.approvals.length, 3);
  assert.equal(repository.listApprovedKnowledge().length, 1);

  const queryCount = repository.listQueries().length;
  const learned = await chat.chat({ message: question });
  assert.equal(learned.status, 'SUFFICIENT');
  assert.equal(learned.sufficientKnowledge, true);
  assert.equal(learned.evidence[0]?.sourceId, 'nexa-approved');
  assert.equal(learned.knowledgeGapId, undefined);
  assert.equal(repository.listQueries().length, queryCount + 1);
  assert.equal(repository.listGaps().length, 1);

  assert.equal(operations.transition(gapId, { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' }).status, 'RESOLVED');
  assert.equal(repository.getGap(gapId)?.status, 'RESOLVED');
  assert.throws(() => operations.transition(gapId, { fromStatus: 'RESOLVED', toStatus: 'IN_PROGRESS' }), DomainError);
});

test('publication insertion failure rolls back approval and status', async (t) => {
  const { db, repository, operations, gapId } = await gapFixture(t);
  prepareForEvidence(repository, operations, gapId);
  operations.addEvidence(gapId, { content: evidenceText, origin: 'Evidencia sintética' });
  operations.transition(gapId, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
  const draft = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 });
  operations.transition(gapId, { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' });
  db.exec("CREATE TRIGGER fail_publication BEFORE INSERT ON approved_knowledge BEGIN SELECT RAISE(ABORT, 'simulated publication failure'); END;");
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), PersistenceError);
  const detail = repository.getGap(gapId)!;
  assert.equal(detail.status, 'AWAITING_APPROVAL');
  assert.equal(detail.approvals.length, 0);
  assert.equal(detail.publishedArticle, null);
});

test('HTTP operations expose the detailed workflow and approved knowledge', async (t) => {
  const { provider, repository } = fixture(t);
  const server = createApp(provider, repository).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = async (path: string, method: string, body: object) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, body: await response.json() as Record<string, unknown> };
  };
  const chatResult = await request('/chat', 'POST', { message: question });
  const gapId = (chatResult.body as unknown as ChatResponse).knowledgeGapId!;
  const triage = await request(`/knowledge-gaps/${gapId}/triage`, 'PATCH', { priority: 'HIGH' });
  assert.equal(triage.response.status, 200);
  assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'DETECTED', toStatus: 'TRIAGED' })).response.status, 200);
  const detail = await (await fetch(`${base}/knowledge-gaps/${gapId}`)).json() as KnowledgeGapDetail;
  const actionId = detail.suggestedActions[0]!.id;
  assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED', selectedActionId: actionId })).response.status, 200);
  assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: actionId, approveSimulatedAction: true })).response.status, 200);
  assert.equal((await request(`/knowledge-gaps/${gapId}/evidence`, 'POST', { content: evidenceText, origin: 'Evidencia manual sintética' })).response.status, 201);
  assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' })).response.status, 200);
  const draftResult = await request(`/knowledge-gaps/${gapId}/draft`, 'POST', { mode: 'GENERATE', evidenceRevision: 1 });
  assert.equal(draftResult.response.status, 201);
  const draft = draftResult.body as unknown as KnowledgeDraft;
  assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' })).response.status, 200);
  const approvalResult = await request(`/knowledge-gaps/${gapId}/approval`, 'POST', { decision: 'APPROVED', draftRevision: draft.revision });
  assert.equal((approvalResult.body as unknown as ApprovalResult).gapStatus, 'PUBLISHED');
  const knowledge = await (await fetch(`${base}/knowledge`)).json() as { items: unknown[] };
  assert.equal(knowledge.items.length, 1);
  const occurrences = repository.getGap(gapId)!.occurrences;
  for (const resolved of [false, true]) {
    if (resolved) assert.equal((await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' })).response.status, 200);
    const learned = await request('/chat', 'POST', { message: question });
    assert.equal(learned.response.status, 200);
    assert.equal(learned.body.status, 'SUFFICIENT');
    const result = learned.body as unknown as ChatResponse;
    assert.equal(result.answer, draft.content);
    assert.equal(result.evidence[0]?.sourceId, 'nexa-approved');
    assert.ok(result.evidence[0]?.articleId);
    assert.equal(result.evidence[0]?.articleRevision, 1);
    assert.equal(result.knowledgeGapId, undefined);
    assert.equal(repository.listGaps().length, 1);
    assert.equal(repository.getGap(gapId)!.occurrences, occurrences);
  }
  const invalid = await request(`/knowledge-gaps/${gapId}/transition`, 'POST', { fromStatus: 'PUBLISHED', toStatus: 'IN_PROGRESS' });
  assert.equal(invalid.response.status, 409);
});

function deferredResult<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function domainCode(code: DomainError['code']) {
  return (error: unknown) => error instanceof DomainError && error.code === code;
}

async function draftFixture(t: TestContext) {
  const result = await gapFixture(t);
  const { repository, operations, gapId } = result;
  prepareForEvidence(repository, operations, gapId);
  operations.addEvidence(gapId, { content: evidenceText, origin: 'Respuesta sintética' });
  operations.transition(gapId, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
  const draft = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 });
  return { ...result, draft };
}

function submit(operations: KnowledgeOperationsService, gapId: string) {
  return operations.transition(gapId, { fromStatus: 'KNOWLEDGE_COLLECTED', toStatus: 'AWAITING_APPROVAL' });
}

test('explicit transition matrix retains exactly eight states and cannot publish generically', () => {
  const allowed = new Set(['DETECTED:TRIAGED', 'TRIAGED:ACTION_PROPOSED', 'ACTION_PROPOSED:IN_PROGRESS',
    'IN_PROGRESS:KNOWLEDGE_COLLECTED', 'KNOWLEDGE_COLLECTED:AWAITING_APPROVAL', 'PUBLISHED:RESOLVED']);
  assert.equal(knowledgeGapStatuses.length, 8);
  for (const from of knowledgeGapStatuses) for (const to of knowledgeGapStatuses) {
    if (allowed.has(`${from}:${to}`)) assert.doesNotThrow(() => assertOperationTransition(from, to));
    else assert.throws(() => assertOperationTransition(from, to), domainCode('INVALID_TRANSITION'));
  }
});

test('narrow writes preserve state; explicit transitions enforce evidence, fresh draft, and action approval', async (t) => {
  const { repository, operations, gapId } = await gapFixture(t);
  operations.triage(gapId, { priority: 'HIGH' });
  assert.equal(repository.getGap(gapId)!.status, 'DETECTED');
  assert.throws(() => operations.addEvidence(gapId, { content: evidenceText, origin: 'Synthetic' }), domainCode('INVALID_TRANSITION'));
  operations.transition(gapId, { fromStatus: 'DETECTED', toStatus: 'TRIAGED' });
  operations.transition(gapId, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' });
  const action = repository.getGap(gapId)!.suggestedActions[0]!;
  assert.throws(() => operations.transition(gapId, { fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: action.id }), domainCode('APPROVAL_REQUIRED'));
  operations.transition(gapId, { fromStatus: 'ACTION_PROPOSED', toStatus: 'IN_PROGRESS', selectedActionId: action.id, approveSimulatedAction: true });
  const started = repository.getGap(gapId)!;
  assert.deepEqual(started.selectedAction, started.suggestedActions.find((item) => item.id === action.id));
  assert.throws(() => operations.transition(gapId, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' }), domainCode('INVALID_TRANSITION'));
  operations.addEvidence(gapId, { content: evidenceText, origin: 'Synthetic' });
  assert.equal(repository.getGap(gapId)!.status, 'IN_PROGRESS');
  operations.transition(gapId, { fromStatus: 'IN_PROGRESS', toStatus: 'KNOWLEDGE_COLLECTED' });
  assert.throws(() => submit(operations, gapId), domainCode('STALE_STATE'));
  const draft = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 });
  assert.equal(repository.getGap(gapId)!.status, 'KNOWLEDGE_COLLECTED');
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), domainCode('INVALID_TRANSITION'));
  submit(operations, gapId);
  assert.throws(() => operations.addEvidence(gapId, { content: 'New', origin: 'Synthetic' }), domainCode('INVALID_TRANSITION'));
  assert.throws(() => operations.transition(gapId, { fromStatus: 'AWAITING_APPROVAL', toStatus: 'RESOLVED' }), domainCode('INVALID_TRANSITION'));
  assert.equal(repository.listApprovedKnowledge().length, 0);
});

test('valid evidence N to N+1 makes current draft stale for submission and approval', async (t) => {
  const { repository, operations, gapId, draft, db } = await draftFixture(t);
  operations.addEvidence(gapId, { content: 'Nueva aclaración sintética.', origin: 'Synthetic' });
  assert.equal(repository.getGap(gapId)!.evidenceRevision, 2);
  assert.equal(repository.getGap(gapId)!.currentDraft!.evidenceRevisionUsed, 1);
  assert.throws(() => submit(operations, gapId), domainCode('STALE_STATE'));
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), domainCode('STALE_STATE'));
  await assert.rejects(operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 }), domainCode('STALE_STATE'));
  // Defense-in-depth fixture: stale current draft already under review cannot publish either.
  db.prepare("UPDATE knowledge_gaps SET status = 'AWAITING_APPROVAL' WHERE id = ?").run(gapId);
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), domainCode('STALE_STATE'));
  assert.equal(repository.getGap(gapId)!.approvals.length, 0);
  assert.equal(repository.listApprovedKnowledge().length, 0);
});

test('evidence changed during generation rejects the save without allocating a draft revision', async (t) => {
  const { repository, operations, provider, gapId } = await draftFixture(t);
  const pendingResult = deferredResult<Awaited<ReturnType<AgentProvider['generateKnowledgeDraft']>>>();
  const delayed = new KnowledgeOperationsService({ assessQuestion: provider.assessQuestion.bind(provider), generateKnowledgeDraft: () => pendingResult.promise }, repository);
  const pending = delayed.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 });
  const rejected = assert.rejects(pending, domainCode('STALE_STATE'));
  operations.addEvidence(gapId, { content: 'Changed evidence', origin: 'Synthetic' });
  pendingResult.resolve({ status: 'SUCCESS', title: 'Old evidence', content: 'Old evidence content' });
  await rejected;
  assert.equal(repository.getGap(gapId)!.drafts.length, 1);
  const fresh = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 2 });
  assert.equal(fresh.revision, 2);
  assert.equal(fresh.evidenceRevisionUsed, 2);
});

test('negative decisions require newer revisions and older drafts never become approvable', async (t) => {
  const { repository, operations, gapId, draft } = await draftFixture(t);
  let current = draft;
  for (const decision of ['CHANGES_REQUESTED', 'REJECTED'] as const) {
    submit(operations, gapId);
    operations.approval(gapId, { decision, draftRevision: current.revision, comment: 'Revise synthetic draft' });
    assert.throws(() => submit(operations, gapId), domainCode('STALE_STATE'));
    const older = current.revision;
    current = await operations.draft(gapId, { mode: 'SAVE', evidenceRevision: 1, title: current.title, content: `${current.content}\nHuman revision ${older}.` });
    assert.equal(current.revision, older + 1);
    submit(operations, gapId);
    assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: older }), domainCode('STALE_STATE'));
    // Return the current revision to collection for the next review cycle.
    if (decision === 'CHANGES_REQUESTED') {
      operations.approval(gapId, { decision: 'CHANGES_REQUESTED', draftRevision: current.revision, comment: 'Further revision' });
      current = await operations.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 });
    }
  }
  assert.equal(repository.listApprovedKnowledge().length, 0);
});

test('approval replay is identical only for APPROVED, including after resolution', async (t) => {
  const { repository, operations, gapId, draft, db } = await draftFixture(t);
  submit(operations, gapId);
  const approved = operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision });
  for (const status of ['PUBLISHED', 'RESOLVED'] as const) {
    if (status === 'RESOLVED') operations.transition(gapId, { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' });
    const before = repository.getGap(gapId);
    const retry = operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision });
    assert.deepEqual(retry, { ...approved, gapStatus: status });
    for (const decision of ['CHANGES_REQUESTED', 'REJECTED'] as const) {
      assert.throws(() => operations.approval(gapId, { decision, draftRevision: draft.revision, comment: 'Conflicting review' }), domainCode('INVALID_TRANSITION'));
      assert.deepEqual(repository.getGap(gapId), before);
    }
  }
  db.prepare('UPDATE approved_knowledge SET revision = 2 WHERE sourceKnowledgeGapId = ?').run(gapId);
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), domainCode('STALE_STATE'));
});

test('evidence and draft failures roll back inserted rows, versions, and timestamps', async (t) => {
  const { repository, operations, gapId, db } = await draftFixture(t);
  const before = repository.getGap(gapId);
  db.exec("CREATE TRIGGER fail_gap_write BEFORE UPDATE ON knowledge_gaps BEGIN SELECT RAISE(ABORT, 'forced update failure'); END;");
  assert.throws(() => operations.addEvidence(gapId, { content: 'New evidence', origin: 'Synthetic' }), PersistenceError);
  assert.deepEqual(repository.getGap(gapId), before);
  await assert.rejects(operations.draft(gapId, { mode: 'SAVE', evidenceRevision: 1, title: 'New title', content: 'New content' }), PersistenceError);
  assert.deepEqual(repository.getGap(gapId), before);
  db.exec('DROP TRIGGER fail_gap_write');
  const fresh = await operations.draft(gapId, { mode: 'SAVE', evidenceRevision: 1, title: 'New title', content: 'New content' });
  assert.equal(fresh.revision, 2);
  assert.equal(operations.addEvidence(gapId, { content: 'New evidence', origin: 'Synthetic' }).revision, 2);
});

test('failure after article insertion rolls back article, approval, and publication state', async (t) => {
  const { repository, operations, gapId, draft, db } = await draftFixture(t);
  submit(operations, gapId);
  const before = repository.getGap(gapId);
  db.exec("CREATE TRIGGER fail_final_state BEFORE UPDATE OF status ON knowledge_gaps WHEN NEW.status = 'PUBLISHED' BEGIN SELECT RAISE(ABORT, 'forced final state failure'); END;");
  assert.throws(() => operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }), PersistenceError);
  assert.deepEqual(repository.getGap(gapId), before);
  assert.equal(repository.listApprovedKnowledge().length, 0);
  db.exec('DROP TRIGGER fail_final_state');
  assert.equal(operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision }).gapStatus, 'PUBLISHED');
});

test('published knowledge wins over a delayed insufficient provider result before and after resolution', async (t) => {
  for (const resolve of [false, true]) await t.test(resolve ? 'RESOLVED' : 'PUBLISHED', async (t) => {
    const { repository, operations, provider, gapId, draft } = await draftFixture(t);
    submit(operations, gapId);
    const deferred = deferredResult<QuestionAssessment>();
    const delayed = new ChatService({ assessQuestion: () => deferred.promise, generateKnowledgeDraft: provider.generateKnowledgeDraft.bind(provider) }, repository);
    const pending = delayed.chat({ message: question });
    const before = repository.getGap(gapId)!.occurrences;
    const published = operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision });
    if (resolve) operations.transition(gapId, { fromStatus: 'PUBLISHED', toStatus: 'RESOLVED' });
    deferred.resolve(await provider.assessQuestion({ question }));
    const result = await pending;
    assert.equal(result.status, 'SUFFICIENT');
    assert.equal(result.answer, draft.content);
    assert.equal(result.evidence[0]?.articleId, published.publication!.articleId);
    assert.equal(result.knowledgeGapId, undefined);
    assert.equal(result.suggestedActions, undefined);
    assert.equal(repository.listGaps().length, 1);
    assert.equal(repository.getGap(gapId)!.occurrences, before);
    const query = repository.listQueries().find((item) => item.id === result.queryId)!;
    assert.equal(query.assessmentStatus, 'SUFFICIENT');
    assert.equal(query.knowledgeGapId, null);
    assert.equal(query.countedAsKnowledgeGapOccurrence, false);
    assert.deepEqual(query.evidence, result.evidence);
  });
});

test('drafts are excluded, approved context reaches provider, and unresolved gaps do not override publication', async (t) => {
  const { repository, operations, provider, chat, gapId, draft } = await draftFixture(t);
  for (const underReview of [false, true]) {
    if (underReview) submit(operations, gapId);
    const result = await chat.chat({ message: question });
    assert.equal(result.status, 'INSUFFICIENT');
    assert.equal(result.answer.includes(draft.content), false);
    assert.equal(result.evidence.some((item) => item.sourceId === 'nexa-approved'), false);
  }
  operations.approval(gapId, { decision: 'APPROVED', draftRevision: draft.revision });
  const occurrences = repository.getGap(gapId)!.occurrences;
  let received = false;
  const boundary = new ChatService({
    assessQuestion: async (input) => {
      assert.equal(input.approvedKnowledge?.[0]?.content, draft.content);
      assert.equal(input.approvedKnowledge?.[0]?.reference.sourceId, 'nexa-approved');
      received = true;
      // Simulate a provider ignoring the new context; the local canonical decision still wins.
      return provider.assessQuestion({ question: input.question });
    }, generateKnowledgeDraft: provider.generateKnowledgeDraft.bind(provider),
  }, repository);
  const result = await boundary.chat({ message: 'What is the company procedure for decommissioning a printer?' });
  assert.ok(received);
  assert.equal(result.status, 'SUFFICIENT');
  assert.equal(repository.getGap(gapId)!.occurrences, occurrences);
  assert.equal(repository.listGaps().length, 1);
  assert.equal((await chat.chat({ message: 'What is the capital of France?' })).organizationallyRelevant, false);
  const unavailable = new ChatService({
    assessQuestion: async () => { throw new Error('Provider unavailable'); },
    generateKnowledgeDraft: provider.generateKnowledgeDraft.bind(provider),
  }, repository);
  assert.equal((await unavailable.chat({ message: question })).status, 'SUFFICIENT');
  assert.equal(repository.getGap(gapId)!.occurrences, occurrences);
});

test('malformed provider shapes fail cleanly and unusable proposals become a labeled fallback', async (t) => {
  const { repository, operations, provider, gapId } = await draftFixture(t);
  for (const raw of [null, [], {}, { status: 'SUCCESS', title: 4, content: 'text' }, { status: 'SUCCESS', title: ' ', content: 'text' }, { status: 'SUCCESS', title: 'title', content: null }]) {
    const malformed = new KnowledgeOperationsService({ assessQuestion: provider.assessQuestion.bind(provider), generateKnowledgeDraft: async () => raw as Awaited<ReturnType<AgentProvider['generateKnowledgeDraft']>> }, repository);
    await assert.rejects(malformed.draft(gapId, { mode: 'GENERATE', evidenceRevision: 1 }), domainCode('INVALID_PROVIDER_RESPONSE'));
  }
  assert.equal(repository.getGap(gapId)!.drafts.length, 1);
  for (const raw of [null, [], {}, { status: 'SUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true, answer: ' ', evidence: [] }, { status: 'INSUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true, answer: null, evidence: 'bad' }]) {
    const malformed = new ChatService({ assessQuestion: async () => raw as QuestionAssessment, generateKnowledgeDraft: provider.generateKnowledgeDraft.bind(provider) }, repository);
    const before = repository.listQueries().length;
    await assert.rejects(malformed.chat({ message: 'Unsupported question' }), domainCode('INVALID_PROVIDER_RESPONSE'));
    assert.equal(repository.listQueries().length, before);
  }
  const fallback = new ChatService({ assessQuestion: async () => ({
    status: 'INSUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true, answer: null, evidence: [],
    suggestedActions: [{ type: 'INVALID', description: 'Bad type' }, { type: 'REQUEST_INFORMATION', description: ' ' }, null],
  }) as unknown as QuestionAssessment, generateKnowledgeDraft: provider.generateKnowledgeDraft.bind(provider) }, repository);
  const result = await fallback.chat({ message: 'Another synthetic organizational question' });
  const gap = repository.getGap(result.knowledgeGapId!)!;
  assert.equal(gap.suggestedActions.length, 1);
  assert.equal(gap.suggestedActions[0]!.type, 'REQUEST_INFORMATION');
  assert.match(gap.suggestedActions[0]!.description, /determinista de respaldo/);
  operations.transition(gap.id, { fromStatus: 'DETECTED', toStatus: 'TRIAGED' });
  operations.transition(gap.id, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' });
});

test('HTTP malformed provider responses return sanitized 502 without draft or query writes', async (t) => {
  const { repository, gapId } = await draftFixture(t);
  const malformed: AgentProvider = {
    assessQuestion: async () => null as unknown as QuestionAssessment,
    generateKnowledgeDraft: async () => ({ status: 'SUCCESS', title: 42, content: 'private provider detail' }) as unknown as Awaited<ReturnType<AgentProvider['generateKnowledgeDraft']>>,
  };
  const server = createApp(malformed, repository).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const before = repository.getGap(gapId);
  const queries = repository.listQueries();
  for (const [path, body] of [
    ['/chat', { message: 'Another question' }],
    [`/knowledge-gaps/${gapId}/draft`, { mode: 'GENERATE', evidenceRevision: 1 }],
  ] as const) {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 502);
    const result = await response.json() as { error: { code: string; message: string } };
    assert.equal(result.error.code, 'INVALID_PROVIDER_RESPONSE');
    assert.equal(JSON.stringify(result).includes('private provider detail'), false);
  }
  assert.deepEqual(repository.getGap(gapId), before);
  assert.deepEqual(repository.listQueries(), queries);
});
