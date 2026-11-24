import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCheck2,
  FileText,
  Sparkles,
  Search,
  Eye,
  History,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  Lock,
  Loader2,
  X,
  Download,
  Archive,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  Phone,
  Mail,
  Briefcase,
  ShieldAlert,
  Send,
  GraduationCap,
  Stethoscope,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  IntegrationServerDetailResult,
  useSST,
} from '../../context/SSTContext';
import type {
  Company,
  ConclusaoAptidao,
  ContractorIntegration,
  ContractorIntegrationItem,
  IntegrationDocumentVersion,
  IntegrationItemStatus,
  IntegrationWorkflowStatus,
} from '../../types/sst';
import {
  CATEGORY_BY_ID,
  classifyIntegrationDocumentGroup,
  groupItemsByMandatoryCategories,
} from '../../utils/integrationDocumentCatalog';

const STATUS_META: Record<IntegrationWorkflowStatus, { label: string; badgeClass: string }> = {
  RASCUNHO: { label: 'Rascunho', badgeClass: 'bg-slate-800/80 text-slate-300 border-slate-700' },
  PENDENTE_DOCUMENTACAO: {
    label: 'Pendente de Documentação',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  EM_ENVIO: { label: 'Em Envio', badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  ENVIADA: { label: 'Enviada', badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  AGUARDANDO_ANALISE: {
    label: 'Aguardando Análise',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  EM_ANALISE: {
    label: 'Em Análise',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  PENDENTE_CORRECAO: {
    label: 'Pendente Correção',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  REENVIADA: {
    label: 'Reenviada',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  APROVADA: {
    label: 'Aprovada',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  REPROVADA: {
    label: 'Reprovada',
    badgeClass: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
  ENCERRADA: {
    label: 'Encerrada',
    badgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
  },
};

const ITEM_META: Record<IntegrationItemStatus, { label: string; badgeClass: string }> = {
  PENDENTE_ENVIO: { label: 'Pendente Envio', badgeClass: 'bg-slate-800 text-slate-300 border-slate-700' },
  ENVIADO: { label: 'Enviado', badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  EM_ANALISE: { label: 'Em Análise', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  APROVADO: { label: 'Aprovado', badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  REPROVADO: { label: 'Reprovado', badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  SUBSTITUIDO: { label: 'Substituído', badgeClass: 'bg-slate-800 text-slate-400 border-slate-700' },
};

const APTITUDE_OPTIONS = [
  { key: 'trabalho_altura', label: 'Trabalho em Altura (NR-35)' },
  { key: 'espaco_confinado', label: 'Espaço Confinado (NR-33)' },
  { key: 'eletricidade', label: 'Eletricidade (NR-10)' },
  { key: 'trabalho_quente', label: 'Trabalho a Quente' },
  { key: 'escavacao', label: 'Escavação' },
];

const APTITUDE_LABEL_MAP: Record<string, string> = APTITUDE_OPTIONS.reduce<Record<string, string>>(
  (acc, opt) => {
    acc[opt.key] = opt.label;
    return acc;
  },
  {}
);

interface ItemEditDraft {
  dataEmissao: string;
  dataValidade: string;
  semValidade: boolean;
  numeroDocumento: string;
  conclusaoAso: ConclusaoAptidao;
  aptidoesEspecificas: string[];
  motivoReprovacao: string;
}

interface DocumentPreviewState {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  objectUrl: string;
  itemLabel: string;
  version?: number;
}

interface BlockingItemInfo {
  itemId: string;
  nomeExibicao: string;
  ownerLabel: string;
  reason: string;
  severity: 'missing' | 'pending' | 'rejected' | 'expired';
}

function digitsOnly(value?: string): string {
  return (value || '').replace(/\D/g, '');
}

function formatDatePt(iso?: string): string {
  if (!iso) return '—';
  const normalized = iso.slice(0, 10);
  const parts = normalized.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('pt-BR');
}

function formatDateTimePt(iso?: string): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getValidityState(
  dataValidade?: string,
  semValidade?: boolean
): { state: 'none' | 'valid' | 'expiring' | 'expired'; daysRemaining: number | null; label: string } {
  if (semValidade) {
    return { state: 'none', daysRemaining: null, label: 'Sem validade definida' };
  }
  if (!dataValidade) {
    return { state: 'none', daysRemaining: null, label: 'Validade não informada' };
  }
  const todayStr = getTodayIso();
  const targetStr = dataValidade.slice(0, 10);
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const targetMs = new Date(`${targetStr}T00:00:00Z`).getTime();
  if (Number.isNaN(targetMs)) {
    return { state: 'none', daysRemaining: null, label: dataValidade };
  }
  const diffDays = Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return {
      state: 'expired',
      daysRemaining: diffDays,
      label: `Vencido há ${Math.abs(diffDays)}d (${formatDatePt(targetStr)})`,
    };
  }
  if (diffDays <= 30) {
    return {
      state: 'expiring',
      daysRemaining: diffDays,
      label: `Vence em ${diffDays}d (${formatDatePt(targetStr)})`,
    };
  }
  return {
    state: 'valid',
    daysRemaining: diffDays,
    label: `Válido até ${formatDatePt(targetStr)}`,
  };
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const IntegrationsAdminView: React.FC = () => {
  const { isAdmin, isAuditor } = useAuth();
  const {
    companies,
    activityProfiles,
    listIntegrationsOnServer,
    getIntegrationDetailOnServer,
    fetchIntegrationItemFileBlobOnServer,
    startIntegrationReviewOnServer,
    reviewIntegrationItemOnServer,
    requestIntegrationCorrectionOnServer,
    approveIntegrationOnServer,
    rejectIntegrationOnServer,
    closeIntegrationOnServer,
  } = useSST();

  // Server-backed integration list (strictly from GET /api/integrations)
  const [integrations, setIntegrations] = useState<ContractorIntegration[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Filters (Section 3)
  const [search, setSearch] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [activityFilter, setActivityFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modal & review state
  const [selectedDetail, setSelectedDetail] = useState<IntegrationServerDetailResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalTab, setModalTab] = useState<'documentos' | 'auditoria'>('documentos');
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemEditDraft>>({});
  const [decisionNote, setDecisionNote] = useState('');
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<Record<string, boolean>>({});
  const [previewDoc, setPreviewDoc] = useState<DocumentPreviewState | null>(null);
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);

  const canAccessView = isAdmin || isAuditor;

  const fetchIntegrations = useCallback(async () => {
    if (!canAccessView) return;
    setLoadingList(true);
    setListError(null);
    try {
      const data = await listIntegrationsOnServer();
      setIntegrations(data);
    } catch (err: any) {
      setListError(err?.message || 'Não foi possível carregar as integrações no servidor.');
    } finally {
      setLoadingList(false);
    }
  }, [canAccessView, listIntegrationsOnServer]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // Cleanup Blob URL whenever document preview closes or changes
  useEffect(() => {
    const currentObjectUrl = previewDoc?.objectUrl;
    return () => {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [previewDoc]);

  const syncIntegrationInList = useCallback((updated: ContractorIntegration) => {
    setIntegrations((prev) => {
      const idx = prev.findIndex((item) => item.id === updated.id);
      if (idx < 0) return [updated, ...prev];
      const clone = [...prev];
      clone[idx] = updated;
      return clone;
    });
  }, []);

  // Filter options derived from live server list + activityProfiles
  const companyFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of integrations) {
      const key = item.empresaId || item.empresaNome;
      if (key && !map.has(key)) {
        map.set(key, item.empresaNome);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [integrations]);

  const activityFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const act of activityProfiles) {
      map.set(act.id, act.nome);
    }
    for (const integ of integrations) {
      integ.atividadeIds.forEach((id, idx) => {
        if (!map.has(id)) {
          map.set(id, integ.atividadeNomes[idx] || id);
        }
      });
    }
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [activityProfiles, integrations]);

  const activityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const act of activityProfiles) {
      map.set(act.id, act.nome);
    }
    return map;
  }, [activityProfiles]);

  // KPIs (Section 3)
  const kpis = useMemo(() => {
    return {
      recebidas: integrations.length,
      aguardandoAnalise: integrations.filter(
        (i) => i.status === 'AGUARDANDO_ANALISE' || i.status === 'ENVIADA'
      ).length,
      emAnalise: integrations.filter((i) => i.status === 'EM_ANALISE').length,
      comPendencias: integrations.filter((i) => i.status === 'PENDENTE_CORRECAO').length,
      reenviadas: integrations.filter((i) => i.status === 'REENVIADA').length,
      aprovadas: integrations.filter((i) => i.status === 'APROVADA').length,
      reprovadas: integrations.filter((i) => i.status === 'REPROVADA').length,
    };
  }, [integrations]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(cnpjFilter.trim()) ||
    companyFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    activityFilter !== 'ALL' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const clearAllFilters = () => {
    setSearch('');
    setCnpjFilter('');
    setCompanyFilter('ALL');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setActivityFilter('ALL');
    setDateFrom('');
    setDateTo('');
  };

  const filteredList = useMemo(() => {
    let list = integrations;

    if (statusFilter === 'WAITING_ANALYSIS') {
      list = list.filter((i) => i.status === 'AGUARDANDO_ANALISE' || i.status === 'ENVIADA');
    } else if (statusFilter !== 'ALL') {
      list = list.filter((i) => i.status === statusFilter);
    }

    if (companyFilter !== 'ALL') {
      list = list.filter((i) => (i.empresaId || i.empresaNome) === companyFilter);
    }

    if (typeFilter !== 'ALL') {
      list = list.filter((i) => i.tipo === typeFilter);
    }

    if (activityFilter !== 'ALL') {
      list = list.filter((i) => i.atividadeIds.includes(activityFilter));
    }

    if (cnpjFilter.trim()) {
      const targetDigits = digitsOnly(cnpjFilter);
      const rawQuery = cnpjFilter.trim().toLowerCase();
      list = list.filter((i) => {
        if (targetDigits) {
          return digitsOnly(i.empresaCnpj).includes(targetDigits);
        }
        return i.empresaCnpj.toLowerCase().includes(rawQuery);
      });
    }

    if (dateFrom) {
      list = list.filter((i) => {
        const refDate = (i.dataEnvio || i.dataCriacao || '').slice(0, 10);
        return refDate >= dateFrom;
      });
    }

    if (dateTo) {
      list = list.filter((i) => {
        const refDate = (i.dataEnvio || i.dataCriacao || '').slice(0, 10);
        return refDate <= dateTo;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.codigoProtocolo.toLowerCase().includes(q) ||
          i.empresaNome.toLowerCase().includes(q) ||
          i.empresaCnpj.toLowerCase().includes(q) ||
          i.solicitadoPorNome.toLowerCase().includes(q) ||
          i.atividadeNomes.some((act) => act.toLowerCase().includes(q))
      );
    }

    return list;
  }, [
    integrations,
    statusFilter,
    companyFilter,
    typeFilter,
    activityFilter,
    cnpjFilter,
    dateFrom,
    dateTo,
    search,
  ]);

  const hydrateDraftsFromDetail = useCallback((detail: IntegrationServerDetailResult) => {
    const next: Record<string, ItemEditDraft> = {};
    for (const item of detail.items) {
      next[item.id] = {
        dataEmissao:
          item.dataEmissao ||
          item.smartDocsSugestao?.dataEmissaoSugerida ||
          new Date().toISOString().slice(0, 10),
        dataValidade: item.dataValidade || item.smartDocsSugestao?.dataValidadeSugerida || '',
        semValidade: Boolean(item.semValidade),
        numeroDocumento: item.numeroDocumento || '',
        conclusaoAso:
          item.conclusaoAso ||
          (item.smartDocsSugestao?.resultadoAptidaoSugerido as ConclusaoAptidao) ||
          'apto',
        aptidoesEspecificas:
          item.aptidoesEspecificas && item.aptidoesEspecificas.length > 0
            ? item.aptidoesEspecificas
            : item.aptidaoEspecifica
            ? [item.aptidaoEspecifica]
            : [],
        motivoReprovacao: item.motivoReprovacao || '',
      };
    }
    setItemDrafts(next);
  }, []);

  const openDetailModal = async (integrationId: string) => {
    setLoadingDetail(true);
    setFeedback(null);
    setDecisionNote('');
    setModalTab('documentos');
    setExpandedHistoryItems({});
    try {
      const detail = await getIntegrationDetailOnServer(integrationId);
      setSelectedDetail(detail);
      syncIntegrationInList(detail.integration);
      hydrateDraftsFromDetail(detail);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao carregar detalhes da integração.' });
    } finally {
      setLoadingDetail(false);
    }
  };

  const openProtectedDocumentPreview = async (
    item: ContractorIntegrationItem,
    opts?: { version?: number; fileName?: string; labelSuffix?: string }
  ) => {
    if (!selectedDetail) return;
    const fileKey = `preview-${item.id}-v${opts?.version || item.versaoAtual || 1}`;
    setLoadingFileKey(fileKey);
    setFeedback(null);
    try {
      const result = await fetchIntegrationItemFileBlobOnServer(
        selectedDetail.integration.id,
        item.id,
        { version: opts?.version, download: false }
      );
      const objectUrl = URL.createObjectURL(result.blob);
      setPreviewDoc({
        fileName: opts?.fileName || item.arquivoNome || result.fileName,
        mimeType: result.mimeType,
        objectUrl,
        itemLabel: opts?.labelSuffix ? `${item.nomeExibicao} (${opts.labelSuffix})` : item.nomeExibicao,
        version: opts?.version || item.versaoAtual || 1,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível carregar o arquivo protegido para visualização.',
      });
    } finally {
      setLoadingFileKey(null);
    }
  };

  const downloadProtectedDocument = async (
    item: ContractorIntegrationItem,
    opts?: { version?: number; fileName?: string }
  ) => {
    if (!selectedDetail) return;
    const fileKey = `download-${item.id}-v${opts?.version || item.versaoAtual || 1}`;
    setLoadingFileKey(fileKey);
    setFeedback(null);
    try {
      const result = await fetchIntegrationItemFileBlobOnServer(
        selectedDetail.integration.id,
        item.id,
        { version: opts?.version, download: true }
      );
      const objectUrl = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = opts?.fileName || item.arquivoNome || result.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível baixar o arquivo protegido.',
      });
    } finally {
      setLoadingFileKey(null);
    }
  };

  const handleStartReview = async () => {
    if (!selectedDetail || !isAdmin) return;
    setBusyAction('start');
    setFeedback(null);
    try {
      const updated = await startIntegrationReviewOnServer(selectedDetail.integration.id, {
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });
      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      hydrateDraftsFromDetail(updated);
      setFeedback({ type: 'success', text: 'Análise técnica iniciada pelo Admin EHS.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao iniciar análise.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReviewItem = async (
    item: ContractorIntegrationItem,
    decisao: 'APROVADO' | 'REPROVADO',
    returnImmediatelyAfterReject = false
  ) => {
    if (!selectedDetail || !isAdmin) return;
    const draft = itemDrafts[item.id];
    const motivo = draft?.motivoReprovacao?.trim() || '';

    if (decisao === 'REPROVADO' && !motivo) {
      setFeedback({
        type: 'error',
        text: `Informe a justificativa obrigatória no campo do item "${item.nomeExibicao}" antes de ${
          returnImmediatelyAfterReject ? 'solicitar correção' : 'reprovar'
        }.`,
      });
      return;
    }

    if (decisao === 'APROVADO' && !item.arquivoNome) {
      setFeedback({
        type: 'error',
        text: `Não é possível aprovar "${item.nomeExibicao}" sem arquivo anexado pelo solicitante.`,
      });
      return;
    }

    setBusyAction(returnImmediatelyAfterReject ? `correct-${item.id}` : item.id);
    setFeedback(null);
    try {
      let updated = await reviewIntegrationItemOnServer(selectedDetail.integration.id, item.id, {
        decisao,
        motivo: decisao === 'REPROVADO' ? motivo : undefined,
        dataEmissao: draft?.dataEmissao,
        dataValidade: draft?.semValidade ? '' : draft?.dataValidade,
        semValidade: draft?.semValidade,
        numeroDocumento: draft?.numeroDocumento,
        conclusaoAso: draft?.conclusaoAso,
        aptidoesEspecificas: draft?.aptidoesEspecificas,
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });

      if (decisao === 'REPROVADO' && returnImmediatelyAfterReject) {
        const ownerTag =
          item.categoria === 'colaborador' && item.colaboradorNome
            ? `${item.nomeExibicao} (${item.colaboradorNome})`
            : item.nomeExibicao;
        updated = await requestIntegrationCorrectionOnServer(updated.integration.id, {
          justificativa: `Correção solicitada para "${ownerTag}": ${motivo}`,
          expectedVersion: updated.integration.versaoConcorrencia,
        });
      }

      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      hydrateDraftsFromDetail(updated);
      setFeedback({
        type: 'success',
        text:
          decisao === 'APROVADO'
            ? updated.integration.tipo === 'INTEGRACAO_INICIAL' && !item.officialRecordId
              ? `Documento "${item.nomeExibicao}" conferido e aprovado (preservado). A oficialização do colaborador/empresa na base SST ocorrerá somente na aprovação final completa.`
              : `Documento "${item.nomeExibicao}" aprovado e atualizado oficialmente na base SST.`
            : returnImmediatelyAfterReject
            ? `Correção solicitada para "${item.nomeExibicao}". Apenas itens pendentes/reprovados foram devolvidos ao solicitante; documentos já aprovados foram preservados.`
            : `Documento "${item.nomeExibicao}" marcado como reprovado. Você pode continuar analisando os demais itens ou devolver as pendências.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao registrar decisão no item.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReturnForCorrection = async () => {
    if (!selectedDetail || !isAdmin) return;
    if (!decisionNote.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe a orientação/justificativa no campo de decisão antes de devolver pendências.',
      });
      return;
    }
    setBusyAction('correction');
    setFeedback(null);
    try {
      const updated = await requestIntegrationCorrectionOnServer(selectedDetail.integration.id, {
        justificativa: decisionNote.trim(),
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });
      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      hydrateDraftsFromDetail(updated);
      setDecisionNote('');
      setFeedback({
        type: 'success',
        text: 'Somente os itens pendentes/reprovados foram devolvidos ao solicitante. Todos os documentos aprovados foram mantidos intactos.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao devolver para correção.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleApproveIntegration = async () => {
    if (!selectedDetail || !isAdmin) return;
    setBusyAction('approve');
    setFeedback(null);
    try {
      const updated = await approveIntegrationOnServer(selectedDetail.integration.id, {
        justificativa: decisionNote.trim() || undefined,
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });
      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      hydrateDraftsFromDetail(updated);
      setDecisionNote('');
      setFeedback({
        type: 'success',
        text: 'Integração APROVADA! Os documentos oficiais estão ativos no motor de conformidade (a liberação de atividades críticas continua exigindo PT/APR formal).',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Aprovação bloqueada pelo servidor.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRejectIntegration = async () => {
    if (!selectedDetail || !isAdmin) return;
    if (!decisionNote.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe a justificativa técnica obrigatória para reprovar o processo de integração.',
      });
      return;
    }
    setBusyAction('reject');
    setFeedback(null);
    try {
      const updated = await rejectIntegrationOnServer(selectedDetail.integration.id, {
        justificativa: decisionNote.trim(),
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });
      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      setDecisionNote('');
      setFeedback({ type: 'success', text: 'Integração reprovada com justificativa auditada.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao reprovar integração.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCloseIntegration = async () => {
    if (!selectedDetail || !isAdmin) return;
    setBusyAction('close');
    setFeedback(null);
    try {
      const updated = await closeIntegrationOnServer(selectedDetail.integration.id, {
        justificativa: decisionNote.trim() || 'Processo encerrado pelo Admin EHS.',
        expectedVersion: selectedDetail.integration.versaoConcorrencia,
      });
      setSelectedDetail(updated);
      syncIntegrationInList(updated.integration);
      setDecisionNote('');
      setFeedback({ type: 'success', text: 'Integração encerrada com histórico preservado.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao encerrar integração.' });
    } finally {
      setBusyAction(null);
    }
  };

  // Resolve full Company metadata (from official companies collection OR pending solicitacaoNovaEmpresa)
  const resolvedCompanyInfo = useMemo(() => {
    if (!selectedDetail) return null;
    const integ = selectedDetail.integration;
    const official: Company | undefined = integ.empresaId
      ? companies.find((c) => c.id === integ.empresaId)
      : undefined;
    const req = integ.solicitacaoNovaEmpresa;

    return {
      isNewPending: Boolean(integ.empresaPendenteCadastro && !official),
      razaoSocial: official?.razaoSocial || req?.razaoSocial || integ.empresaNome,
      nomeFantasia: official?.nomeFantasia || req?.nomeFantasia || integ.empresaNome,
      cnpj: official?.cnpj || req?.cnpj || integ.empresaCnpj,
      responsavelLegal: official?.responsavelLegal || req?.responsavelLegal || 'Não informado',
      responsavelSST: official?.responsavelSST || req?.responsavelSST || 'Não informado',
      email: official?.email || req?.email || integ.solicitadoPorEmail || 'Não informado',
      telefone: official?.telefone || req?.telefone || 'Não informado',
      unidadeAtendimento: official?.unidadeAtendimento || req?.unidadeAtendimento || 'Não informada',
      atividadeContratada: official?.atividadeContratada || req?.atividadeContratada || '—',
      dataInicioContrato: official?.dataInicioContrato || req?.dataInicioContrato,
      dataTerminoContrato: official?.dataTerminoContrato || req?.dataTerminoContrato,
      contratoIndeterminado: Boolean(
        official?.contrato_indeterminado ?? req?.contrato_indeterminado
      ),
      situacao: official?.situacao,
    };
  }, [selectedDetail, companies]);

  // Group items by Empresa and by Colaborador (enriched with candidate profile, ASO & training summaries)
  const groupedModalItems = useMemo(() => {
    if (!selectedDetail) {
      return {
        empresa: [] as ContractorIntegrationItem[],
        colaboradores: [] as Array<{
          key: string;
          nome: string;
          cargo?: string;
          setor?: string;
          cpf?: string;
          jaExistiaNaBase: boolean;
          atividadesNomes: string[];
          asoItems: ContractorIntegrationItem[];
          trainingItems: ContractorIntegrationItem[];
          items: ContractorIntegrationItem[];
        }>,
      };
    }

    const integ = selectedDetail.integration;
    const empresa = selectedDetail.items.filter((i) => i.categoria !== 'colaborador');

    const colabMap = new Map<
      string,
      {
        key: string;
        nome: string;
        cargo?: string;
        setor?: string;
        cpf?: string;
        jaExistiaNaBase: boolean;
        atividadesNomes: string[];
        asoItems: ContractorIntegrationItem[];
        trainingItems: ContractorIntegrationItem[];
        items: ContractorIntegrationItem[];
      }
    >();

    // Seed groups from integration.colaboradoresCandidatos so full metadata is always available
    for (const cand of integ.colaboradoresCandidatos || []) {
      const key = cand.aprovadoEmployeeId || cand.colaboradorId || cand.candidateId || cand.nomeCompleto;
      const actNames =
        cand.atividadesHabilitadasIds && cand.atividadesHabilitadasIds.length > 0
          ? cand.atividadesHabilitadasIds.map((id) => activityNameById.get(id) || id)
          : integ.atividadeNomes;

      colabMap.set(key, {
        key,
        nome: cand.nomeCompleto,
        cargo: cand.cargo,
        setor: cand.setor,
        cpf: cand.cpf,
        jaExistiaNaBase: Boolean(cand.jaExistiaNaBase || cand.aprovadoEmployeeId),
        atividadesNomes: actNames,
        asoItems: [],
        trainingItems: [],
        items: [],
      });
    }

    // Attach employee documents to their matching candidate group
    for (const item of selectedDetail.items.filter((i) => i.categoria === 'colaborador')) {
      let targetKey =
        (item.colaboradorId && colabMap.has(item.colaboradorId) && item.colaboradorId) ||
        (item.colaboradorCandidateId &&
          colabMap.has(item.colaboradorCandidateId) &&
          item.colaboradorCandidateId) ||
        '';

      if (!targetKey) {
        // Fallback match by CPF or name
        for (const [k, existing] of colabMap.entries()) {
          if (
            (item.colaboradorCpf && existing.cpf && digitsOnly(item.colaboradorCpf) === digitsOnly(existing.cpf)) ||
            (item.colaboradorNome && existing.nome.toLowerCase() === item.colaboradorNome.toLowerCase())
          ) {
            targetKey = k;
            break;
          }
        }
      }

      if (!targetKey) {
        targetKey = item.colaboradorId || item.colaboradorCandidateId || item.colaboradorNome || `col-${item.id}`;
        colabMap.set(targetKey, {
          key: targetKey,
          nome: item.colaboradorNome || 'Colaborador Terceirizado',
          cargo: item.colaboradorCargo,
          cpf: item.colaboradorCpf,
          jaExistiaNaBase: Boolean(item.colaboradorId),
          atividadesNomes: integ.atividadeNomes,
          asoItems: [],
          trainingItems: [],
          items: [],
        });
      }

      const group = colabMap.get(targetKey)!;
      group.items.push(item);
      if (item.origemColecao === 'exams') {
        group.asoItems.push(item);
      } else if (item.origemColecao === 'trainings') {
        group.trainingItems.push(item);
      }
    }

    return { empresa, colaboradores: Array.from(colabMap.values()) };
  }, [selectedDetail, activityNameById]);

  // Strict blocking gate matching backend approveIntegration (missing, pending, rejected, OR expired)
  const blockingMandatoryItems = useMemo<BlockingItemInfo[]>(() => {
    if (!selectedDetail) return [];
    const todayIso = getTodayIso();
    const blockers: BlockingItemInfo[] = [];

    for (const item of selectedDetail.items) {
      if (!item.obrigatorio) continue;
      const ownerLabel =
        item.categoria === 'colaborador' && item.colaboradorNome
          ? `Colaborador: ${item.colaboradorNome}`
          : `Empresa: ${item.empresaNome}`;

      if (item.status !== 'APROVADO') {
        let reason = 'Aguardando aprovação do Admin EHS';
        let severity: BlockingItemInfo['severity'] = 'pending';
        if (item.status === 'PENDENTE_ENVIO') {
          reason = 'Arquivo ainda não enviado pelo solicitante';
          severity = 'missing';
        } else if (item.status === 'REPROVADO') {
          reason = item.motivoReprovacao
            ? `Reprovado: ${item.motivoReprovacao}`
            : 'Reprovado — aguardando correção e reenvio';
          severity = 'rejected';
        } else if (item.status === 'ENVIADO' || item.status === 'EM_ANALISE') {
          reason = 'Enviado — pendente de conferência e aprovação individual';
          severity = 'pending';
        }
        blockers.push({
          itemId: item.id,
          nomeExibicao: item.nomeExibicao,
          ownerLabel,
          reason,
          severity,
        });
      } else if (!item.semValidade && item.dataValidade && item.dataValidade.slice(0, 10) < todayIso) {
        blockers.push({
          itemId: item.id,
          nomeExibicao: item.nomeExibicao,
          ownerLabel,
          reason: `Documento vencido em ${formatDatePt(item.dataValidade)} — exige atualização`,
          severity: 'expired',
        });
      }
    }

    return blockers;
  }, [selectedDetail]);

  const canFinalizeApproval =
    Boolean(selectedDetail) &&
    selectedDetail!.items.length > 0 &&
    blockingMandatoryItems.length === 0 &&
    ![
      'RASCUNHO',
      'PENDENTE_DOCUMENTACAO',
      'EM_ENVIO',
      'PENDENTE_CORRECAO',
      'APROVADA',
      'REPROVADA',
      'ENCERRADA',
    ].includes(selectedDetail!.integration.status);

  // Defensive Role Guard (Section 2)
  if (!canAccessView) {
    return (
      <div className="rounded-2xl bg-slate-900 border border-rose-500/30 p-8 text-center space-y-3 max-w-xl mx-auto mt-10">
        <div className="mx-auto h-12 w-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
          <ShieldAlert size={24} />
        </div>
        <h2 className="text-lg font-bold text-white">Acesso Restrito — Gestão de Integrações</h2>
        <p className="text-sm text-slate-400">
          Este módulo administrativo é exclusivo do perfil <strong>Admin EHS</strong> (com consulta
          somente leitura para <strong>Auditor</strong>). Utilize a <strong>Central de Integração</strong>{' '}
          para enviar e acompanhar solicitações da sua empresa contratada.
        </p>
      </div>
    );
  }

  const toggleItemHistory = (itemId: string) => {
    setExpandedHistoryItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const renderAdminItemReviewCard = (item: ContractorIntegrationItem) => {
    const draft = itemDrafts[item.id];
    const isApproved = item.status === 'APROVADO';
    const isClosed = selectedDetail?.integration.status === 'ENCERRADA';
    const isBusy = busyAction === item.id || busyAction === `correct-${item.id}`;
    const validity = getValidityState(item.dataValidade, item.semValidade);
    const hasHistory = (item.versoes || []).length > 0;
    const historyOpen = Boolean(expandedHistoryItems[item.id]);
    const ownerDescription =
      item.categoria === 'colaborador' && item.colaboradorNome
        ? `Colaborador: ${item.colaboradorNome}${item.colaboradorCargo ? ` (${item.colaboradorCargo})` : ''}`
        : `Empresa: ${item.empresaNome}`;
    const docGroup =
      item.categoria === 'colaborador'
        ? CATEGORY_BY_ID[classifyIntegrationDocumentGroup(item)]
        : null;
    const currentPreviewKey = `preview-${item.id}-v${item.versaoAtual || 1}`;
    const currentDownloadKey = `download-${item.id}-v${item.versaoAtual || 1}`;

    return (
      <div
        key={item.id}
        className={`rounded-xl border p-4 space-y-3 ${
          isApproved
            ? validity.state === 'expired'
              ? 'bg-rose-950/20 border-rose-500/40'
              : 'bg-emerald-950/15 border-emerald-500/30'
            : item.status === 'REPROVADO'
            ? 'bg-rose-950/20 border-rose-500/40'
            : 'bg-slate-950/80 border-slate-800'
        }`}
      >
        {/* Top Row: Title + Metadata + Status */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-blue-300">
                {item.documentoCodigoCanonico}
              </span>
              <span className="text-slate-600">·</span>
              <h4 className="text-sm font-bold text-white">{item.nomeExibicao}</h4>
              {item.obrigatorio ? (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Obrigatório
                </span>
              ) : (
                <span className="text-[10px] uppercase text-slate-400">Opcional / Complementar</span>
              )}
              {item.versaoAtual > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-slate-400">
                  · v{item.versaoAtual}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="text-slate-300 font-medium">{ownerDescription}</span>
              {docGroup && (
                <>
                  <span>·</span>
                  <span className="text-sky-300/90 font-medium">
                    {docGroup.codigoEtiqueta}: {docGroup.titulo}
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                Coleção oficial: <span className="font-mono text-slate-300">{item.origemColecao}</span>
              </span>
              {item.baseLegal && (
                <>
                  <span>·</span>
                  <span>{item.baseLegal}</span>
                </>
              )}
            </div>

            {/* Dates & Validity Line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums pt-0.5">
              <span className="text-slate-400">
                Emissão: <strong className="text-slate-200">{formatDatePt(item.dataEmissao)}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span
                className={
                  validity.state === 'expired'
                    ? 'text-rose-300 font-semibold'
                    : validity.state === 'expiring'
                    ? 'text-amber-300 font-semibold'
                    : validity.state === 'valid'
                    ? 'text-emerald-300'
                    : 'text-slate-400'
                }
              >
                {validity.label}
              </span>
              {item.origemColecao === 'exams' && item.conclusaoAso && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-sky-300 uppercase font-semibold">
                    ASO: {item.conclusaoAso.replace(/_/g, ' ')}
                  </span>
                </>
              )}
            </div>
          </div>

          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border whitespace-nowrap shrink-0 ${
              ITEM_META[item.status].badgeClass
            }`}
          >
            {ITEM_META[item.status].label}
          </span>
        </div>

        {/* File Info + Authenticated Preview + Authenticated Download */}
        {item.arquivoNome ? (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-white font-medium min-w-0">
              <FileText size={14} className="text-blue-400 shrink-0" />
              <span className="truncate max-w-[260px] sm:max-w-[360px]">{item.arquivoNome}</span>
              <span className="text-slate-400 tabular-nums shrink-0">
                ({formatFileSize(item.arquivoTamanhoBytes)})
              </span>
              {item.dataEnvio && (
                <span className="text-slate-500 hidden md:inline tabular-nums shrink-0">
                  · Enviado em {formatDateTimePt(item.dataEnvio)}
                </span>
              )}
              {item.enviadoPorNome && (
                <span className="text-slate-500 hidden lg:inline shrink-0">
                  por {item.enviadoPorNome}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {item.hasStoredFile !== false ? (
                <>
                  <button
                    type="button"
                    disabled={loadingFileKey !== null}
                    onClick={() =>
                      openProtectedDocumentPreview(item, {
                        version: item.versaoAtual || 1,
                        fileName: item.arquivoNome,
                        labelSuffix: item.versaoAtual ? `v${item.versaoAtual}` : undefined,
                      })
                    }
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-blue-300 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {loadingFileKey === currentPreviewKey ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Eye size={13} />
                    )}
                    Visualizar
                  </button>
                  <button
                    type="button"
                    disabled={loadingFileKey !== null}
                    onClick={() =>
                      downloadProtectedDocument(item, {
                        version: item.versaoAtual || 1,
                        fileName: item.arquivoNome,
                      })
                    }
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {loadingFileKey === currentDownloadKey ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    Baixar
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-amber-300/90 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Registro legado sem binário armazenado — solicite reenvio do arquivo
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-amber-950/20 border border-amber-500/20 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Nenhum arquivo anexado pelo solicitante até o momento.</span>
          </div>
        )}

        {/* SmartDocs AI Suggestions */}
        {item.smartDocsSugestao && (
          <div className="rounded-lg bg-indigo-950/30 border border-indigo-500/30 px-3 py-2 text-xs text-indigo-200 space-y-1">
            <p className="font-semibold text-indigo-300 flex items-center gap-1.5">
              <Sparkles size={13} /> Sugestão SmartDocs IA (apoio à conferência humana)
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
              {item.smartDocsSugestao.tipoDocumentoSugerido && (
                <span>Tipo: {item.smartDocsSugestao.tipoDocumentoSugerido}</span>
              )}
              {item.smartDocsSugestao.dataEmissaoSugerida && (
                <span>Emissão: {formatDatePt(item.smartDocsSugestao.dataEmissaoSugerida)}</span>
              )}
              {item.smartDocsSugestao.dataValidadeSugerida && (
                <span>Validade: {formatDatePt(item.smartDocsSugestao.dataValidadeSugerida)}</span>
              )}
              {item.smartDocsSugestao.resultadoAptidaoSugerido && (
                <span>Aptidão: {item.smartDocsSugestao.resultadoAptidaoSugerido}</span>
              )}
              {item.smartDocsSugestao.qualidadeLeitura && (
                <span>Qualidade: {item.smartDocsSugestao.qualidadeLeitura}</span>
              )}
            </div>
            {item.smartDocsSugestao.alertas && item.smartDocsSugestao.alertas.length > 0 && (
              <p className="text-[11px] text-amber-300">
                {item.smartDocsSugestao.alertas.join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Approved Status Banner OR Admin Individual Review Controls */}
        {isApproved ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-500/30 rounded-lg px-3 py-2">
            <span className="flex items-center gap-1.5">
              <Lock size={13} className="shrink-0" />
              <span>
                Aprovado por <strong>{item.analisadoPorNome}</strong> em{' '}
                <span className="tabular-nums">{formatDateTimePt(item.dataAnalise)}</span>
              </span>
            </span>
            {item.officialCollection && item.officialRecordId ? (
              <span className="font-mono text-[11px] text-emerald-200">
                Oficial: {item.officialCollection}/{item.officialRecordId}
              </span>
            ) : (
              <span className="text-[11px] text-emerald-200/90">
                Preservado · Oficialização na aprovação final completa
              </span>
            )}
          </div>
        ) : (
          isAdmin &&
          !isClosed &&
          draft && (
            <div className="space-y-3 pt-2.5 border-t border-slate-800">
              {item.arquivoNome && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Data de Emissão</label>
                      <input
                        type="date"
                        value={draft.dataEmissao}
                        onChange={(e) =>
                          setItemDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, dataEmissao: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Data de Validade</label>
                      <input
                        type="date"
                        value={draft.dataValidade}
                        disabled={draft.semValidade}
                        onChange={(e) =>
                          setItemDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, dataValidade: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white tabular-nums disabled:opacity-40"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Nº Documento (opcional)</label>
                      <input
                        type="text"
                        value={draft.numeroDocumento}
                        placeholder="Ex.: CERT-2026-01"
                        onChange={(e) =>
                          setItemDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, numeroDocumento: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="flex items-end pb-1.5">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.semValidade}
                          onChange={(e) =>
                            setItemDrafts((prev) => ({
                              ...prev,
                              [item.id]: { ...draft, semValidade: e.target.checked },
                            }))
                          }
                          className="accent-blue-500"
                        />
                        Sem validade
                      </label>
                    </div>
                  </div>

                  {item.origemColecao === 'exams' && (
                    <div className="space-y-2 rounded-lg bg-slate-900/70 border border-slate-800 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-slate-400 font-semibold">Conclusão ASO:</span>
                        {(['apto', 'apto_com_restricoes', 'inapto'] as ConclusaoAptidao[]).map((c) => (
                          <label key={c} className="flex items-center gap-1.5 text-slate-200 cursor-pointer">
                            <input
                              type="radio"
                              name={`aso-${item.id}`}
                              checked={draft.conclusaoAso === c}
                              onChange={() =>
                                setItemDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: { ...draft, conclusaoAso: c },
                                }))
                              }
                            />
                            <span className="uppercase text-[11px]">{c.replace(/_/g, ' ')}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {APTITUDE_OPTIONS.map((opt) => {
                          const active = draft.aptidoesEspecificas.includes(opt.key);
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() =>
                                setItemDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    ...draft,
                                    aptidoesEspecificas: active
                                      ? draft.aptidoesEspecificas.filter((k) => k !== opt.key)
                                      : [...draft.aptidoesEspecificas, opt.key],
                                  },
                                }))
                              }
                              className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${
                                active
                                  ? 'bg-sky-600/30 border-sky-500 text-sky-200'
                                  : 'bg-slate-950 border-slate-700 text-slate-400'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Justification + 3 Explicit Individual Actions (Section 5) */}
              <div className="flex flex-col lg:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Justificativa obrigatória para reprovar ou solicitar correção deste documento..."
                  value={draft.motivoReprovacao}
                  onChange={(e) =>
                    setItemDrafts((prev) => ({
                      ...prev,
                      [item.id]: { ...draft, motivoReprovacao: e.target.value },
                    }))
                  }
                  className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-white"
                />
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isBusy || busyAction !== null}
                    onClick={() => handleReviewItem(item, 'REPROVADO', false)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <XCircle size={14} /> Reprovar Documento
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || busyAction !== null}
                    onClick={() => handleReviewItem(item, 'REPROVADO', true)}
                    title="Reprova este item e devolve imediatamente apenas as pendências ao solicitante, preservando os itens já aprovados."
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {busyAction === `correct-${item.id}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    Solicitar Correção
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || busyAction !== null || !item.arquivoNome}
                    title={
                      !item.arquivoNome
                        ? 'Aguarde o solicitante anexar o arquivo para aprovar este documento.'
                        : 'Aprovar e oficializar na base SST'
                    }
                    onClick={() => handleReviewItem(item, 'APROVADO', false)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {busyAction === item.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    Aprovar Documento
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {/* Registered Rejection Reason */}
        {item.status === 'REPROVADO' && item.motivoReprovacao && (
          <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2">
            <strong>Motivo registrado:</strong> {item.motivoReprovacao}
          </p>
        )}

        {/* Expandable Document Version History (Section 4 & 5) */}
        {hasHistory && (
          <div className="pt-1 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => toggleItemHistory(item.id)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <History size={12} />
              <span>
                Histórico de versões ({item.versoes.length})
              </span>
              {historyOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {historyOpen && (
              <div className="mt-2 space-y-1.5">
                {[...item.versoes]
                  .sort((a, b) => b.versao - a.versao)
                  .map((v: IntegrationDocumentVersion) => {
                    const verPreviewKey = `preview-${item.id}-v${v.versao}`;
                    const verDownloadKey = `download-${item.id}-v${v.versao}`;
                    return (
                      <div
                        key={v.versao}
                        className="rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-slate-200 tabular-nums">
                              v{v.versao}
                            </span>
                            <span className="text-slate-300 font-medium truncate">{v.arquivoNome}</span>
                            <span className="text-slate-500 tabular-nums">
                              ({formatFileSize(v.arquivoTamanhoBytes)})
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                ITEM_META[v.status].badgeClass
                              }`}
                            >
                              {ITEM_META[v.status].label}
                            </span>
                          </div>
                          <p className="text-slate-400 tabular-nums">
                            Enviado por {v.enviadoPorNome} em {formatDateTimePt(v.enviadoEm)}
                            {v.dataValidade ? ` · Validade: ${formatDatePt(v.dataValidade)}` : ''}
                            {v.analisadoPorNome
                              ? ` · Analisado por ${v.analisadoPorNome} (${formatDateTimePt(v.analisadoEm)})`
                              : ''}
                          </p>
                          {v.motivoReprovacao && (
                            <p className="text-rose-300">Motivo: {v.motivoReprovacao}</p>
                          )}
                        </div>

                        {v.hasStoredFile !== false && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={loadingFileKey !== null}
                              onClick={() =>
                                openProtectedDocumentPreview(item, {
                                  version: v.versao,
                                  fileName: v.arquivoNome,
                                  labelSuffix: `v${v.versao}`,
                                })
                              }
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {loadingFileKey === verPreviewKey ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : null}
                              Visualizar
                            </button>
                            <button
                              type="button"
                              disabled={loadingFileKey !== null}
                              onClick={() =>
                                downloadProtectedDocument(item, {
                                  version: v.versao,
                                  fileName: v.arquivoNome,
                                })
                              }
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {loadingFileKey === verDownloadKey ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : null}
                              Baixar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <ShieldCheck className="text-blue-500" size={26} />
            Gestão de Integrações
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Recebimento, conferência documental individual, devolução parcial de pendências e aprovação final de empresas contratadas e colaboradores terceirizados.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isAuditor && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs font-semibold text-emerald-300 whitespace-nowrap">
              <Eye size={14} /> Modo Auditoria (Somente Leitura)
            </span>
          )}
          <button
            type="button"
            onClick={fetchIntegrations}
            disabled={loadingList}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} />
            Atualizar Lista
          </button>
        </div>
      </div>

      {/* KPI Indicators (Section 3) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Recebidas', value: kpis.recebidas, color: 'text-white', filter: 'ALL' },
          {
            label: 'Aguard. Análise',
            value: kpis.aguardandoAnalise,
            color: 'text-indigo-400',
            filter: 'WAITING_ANALYSIS',
          },
          { label: 'Em Análise', value: kpis.emAnalise, color: 'text-amber-400', filter: 'EM_ANALISE' },
          {
            label: 'Pendentes Correção',
            value: kpis.comPendencias,
            color: 'text-rose-400',
            filter: 'PENDENTE_CORRECAO',
          },
          { label: 'Reenviadas', value: kpis.reenviadas, color: 'text-violet-400', filter: 'REENVIADA' },
          { label: 'Aprovadas', value: kpis.aprovadas, color: 'text-emerald-400', filter: 'APROVADA' },
          { label: 'Reprovadas', value: kpis.reprovadas, color: 'text-red-400', filter: 'REPROVADA' },
        ].map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => setStatusFilter(kpi.filter)}
            className={`text-left rounded-xl p-3.5 border transition-colors cursor-pointer ${
              statusFilter === kpi.filter
                ? 'bg-slate-800 border-blue-500'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <p className={`text-2xl font-bold tabular-nums ${kpi.color}`}>{kpi.value}</p>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5 truncate">{kpi.label}</p>
          </button>
        ))}
      </div>

      {/* Filters Bar (Section 3: Empresa, CNPJ, Status, Data envio, Tipo, Atividade crítica) */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Filter size={14} className="text-blue-400" />
            <span>Filtros da Fila de Integrações</span>
            <span className="text-slate-500 font-normal tabular-nums">
              · Exibindo {filteredList.length} de {integrations.length} solicitação(ões)
            </span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer whitespace-nowrap"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* Free Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Protocolo, empresa ou solicitante..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500"
            />
          </div>

          {/* Company Filter */}
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            aria-label="Filtrar por empresa"
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Todas as empresas</option>
            {companyFilterOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          {/* CNPJ Filter */}
          <input
            type="text"
            value={cnpjFilter}
            onChange={(e) => setCnpjFilter(e.target.value)}
            placeholder="Filtrar por CNPJ..."
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white font-mono placeholder:font-sans placeholder:text-slate-500"
          />

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrar por status"
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Todos os status</option>
            <option value="WAITING_ANALYSIS">Aguardando Análise (Enviadas)</option>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>

          {/* Integration Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filtrar por tipo de integração"
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Todos os tipos</option>
            <option value="INTEGRACAO_INICIAL">Integração Inicial</option>
            <option value="ATUALIZACAO_DOCUMENTAL">Atualização Documental</option>
          </select>

          {/* Critical Activity Filter */}
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            aria-label="Filtrar por atividade crítica"
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Todas as atividades críticas</option>
            {activityFilterOptions.map((act) => (
              <option key={act.id} value={act.id}>
                {act.nome}
              </option>
            ))}
          </select>

          {/* Date From */}
          <div className="relative">
            <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Data de envio — a partir de"
              aria-label="Data de envio a partir de"
              className="w-full pl-8 pr-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
            />
          </div>

          {/* Date To */}
          <div className="relative">
            <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Data de envio — até"
              aria-label="Data de envio até"
              className="w-full pl-8 pr-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Server Error Banner */}
      {listError && (
        <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 px-4 py-3 text-xs text-rose-200 flex items-center justify-between gap-3">
          <span>{listError}</span>
          <button
            type="button"
            onClick={fetchIntegrations}
            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer whitespace-nowrap"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Listing Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Protocolo / Empresa</th>
                <th className="py-3 px-3">CNPJ</th>
                <th className="py-3 px-3">Atividades Críticas</th>
                <th className="py-3 px-3">Solicitante</th>
                <th className="py-3 px-3 text-right">Colab.</th>
                <th className="py-3 px-3 text-right">Docs (Apr / Pend / Repr)</th>
                <th className="py-3 px-3">Data Envio</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loadingList ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td colSpan={9} className="py-3.5 px-4">
                      <div className="h-4 rounded bg-slate-800/80 w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-4 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-300">
                      {integrations.length === 0
                        ? 'Nenhuma solicitação de integração recebida até o momento.'
                        : 'Nenhuma integração encontrada com os filtros selecionados.'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {integrations.length === 0
                        ? 'As solicitações enviadas pelas empresas contratadas na Central de Integração aparecerão automaticamente nesta fila.'
                        : 'Ajuste os critérios de busca ou limpe os filtros para visualizar toda a fila.'}
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="mt-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-blue-300 cursor-pointer"
                      >
                        Limpar todos os filtros
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredList.map((integ: ContractorIntegration) => {
                  const pendentes =
                    (integ.resumoItens?.pendentesEnvio || 0) +
                    (integ.resumoItens?.enviados || 0) +
                    (integ.resumoItens?.emAnalise || 0);
                  return (
                    <tr key={integ.id} className="hover:bg-slate-800/35 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-400 tabular-nums">
                            {integ.codigoProtocolo}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            · {integ.tipo === 'ATUALIZACAO_DOCUMENTAL' ? 'Atualização' : 'Integração Inicial'}
                          </span>
                        </div>
                        <p className="font-semibold text-white mt-0.5">{integ.empresaNome}</p>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {integ.empresaCnpj}
                      </td>
                      <td className="py-3 px-3 text-slate-300 max-w-[200px]">
                        <span className="line-clamp-2">
                          {integ.atividadeNomes.length > 0
                            ? integ.atividadeNomes.join(' · ')
                            : 'Atualização documental'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">{integ.solicitadoPorNome}</td>
                      <td className="py-3 px-3 text-right font-semibold text-white tabular-nums">
                        {integ.colaboradoresCandidatos?.length || 0}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                        <span className="text-white font-semibold">{integ.resumoItens?.total || 0}</span>
                        <span className="text-slate-600 mx-1">·</span>
                        <span className="text-emerald-400 font-semibold">
                          {integ.resumoItens?.aprovados || 0}
                        </span>
                        <span className="text-slate-600 mx-1">/</span>
                        <span className="text-amber-400 font-semibold">{pendentes}</span>
                        <span className="text-slate-600 mx-1">/</span>
                        <span className="text-rose-400 font-semibold">
                          {integ.resumoItens?.reprovados || 0}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateTimePt(integ.dataEnvio || integ.dataCriacao)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${
                            STATUS_META[integ.status].badgeClass
                          }`}
                        >
                          {STATUS_META[integ.status].label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openDetailModal(integ.id)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer whitespace-nowrap"
                        >
                          {isAdmin ? 'Analisar' : 'Visualizar'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Analysis Modal (Sections 4, 5, 6) */}
      {(selectedDetail || loadingDetail) && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-6xl max-h-[94vh] rounded-2xl bg-slate-900 border border-slate-700 flex flex-col overflow-hidden">
            {loadingDetail || !selectedDetail ? (
              <div className="p-12 flex items-center justify-center gap-3 text-slate-300">
                <Loader2 className="animate-spin text-blue-500" size={22} />
                <span>Carregando dados da empresa, colaboradores, documentos e conformidade...</span>
              </div>
            ) : (
              <>
                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-blue-400 tabular-nums">
                        {selectedDetail.integration.codigoProtocolo}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-lg border ${
                          STATUS_META[selectedDetail.integration.status].badgeClass
                        }`}
                      >
                        {STATUS_META[selectedDetail.integration.status].label}
                      </span>
                      <span className="text-xs text-slate-400">
                        ·{' '}
                        {selectedDetail.integration.tipo === 'ATUALIZACAO_DOCUMENTAL'
                          ? 'Atualização Documental'
                          : 'Integração Inicial'}
                      </span>
                      {selectedDetail.integration.empresaPendenteCadastro && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Nova Empresa (aguardando oficialização)
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-white mt-1 truncate">
                      {selectedDetail.integration.empresaNome}
                    </h2>
                    <p className="text-xs text-slate-400">
                      CNPJ: <span className="font-mono text-slate-300">{selectedDetail.integration.empresaCnpj}</span>{' '}
                      · Solicitante: {selectedDetail.integration.solicitadoPorNome} · Atividades:{' '}
                      {selectedDetail.integration.atividadeNomes.join(', ') || 'Atualização Documental'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isAdmin &&
                      ['ENVIADA', 'AGUARDANDO_ANALISE', 'REENVIADA'].includes(
                        selectedDetail.integration.status
                      ) && (
                        <button
                          type="button"
                          disabled={busyAction === 'start'}
                          onClick={handleStartReview}
                          className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {busyAction === 'start' ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <PlayCircle size={15} />
                          )}
                          Iniciar Análise
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => setSelectedDetail(null)}
                      aria-label="Fechar modal"
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Modal Tabs */}
                <div className="px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setModalTab('documentos')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                        modalTab === 'documentos'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Análise Documental ({selectedDetail.items.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab('auditoria')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                        modalTab === 'auditoria'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <History size={13} /> Trilha de Auditoria (
                      {selectedDetail.integration.historicoWorkflow.length})
                    </button>
                  </div>

                  {selectedDetail.compliancePreview && (
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-lg border whitespace-nowrap ${
                        selectedDetail.compliancePreview.statusGeral === 'conforme'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : selectedDetail.compliancePreview.statusGeral === 'atencao'
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      }`}
                    >
                      Motor de Conformidade: {selectedDetail.compliancePreview.statusGeral.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                  {feedback && (
                    <div
                      className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
                        feedback.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                      }`}
                    >
                      <span>{feedback.text}</span>
                      <button
                        type="button"
                        onClick={() => setFeedback(null)}
                        className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                      >
                        Fechar
                      </button>
                    </div>
                  )}

                  {modalTab === 'documentos' ? (
                    <div className="space-y-6">
                      {/* Section 4.1: Complete Company Summary */}
                      {resolvedCompanyInfo && (
                        <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                              <Building2 size={16} className="text-blue-400" />
                              Dados da Empresa Contratada
                            </h3>
                            <span className="text-[11px] text-slate-400">
                              {resolvedCompanyInfo.isNewPending
                                ? 'Cadastro pendente de oficialização na aprovação final completa (aprovação parcial desabilitada)'
                                : resolvedCompanyInfo.situacao
                                ? `Situação cadastral: ${resolvedCompanyInfo.situacao.toUpperCase()}`
                                : 'Empresa vinculada na base SST'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                            <div>
                              <p className="text-[11px] text-slate-500">Razão Social</p>
                              <p className="font-semibold text-slate-100 mt-0.5">
                                {resolvedCompanyInfo.razaoSocial}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Nome Fantasia</p>
                              <p className="font-medium text-slate-200 mt-0.5">
                                {resolvedCompanyInfo.nomeFantasia}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">CNPJ</p>
                              <p className="font-mono text-slate-200 mt-0.5 tabular-nums">
                                {resolvedCompanyInfo.cnpj}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Vigência do Contrato</p>
                              <p className="text-slate-200 mt-0.5 tabular-nums">
                                {resolvedCompanyInfo.contratoIndeterminado
                                  ? 'Prazo indeterminado'
                                  : resolvedCompanyInfo.dataInicioContrato ||
                                    resolvedCompanyInfo.dataTerminoContrato
                                  ? `${formatDatePt(resolvedCompanyInfo.dataInicioContrato)} até ${formatDatePt(
                                      resolvedCompanyInfo.dataTerminoContrato
                                    )}`
                                  : 'Não informada'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Responsável Legal</p>
                              <p className="text-slate-200 mt-0.5 flex items-center gap-1.5">
                                <Briefcase size={12} className="text-slate-500 shrink-0" />
                                <span className="truncate">{resolvedCompanyInfo.responsavelLegal}</span>
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Responsável SST</p>
                              <p className="text-slate-200 mt-0.5 truncate">
                                {resolvedCompanyInfo.responsavelSST}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">E-mail de Contato</p>
                              <p className="text-slate-200 mt-0.5 flex items-center gap-1.5">
                                <Mail size={12} className="text-slate-500 shrink-0" />
                                <span className="truncate">{resolvedCompanyInfo.email}</span>
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Telefone</p>
                              <p className="text-slate-200 mt-0.5 flex items-center gap-1.5 tabular-nums">
                                <Phone size={12} className="text-slate-500 shrink-0" />
                                <span>{resolvedCompanyInfo.telefone}</span>
                              </p>
                            </div>
                          </div>

                          {selectedDetail.integration.observacoes && (
                            <p className="text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                              <span className="text-slate-500">Observações do solicitante: </span>
                              {selectedDetail.integration.observacoes}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Section 4.2: Company Documents */}
                      {groupedModalItems.empresa.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Building2 size={16} className="text-blue-400" />
                            Documentação da Empresa ({groupedModalItems.empresa.length})
                          </h3>
                          <div className="space-y-3">
                            {groupedModalItems.empresa.map(renderAdminItemReviewCard)}
                          </div>
                        </div>
                      )}

                      {/* Section 4.3: Employees + Full Profile Summary + Employee Documents */}
                      {groupedModalItems.colaboradores.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Users size={16} className="text-emerald-400" />
                            Colaboradores Terceirizados e Documentação ({groupedModalItems.colaboradores.length})
                          </h3>

                          {groupedModalItems.colaboradores.map((group) => {
                            const approvedCount = group.items.filter((i) => i.status === 'APROVADO').length;
                            return (
                              <div
                                key={group.key}
                                className="rounded-xl bg-slate-950/50 border border-slate-800 p-4 space-y-4"
                              >
                                {/* Employee Header + Structured Summary */}
                                <div className="space-y-3 pb-3 border-b border-slate-800">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-bold text-white">{group.nome}</p>
                                        <span className="text-[11px] text-slate-400">
                                          · {group.jaExistiaNaBase ? 'Base oficial' : 'Novo cadastro pendente'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                                        {group.cargo || 'Cargo não informado'}
                                        {group.setor ? ` · Setor: ${group.setor}` : ''}
                                        {group.cpf ? ` · CPF: ${group.cpf}` : ''}
                                      </p>
                                    </div>
                                    <span className="text-xs font-semibold text-slate-300 tabular-nums">
                                      {approvedCount}/{group.items.length} aprovado(s)
                                    </span>
                                  </div>

                                  {/* Authorized Activities + ASO Summary + Trainings Summary */}
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
                                    <div className="rounded-lg bg-slate-900/80 border border-slate-800/90 p-2.5">
                                      <p className="text-slate-400 font-semibold mb-1">
                                        Atividades Autorizadas / Solicitadas
                                      </p>
                                      <p className="text-slate-200">
                                        {group.atividadesNomes.length > 0
                                          ? group.atividadesNomes.join(' · ')
                                          : 'Atualização documental'}
                                      </p>
                                    </div>

                                    <div className="rounded-lg bg-slate-900/80 border border-slate-800/90 p-2.5">
                                      <p className="text-slate-400 font-semibold mb-1 flex items-center gap-1">
                                        <Stethoscope size={12} className="text-sky-400" />
                                        ASO e Aptidões Específicas
                                      </p>
                                      {group.asoItems.length === 0 ? (
                                        <p className="text-slate-500">Nenhum item de ASO vinculado.</p>
                                      ) : (
                                        <div className="space-y-1">
                                          {group.asoItems.map((aso) => {
                                            const apts = (
                                              aso.aptidoesEspecificas && aso.aptidoesEspecificas.length > 0
                                                ? aso.aptidoesEspecificas
                                                : aso.aptidaoEspecifica
                                                ? [aso.aptidaoEspecifica]
                                                : []
                                            ).map((k) => APTITUDE_LABEL_MAP[k] || k);
                                            return (
                                              <p key={aso.id} className="text-slate-200 tabular-nums">
                                                <strong>{ITEM_META[aso.status].label}</strong>
                                                {aso.conclusaoAso
                                                  ? ` (${aso.conclusaoAso.replace(/_/g, ' ').toUpperCase()})`
                                                  : ''}
                                                {aso.dataValidade
                                                  ? ` · Val.: ${formatDatePt(aso.dataValidade)}`
                                                  : ''}
                                                {apts.length > 0 ? ` · ${apts.join(', ')}` : ''}
                                              </p>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>

                                    <div className="rounded-lg bg-slate-900/80 border border-slate-800/90 p-2.5">
                                      <p className="text-slate-400 font-semibold mb-1 flex items-center gap-1">
                                        <GraduationCap size={12} className="text-emerald-400" />
                                        Treinamentos e Vencimentos
                                      </p>
                                      {group.trainingItems.length === 0 ? (
                                        <p className="text-slate-500">Nenhum treinamento vinculado.</p>
                                      ) : (
                                        <div className="space-y-1">
                                          {group.trainingItems.map((trn) => (
                                            <p key={trn.id} className="text-slate-200 tabular-nums">
                                              <span className="font-mono text-blue-300">
                                                {trn.documentoCodigoCanonico}
                                              </span>
                                              {` · ${ITEM_META[trn.status].label}`}
                                              {trn.dataValidade
                                                ? ` · Val.: ${formatDatePt(trn.dataValidade)}`
                                                : ''}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Employee Document Items Organized by the 4 Mandatory Categories */}
                                <div className="space-y-4">
                                  {group.items.length === 0 ? (
                                    <p className="text-xs text-slate-500 italic">
                                      Nenhum documento individual vinculado a este colaborador até o momento.
                                    </p>
                                  ) : (
                                    groupItemsByMandatoryCategories(group.items)
                                      .filter((section) => section.items.length > 0)
                                      .map((section) => (
                                        <div key={section.category.id} className="space-y-2.5">
                                          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                                            <div className="flex items-center gap-2">
                                              <span className="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                                                {section.category.codigoEtiqueta}
                                              </span>
                                              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-200">
                                                {section.category.titulo}
                                              </h4>
                                            </div>
                                            <span className="text-[11px] text-slate-400 tabular-nums">
                                              {section.items.length} documento(s)
                                            </span>
                                          </div>
                                          <div className="space-y-3">
                                            {section.items.map(renderAdminItemReviewCard)}
                                          </div>
                                        </div>
                                      ))
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Audit Trail Tab */
                    <div className="space-y-2.5">
                      {[...selectedDetail.integration.historicoWorkflow]
                        .reverse()
                        .map((ev, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 text-xs space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-white">{ev.acao}</span>
                              <span className="text-slate-400 tabular-nums">
                                {formatDateTimePt(ev.dataHora)}
                              </span>
                            </div>
                            <p className="text-slate-300">{ev.detalhes}</p>
                            <p className="text-[11px] text-slate-500">
                              Usuário: <span className="text-slate-300">{ev.usuarioNome}</span> ({ev.usuarioRole})
                              {ev.statusAnterior
                                ? ` · Transição: ${ev.statusAnterior} → ${ev.statusNovo}`
                                : ` · Status: ${ev.statusNovo}`}
                              {ev.justificativa ? ` · Justificativa: ${ev.justificativa}` : ''}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Admin Decision Footer (Section 6: Strict Final Approval Gate + Blocking List) */}
                {isAdmin && selectedDetail.integration.status !== 'ENCERRADA' && (
                  <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/85 space-y-3">
                    {blockingMandatoryItems.length > 0 ? (
                      <div className="rounded-lg bg-amber-950/25 border border-amber-500/30 p-3 space-y-1.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                            <AlertTriangle size={14} className="shrink-0" />
                            Aprovação final bloqueada —{' '}
                            <strong className="tabular-nums">{blockingMandatoryItems.length}</strong>{' '}
                            pendência(s) obrigatória(s) para regularizar:
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {selectedDetail.integration.tipo === 'INTEGRACAO_INICIAL'
                              ? 'Aprovação parcial desabilitada para cadastro inicial · PTs continuam exigindo liberação separada.'
                              : 'Aprovar integração não libera PTs de atividades críticas automaticamente.'}
                          </span>
                        </div>
                        <ul className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar pr-1 text-[11px]">
                          {blockingMandatoryItems.map((b) => (
                            <li
                              key={b.itemId}
                              className="flex flex-wrap items-center gap-x-2 text-slate-300"
                            >
                              <span
                                className={
                                  b.severity === 'rejected' || b.severity === 'expired'
                                    ? 'text-rose-400 font-semibold'
                                    : 'text-amber-300 font-semibold'
                                }
                              >
                                • {b.nomeExibicao}
                              </span>
                              <span className="text-slate-500">({b.ownerLabel})</span>
                              <span className="text-slate-400">— {b.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-emerald-300 flex items-center gap-1.5 font-medium">
                          <CheckCircle2 size={14} />
                          Todos os documentos obrigatórios estão aprovados e dentro da validade. Pronto para concluir a integração.
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Aprovar a integração não libera automaticamente PTs de atividades críticas.
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col md:flex-row gap-2.5">
                      <input
                        type="text"
                        placeholder="Justificativa / orientação para devolução parcial, reprovação ou aprovação final..."
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white"
                      />
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={handleReturnForCorrection}
                          className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <RotateCcw size={14} /> Devolver Somente Pendências
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={handleRejectIntegration}
                          className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <XCircle size={14} /> Reprovar Integração
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null || !canFinalizeApproval}
                          onClick={handleApproveIntegration}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          {busyAction === 'approve' ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <FileCheck2 size={14} />
                          )}
                          Aprovar Integração
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={handleCloseIntegration}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <Archive size={14} /> Encerrar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Embedded Document Preview Modal (Authenticated Blob Stream — PDF / JPEG / PNG) */}
      {previewDoc && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[88vh] rounded-2xl bg-slate-900 border border-slate-700 flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400 truncate">{previewDoc.itemLabel}</p>
                <h3 className="text-sm font-bold text-white truncate">{previewDoc.fileName}</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewDoc.objectUrl}
                  download={previewDoc.fileName}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download size={13} /> Baixar Arquivo
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  aria-label="Fechar pré-visualização"
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-950 flex items-center justify-center overflow-auto p-3">
              {previewDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewDoc.objectUrl}
                  title={previewDoc.fileName}
                  className="w-full h-full rounded-lg border border-slate-800 bg-white"
                />
              ) : (
                <img
                  src={previewDoc.objectUrl}
                  alt={previewDoc.fileName}
                  className="max-w-full max-h-full object-contain rounded-lg border border-slate-800"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
