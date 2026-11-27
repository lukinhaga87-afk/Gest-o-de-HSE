import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSTProvider, useSST } from './context/SSTContext';
import { Sidebar, NavItemKey } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LoginPage } from './components/auth/LoginPage';
import { DashboardView } from './components/views/DashboardView';
import { ContractorPanelView } from './components/views/ContractorPanelView';
import { CompaniesView } from './components/views/CompaniesView';
import { EmployeesView } from './components/views/EmployeesView';
import { CentralIntegracaoView } from './components/views/CentralIntegracaoView';
import { IntegrationsAdminView } from './components/views/IntegrationsAdminView';
import { DocumentAnalysisCenterView } from './components/views/DocumentAnalysisCenterView';
import { ExpirationsControlView } from './components/views/ExpirationsControlView';
import { AdminExpirationsControlView } from './components/views/AdminExpirationsControlView';
import { ActivityMatrixView } from './components/views/ActivityMatrixView';
import { UsersPermissionsView } from './components/views/UsersPermissionsView';
import { NotificationCenterDrawer } from './components/notifications/NotificationCenterDrawer';
import { formatCPF } from './utils/trafficLight';
import { Shield, Loader2, X, KeyRound, User, Building2, FlaskConical, RotateCcw } from 'lucide-react';

const SOLICITANTE_ALLOWED_TABS: NavItemKey[] = [
  'painel_contratada',
  'empresas',
  'colaboradores',
  'envio_documentos',
  'gestao_integracao',
  'pendencias_vencimentos',
];

const ADMIN_ALLOWED_TABS: NavItemKey[] = [
  'dashboard',
  'empresas',
  'colaboradores',
  'gestao_integracoes',
  'analise_documental',
  'controle_vencimentos',
  'matriz_ehs',
  'usuarios',
];

const AUDITOR_ALLOWED_TABS: NavItemKey[] = [
  'dashboard',
  'empresas',
  'colaboradores',
  'gestao_integracoes',
  'analise_documental',
  'controle_vencimentos',
  'matriz_ehs',
];

const MainAppShell: React.FC = () => {
  const {
    isAuthenticated,
    profile,
    activeRole,
    loading: authLoading,
    isSolicitante,
    isAdmin,
    isAuditor,
    isDemoMode,
    activeEmpresaNome,
    resetSimulatedRole,
  } = useAuth();
  const { loading: sstLoading } = useSST();

  const [activeTab, setActiveTab] = useState<NavItemKey>(() =>
    isSolicitante ? 'painel_contratada' : 'dashboard'
  );
  const [targetIntegrationId, setTargetIntegrationId] = useState<string | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState<string | null>(null);
  const [targetEmployeeId, setTargetEmployeeId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Reset landing tab and transient UI state whenever authenticated user changes or logs out
  useEffect(() => {
    if (!isAuthenticated || !profile) {
      setIsMobileSidebarOpen(false);
      setIsUserProfileOpen(false);
      setIsPasswordModalOpen(false);
      setTargetIntegrationId(null);
      setTargetCompanyId(null);
      setTargetEmployeeId(null);
      return;
    }
    setActiveTab(profile.role === 'solicitante' ? 'painel_contratada' : 'dashboard');
  }, [isAuthenticated, profile?.id, profile?.role]);

  // Enforce strict role-based tab isolation whenever profile/role changes
  useEffect(() => {
    if (isSolicitante && !SOLICITANTE_ALLOWED_TABS.includes(activeTab)) {
      setActiveTab('painel_contratada');
    } else if (isAuditor && !AUDITOR_ALLOWED_TABS.includes(activeTab)) {
      setActiveTab('dashboard');
    } else if (isAdmin && !ADMIN_ALLOWED_TABS.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [isSolicitante, isAdmin, isAuditor, activeTab]);

  const handleNavigate = (
    tab: NavItemKey,
    opts?: { integrationId?: string; companyId?: string; employeeId?: string }
  ) => {
    setTargetIntegrationId(opts?.integrationId || null);
    setTargetCompanyId(opts?.companyId || null);
    setTargetEmployeeId(opts?.employeeId || null);

    if (isSolicitante && !SOLICITANTE_ALLOWED_TABS.includes(tab)) {
      setActiveTab('painel_contratada');
      return;
    }
    if (isAuditor && !AUDITOR_ALLOWED_TABS.includes(tab)) {
      setActiveTab('dashboard');
      return;
    }
    if (isAdmin && !ADMIN_ALLOWED_TABS.includes(tab)) {
      setActiveTab('dashboard');
      return;
    }
    setActiveTab(tab);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl shadow-blue-900/50 animate-pulse">
            <Shield size={32} />
          </div>
          <div className="flex items-center gap-2 text-slate-300 font-medium text-sm">
            <Loader2 size={18} className="animate-spin text-blue-500" />
            <span>Carregando plataforma EHS More...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !profile) {
    return <LoginPage />;
  }

  const renderActiveView = () => {
    if (isSolicitante) {
      switch (activeTab) {
        case 'painel_contratada':
          return <ContractorPanelView onNavigate={handleNavigate} />;
        case 'empresas':
          return <CompaniesView initialCompanyId={targetCompanyId} onNavigate={handleNavigate} />;
        case 'colaboradores':
          return <EmployeesView initialEmployeeId={targetEmployeeId} />;
        case 'envio_documentos':
          return (
            <CentralIntegracaoView
              initialSection="nova"
              initialIntegrationId={targetIntegrationId}
              initialCompanyId={targetCompanyId}
            />
          );
        case 'gestao_integracao':
          return (
            <CentralIntegracaoView
              initialSection="acompanhamento"
              initialIntegrationId={targetIntegrationId}
              initialCompanyId={targetCompanyId}
            />
          );
        case 'pendencias_vencimentos':
          return <ExpirationsControlView onNavigate={handleNavigate} />;
        default:
          return <ContractorPanelView onNavigate={handleNavigate} />;
      }
    }

    // Admin EHS & Auditor (read-only)
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView onNavigate={handleNavigate} />;
      case 'empresas':
        return <CompaniesView initialCompanyId={targetCompanyId} onNavigate={handleNavigate} />;
      case 'colaboradores':
        return <EmployeesView initialEmployeeId={targetEmployeeId} />;
      case 'gestao_integracoes':
        return <IntegrationsAdminView initialIntegrationId={targetIntegrationId} />;
      case 'analise_documental':
        return <DocumentAnalysisCenterView onNavigate={handleNavigate} />;
      case 'controle_vencimentos':
        return <AdminExpirationsControlView onNavigate={handleNavigate} />;
      case 'matriz_ehs':
        return <ActivityMatrixView />;
      case 'usuarios':
        return isAdmin ? <UsersPermissionsView /> : <DashboardView onNavigate={handleNavigate} />;
      default:
        return <DashboardView onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans antialiased">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => handleNavigate(tab)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenUserProfile={() => setIsUserProfileOpen(true)}
        onOpenChangePassword={() => setIsPasswordModalOpen(true)}
      />

      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        <Header
          onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          onOpenAlertsModal={() =>
            handleNavigate(isSolicitante ? 'pendencias_vencimentos' : 'analise_documental')
          }
          onOpenNotificationsDrawer={() => setIsNotificationsOpen(true)}
          isPasswordModalOpen={isPasswordModalOpen}
          onOpenPasswordModal={() => setIsPasswordModalOpen(true)}
          onClosePasswordModal={() => setIsPasswordModalOpen(false)}
        />

        {isDemoMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 border-b border-amber-500/40 px-4 py-2 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-semibold">
              <FlaskConical size={15} className="text-amber-400 shrink-0" />
              <span>MODO DE DEMONSTRAÇÃO — DADOS FICTÍCIOS</span>
              <span className="hidden sm:inline font-normal text-amber-300/80">
                ({activeEmpresaNome || 'Empresa Fictícia Isolada'} — ambiente isolado sem impacto em empresas reais)
              </span>
            </div>
            <button
              type="button"
              onClick={resetSimulatedRole}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold text-amber-100 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              Voltar para Administrador EHS
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
          {sstLoading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 size={24} className="animate-spin text-blue-500" />
              <p className="text-xs">Sincronizando dados espelhados de empresas e documentos...</p>
            </div>
          ) : (
            <div className="mx-auto max-w-7xl animate-in fade-in duration-200">
              {renderActiveView()}
            </div>
          )}
        </main>
      </div>

      <NotificationCenterDrawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        onNavigate={handleNavigate}
      />

      {/* User Profile Summary Modal */}
      {isUserProfileOpen && profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <User size={16} className="text-blue-400" />
                Meu Perfil
              </h3>
              <button
                type="button"
                onClick={() => setIsUserProfileOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-300">
              <p>
                <span className="text-slate-500">Nome:</span>{' '}
                <strong className="text-white">{profile.nome}</strong>
              </p>
              <p>
                <span className="text-slate-500">CPF:</span>{' '}
                <span className="font-mono">{formatCPF(profile.cpf || profile.username)}</span>
              </p>
              <p>
                <span className="text-slate-500">E-mail:</span> {profile.email}
              </p>
              <p>
                <span className="text-slate-500">Perfil:</span>{' '}
                <strong className="text-blue-400 uppercase">{activeRole}</strong>
              </p>
              {profile.empresaNome && (
                <p className="flex items-center gap-1.5">
                  <Building2 size={12} className="text-slate-400" />
                  <span>{profile.empresaNome}</span>
                </p>
              )}
            </div>
            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsUserProfileOpen(false);
                  setIsPasswordModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
              >
                <KeyRound size={13} />
                Alterar Senha
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <SSTProvider>
        <MainAppShell />
      </SSTProvider>
    </AuthProvider>
  );
}

export default App;
