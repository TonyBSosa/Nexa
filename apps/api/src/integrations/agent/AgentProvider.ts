import type { QuestionAssessment } from '@nexa/shared';

export interface AgentProvider {
  assessQuestion(input: { question: string }): Promise<QuestionAssessment>;
}
