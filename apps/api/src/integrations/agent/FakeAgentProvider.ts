import type { AssessQuestionInput, DraftGenerationInput, DraftGenerationResult, QuestionAssessment } from '@nexa/shared';
import type { AgentProvider } from './AgentProvider.js';
import { normalizeQuestion as normalize, questionKey } from '../../domain/questionKey.js';
import { generateDeterministicDraft } from './deterministicDraft.js';

const tonerKey = questionKey('What toner does the MX550 use?');
const retirementKey = questionKey('How do we retire a printer?');

export class FakeAgentProvider implements AgentProvider {
  constructor(private readonly allowFailureSimulation = false) {}

  assessQuestion({ question, approvedKnowledge = [] }: AssessQuestionInput): Promise<QuestionAssessment> {
    const approved = approvedKnowledge.find((item) => item.normalizedQuestionKey === questionKey(question));
    if (approved) return Promise.resolve({
      status: 'SUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true,
      answer: approved.content, evidence: [approved.reference],
    });
    const key = normalize(question);
    if (this.allowFailureSimulation && ['simular fallo del agente', 'simulate agent failure'].includes(key)) {
      return Promise.resolve({
        status: 'FAILURE', organizationallyRelevant: null,
        retrievalCompleted: false, answer: null, evidence: [],
      });
    }
    if (questionKey(question) === tonerKey) {
      return Promise.resolve({
        status: 'SUFFICIENT', organizationallyRelevant: true,
        retrievalCompleted: true,
        answer: 'Datos sintéticos de NEXA: la MX550 utiliza el tóner NX-550 Black según la Guía interna de equipos. Esta información empresarial es ficticia; no corresponde a datos de un producto real.',
        evidence: [{ sourceId: 'synthetic-equipment', title: 'Guía interna de equipos (sintética)', documentId: 'mx550-demo' }],
      });
    }
    if (questionKey(question) === retirementKey) {
      return Promise.resolve({
        status: 'INSUFFICIENT', organizationallyRelevant: true,
        retrievalCompleted: true, answer: null, evidence: [],
        suggestedCategory: 'TI / Equipos',
        suggestedDepartment: 'Soporte de TI',
        suggestedExperts: ['Coordinador de TI', 'Especialista en gestión de activos'],
        suggestedActions: [
          { type: 'REQUEST_INFORMATION', description: 'Solicitar al Coordinador de TI ficticio que describa el procedimiento faltante para dar de baja una impresora.' },
          { type: 'REQUEST_DOCUMENT', description: 'Solicitar al Especialista en gestión de activos ficticio un documento existente sobre la baja de impresoras.' },
          { type: 'PROPOSE_MEETING', description: 'Proponer una reunión de revisión con los roles ficticios de Soporte de TI; se requeriría aprobación humana.' },
        ],
      });
    }
    // This fake only recognizes the documented fixtures; it is not an AI classifier.
    return Promise.resolve({
      status: 'INSUFFICIENT', organizationallyRelevant: false,
      retrievalCompleted: false, answer: null, evidence: [],
    });
  }

  generateKnowledgeDraft(input: DraftGenerationInput): Promise<DraftGenerationResult> {
    return generateDeterministicDraft(input, this.allowFailureSimulation);
  }
}
