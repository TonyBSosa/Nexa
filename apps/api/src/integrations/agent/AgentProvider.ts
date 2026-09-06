import type { AssessQuestionInput, DraftGenerationInput, DraftGenerationResult, QuestionAssessment } from '@nexa/shared';

export interface AgentProvider {
  assessQuestion(input: AssessQuestionInput): Promise<QuestionAssessment>;
  generateKnowledgeDraft(input: DraftGenerationInput): Promise<DraftGenerationResult>;
}
