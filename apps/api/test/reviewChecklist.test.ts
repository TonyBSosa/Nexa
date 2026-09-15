import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReviewChecklistComplete, evaluateReviewChecklist, reviewChecklistKeys } from '../src/domain/reviewChecklist.js';
import type { ReviewChecklistInput } from '../src/domain/reviewChecklist.js';
import { DomainError } from '../src/domain/workflow.js';

function complete(): ReviewChecklistInput {
  return {
    evidence: [
      { id: 'e1', source: 'Soporte de TI (sintético)', withdrawn: false },
      { id: 'e2', source: 'Gestión de Activos (sintético)', withdrawn: false },
    ],
    draft: { title: 'Procedimiento: baja de impresoras', content: '1. Verificar asignación.', citedEvidenceIds: ['e1', 'e2'] },
    confirmations: { answerClear: true, noImproperConfidentialInfo: true, readyForReview: true },
  };
}

function reasons(input: ReviewChecklistInput) {
  return Object.fromEntries(evaluateReviewChecklist(input).items.map((entry) => [entry.key, entry.reason]));
}

test('a fully satisfied checklist is complete and keeps the documented order', () => {
  const result = evaluateReviewChecklist(complete());
  assert.equal(result.complete, true);
  assert.deepEqual(result.items.map((entry) => entry.key), [...reviewChecklistKeys]);
  assert.ok(result.items.every((entry) => entry.satisfied && entry.reason === null));
  assert.deepEqual(result.items.map((entry) => entry.kind), ['AUTOMATIC', 'AUTOMATIC', 'CONFIRMATION', 'CONFIRMATION', 'CONFIRMATION']);
  assert.doesNotThrow(() => assertReviewChecklistComplete(result));
});

test('withdrawn evidence does not count as evidence', () => {
  const input = complete();
  input.evidence = input.evidence.map((entry) => ({ ...entry, withdrawn: true }));
  const result = reasons(input);
  assert.equal(result.HAS_EVIDENCE, 'No hay evidencia vigente.');
  assert.equal(result.SOURCES_IDENTIFIED, 'No hay evidencia vigente con fuente.');
  assert.equal(result.READY_FOR_REVIEW, 'Complete los demás puntos de la lista.');
});

test('active evidence without a source fails source identification', () => {
  const input = complete();
  input.evidence[1] = { id: 'e2', source: '  ', withdrawn: false };
  assert.equal(reasons(input).SOURCES_IDENTIFIED, 'Hay evidencia vigente sin fuente identificada.');
  input.evidence[1] = { id: 'e2', source: null, withdrawn: false };
  assert.equal(reasons(input).SOURCES_IDENTIFIED, 'Hay evidencia vigente sin fuente identificada.');
});

test('withdrawn evidence without a source is ignored', () => {
  const input = complete();
  input.evidence.push({ id: 'e3', source: null, withdrawn: true });
  assert.equal(evaluateReviewChecklist(input).complete, true);
});

test('the draft must cite only active evidence of the gap', () => {
  const input = complete();
  input.draft = { ...input.draft!, citedEvidenceIds: [] };
  assert.equal(reasons(input).SOURCES_IDENTIFIED, 'El borrador no cita ninguna evidencia.');
  input.draft = { ...input.draft, citedEvidenceIds: ['e1', 'desconocida'] };
  assert.equal(reasons(input).SOURCES_IDENTIFIED, 'El borrador cita evidencia retirada o inexistente.');
  const withdrawn = complete();
  withdrawn.evidence[1] = { id: 'e2', source: 'Gestión de Activos (sintético)', withdrawn: true };
  assert.equal(reasons(withdrawn).SOURCES_IDENTIFIED, 'El borrador cita evidencia retirada o inexistente.');
});

test('a missing or empty draft cannot be confirmed as clear', () => {
  const missing = complete();
  missing.draft = null;
  assert.equal(reasons(missing).SOURCES_IDENTIFIED, 'El borrador no existe todavía.');
  assert.equal(reasons(missing).ANSWER_CLEAR, 'El borrador necesita título y contenido.');
  const empty = complete();
  empty.draft = { ...empty.draft!, content: ' ' };
  assert.equal(reasons(empty).ANSWER_CLEAR, 'El borrador necesita título y contenido.');
});

test('human confirmations are required individually', () => {
  const input = complete();
  input.confirmations = { answerClear: false, noImproperConfidentialInfo: false, readyForReview: true };
  const result = reasons(input);
  assert.equal(result.ANSWER_CLEAR, 'Falta confirmar que la respuesta es clara.');
  assert.equal(result.NO_IMPROPER_CONFIDENTIAL_INFO, 'Falta confirmar que no hay información confidencial improcedente.');
  assert.equal(result.READY_FOR_REVIEW, 'Complete los demás puntos de la lista.');
  const notReady = complete();
  notReady.confirmations.readyForReview = false;
  assert.equal(reasons(notReady).READY_FOR_REVIEW, 'Falta confirmar que está lista para revisión.');
});

test('an incomplete checklist blocks submission with the pending labels', () => {
  const input = complete();
  input.confirmations.noImproperConfidentialInfo = false;
  const result = evaluateReviewChecklist(input);
  assert.equal(result.complete, false);
  assert.throws(() => assertReviewChecklistComplete(result), (error: unknown) => error instanceof DomainError
    && error.code === 'INVALID_TRANSITION'
    && error.message.includes('No contiene información confidencial improcedente')
    && error.message.includes('Está lista para revisión'));
});
