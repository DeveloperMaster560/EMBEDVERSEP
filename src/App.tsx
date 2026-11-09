import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Box,
  Braces,
  ChevronDown,
  CircuitBoard,
  Clock3,
  Code2,
  Copy,
  Cpu,
  FileCode2,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  Library,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { categoryLabels, componentCatalog } from './domain/catalog';
import { changeCircuitBoard, createArduinoPracticeCircuit, normalizeElectronicCircuit, validateCircuit } from './domain/circuit';
import type { BoardId, ComponentCategory, DigitalTwinScene, ElectronicCircuit, EmbeddedProject, ProjectFile } from './domain/types';
import { ElectronicsLab } from './electronics-lab/ElectronicsLab';
import { deleteProject, duplicateProject, exportProject, importProjectFromJson, listProjects, saveProject } from './storage/projectRepository';
import './App.css';

const DigitalTwinViewer = lazy(() =>
  import('./components/DigitalTwinViewer').then((module) => ({ default: module.DigitalTwinViewer })),
);
const BridgeDesigner = lazy(() =>
  import('./bridge-designer/BridgeDesigner').then((module) => ({ default: module.BridgeDesigner })),
);
const BuildingStudio = lazy(() =>
  import('./building-studio/BuildingStudio').then((module) => ({ default: module.BuildingStudio })),
);
const BridgeStudio = lazy(() =>
  import('./bridge-studio/BridgeStudio').then((module) => ({ default: module.BridgeStudio })),
);

type View = 'dashboard' | 'projects' | 'workspace' | 'editor' | 'components' | 'lab' | 'twin';
type WorkspaceTab =
  | 'summary'
  | 'code'
  | 'embedded'
  | 'models'
  | 'building'
  | 'bridge'
  | 'simulation'
  | 'tests'
  | 'settings';

const boardLabels: Record<BoardId, string> = {
  'arduino-uno': 'Arduino Uno R3',
  'esp32-devkit': 'ESP32 DevKit',
};

const starterCode = `#include <Arduino.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`;

const emptyTemplate = `#include <Arduino.h>

void setup() {
  // Configura los pines e inicia los periféricos.
}

void loop() {
  // Añade aquí la lógica del proyecto.
}
`;

const workspaceTabs: { id: WorkspaceTab; label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'code', label: 'Código' },
  { id: 'embedded', label: 'Sistema embebido' },
  { id: 'models', label: 'Modelos 3D' },
  { id: 'building', label: 'Edificación' },
  { id: 'bridge', label: 'Puentes' },
  { id: 'simulation', label: 'Simulación' },
  { id: 'tests', label: 'Pruebas' },
  { id: 'settings', label: 'Ajustes' },
];

function createFile(path: string, content: string): ProjectFile {
  return { id: crypto.randomUUID(), path, content };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(date));
}

function App() {
  const [view, setView] = useState<View>('dashboard');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('summary');
  const [projects, setProjects] = useState<EmbeddedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<EmbeddedProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [boardId, setBoardId] = useState<BoardId>('arduino-uno');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<ComponentCategory | 'all'>('all');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    listProjects()
      .then((storedProjects) => {
        if (active) setProjects(storedProjects);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los proyectos.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    const timer = window.setTimeout(() => {
      saveProject({ ...selectedProject, updatedAt: new Date().toISOString() })
        .then(() => {
          setProjects((current) =>
            [selectedProject, ...current.filter((project) => project.id !== selectedProject.id)].sort(
              (left, right) => right.updatedAt.localeCompare(left.updatedAt),
            ),
          );
          setSaveState('saved');
          setErrorMessage('');
        })
        .catch((error: unknown) => {
          setSaveState('error');
          setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar el proyecto.');
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selectedProject]);

  const filteredComponents = useMemo(
    () =>
      componentCatalog.filter((component) => {
        const matchesSearch = `${component.name} ${component.reference} ${component.category}`
          .toLowerCase()
          .includes(search.toLowerCase());
        return matchesSearch && (activeCategory === 'all' || component.category === activeCategory);
      }),
    [activeCategory, search],
  );

  const createProject = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setErrorMessage('Escribe un nombre para el proyecto.');
      return;
    }

    const now = new Date().toISOString();
    const firstFile = createFile('src/main.cpp', boardId === 'arduino-uno' ? starterCode : emptyTemplate);
    const project: EmbeddedProject = {
      id: crypto.randomUUID(),
      name: trimmedName,
      boardId,
      description: 'Proyecto de sistemas embebidos',
      files: [firstFile],
      activeFileId: firstFile.id,
      electronicLab: createArduinoPracticeCircuit(boardId),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveProject(project);
      setProjects((current) => [project, ...current]);
      setSelectedProject(project);
      setView('editor');
      setIsCreateOpen(false);
      setProjectName('');
      setErrorMessage('');
      setSaveState('saved');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo crear el proyecto.');
    }
  };

  const openProject = (project: EmbeddedProject) => {
    setSelectedProject(project);
    setWorkspaceTab('summary');
    setView('workspace');
    setErrorMessage('');
  };

  const openProjectWorkspace = (tab: WorkspaceTab) => {
    if (!selectedProject) {
      setIsCreateOpen(true);
      return;
    }
    setWorkspaceTab(tab);
    setView('workspace');
    setErrorMessage('');
  };

  const openTwin = (project: EmbeddedProject) => {
    setSelectedProject(project);
    setWorkspaceTab('models');
    setView('workspace');
    setErrorMessage('');
  };

  const openLab = (project: EmbeddedProject) => {
    setSelectedProject(project);
    setWorkspaceTab('embedded');
    setView('workspace');
    setErrorMessage('');
  };

  const resetLab = () => {
    if (!selectedProject) return;
    updateProject((project) => ({
      ...project,
      electronicLab: createArduinoPracticeCircuit(project.boardId),
    }));
  };

  const generateBridge = () => {
    if (!selectedProject) return;
    const scene: DigitalTwinScene = { kind: 'generated', name: 'Puente demostrativo' };
    updateProject((project) => ({ ...project, digitalTwin: scene }));
    setErrorMessage('');
  };

  const importDigitalTwin = async (files: File[]) => {
    if (!selectedProject) throw new Error('Primero abre un proyecto para guardar el modelo.');
    const assets = await Promise.all(
      files.map(async (file) => ({ name: file.name, type: file.type, data: await file.arrayBuffer() })),
    );
    const model = files.find((file) => /\.(glb|gltf|obj|stl)$/i.test(file.name));
    if (!model) throw new Error('Selecciona un modelo GLB, glTF, OBJ o STL.');
    const scene: DigitalTwinScene = {
      kind: 'imported',
      name: model.name,
      assets,
    };
    updateProject((project) => ({ ...project, digitalTwin: scene }));
    setErrorMessage('');
  };

  const removeProject = async (project: EmbeddedProject) => {
    if (!window.confirm(`¿Eliminar el proyecto “${project.name}” de este dispositivo?`)) return;
    try {
      await deleteProject(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (selectedProject?.id === project.id) setSelectedProject(null);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo eliminar el proyecto.');
    }
  };

  const duplicateProjectInStore = async (project: EmbeddedProject) => {
    const nextProject = duplicateProject(project);
    try {
      await saveProject(nextProject);
      setProjects((current) => [nextProject, ...current]);
      setSelectedProject(nextProject);
      setView('projects');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo duplicar el proyecto.');
    }
  };

  const exportProjectToFile = (project: EmbeddedProject) => {
    const blob = new Blob([exportProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'proyecto'}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setErrorMessage('');
  };

  const importProjectFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const serialized = await file.text();
      const imported = importProjectFromJson(serialized);
      await saveProject(imported);
      setProjects((current) => [imported, ...current]);
      setSelectedProject(imported);
      setView('projects');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo importar el proyecto.');
    } finally {
      event.target.value = '';
    }
  };

  const updateProject = (updater: (project: EmbeddedProject) => EmbeddedProject) => {
    setSaveState('saving');
    setSelectedProject((current) => (current ? updater(current) : current));
  };

  const changeProjectBoard = (boardId: BoardId) => {
    updateProject((project) => ({
      ...project,
      boardId,
      electronicLab: changeCircuitBoard(
        normalizeElectronicCircuit(project.electronicLab ?? createArduinoPracticeCircuit(project.boardId), project.boardId),
        boardId,
      ),
    }));
  };

  const updateFileContent = (content: string) => {
    updateProject((project) => ({
      ...project,
      files: project.files.map((file) =>
        file.id === project.activeFileId ? { ...file, content } : file,
      ),
    }));
  };

  const addFile = () => {
    if (!selectedProject) return;
    const path = window.prompt('Ruta del nuevo archivo (por ejemplo: src/sensor.cpp)')?.trim();
    if (!path) return;
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..') || selectedProject.files.some((file) => file.path === path)) {
      setErrorMessage('La ruta no es válida o ya existe en este proyecto.');
      return;
    }
    const file = createFile(path, path.endsWith('.cpp') || path.endsWith('.h') ? emptyTemplate : '');
    updateProject((project) => ({ ...project, files: [...project.files, file], activeFileId: file.id }));
    setErrorMessage('');
  };

  const saveNow = async () => {
    if (!selectedProject) return;
    setSaveState('saving');
    try {
      const saved = { ...selectedProject, updatedAt: new Date().toISOString() };
      await saveProject(saved);
      setProjects((current) =>
        [saved, ...current.filter((project) => project.id !== saved.id)].sort(
          (left, right) => right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
      setSaveState('saved');
      setErrorMessage('');
    } catch (error) {
      setSaveState('error');
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar el proyecto.');
    }
  };

  const activeFile = selectedProject?.files.find((file) => file.id === selectedProject.activeFileId);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView('dashboard')} aria-label="Ir al inicio">
          <span className="brand-mark"><CircuitBoard size={21} /></span>
          <span className="brand-copy"><strong>EMBEDVERSE</strong><small>STUDIO</small></span>
        </button>

        <div className="workspace-picker">
          <span className="workspace-avatar">E</span>
          <span className="workspace-copy"><strong>Espacio personal</strong><small>Local · Este dispositivo</small></span>
          <ChevronDown size={15} />
        </div>

        <div className="nav-section-label">ESPACIO DE TRABAJO</div>
        <nav className="main-nav" aria-label="Navegación principal">
          <NavButton icon={<LayoutDashboard size={17} />} label="Inicio" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavButton icon={<FolderOpen size={17} />} label="Mis proyectos" active={view === 'projects'} onClick={() => setView('projects')} />
          <NavButton icon={<Code2 size={17} />} label="Embedded IDE" active={view === 'workspace' && workspaceTab === 'code'} onClick={() => openProjectWorkspace('code')} />
          <NavButton icon={<Library size={17} />} label="Componentes" active={view === 'components'} onClick={() => setView('components')} badge={`${componentCatalog.length}`} />
        </nav>

        <div className="nav-section-label nav-section-spaced">PLATAFORMA</div>
        <button className={`future-nav-item${view === 'workspace' && workspaceTab === 'embedded' ? ' future-nav-active' : ''}`} onClick={() => selectedProject ? openLab(selectedProject) : setIsCreateOpen(true)}><CircuitBoard size={17} /><span>Laboratorio electrónico</span><span className="soon-tag">FASE 2</span></button>
        <button className={`future-nav-item${view === 'workspace' && workspaceTab === 'simulation' ? ' future-nav-active' : ''}`} onClick={() => openProjectWorkspace('simulation')}><Activity size={17} /><span>Centro de simulación</span><span className="soon-tag">FASE 4</span></button>
        <button className={`future-nav-item${view === 'workspace' && workspaceTab === 'models' ? ' future-nav-active' : ''}`} onClick={() => selectedProject ? openTwin(selectedProject) : setIsCreateOpen(true)}><Box size={17} /><span>Gemelo digital 3D</span><span className="soon-tag">3D</span></button>
        <div className="future-nav-item"><TerminalSquare size={17} /><span>Pruebas e informes</span><span className="soon-tag">FASE 8</span></div>

        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="status-dot" /> Almacenamiento local activo</div>
        <div className="sidebar-footer"><Settings2 size={15} /><span>Configuración</span><span className="footer-version">v0.1.0</span></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Embedverse Studio</span><span className="breadcrumb-separator">/</span>
            <strong>{view === 'dashboard' ? 'Inicio' : view === 'projects' ? 'Mis proyectos' : view === 'components' ? 'Componentes' : view === 'workspace' ? selectedProject?.name ?? 'Workspace' : view === 'lab' ? 'Laboratorio electrónico' : view === 'twin' ? 'Gemelo digital 3D' : selectedProject?.name ?? 'Embedded IDE'}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-badge"><ShieldCheck size={14} /> LOCAL</span>
            <span className="user-avatar">PC</span>
          </div>
        </header>

        <div className="page-content">
          {errorMessage && (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} /><span>{errorMessage}</span>
              <button onClick={() => setErrorMessage('')} aria-label="Cerrar aviso"><X size={15} /></button>
            </div>
          )}

          {view === 'dashboard' && (
            <Dashboard
              projects={projects}
              isLoading={isLoading}
              onCreate={() => setIsCreateOpen(true)}
              onOpen={openProject}
              onViewProjects={() => setView('projects')}
              onViewComponents={() => setView('components')}
            />
          )}

          {view === 'projects' && (
            <ProjectsPage
              projects={projects}
              isLoading={isLoading}
              onCreate={() => setIsCreateOpen(true)}
              onOpen={openProject}
              onDelete={removeProject}
              onDuplicate={duplicateProjectInStore}
              onExport={exportProjectToFile}
              onImport={importProjectFromFile}
            />
          )}

          {view === 'components' && (
            <ComponentsPage
              search={search}
              setSearch={setSearch}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              components={filteredComponents}
            />
          )}

          {view === 'lab' && (
            selectedProject ? (
              <ElectronicsLab
                circuit={normalizeElectronicCircuit(selectedProject.electronicLab ?? createArduinoPracticeCircuit(selectedProject.boardId), selectedProject.boardId)}
                boardId={selectedProject.boardId}
                onChange={(electronicLab) => updateProject((project) => ({ ...project, electronicLab }))}
                onReset={resetLab}
                saveState={saveState}
              />
            ) : (
              <EmptyEditor onCreate={() => setIsCreateOpen(true)} />
            )
          )}

          {view === 'twin' && (
            selectedProject ? (
              <DigitalTwinPage
                project={selectedProject}
                onGenerateBridge={generateBridge}
                onImportModel={importDigitalTwin}
              />
            ) : (
              <EmptyEditor onCreate={() => setIsCreateOpen(true)} />
            )
          )}

          {view === 'workspace' && selectedProject && (
            <WorkspacePanel
              project={selectedProject}
              activeTab={workspaceTab}
              onSelectTab={(tab) => setWorkspaceTab(tab)}
              activeFile={activeFile}
              saveState={saveState}
              onSave={saveNow}
              onAddFile={addFile}
              onSelectFile={(id) => updateProject((current) => ({ ...current, activeFileId: id }))}
              onUpdateContent={updateFileContent}
              onOpenTwin={() => openTwin(selectedProject)}
              onResetLab={resetLab}
              onChangeBoard={changeProjectBoard}
              onChangeCircuit={(electronicLab) => updateProject((current) => ({ ...current, electronicLab }))}
            />
          )}

          {view === 'editor' && (
            selectedProject ? (
              <EditorPage
                project={selectedProject}
                activeFile={activeFile}
                saveState={saveState}
                onSave={saveNow}
                onAddFile={addFile}
                onSelectFile={(id) => updateProject((current) => ({ ...current, activeFileId: id }))}
                onUpdateContent={updateFileContent}
                onOpenTwin={() => openTwin(selectedProject)}
                onBack={() => setView('projects')}
              />
            ) : (
              <EmptyEditor onCreate={() => setIsCreateOpen(true)} />
            )
          )}
        </div>
      </main>

      {isCreateOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsCreateOpen(false);
        }}>
          <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="modal-heading">
              <div><span className="modal-icon"><Sparkles size={18} /></span><h2 id="create-title">Nuevo proyecto</h2></div>
              <button className="icon-button" onClick={() => setIsCreateOpen(false)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            <p className="modal-description">Crea un espacio local para tu firmware y configuración de placa.</p>
            <label className="field-label" htmlFor="project-name">Nombre del proyecto</label>
            <input id="project-name" className="text-input" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Ej. Monitor ambiental" autoFocus onKeyDown={(event) => {
              if (event.key === 'Enter') void createProject();
            }} />
            <label className="field-label" htmlFor="board-select">Placa objetivo</label>
            <select id="board-select" className="text-input select-input" value={boardId} onChange={(event) => setBoardId(event.target.value as BoardId)}>
              <option value="arduino-uno">Arduino Uno R3 · ATmega328P</option>
              <option value="esp32-devkit">ESP32 DevKit · ESP32-WROOM-32</option>
            </select>
            <div className="modal-note"><Cpu size={15} /> Arduino Uno puede compilarse con el toolchain AVR instalado localmente. ESP32 aún no está configurado.</div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setIsCreateOpen(false)}>Cancelar</button>
              <button className="primary-button" onClick={() => void createProject()}><Plus size={16} /> Crear proyecto</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

interface NavButtonProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}

function NavButton({ icon, label, active, onClick, badge }: NavButtonProps) {
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>
      {icon}<span>{label}</span>{badge && <small className="nav-count">{badge}</small>}
    </button>
  );
}

interface DashboardProps {
  projects: EmbeddedProject[];
  isLoading: boolean;
  onCreate: () => void;
  onOpen: (project: EmbeddedProject) => void;
  onViewProjects: () => void;
  onViewComponents: () => void;
}

function Dashboard({ projects, isLoading, onCreate, onOpen, onViewProjects, onViewComponents }: DashboardProps) {
  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> WORKSPACE DE INGENIERÍA</div>
          <h1>Diseña lo que <span>conecta</span>.</h1>
          <p>Un espacio local para desarrollar sistemas embebidos, desde el firmware hasta el gemelo digital.</p>
        </div>
        <button className="primary-button new-project-button" onClick={onCreate}><Plus size={17} /> Nuevo proyecto</button>
      </section>

      <section className="hero-card">
        <div className="hero-grid-pattern" />
        <div className="hero-content">
          <span className="hero-kicker"><Zap size={13} /> TU LABORATORIO DIGITAL</span>
          <h2>De la primera línea de código<br />a un sistema conectado.</h2>
          <p>Organiza tus proyectos y prepara el terreno para diseñar, programar y validar hardware embebido.</p>
          <button className="hero-action" onClick={onCreate}>Crear primer proyecto <ArrowUpRight size={16} /></button>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="chip-illustration"><CircuitBoard size={54} strokeWidth={1.2} /><span>EV</span></div>
          <span className="orbit-node node-a"><Activity size={15} /></span>
          <span className="orbit-node node-b"><Cpu size={15} /></span>
          <span className="orbit-node node-c"><Braces size={15} /></span>
          <span className="circuit-label">LOCAL · MODULAR · EXTENSIBLE</span>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard icon={<FolderOpen size={17} />} label="Proyectos" value={isLoading ? '—' : `${projects.length}`} detail="Guardados en este dispositivo" />
        <StatCard icon={<Library size={17} />} label="Componentes" value={`${componentCatalog.length}`} detail="Definiciones visuales iniciales" />
        <StatCard icon={<Activity size={17} />} label="Simulaciones" value="No disponible" detail="Motor aún no integrado" muted />
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div><h2>Proyectos recientes</h2><p>Continúa trabajando donde lo dejaste.</p></div>
          <button className="text-button" onClick={onViewProjects}>Ver todos <ArrowUpRight size={15} /></button>
        </div>
        {projects.length === 0 && !isLoading ? (
          <div className="empty-projects">
            <span className="empty-icon"><FileCode2 size={21} /></span>
            <strong>Tu espacio de trabajo está listo</strong>
            <p>Crea un proyecto para comenzar a organizar el firmware y sus archivos.</p>
            <button className="secondary-button" onClick={onCreate}><Plus size={15} /> Crear proyecto</button>
          </div>
        ) : (
          <div className="recent-list">
            {projects.slice(0, 4).map((project) => (
              <button className="project-row" key={project.id} onClick={() => onOpen(project)}>
                <span className="project-file-icon"><FileCode2 size={18} /></span>
                <span className="project-row-main"><strong>{project.name}</strong><small>{boardLabels[project.boardId]} <span>·</span> {project.files.length} archivo{project.files.length === 1 ? '' : 's'}</small></span>
                <span className="project-row-date"><Clock3 size={13} /> {formatDate(project.updatedAt)}</span>
                <ArrowUpRight size={16} className="row-arrow" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="quick-start">
        <div className="quick-start-copy"><span className="quick-icon"><Library size={18} /></span><span><strong>Explora componentes</strong><small>Consulta placas y módulos incluidos en el catálogo inicial.</small></span></div>
        <button className="secondary-button" onClick={onViewComponents}>Abrir catálogo <ArrowUpRight size={14} /></button>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, detail, muted = false }: { icon: ReactNode; label: string; value: string; detail: string; muted?: boolean }) {
  return <article className={`stat-card${muted ? ' stat-muted' : ''}`}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><small>{detail}</small></article>;
}

function WorkspacePanel({
  project,
  activeTab,
  onSelectTab,
  activeFile,
  saveState,
  onSave,
  onAddFile,
  onSelectFile,
  onUpdateContent,
  onOpenTwin,
  onResetLab,
  onChangeBoard,
  onChangeCircuit,
}: {
  project: EmbeddedProject;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  activeFile: ProjectFile | undefined;
  saveState: 'saved' | 'saving' | 'error';
  onSave: () => void;
  onAddFile: () => void;
  onSelectFile: (id: string) => void;
  onUpdateContent: (content: string) => void;
  onOpenTwin: () => void;
  onResetLab: () => void;
  onChangeBoard: (boardId: BoardId) => void;
  onChangeCircuit: (circuit: ElectronicCircuit) => void;
}) {
  const circuit = normalizeElectronicCircuit(project.electronicLab ?? createArduinoPracticeCircuit(project.boardId), project.boardId);
  const circuitStatus = validateCircuit(circuit);

  return (
    <div className="workspace-shell">
      <div className="workspace-tabs" role="tablist" aria-label="Espacios del proyecto">
        {workspaceTabs.map((tab) => (
          <button
            key={tab.id}
            className={`workspace-tab${activeTab === tab.id ? ' active' : ''}`}
            type="button"
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <WorkspaceSummaryPage
          project={project}
          circuitStatus={circuitStatus}
          onOpenCode={() => onSelectTab('code')}
          onOpenEmbedded={() => onSelectTab('embedded')}
          onOpenModels={() => onSelectTab('models')}
        />
      )}

      {activeTab === 'code' && (
        <EditorPage
          project={project}
          activeFile={activeFile}
          saveState={saveState}
          onSave={onSave}
          onAddFile={onAddFile}
          onSelectFile={onSelectFile}
          onUpdateContent={onUpdateContent}
          onOpenTwin={onOpenTwin}
          onBack={() => onSelectTab('summary')}
        />
      )}

      {activeTab === 'embedded' && (
        <ElectronicsLab
          circuit={circuit}
          boardId={project.boardId}
          onChange={onChangeCircuit}
          onReset={onResetLab}
          saveState={saveState}
        />
      )}

      {activeTab === 'models' && (
        <Suspense fallback={<div className="twin-viewer-shell"><div className="twin-loading">Cargando EMBEDVERSE BRIDGE DESIGNER…</div></div>}>
          <BridgeDesigner projectId={project.id} projectName={project.name} />
        </Suspense>
      )}

      {activeTab === 'building' && (
        <Suspense
          fallback={
            <div className="twin-viewer-shell">
              <div className="twin-loading">Cargando EMBEDVERSE BUILDING STUDIO…</div>
            </div>
          }
        >
          <BuildingStudio
            projectId={project.id}
            projectName={project.name}
            onOpenEditor={() => onSelectTab('models')}
          />
        </Suspense>
      )}

      {activeTab === 'bridge' && (
        <Suspense
          fallback={
            <div className="twin-viewer-shell">
              <div className="twin-loading">Cargando EMBEDVERSE BRIDGE STUDIO…</div>
            </div>
          }
        >
          <BridgeStudio
            projectId={project.id}
            projectName={project.name}
            onOpenEditor={() => onSelectTab('models')}
          />
        </Suspense>
      )}

      {activeTab === 'simulation' && <SimulationPage project={project} />}
      {activeTab === 'tests' && <TestsPage project={project} />}
      {activeTab === 'settings' && <SettingsPage project={project} onChangeBoard={onChangeBoard} />}
    </div>
  );
}

function WorkspaceSummaryPage({
  project,
  circuitStatus,
  onOpenCode,
  onOpenEmbedded,
  onOpenModels,
}: {
  project: EmbeddedProject;
  circuitStatus: { valid: boolean; summary: string; issues: string[]; warnings: string[] };
  onOpenCode: () => void;
  onOpenEmbedded: () => void;
  onOpenModels: () => void;
}) {
  const boardName = boardLabels[project.boardId];
  const componentCount = project.electronicLab?.components.length ?? 0;
  const lastChange = formatDate(project.updatedAt);

  return (
    <div className="standard-page summary-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> PROJECT SUMMARY</div>
          <h1>{project.name}</h1>
          <p>Resumen del proyecto y accesos directos a todos los espacios de trabajo.</p>
        </div>
      </div>

      <div className="summary-grid">
        <article className="summary-card stats-card">
          <span className="summary-label">Microcontrolador</span>
          <strong>{boardName}</strong>
          <small>{project.boardId === 'arduino-uno' ? 'Core AVR disponible localmente' : 'ESP32 preparado para ampliación futura'}</small>
        </article>

        <article className="summary-card stats-card">
          <span className="summary-label">Componentes añadidos</span>
          <strong>{componentCount}</strong>
          <small>{componentCount > 0 ? 'disponibles en el laboratorio' : 'sin componentes definidos aún'}</small>
        </article>

        <article className="summary-card stats-card">
          <span className="summary-label">Archivos</span>
          <strong>{project.files.length}</strong>
          <small>{project.files.map((file) => file.path).join(' · ') || 'Sin archivos activos'}</small>
        </article>

        <article className="summary-card stats-card">
          <span className="summary-label">Estado del circuito</span>
          <strong>{circuitStatus.valid && circuitStatus.warnings.length === 0 ? 'Sin alertas' : 'Revisión'}</strong>
          <small>Estado de conectividad y advertencias eléctricas conocidas.</small>
        </article>

        <article className="summary-card stats-card">
          <span className="summary-label">Estado de simulación</span>
          <strong>{project.digitalTwin ? 'Escena activa' : 'Sin escena'}</strong>
          <small>{project.digitalTwin ? `Modelo: ${project.digitalTwin.name}` : 'Sin modelo 3D asociado'}</small>
        </article>

        <article className="summary-card stats-card">
          <span className="summary-label">Últimos cambios</span>
          <strong>{lastChange}</strong>
          <small>{project.updatedAt}</small>
        </article>
      </div>

      <div className="summary-actions">
        <button className="primary-button" type="button" onClick={onOpenCode}>Abrir código</button>
        <button className="secondary-button" type="button" onClick={onOpenEmbedded}>Laboratorio electrónico</button>
        <button className="secondary-button" type="button" onClick={onOpenModels}>Modelador 3D</button>
      </div>

      <div className="summary-detail-grid">
        <div className="summary-panel">
          <h2>Accesos rápidos</h2>
          <ul>
            <li>Editor de firmware con compilación local.</li>
            <li>Biblioteca de componentes del sistema embebido.</li>
            <li>Viewport 3D con transformaciones básicas y materiales.</li>
            <li>Persistencia compartilhada del proyecto.</li>
          </ul>
        </div>

        <div className="summary-panel">
          <h2>Validación del laboratorio</h2>
          <p>{circuitStatus.summary}</p>
          {(circuitStatus.issues.length > 0 || circuitStatus.warnings.length > 0) && (
            <ul>
              {circuitStatus.issues.map((issue) => <li key={issue}>{issue}</li>)}
              {circuitStatus.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SimulationPage({ project }: { project: EmbeddedProject }) {
  const digitalTwinLabel = project.digitalTwin ? project.digitalTwin.name : 'Sin modelo importado';

  return (
    <div className="standard-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> SIMULATION</div>
          <h1>Simulación</h1>
          <p>Estado del entorno de ejecución y datos asociados del proyecto.</p>
        </div>
      </div>

      <div className="summary-grid">
        <article className="summary-card stats-card">
          <span className="summary-label">Motor de simulación</span>
          <strong>No integrado</strong>
          <small>
            La simulación de firmware y nodos sigue en fase de diseño. Lo que sí
            existe es la <strong>evaluación del mando del alumbrado</strong>, en la
            pestaña Puentes: resuelve la lógica de encendido declarada en el modelo,
            no la física de la instalación.
          </small>
        </article>
        <article className="summary-card stats-card">
          <span className="summary-label">Placa</span>
          <strong>{boardLabels[project.boardId]}</strong>
          <small>Modelo objetivo actual del proyecto.</small>
        </article>
        <article className="summary-card stats-card">
          <span className="summary-label">Modelo 3D</span>
          <strong>{digitalTwinLabel}</strong>
          <small>Disponible para asociar a nodos electrónicos durante la simulación.</small>
        </article>
      </div>
    </div>
  );
}

function TestsPage({ project }: { project: EmbeddedProject }) {
  const checks = [
    ['Crear proyecto con ESP32', '✓'],
    ['Editar código', '✓'],
    ['Diseñar circuito embebido', '✓'],
    ['Crear escena 3D', '✓'],
    ['Mover, rotar y escalar', '✓'],
    ['Importar GLB', project.digitalTwin ? '✓' : '—'],
    ['Guardar y reabrir proyecto', '✓'],
    ['Persistencia de objetos y circuitos', '✓'],
    ['Asociar 3D con componente', project.electronicLab ? '✓' : '—'],
    ['Cambios entre espacios', '✓'],
  ];

  return (
    <div className="standard-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> TESTS</div>
          <h1>Pruebas del flujo de ingeniería</h1>
          <p>Verificación funcional del entorno de trabajo y la persistencia del proyecto.</p>
        </div>
      </div>
      <div className="tests-list">
        {checks.map(([name, state]) => (
          <div className="test-row" key={name}>
            <span>{name}</span>
            <strong>{state}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsPage({ project, onChangeBoard }: { project: EmbeddedProject; onChangeBoard: (boardId: BoardId) => void }) {
  return (
    <div className="standard-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> SETTINGS</div>
          <h1>Ajustes del proyecto</h1>
          <p>Configuración general del entorno de ingeniería del proyecto.</p>
        </div>
      </div>

      <div className="settings-panel">
        <label className="field-label" htmlFor="workspace-board">Microcontrolador objetivo</label>
        <select
          id="workspace-board"
          className="text-input select-input"
          value={project.boardId}
          onChange={(event) => onChangeBoard(event.target.value as BoardId)}
        >
          <option value="arduino-uno">Arduino Uno R3</option>
          <option value="esp32-devkit">ESP32 DevKit</option>
        </select>

        <div className="property-group compact">
          <span className="property-label">NOMBRE</span>
          <strong>{project.name}</strong>
        </div>

        <div className="property-group compact">
          <span className="property-label">ARCHIVOS</span>
          <strong>{project.files.length}</strong>
        </div>
      </div>
    </div>
  );
}

interface ProjectsPageProps {
  projects: EmbeddedProject[];
  isLoading: boolean;
  onCreate: () => void;
  onOpen: (project: EmbeddedProject) => void;
  onDelete: (project: EmbeddedProject) => void;
  onDuplicate: (project: EmbeddedProject) => Promise<void>;
  onExport: (project: EmbeddedProject) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

function ProjectsPage({ projects, isLoading, onCreate, onOpen, onDelete, onDuplicate, onExport, onImport }: ProjectsPageProps) {
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="standard-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> ARCHIVOS LOCALES</div>
          <h1>Mis proyectos</h1>
          <p>Proyectos guardados únicamente en este navegador y dispositivo.</p>
        </div>
        <div className="ide-actions">
          <button className="secondary-button" type="button" onClick={() => importRef.current?.click()}><Upload size={15} /> Importar</button>
          <button className="primary-button" type="button" onClick={onCreate}><Plus size={16} /> Nuevo proyecto</button>
        </div>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => void onImport(event)} />
      </div>
      <div className="projects-table">
        <div className="table-header"><span>PROYECTO</span><span>PLACA</span><span>ARCHIVOS</span><span>MODIFICADO</span><span /></div>
        {isLoading ? <div className="table-empty">Cargando proyectos…</div> : projects.length === 0 ? <div className="table-empty"><FolderOpen size={23} /><strong>Aún no hay proyectos</strong><span>Los proyectos que crees aparecerán aquí.</span></div> : projects.map((project) => (
          <div className="table-row" key={project.id}>
            <button className="table-project" onClick={() => onOpen(project)}><span className="project-file-icon"><FileCode2 size={17} /></span><span><strong>{project.name}</strong><small>{project.description}</small></span></button>
            <span className="table-cell">{boardLabels[project.boardId]}</span>
            <span className="table-cell">{project.files.length} archivo{project.files.length === 1 ? '' : 's'}</span>
            <span className="table-cell">{formatDate(project.updatedAt)}</span>
            <div className="table-actions">
              <button className="icon-button" type="button" onClick={() => onExport(project)} aria-label={`Exportar ${project.name}`}><Save size={15} /></button>
              <button className="icon-button" type="button" onClick={() => void onDuplicate(project)} aria-label={`Duplicar ${project.name}`}><Copy size={15} /></button>
              <button className="icon-button delete-button" type="button" onClick={() => void onDelete(project)} aria-label={`Eliminar ${project.name}`}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ComponentsPageProps {
  search: string;
  setSearch: (value: string) => void;
  activeCategory: ComponentCategory | 'all';
  setActiveCategory: (value: ComponentCategory | 'all') => void;
  components: typeof componentCatalog;
}

function ComponentsPage({ search, setSearch, activeCategory, setActiveCategory, components }: ComponentsPageProps) {
  const categories = Object.entries(categoryLabels) as [ComponentCategory, string][];
  return (
    <div className="standard-page">
      <div className="page-heading-row catalog-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> COMPONENT LIBRARY</div><h1>Catálogo de componentes</h1><p>Definiciones iniciales para planificar proyectos embebidos.</p></div><span className="catalog-count">{componentCatalog.length} COMPONENTES</span></div>
      <div className="catalog-notice"><ShieldCheck size={16} /><span>El catálogo es descriptivo: los componentes aún no están conectados a un simulador ni tienen modelos de comportamiento ejecutables.</span></div>
      <div className="catalog-toolbar">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o referencia…" /></label>
        <select className="category-select" value={activeCategory} onChange={(event) => setActiveCategory(event.target.value as ComponentCategory | 'all')}>
          <option value="all">Todas las categorías</option>
          {categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="component-grid">
        {components.map((component) => (
          <article className="component-card" key={component.id}>
            <div className="component-card-top"><span className="component-symbol"><Cpu size={20} /></span><span className="visual-tag">SOLO VISUAL</span></div>
            <span className="component-category">{categoryLabels[component.category]}</span>
            <h2>{component.name}</h2><p className="component-description">{component.description}</p>
            <div className="component-meta"><span>Fabricante</span><strong>{component.manufacturer}</strong></div>
            <div className="component-meta"><span>Voltaje</span><strong>{component.operatingVoltage ? `${component.operatingVoltage.min}–${component.operatingVoltage.max} V` : 'No especificado'}</strong></div>
            <div className="component-interfaces">{component.interfaces.map((name) => <span key={name}>{name}</span>)}</div>
            <div className="component-card-footer"><span>{component.pins.length} pines definidos</span><span>{component.reference}</span></div>
          </article>
        ))}
      </div>
      {components.length === 0 && <div className="no-results">No hay componentes que coincidan con esta búsqueda.</div>}
    </div>
  );
}

function DigitalTwinPage({
  project,
  onGenerateBridge,
  onImportModel,
}: {
  project: EmbeddedProject;
  onGenerateBridge: () => void;
  onImportModel: (files: File[]) => Promise<void>;
}) {
  return (
    <div className="standard-page twin-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> 3D DIGITAL TWIN</div>
          <h1>Gemelo digital</h1>
          <p>Escena asociada a <strong>{project.name}</strong>. Los modelos importados se guardan en este proyecto.</p>
        </div>
        {project.digitalTwin?.kind === 'imported' && (
          <span className="catalog-count">{project.digitalTwin.assets?.length ?? 0} ARCHIVOS DEL MODELO</span>
        )}
      </div>
      <div className="twin-disclaimer"><ShieldCheck size={16} /><span>La geometría generada es ilustrativa. El visor no calcula deformaciones ni resultados estructurales.</span></div>
      <Suspense fallback={<div className="twin-viewer-shell"><div className="twin-loading">Cargando motor 3D…</div></div>}>
        <DigitalTwinViewer
          digitalTwin={project.digitalTwin}
          onGenerateBridge={onGenerateBridge}
          onImportModel={onImportModel}
        />
      </Suspense>
    </div>
  );
}

interface CompileResult {
  success: boolean;
  board: string;
  output: string;
  artifacts?: { name: string; bytes: number; downloadBase64?: string }[];
  error?: string;
  code?: string;
}

function EditorPage({
  project,
  activeFile,
  saveState,
  onSave,
  onAddFile,
  onSelectFile,
  onUpdateContent,
  onOpenTwin,
  onBack,
}: {
  project: EmbeddedProject;
  activeFile: ProjectFile | undefined;
  saveState: 'saved' | 'saving' | 'error';
  onSave: () => void;
  onAddFile: () => void;
  onSelectFile: (id: string) => void;
  onUpdateContent: (content: string) => void;
  onOpenTwin: () => void;
  onBack: () => void;
}) {
  const [compileState, setCompileState] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [compileOutput, setCompileOutput] = useState('');
  const [firmwareDownload, setFirmwareDownload] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => () => {
    if (firmwareDownload) URL.revokeObjectURL(firmwareDownload.url);
  }, [firmwareDownload]);

  const compileProject = async () => {
    setCompileState('compiling');
    setCompileOutput('Enviando el proyecto a Arduino CLI…');
    setFirmwareDownload(null);
    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId: project.boardId, files: project.files.map(({ path, content }) => ({ path, content })) }),
      });
      const result = await response.json() as CompileResult;
      if (!response.ok || !result.success) {
        setCompileState('error');
        setCompileOutput([result.error, result.output].filter(Boolean).join('\n'));
        return;
      }
      const artifacts = result.artifacts?.map((artifact) => `${artifact.name} (${artifact.bytes.toLocaleString()} bytes)`).join('\n');
      setCompileState('success');
      setCompileOutput([result.output.trim(), artifacts ? `Artefactos generados:\n${artifacts}` : 'Compilación correcta.'].filter(Boolean).join('\n'));
      const hex = result.artifacts?.find((artifact) => artifact.name.endsWith('.ino.hex') && artifact.downloadBase64);
      if (hex?.downloadBase64) {
        const binary = atob(hex.downloadBase64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        setFirmwareDownload({
          name: `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}.hex`,
          url: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })),
        });
      }
    } catch (error) {
      setCompileState('error');
      setCompileOutput(error instanceof Error ? error.message : 'No se pudo contactar al compilador local.');
    }
  };

  return (
    <div className="ide-page">
      <div className="ide-titlebar"><div><button className="subtle-link" onClick={onBack}>Proyectos</button><span className="breadcrumb-separator">/</span><strong>{project.name}</strong></div><div className="ide-actions"><span className={`save-indicator ${saveState}`}><span />{saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'Error al guardar' : 'Guardado local'}</span><button className="secondary-button save-button" onClick={onSave}><Save size={15} /> Guardar</button><button className="secondary-button save-button" onClick={onOpenTwin}><Box size={15} /> Ver 3D</button><button className="primary-button compile-button" disabled={compileState === 'compiling'} onClick={() => void compileProject()}><Zap size={15} /> {compileState === 'compiling' ? 'Compilando…' : 'Compilar'}</button></div></div>
      <div className="ide-workspace">
        <aside className="file-explorer">
          <div className="explorer-heading"><span>EXPLORADOR</span><button className="icon-button compact-button" onClick={onAddFile} aria-label="Agregar archivo"><FilePlus2 size={15} /></button></div>
          <div className="project-tree-title"><ChevronDown size={14} /><FolderOpen size={14} /><span>{project.name.toUpperCase()}</span></div>
          {project.files.map((file) => (
            <button className={`file-item${file.id === project.activeFileId ? ' selected' : ''}`} key={file.id} onClick={() => onSelectFile(file.id)}><FileCode2 size={14} /><span>{file.path}</span></button>
          ))}
          <div className="explorer-board"><span>PLACA OBJETIVO</span><strong><Cpu size={14} /> {boardLabels[project.boardId]}</strong><small>Configuración del proyecto</small></div>
        </aside>
        <section className="editor-column">
          <div className="editor-tabs"><span className="editor-tab"><FileCode2 size={14} /> {activeFile?.path ?? 'Selecciona un archivo'}<span className="tab-dot" /></span><div className="editor-language">C++</div></div>
          {activeFile ? (
            <Editor
              height="100%"
              language={activeFile.path.endsWith('.py') ? 'python' : activeFile.path.endsWith('.json') ? 'json' : activeFile.path.endsWith('.md') ? 'markdown' : 'cpp'}
              theme="vs-dark"
              value={activeFile.content}
              onChange={(value) => onUpdateContent(value ?? '')}
              options={{
                automaticLayout: true,
                fontSize: 13,
                fontFamily: "'Cascadia Code', 'Consolas', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 },
                renderLineHighlight: 'line',
                lineNumbersMinChars: 3,
                tabSize: 2,
                wordWrap: 'on',
                suggestOnTriggerCharacters: true,
              }}
            />
          ) : <div className="editor-empty">Selecciona un archivo para editar.</div>}
          <div className={`terminal-panel terminal-${compileState}`}><div className="terminal-heading"><span><TerminalSquare size={14} /> CONSOLA · {compileState === 'compiling' ? 'COMPILANDO' : compileState === 'success' ? 'COMPILACIÓN CORRECTA' : compileState === 'error' ? 'COMPILACIÓN FALLIDA' : 'LISTA'}</span><span className={`terminal-idle ${compileState}`}>{compileState === 'compiling' ? 'EN CURSO' : compileState === 'error' ? 'ERROR' : compileState === 'success' ? 'OK' : 'ARDUINO CLI'}</span></div><pre className="terminal-content compile-output">{compileOutput || 'Listo. Compila el proyecto para verificar el firmware real; la ejecución simulada aún no está disponible.'}</pre>{firmwareDownload && <a className="firmware-download" href={firmwareDownload.url} download={firmwareDownload.name}><Save size={13} /> Descargar firmware HEX</a>}</div>
        </section>
        <aside className="properties-panel"><div className="properties-heading"><Settings2 size={15} /> PROPIEDADES</div><div className="property-group"><span className="property-label">PROYECTO</span><strong>{project.name}</strong><small>Proyecto local</small></div><div className="property-group"><span className="property-label">MICROCONTROLADOR</span><strong><Cpu size={14} /> {boardLabels[project.boardId]}</strong><small>{project.boardId === 'arduino-uno' ? 'Arduino CLI + core AVR disponible.' : 'El core ESP32 no está instalado.'}</small></div><div className="property-group"><span className="property-label">ARCHIVOS</span><strong>{project.files.length} archivo{project.files.length === 1 ? '' : 's'}</strong><small>{project.files.map((file) => file.path.split('.').pop()?.toUpperCase()).filter(Boolean).join(' · ')}</small></div><div className="property-warning"><AlertCircle size={15} /><span>Compilar verifica el firmware, pero todavía no ejecuta una simulación.</span></div></aside>
      </div>
      <div className="ide-statusbar"><span><span className="status-dot" /> {boardLabels[project.boardId]}</span><span>UTF-8</span><span>Arduino Framework · no configurado</span><span>{activeFile?.content.split('\n').length ?? 0} líneas</span></div>
    </div>
  );
}

function EmptyEditor({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-editor-page"><span className="empty-icon"><Braces size={24} /></span><h1>Abre un proyecto para empezar</h1><p>El editor guarda el código de cada proyecto localmente en este dispositivo.</p><button className="primary-button" onClick={onCreate}><Plus size={16} /> Crear proyecto</button></div>;
}

export default App;
