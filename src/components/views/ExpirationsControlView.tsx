import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  Search,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Clock,
  CheckCircle2,
  Upload,
  Calendar,
  Building2,
  User,
  X,
  Loader2,
  FileWarning,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import type { MirroredIntegrationDocumentItem } from '../../types/sst';
import type { NavItemKey } from '../layout/Sidebar';
import {
  STANDARDIZED_STATUS_META,
  StandardizedDocStatus,
  formatDateTimePt,
  getExpirationInfo,
  resolveIntegrationItemStandardizedStatus,
  resolveOfficialRecordStandardizedStatus,
} from '../../utils/documentStatus';

interface ExpirationsControlViewProps {
  onNavigate: (tab: NavItemKey, opts?: { integrationId?: string }) => void;
}

interface UnifiedExpirationRow {
  key: string;
  source: 'integracao' | 'oficial';
  nome: string;
  codigo?: string;
  protocolo?: string;
  integrationId?: string;
  itemId?: string;
  empresaId?: string;
  empresaNome: string;
  colaboradorNome?: string;
  dataEnvio?: string;
  dataAnalise?: string;
  avaliador?: string;
  motivoReprovacao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  stdStatus: StandardizedDocStatus;
  exp: ReturnType<typeof getExpirationInfo>;
  rawIntegrationItem?: MirroredIntegrationDocumentItem;
}

type BucketFilter =
  | 'ALL'
  | 'ACTION_NEEDED'
  | 'VENCIDO'
  | 'PROXIMO_VENCIMENTO'
  | 'REPROVADO'
  | 'PENDENTE'
  | 'AGUARDANDO_ANALISE'
  | 'APROVADO';

export const ExpirationsControlView: React.FC<ExpirationsControlViewProps> = ({ onNavigate }) => {
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();
  const {
    contractorIntegrationItems,
    documents,
    trainings,
    exams,
    listIntegrationsOnServer,
    listIntegrationItemsOnServer,
    updateIntegrationItemValidityOnServer,
  } = useSST();

  const [bucket, setBucket] = useState<BucketFilter>('ACTION_NEEDED');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Admin validity update modal
  const [editingItem, setEditingItem] = useState<MirroredIntegrationDocumentItem | null>(null);
  const [validityDate, setValidityDate] = useState('');
  const [semValidade, setSemValidade] = useState(false);
  const [savingValidity, setSavingValidity] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([listIntegrationsOnServer(), listIntegrationItemsOnServer()]);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const rows = useMemo<UnifiedExpirationRow[]>(() => {
    const result: UnifiedExpirationRow[] = [];
    const linkedOfficialIds = new Set<string>();

    // 1. Primary source of truth: mirrored integration items
    for (const item of contractorIntegrationItems) {
      if (item.officialRecordId) {
        linkedOfficialIds.add(`${item.officialCollection || 'documents'}:${item.officialRecordId}`);
      }
      const stdStatus = resolveIntegrationItemStandardizedStatus(item, item.protocoloStatus);
      const exp = getExpirationInfo(item.dataValidade, item.semValidade);
      result.push({
        key: `int-${item.id}`,
        source: 'integracao',
        nome: item.nomeExibicao,
        codigo: item.documentoCodigoCanonico,
        protocolo: item.codigoProtocolo,
        integrationId: item.integrationId,
        itemId: item.id,
        empresaId: item.empresaId,
        empresaNome: item.empresaNome,
        colaboradorNome: item.colaboradorNome,
        dataEnvio: item.dataEnvio,
        dataAnalise: item.dataAnalise,
        avaliador: item.analisadoPorNome,
        motivoReprovacao: item.motivoReprovacao,
        dataValidade: item.dataValidade,
        semValidade: item.semValidade,
        stdStatus,
        exp,
        rawIntegrationItem: item,
      });
    }

    // 2. Complement with official SST records not already represented by an integration item
    const scopeCompany = (empresaId?: string) => {
      if (!isSolicitante) return true;
      if (!activeEmpresaId) return false;
      return empresaId === activeEmpresaId;
    };

    for (const doc of documents) {
      if (!scopeCompany(doc.empresaId)) continue;
      if (linkedOfficialIds.has(`documents:${doc.id}`)) continue;
      const stdStatus = resolveOfficialRecordStandardizedStatus(
        doc.situacao,
        doc.dataValidade,
        doc.semValidade,
        Boolean(doc.arquivoNome || doc.arquivoUrl)
      );
      result.push({
        key: `doc-${doc.id}`,
        source: 'oficial',
        nome: doc.nomeDocumento,
        empresaId: doc.empresaId,
        empresaNome: doc.empresaNome,
        colaboradorNome: doc.colaboradorNome,
        dataEnvio: doc.createdAt,
        dataAnalise: doc.dataAnalise,
        avaliador: doc.analisadoPor,
        motivoReprovacao: doc.motivoReprovacao,
        dataValidade: doc.dataValidade,
        semValidade: doc.semValidade,
        stdStatus,
        exp: getExpirationInfo(doc.dataValidade, doc.semValidade),
      });
    }

    for (const trn of trainings) {
      if (!scopeCompany(trn.empresaId)) continue;
      if (linkedOfficialIds.has(`trainings:${trn.id}`)) continue;
      const stdStatus = resolveOfficialRecordStandardizedStatus(
        trn.situacao,
        trn.dataValidade,
        trn.semValidade,
        Boolean(trn.certificadoUrl)
      );
      result.push({
        key: `trn-${trn.id}`,
        source: 'oficial',
        nome: trn.nomeTreinamento,
        empresaId: trn.empresaId,
        empresaNome: trn.empresaNome,
        colaboradorNome: trn.colaboradorNome,
        dataEnvio: trn.createdAt,
        dataAnalise: trn.dataAnalise,
        avaliador: trn.analisadoPor,
        motivoReprovacao: trn.motivoReprovacao,
        dataValidade: trn.dataValidade,
        semValidade: trn.semValidade,
        stdStatus,
        exp: getExpirationInfo(trn.dataValidade, trn.semValidade),
      });
    }

    for (const ex of exams) {
      if (!scopeCompany(ex.empresaId)) continue;
      if (linkedOfficialIds.has(`exams:${ex.id}`)) continue;
      const stdStatus = resolveOfficialRecordStandardizedStatus(
        ex.situacao,
        ex.dataValidade,
        ex.semValidade,
        Boolean(ex.anexoUrl)
      );
      result.push({
        key: `ex-${ex.id}`,
        source: 'oficial',
        nome: `ASO — ${ex.tipoExame}`,
        empresaId: ex.empresaId,
        empresaNome: ex.empresaNome,
        colaboradorNome: ex.colaboradorNome,
        dataEnvio: ex.createdAt,
        dataValidade: ex.dataValidade,
        semValidade: ex.semValidade,
        stdStatus,
        exp: getExpirationInfo(ex.dataValidade, ex.semValidade),
      });
    }

    const priority = (s: StandardizedDocStatus) => {
      switch (s) {
        case 'VENCIDO':
          return 0;
        case 'REPROVADO':
          return 1;
        case 'PROXIMO_VENCIMENTO':
          return 2;
        case 'PENDENTE_ENVIO':
          return 3;
        case 'NAO_ENVIADO':
          return 4;
        case 'AGUARDANDO_ANALISE':
          return 5;
        case 'EM_ANALISE':
          return 6;
        default:
          return 7;
      }
    };

    return result.sort((a, b) => {
      const pDiff = priority(a.stdStatus) - priority(b.stdStatus);
      if (pDiff !== 0) return pDiff;
      const aDays = a.exp.daysRemaining ?? 99999;
      const bDays = b.exp.daysRemaining ?? 99999;
      return aDays - bDays;
    });
  }, [contractorIntegrationItems, documents, trainings, exams, isSolicitante, activeEmpresaId]);

  const counts = useMemo(() => {
    let vencidos = 0;
    let proximos = 0;
    let reprovados = 0;
    let pendentes = 0;
    let analise = 0;
    let aprovados = 0;
    for (const r of rows) {
      if (r.stdStatus === 'VENCIDO') vencidos++;
      else if (r.stdStatus === 'PROXIMO_VENCIMENTO') proximos++;
      else if (r.stdStatus === 'REPROVADO') reprovados++;
      else if (r.stdStatus === 'NAO_ENVIADO' || r.stdStatus === 'PENDENTE_ENVIO') pendentes++;
      else if (r.stdStatus === 'AGUARDANDO_ANALISE' || r.stdStatus === 'EM_ANALISE') analise++;
      else aprovados++;
    }
    return {
      total: rows.length,
      actionNeeded: vencidos + proximos + reprovados + pendentes,
      vencidos,
      proximos,
      reprovados,
      pendentes,
      analise,
      aprovados,
    };
  }, [rows]);

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = r.empresaId || r.empresaNome;
      if (key && !map.has(key)) map.set(key, r.empresaNome);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (companyFilter !== 'ALL' && (r.empresaId || r.empresaNome) !== companyFilter) {
        return false;
      }
      if (bucket === 'ACTION_NEEDED') {
        if (
          r.stdStatus !== 'VENCIDO' &&
          r.stdStatus !== 'PROXIMO_VENCIMENTO' &&
          r.stdStatus !== 'REPROVADO' &&
          r.stdStatus !== 'NAO_ENVIADO' &&
          r.stdStatus !== 'PENDENTE_ENVIO'
        ) {
          return false;
        }
      } else if (bucket === 'PENDENTE') {
        if (r.stdStatus !== 'NAO_ENVIADO' && r.stdStatus !== 'PENDENTE_ENVIO') return false;
      } else if (bucket === 'AGUARDANDO_ANALISE') {
        if (r.stdStatus !== 'AGUARDANDO_ANALISE' && r.stdStatus !== 'EM_ANALISE') return false;
      } else if (bucket !== 'ALL' && r.stdStatus !== bucket) {
        return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          r.nome,
          r.codigo || '',
          r.protocolo || '',
          r.empresaNome,
          r.colaboradorNome || '',
          r.motivoReprovacao || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, bucket, companyFilter, search]);

  const openEditValidity = (item: MirroredIntegrationDocumentItem) => {
    if (!isAdmin) return;
    setEditingItem(item);
    setValidityDate(item.dataValidade ? item.dataValidade.slice(0, 10) : '');
    setSemValidade(Boolean(item.semValidade));
  };

  const handleSaveValidity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !isAdmin) return;
    setSavingValidity(true);
    setFeedback(null);
    try {
      await updateIntegrationItemValidityOnServer(editingItem.integrationId, editingItem.id, {
        dataValidade: semValidade ? '' : validityDate,
        semValidade,
      });
      setEditingItem(null);
      setFeedback({
        type: 'success',
        text: `Validade de "${editingItem.nomeExibicao}" atualizada e refletida em tempo real.`,
      });
      await listIntegrationItemsOnServer();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao atualizar validade.',
      });
    } finally {
      setSavingValidity(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <CalendarClock className="text-orange-400" size={22} />
            {isSolicitante ? 'Pendências e Vencimentos' : 'Controle de Vencimentos'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isSolicitante
              ? 'Consulte pendências de envio, documentos reprovados com justificativa do EHS e datas de vencimento da sua contratada.'
              : 'Acompanhamento consolidado de validades, alertas de vencimento (≤ 30 dias), documentos vencidos e pendências de todas as contratadas.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start md:self-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <button
          type="button"
          onClick={() => setBucket('VENCIDO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucket === 'VENCIDO' ? 'border-red-400 ring-1 ring-red-400/40' : 'border-red-500/30 hover:border-red-400/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
              Vencidos
            </span>
            <XCircle size={16} className="text-red-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.vencidos}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucket('PROXIMO_VENCIMENTO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucket === 'PROXIMO_VENCIMENTO'
              ? 'border-orange-400 ring-1 ring-orange-400/40'
              : 'border-orange-500/30 hover:border-orange-400/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-300">
              Próx. Vencimento
            </span>
            <AlertTriangle size={16} className="text-orange-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.proximos}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucket('REPROVADO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucket === 'REPROVADO'
              ? 'border-rose-400 ring-1 ring-rose-400/40'
              : 'border-rose-500/30 hover:border-rose-400/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
              Reprovados
            </span>
            <FileWarning size={16} className="text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.reprovados}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucket('PENDENTE')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucket === 'PENDENTE'
              ? 'border-amber-400 ring-1 ring-amber-400/40'
              : 'border-amber-500/30 hover:border-amber-400/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Não Enviados
            </span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.pendentes}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucket('APROVADO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors col-span-2 lg:col-span-1 ${
            bucket === 'APROVADO'
              ? 'border-emerald-400 ring-1 ring-emerald-400/40'
              : 'border-emerald-500/30 hover:border-emerald-400/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Em Dia
            </span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.aprovados}</p>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por documento, colaborador, empresa ou protocolo..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as BucketFilter)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ACTION_NEEDED">Exigem Ação ({counts.actionNeeded})</option>
            <option value="ALL">Todos os Documentos ({counts.total})</option>
            <option value="VENCIDO">Vencidos ({counts.vencidos})</option>
            <option value="PROXIMO_VENCIMENTO">Próximo do Vencimento ({counts.proximos})</option>
            <option value="REPROVADO">Reprovados ({counts.reprovados})</option>
            <option value="PENDENTE">Não Enviados / Pendentes ({counts.pendentes})</option>
            <option value="AGUARDANDO_ANALISE">Em Análise ({counts.analise})</option>
            <option value="APROVADO">Aprovados e Válidos ({counts.aprovados})</option>
          </select>

          {!isSolicitante && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[200px]"
            >
              <option value="ALL">Todas as Empresas</option>
              {companyOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-white">
              Nenhum registro encontrado nesta categoria
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Altere o filtro acima para visualizar todos os documentos acompanhados.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map((row) => {
              const meta = STANDARDIZED_STATUS_META[row.stdStatus];
              return (
                <div
                  key={row.key}
                  className="p-4 hover:bg-slate-800/30 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </span>
                      <span className="text-sm font-bold text-white">{row.nome}</span>
                      {row.protocolo && (
                        <span className="text-[11px] font-mono text-blue-400">
                          {row.protocolo}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={11} />
                        <strong className="text-slate-200">{row.empresaNome}</strong>
                      </span>
                      {row.colaboradorNome && (
                        <span className="inline-flex items-center gap-1">
                          <User size={11} />
                          <strong className="text-slate-200">{row.colaboradorNome}</strong>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} />
                        Validade:{' '}
                        <strong
                          className={
                            row.exp.state === 'expired'
                              ? 'text-red-400'
                              : row.exp.state === 'expiring'
                              ? 'text-orange-300'
                              : 'text-slate-200'
                          }
                        >
                          {row.exp.formattedDate}
                        </strong>
                        {row.exp.daysRemaining !== null && (
                          <span className="text-slate-500"> ({row.exp.label})</span>
                        )}
                      </span>
                      {row.avaliador && (
                        <span>
                          Avaliado por {row.avaliador} em {formatDateTimePt(row.dataAnalise)}
                        </span>
                      )}
                    </div>

                    {row.motivoReprovacao && row.stdStatus === 'REPROVADO' && (
                      <div className="mt-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
                        <strong className="text-rose-300">Justificativa EHS:</strong>{' '}
                        {row.motivoReprovacao}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isSolicitante && row.integrationId && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('envio_documentos', { integrationId: row.integrationId })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
                      >
                        <Upload size={13} />
                        {row.stdStatus === 'REPROVADO'
                          ? 'Corrigir e Reenviar'
                          : row.stdStatus === 'VENCIDO' || row.stdStatus === 'PROXIMO_VENCIMENTO'
                          ? 'Enviar Renovação'
                          : 'Anexar'}
                      </button>
                    )}

                    {isAdmin && row.rawIntegrationItem && (
                      <button
                        type="button"
                        onClick={() => openEditValidity(row.rawIntegrationItem!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
                      >
                        <Calendar size={13} />
                        Alterar Validade
                      </button>
                    )}

                    {!isSolicitante && row.integrationId && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('gestao_integracoes', { integrationId: row.integrationId })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-semibold text-blue-300 transition-colors"
                      >
                        <ExternalLink size={12} />
                        Protocolo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin Edit Validity Modal */}
      {editingItem && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSaveValidity}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Atualizar Data de Validade</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {editingItem.nomeExibicao} · {editingItem.empresaNome}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={semValidade}
                  onChange={(e) => setSemValidade(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-950"
                />
                <span>Sem data de validade (indeterminado)</span>
              </label>

              {!semValidade && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Nova Data de Validade *
                  </label>
                  <input
                    type="date"
                    required
                    value={validityDate}
                    onChange={(e) => setValidityDate(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingValidity}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {savingValidity && <Loader2 size={13} className="animate-spin" />}
                Salvar Validade
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
