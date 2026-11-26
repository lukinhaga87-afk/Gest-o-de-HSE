import React, { useEffect, useMemo, useState } from 'react';
import {
  FileCheck2,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  Download,
  Calendar,
  History,
  Building2,
  User,
  ExternalLink,
  X,
  Loader2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Clock,
  FolderOpen,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import type {
  DocumentSST,
  MirroredIntegrationDocumentItem,
  OccupationalExam,
  Training,
} from '../../types/sst';
import type { NavItemKey } from '../layout/Sidebar';
import {
  ALL_STANDARDIZED_STATUSES,
  STANDARDIZED_STATUS_META,
  StandardizedDocStatus,
  formatDateTimePt,
  formatIsoDatePt,
  getExpirationInfo,
  resolveIntegrationItemStandardizedStatus,
} from '../../utils/documentStatus';
import { ProtectedDocumentButton } from '../common/ProtectedDocumentButton';

interface DocumentAnalysisCenterViewProps {
  onNavigate?: (
    tab: NavItemKey,
    opts?: { integrationId?: string; companyId?: string; employeeId?: string }
  ) => void;
}

interface PreviewModalState {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  objectUrl: string;
  itemLabel: string;
  version?: number;
}

type UnifiedAnalysisItem =
  | {
      source: 'integration';
      uid: string;
      groupKey: string;
      groupLabel: string;
      groupBadge: string;
      groupType: 'integracao';
      empresaId: string;
      empresaNome: string;
      colaboradorId?: string;
      colaboradorNome?: string;
      integrationId: string;
      title: string;
      code: string;
      category: string;
      dataEnvio?: string;
      dataValidade?: string;
      semValidade?: boolean;
      analisadoPor?: string;
      dataAnalise?: string;
      motivoReprovacao?: string;
      arquivoNome?: string;
      hasFile: boolean;
      stdStatus: StandardizedDocStatus;
      raw: MirroredIntegrationDocumentItem;
    }
  | {
      source: 'direct_doc';
      uid: string;
      groupKey: string;
      groupLabel: string;
      groupBadge: string;
      groupType: 'empresa' | 'colaborador';
      empresaId: string;
      empresaNome: string;
      colaboradorId?: string;
      colaboradorNome?: string;
      title: string;
      code: string;
      category: string;
      dataEnvio?: string;
      dataValidade?: string;
      semValidade?: boolean;
      analisadoPor?: string;
      dataAnalise?: string;
      motivoReprovacao?: string;
      arquivoNome?: string;
      arquivoUrl?: string;
      hasFile: boolean;
      stdStatus: StandardizedDocStatus;
      raw: DocumentSST;
    }
  | {
      source: 'direct_exam';
      uid: string;
      groupKey: string;
      groupLabel: string;
      groupBadge: string;
      groupType: 'colaborador';
      empresaId: string;
      empresaNome: string;
      colaboradorId: string;
      colaboradorNome: string;
      title: string;
      code: string;
      category: string;
      dataEnvio?: string;
      dataValidade?: string;
      semValidade?: boolean;
      analisadoPor?: string;
      dataAnalise?: string;
      motivoReprovacao?: string;
      arquivoNome?: string;
      arquivoUrl?: string;
      hasFile: boolean;
      stdStatus: StandardizedDocStatus;
      raw: OccupationalExam;
    }
  | {
      source: 'direct_training';
      uid: string;
      groupKey: string;
      groupLabel: string;
      groupBadge: string;
      groupType: 'colaborador';
      empresaId: string;
      empresaNome: string;
      colaboradorId: string;
      colaboradorNome: string;
      title: string;
      code: string;
      category: string;
      dataEnvio?: string;
      dataValidade?: string;
      semValidade?: boolean;
      analisadoPor?: string;
      dataAnalise?: string;
      motivoReprovacao?: string;
      arquivoNome?: string;
      arquivoUrl?: string;
      hasFile: boolean;
      stdStatus: StandardizedDocStatus;
      raw: Training;
    };

function resolveDirectStandardizedStatus(
  situacao: string,
  dataValidade?: string,
  semValidade?: boolean
): StandardizedDocStatus {
  if (situacao === 'pendente') return 'AGUARDANDO_ANALISE';
  if (situacao === 'reprovado') return 'REPROVADO';
  const exp = getExpirationInfo(dataValidade, semValidade);
  if (exp.state === 'expired') return 'VENCIDO';
  if (exp.state === 'expiring') return 'PROXIMO_VENCIMENTO';
  return 'APROVADO';
}

export const DocumentAnalysisCenterView: React.FC<DocumentAnalysisCenterViewProps> = ({
  onNavigate,
}) => {
  const { isAdmin, isAuditor } = useAuth();
  const {
    contractorIntegrationItems,
    documents,
    exams,
    trainings,
    listIntegrationsOnServer,
    listIntegrationItemsOnServer,
    reviewIntegrationItemOnServer,
    updateIntegrationItemValidityOnServer,
    fetchIntegrationItemFileBlobOnServer,
    approveDocument,
    rejectDocument,
    updateDocument,
    approveExam,
    rejectExam,
    updateExam,
    approveTraining,
    rejectTraining,
    updateTraining,
  } = useSST();

  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('ALL');
  const [originFilter, setOriginFilter] = useState<'ALL' | 'integracao' | 'empresa' | 'colaborador'>(
    'ALL'
  );
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Preview state (integration items)
  const [previewDoc, setPreviewDoc] = useState<PreviewModalState | null>(null);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);

  // Action modal (Admin only)
  const [reviewModal, setReviewModal] = useState<{
    entry: UnifiedAnalysisItem;
    mode: 'APROVADO' | 'REPROVADO' | 'VALIDADE';
  } | null>(null);
  const [modalMotivo, setModalMotivo] = useState('');
  const [modalValidade, setModalValidade] = useState('');
  const [modalSemValidade, setModalSemValidade] = useState(false);
  const [modalObs, setModalObs] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const url = previewDoc?.objectUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewDoc]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      await Promise.all([listIntegrationsOnServer(), listIntegrationItemsOnServer()]);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível sincronizar os documentos no servidor.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Unify Integration items + Direct Company/Employee Documents, Exams & Trainings
  const unifiedItems = useMemo<UnifiedAnalysisItem[]>(() => {
    const list: UnifiedAnalysisItem[] = [];

    for (const item of contractorIntegrationItems) {
      list.push({
        source: 'integration',
        uid: `int-${item.id}`,
        groupKey: `INT::${item.integrationId}`,
        groupLabel: `Solicitação de Integração ${item.codigoProtocolo}`,
        groupBadge: 'Integração',
        groupType: 'integracao',
        empresaId: item.empresaId || '',
        empresaNome: item.empresaNome,
        colaboradorId: item.colaboradorId,
        colaboradorNome: item.colaboradorNome,
        integrationId: item.integrationId,
        title: item.nomeExibicao,
        code: item.documentoCodigoCanonico,
        category: item.categoria,
        dataEnvio: item.dataEnvio,
        dataValidade: item.dataValidade,
        semValidade: item.semValidade,
        analisadoPor: item.analisadoPorNome,
        dataAnalise: item.dataAnalise,
        motivoReprovacao: item.motivoReprovacao,
        arquivoNome: item.arquivoNome,
        hasFile: Boolean(item.hasStoredFile),
        stdStatus: resolveIntegrationItemStandardizedStatus(item, item.protocoloStatus),
        raw: item,
      });
    }

    for (const doc of documents) {
      const isEmployee = Boolean(doc.colaboradorId);
      list.push({
        source: 'direct_doc',
        uid: `doc-${doc.id}`,
        groupKey: isEmployee
          ? `COL::${doc.colaboradorId}`
          : `EMP::${doc.empresaId}`,
        groupLabel: isEmployee
          ? `Solicitação Individual — ${doc.colaboradorNome || 'Colaborador'}`
          : `Documentação Empresarial — ${doc.empresaNome}`,
        groupBadge: isEmployee ? 'Colaborador' : 'Empresa',
        groupType: isEmployee ? 'colaborador' : 'empresa',
        empresaId: doc.empresaId,
        empresaNome: doc.empresaNome,
        colaboradorId: doc.colaboradorId,
        colaboradorNome: doc.colaboradorNome,
        title: doc.nomeDocumento,
        code: doc.solicitacaoCodigo || doc.numeroDocumento || 'DOC',
        category: doc.categoria || (isEmployee ? 'colaborador' : 'empresa'),
        dataEnvio: doc.updatedAt || doc.createdAt || doc.dataEmissao,
        dataValidade: doc.dataValidade,
        semValidade: doc.semValidade,
        analisadoPor: doc.analisadoPor,
        dataAnalise: doc.dataAnalise,
        motivoReprovacao: doc.motivoReprovacao,
        arquivoNome: doc.arquivoNome,
        arquivoUrl: doc.arquivoUrl,
        hasFile: Boolean(doc.arquivoUrl),
        stdStatus: resolveDirectStandardizedStatus(doc.situacao, doc.dataValidade, doc.semValidade),
        raw: doc,
      });
    }

    for (const ex of exams) {
      list.push({
        source: 'direct_exam',
        uid: `exam-${ex.id}`,
        groupKey: `COL::${ex.colaboradorId}`,
        groupLabel: `Solicitação Individual — ${ex.colaboradorNome}`,
        groupBadge: 'Colaborador',
        groupType: 'colaborador',
        empresaId: ex.empresaId,
        empresaNome: ex.empresaNome,
        colaboradorId: ex.colaboradorId,
        colaboradorNome: ex.colaboradorNome,
        title: `Exame / ASO: ${ex.tipoExame} (${ex.conclusao.toUpperCase()})`,
        code: 'ASO',
        category: 'exame',
        dataEnvio: ex.updatedAt || ex.createdAt || ex.dataRealizacao,
        dataValidade: ex.dataValidade,
        semValidade: ex.semValidade,
        analisadoPor: ex.analisadoPor,
        dataAnalise: ex.dataAnalise,
        motivoReprovacao: ex.motivoReprovacao,
        arquivoNome: ex.anexoNome,
        arquivoUrl: ex.anexoUrl,
        hasFile: Boolean(ex.anexoUrl),
        stdStatus: resolveDirectStandardizedStatus(ex.situacao, ex.dataValidade, ex.semValidade),
        raw: ex,
      });
    }

    for (const tr of trainings) {
      list.push({
        source: 'direct_training',
        uid: `train-${tr.id}`,
        groupKey: `COL::${tr.colaboradorId}`,
        groupLabel: `Solicitação Individual — ${tr.colaboradorNome}`,
        groupBadge: 'Colaborador',
        groupType: 'colaborador',
        empresaId: tr.empresaId,
        empresaNome: tr.empresaNome,
        colaboradorId: tr.colaboradorId,
        colaboradorNome: tr.colaboradorNome,
        title: `Treinamento: ${tr.nomeTreinamento}`,
        code: 'TREINAMENTO',
        category: 'treinamento',
        dataEnvio: tr.updatedAt || tr.createdAt || tr.dataRealizacao,
        dataValidade: tr.dataValidade,
        semValidade: tr.semValidade,
        analisadoPor: tr.analisadoPor,
        dataAnalise: tr.dataAnalise,
        motivoReprovacao: tr.motivoReprovacao,
        arquivoNome: tr.certificadoNome,
        arquivoUrl: tr.certificadoUrl,
        hasFile: Boolean(tr.certificadoUrl),
        stdStatus: resolveDirectStandardizedStatus(tr.situacao, tr.dataValidade, tr.semValidade),
        raw: tr,
      });
    }

    return list;
  }, [contractorIntegrationItems, documents, exams, trainings]);

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of unifiedItems) {
      const key = entry.empresaId || entry.empresaNome;
      if (key && !map.has(key)) map.set(key, entry.empresaNome);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [unifiedItems]);

  const kpis = useMemo(() => {
    let awaiting = 0;
    let inReview = 0;
    let approved = 0;
    let rejected = 0;
    let expiredOrExpiring = 0;
    for (const entry of unifiedItems) {
      if (entry.stdStatus === 'AGUARDANDO_ANALISE') awaiting += 1;
      else if (entry.stdStatus === 'EM_ANALISE') inReview += 1;
      else if (entry.stdStatus === 'APROVADO') approved += 1;
      else if (entry.stdStatus === 'REPROVADO') rejected += 1;
      else if (entry.stdStatus === 'VENCIDO' || entry.stdStatus === 'PROXIMO_VENCIMENTO') {
        expiredOrExpiring += 1;
      }
    }
    return { total: unifiedItems.length, awaiting, inReview, approved, rejected, expiredOrExpiring };
  }, [unifiedItems]);

  const filtered = useMemo(() => {
    return unifiedItems.filter((entry) => {
      if (companyFilter !== 'ALL' && (entry.empresaId || entry.empresaNome) !== companyFilter) {
        return false;
      }
      if (originFilter !== 'ALL' && entry.groupType !== originFilter) {
        return false;
      }
      if (statusFilter !== 'ALL' && entry.stdStatus !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          entry.title,
          entry.code,
          entry.groupLabel,
          entry.empresaNome,
          entry.colaboradorNome || '',
          entry.arquivoNome || '',
          entry.analisadoPor || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [unifiedItems, companyFilter, originFilter, statusFilter, search]);

  // Organize filtered items BY SOLICITATION / REQUEST
  const solicitationGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        groupKey: string;
        groupLabel: string;
        groupBadge: string;
        groupType: 'integracao' | 'empresa' | 'colaborador';
        empresaId: string;
        empresaNome: string;
        colaboradorId?: string;
        colaboradorNome?: string;
        integrationId?: string;
        items: UnifiedAnalysisItem[];
        awaitingCount: number;
        approvedCount: number;
        rejectedCount: number;
        latestDate: string;
      }
    >();

    for (const entry of filtered) {
      const existing = map.get(entry.groupKey);
      const isAwaiting =
        entry.stdStatus === 'AGUARDANDO_ANALISE' || entry.stdStatus === 'EM_ANALISE';
      const isApproved = entry.stdStatus === 'APROVADO';
      const isRejected = entry.stdStatus === 'REPROVADO';
      const dateStr = entry.dataEnvio || '';

      if (existing) {
        existing.items.push(entry);
        if (isAwaiting) existing.awaitingCount += 1;
        if (isApproved) existing.approvedCount += 1;
        if (isRejected) existing.rejectedCount += 1;
        if (dateStr > existing.latestDate) existing.latestDate = dateStr;
      } else {
        map.set(entry.groupKey, {
          groupKey: entry.groupKey,
          groupLabel: entry.groupLabel,
          groupBadge: entry.groupBadge,
          groupType: entry.groupType,
          empresaId: entry.empresaId,
          empresaNome: entry.empresaNome,
          colaboradorId: entry.colaboradorId,
          colaboradorNome: entry.colaboradorNome,
          integrationId: entry.source === 'integration' ? entry.integrationId : undefined,
          items: [entry],
          awaitingCount: isAwaiting ? 1 : 0,
          approvedCount: isApproved ? 1 : 0,
          rejectedCount: isRejected ? 1 : 0,
          latestDate: dateStr,
        });
      }
    }

    // Prioritize solicitations with awaiting items first, then most recent
    return Array.from(map.values()).sort((a, b) => {
      if (b.awaitingCount !== a.awaitingCount) return b.awaitingCount - a.awaitingCount;
      return b.latestDate.localeCompare(a.latestDate);
    });
  }, [filtered]);

  const handleOpenIntegrationFile = async (
    item: MirroredIntegrationDocumentItem,
    opts?: { version?: number; download?: boolean }
  ) => {
    const key = `${item.id}-${opts?.version || 'cur'}-${opts?.download ? 'dl' : 'vw'}`;
    setLoadingFileId(key);
    setFeedback(null);
    try {
      const res = await fetchIntegrationItemFileBlobOnServer(item.integrationId, item.id, opts);
      const url = URL.createObjectURL(res.blob);
      if (opts?.download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = res.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        setPreviewDoc({
          fileName: res.fileName,
          mimeType: res.mimeType,
          objectUrl: url,
          itemLabel: item.nomeExibicao,
          version: opts?.version || item.versaoAtual,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível abrir o arquivo documental.',
      });
    } finally {
      setLoadingFileId(null);
    }
  };

  const openActionModal = (
    entry: UnifiedAnalysisItem,
    mode: 'APROVADO' | 'REPROVADO' | 'VALIDADE'
  ) => {
    if (!isAdmin) return;
    setReviewModal({ entry, mode });
    setModalMotivo(entry.motivoReprovacao || '');
    setModalValidade(entry.dataValidade ? entry.dataValidade.slice(0, 10) : '');
    setModalSemValidade(Boolean(entry.semValidade));
    setModalObs(entry.raw.observacoes || '');
  };

  const handleConfirmModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal || !isAdmin) return;
    const { entry, mode } = reviewModal;

    if (mode === 'REPROVADO' && !modalMotivo.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe obrigatoriamente a justificativa para recusar o documento.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      if (entry.source === 'integration') {
        const item = entry.raw;
        if (mode === 'VALIDADE') {
          await updateIntegrationItemValidityOnServer(item.integrationId, item.id, {
            dataValidade: modalSemValidade ? '' : modalValidade,
            semValidade: modalSemValidade,
            observacoes: modalObs,
          });
        } else {
          await reviewIntegrationItemOnServer(item.integrationId, item.id, {
            decisao: mode,
            motivo: mode === 'REPROVADO' ? modalMotivo.trim() : undefined,
            dataValidade:
              mode === 'APROVADO' && !modalSemValidade ? modalValidade || undefined : undefined,
            semValidade: mode === 'APROVADO' ? modalSemValidade : undefined,
            observacoes: modalObs || undefined,
          });
        }
        await listIntegrationItemsOnServer();
      } else if (entry.source === 'direct_doc') {
        if (mode === 'VALIDADE') {
          await updateDocument(entry.raw.id, {
            dataValidade: modalSemValidade ? '' : modalValidade,
            semValidade: modalSemValidade,
            observacoes: modalObs,
          });
        } else if (mode === 'APROVADO') {
          if (modalValidade || modalSemValidade) {
            await updateDocument(entry.raw.id, {
              dataValidade: modalSemValidade ? '' : modalValidade,
              semValidade: modalSemValidade,
              observacoes: modalObs,
            });
          }
          await approveDocument(entry.raw.id);
        } else {
          await rejectDocument(entry.raw.id, modalMotivo.trim());
        }
      } else if (entry.source === 'direct_exam') {
        if (mode === 'VALIDADE') {
          await updateExam(entry.raw.id, {
            dataValidade: modalSemValidade ? '' : modalValidade,
            semValidade: modalSemValidade,
            observacoes: modalObs,
          });
        } else if (mode === 'APROVADO') {
          if (modalValidade || modalSemValidade) {
            await updateExam(entry.raw.id, {
              dataValidade: modalSemValidade ? '' : modalValidade,
              semValidade: modalSemValidade,
              observacoes: modalObs,
            });
          }
          await approveExam(entry.raw.id);
        } else {
          await rejectExam(entry.raw.id, modalMotivo.trim());
        }
      } else if (entry.source === 'direct_training') {
        if (mode === 'VALIDADE') {
          await updateTraining(entry.raw.id, {
            dataValidade: modalSemValidade ? '' : modalValidade,
            semValidade: modalSemValidade,
            observacoes: modalObs,
          });
        } else if (mode === 'APROVADO') {
          if (modalValidade || modalSemValidade) {
            await updateTraining(entry.raw.id, {
              dataValidade: modalSemValidade ? '' : modalValidade,
              semValidade: modalSemValidade,
              observacoes: modalObs,
            });
          }
          await approveTraining(entry.raw.id);
        } else {
          await rejectTraining(entry.raw.id, modalMotivo.trim());
        }
      }

      setFeedback({
        type: 'success',
        text:
          mode === 'VALIDADE'
            ? `Validade de "${entry.title}" atualizada e espelhada para a contratada.`
            : mode === 'APROVADO'
            ? `"${entry.title}" aceito/aprovado com avaliador, data e hora registrados.`
            : `"${entry.title}" recusado com justificativa registrada e espelhada para a contratada.`,
      });
      setReviewModal(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao salvar decisão documental.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <FileCheck2 className="text-blue-400" size={22} />
            Central de Análise Documental
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Análise organizada por solicitação (integrações, documentos enviados em Minha Empresa e em Meus Colaboradores), com visualização, decisão espelhada e justificativa obrigatória.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start md:self-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Sincronizar Documentos
        </button>
      </div>

      {isAuditor && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2">
          <ShieldAlert size={16} className="shrink-0 text-amber-400" />
          <span>
            Perfil Auditor ativo em modo <strong>somente leitura</strong>. Aprovações, recusas e edições de validade são exclusivas do Administrador EHS.
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <button
          type="button"
          onClick={() => setStatusFilter('AGUARDANDO_ANALISE')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-sky-500/30 hover:border-sky-400/60 transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
            Aguardando Análise
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{kpis.awaiting}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('EM_ANALISE')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-indigo-500/30 hover:border-indigo-400/60 transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
            Em Análise
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{kpis.inReview}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('APROVADO')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-emerald-500/30 hover:border-emerald-400/60 transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            Aprovados
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{kpis.approved}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('REPROVADO')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-rose-500/30 hover:border-rose-400/60 transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
            Recusados
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{kpis.rejected}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('VENCIDO')}
          className="text-left p-4 rounded-xl bg-slate-900 border border-orange-500/30 hover:border-orange-400/60 transition-colors col-span-2 lg:col-span-1"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-300">
            Vencidos / Próx. Venc.
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{kpis.expiredOrExpiring}</p>
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por solicitação, protocolo, documento, empresa, colaborador ou avaliador..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white max-w-[200px]"
          >
            <option value="ALL">Todas as Empresas</option>
            {companyOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
          >
            <option value="ALL">Todas as Origens</option>
            <option value="integracao">Integração (Protocolos)</option>
            <option value="empresa">Envio Direto — Empresa</option>
            <option value="colaborador">Envio Direto — Colaborador</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
          >
            <option value="ALL">Todos os Status ({kpis.total})</option>
            {ALL_STANDARDIZED_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STANDARDIZED_STATUS_META[st].label}
              </option>
            ))}
          </select>

          {(search ||
            companyFilter !== 'ALL' ||
            originFilter !== 'ALL' ||
            statusFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCompanyFilter('ALL');
                setOriginFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Grouped by Solicitation / Request */}
      {solicitationGroups.length === 0 ? (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-10 text-center">
          <Clock size={30} className="mx-auto text-slate-500 mb-2" />
          <p className="text-sm font-semibold text-white">
            Nenhuma solicitação documental encontrada para os filtros aplicados
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Documentos enviados via Gestão de Integração, Minha Empresa ou Meus Colaboradores aparecem agrupados por solicitação aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {solicitationGroups.map((group) => {
            const isCollapsed = Boolean(collapsedGroups[group.groupKey]);

            return (
              <div
                key={group.groupKey}
                className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"
              >
                {/* Solicitation Group Header */}
                <div
                  onClick={() =>
                    setCollapsedGroups((prev) => ({
                      ...prev,
                      [group.groupKey]: !prev[group.groupKey],
                    }))
                  }
                  className="px-4 py-3.5 bg-slate-950/70 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 cursor-pointer hover:bg-slate-900/80 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-blue-600/15 text-blue-400 border border-blue-500/25 shrink-0">
                      <FolderOpen size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-bold uppercase text-blue-300">
                          {group.groupBadge}
                        </span>
                        <h3 className="text-sm font-bold text-white truncate">
                          {group.groupLabel}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={11} />
                          <strong className="text-slate-200">{group.empresaNome}</strong>
                        </span>
                        {group.colaboradorNome && (
                          <span className="inline-flex items-center gap-1">
                            <User size={11} />
                            <strong className="text-slate-200">{group.colaboradorNome}</strong>
                          </span>
                        )}
                        <span>{group.items.length} documento(s)</span>
                      </p>
                    </div>
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {group.awaitingCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/35 text-sky-300 text-[10px] font-bold">
                        {group.awaitingCount} aguardando
                      </span>
                    )}
                    {group.approvedCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[10px] font-bold">
                        {group.approvedCount} aprovado(s)
                      </span>
                    )}
                    {group.rejectedCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/35 text-rose-300 text-[10px] font-bold">
                        {group.rejectedCount} recusado(s)
                      </span>
                    )}

                    {onNavigate && group.integrationId && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('gestao_integracoes', { integrationId: group.integrationId })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-[11px] font-semibold text-blue-300"
                      >
                        <ExternalLink size={11} />
                        Protocolo
                      </button>
                    )}
                    {onNavigate && group.empresaId && (
                      <button
                        type="button"
                        onClick={() => onNavigate('empresas', { companyId: group.empresaId })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200"
                      >
                        <Building2 size={11} />
                        Empresa
                      </button>
                    )}
                    {onNavigate && group.colaboradorId && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('colaboradores', { employeeId: group.colaboradorId })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200"
                      >
                        <User size={11} />
                        Colaborador
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [group.groupKey]: !prev[group.groupKey],
                        }))
                      }
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                      {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                    </button>
                  </div>
                </div>

                {/* Documents inside this Solicitation */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-800">
                    {group.items.map((entry) => {
                      const meta = STANDARDIZED_STATUS_META[entry.stdStatus];
                      const exp = getExpirationInfo(entry.dataValidade, entry.semValidade);
                      const isExpanded = expandedItemId === entry.uid;
                      const isIntegration = entry.source === 'integration';
                      const canApprove =
                        isAdmin &&
                        entry.stdStatus !== 'APROVADO' &&
                        (!isIntegration || entry.hasFile);
                      const canReject =
                        isAdmin &&
                        entry.stdStatus !== 'REPROVADO' &&
                        (!isIntegration || entry.hasFile);

                      return (
                        <div key={entry.uid} className="p-4 hover:bg-slate-800/30 transition-colors">
                          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                            <div className="space-y-1.5 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                                  {meta.label}
                                </span>
                                <h4 className="text-sm font-bold text-white">{entry.title}</h4>
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                                  {entry.code}
                                </span>
                                {isIntegration && (
                                  <span className="text-[11px] text-slate-400">
                                    v{entry.raw.versaoAtual || 0}
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] text-slate-400 pt-0.5">
                                <div>
                                  Titular:{' '}
                                  <strong className="text-slate-200">
                                    {entry.colaboradorNome || 'Documento da Empresa'}
                                  </strong>
                                </div>
                                <div>
                                  Enviado em:{' '}
                                  <strong className="text-slate-200">
                                    {formatDateTimePt(entry.dataEnvio)}
                                  </strong>
                                </div>
                                <div>
                                  Validade:{' '}
                                  <strong
                                    className={
                                      exp.state === 'expired'
                                        ? 'text-red-400'
                                        : exp.state === 'expiring'
                                        ? 'text-orange-300'
                                        : 'text-slate-200'
                                    }
                                  >
                                    {exp.formattedDate}
                                  </strong>
                                </div>
                                <div>
                                  Avaliador:{' '}
                                  <strong className="text-slate-200">
                                    {entry.analisadoPor || 'Aguardando'}
                                  </strong>
                                  {entry.dataAnalise && (
                                    <span className="text-slate-500">
                                      {' '}
                                      ({formatDateTimePt(entry.dataAnalise)})
                                    </span>
                                  )}
                                </div>
                              </div>

                              {entry.motivoReprovacao && (
                                <div className="mt-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-200">
                                  <strong className="text-rose-300">Justificativa da recusa:</strong>{' '}
                                  {entry.motivoReprovacao}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {isIntegration && entry.hasFile && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenIntegrationFile(entry.raw)}
                                    disabled={loadingFileId !== null}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                                  >
                                    {loadingFileId === `${entry.raw.id}-cur-vw` ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Eye size={13} />
                                    )}
                                    Visualizar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenIntegrationFile(entry.raw, { download: true })
                                    }
                                    disabled={loadingFileId !== null}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                                    title="Baixar documento"
                                  >
                                    <Download size={13} />
                                  </button>
                                </>
                              )}

                              {!isIntegration && entry.arquivoUrl && (
                                <ProtectedDocumentButton
                                  url={entry.arquivoUrl}
                                  fileName={entry.arquivoNome || entry.title}
                                  title={`Visualizar ${entry.title}`}
                                  label="Visualizar"
                                  icon={<Eye size={13} />}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                                />
                              )}

                              {canApprove && (
                                <button
                                  type="button"
                                  onClick={() => openActionModal(entry, 'APROVADO')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                                >
                                  <CheckCircle2 size={13} />
                                  Aceitar
                                </button>
                              )}

                              {canReject && (
                                <button
                                  type="button"
                                  onClick={() => openActionModal(entry, 'REPROVADO')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
                                >
                                  <XCircle size={13} />
                                  Recusar
                                </button>
                              )}

                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => openActionModal(entry, 'VALIDADE')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200"
                                  title="Editar validade"
                                >
                                  <Calendar size={13} />
                                  Validade
                                </button>
                              )}

                              {isIntegration && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedItemId(isExpanded ? null : entry.uid)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300"
                                >
                                  <History size={13} />
                                  v({entry.raw.versoes?.length || 0})
                                </button>
                              )}
                            </div>
                          </div>

                          {isIntegration && isExpanded && (
                            <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Histórico de Versões e Avaliações
                              </p>
                              {(entry.raw.versoes || []).length === 0 ? (
                                <p className="text-xs text-slate-500">Nenhuma versão enviada.</p>
                              ) : (
                                [...(entry.raw.versoes || [])]
                                  .sort((a, b) => b.versao - a.versao)
                                  .map((v) => (
                                    <div
                                      key={v.versao}
                                      className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]"
                                    >
                                      <div>
                                        <span className="font-mono font-bold text-blue-400 mr-2">
                                          v{v.versao}
                                        </span>
                                        <span className="text-slate-200 font-semibold mr-2">
                                          {v.arquivoNome}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                                          {v.status}
                                        </span>
                                        {v.dataValidade && !v.semValidade && (
                                          <span className="text-slate-400 ml-2">
                                            Validade: {formatIsoDatePt(v.dataValidade)}
                                          </span>
                                        )}
                                        <div className="text-slate-400 mt-0.5">
                                          Enviado por {v.enviadoPorNome} em{' '}
                                          {formatDateTimePt(v.enviadoEm)}
                                          {v.analisadoPorNome && (
                                            <>
                                              {' '}
                                              · Avaliado por{' '}
                                              <strong className="text-slate-200">
                                                {v.analisadoPorNome}
                                              </strong>{' '}
                                              em {formatDateTimePt(v.analisadoEm)}
                                            </>
                                          )}
                                        </div>
                                        {v.motivoReprovacao && (
                                          <div className="text-rose-300">
                                            Motivo: {v.motivoReprovacao}
                                          </div>
                                        )}
                                      </div>
                                      {v.hasStoredFile && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleOpenIntegrationFile(entry.raw, {
                                              version: v.versao,
                                            })
                                          }
                                          className="self-start sm:self-center inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                                        >
                                          <Eye size={12} /> Ver v{v.versao}
                                        </button>
                                      )}
                                    </div>
                                  ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Review / Validity Modal (Admin Only) */}
      {reviewModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmModal}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {reviewModal.mode === 'APROVADO'
                    ? 'Aceitar / Aprovar Documento'
                    : reviewModal.mode === 'REPROVADO'
                    ? 'Recusar Documento (Justificativa Obrigatória)'
                    : 'Gerenciar Data de Validade'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {reviewModal.entry.title} · {reviewModal.entry.empresaNome}
                  {reviewModal.entry.colaboradorNome
                    ? ` · ${reviewModal.entry.colaboradorNome}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {reviewModal.mode === 'REPROVADO' && (
                <div>
                  <label className="block font-semibold text-rose-300 mb-1.5">
                    Motivo / Justificativa da Recusa *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={modalMotivo}
                    onChange={(e) => setModalMotivo(e.target.value)}
                    placeholder="Descreva claramente o que a contratada deve corrigir para reenvio..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
              )}

              {(reviewModal.mode === 'APROVADO' || reviewModal.mode === 'VALIDADE') && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalSemValidade}
                      onChange={(e) => setModalSemValidade(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-950"
                    />
                    <span>Documento sem data de validade (validade indeterminada)</span>
                  </label>

                  {!modalSemValidade && (
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">
                        Data de Validade {reviewModal.mode === 'VALIDADE' ? '*' : '(opcional)'}
                      </label>
                      <input
                        type="date"
                        required={reviewModal.mode === 'VALIDADE'}
                        value={modalValidade}
                        onChange={(e) => setModalValidade(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">
                      Observações Técnicas (opcional)
                    </label>
                    <textarea
                      rows={2}
                      value={modalObs}
                      onChange={(e) => setModalObs(e.target.value)}
                      placeholder="Observações adicionais..."
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-xs text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60 ${
                  reviewModal.mode === 'REPROVADO'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : reviewModal.mode === 'APROVADO'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                {reviewModal.mode === 'APROVADO'
                  ? 'Confirmar Aceite'
                  : reviewModal.mode === 'REPROVADO'
                  ? 'Confirmar Recusa'
                  : 'Salvar Validade'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Protected File Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">{previewDoc.itemLabel}</h3>
                <p className="text-[11px] text-slate-400">
                  {previewDoc.fileName} {previewDoc.version ? `· v${previewDoc.version}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 bg-slate-950 overflow-hidden flex items-center justify-center">
              {previewDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewDoc.objectUrl}
                  title={previewDoc.fileName}
                  className="w-full h-full border-0"
                />
              ) : (
                <img
                  src={previewDoc.objectUrl}
                  alt={previewDoc.fileName}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
