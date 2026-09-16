import type {
  ContactPerson, RecoveryAction, RecoveryActionExecutionStatus, SuggestedAction, SuggestedActionType,
} from '@nexa/shared';
import { recoveryActionExecutionStatuses } from '@nexa/shared';

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isUsableAction(value: unknown): value is SuggestedAction {
  return isObject(value) && typeof value.type === 'string'
    && ['REQUEST_INFORMATION', 'DRAFT_EMAIL', 'PROPOSE_MEETING', 'REQUEST_DOCUMENT', 'CREATE_DOCUMENTATION_TASK'].includes(value.type)
    && nonempty(value.description);
}

export function recoveryProposals(value: unknown): SuggestedAction[] {
  const usable = Array.isArray(value) ? value.filter(isUsableAction) : [];
  return usable.length ? usable.map(({ type, description }) => ({ type, description: description.trim() })) : [{
    type: 'REQUEST_INFORMATION',
    description: 'Solicitar información para documentar el procedimiento faltante (propuesta determinista de respaldo).',
  }];
}

export function defaultEmailBody(question: string, objective: string | null): string {
  const goal = objective?.trim() || 'documentar el procedimiento faltante';
  return [
    'Hola,',
    '',
    `Desde NEXA estamos recuperando conocimiento organizacional sobre: ${question}`,
    '',
    `Objetivo: ${goal}`,
    '',
    '¿Podrías compartir la información o el documento correspondiente?',
    '',
    'Gracias,',
    'Equipo de conocimiento (simulado — no se envía automáticamente)',
  ].join('\n');
}

export function enrichActionDefaults(
  action: Pick<RecoveryAction, 'type' | 'description'> & Partial<RecoveryAction>,
  context: { question: string; contacts: ContactPerson[]; department: string | null },
  now: string,
): Omit<RecoveryAction, 'id' | 'createdAt' | 'updatedAt' | 'approvedAt'> & {
  id?: string; createdAt?: string; updatedAt?: string; approvedAt?: string | null;
} {
  const primary = context.contacts[0] ?? null;
  const responsible = action.responsible ?? primary?.name ?? null;
  const recipient = action.recipient
    ?? (primary ? `${primary.name} <${primary.email}>` : null);
  const objective = action.objective ?? `Recuperar la información faltante: ${action.description}`;
  const subject = action.subject ?? (
    action.type === 'DRAFT_EMAIL' || action.type === 'REQUEST_INFORMATION' || action.type === 'REQUEST_DOCUMENT'
      ? `NEXA · recuperación de conocimiento`
      : null
  );
  const defaultDue = new Date(now);
  defaultDue.setUTCDate(defaultDue.getUTCDate() + 7);
  return {
    ...action,
    type: action.type,
    description: action.description,
    simulated: true,
    humanNote: action.humanNote ?? null,
    discarded: action.discarded ?? false,
    recipient,
    subject,
    objective,
    dueAt: action.dueAt ?? defaultDue.toISOString(),
    notes: action.notes ?? null,
    agenda: action.agenda ?? (action.type === 'PROPOSE_MEETING' ? '1) Contexto de la brecha\n2) Información requerida\n3) Próximos pasos de documentación' : null),
    meetingLink: action.meetingLink ?? null,
    meetingAt: action.meetingAt ?? null,
    participants: action.participants?.length ? action.participants : (primary ? [primary.name] : []),
    externalTaskReference: action.externalTaskReference ?? null,
    responsible,
    executionStatus: action.executionStatus ?? 'PENDING',
    sentAt: action.sentAt ?? null,
    respondedAt: action.respondedAt ?? null,
    responseAttachment: action.responseAttachment ?? null,
    cancelReason: action.cancelReason ?? null,
    preparedEmailBody: action.preparedEmailBody ?? (
      action.type === 'DRAFT_EMAIL' || action.type === 'REQUEST_INFORMATION' || action.type === 'REQUEST_DOCUMENT'
        ? defaultEmailBody(context.question, objective)
        : null
    ),
    reminderNote: action.reminderNote ?? null,
    createdAt: action.createdAt ?? now,
    updatedAt: action.updatedAt ?? now,
    approvedAt: action.approvedAt ?? null,
  };
}

export function createRecoveryAction(
  base: { type: SuggestedActionType; description: string },
  id: string,
  now: string,
  context: { question: string; contacts: ContactPerson[]; department: string | null },
  extras: Partial<RecoveryAction> = {},
  deferContactDefaults = false,
): RecoveryAction {
  const enriched = enrichActionDefaults({ ...base, ...extras }, context, now);
  return {
    id,
    type: enriched.type,
    description: enriched.description.trim(),
    simulated: true,
    humanNote: enriched.humanNote ?? null,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    discarded: false,
    recipient: deferContactDefaults && extras.recipient === undefined ? null : enriched.recipient,
    subject: enriched.subject,
    objective: enriched.objective,
    dueAt: enriched.dueAt,
    notes: enriched.notes,
    agenda: enriched.agenda,
    meetingLink: enriched.meetingLink,
    meetingAt: enriched.meetingAt,
    participants: deferContactDefaults && extras.participants === undefined ? [] : enriched.participants,
    externalTaskReference: enriched.externalTaskReference,
    responsible: deferContactDefaults && extras.responsible === undefined ? null : enriched.responsible,
    executionStatus: 'PENDING',
    sentAt: null,
    respondedAt: null,
    responseAttachment: null,
    cancelReason: null,
    preparedEmailBody: enriched.preparedEmailBody,
    reminderNote: null,
  };
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!nonempty(value)) throw new Error('invalid optional text');
  return value.trim();
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !nonempty(item))) throw new Error('invalid string array');
  return value.map((item) => (item as string).trim());
}

export function parseExecutionStatus(value: unknown): RecoveryActionExecutionStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (recoveryActionExecutionStatuses as readonly string[]).includes(value)) {
    return value as RecoveryActionExecutionStatus;
  }
  throw new Error('invalid execution status');
}

export function actionReadyForApproval(action: RecoveryAction): boolean {
  return nonempty(action.responsible) && nonempty(action.recipient)
    && nonempty(action.objective) && nonempty(action.dueAt) && !action.discarded;
}

export function normalizeStoredAction(value: unknown, gapId: string, index: number, gapCreatedAt: string): RecoveryAction {
  if (!isUsableAction(value) || !isObject(value)) throw new Error('invalid action');
  for (const key of ['id', 'createdAt', 'updatedAt']) {
    if (value[key] !== undefined && !nonempty(value[key])) throw new Error('invalid action metadata');
  }
  for (const key of ['humanNote', 'approvedAt', 'recipient', 'subject', 'objective', 'dueAt', 'notes', 'agenda',
    'meetingLink', 'meetingAt', 'externalTaskReference', 'responsible', 'sentAt', 'respondedAt',
    'responseAttachment', 'cancelReason', 'preparedEmailBody', 'reminderNote']) {
    if (value[key] !== undefined && value[key] !== null && !nonempty(value[key])) throw new Error('invalid action field');
  }
  if (value.simulated !== undefined && value.simulated !== true) throw new Error('invalid simulated flag');
  if (value.discarded !== undefined && typeof value.discarded !== 'boolean') throw new Error('invalid discarded');
  if (value.participants !== undefined && (!Array.isArray(value.participants) || value.participants.some((item) => !nonempty(item)))) {
    throw new Error('invalid participants');
  }
  let executionStatus: RecoveryActionExecutionStatus = 'PENDING';
  if (value.executionStatus !== undefined) {
    executionStatus = parseExecutionStatus(value.executionStatus)!;
  }
  return {
    id: nonempty(value.id) ? value.id : `${gapId}-action-${index + 1}`,
    type: value.type,
    description: value.description.trim(),
    simulated: true,
    humanNote: nonempty(value.humanNote) ? value.humanNote : null,
    createdAt: nonempty(value.createdAt) ? value.createdAt : gapCreatedAt,
    updatedAt: nonempty(value.updatedAt) ? value.updatedAt : gapCreatedAt,
    approvedAt: nonempty(value.approvedAt) ? value.approvedAt : null,
    discarded: value.discarded === true,
    recipient: nonempty(value.recipient) ? value.recipient : null,
    subject: nonempty(value.subject) ? value.subject : null,
    objective: nonempty(value.objective) ? value.objective : null,
    dueAt: nonempty(value.dueAt) ? value.dueAt : null,
    notes: nonempty(value.notes) ? value.notes : null,
    agenda: nonempty(value.agenda) ? value.agenda : null,
    meetingLink: nonempty(value.meetingLink) ? value.meetingLink : null,
    meetingAt: nonempty(value.meetingAt) ? value.meetingAt : null,
    participants: Array.isArray(value.participants) ? value.participants.map((item) => String(item).trim()) : [],
    externalTaskReference: nonempty(value.externalTaskReference) ? value.externalTaskReference : null,
    responsible: nonempty(value.responsible) ? value.responsible : null,
    executionStatus,
    sentAt: nonempty(value.sentAt) ? value.sentAt : null,
    respondedAt: nonempty(value.respondedAt) ? value.respondedAt : null,
    responseAttachment: nonempty(value.responseAttachment) ? value.responseAttachment : null,
    cancelReason: nonempty(value.cancelReason) ? value.cancelReason : null,
    preparedEmailBody: nonempty(value.preparedEmailBody) ? value.preparedEmailBody : null,
    reminderNote: nonempty(value.reminderNote) ? value.reminderNote : null,
  };
}

export { optionalText, optionalStringArray };
