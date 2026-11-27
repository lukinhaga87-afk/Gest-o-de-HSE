import React, { useMemo, useState } from 'react';
import {
  Building2,
  Users,
  FileCheck2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CalendarClock,
  FolderCheck,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import type { NavItemKey } from '../layout/Sidebar';
import {
  STANDARDIZED_STATUS_META,
  StandardizedDocStatus,
  formatDateTimePt,
  resolveIntegrationItemStandardizedStatus,
} from '../../utils/documentStatus';

interface DashboardViewProps {
  onNavigate: (tab: NavItemKey, opts?: { integrationId?: string }) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    companies,
    employees,
    documents,
    trainings,
    exams,
    contractorIntegrations,
    contractorIntegrationItems,
    listIntegrationsOnServer,
    listIntegrationItemsOnServer,
  } = useSST();

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([listIntegrationsOnServer(), listIntegrationItemsOnServer()]);
    } catch {
      // handled in context
    } finally {
      setRefreshing(false);
    }
  };

  // Unified Official Base + Integration Queue indicators (strictly counting ONLY approved records as valid/compliant)
  const docStats = useMemo(() => {
    const byStatus: Record<StandardizedDocStatus, number> = {
      NAO_ENVIADO: 0,
      PENDENTE_ENVIO: 0,
      AGUARDANDO_ANALISE: 0,
      EM_ANALISE: 0,
      APROVADO: 0,
      REPROVADO: 0,
      VENCIDO: 0,
      PROXIMO_VENCIMENTO: 0,
    };

    const linkedOfficial = new Set<string>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const classifyExpiry = (validade?: string, semValidade?: boolean): 'valid' | 'expiring' | 'expired' => {
      if (semValidade || !validade) return 'valid';
      const dt = new Date(`${validade.slice(0, 10)}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return 'valid';
      const diffDays = Math.ceil((dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return 'expired';
      if (diffDays <= 30) return 'expiring';
      return 'valid';
    };

    let trainingsExpiring = 0;
    let trainingsExpired = 0;
    let docsExpiring = 0;
    let docsExpired = 0;
    let directPendingAnalysis = 0;
    let directRejected = 0;

    for (const item of contractorIntegrationItems) {
      if (item.officialRecordId) {
        linkedOfficial.add(`${item.officialCollection || 'documents'}:${item.officialRecordId}`);
      }
      const st = resolveIntegrationItemStandardizedStatus(item, item.protocoloStatus);
      byStatus[st] += 1;
      if (item.status === 'APROVADO') {
        const exp = classifyExpiry(item.dataValidade, item.semValidade);
        if (item.origemColecao === 'trainings') {
          if (exp === 'expired') trainingsExpired += 1;
          else if (exp === 'expiring') trainingsExpiring += 1;
        } else {
          if (exp === 'expired') docsExpired += 1;
          else if (exp === 'expiring') docsExpiring += 1;
        }
      }
    }

    // Complement with official documents/exams/trainings not already represented by integration items
    for (const doc of documents) {
      if (linkedOfficial.has(`documents:${doc.id}`)) continue;
      if (doc.situacao === 'pendente') {
        byStatus.AGUARDANDO_ANALISE += 1;
        directPendingAnalysis += 1;
      } else if (doc.situacao === 'reprovado') {
        byStatus.REPROVADO += 1;
        directRejected += 1;
      } else if (doc.situacao === 'aprovado') {
        const exp = classifyExpiry(doc.dataValidade, doc.semValidade);
        if (exp === 'expired') {
          byStatus.VENCIDO += 1;
          docsExpired += 1;
        } else if (exp === 'expiring') {
          byStatus.PROXIMO_VENCIMENTO += 1;
          docsExpiring += 1;
        } else {
          byStatus.APROVADO += 1;
        }
      }
    }

    for (const ex of exams) {
      if (linkedOfficial.has(`exams:${ex.id}`)) continue;
      if (ex.situacao === 'pendente') {
        byStatus.AGUARDANDO_ANALISE += 1;
        directPendingAnalysis += 1;
      } else if (ex.situacao === 'reprovado') {
        byStatus.REPROVADO += 1;
        directRejected += 1;
      } else if (ex.situacao === 'aprovado') {
        const exp = classifyExpiry(ex.dataValidade, ex.semValidade);
        if (exp === 'expired') {
          byStatus.VENCIDO += 1;
          docsExpired += 1;
        } else if (exp === 'expiring') {
          byStatus.PROXIMO_VENCIMENTO += 1;
          docsExpiring += 1;
        } else {
          byStatus.APROVADO += 1;
        }
      }
    }

    for (const tr of trainings) {
      if (linkedOfficial.has(`trainings:${tr.id}`)) continue;
      if (tr.situacao === 'pendente') {
        byStatus.AGUARDANDO_ANALISE += 1;
        directPendingAnalysis += 1;
      } else if (tr.situacao === 'reprovado') {
        byStatus.REPROVADO += 1;
        directRejected += 1;
      } else if (tr.situacao === 'aprovado') {
        const exp = classifyExpiry(tr.dataValidade, tr.semValidade);
        if (exp === 'expired') {
          byStatus.VENCIDO += 1;
          trainingsExpired += 1;
        } else if (exp === 'expiring') {
          byStatus.PROXIMO_VENCIMENTO += 1;
          trainingsExpiring += 1;
        } else {
          byStatus.APROVADO += 1;
        }
      }
    }

    const total = Object.values(byStatus).reduce((acc, n) => acc + n, 0);
    // Official Base Rule: ONLY approved & non-expired records count as compliant
    const validOfficial = byStatus.APROVADO + byStatus.PROXIMO_VENCIMENTO;
    const complianceRate = total > 0 ? Math.round((validOfficial / total) * 100) : 0;

    return {
      byStatus,
      total,
      validOfficial,
      complianceRate,
      trainingsExpiring,
      trainingsExpired,
      docsExpiring,
      docsExpired,
      directPendingAnalysis,
      directRejected,
    };
  }, [contractorIntegrationItems, documents, exams, trainings]);

  const integrationMetrics = useMemo(() => {
    const completed = contractorIntegrations.filter((i) => i.status === 'APROVADA').length;
    const inProgress = contractorIntegrations.filter((i) =>
      [
        'RASCUNHO',
        'PENDENTE_DOCUMENTACAO',
        'EM_ENVIO',
        'ENVIADA',
        'AGUARDANDO_ANALISE',
        'EM_ANALISE',
        'PENDENTE_CORRECAO',
        'REENVIADA',
      ].includes(i.status)
    ).length;

    const integratedEmpIds = new Set<string>();
    for (const integ of contractorIntegrations) {
      if (integ.status !== 'APROVADA') continue;
      (integ.colaboradorIds || []).forEach((id) => integratedEmpIds.add(id));
      (integ.colaboradoresCandidatos || []).forEach((nc) => {
        const resolvedId = nc.aprovadoEmployeeId || nc.colaboradorId;
        if (resolvedId) integratedEmpIds.add(resolvedId);
      });
    }
    for (const emp of employees) {
      if (emp.dataIntegracao) integratedEmpIds.add(emp.id);
    }

    return {
      completed,
      inProgress,
      integratedEmployeesCount: integratedEmpIds.size,
    };
  }, [contractorIntegrations, employees]);

  const companySummaryRows = useMemo(() => {
    return companies.map((comp) => {
      const compEmps = employees.filter((e) => e.empresaId === comp.id);
      const compItems = contractorIntegrationItems.filter((it) => it.empresaId === comp.id);
      let approved = 0;
      let awaiting = 0;
      let rejected = 0;
      let expired = 0;
      let expiring = 0;

      for (const it of compItems) {
        const st = resolveIntegrationItemStandardizedStatus(it, it.protocoloStatus);
        if (st === 'APROVADO') approved++;
        else if (st === 'AGUARDANDO_ANALISE' || st === 'EM_ANALISE') awaiting++;
        else if (st === 'REPROVADO') rejected++;
        else if (st === 'VENCIDO') expired++;
        else if (st === 'PROXIMO_VENCIMENTO') expiring++;
      }

      const compProtocols = contractorIntegrations.filter((i) => i.empresaId === comp.id);
      const pct =
        compItems.length > 0 ? Math.round(((approved + expiring) / compItems.length) * 100) : 0;

      return {
        company: comp,
        employeeCount: compEmps.length,
        protocolCount: compProtocols.length,
        totalDocs: compItems.length,
        approved,
        awaiting,
        rejected,
        expired,
        expiring,
        pct,
      };
    });
  }, [companies, employees, contractorIntegrations, contractorIntegrationItems]);

  const pendingProtocols = useMemo(() => {
    return contractorIntegrations
      .filter(
        (i) =>
          i.status === 'AGUARDANDO_ANALISE' ||
          i.status === 'ENVIADA' ||
          i.status === 'EM_ANALISE' ||
          i.status === 'REENVIADA'
      )
      .slice(0, 6);
  }, [contractorIntegrations]);

  const activeCompaniesCount = companies.filter((c) => c.situacao === 'ativa').length;
  const activeEmployeesCount = employees.filter((e) => e.situacaoCadastral === 'ativo').length;
  const awaitingDocsCount = docStats.byStatus.AGUARDANDO_ANALISE + docStats.byStatus.EM_ANALISE;
  const rejectedDocsCount = docStats.byStatus.REPROVADO;
  const alertsCount = docStats.byStatus.VENCIDO + docStats.byStatus.PROXIMO_VENCIMENTO;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <ShieldCheck className="text-blue-400" size={22} />
            Dashboard — Gestão de Terceiros e Integrações EHS
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Indicadores consolidados da base oficial aprovada, fila de análise documental, integrações e vencimentos. Documentos pendentes ou recusados nunca contam como conformes.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Sincronizar
          </button>
          <button
            type="button"
            onClick={() => onNavigate('analise_documental')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition-colors"
          >
            <FileCheck2 size={14} />
            Central de Análise ({awaitingDocsCount})
          </button>
        </div>
      </div>

      {/* 4-Color Traffic Light Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5">
        <span className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
          Legenda de Conformidade:
        </span>
        <span className="inline-flex items-center gap-1.5 text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Verde: Válido e Aprovado
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-300">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Amarelo: Próximo do Vencimento (≤ 30d)
        </span>
        <span className="inline-flex items-center gap-1.5 text-rose-300">
          <span className="h-2 w-2 rounded-full bg-rose-400" />
          Vermelho: Vencido / Recusado / Crítico
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-300">
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          Cinza: Pendente / Não Informado
        </span>
      </div>

      {/* Primary KPI Row (Section 9 Complete Set) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('colaboradores')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-emerald-500/30 hover:border-emerald-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Colaboradores Integrados
            </span>
            <Users size={17} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">
            {integrationMetrics.integratedEmployeesCount}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            de {employees.length} cadastrado(s) ({activeEmployeesCount} ativo(s))
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('gestao_integracoes')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-blue-500/30 hover:border-blue-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-300">
              Integrações
            </span>
            <FolderCheck size={17} className="text-blue-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">
            {integrationMetrics.completed}{' '}
            <span className="text-xs font-semibold text-slate-400">concluída(s)</span>
          </p>
          <p className="text-[11px] text-amber-300 mt-1">
            {integrationMetrics.inProgress} em andamento · {activeCompaniesCount}/{companies.length} emp.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('analise_documental')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-slate-700 hover:border-sky-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
              Análise & Recusados
            </span>
            <Clock size={17} className="text-sky-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">{awaitingDocsCount}</p>
          <p className="text-[11px] text-rose-300 mt-1">
            {rejectedDocsCount} recusado(s) aguardando correção
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('controle_vencimentos')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-amber-500/30 hover:border-amber-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Treinamentos (Vencimentos)
            </span>
            <CalendarClock size={17} className="text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">
            {docStats.trainingsExpired + docStats.trainingsExpiring}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            <span className="text-rose-400 font-semibold">{docStats.trainingsExpired} vencido(s)</span> ·{' '}
            <span className="text-amber-300">{docStats.trainingsExpiring} a vencer</span>
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('controle_vencimentos')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-rose-500/30 hover:border-rose-400/60 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
              Documentos (Vencimentos)
            </span>
            <AlertTriangle size={17} className="text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-2">
            {docStats.docsExpired + docStats.docsExpiring}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            <span className="text-rose-400 font-semibold">{docStats.docsExpired} vencido(s)</span> ·{' '}
            <span className="text-amber-300">{docStats.docsExpiring} a vencer</span> · Base Oficial {docStats.complianceRate}% ({alertsCount} alertas)
          </p>
        </button>
      </div>

      {/* Real Distribution Across Standardized Document Statuses */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">
              Distribuição Real dos Documentos Submetidos
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Contagem calculada exclusivamente a partir dos documentos ativos no sistema (fonte única).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('analise_documental')}
            className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            Analisar todos <ArrowRight size={13} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(
            [
              'AGUARDANDO_ANALISE',
              'EM_ANALISE',
              'APROVADO',
              'REPROVADO',
              'PROXIMO_VENCIMENTO',
              'VENCIDO',
            ] as StandardizedDocStatus[]
          ).map((code) => {
            const meta = STANDARDIZED_STATUS_META[code];
            const count = docStats.byStatus[code];
            const pct = docStats.total > 0 ? Math.round((count / docStats.total) * 100) : 0;
            return (
              <div
                key={code}
                className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-2"
              >
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                  {meta.shortLabel}
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-extrabold text-white">{count}</span>
                  <span className="text-[11px] text-slate-500">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${meta.dotClass}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-Column Operational Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Integrations Queue */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderCheck size={16} className="text-blue-400" />
                Integrações Aguardando Análise EHS
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Protocolos submetidos ou reenviados prontos para conferência.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('gestao_integracoes')}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
            >
              Ver fila <ArrowRight size={13} />
            </button>
          </div>

          {pendingProtocols.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-2" />
              Nenhum protocolo pendente de análise no momento.
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {pendingProtocols.map((integ) => (
                <div
                  key={integ.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-400">
                        {integ.codigoProtocolo}
                      </span>
                      <span className="text-xs font-semibold text-white truncate">
                        {integ.empresaNome}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {integ.status.replace(/_/g, ' ')} · {integ.resumoItens?.aprovados || 0}/
                      {integ.resumoItens?.total || 0} aprovados · Atualizado em{' '}
                      {formatDateTimePt(integ.dataUltimaAtualizacao)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate('gestao_integracoes', { integrationId: integ.id })
                    }
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-semibold text-blue-300"
                  >
                    Analisar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compliance Breakdown by Contractor Company */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 size={16} className="text-indigo-400" />
                Panorama por Empresa Contratada
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Situação documental real de cada prestadora cadastrada.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('empresas')}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
            >
              Ver todas <ArrowRight size={13} />
            </button>
          </div>

          {companySummaryRows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Nenhuma empresa contratada cadastrada ainda.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 max-h-[340px] overflow-y-auto custom-scrollbar">
              {companySummaryRows.map((row) => (
                <div
                  key={row.company.id}
                  className="px-5 py-3.5 hover:bg-slate-800/40 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">
                      {row.company.nomeFantasia || row.company.razaoSocial}
                    </span>
                    <span className="text-xs font-bold text-emerald-400 shrink-0">
                      {row.totalDocs > 0 ? `${row.pct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>{row.employeeCount} colab.</span>
                    <span>{row.protocolCount} protocolo(s)</span>
                    {row.awaiting > 0 && (
                      <span className="text-sky-300">{row.awaiting} em análise</span>
                    )}
                    {row.rejected > 0 && (
                      <span className="text-rose-300 inline-flex items-center gap-0.5">
                        <XCircle size={11} /> {row.rejected} reprovado(s)
                      </span>
                    )}
                    {(row.expired > 0 || row.expiring > 0) && (
                      <span className="text-orange-300 inline-flex items-center gap-0.5">
                        <AlertTriangle size={11} /> {row.expired} venc. / {row.expiring} próx.
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
