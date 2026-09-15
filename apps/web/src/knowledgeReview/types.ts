import type { ApprovalDecision } from '@nexa/shared';

// View shapes for the collection and review panels. They mirror the API domain
// results and move to @nexa/shared once the endpoints exist.

export type DiffLineType = 'EQUAL' | 'ADDED' | 'REMOVED';

export interface DiffLineView {
  type: DiffLineType;
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

export interface RevisionDiffViewModel {
  fromRevision: number;
  toRevision: number;
  titleChanged: boolean;
  title: { before: string; after: string };
  content: { lines: DiffLineView[]; added: number; removed: number };
}

export interface DecisionHistoryEntry {
  id: string;
  draftRevision: number;
  decision: ApprovalDecision;
  actor: string | null;
  comment: string | null;
  createdAt: string;
}

export type EvidenceTypeView =
  | 'MANUAL_TEXT' | 'MEETING_NOTES' | 'TRANSCRIPT' | 'PDF' | 'DOCUMENT'
  | 'IMAGE' | 'LINK' | 'VIDEO' | 'VIDEO_LINK' | 'SNIPPET';

export interface EvidenceListItem {
  id: string;
  type: EvidenceTypeView;
  version: number;
  source: string;
  author: string | null;
  evidenceDate: string | null;
  reference: string | null;
  note: string | null;
  content: string | null;
  url: string | null;
  file: { fileName: string; mimeType: string; sizeBytes: number; viewUrl: string; downloadUrl: string } | null;
  meeting: {
    participants: string[];
    summary: string;
    agreements: string[];
    transcript: string | null;
    recordingUrl: string | null;
  } | null;
  withdrawal: { actor: string; justification: string; withdrawnAt: string } | null;
  supersededBy: string | null;
  createdAt: string;
}
