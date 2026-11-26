import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Users,
  Upload,
  FolderCheck,
  FileCheck2,
  CalendarClock,
  UserCog,
  Shield,
  X,
  KeyRound,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import { resolveIntegrationItemStandardizedStatus } from '../../utils/documentStatus';

export type NavItemKey =
  | 'dashboard'
  | 'painel_contratada'
  | 'empresas'
  | 'colaboradores'
  | 'envio_documentos'
  | 'gestao_integracao'
  | 'gestao_integracoes'
  | 'analise_documental'
  | 'pendencias_vencimentos'
  | 'controle_vencimentos'
  | 'matriz_ehs'
  | 'usuarios';

interface SidebarProps {
  activeTab: NavItemKey;
  onSelectTab: (tab: NavItemKey) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onOpenUserProfile?: () => void;
  onOpenChangePassword?: () => void;
}

interface MenuEntry {
  key: NavItemKey;
  label: string;
  icon: React.ReactNode;
  badgeCount?: number;
  badgeTone?: 'amber' | 'rose' | 'sky';
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  onOpenUserProfile,
  onOpenChangePassword,
}) => {
  const { activeRole, isAdmin, isSolicitante, isAuditor, profile } = useAuth();
  const { contractorIntegrationItems, companies, documents, exams, trainings } = useSST();

  // Compute live mirrored counts for sidebar badges
  const badgeStats = React.useMemo(() => {
    let awaitingAnalysis = 0;
    let contractorActions = 0;
    let expiringOrExpired = 0;
    let pendingCompanyChanges = 0;

    for (const item of contractorIntegrationItems) {
      const st = resolveIntegrationItemStandardizedStatus(item, item.protocoloStatus);
      if (st === 'AGUARDANDO_ANALISE' || st === 'EM_ANALISE') {
        awaitingAnalysis += 1;
      }
      if (
        st === 'REPROVADO' ||
        st === 'VENCIDO' ||
        st === 'PROXIMO_VENCIMENTO' ||
        st === 'PENDENTE_ENVIO' ||
        st === 'NAO_ENVIADO'
      ) {
        contractorActions += 1;
      }
      if (st === 'VENCIDO' || st === 'PROXIMO_VENCIMENTO') {
        expiringOrExpired += 1;
      }
    }

    for (const doc of documents) {
      if (doc.situacao === 'pendente') awaitingAnalysis += 1;
    }
    for (const ex of exams) {
      if (ex.situacao === 'pendente') awaitingAnalysis += 1;
    }
    for (const tr of trainings) {
      if (tr.situacao === 'pendente') awaitingAnalysis += 1;
    }

    for (const comp of companies) {
      pendingCompanyChanges += (comp.solicitacoesAlteracao || []).filter(
        (req) => req.status === 'pendente'
      ).length;
    }

    return { awaitingAnalysis, contractorActions, expiringOrExpired, pendingCompanyChanges };
  }, [contractorIntegrationItems, companies, documents, exams, trainings]);

  const solicitanteMenu: MenuEntry[] = [
    {
      key: 'painel_contratada',
      label: 'Painel da Contratada',
      icon: <ShieldCheck size={18} />,
    },
    {
      key: 'empresas',
      label: 'Minha Empresa',
      icon: <Building2 size={18} />,
    },
    {
      key: 'colaboradores',
      label: 'Meus Colaboradores',
      icon: <Users size={18} />,
    },
    {
      key: 'envio_documentos',
      label: 'Envio de Documentos',
      icon: <Upload size={18} />,
    },
    {
      key: 'gestao_integracao',
      label: 'Gestão de Integração',
      icon: <FolderCheck size={18} />,
    },
    {
      key: 'pendencias_vencimentos',
      label: 'Pendências e Vencimentos',
      icon: <CalendarClock size={18} />,
      badgeCount: badgeStats.contractorActions,
      badgeTone: 'rose',
    },
  ];

  const adminMenu: MenuEntry[] = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard size={18} />,
    },
    {
      key: 'empresas',
      label: 'Empresas Contratadas',
      icon: <Building2 size={18} />,
      badgeCount: badgeStats.pendingCompanyChanges,
      badgeTone: 'amber',
    },
    {
      key: 'colaboradores',
      label: 'Colaboradores',
      icon: <Users size={18} />,
    },
    {
      key: 'gestao_integracoes',
      label: 'Gestão de Integração',
      icon: <FolderCheck size={18} />,
    },
    {
      key: 'analise_documental',
      label: 'Central de Análise Documental',
      icon: <FileCheck2 size={18} />,
      badgeCount: badgeStats.awaitingAnalysis,
      badgeTone: 'sky',
    },
    {
      key: 'controle_vencimentos',
      label: 'Controle de Vencimentos',
      icon: <CalendarClock size={18} />,
      badgeCount: badgeStats.expiringOrExpired,
      badgeTone: 'amber',
    },
    {
      key: 'matriz_ehs',
      label: 'Matriz de EHS',
      icon: <ClipboardList size={18} />,
    },
    ...(isAdmin
      ? [
          {
            key: 'usuarios' as NavItemKey,
            label: 'Usuários e Permissões',
            icon: <UserCog size={18} />,
          },
        ]
      : []),
  ];

  const visibleItems = isSolicitante ? solicitanteMenu : adminMenu;

  const handleSelect = (key: NavItemKey) => {
    onSelectTab(key);
    onCloseMobile();
  };

  const getBadgeStyle = (tone?: 'amber' | 'rose' | 'sky') => {
    if (tone === 'rose') return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    if (tone === 'amber') return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
  };

  return (
    <>
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-900/40">
              <Shield size={20} className="stroke-[2.5]" />
            </div>
            <div>
              <span className="font-bold text-white tracking-tight text-sm block leading-none">
                EHS <span className="text-blue-400">More</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                Gestão de Terceiros
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Profile Context Pill */}
        <div className="px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/80">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            Espaço Ativo
          </p>
          <p className="text-xs font-semibold text-slate-200 mt-0.5 truncate">
            {isSolicitante
              ? 'Portal da Contratada'
              : isAuditor
              ? 'Auditoria EHS (Leitura)'
              : 'Administração EHS'}
          </p>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1 custom-scrollbar">
          {visibleItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleSelect(item.key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className={isActive ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      isActive
                        ? 'bg-white/20 text-white border-white/30'
                        : getBadgeStyle(item.badgeTone)
                    }`}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Account Controls */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 space-y-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                onOpenUserProfile?.();
                onCloseMobile();
              }}
              className="flex items-center gap-2.5 flex-1 min-w-0 p-1.5 rounded-lg hover:bg-slate-800/80 transition-colors text-left"
              title="Visualizar meu perfil"
            >
              {profile?.fotoPerfilUrl ? (
                <img
                  src={profile.fotoPerfilUrl}
                  alt={profile.nome}
                  className="h-8 w-8 rounded-full object-cover border border-blue-400/50 shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-blue-600/30 border border-blue-500/40 text-blue-300 font-bold flex items-center justify-center text-xs shrink-0">
                  {profile?.nome?.[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{profile?.nome || 'Usuário'}</p>
                <p className="text-[10px] text-slate-400 truncate capitalize">
                  {activeRole === 'admin'
                    ? 'Administrador EHS'
                    : activeRole === 'solicitante'
                    ? 'Solicitante / Contratada'
                    : 'Auditor'}
                </p>
              </div>
            </button>
            {onOpenChangePassword && (
              <button
                type="button"
                onClick={() => {
                  onOpenChangePassword();
                  onCloseMobile();
                }}
                className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                title="Alterar senha"
              >
                <KeyRound size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
