import type Database from 'better-sqlite3';
import type { GapReview, KnowledgeGap, ReviewDecisionRequest, ReviewDetail, ReviewFilters, ReviewMetadata } from '@nexa/shared';
import { DomainError, assertTriageAllowed } from '../domain/workflow.js';

type Gap = Pick<KnowledgeGap, 'id' | 'status' | 'title' | 'originalQuestion' | 'category' | 'suggestedDepartment' | 'priority'>;

export class ReviewStore {
  constructor(private readonly db: Database.Database, private readonly now: () => Date) {}

  private gap(id: string): Gap {
    const gap = this.db.prepare<[string], Gap>('SELECT id, status, title, originalQuestion, category, suggestedDepartment, priority FROM knowledge_gaps WHERE id = ?').get(id);
    if (!gap) throw new DomainError('NOT_FOUND', 'Brecha no encontrada.');
    return gap;
  }

  state(id: string): GapReview {
    const gap = this.gap(id);
    const row = this.db.prepare<[string], { data: string }>('SELECT data FROM gap_reviews WHERE knowledgeGapId = ?').get(id);
    if (row) return JSON.parse(row.data) as GapReview;
    // Existing later stages retain their state; no invented reviewer or classification history.
    return { revision: 0, disposition: gap.status === 'DETECTED' ? 'PENDING' : 'ACCEPTED', reason: null,
      duplicateOf: null, responsible: null, sensitivity: 'NORMAL', targetDate: null, importance: null,
      relatedGapIds: [], relatedArticleIds: [], reviewedBy: null, reviewedAt: null, classifiedBy: null, classifiedAt: null };
  }

  private write(id: string, state: GapReview) {
    state.revision++;
    this.db.prepare('INSERT INTO gap_reviews VALUES (?, ?) ON CONFLICT(knowledgeGapId) DO UPDATE SET data = excluded.data').run(id, JSON.stringify(state));
    this.db.prepare('UPDATE knowledge_gaps SET updatedAt = ? WHERE id = ?').run(this.now().toISOString(), id);
  }

  private event(id: string, action: string, actor: string, reason: string | null, state: GapReview) {
    this.db.prepare('INSERT INTO gap_review_events (knowledgeGapId, action, actor, reason, snapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, action, actor, reason, JSON.stringify({ gap: this.gap(id), review: state }), this.now().toISOString());
  }

  private fresh(state: GapReview, revision: number) {
    if (state.revision !== revision) throw new DomainError('STALE_STATE', 'La revisión cambió. Actualice el detalle antes de continuar.');
  }

  private active(state: GapReview) {
    if (state.disposition === 'DISCARDED' || state.disposition === 'DUPLICATE') throw new DomainError('INVALID_TRANSITION', 'Restaure la solicitud antes de editarla o avanzar.');
  }

  invalidateClassification(id: string) {
    const state = this.state(id);
    this.active(state);
    state.classifiedAt = null; state.classifiedBy = null;
    this.write(id, state);
  }

  guardTransition(id: string, to: KnowledgeGap['status']) {
    const state = this.state(id);
    this.active(state);
    if (to === 'TRIAGED') throw new DomainError('APPROVAL_REQUIRED', 'Use la revisión humana para aceptar la solicitud.');
    if (to === 'ACTION_PROPOSED') {
      const gap = this.gap(id);
      if (!state.classifiedBy || !state.classifiedAt || !gap.category?.trim() || !gap.suggestedDepartment?.trim() || !state.responsible?.trim()) {
        throw new DomainError('APPROVAL_REQUIRED', 'Confirme categoría, departamento y responsable antes de definir una acción.');
      }
    }
  }

  detail(id: string): ReviewDetail {
    const gap = this.gap(id);
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const tokens = new Set(normalize(gap.title + ' ' + gap.originalQuestion).split(/[^a-z0-9]+/).filter(word => word.length > 3));
    const candidates = this.db.prepare<[string], Gap>('SELECT id, title, originalQuestion, status, category, suggestedDepartment, priority FROM knowledge_gaps WHERE id <> ? ORDER BY id').all(id);
    const similarGaps = candidates.map(candidate => ({ candidate, score: new Set(normalize(candidate.title + ' ' + candidate.originalQuestion).split(/[^a-z0-9]+/).filter(word => tokens.has(word))).size }))
      .filter(item => item.score >= 2).sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id)).slice(0, 5)
      .map(({ candidate }) => ({ id: candidate.id, title: candidate.title, status: candidate.status }));
    return { review: this.state(id),
      history: this.db.prepare<[string], ReviewDetail['history'][number]>('SELECT id, action, actor, reason, createdAt FROM gap_review_events WHERE knowledgeGapId = ? ORDER BY id DESC').all(id),
      sensitiveWarning: /\b(salarios?|salarial|sueldos?|nomina|contrasenas?|passwords?|credenciales|tarjetas?|diagnostico medico|cuenta bancaria|ssn|salary)\b/.test(normalize(gap.originalQuestion)),
      origin: this.db.prepare('SELECT 1 FROM queries WHERE knowledgeGapId = ? LIMIT 1').get(id) ? 'Asistente NEXA' : 'Origen no registrado', similarGaps };
  }

  list(filters: ReviewFilters): { ids: string[]; total: number } {
    const where: string[] = [];
    const values: (string | number)[] = [];
    const disposition = "COALESCE(json_extract(r.data, '$.disposition'), CASE WHEN g.status = 'DETECTED' THEN 'PENDING' ELSE 'ACCEPTED' END)";
    if (filters.q) { where.push('(instr(lower(g.title), lower(?)) > 0 OR instr(lower(g.originalQuestion), lower(?)) > 0)'); values.push(filters.q, filters.q); }
    for (const [column, value] of [[disposition, filters.disposition], ['g.priority', filters.priority], ['g.suggestedDepartment', filters.department], ['g.status', filters.status]] as const) {
      if (value) { where.push(`${column} = ?`); values.push(value); }
    }
    if (filters.from) { where.push('substr(g.createdAt, 1, 10) >= ?'); values.push(filters.from); }
    if (filters.to) { where.push('substr(g.createdAt, 1, 10) <= ?'); values.push(filters.to); }
    const from = 'FROM knowledge_gaps g LEFT JOIN gap_reviews r ON r.knowledgeGapId = g.id' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
    const total = (this.db.prepare('SELECT COUNT(*) AS total ' + from).get(...values) as { total: number }).total;
    const ids = (this.db.prepare('SELECT g.id ' + from + ' ORDER BY g.createdAt DESC, g.id LIMIT ? OFFSET ?').all(...values, filters.pageSize, (filters.page - 1) * filters.pageSize) as { id: string }[]).map(row => row.id);
    return { ids, total };
  }

  save(id: string, metadata: ReviewMetadata) {
    return this.db.transaction(() => {
      const gap = this.gap(id); const state = this.state(id);
      assertTriageAllowed(gap.status); this.active(state); this.fresh(state, metadata.revision);
      for (const target of metadata.relatedGapIds) {
        if (target === id) throw new DomainError('INVALID_REQUEST', 'No puede relacionar una brecha consigo misma.');
        this.gap(target);
      }
      for (const target of metadata.relatedArticleIds) if (!this.db.prepare('SELECT 1 FROM approved_knowledge WHERE articleId = ?').get(target)) throw new DomainError('NOT_FOUND', 'Artículo publicado no encontrado.');
      this.db.prepare('UPDATE knowledge_gaps SET title = ?, category = ?, priority = ?, suggestedDepartment = ?, suggestedExperts = ? WHERE id = ?')
        .run(metadata.title, metadata.category || null, metadata.priority, metadata.department || null, JSON.stringify(metadata.experts), id);
      Object.assign(state, { responsible: metadata.responsible || null, sensitivity: metadata.sensitivity, targetDate: metadata.targetDate,
        importance: metadata.importance || null, relatedGapIds: [...new Set(metadata.relatedGapIds)], relatedArticleIds: [...new Set(metadata.relatedArticleIds)], classifiedAt: null, classifiedBy: null });
      this.write(id, state);
      return this.detail(id);
    }).immediate();
  }

  decide(id: string, request: ReviewDecisionRequest) {
    return this.db.transaction(() => {
      const gap = this.gap(id); const state = this.state(id);
      assertTriageAllowed(gap.status); this.fresh(state, request.revision);
      const reason = request.reason?.trim() || null;
      if (request.decision === 'RESTORE') {
        if (!['DISCARDED', 'DUPLICATE'].includes(state.disposition)) throw new DomainError('INVALID_TRANSITION', 'Solo se restauran solicitudes descartadas o duplicadas.');
        state.disposition = 'PENDING'; state.reason = null; state.duplicateOf = null;
      } else if (request.decision === 'RETURN') {
        this.active(state);
        if (gap.status !== 'TRIAGED') throw new DomainError('INVALID_TRANSITION', 'Solo Clasificado puede volver a Detectado.');
        state.disposition = 'PENDING'; state.reviewedAt = null; state.reviewedBy = null;
      } else {
        this.active(state);
        if (gap.status !== 'DETECTED') throw new DomainError('INVALID_TRANSITION', 'Esta decisión requiere la etapa Detectado.');
        if (request.decision === 'ACCEPT') {
          state.disposition = 'ACCEPTED';
        } else if (request.decision === 'DUPLICATE') {
          if (!request.duplicateOf || request.duplicateOf === id) throw new DomainError('INVALID_REQUEST', 'Seleccione otra brecha como original.');
          this.gap(request.duplicateOf);
          const target = this.state(request.duplicateOf);
          if (['DISCARDED', 'DUPLICATE'].includes(target.disposition)) throw new DomainError('INVALID_REQUEST', 'La brecha original debe estar activa.');
          state.disposition = 'DUPLICATE'; state.duplicateOf = request.duplicateOf;
        } else {
          if (!reason) throw new DomainError('INVALID_REQUEST', 'Justifique el descarte.');
          state.disposition = 'DISCARDED';
        }
        state.reason = reason; state.reviewedBy = request.actor; state.reviewedAt = this.now().toISOString();
      }
      state.classifiedBy = null; state.classifiedAt = null;
      this.db.prepare('UPDATE knowledge_gaps SET status = ? WHERE id = ?').run(request.decision === 'ACCEPT' ? 'TRIAGED' : 'DETECTED', id);
      this.write(id, state); this.event(id, request.decision, request.actor, reason, state);
      return this.detail(id);
    }).immediate();
  }

  confirm(id: string, revision: number, actor: string) {
    return this.db.transaction(() => {
      const gap = this.gap(id); const state = this.state(id);
      this.active(state); this.fresh(state, revision);
      if (gap.status !== 'TRIAGED') throw new DomainError('INVALID_TRANSITION', 'Acepte la solicitud antes de confirmar la clasificación.');
      if (!gap.category?.trim() || !gap.suggestedDepartment?.trim() || !state.responsible?.trim() || !state.importance?.trim()) throw new DomainError('INVALID_REQUEST', 'Categoría, departamento, responsable y justificación de importancia son obligatorios.');
      state.classifiedBy = actor; state.classifiedAt = this.now().toISOString();
      this.write(id, state); this.event(id, 'CLASSIFY', actor, state.importance, state);
      return this.detail(id);
    }).immediate();
  }
}
