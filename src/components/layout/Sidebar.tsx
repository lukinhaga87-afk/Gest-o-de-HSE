import React from 'react';
import {
  ShieldCheck,
  Building2,
  Users,
  GraduationCap,
  FileText,
  HeartPulse,
  HardHat,
  FileWarning,
  ClipboardCheck,
  Target,
  TreePine,
  BarChart3,
  UserCheck,
  Settings,
  LayoutDashboard,
  Mail,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type NavItemKey =
  | 'dashboard'
  | 'empresas'
  | 'colaboradores'
  | 'treinamentos'
  | 'documentos'
  | 'exames'
  | 'epi'
  | 'apr_pt'
  | 'inspecoes'
  | 'planos_acao'
  | 'ambiental'
  | 'relatorios'
  | 'notificacoes'
  | 'usuarios'
  | 'configuracoes';

interface SidebarProps {
  currentTab: NavItemKey;
  onSelectTab: (tab: NavItemKey) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onClose,
}) => {
  const { activeRole, activeEmpresaNome, isSolicitante, profile } = useAuth();

  const menuItems: { key: NavItemKey; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { key: 'empresas', label: 'Empresas Contratadas', icon: <Building2 size={18} /> },
    { key: 'colaboradores', label: 'Colaboradores', icon: <Users size={18} /> },
    { key: 'treinamentos', label: 'Treinamentos', icon: <GraduationCap size={18} /> },
    { key: 'documentos', label: 'Documentos', icon: <FileText size={18} /> },
    { key: 'exames', label: 'Exames e ASO', icon: <HeartPulse size={18} /> },
    { key: 'epi', label: 'Controle de EPI', icon: <HardHat size={18} /> },
    { key: 'apr_pt', label: 'APR e PT (LOTO)', icon: <FileWarning size={18} /> },
    { key: 'inspecoes', label: 'Inspeções e Auditorias', icon: <ClipboardCheck size={18} /> },
    { key: 'planos_acao', label: 'Planos de Ação', icon: <Target size={18} /> },
    { key: 'ambiental', label: 'Gestão Ambiental', icon: <TreePine size={18} /> },
    { key: 'relatorios', label: 'Relatórios', icon: <BarChart3 size={18} /> },
    { key: 'notificacoes', label: 'Notificações por E-mail', icon: <Mail size={18} /> },
    { key: 'usuarios', label: 'Usuários e Permissões', icon: <UserCheck size={18} /> },
    { key: 'configuracoes', label: 'Configurações e Carga', icon: <Settings size={18} /> },
  ];

  // Authorized modules for Solicitante (Section 5 Requirement)
  const SOLICITANTE_ALLOWED_KEYS: NavItemKey[] = [
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

  const visibleMenuItems = isSolicitante
    ? menuItems.filter((item) => SOLICITANTE_ALLOWED_KEYS.includes(item.key))
    : menuItems;

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-72 flex-col bg-slate-900 border-r border-slate-800 transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo and Brand */}
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30">
              <ShieldCheck size={24} className="stroke-[2.5]" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                Gestão de EHS
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  PRO
                </span>
              </span>
              <p className="text-[11px] text-slate-400 font-medium">Ambiente, Saúde & Segurança</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* User identification card with Profile Photo */}
        {profile && (
          <div className="mx-3 mt-3 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center gap-2.5">
            {profile.fotoPerfilUrl ? (
              <img
                src={profile.fotoPerfilUrl}
                alt={profile.nome}
                className="h-9 w-9 rounded-full object-cover border border-blue-400/50 shadow shrink-0"
              />
            ) : (
              <div className="h-9 w-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs border border-blue-400/40 shrink-0">
                {profile.nome?.[0]?.toUpperCase() || 'U'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">{profile.nome}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span
                  className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded border ${
                    activeRole === 'admin'
                      ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                      : activeRole === 'solicitante'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {activeRole === 'admin' ? 'Administrador' : activeRole === 'solicitante' ? 'Solicitante' : 'Auditor'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Company scope indication for Solicitante */}
        {isSolicitante && activeEmpresaNome && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            <p className="font-semibold flex items-center gap-1.5">
              <Building2 size={13} /> Empresa Contratada:
            </p>
            <p className="truncate text-amber-200/90 text-[11px] mt-0.5">{activeEmpresaNome}</p>
          </div>
        )}

        {/* Navigation list */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
          {visibleMenuItems.map((item) => {
            const isActive = currentTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  onSelectTab(item.key);
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom system status info */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Banco em Nuvem Ativo
            </span>
            <span className="text-[10px] text-slate-400 font-mono">v2.5</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Conformidade NR-01, NR-07, NR-09</p>
        </div>
      </aside>
    </>
  );
};
