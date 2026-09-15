import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffDraftRevisions, diffLines } from '../src/domain/revisionDiff.js';
import type { DiffLine } from '../src/domain/revisionDiff.js';

function compact(lines: DiffLine[]): string[] {
  const symbol = { EQUAL: ' ', ADDED: '+', REMOVED: '-' } as const;
  return lines.map((line) => `${symbol[line.type]}${line.text}`);
}

test('identical content produces only equal lines', () => {
  const result = diffLines('Paso 1\nPaso 2', 'Paso 1\nPaso 2');
  assert.deepEqual(compact(result.lines), [' Paso 1', ' Paso 2']);
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
});

test('empty content on either side is a full addition or removal', () => {
  assert.deepEqual(diffLines('', ''), { lines: [], added: 0, removed: 0 });
  const created = diffLines('', 'A\nB');
  assert.deepEqual(compact(created.lines), ['+A', '+B']);
  assert.equal(created.added, 2);
  const cleared = diffLines('A\nB', '');
  assert.deepEqual(compact(cleared.lines), ['-A', '-B']);
  assert.equal(cleared.removed, 2);
});

test('insertion and deletion keep surrounding lines equal', () => {
  assert.deepEqual(compact(diffLines('A\nC', 'A\nB\nC').lines), [' A', '+B', ' C']);
  assert.deepEqual(compact(diffLines('A\nB\nC', 'A\nC').lines), [' A', '-B', ' C']);
});

test('modified lines list removals before additions', () => {
  const result = diffLines('A\nviejo 1\nviejo 2\nZ', 'A\nnuevo 1\nnuevo 2\nZ');
  assert.deepEqual(compact(result.lines), [' A', '-viejo 1', '-viejo 2', '+nuevo 1', '+nuevo 2', ' Z']);
  assert.equal(result.added, 2);
  assert.equal(result.removed, 2);
});

test('line endings and a trailing newline do not create differences', () => {
  assert.deepEqual(compact(diffLines('A\r\nB\r\n', 'A\nB').lines), [' A', ' B']);
  assert.deepEqual(compact(diffLines('A\rB', 'A\nB').lines), [' A', ' B']);
});

test('line numbers refer to each revision', () => {
  const result = diffLines('A\nB\nC\nD', 'A\nX\nC\nD\nE');
  assert.deepEqual(result.lines, [
    { type: 'EQUAL', text: 'A', beforeLine: 1, afterLine: 1 },
    { type: 'REMOVED', text: 'B', beforeLine: 2, afterLine: null },
    { type: 'ADDED', text: 'X', beforeLine: null, afterLine: 2 },
    { type: 'EQUAL', text: 'C', beforeLine: 3, afterLine: 3 },
    { type: 'EQUAL', text: 'D', beforeLine: 4, afterLine: 4 },
    { type: 'ADDED', text: 'E', beforeLine: null, afterLine: 5 },
  ]);
});

test('repeated lines produce a deterministic minimal diff', () => {
  const first = diffLines('x\ny\nx\ny', 'y\nx\ny\nx');
  const second = diffLines('x\ny\nx\ny', 'y\nx\ny\nx');
  assert.deepEqual(first, second);
  assert.equal(first.lines.filter((line) => line.type === 'EQUAL').length, 3);
  assert.equal(first.added, 1);
  assert.equal(first.removed, 1);
});

test('oversized comparisons fall back to a complete replacement', () => {
  const before = Array.from({ length: 2_100 }, (_, index) => `antes ${index}`).join('\n');
  const after = Array.from({ length: 2_100 }, (_, index) => `después ${index}`).join('\n');
  const result = diffLines(`inicio\n${before}\nfin`, `inicio\n${after}\nfin`);
  assert.equal(result.removed, 2_100);
  assert.equal(result.added, 2_100);
  assert.deepEqual(result.lines[0], { type: 'EQUAL', text: 'inicio', beforeLine: 1, afterLine: 1 });
  assert.deepEqual(result.lines.at(-1), { type: 'EQUAL', text: 'fin', beforeLine: 2_102, afterLine: 2_102 });
});

test('draft revision diff reports revisions, title change, and content diff', () => {
  const changed = diffDraftRevisions(
    { revision: 1, title: 'Procedimiento: baja de impresora', content: '1. Verificar asignación.' },
    { revision: 2, title: 'Procedimiento: baja de impresoras', content: '1. Verificar asignación.\n2. Actualizar inventario.' },
  );
  assert.equal(changed.fromRevision, 1);
  assert.equal(changed.toRevision, 2);
  assert.equal(changed.titleChanged, true);
  assert.deepEqual(changed.title, { before: 'Procedimiento: baja de impresora', after: 'Procedimiento: baja de impresoras' });
  assert.deepEqual(compact(changed.content.lines), [' 1. Verificar asignación.', '+2. Actualizar inventario.']);

  const sameTitle = diffDraftRevisions(
    { revision: 2, title: 'Título', content: 'A' },
    { revision: 3, title: 'Título', content: 'B' },
  );
  assert.equal(sameTitle.titleChanged, false);
  assert.deepEqual(compact(sameTitle.content.lines), ['-A', '+B']);
});
