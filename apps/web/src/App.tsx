import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeGap, Query } from '@nexa/shared';
import {
  Activity, AlertCircle, BarChart3, Bell, Check, CheckCircle2, ChevronRight,
  Database, FileCheck2, LayoutDashboard, Menu, MessageCircle, Search,
  Settings2, Sparkles, Workflow, X,
} from 'lucide-react';
import { ChatTest } from './ChatTest';
import { KnowledgeOperationsTest } from './KnowledgeOperationsTest';

type PageKey = 'dashboard' | 'assistant' | 'sources' | 'operations' | 'health' | 'analytics';

const pages: Record<PageKey, { label: string; eyebrow: string; description: string }> = {
  dashboard: { label: 'Dashboard', eyebrow: 'Vista general', description: 'Estado actual del conocimiento organizacional.' },
  assistant: { label: 'Asistente IA', eyebrow: 'Consulta organizacional', description: 'Respuestas basadas en conocimiento aprobado y trazable.' },
  sources: { label: 'Fuentes', eyebrow: 'Gobierno de datos', description: 'Repositorios que alimentan el conocimiento de NEXA.' },
  operations: { label: 'Operaciones de conocimiento', eyebrow: 'Brechas de conocimiento', description: 'Convierte preguntas sin respuesta en conocimiento accionable.' },
  health: { label: 'Salud del conocimiento', eyebrow: 'Inteligencia organizacional', description: 'Identifica dónde recuperar y validar conocimiento.' },
  analytics: { label: 'Analítica', eyebrow: 'Rendimiento del conocimiento', description: 'Demanda, cobertura e impacto del conocimiento recuperado.' },
};

const nav = [
  ['dashboard', LayoutDashboard], ['assistant', Sparkles], ['sources', Database],
  ['operations', Workflow], ['health', Activity], ['analytics', BarChart3],
] as const;

const statusLabels: Record<KnowledgeGap['status'], string> = {
  DETECTED: 'Detectado', TRIAGED: 'Clasificado', ACTION_PROPOSED: 'Acción propuesta',
  IN_PROGRESS: 'En progreso', KNOWLEDGE_COLLECTED: 'Conocimiento recopilado',
  AWAITING_APPROVAL: 'Pendiente de aprobación', PUBLISHED: 'Publicado', RESOLVED: 'Resuelto',
};

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'red' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function PageHeader({ page, demo = false }: { page: PageKey; demo?: boolean }) {
  const details = pages[page];
  return <div className="page-header"><div><p className="eyebrow">{details.eyebrow}</p><h1>{details.label}</h1><p>{details.description}</p></div>{demo && <Badge>Datos de demostración</Badge>}</div>;
}

function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-heading"><h2>{title}</h2></div>}{children}</section>;
}

function Metric({ icon: Icon, value, label, detail, color }: { icon: typeof Activity; value: string; label: string; detail: string; color: string }) {
  return <div className="metric-card"><div className="metric-top"><span className="metric-icon" style={{ color }}><Icon size={18} /></span><span>{detail}</span></div><strong>{value}</strong><small>{label}</small></div>;
}

function gapTone(status: KnowledgeGap['status']) {
  if (status === 'RESOLVED' || status === 'PUBLISHED') return 'green';
  if (status === 'AWAITING_APPROVAL') return 'amber';
  if (status === 'DETECTED') return 'red';
  return 'blue';
}

function Dashboard({ goTo }: { goTo: (page: PageKey) => void }) {
  const [queries, setQueries] = useState<Query[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetch('/api/queries'), fetch('/api/knowledge-gaps')]).then(async ([queryResponse, gapResponse]) => {
      if (!queryResponse.ok || !gapResponse.ok) throw new Error('Datos no disponibles');
      const queryBody = await queryResponse.json() as { items: Query[] };
      const gapBody = await gapResponse.json() as { items: KnowledgeGap[] };
      if (active) { setQueries(queryBody.items); setGaps(gapBody.items); setLive(true); }
    }).catch(() => { if (active) setLive(false); });
    return () => { active = false; };
  }, []);

  const answered = queries.filter(query => query.sufficientKnowledge).length;
  const open = gaps.filter(gap => gap.status !== 'RESOLVED').length;
  const resolved = gaps.filter(gap => gap.status === 'RESOLVED').length;
  const coverage = queries.length ? `${Math.round(answered / queries.length * 100)}%` : 'Sin datos';
  const recent = queries.length ? queries.slice(0, 4) : [
    { id: 'demo-1', message: 'Se publicó un procedimiento de inventario.', sufficientKnowledge: true, createdAt: '' },
    { id: 'demo-2', message: 'Se detectó una pregunta sobre baja de equipos.', sufficientKnowledge: false, createdAt: '' },
  ];

  return <><PageHeader page="dashboard" demo={!live} /><div className="metric-grid">
    <Metric icon={MessageCircle} value={live ? String(queries.length) : '1.284'} label="Consultas totales" detail={live ? 'Datos del API' : 'Demo'} color="#3461db" />
    <Metric icon={CheckCircle2} value={live ? coverage : '78,4%'} label="Cobertura observada" detail={live ? `${answered} respondidas` : '+4,2%'} color="#2d8b72" />
    <Metric icon={AlertCircle} value={live ? String(open) : '24'} label="Brechas abiertas" detail={live ? 'Estado actual' : '6 prioritarias'} color="#d08a31" />
    <Metric icon={Workflow} value={live ? String(gaps.filter(g => ['IN_PROGRESS', 'KNOWLEDGE_COLLECTED', 'AWAITING_APPROVAL'].includes(g.status)).length) : '11'} label="En recuperación" detail={live ? 'Flujo activo' : '3 nuevas'} color="#7958c9" />
    <Metric icon={Activity} value={live ? String(resolved) : '38'} label="Brechas resueltas" detail={live ? 'Acumulado' : 'Este mes · demo'} color="#2d8b72" />
  </div><div className="dashboard-grid">
    <Panel title="Actividad reciente"><div className="activity-list">{recent.map(item => <div className="activity" key={item.id}><span className="activity-icon">{item.sufficientKnowledge ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span><div><strong>{item.sufficientKnowledge ? 'Consulta respondida' : 'Brecha detectada'}</strong><p>{item.message}</p></div><time>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('es') : 'Demo'}</time></div>)}</div></Panel>
    <Panel title="Flujo de conocimiento"><div className="flow"><div className="flow-line" />{['PREGUNTAR', 'DETECTAR', 'RECUPERAR', 'VALIDAR', 'PUBLICAR', 'APRENDER'].map((step, index) => <div className={`flow-step ${index < 4 ? 'done' : index === 4 ? 'current' : ''}`} key={step}><span>{index < 4 ? <Check size={13} /> : index + 1}</span><small>{step}</small></div>)}</div><p className="muted-copy">Cada pregunta puede convertirse en conocimiento aprobado y reutilizable.</p></Panel>
  </div><Panel title="Brechas prioritarias"><div className="table-wrap"><table><thead><tr><th>Brecha</th><th>Estado</th><th>Ocurrencias</th><th>Prioridad</th><th>Departamento</th></tr></thead><tbody>{gaps.slice(0, 4).map(gap => <tr key={gap.id}><td className="primary-cell">{gap.title}</td><td><Badge tone={gapTone(gap.status)}>{statusLabels[gap.status]}</Badge></td><td>{gap.occurrences}</td><td>{gap.priority}</td><td>{gap.suggestedDepartment ?? 'Sin asignar'}</td></tr>)}{!gaps.length && <tr><td colSpan={5} className="empty-cell">No hay brechas registradas. Prueba una consulta no documentada en el Asistente IA.</td></tr>}</tbody></table></div><button className="text-button" onClick={() => goTo('operations')}>Abrir operaciones <ChevronRight size={14} /></button></Panel></>;
}

function Sources() {
  const sources = [
    ['NEXA Approved Knowledge', 'Conocimiento validado y publicado dentro de NEXA.', 'Activa'],
    ['SharePoint', 'Bibliotecas y sitios de la organización.', 'No configurado'],
    ['Google Drive', 'Documentos internos seleccionados.', 'No configurado'],
    ['Notion', 'Páginas de conocimiento de los equipos.', 'No configurado'],
    ['Documentos internos', 'Carga manual de documentos aprobados.', 'No configurado'],
  ] as const;
  return <><PageHeader page="sources" demo /><Panel title="Fuentes de conocimiento"><p className="panel-intro">Las integraciones futuras se muestran de forma explícita; no están conectadas.</p><div className="source-grid">{sources.map(([name, description, status]) => <article className={`source-card ${status === 'Activa' ? 'source-active' : ''}`} key={name}><span className="source-icon"><Database size={19} /></span><div><div className="source-title"><strong>{name}</strong><Badge tone={status === 'Activa' ? 'green' : 'neutral'}>{status}</Badge></div><p>{description}</p><small>{status === 'Activa' ? 'Almacenamiento local aprobado' : 'Integración no implementada'}</small></div></article>)}</div></Panel></>;
}

function BarRows({ items }: { items: Array<[string, number]> }) {
  return <div className="bars">{items.map(([name, value]) => <div className="bar-row" key={name}><div><span>{name}</span><small>{value}%</small></div><div className="bar-track"><div style={{ width: `${value}%` }} /></div></div>)}</div>;
}

function Health() {
  return <><PageHeader page="health" demo /><div className="metric-grid four"><Metric icon={CheckCircle2} value="78,4%" label="Cobertura estimada" detail="Demo" color="#2d8b72" /><Metric icon={AlertCircle} value="24" label="Brechas abiertas" detail="6 prioritarias" color="#d08a31" /><Metric icon={Workflow} value="9" label="Brechas recurrentes" detail="Demo" color="#7958c9" /><Metric icon={FileCheck2} value="67" label="Piezas publicadas" detail="Demo" color="#3461db" /></div><div className="two-col"><Panel title="Temas con mayor demanda"><BarRows items={[['Baja de equipos', 86], ['Accesos y credenciales', 71], ['Compras y proveedores', 54], ['Procedimientos financieros', 39]]} /></Panel><Panel title="Áreas con brechas"><BarRows items={[['TI', 72], ['Finanzas', 48], ['RRHH', 36], ['Operaciones', 29]]} /></Panel></div></>;
}

function Analytics() {
  return <><PageHeader page="analytics" demo /><div className="metric-grid four"><Metric icon={MessageCircle} value="324" label="Consultas esta semana" detail="Demo" color="#3461db" /><Metric icon={CheckCircle2} value="247" label="Respondidas" detail="76,2%" color="#2d8b72" /><Metric icon={AlertCircle} value="61" label="Insuficientes" detail="18,8%" color="#d08a31" /><Metric icon={FileCheck2} value="12" label="Conocimiento recuperado" detail="Demo" color="#7958c9" /></div><div className="two-col"><Panel title="Consultas por día"><div className="chart-bars">{[['Lun',54],['Mar',72],['Mié',63],['Jue',88],['Vie',76],['Sáb',34],['Dom',28]].map(([day, value]) => <div className="chart-column" key={day}><span style={{ height: `${value}%` }} /><small>{day}</small></div>)}</div></Panel><Panel title="Principales categorías"><BarRows items={[['TI y soporte', 42], ['RRHH', 25], ['Finanzas', 18], ['Operaciones', 15]]} /></Panel></div><div className="impact-card"><Sparkles size={20} /><div><p className="eyebrow">Impacto del conocimiento recuperado</p><h2>12 consultas posteriores pudieron responderse con conocimiento recuperado y publicado.</h2><p>Indicadores sintéticos para ilustrar la experiencia aprobada.</p></div></div></>;
}

export function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedGapId, setSelectedGapId] = useState('');
  const content = useMemo(() => ({
    dashboard: <Dashboard goTo={setPage} />, assistant: <><PageHeader page="assistant" /><ChatTest onOpenGap={(id) => { setSelectedGapId(id); setPage('operations'); }} /></>,
    sources: <Sources />, operations: <><PageHeader page="operations" /><KnowledgeOperationsTest initialGapId={selectedGapId} /></>, health: <Health />, analytics: <Analytics />,
  })[page], [page, selectedGapId]);

  return <div className="app-shell"><aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}><div className="brand"><div className="brand-mark">N</div><div><strong>NEXA</strong><span>Organizational Knowledge<br />Intelligence</span></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X size={18} /></button></div><nav aria-label="Navegación principal">{nav.map(([key, Icon]) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => { setPage(key); setMenuOpen(false); }}><Icon size={17} /><span>{pages[key].label}</span>{page === key && <ChevronRight className="nav-arrow" size={14} />}</button>)}</nav><div className="sidebar-bottom"><div className="org-avatar">ED</div><div><strong>Empresa Demo</strong><span>Entorno de demostración</span></div><Settings2 size={16} /></div></aside>{menuOpen && <button className="mobile-overlay" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}<div className="main-area"><header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button><span className="topbar-title">{pages[page].label}</span><div className="topbar-actions"><div className="search-button"><Search size={16} /><span>Buscar en NEXA</span><kbd>Ctrl K</kbd></div><Bell size={18} /><div className="avatar">JD</div></div></header><main className="content">{content}</main></div></div>;
}
