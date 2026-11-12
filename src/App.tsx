import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSTProvider, useSST } from './context/SSTContext';
import { Sidebar, NavItemKey } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LoginPage } from './components/auth/LoginPage';

// Views
import { DashboardView } from './components/views/DashboardView';
import { CompaniesView } from './components/views/CompaniesView';
import { EmployeesView } from './components/views/EmployeesView';
import { TrainingsView } from './components/views/TrainingsView';
import { DocumentsView } from './components/views/DocumentsView';
import { ExamsView } from './components/views/ExamsView';
import { EpiView } from './components/views/EpiView';
import { PermitsView } from './components/views/PermitsView';
import { InspectionsView } from './components/views/InspectionsView';
import { ActionPlansView } from './components/views/ActionPlansView';
import { EnvironmentalView } from './components/views/EnvironmentalView';
import { ReportsView } from './components/views/ReportsView';
import { UsersPermissionsView } from './components/views/UsersPermissionsView';
import { SettingsImportView } from './components/views/SettingsImportView';
import { NotificationsView } from './components/views/NotificationsView';
import { ShieldCheck, Loader2 } from 'lucide-react';

const SOLICITANTE_ALLOWED_TABS: NavItemKey[] = [
  'empresas',
  'colaboradores',
  'documentos',
  'treinamentos',
  'exames',
  'epi',
  'apr_pt',
  'planos_acao',
  'ambiental',
];

const MainAppContent: React.FC = () => {
  const { isAuthenticated, loading: authLoading, isSolicitante } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavItemKey>(() => (isSolicitante ? 'empresas' : 'dashboard'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { loading: sstLoading } = useSST();

  // Auto-redirect Solicitante away from unauthorized modules (Dashboard, Notificações, Usuários, Relatórios, etc.)
  React.useEffect(() => {
    if (isSolicitante && !SOLICITANTE_ALLOWED_TABS.includes(currentTab)) {
      setCurrentTab('empresas');
    }
  }, [isSolicitante, currentTab]);

  if (authLoading && sstLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
            <ShieldCheck size={28} />
          </div>
          <span className="text-xl font-bold tracking-tight">Gestão de EHS</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <Loader2 className="animate-spin text-blue-500" size={16} />
          <span>Carregando plataforma...</span>
        </div>
      </div>
    );
  }

  // If not authenticated via username/password, present Login Page
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const handleSelectTab = (tab: NavItemKey) => {
    if (isSolicitante && !SOLICITANTE_ALLOWED_TABS.includes(tab)) {
      setCurrentTab('empresas');
    } else {
      setCurrentTab(tab);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row antialiased selection:bg-blue-600 selection:text-white">
      {/* Navigation Drawer / Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header with Role Switcher & Logout */}
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        {/* View Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto pb-12">
            {!isSolicitante && currentTab === 'dashboard' && <DashboardView onNavigate={handleSelectTab} />}
            {currentTab === 'empresas' && <CompaniesView />}
            {currentTab === 'colaboradores' && <EmployeesView />}
            {currentTab === 'treinamentos' && <TrainingsView />}
            {currentTab === 'documentos' && <DocumentsView />}
            {currentTab === 'exames' && <ExamsView />}
            {currentTab === 'epi' && <EpiView />}
            {currentTab === 'apr_pt' && <PermitsView />}
            {!isSolicitante && currentTab === 'inspecoes' && <InspectionsView />}
            {currentTab === 'planos_acao' && <ActionPlansView />}
            {currentTab === 'ambiental' && <EnvironmentalView />}
            {!isSolicitante && currentTab === 'relatorios' && <ReportsView />}
            {!isSolicitante && currentTab === 'notificacoes' && <NotificationsView />}
            {!isSolicitante && currentTab === 'usuarios' && <UsersPermissionsView />}
            {!isSolicitante && currentTab === 'configuracoes' && <SettingsImportView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <SSTProvider>
        <MainAppContent />
      </SSTProvider>
    </AuthProvider>
  );
}
