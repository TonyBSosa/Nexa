import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DomainError } from '../domain/workflow.js';

/** Identifiers come from the URL, so only these characters may reach a path. */
const safeSegment = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Stores evidence file bytes on disk under <root>/<gapId>/<evidenceId>. The
 * original file name lives in the database, so nothing user-supplied becomes a
 * path segment and there is no extension to guess a handler from.
 */
export class EvidenceFileStore {
  constructor(private readonly root: string) {}

  private path(gapId: string, evidenceId: string): string {
    if (!safeSegment.test(gapId) || !safeSegment.test(evidenceId)) {
      throw new DomainError('INVALID_REQUEST', 'Identificador de archivo no válido.');
    }
    const target = resolve(this.root, gapId, evidenceId);
    // Defence in depth: the regular expression already excludes separators.
    if (target !== resolve(this.root) && !target.startsWith(resolve(this.root) + sep)) {
      throw new DomainError('INVALID_REQUEST', 'Identificador de archivo no válido.');
    }
    return target;
  }

  write(gapId: string, evidenceId: string, bytes: Buffer): void {
    const target = this.path(gapId, evidenceId);
    mkdirSync(join(resolve(this.root), gapId), { recursive: true });
    writeFileSync(target, bytes);
  }

  read(gapId: string, evidenceId: string): Buffer {
    try {
      return readFileSync(this.path(gapId, evidenceId));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('NOT_FOUND', 'El archivo de esta evidencia no está disponible.');
    }
  }

  /** Used to undo a written file when the database write that follows fails. */
  remove(gapId: string, evidenceId: string): void {
    try {
      rmSync(this.path(gapId, evidenceId), { force: true });
    } catch {
      // A leftover file is preferable to masking the original failure.
    }
  }
}
