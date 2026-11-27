import React, { useEffect, useState } from 'react';
import {
  Menu,
  Shield,
  Eye,
  LogOut,
  Building,
  Bell,
  RefreshCw,
  Camera,
  X,
  KeyRound,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAuth, DEMO_COMPANY_ID, DEMO_COMPANY_NAME } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import { UserRole } from '../../types/sst';
import { formatCPF } from '../../utils/trafficLight';

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenAlertsModal?: () => void;
  onOpenNotificationsDrawer?: () => void;
  isPasswordModalOpen?: boolean;
  onOpenPasswordModal?: () => void;
  onClosePasswordModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onOpenAlertsModal,
  onOpenNotificationsDrawer,
  isPasswordModalOpen: controlledPasswordModalOpen,
  onOpenPasswordModal,
  onClosePasswordModal,
}) => {
  const {
    profile,
    activeRole,
    isSimulatingRole,
    isDemoMode,
    logout,
    setSimulatedRole,
    resetSimulatedRole,
    isAdmin,
    updateProfilePhoto,
    changeOwnPassword,
  } = useAuth();

  const { contractorIntegrationItems, unreadNotificationsCount } = useSST();

  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  // Change password modal states (simplified: Nova senha + Confirmar nova senha)
  const [internalPasswordModalOpen, setInternalPasswordModalOpen] = useState(false);
  const isPasswordModalOpen = controlledPasswordModalOpen ?? internalPasswordModalOpen;
  const openPasswordModal = () => {
    setNewPassInput('');
    setConfirmPassInput('');
    setPassError(null);
    setPassSuccess(null);
    if (onOpenPasswordModal) {
      onOpenPasswordModal();
    } else {
      setInternalPasswordModalOpen(true);
    }
  };
  const closePasswordModal = () => {
    if (onClosePasswordModal) {
      onClosePasswordModal();
    } else {
      setInternalPasswordModalOpen(false);
    }
  };

  const [newPassInput, setNewPassInput] = useState('');
  const [confirmPassInput, setConfirmPassInput] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [passSuccess, setPassSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isPasswordModalOpen) {
      setNewPassInput('');
      setConfirmPassInput('');
      setPassError(null);
      setPassSuccess(null);
    }
  }, [isPasswordModalOpen]);

  // Compute real pending integration documents awaiting EHS analysis
  const totalPending = contractorIntegrationItems.filter(
    (item) => item.status === 'ENVIADO' || item.status === 'EM_ANALISE'
  ).length;

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
            <Shield size={12} />
            Administrador EHS
          </span>
        );
      case 'solicitante':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Building size={12} />
            Solicitante / Contratada
          </span>
        );
      case 'auditor':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Eye size={12} />
            Auditor (Somente Leitura)
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 backdrop-blur lg:px-6">
      {/* Left: Hamburger menu for mobile & Title/Context */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 lg:hidden"
          title="Abrir Menu"
        >
          <Menu size={20} />
        </button>

        <div className="hidden sm:block">
          <h1 className="text-sm font-semibold text-white">
            Painel de Gestão de EHS
          </h1>
          <p className="text-xs text-slate-400">
            Meio Ambiente, Saúde Ocupacional e Segurança do Trabalho
          </p>
        </div>
      </div>

      {/* Right controls: Role Badge / Admin Preview Switcher, Alerts, User Profile */}
      <div className="flex items-center gap-3">
        {profile?.role === 'admin' ? (
          <div className="relative">
            <button
              onClick={() => setRoleMenuOpen(!roleMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs transition-colors"
              title="Alternar Perfil para Teste"
            >
              <span className="text-slate-400 hidden md:inline">Perfil Ativo:</span>
              {getRoleBadge(activeRole)}
              {isSimulatingRole && (
                <span className="text-[10px] px-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-mono">
                  Simulado
                </span>
              )}
            </button>

            {/* Role Dropdown (Admin Only) */}
            {roleMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-2 z-50">
                <div className="px-3 py-2 border-b border-slate-800 text-xs">
                  <p className="font-semibold text-white">Perfis de Acesso (Teste)</p>
                  <p className="text-[11px] text-slate-400">
                    Alterne para verificar permissões e regras de isolamento:
                  </p>
                </div>

                <div className="py-1 space-y-1">
                  <button
                    onClick={() => {
                      setSimulatedRole('admin');
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                      activeRole === 'admin'
                        ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-blue-400" />
                      <div>
                        <p className="font-medium">ADMINISTRADOR EHS</p>
                        <p className="text-[10px] text-slate-400">Controle total, aprovações e exclusão</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setSimulatedRole('solicitante', DEMO_COMPANY_ID, DEMO_COMPANY_NAME);
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                      activeRole === 'solicitante'
                        ? 'bg-amber-600/20 text-amber-300 font-semibold border border-amber-500/30'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building size={14} className="text-amber-400" />
                      <div>
                        <p className="font-medium">MODO DEMO — SOLICITANTE</p>
                        <p className="text-[10px] text-slate-400">
                          Empresa fictícia isolada (não afeta dados reais)
                        </p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setSimulatedRole('auditor');
                      setRoleMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                      activeRole === 'auditor'
                        ? 'bg-emerald-600/20 text-emerald-300 font-semibold border border-emerald-500/30'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Eye size={14} className="text-emerald-400" />
                      <div>
                        <p className="font-medium">AUDITOR</p>
                        <p className="text-[10px] text-slate-400">Apenas consulta, relatórios e auditoria</p>
                      </div>
                    </div>
                  </button>
                </div>

                {isSimulatingRole && (
                  <div className="pt-2 border-t border-slate-800">
                    <button
                      onClick={() => {
                        resetSimulatedRole();
                        setRoleMenuOpen(false);
                      }}
                      className="w-full text-center px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={12} />
                      Restaurar perfil real
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs">
            <span className="text-slate-400 hidden md:inline">Perfil Ativo:</span>
            {getRoleBadge(activeRole)}
          </div>
        )}

        {/* Pending analysis quick pill for Admin */}
        {totalPending > 0 && isAdmin && (
          <button
            type="button"
            onClick={() => onOpenAlertsModal?.()}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium cursor-pointer transition-colors"
            title={`${totalPending} documento(s) aguardando análise EHS`}
          >
            <span className="font-bold">{totalPending} em Análise</span>
          </button>
        )}

        {/* Central de Notificações (Visível para Administrador EHS e Solicitante) */}
        <button
          type="button"
          onClick={() => onOpenNotificationsDrawer?.()}
          className={`relative flex items-center justify-center h-9 w-9 rounded-lg border transition-colors cursor-pointer ${
            unreadNotificationsCount > 0
              ? 'bg-blue-600/15 border-blue-500/40 text-blue-300 hover:bg-blue-600/25'
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          title={
            unreadNotificationsCount > 0
              ? `${unreadNotificationsCount} notificação(ões) não lida(s)`
              : 'Central de Notificações'
          }
          aria-label="Abrir Central de Notificações"
        >
          <Bell size={16} className={unreadNotificationsCount > 0 ? 'text-blue-400' : ''} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-slate-900">
              {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
            </span>
          )}
        </button>

        {isDemoMode && (
          <span className="hidden lg:inline-flex items-center px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold text-amber-300">
            DEMO
          </span>
        )}

        {/* User Auth Info / Profile & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          {profile ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPhotoPreview(null);
                  setIsPhotoModalOpen(true);
                }}
                className="relative group rounded-full cursor-pointer focus:outline-none"
                title="Clique para visualizar ou alterar sua foto de perfil"
              >
                {profile.fotoPerfilUrl ? (
                  <img
                    src={profile.fotoPerfilUrl}
                    alt={profile.nome}
                    className="h-8 w-8 rounded-full object-cover border border-blue-400/50 shadow-md group-hover:ring-2 group-hover:ring-blue-400 transition-all"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-blue-600 group-hover:bg-blue-500 text-white font-bold flex items-center justify-center text-xs shadow-md border border-blue-400/40 transition-colors">
                    {profile.nome?.[0]?.toUpperCase() || profile.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[8px] text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Camera size={7} />
                </span>
              </button>

              <div className="hidden xl:block text-left">
                <p className="text-xs font-medium text-white truncate max-w-[150px]">
                  {profile.nome}
                </p>
                <p className="text-[10px] text-slate-400 truncate max-w-[150px] font-mono">
                  CPF: {formatCPF(profile.cpf || profile.username)}
                </p>
              </div>
              <button
                onClick={openPasswordModal}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 cursor-pointer"
                title="Alterar senha"
              >
                <KeyRound size={15} />
                <span className="hidden md:inline">Alterar senha</span>
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 cursor-pointer"
                title="Sair da Plataforma"
              >
                <LogOut size={15} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal: Atualizar Fotografia de Perfil do Usuário Logado */}
      {isPhotoModalOpen && profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Camera size={18} className="text-blue-400" />
                Fotografia de Perfil
              </h3>
              <button
                onClick={() => {
                  setPhotoPreview(null);
                  setIsPhotoModalOpen(false);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col items-center justify-center gap-3 py-2">
              {photoPreview || profile.fotoPerfilUrl ? (
                <img
                  src={photoPreview || profile.fotoPerfilUrl}
                  alt={profile.nome}
                  className="h-28 w-28 rounded-full object-cover border-4 border-blue-500 shadow-xl"
                />
              ) : (
                <div className="h-28 w-28 rounded-full bg-slate-800 text-slate-400 flex flex-col items-center justify-center border-2 border-slate-700">
                  <Camera size={36} />
                  <span className="text-[10px] mt-1 font-medium">Sem Foto</span>
                </div>
              )}

              <div className="text-center">
                <p className="font-bold text-white text-sm">{profile.nome}</p>
                <p className="text-[11px] text-slate-400 font-mono">CPF: {formatCPF(profile.cpf || profile.username)}</p>
                <span className="inline-block mt-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {profile.role === 'admin' ? 'Administrador EHS' : profile.role === 'solicitante' ? 'Solicitante / Contratada' : 'Auditor'}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <label className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer transition-colors inline-flex items-center gap-2">
                  <Camera size={14} />
                  <span>{profile.fotoPerfilUrl || photoPreview ? 'Substituir Foto' : 'Selecionar Foto'}</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                      const isAllowedExt = /\.(jpe?g|png|webp)$/i.test(file.name);
                      if (!allowedTypes.includes(file.type.toLowerCase()) && !isAllowedExt) {
                        alert('Formato inválido. Selecione JPG, JPEG, PNG ou WEBP.');
                        return;
                      }

                      if (file.size > 3 * 1024 * 1024) {
                        alert('A foto deve ter no máximo 3 MB.');
                        return;
                      }

                      const reader = new FileReader();
                      reader.onload = () => {
                        setPhotoPreview(reader.result as string);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>

                {(profile.fotoPerfilUrl || photoPreview) && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (photoPreview && !profile.fotoPerfilUrl) {
                        setPhotoPreview(null);
                        return;
                      }
                      setSavingPhoto(true);
                      try {
                        await updateProfilePhoto(null);
                        setPhotoPreview(null);
                      } finally {
                        setSavingPhoto(false);
                      }
                    }}
                    disabled={savingPhoto}
                    className="px-3 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/30 font-medium cursor-pointer"
                  >
                    Remover
                  </button>
                )}
              </div>

              <p className="text-[10px] text-slate-500 text-center">
                Formatos permitidos: JPG, JPEG, PNG, WEBP (Máx: 3 MB).
              </p>

              {photoPreview && (
                <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPhotoPreview(null)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    disabled={savingPhoto}
                    onClick={async () => {
                      setSavingPhoto(true);
                      try {
                        await updateProfilePhoto(photoPreview);
                        setPhotoPreview(null);
                        setIsPhotoModalOpen(false);
                      } finally {
                        setSavingPhoto(false);
                      }
                    }}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                  >
                    {savingPhoto ? 'Salvando...' : 'Salvar Fotografia'}
                  </button>
                </div>
              )}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setPhotoPreview(null);
                    setIsPhotoModalOpen(false);
                    openPasswordModal();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-blue-300 border border-slate-700 font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <KeyRound size={14} />
                  <span>Alterar senha</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Alterar senha (simplificado: Nova senha + Confirmar nova senha) */}
      {isPasswordModalOpen && profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <KeyRound size={18} className="text-blue-400" />
                Alterar senha
              </h3>
              <button
                onClick={closePasswordModal}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-xs text-slate-400">
              Usuário: <strong className="text-white">{profile.nome}</strong>{' '}
              <span className="font-mono text-blue-400">({formatCPF(profile.cpf || profile.username)})</span>
            </div>

            {passSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                <span>{passSuccess}</span>
              </div>
            )}

            {passError && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
                <span>{passError}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPassError(null);
                setPassSuccess(null);

                if (!newPassInput.trim() || !confirmPassInput.trim()) {
                  setPassError('Preencha a nova senha e a confirmação.');
                  return;
                }
                if (newPassInput.trim().length < 6) {
                  setPassError('A nova senha deve conter no mínimo 6 caracteres.');
                  return;
                }
                if (newPassInput.trim() !== confirmPassInput.trim()) {
                  setPassError('A confirmação da nova senha não confere.');
                  return;
                }

                setSavingPass(true);
                try {
                  const res = await changeOwnPassword(newPassInput, confirmPassInput);
                  if (!res.success) {
                    setPassError(res.message);
                  } else {
                    setPassSuccess(res.message);
                    setNewPassInput('');
                    setConfirmPassInput('');
                  }
                } finally {
                  setSavingPass(false);
                }
              }}
              className="space-y-3.5 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nova senha</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassInput}
                    onChange={(e) => setNewPassInput(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Confirmar nova senha</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassInput}
                    onChange={(e) => setConfirmPassInput(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={savingPass}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingPass ? 'Salvando...' : 'Salvar nova senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
