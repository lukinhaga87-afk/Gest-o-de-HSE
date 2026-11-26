import React, { useMemo, useState } from 'react';
import {
  Building2,
  Users,
  Upload,
  FolderCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileWarning,
  RefreshCw,
  ArrowRight,
  Calendar,
  UserCheck,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import type { NavItemKey } from '../layout/Sidebar';
import {
  STANDARDIZED_STATUS_META,
  StandardizedDocStatus,
  formatDateTimePt,
  getExpirationInfo,
  resolveIntegrationItemStandardizedStatus,
} from '../../utils/documentStatus';

interface ContractorPanelViewProps {
  onNavigate: (tab: NavItemKey, opts?: { integrationId?: string }) => void;
}

export const ContractorPanelView: React.FC<ContractorPanelViewProps> = ({ onNavigate }) => {
  const { profile, activeEmpresaId } = useAuth();
  const {
    companies,
    employees,
    contractorIntegrations,
    contractorIntegrationItems,
    listIntegrationsOnServer,
    listIntegrationItemsOnServer,
  } = useSST();

  const [refreshing, setRefreshing] = useState(false);

  const myCompany = useMemo(() => {
    if (activeEmpresaId) {
      return companies.find((c) => c.id === activeEmpresaId) || null;
    }
    return null;
  }, [companies, activeEmpresaId]);

  const myEmployees = useMemo(() => {
    if (!activeEmpresaId) return [];
    return employees.filter((e) => e.empresaId === activeEmpresaId);
  }, [employees, activeEmpresaId]);

  const enrichedItems = useMemo(() => {
    return contractorIntegrationItems.map((item) => {
      const stdStatus = resolveIntegrationItemStandardizedStatus(item, item.protocoloStatus);
      const exp = getExpirationInfo(item.dataValidade, item.semValidade);
      return { item, stdStatus, exp };
    });
  }, [contractorIntegrationItems]);

  const counts = useMemo(() => {
    const map: Record<StandardizedDocStatus, number> = {
      NAO_ENVIADO: 0,
      PENDENTE_ENVIO: 0,
      AGUARDANDO_ANALISE: 0,
      EM_ANALISE: 0,
      APROVADO: 0,
      REPROVADO: 0,
      VENCIDO: 0,
      PROXIMO_VENCIMENTO: 0,
    };
    for (const row of enrichedItems) {
      map[row.stdStatus] += 1;
    }
    return map;
  }, [enrichedItems]);

  const actionRequiredItems = useMemo(() => {
    return enrichedItems
      .filter(
        ({ stdStatus }) =>
          stdStatus === 'REPROVADO' ||
          stdStatus === 'VENCIDO' ||
          stdStatus === 'PROXIMO_VENCIMENTO' ||
          stdStatus === 'PENDENTE_ENVIO' ||
          stdStatus === 'NAO_ENVIADO'
      )
      .sort((a, b) => {
        const weight = (s: StandardizedDocStatus) => {
          if (s === 'REPROVADO') return 0;
          if (s === 'VENCIDO') return 1;
          if (s === 'PENDENTE_ENVIO') return 2;
          if (s === 'NAO_ENVIADO') return 3;
          return 4;
        };
        return weight(a.stdStatus) - weight(b.stdStatus);
      });
  }, [enrichedItems]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([listIntegrationsOnServer(), listIntegrationItemsOnServer()]);
    } catch {
      // Errors handled silently in context
    } finally {
      setRefreshing(false);
    }
  };

  const pendingToSendCount = counts.NAO_ENVIADO + counts.PENDENTE_ENVIO;
  const underReviewCount = counts.AGUARDANDO_ANALISE + counts.EM_ANALISE;
  const expiringOrExpiredCount = counts.VENCIDO + counts.PROXIMO_VENCIMENTO;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <ShieldCheck className="text-blue-400" size={22} />
            Painel da Contratada
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Acompanhamento espelhado da sua empresa, colaboradores, envios documentais, retornos do EHS e vencimentos.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Atualizar Status
          </button>
          <button
            type="button"
            onClick={() => onNavigate('envio_documentos')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition-colors"
          >
            <Upload size={14} />
            Enviar Documentos
          </button>
        </div>
      </div>

      {/* Company Identification Banner */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 shrink-0">
            <Building2 size={22} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              Empresa Vinculada
            </p>
            <h3 className="text-base font-bold text-white mt-0.5">
              {myCompany
                ? myCompany.razaoSocial
                : contractorIntegrations[0]?.empresaNome || 'Cadastre sua empresa para iniciar'}
            </h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1">
              {myCompany && (
                <>
                  <span>CNPJ: <strong className="text-slate-200 font-mono">{myCompany.cnpj}</strong></span>
                  <span>Responsável SST: <strong className="text-slate-200">{myCompany.responsavelSST || '—'}</strong></span>
                  <span>
                    Situação:{' '}
                    <span
                      className={`font-semibold ${
                        myCompany.situacao === 'ativa' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {myCompany.situacao === 'ativa' ? 'Ativa' : 'Inativa'}
                    </span>
                  </span>
                </>
              )}
              {!myCompany && (
                <span>
                  Responsável logado: <strong className="text-slate-200">{profile?.nome}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('empresas')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Minha Empresa
          </button>
          <button
            type="button"
            onClick={() => onNavigate('colaboradores')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Meus Colaboradores ({myEmployees.length})
          </button>
          <button
            type="button"
            onClick={() => onNavigate('gestao_integracao')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            Protocolos ({contractorIntegrations.length})
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('pendencias_vencimentos')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-rose-500/30 hover:border-rose-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
              Reprovados
            </span>
            <XCircle size={17} className="text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{counts.REPROVADO}</p>
          <p className="text-[11px] text-slate-400 mt-1">Exigem correção e reenvio</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('envio_documentos')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-amber-500/30 hover:border-amber-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Pendentes de Envio
            </span>
            <FileWarning size={17} className="text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{pendingToSendCount}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {counts.NAO_ENVIADO} não enviado(s) · {counts.PENDENTE_ENVIO} pendente(s)
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('gestao_integracao')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-sky-500/30 hover:border-sky-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
              Em Análise EHS
            </span>
            <Clock size={17} className="text-sky-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{underReviewCount}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {counts.AGUARDANDO_ANALISE} aguardando · {counts.EM_ANALISE} em análise
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('pendencias_vencimentos')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-orange-500/30 hover:border-orange-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-300">
              Vencimentos
            </span>
            <AlertTriangle size={17} className="text-orange-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{expiringOrExpiredCount}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {counts.VENCIDO} vencido(s) · {counts.PROXIMO_VENCIMENTO} próx. vencimento
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('gestao_integracao')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-emerald-500/30 hover:border-emerald-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Aprovados
            </span>
            <CheckCircle2 size={17} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{counts.APROVADO}</p>
          <p className="text-[11px] text-slate-400 mt-1">Conformes e dentro da validade</p>
        </button>
      </div>

      {/* Action Required / Mirrored Rejections & Pendencies */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              Pendências, Reprovações e Vencimentos que Exigem Ação
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Todas as decisões, justificativas e prazos definidos pelo Administrador EHS aparecem aqui imediatamente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('pendencias_vencimentos')}
            className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            Ver painel completo <ArrowRight size={13} />
          </button>
        </div>

        {actionRequiredItems.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-white">
              Nenhuma pendência documental ou reprovação aberta
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {contractorIntegrations.length === 0
                ? 'Inicie uma nova integração em Envio de Documentos ou Gestão de Integração para enviar os documentos obrigatórios.'
                : 'Todos os documentos enviados estão em análise ou aprovados dentro da validade.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {actionRequiredItems.slice(0, 8).map(({ item, stdStatus, exp }) => {
              const meta = STANDARDIZED_STATUS_META[stdStatus];
              return (
                <div
                  key={item.id}
                  className="p-4 hover:bg-slate-800/40 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </span>
                      <span className="text-xs font-bold text-white truncate">
                        {item.nomeExibicao}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {item.codigoProtocolo} · v{item.versaoAtual || 0}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                      <span>
                        Alvo:{' '}
                        <strong className="text-slate-200">
                          {item.colaboradorNome || item.empresaNome}
                        </strong>
                      </span>
                      {item.dataValidade && !item.semValidade && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={11} />
                          Validade: <strong className="text-slate-200">{exp.formattedDate}</strong> ({exp.label})
                        </span>
                      )}
                      {item.analisadoPorNome && (
                        <span className="inline-flex items-center gap-1">
                          <UserCheck size={11} />
                          Avaliado por {item.analisadoPorNome} em {formatDateTimePt(item.dataAnalise)}
                        </span>
                      )}
                    </div>

                    {stdStatus === 'REPROVADO' && item.motivoReprovacao && (
                      <div className="mt-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
                        <strong className="text-rose-300">Motivo da reprovação EHS:</strong>{' '}
                        {item.motivoReprovacao}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate('envio_documentos', { integrationId: item.integrationId })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
                    >
                      <Upload size={13} />
                      {stdStatus === 'REPROVADO'
                        ? 'Corrigir e Reenviar'
                        : stdStatus === 'VENCIDO' || stdStatus === 'PROXIMO_VENCIMENTO'
                        ? 'Renovar Documento'
                        : 'Anexar Documento'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Protocols Summary */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderCheck size={16} className="text-blue-400" />
              Meus Processos de Integração
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Acompanhe o andamento dos protocolos enviados para o Administrador EHS.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('gestao_integracao')}
            className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            Abrir Gestão de Integração <ArrowRight size={13} />
          </button>
        </div>

        {contractorIntegrations.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            Nenhum protocolo de integração criado até o momento. Clique em{' '}
            <button
              type="button"
              onClick={() => onNavigate('envio_documentos')}
              className="text-blue-400 hover:underline font-semibold"
            >
              Envio de Documentos
            </button>{' '}
            para iniciar.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {contractorIntegrations.slice(0, 6).map((integ) => (
              <div
                key={integ.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-400">
                      {integ.codigoProtocolo}
                    </span>
                    <span className="text-xs font-semibold text-white truncate">
                      {integ.empresaNome}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-300">
                      {integ.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      <Users size={11} className="inline mr-1" />
                      {integ.colaboradoresCandidatos?.length || integ.colaboradorIds?.length || 0} colaborador(es)
                    </span>
                    <span>
                      Aprovados: <strong className="text-emerald-400">{integ.resumoItens?.aprovados || 0}</strong>/
                      {integ.resumoItens?.total || 0}
                    </span>
                    {(integ.resumoItens?.reprovados || 0) > 0 && (
                      <span className="text-rose-400 font-semibold">
                        {integ.resumoItens.reprovados} reprovado(s)
                      </span>
                    )}
                    <span>Atualizado em {formatDateTimePt(integ.dataUltimaAtualizacao)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onNavigate('envio_documentos', { integrationId: integ.id })
                  }
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
                >
                  Abrir Protocolo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
