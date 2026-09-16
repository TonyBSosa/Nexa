import type { EvidenceContentKind, EvidenceFileMetadata, EvidenceType, MeetingDetails } from '@nexa/shared';
import { evidenceTypes } from '@nexa/shared';
import {
  invalidRequest, optionalText, requireObject, requirePositiveInteger, requireText, requireTextList,
} from './inputValidation.js';
import { normalizeActor } from './reviewRules.js';
import { DomainError } from './workflow.js';

export { evidenceTypes } from '@nexa/shared';
export type { EvidenceType, EvidenceContentKind, EvidenceFileMetadata, MeetingDetails } from '@nexa/shared';

export interface NewEvidence {
  type: EvidenceType;
  contentKind: EvidenceContentKind;
  source: string;
  author: string;
  evidenceDate: string;
  reference: string | null;
  note: string | null;
  content: string | null;
  url: string | null;
  file: EvidenceFileMetadata | null;
  meeting: MeetingDetails | null;
}

export interface EvidenceVersionState {
  type: EvidenceType;
  version: number;
  withdrawnAt: string | null;
  supersededBy: string | null;
}

export interface EvidenceWithdrawal {
  actor: string;
  justification: string;
}

export interface EvidenceReplacement {
  actor: string;
  reason: string;
  file: EvidenceFileMetadata;
  version: number;
}

const contentKinds: Record<EvidenceType, EvidenceContentKind> = {
  MANUAL_TEXT: 'TEXT', MEETING_NOTES: 'MEETING', TRANSCRIPT: 'TEXT', SNIPPET: 'TEXT',
  PDF: 'FILE', DOCUMENT: 'FILE', IMAGE: 'FILE', VIDEO: 'FILE',
  LINK: 'URL', VIDEO_LINK: 'URL',
};

const megabyte = 1024 * 1024;
const fileRules: Partial<Record<EvidenceType, { maxBytes: number; extensions: Record<string, string[]> }>> = {
  PDF: { maxBytes: 10 * megabyte, extensions: { 'application/pdf': ['pdf'] } },
  DOCUMENT: {
    maxBytes: 10 * megabyte,
    extensions: {
      'application/msword': ['doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
      'application/vnd.oasis.opendocument.text': ['odt'],
      'text/plain': ['txt'],
      'text/markdown': ['md'],
    },
  },
  IMAGE: {
    maxBytes: 5 * megabyte,
    extensions: { 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'], 'image/gif': ['gif'] },
  },
  VIDEO: { maxBytes: 25 * megabyte, extensions: { 'video/mp4': ['mp4'], 'video/webm': ['webm'] } },
};

const limits = { source: 200, reference: 500, note: 2_000, content: 12_000, url: 2_000, fileName: 200, summary: 4_000, agreement: 500, justification: 2_000 };
// Evidence dates are calendar dates; allow the furthest time zone ahead of UTC.
const maxTimeZoneLeadMs = 14 * 60 * 60 * 1_000;

export function evidenceContentKind(type: EvidenceType): EvidenceContentKind {
  return contentKinds[type];
}

function evidenceDate(value: unknown, now: Date): string {
  const text = requireText(value, 'evidenceDate', 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!parsed || parsed.toISOString().slice(0, 10) !== text) return invalidRequest('evidenceDate debe tener formato AAAA-MM-DD.');
  if (text > new Date(now.getTime() + maxTimeZoneLeadMs).toISOString().slice(0, 10)) {
    return invalidRequest('evidenceDate no puede estar en el futuro.');
  }
  return text;
}

export function validateHttpUrl(value: unknown, name: string): string {
  const text = requireText(value, name, limits.url);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalidRequest(`${name} debe ser un enlace http o https válido.`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    return invalidRequest(`${name} debe ser un enlace http o https válido.`);
  }
  return text;
}

export function validateFileMetadata(type: EvidenceType, input: unknown): EvidenceFileMetadata {
  const rules = fileRules[type];
  if (!rules) return invalidRequest(`El tipo ${type} no admite archivos.`);
  const value = requireObject(input, ['fileName', 'mimeType', 'sizeBytes']);
  const fileName = requireText(value.fileName, 'fileName', limits.fileName);
  if (/[/\\]/.test(fileName) || /^\.+$/.test(fileName) || [...fileName].some((character) => character.charCodeAt(0) < 32)) {
    return invalidRequest('fileName no es válido.');
  }
  const mimeType = requireText(value.mimeType, 'mimeType', 150).toLowerCase();
  const extensions = rules.extensions[mimeType];
  if (!extensions) return invalidRequest(`El tipo de archivo ${mimeType} no está permitido para ${type}.`);
  const extension = fileName.includes('.') ? fileName.split('.').at(-1)?.toLowerCase() ?? '' : '';
  if (!extensions.includes(extension)) return invalidRequest('La extensión del archivo no coincide con su tipo.');
  const sizeBytes = requirePositiveInteger(value.sizeBytes, 'sizeBytes');
  if (sizeBytes > rules.maxBytes) return invalidRequest(`El archivo supera ${rules.maxBytes / megabyte} MB.`);
  return { fileName, mimeType, sizeBytes };
}

function meetingDetails(input: unknown): MeetingDetails {
  const value = requireObject(input, ['participants', 'summary', 'agreements', 'transcript', 'recordingUrl']);
  if (!Array.isArray(value.participants) || !value.participants.length) return invalidRequest('Indique al menos un participante.');
  if (value.participants.length > 50) return invalidRequest('participants admite como máximo 50 elementos.');
  return {
    participants: value.participants.map((participant) => normalizeActor(participant, 'participants')),
    summary: requireText(value.summary, 'summary', limits.summary),
    agreements: value.agreements === undefined ? [] : requireTextList(value.agreements, 'agreements', 50, limits.agreement),
    transcript: optionalText(value.transcript, 'transcript', limits.content),
    recordingUrl: value.recordingUrl === undefined || value.recordingUrl === null || value.recordingUrl === ''
      ? null : validateHttpUrl(value.recordingUrl, 'recordingUrl'),
  };
}

export function validateNewEvidence(input: unknown, now: Date): NewEvidence {
  const value = requireObject(input, ['type', 'source', 'author', 'evidenceDate', 'reference', 'note', 'content', 'url', 'file', 'meeting']);
  if (!evidenceTypes.includes(value.type as EvidenceType)) return invalidRequest('type no es un tipo de evidencia válido.');
  const type = value.type as EvidenceType;
  const contentKind = contentKinds[type];
  const allowed: Record<EvidenceContentKind, string> = { TEXT: 'content', MEETING: 'meeting', FILE: 'file', URL: 'url' };
  for (const field of ['content', 'url', 'file', 'meeting']) {
    const permitted = field === allowed[contentKind] || (contentKind === 'MEETING' && field === 'content');
    if (!permitted && value[field] !== undefined) return invalidRequest(`${field} no aplica al tipo ${type}.`);
  }
  return {
    type,
    contentKind,
    source: requireText(value.source, 'source', limits.source),
    author: normalizeActor(value.author, 'author'),
    evidenceDate: evidenceDate(value.evidenceDate, now),
    reference: optionalText(value.reference, 'reference', limits.reference),
    note: optionalText(value.note, 'note', limits.note),
    content: contentKind === 'TEXT' ? requireText(value.content, 'content', limits.content)
      : contentKind === 'MEETING' ? optionalText(value.content, 'content', limits.content) : null,
    url: contentKind === 'URL' ? validateHttpUrl(value.url, 'url') : null,
    file: contentKind === 'FILE' ? validateFileMetadata(type, value.file) : null,
    meeting: contentKind === 'MEETING' ? meetingDetails(value.meeting) : null,
  };
}

function assertCurrentVersion(evidence: EvidenceVersionState): void {
  if (evidence.withdrawnAt !== null) throw new DomainError('INVALID_TRANSITION', 'La evidencia ya fue retirada.');
  if (evidence.supersededBy !== null) throw new DomainError('STALE_STATE', 'Solo puede modificarse la versión vigente de la evidencia.');
}

export function validateWithdrawal(evidence: EvidenceVersionState, input: unknown): EvidenceWithdrawal {
  const value = requireObject(input, ['actor', 'justification']);
  const actor = normalizeActor(value.actor);
  const justification = requireText(value.justification, 'justification', limits.justification);
  if (justification.length < 10) return invalidRequest('La justificación debe tener al menos 10 caracteres.');
  assertCurrentVersion(evidence);
  return { actor, justification };
}

export function validateReplacement(evidence: EvidenceVersionState, input: unknown): EvidenceReplacement {
  const value = requireObject(input, ['actor', 'reason', 'file']);
  const actor = normalizeActor(value.actor);
  const reason = requireText(value.reason, 'reason', limits.note);
  if (contentKinds[evidence.type] !== 'FILE') {
    throw new DomainError('INVALID_TRANSITION', 'Solo la evidencia con archivo puede reemplazarse; agregue una evidencia nueva.');
  }
  const file = validateFileMetadata(evidence.type, value.file);
  assertCurrentVersion(evidence);
  return { actor, reason, file, version: evidence.version + 1 };
}
