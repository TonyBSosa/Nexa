export function normalizeQuestion(question: string): string {
  return question.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/\s+/g, ' ');
}

const groups = [
  [
    '¿Qué tóner utiliza la impresora MX550?', 'What toner does the MX550 printer use?',
    'What toner does the MX550 use?', 'Which toner is used by the MX550 printer?',
    '¿Qué tóner usa la impresora MX550?', '¿Qué tóner utiliza la MX550?',
    '¿Cuál es el tóner de la impresora MX550?',
  ],
  [
    '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?',
    'What is the company procedure for retiring a printer?',
    'What is the company procedure for decommissioning a printer?',
    'How do we retire a printer?', '¿Cómo se da de baja una impresora?',
    '¿Cómo retirar una impresora de la empresa?',
  ],
];
const aliases = new Map<string, string>();
for (const group of groups) {
  const canonical = normalizeQuestion(group[0]!);
  for (const question of group) aliases.set(normalizeQuestion(question), canonical);
}

export function questionKey(question: string): string {
  const normalized = normalizeQuestion(question);
  return aliases.get(normalized) ?? normalized;
}
