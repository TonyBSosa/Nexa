import type { SuggestedAction } from '@nexa/shared';

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
