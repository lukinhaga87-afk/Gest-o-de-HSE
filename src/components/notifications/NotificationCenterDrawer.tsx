import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  FileWarning,
  Megaphone,
  Send,
  X,
  ArrowRight,
  RefreshCw,
  Building2,
  Users,
  Inbox,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import {
  InAppNotification,
  InAppNotificationSeverity,
  InAppNotificationType,
} from '../../types/sst';
import { NavItemKey } from '../layout/Sidebar';

interface NotificationCenterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (
    tab: NavItemKey,
    opts?: { integrationId?: string; companyId?: string; employeeId?: string }
  ) => void;
}

function formatDateTimeBr(iso?: string): string {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function resolveNotificationTargetTab(
  n: InAppNotification,
  isSolicitante: boolean
): NavItemKey {
  const raw = (n.actionTab || '').toLowerCase();
  if (isSolicitante) {
    if (raw === 'central_integracao' || raw === 'gestao_integracao') return 'gestao_integracao';
    if (raw === 'envio_documentos' || raw === 'documentos') return 'envio_documentos';
    if (raw === 'pendencias' || raw === 'pendencias_vencimentos' || raw === 'vencimentos') {
      return 'pendencias_vencimentos';
    }
    if (raw === 'empresas') return 'empresas';
    if (raw === 'colaboradores') return 'colaboradores';
    if (n.integrationId) return 'gestao_integracao';
    if (n.type === 'DOCUMENTO_PROXIMO_VENCIMENTO' || n.type === 'DOCUMENTO_VENCIDO') {
      return 'pendencias_vencimentos';
    }
    return 'painel_contratada';
  }

  // Admin / Auditor
  if (raw === 'integracao_adm' || raw === 'gestao_integracoes') return 'gestao_integracoes';
  if (raw === 'analise_documental' || raw === 'documentos') return 'analise_documental';
  if (raw === 'controle_vencimentos' || raw === 'vencimentos' || raw === 'pendencias') {
    return 'controle_vencimentos';
  }
  if (raw === 'empresas') return 'empresas';
  if (raw === 'colaboradores') return 'colaboradores';
  if (raw === 'matriz_ehs') return 'matriz_ehs';
  if (n.integrationId) return 'gestao_integracoes';
  if (n.type === 'DOCUMENTO_PROXIMO_VENCIMENTO' || n.type === 'DOCUMENTO_VENCIDO') {
    return 'controle_vencimentos';
  }
  return 'dashboard';
}

function getTypeStyle(type: InAppNotificationType, severity: InAppNotificationSeverity) {
  switch (type) {
    case 'INTEGRACAO_APROVADA':
      return {
        icon: CheckCircle2,
        badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        iconColor: 'text-emerald-400',
        label: 'Aprovada',
      };
    case 'INTEGRACAO_REPROVADA':
    case 'DOCUMENTO_REJEITADO':
      return {
        icon: XCircle,
        badge: 'bg-red-500/15 text-red-300 border-red-500/30',
        iconColor: 'text-red-400',
        label: type === 'INTEGRACAO_REPROVADA' ? 'Reprovada' : 'Doc. Rejeitado',
      };
    case 'DOCUMENTO_VENCIDO':
      return {
        icon: ShieldAlert,
        badge: 'bg-red-500/20 text-red-300 border-red-500/40',
        iconColor: 'text-red-400',
        label: 'Vencido',
      };
    case 'DOCUMENTO_PROXIMO_VENCIMENTO':
      return {
        icon: Clock,
        badge:
          severity === 'critical'
            ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
            : 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        iconColor: 'text-amber-400',
        label: 'Vencimento',
      };
    case 'COMUNICADO_ADM':
      return {
        icon: Megaphone,
        badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
        iconColor: 'text-indigo-400',
        label: 'Comunicado EHS',
      };
    case 'INTEGRACAO_ENVIADA':
    case 'INTEGRACAO_REENVIADA':
    case 'INTEGRACAO_AGUARDANDO_DECISAO':
      return {
        icon: Inbox,
        badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        iconColor: 'text-blue-400',
        label: 'Integração',
      };
    case 'INTEGRACAO_AGUARDANDO_COMPLEMENTACAO':
    case 'COLABORADOR_PENDENTE':
    case 'DOCUMENTO_CORRIGIDO':
      return {
        icon: FileWarning,
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        iconColor: 'text-amber-400',
        label: 'Pendência',
      };
    default:
      return {
        icon: AlertTriangle,
        badge: 'bg-slate-700/60 text-slate-300 border-slate-600/50',
        iconColor: 'text-blue-400',
        label: 'Atualização',
      };
  }
}

export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { isAdmin, isSolicitante } = useAuth();
  const {
    companies,
    inAppNotifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    sendAdminAnnouncement,
    syncExpirationNotificationsOnServer,
    refreshInAppNotifications,
  } = useSST();

  const [activeSubTab, setActiveSubTab] = useState<'inbox' | 'broadcast'>('inbox');
  const [filterMode, setFilterMode] = useState<'unread' | 'all'>('all');
  const [syncing, setSyncing] = useState(false);

  // Admin broadcast state
  const [broadcastScope, setBroadcastScope] = useState<
    'all_solicitantes' | 'single_company' | 'company_group'
  >('all_solicitantes');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSeverity, setBroadcastSeverity] = useState<InAppNotificationSeverity>('info');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const visibleList = useMemo(() => {
    if (filterMode === 'unread') {
      return inAppNotifications.filter((n) => !n.read);
    }
    return inAppNotifications;
  }, [inAppNotifications, filterMode]);

  if (!isOpen) return null;

  const handleOpenNotification = async (n: InAppNotification) => {
    if (!n.read) {
      await markNotificationRead(n.id);
    }
    const targetTab = resolveNotificationTargetTab(n, isSolicitante);
    onNavigate(targetTab, {
      integrationId: n.integrationId,
      companyId: n.companyId || n.empresaId,
      employeeId: n.employeeId,
    });
    onClose();
  };

  const handleRefreshAndSync = async () => {
    setSyncing(true);
    try {
      await syncExpirationNotificationsOnServer();
      await refreshInAppNotifications();
    } finally {
      setSyncing(false);
    }
  };

  const toggleCompanySelection = (companyId: string) => {
    if (broadcastScope === 'single_company') {
      setSelectedCompanyIds([companyId]);
      return;
    }
    setSelectedCompanyIds((prev) =>
      prev.includes(companyId) ? prev.filter((id) => id !== companyId) : [...prev, companyId]
    );
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setBroadcastFeedback(null);

    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      setBroadcastFeedback({
        type: 'error',
        text: 'Preencha o título e a mensagem do comunicado.',
      });
      return;
    }

    if (broadcastScope !== 'all_solicitantes' && selectedCompanyIds.length === 0) {
      setBroadcastFeedback({
        type: 'error',
        text: 'Selecione ao menos uma empresa contratada destinatária.',
      });
      return;
    }

    setSendingBroadcast(true);
    try {
      const res = await sendAdminAnnouncement({
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        severity: broadcastSeverity,
        targetScope: broadcastScope,
        empresaIds: broadcastScope === 'all_solicitantes' ? undefined : selectedCompanyIds,
      });
      setBroadcastFeedback({
        type: 'success',
        text: `Comunicado enviado com sucesso (${res.count} destino(s) notificado(s)).`,
      });
      setBroadcastTitle('');
      setBroadcastMessage('');
      setSelectedCompanyIds([]);
    } catch (err: any) {
      setBroadcastFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível enviar o comunicado.',
      });
    } finally {
      setSendingBroadcast(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-xs">
      <div className="absolute inset-0" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/15 text-blue-400 border border-blue-500/30">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Central de Notificações
                {unreadNotificationsCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
                    {unreadNotificationsCount} não lida(s)
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Alertas operacionais, vencimentos e comunicados EHS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefreshAndSync}
              disabled={syncing}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Atualizar e verificar vencimentos"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin text-blue-400' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Fechar Central de Notificações"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Top Tabs (Admin gets Inbox + Enviar Comunicado) */}
        {isAdmin && (
          <div className="flex border-b border-slate-800 px-4 pt-2 gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('inbox')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                activeSubTab === 'inbox'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Notificações ({inAppNotifications.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setBroadcastFeedback(null);
                setActiveSubTab('broadcast');
              }}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === 'broadcast'
                  ? 'border-indigo-500 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Megaphone size={13} />
              Enviar Comunicado
            </button>
          </div>
        )}

        {/* INBOX VIEW */}
        {activeSubTab === 'inbox' ? (
          <>
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2.5 bg-slate-950/40">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    filterMode === 'all'
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Todas ({inAppNotifications.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('unread')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    filterMode === 'unread'
                      ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Não lidas ({unreadNotificationsCount})
                </button>
              </div>

              {unreadNotificationsCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllNotificationsRead()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
                >
                  <CheckCheck size={14} />
                  Marcar todas como lidas
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
              {visibleList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-12 w-12 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-500 mb-3">
                    <Bell size={22} />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">
                    {filterMode === 'unread'
                      ? 'Nenhuma notificação pendente'
                      : 'Nenhuma notificação registrada'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {filterMode === 'unread'
                      ? 'Todas as suas notificações já foram lidas.'
                      : 'Alertas de integrações, aprovações, reprovações e vencimentos aparecerão aqui.'}
                  </p>
                </div>
              ) : (
                visibleList.map((n) => {
                  const style = getTypeStyle(n.type, n.severity);
                  const Icon = style.icon;
                  return (
                    <div
                      key={n.id}
                      className={`rounded-xl border p-3.5 transition-all ${
                        n.read
                          ? 'bg-slate-900/60 border-slate-800/90 opacity-80 hover:opacity-100'
                          : 'bg-slate-800/70 border-blue-500/30 shadow-md'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 shrink-0 ${style.iconColor}`}>
                          <Icon size={17} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${style.badge}`}
                            >
                              {style.label}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {!n.read && (
                                <span
                                  className="h-2 w-2 rounded-full bg-blue-400"
                                  title="Não lida"
                                />
                              )}
                              <span className="text-[10px] text-slate-400">
                                {formatDateTimeBr(n.createdAt)}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs font-bold text-white leading-snug">{n.title}</p>
                          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                            {n.message}
                          </p>

                          {n.empresaNome && (
                            <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px] text-slate-400">
                              <span className="px-1.5 py-0.5 rounded bg-slate-950/70 border border-slate-800">
                                {n.empresaNome}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-2 border-t border-slate-800/70">
                            <button
                              type="button"
                              onClick={() => void handleOpenNotification(n)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 cursor-pointer"
                            >
                              <span>{n.actionLabel || 'Visualizar detalhes'}</span>
                              <ArrowRight size={13} />
                            </button>

                            {!n.read && (
                              <button
                                type="button"
                                onClick={() => void markNotificationRead(n.id)}
                                className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                              >
                                Marcar lida
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* ADMIN BROADCAST VIEW */
          <form onSubmit={handleSendBroadcast} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            <div className="rounded-xl bg-indigo-950/40 border border-indigo-500/30 p-3 text-indigo-200">
              <p className="font-semibold flex items-center gap-1.5">
                <Megaphone size={14} className="text-indigo-400" />
                Comunicado Direcionado para Contratadas
              </p>
              <p className="text-[11px] text-indigo-300/80 mt-1">
                O aviso será entregue imediatamente na Central de Notificações do perfil Solicitante
                selecionado, com registro completo de histórico.
              </p>
            </div>

            {broadcastFeedback && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2 ${
                  broadcastFeedback.type === 'success'
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                    : 'bg-red-950/50 border-red-500/40 text-red-300'
                }`}
              >
                {broadcastFeedback.type === 'success' ? (
                  <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                )}
                <span>{broadcastFeedback.text}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-300">Destinatários</label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setBroadcastScope('all_solicitantes');
                    setSelectedCompanyIds([]);
                  }}
                  className={`px-2 py-2 rounded-lg border text-center font-medium transition-colors cursor-pointer ${
                    broadcastScope === 'all_solicitantes'
                      ? 'bg-indigo-600/25 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Users size={14} className="mx-auto mb-1" />
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBroadcastScope('single_company');
                    setSelectedCompanyIds((prev) => prev.slice(0, 1));
                  }}
                  className={`px-2 py-2 rounded-lg border text-center font-medium transition-colors cursor-pointer ${
                    broadcastScope === 'single_company'
                      ? 'bg-indigo-600/25 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Building2 size={14} className="mx-auto mb-1" />
                  1 Empresa
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastScope('company_group')}
                  className={`px-2 py-2 rounded-lg border text-center font-medium transition-colors cursor-pointer ${
                    broadcastScope === 'company_group'
                      ? 'bg-indigo-600/25 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Building2 size={14} className="mx-auto mb-1" />
                  Grupo
                </button>
              </div>
            </div>

            {broadcastScope !== 'all_solicitantes' && (
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-300">
                  {broadcastScope === 'single_company'
                    ? 'Selecione a Empresa Contratada'
                    : `Selecione as Empresas (${selectedCompanyIds.length} selecionada(s))`}
                </label>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-2 space-y-1">
                  {companies.length === 0 ? (
                    <p className="text-[11px] text-slate-500 p-2">
                      Nenhuma empresa cadastrada ainda.
                    </p>
                  ) : (
                    companies.map((comp) => {
                      const checked = selectedCompanyIds.includes(comp.id);
                      return (
                        <label
                          key={comp.id}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-indigo-600/20 text-white border border-indigo-500/40'
                              : 'text-slate-300 hover:bg-slate-900'
                          }`}
                        >
                          <input
                            type={broadcastScope === 'single_company' ? 'radio' : 'checkbox'}
                            checked={checked}
                            onChange={() => toggleCompanySelection(comp.id)}
                            className="accent-indigo-500"
                          />
                          <span className="truncate font-medium">
                            {comp.nomeFantasia || comp.razaoSocial}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-300">Prioridade</label>
              <select
                value={broadcastSeverity}
                onChange={(e) => setBroadcastSeverity(e.target.value as InAppNotificationSeverity)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="info">Informativo (Normal)</option>
                <option value="warning">Atenção (Importante)</option>
                <option value="critical">Crítico (Urgente)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-300">Título do Comunicado</label>
              <input
                type="text"
                required
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="Ex.: Atualização obrigatória de NR-35 para serviços em altura"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-300">Mensagem</label>
              <textarea
                required
                rows={4}
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Descreva a orientação, prazo ou nova exigência documental..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={sendingBroadcast}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Send size={14} />
              {sendingBroadcast ? 'Enviando comunicado...' : 'Enviar Comunicado Agora'}
            </button>
          </form>
        )}
      </aside>
    </div>
  );
};
