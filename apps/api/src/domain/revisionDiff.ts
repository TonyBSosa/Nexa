import type { KnowledgeDraft } from '@nexa/shared';

export type DiffLineType = 'EQUAL' | 'ADDED' | 'REMOVED';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

export type DraftRevisionSnapshot = Pick<KnowledgeDraft, 'revision' | 'title' | 'content'>;

export interface DraftRevisionDiff {
  fromRevision: number;
  toRevision: number;
  titleChanged: boolean;
  title: { before: string; after: string };
  content: LineDiff;
}

// Bounds the LCS table (about 16 MB) so oversized inputs degrade to a full replacement.
const maxComparisonCells = 4_000_000;

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function diffLines(before: string, after: string): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  const lines: DiffLine[] = [];
  const equal = (i: number, j: number) => lines.push({ type: 'EQUAL', text: a[i] ?? '', beforeLine: i + 1, afterLine: j + 1 });
  const removed = (i: number) => lines.push({ type: 'REMOVED', text: a[i] ?? '', beforeLine: i + 1, afterLine: null });
  const added = (j: number) => lines.push({ type: 'ADDED', text: b[j] ?? '', beforeLine: null, afterLine: j + 1 });

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  for (let i = 0; i < start; i += 1) equal(i, i);
  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > maxComparisonCells) {
    for (let i = start; i < endA; i += 1) removed(i);
    for (let j = start; j < endB; j += 1) added(j);
  } else {
    // table[i * width + j] holds the LCS length of a[start + i..endA) and b[start + j..endB).
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = a[start + i] === b[start + j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        equal(start + i, start + j);
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
        removed(start + i);
        i += 1;
      } else {
        added(start + j);
        j += 1;
      }
    }
    for (; i < n; i += 1) removed(start + i);
    for (; j < m; j += 1) added(start + j);
  }
  for (let offset = 0; offset < a.length - endA; offset += 1) equal(endA + offset, endB + offset);

  return {
    lines,
    added: lines.filter((line) => line.type === 'ADDED').length,
    removed: lines.filter((line) => line.type === 'REMOVED').length,
  };
}

export function diffDraftRevisions(from: DraftRevisionSnapshot, to: DraftRevisionSnapshot): DraftRevisionDiff {
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    titleChanged: from.title !== to.title,
    title: { before: from.title, after: to.title },
    content: diffLines(from.content, to.content),
  };
}
