import React, { useMemo, useState } from 'react';
import {
  ActivityComplianceItemResult,
  ActivityComplianceResult,
  ActivityProfile,
  ActivityRequirementComplianceStatus,
} from '../../types/sst';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileWarning,
  Layers,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';

interface ComplianceChecklistPanelProps {
  compliance: ActivityComplianceResult | null;
  activityProfiles?: ActivityProfile[];
  sourceLabel?: 'server' | 'preview';
  compact?: boolean;
  defaultTab?: ChecklistTab;
}

type ChecklistTab = 'resumo' | 'empresa' | 'atividade' | 'colaborador' | 'atividade_pt';
type ItemFilter = 'todos' | 'bloqueantes' | 'pendentes' | 'a_vencer' | 'conformes';

const STATUS_META: Record<
  ActivityRequirementComplianceStatus,
  { label: string; textClass: string; bgClass: string; borderClass: string }
> = {
  CONFORME: {
    label: 'CONFORME',
    textClass: 'text-emerald-300',
    bgClass: 'bg-emerald-500/15',
    borderClass: 'border-emerald-500/30',
  },
  A_VENCER: {
    label: 'A VENCER',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-500/15',
    borderClass: 'border-amber-500/30',
  },
  PENDENTE_APROVACAO: {
    label: 'PENDENTE APROVAÇÃO',
    textClass: 'text-sky-300',
    bgClass: 'bg-sky-500/15',
    borderClass: 'border-sky-500/30',
  },
  VENCIDO: {
    label: 'VENCIDO',
    textClass: 'text-rose-300',
    bgClass: 'bg-rose-500/15',
    borderClass: 'border-rose-500/30',
  },
  REPROVADO: {
    label: 'REPROVADO',
    textClass: 'text-rose-300',
    bgClass: 'bg-rose-500/15',
    borderClass: 'border-rose-500/30',
  },
  ASO_INAPTO: {
    label: 'ASO INAPTO',
    textClass: 'text-red-300',
    bgClass: 'bg-red-500/20',
    borderClass: 'border-red-500/40',
  },
  AUSENTE: {
    label: 'AUSENTE',
    textClass: 'text-slate-300',
    bgClass: 'bg-slate-800',
    borderClass: 'border-slate-700',
  },
};

const SCOPE_LABELS: Record<ActivityComplianceItemResult['escopo'], string> = {
  empresa: 'Empresa',
  colaborador: 'Colaborador',
  atividade_pt: 'Atividade / PT',
};

function formatDateBr(value?: string): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function renderStatusIcon(status: ActivityRequirementComplianceStatus) {
  switch (status) {
    case 'CONFORME':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'A_VENCER':
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'PENDENTE_APROVACAO':
      return <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'VENCIDO':
    case 'REPROVADO':
    case 'ASO_INAPTO':
      return <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    case 'AUSENTE':
    default:
      return <FileWarning className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  }
}

export const ComplianceChecklistPanel: React.FC<ComplianceChecklistPanelProps> = ({
  compliance,
  activityProfiles = [],
  sourceLabel = 'preview',
  compact = false,
  defaultTab = 'resumo',
}) => {
  const [activeTab, setActiveTab] = useState<ChecklistTab>(defaultTab);
  const [itemFilter, setItemFilter] = useState<ItemFilter>('todos');

  const activityNameMap = useMemo(() => {
    const map = new Map<string, ActivityProfile>();
    for (const act of activityProfiles) {
      map.set(act.id, act);
    }
    return map;
  }, [activityProfiles]);

  const applyFilter = (items: ActivityComplianceItemResult[]) => {
    switch (itemFilter) {
      case 'bloqueantes':
        return items.filter((i) => i.bloqueante);
      case 'pendentes':
        return items.filter((i) => i.status === 'PENDENTE_APROVACAO');
      case 'a_vencer':
        return items.filter((i) => i.status === 'A_VENCER');
      case 'conformes':
        return items.filter((i) => i.status === 'CONFORME');
      default:
        return items;
    }
  };

  const allItems = useMemo<ActivityComplianceItemResult[]>(() => {
    if (!compliance) return [];
    return [
      ...compliance.itensEmpresa,
      ...compliance.itensAtividade,
      ...compliance.colaboradores.flatMap((c) => c.itens),
    ];
  }, [compliance]);

  const itemsByActivity = useMemo(() => {
    if (!compliance) return [];
    const groups = new Map<
      string,
      { id: string; nome: string; codigo?: string; items: ActivityComplianceItemResult[] }
    >();

    for (const actId of compliance.atividadeIds) {
      const profile = activityNameMap.get(actId);
      groups.set(actId, {
        id: actId,
        nome: profile?.nome || actId,
        codigo: profile?.codigo,
        items: [],
      });
    }

    const unmapped: ActivityComplianceItemResult[] = [];
    for (const item of allItems) {
      const ids =
        item.activityIds && item.activityIds.length > 0
          ? item.activityIds
          : item.activityId
          ? [item.activityId]
          : [];
      if (ids.length === 0) {
        unmapped.push(item);
      } else {
        for (const aid of ids) {
          if (!groups.has(aid)) {
            const profile = activityNameMap.get(aid);
            groups.set(aid, {
              id: aid,
              nome: profile?.nome || aid,
              codigo: profile?.codigo,
              items: [],
            });
          }
          groups.get(aid)!.items.push(item);
        }
      }
    }

    const result = Array.from(groups.values());
    if (unmapped.length > 0) {
      result.push({ id: '__geral__', nome: 'Requisitos Gerais / Transversais', items: unmapped });
    }
    return result;
  }, [compliance, allItems, activityNameMap]);

  if (!compliance) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-xs text-slate-400">
        Selecione uma empresa contratada ativa e ao menos uma atividade crítica para gerar o checklist automático de conformidade documental.
      </div>
    );
  }

  const empresaItems = applyFilter(compliance.itensEmpresa);
  const atividadePtItems = applyFilter(compliance.itensAtividade);
  const allFilteredItems = applyFilter(allItems);

  const overallBanner =
    compliance.statusGeral === 'conforme'
      ? {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
          title: 'Documentação 100% Conforme — Apta para Aprovação/Liberação',
        }
      : compliance.statusGeral === 'atencao'
      ? {
          bg: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
          title: 'Apta com Atenção — Documentos Válidos Próximos do Vencimento (≤ 30 dias)',
        }
      : {
          bg: 'bg-rose-500/10 border-rose-500/30 text-rose-200',
          icon: <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />,
          title: `Liberação Bloqueada — ${compliance.resumo.bloqueiosObrigatorios} Pendência(s) Obrigatória(s)`,
        };

  const renderItemsTable = (items: ActivityComplianceItemResult[], emptyText: string) => {
    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-xs text-slate-400">
          {emptyText}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/90 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-2.5 px-3">Documento / Código</th>
              <th className="py-2.5 px-3">Escopo / Responsável</th>
              <th className="py-2.5 px-3">Status Oficial</th>
              <th className="py-2.5 px-3">Emissão / Validade</th>
              <th className="py-2.5 px-3">Criticidade</th>
              <th className="py-2.5 px-3">Motivo / Evidência</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-xs">
            {items.map((item, idx) => {
              const meta = STATUS_META[item.status] || STATUS_META.AUSENTE;
              const responsavel =
                item.escopo === 'colaborador'
                  ? item.colaboradorNome || 'Colaborador não identificado'
                  : compliance.empresaNome;

              return (
                <tr
                  key={`${item.requirementId}_${item.colaboradorId || 'emp'}_${idx}`}
                  className={
                    item.bloqueante
                      ? 'bg-rose-500/5 hover:bg-rose-500/10'
                      : 'hover:bg-slate-900/70'
                  }
                >
                  <td className="py-2.5 px-3 align-top">
                    <div className="font-semibold text-white">{item.nomeExibicao}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                      <span>{item.documentoCodigoCanonico}</span>
                      {item.baseLegal && (
                        <span className="font-sans text-slate-500">• {item.baseLegal}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 align-top">
                    <div className="font-medium text-slate-200">{SCOPE_LABELS[item.escopo]}</div>
                    <div
                      className="text-[11px] text-slate-400 truncate max-w-[180px]"
                      title={responsavel}
                    >
                      {responsavel}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                    >
                      {renderStatusIcon(item.status)}
                      {meta.label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap tabular-nums text-[11px]">
                    <div className="text-slate-400">
                      Emissão:{' '}
                      <span className="font-medium text-slate-200">
                        {formatDateBr(item.dataEmissao)}
                      </span>
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      Validade:{' '}
                      <span className="font-medium text-slate-200">
                        {item.dataValidade
                          ? formatDateBr(item.dataValidade)
                          : item.status === 'CONFORME'
                          ? 'Sem vencimento'
                          : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    {item.bloqueante ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-400">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Bloqueante
                      </span>
                    ) : item.status === 'A_VENCER' || !item.obrigatorioParaLiberacao ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {item.obrigatorioParaLiberacao ? 'Atenção' : 'Informativo'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Atendido
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 align-top text-slate-300 max-w-xs">
                    <p className="leading-snug">{item.motivo}</p>
                    {item.matchedTitulo && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Registro: {item.matchedTitulo}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      <div
        className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${overallBanner.bg}`}
      >
        <div className="flex items-start gap-2.5">
          {overallBanner.icon}
          <div>
            <p className="text-xs sm:text-sm font-bold leading-tight text-white">
              {overallBanner.title}
            </p>
            <p className="text-[11px] opacity-90 mt-0.5">
              Avaliado para <span className="font-semibold">{compliance.empresaNome}</span> •{' '}
              {sourceLabel === 'server'
                ? 'Validação oficial executada no servidor'
                : 'Pré-avaliação local (aprovação e liberação exigem validação oficial no servidor)'}
            </p>
          </div>
        </div>
        <div className="text-[11px] font-mono opacity-80 whitespace-nowrap">
          {new Date(compliance.avaliadoEm).toLocaleString('pt-BR')}
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div
        className={`grid grid-cols-2 ${
          compact ? 'sm:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-5'
        } gap-2.5`}
      >
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5">
          <p className="text-[11px] font-medium text-slate-400">Requisitos Avaliados</p>
          <p className="text-lg font-bold text-white tabular-nums mt-0.5">
            {compliance.resumo.totalRequisitosAvaliados}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
          <p className="text-[11px] font-medium text-emerald-400">Conformes</p>
          <p className="text-lg font-bold text-emerald-300 tabular-nums mt-0.5">
            {compliance.resumo.conformes}
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <p className="text-[11px] font-medium text-amber-400">A Vencer (≤ 30d)</p>
          <p className="text-lg font-bold text-amber-300 tabular-nums mt-0.5">
            {compliance.resumo.alertasAVencer}
          </p>
        </div>
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2.5">
          <p className="text-[11px] font-medium text-sky-400">Pendentes Aprovação</p>
          <p className="text-lg font-bold text-sky-300 tabular-nums mt-0.5">
            {compliance.resumo.pendentesAprovacao}
          </p>
        </div>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
          <p className="text-[11px] font-medium text-rose-400">Bloqueios Obrigatórios</p>
          <p className="text-lg font-bold text-rose-300 tabular-nums mt-0.5">
            {compliance.resumo.bloqueiosObrigatorios}
          </p>
        </div>
      </div>

      {/* Block Reasons */}
      {compliance.motivosBloqueio.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-xs font-bold text-rose-200 mb-1.5 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            Pendências Bloqueantes Identificadas
          </p>
          <ul className="space-y-1 text-xs text-rose-200/90 list-disc list-inside">
            {compliance.motivosBloqueio.slice(0, 12).map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
            {compliance.motivosBloqueio.length > 12 && (
              <li className="font-semibold text-rose-100">
                + {compliance.motivosBloqueio.length - 12} pendência(s) adicional(is) detalhada(s) na tabela abaixo.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Tabs + Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            {
              id: 'resumo' as const,
              label: 'Resumo Consolidado',
              icon: FileCheck2,
              count: allItems.length,
            },
            {
              id: 'empresa' as const,
              label: 'Empresa',
              icon: Building2,
              count: compliance.itensEmpresa.length,
            },
            {
              id: 'atividade' as const,
              label: 'Por Atividade',
              icon: Layers,
              count: itemsByActivity.length,
            },
            {
              id: 'colaborador' as const,
              label: 'Por Colaborador',
              icon: UserCheck,
              count: compliance.colaboradores.length,
            },
            {
              id: 'atividade_pt' as const,
              label: 'Atividade / PT',
              icon: ShieldCheck,
              count: compliance.itensAtividade.length,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                <span
                  className={`ml-0.5 tabular-nums ${
                    active ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  ({tab.count})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-400">Filtro:</span>
          <select
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value as ItemFilter)}
            className="text-xs border border-slate-700 rounded-lg px-2.5 py-1.5 bg-slate-950 text-slate-200 font-medium focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os itens</option>
            <option value="bloqueantes">Somente Bloqueantes</option>
            <option value="pendentes">Pendentes de Aprovação</option>
            <option value="a_vencer">A Vencer (≤ 30d)</option>
            <option value="conformes">Conformes</option>
          </select>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'resumo' &&
        renderItemsTable(
          allFilteredItems,
          'Nenhum item documental encontrado para o filtro selecionado.'
        )}

      {activeTab === 'empresa' &&
        renderItemsTable(
          empresaItems,
          'Nenhum requisito de escopo Empresa encontrado para o filtro selecionado.'
        )}

      {activeTab === 'atividade_pt' &&
        renderItemsTable(
          atividadePtItems,
          'Nenhum requisito de escopo Atividade / PT encontrado para o filtro selecionado.'
        )}

      {activeTab === 'atividade' && (
        <div className="space-y-4">
          {itemsByActivity.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
              Nenhuma atividade associada à avaliação.
            </div>
          ) : (
            itemsByActivity.map((group) => {
              const filtered = applyFilter(group.items);
              const blockers = group.items.filter((i) => i.bloqueante).length;
              return (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{group.nome}</span>
                      {group.codigo && (
                        <span className="text-[11px] font-mono text-slate-400">
                          {group.codigo}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-semibold ${
                        blockers > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {blockers > 0
                        ? `${blockers} bloqueio(s)`
                        : 'Sem bloqueios obrigatórios'}
                    </span>
                  </div>
                  {renderItemsTable(
                    filtered,
                    'Nenhum item nesta atividade para o filtro selecionado.'
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'colaborador' && (
        <div className="space-y-4">
          {compliance.colaboradores.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-xs text-slate-400">
              Nenhum colaborador terceirizado selecionado para avaliação individual.
            </div>
          ) : (
            compliance.colaboradores.map((empSummary) => {
              const filtered = applyFilter(empSummary.itens);
              const badgeColor =
                empSummary.statusGeral === 'conforme'
                  ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                  : empSummary.statusGeral === 'atencao'
                  ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                  : 'text-rose-300 bg-rose-500/15 border-rose-500/30';
              return (
                <div
                  key={empSummary.colaboradorId}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-white">
                        {empSummary.colaboradorNome}
                        <span className="font-normal text-slate-400"> • {empSummary.cargo}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Situação cadastral: {empSummary.situacaoCadastral.toUpperCase()} •{' '}
                        {empSummary.bloqueiosCount} bloqueio(s) •{' '}
                        {empSummary.alertasCount} alerta(s) a vencer
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded border text-[10px] font-bold uppercase ${badgeColor}`}
                    >
                      {empSummary.statusGeral === 'conforme'
                        ? 'Apto'
                        : empSummary.statusGeral === 'atencao'
                        ? 'Apto c/ Atenção'
                        : 'Bloqueado'}
                    </span>
                  </div>
                  {renderItemsTable(
                    filtered,
                    'Nenhum requisito individual aplicável a este cargo/colaborador para o filtro selecionado.'
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
