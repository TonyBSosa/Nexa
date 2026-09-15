import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertRevisionUnderReview, normalizeActor, sameActor, validateContentComment,
  validateReviewDecision, validateReviewerAssignment,
} from '../src/domain/reviewRules.js';
import type { ReviewDecisionContext } from '../src/domain/reviewRules.js';
import { DomainError } from '../src/domain/workflow.js';

function code(expected: DomainError['code']) {
  return (error: unknown) => error instanceof DomainError && error.code === expected;
}

function context(overrides: Partial<ReviewDecisionContext> = {}): ReviewDecisionContext {
  return {
    revisionUnderReview: 2,
    submittedBy: 'Ana Documentación',
    draftAuthors: ['Ana Documentación', 'Luis Redactor'],
    assignedReviewers: ['Marta Revisora', 'Pedro Revisor'],
    revisionAlreadyDecided: false,
    ...overrides,
  };
}

const content = 'Paso 1: verificar asignación.\nPaso 2: registrar activo.\nPaso 3: autorizar baja.';

test('actors are trimmed, collapsed, and compared without case or accent form differences', () => {
  assert.equal(normalizeActor('  Marta   Revisora '), 'Marta Revisora');
  assert.ok(sameActor('MARTA revisora', ' marta  Revisora'));
  assert.ok(sameActor('José', 'José'));
  assert.equal(sameActor('Marta Revisora', 'Pedro Revisor'), false);
  assert.throws(() => normalizeActor('   '), code('INVALID_REQUEST'));
  assert.throws(() => normalizeActor(42), code('INVALID_REQUEST'));
  assert.throws(() => normalizeActor('x'.repeat(121)), code('INVALID_REQUEST'));
});

test('reviewer assignment requires distinct reviewers who are not authors', () => {
  assert.deepEqual(validateReviewerAssignment('Ana Documentación', ['Luis Redactor'], [' Marta Revisora ', 'Pedro Revisor']), ['Marta Revisora', 'Pedro Revisor']);
  assert.throws(() => validateReviewerAssignment('Ana', [], []), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewerAssignment('Ana', [], 'Marta'), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewerAssignment('Ana', [], ['ana']), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewerAssignment('Ana', ['Luis Redactor'], ['LUIS REDACTOR']), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewerAssignment('Ana', [], ['Marta', 'marta']), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewerAssignment('Ana', [], Array.from({ length: 11 }, (_, index) => `Revisor ${index}`)), code('INVALID_REQUEST'));
});

test('only the locked revision under review can be addressed', () => {
  assert.doesNotThrow(() => assertRevisionUnderReview(3, 3));
  assert.throws(() => assertRevisionUnderReview(3, 2), code('STALE_STATE'));
  assert.throws(() => assertRevisionUnderReview(null, 1), code('INVALID_TRANSITION'));
});

test('an assigned reviewer can approve with an optional comment', () => {
  assert.deepEqual(validateReviewDecision(context(), { actor: 'marta revisora', decision: 'APPROVED', draftRevision: 2 }), {
    actor: 'marta revisora', decision: 'APPROVED', draftRevision: 2, comment: null,
  });
  assert.equal(validateReviewDecision(context(), {
    actor: 'Pedro Revisor', decision: 'APPROVED', draftRevision: 2, comment: ' Correcto. ',
  }).comment, 'Correcto.');
});

test('changes requested and rejection require a comment', () => {
  for (const decision of ['CHANGES_REQUESTED', 'REJECTED']) {
    assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision, draftRevision: 2 }), code('INVALID_REQUEST'));
    assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision, draftRevision: 2, comment: '  ' }), code('INVALID_REQUEST'));
    assert.equal(validateReviewDecision(context(), {
      actor: 'Marta Revisora', decision, draftRevision: 2, comment: 'Aclarar el paso 3.',
    }).comment, 'Aclarar el paso 3.');
  }
});

test('authors and unassigned actors cannot decide', () => {
  assert.throws(() => validateReviewDecision(context({ assignedReviewers: ['Ana Documentación'] }), {
    actor: 'ANA documentación', decision: 'APPROVED', draftRevision: 2,
  }), code('APPROVAL_REQUIRED'));
  assert.throws(() => validateReviewDecision(context({ assignedReviewers: ['Luis Redactor'] }), {
    actor: 'Luis Redactor', decision: 'REJECTED', draftRevision: 2, comment: 'No.',
  }), code('APPROVAL_REQUIRED'));
  assert.throws(() => validateReviewDecision(context(), {
    actor: 'Invitado', decision: 'APPROVED', draftRevision: 2,
  }), code('APPROVAL_REQUIRED'));
});

test('decisions reject stale, already decided, or malformed requests', () => {
  assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision: 'APPROVED', draftRevision: 1 }), code('STALE_STATE'));
  assert.throws(() => validateReviewDecision(context({ revisionAlreadyDecided: true }), {
    actor: 'Marta Revisora', decision: 'APPROVED', draftRevision: 2,
  }), code('STALE_STATE'));
  assert.throws(() => validateReviewDecision(context({ revisionUnderReview: null }), {
    actor: 'Marta Revisora', decision: 'APPROVED', draftRevision: 2,
  }), code('INVALID_TRANSITION'));
  assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision: 'MAYBE', draftRevision: 2 }), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision: 'APPROVED', draftRevision: 0 }), code('INVALID_REQUEST'));
  assert.throws(() => validateReviewDecision(context(), { actor: 'Marta Revisora', decision: 'APPROVED', draftRevision: 2, extra: true }), code('INVALID_REQUEST'));
});

test('general content comments need no anchor', () => {
  assert.deepEqual(validateContentComment({ revisionUnderReview: 2, draftContent: content }, {
    actor: 'Marta Revisora', draftRevision: 2, body: ' Revisar el tono. ',
  }), { actor: 'Marta Revisora', draftRevision: 2, startLine: null, endLine: null, quote: null, body: 'Revisar el tono.' });
});

test('anchored content comments must point to existing lines of the locked revision', () => {
  const locked = { revisionUnderReview: 2, draftContent: content };
  assert.deepEqual(validateContentComment(locked, {
    actor: 'Pedro Revisor', draftRevision: 2, startLine: 2, endLine: 3, quote: 'registrar activo.\nPaso 3', body: 'Unificar pasos.',
  }), { actor: 'Pedro Revisor', draftRevision: 2, startLine: 2, endLine: 3, quote: 'registrar activo.\nPaso 3', body: 'Unificar pasos.' });
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, startLine: 3, endLine: 2, body: 'x' }), code('INVALID_REQUEST'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, startLine: 1, endLine: 4, body: 'x' }), code('INVALID_REQUEST'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, startLine: 1, body: 'x' }), code('INVALID_REQUEST'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, quote: 'Paso 1', body: 'x' }), code('INVALID_REQUEST'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, startLine: 1, endLine: 1, quote: 'Paso 2', body: 'x' }), code('STALE_STATE'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 1, startLine: 1, endLine: 1, body: 'x' }), code('STALE_STATE'));
  assert.throws(() => validateContentComment(locked, { actor: 'Pedro', draftRevision: 2, body: ' ' }), code('INVALID_REQUEST'));
});
