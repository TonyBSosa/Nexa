import type { ContactPerson } from '@nexa/shared';

/** Synthetic Valle Norte Supplies directory — fictional roles only. */
export const SYNTHETIC_CONTACTS: ContactPerson[] = [
  {
    id: 'contact-finance-lead',
    name: 'María Elena Quintero',
    title: 'Finance Lead',
    department: 'Finance',
    email: 'maria.quintero@vallenorte.example',
    phone: 'ext. 210',
    availability: 'AVAILABLE',
  },
  {
    id: 'contact-finance-assistant',
    name: 'Luis Armando Peña',
    title: 'Finance Assistant',
    department: 'Finance',
    email: 'luis.pena@vallenorte.example',
    phone: 'ext. 212',
    availability: 'BUSY',
  },
  {
    id: 'contact-general-manager',
    name: 'Carmen Isabel Rivas',
    title: 'General Manager',
    department: 'Dirección',
    email: 'carmen.rivas@vallenorte.example',
    phone: 'ext. 100',
    availability: 'AWAY',
  },
  {
    id: 'contact-ops-coordinator',
    name: 'José Andrés Mejía',
    title: 'Operations Coordinator',
    department: 'Operations',
    email: 'jose.mejia@vallenorte.example',
    phone: 'ext. 340',
    availability: 'AVAILABLE',
  },
  {
    id: 'contact-ti-support',
    name: 'Andrea Sofía López',
    title: 'Soporte de TI',
    department: 'TI / Equipos',
    email: 'andrea.lopez@vallenorte.example',
    phone: 'ext. 450',
    availability: 'AVAILABLE',
  },
  {
    id: 'contact-asset-mgmt',
    name: 'Pedro Javier Cruz',
    title: 'Gestión de Activos',
    department: 'TI / Equipos',
    email: 'pedro.cruz@vallenorte.example',
    phone: null,
    availability: 'UNKNOWN',
  },
];

function matchesRole(contact: ContactPerson, role: string): boolean {
  const needle = role.trim().toLowerCase();
  if (!needle) return false;
  const title = contact.title.toLowerCase();
  const name = contact.name.toLowerCase();
  const department = contact.department.toLowerCase();
  return title.includes(needle) || needle.includes(title)
    || name.includes(needle) || needle.includes(name)
    || department.includes(needle) || needle.includes(department)
    || (/\bti\b|equipos|soporte/.test(needle) && (/\bti\b|equipos|soporte/.test(department) || /\bti\b|equipos|soporte/.test(title)))
    || (/finance|finanz/.test(needle) && /finance|finanz/.test(department));
}

/** Resolve synthetic contacts for a gap from department and suggested expert labels. */
export function contactsForGap(department: string | null, experts: string[]): ContactPerson[] {
  const selected = new Map<string, ContactPerson>();
  for (const expert of experts) {
    for (const contact of SYNTHETIC_CONTACTS) {
      if (matchesRole(contact, expert)) selected.set(contact.id, contact);
    }
  }
  if (department) {
    for (const contact of SYNTHETIC_CONTACTS) {
      const dept = department.trim().toLowerCase();
      const contactDept = contact.department.toLowerCase();
      if (contactDept === dept || contactDept.includes(dept) || dept.includes(contactDept)
        || (/\bti\b|equipos|soporte/.test(dept) && /\bti\b|equipos|soporte/.test(contactDept))
        || (/finance|finanz/.test(dept) && /finance|finanz/.test(contactDept))) {
        selected.set(contact.id, contact);
      }
    }
  }
  if (!selected.size && department) {
    const fallback = SYNTHETIC_CONTACTS.find((contact) => contact.department === 'Finance')
      ?? SYNTHETIC_CONTACTS[0];
    if (fallback) selected.set(fallback.id, fallback);
  }
  return [...selected.values()];
}

export function missingInformationHint(originalQuestion: string, evidenceRevision: number): string {
  if (evidenceRevision > 0) {
    return 'Hay evidencia registrada. Verifique si falta contexto, excepciones o responsables adicionales antes de documentar.';
  }
  return `Aún no se ha recuperado el procedimiento o la respuesta documentada para: “${originalQuestion}”.`;
}
