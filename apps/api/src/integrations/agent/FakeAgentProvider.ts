import type { QuestionAssessment } from '@nexa/shared';
import type { AgentProvider } from './AgentProvider.js';

function normalize(question: string): string {
  return question.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, ' ');
}

const tonerQuestions = new Set([
  '¿Qué tóner utiliza la impresora MX550?',
  'What toner does the MX550 printer use?',
  'What toner does the MX550 use?',
  'Which toner is used by the MX550 printer?',
  '¿Qué tóner usa la impresora MX550?',
  '¿Qué tóner utiliza la MX550?',
  '¿Cuál es el tóner de la impresora MX550?',
].map(normalize));

const retirementQuestions = new Set([
  'What is the company procedure for retiring a printer?',
  'What is the company procedure for decommissioning a printer?',
  'How do we retire a printer?',
  '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?',
  '¿Cómo se da de baja una impresora?',
  '¿Cómo retirar una impresora de la empresa?',
].map(normalize));

export class FakeAgentProvider implements AgentProvider {
  constructor(private readonly allowFailureSimulation = false) {}

  assessQuestion({ question }: { question: string }): Promise<QuestionAssessment> {
    const key = normalize(question);
    if (this.allowFailureSimulation && ['simular fallo del agente', 'simulate agent failure'].includes(key)) {
      return Promise.resolve({
        status: 'FAILURE', organizationallyRelevant: null,
        retrievalCompleted: false, answer: null, evidence: [],
      });
    }
    if (tonerQuestions.has(key)) {
      return Promise.resolve({
        status: 'SUFFICIENT', organizationallyRelevant: true,
        retrievalCompleted: true,
        answer: 'Datos sintéticos de NEXA: la MX550 utiliza el tóner NX-550 Black según la Guía interna de equipos. Esta información empresarial es ficticia; no corresponde a datos de un producto real.',
        evidence: [{ sourceId: 'synthetic-equipment', title: 'Guía interna de equipos (sintética)', documentId: 'mx550-demo' }],
      });
    }
    if (retirementQuestions.has(key)) {
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
}
