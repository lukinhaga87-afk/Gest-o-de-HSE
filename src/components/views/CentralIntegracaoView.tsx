import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Users,
  Upload,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Plus,
  Trash2,
  Send,
  Sparkles,
  History,
  FileText,
  ShieldAlert,
  Search,
  Eye,
  Lock,
  Layers,
  Loader2,
  ChevronDown,
  ChevronUp,
  Info,
  FolderPlus,
  RotateCcw,
  Download,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  IntegrationBatchFilePayload,
  IntegrationDuplicateCheckResult,
  IntegrationServerDetailResult,
  useSST,
} from '../../context/SSTContext';
import type {
  ConclusaoAptidao,
  ContractorIntegration,
  ContractorIntegrationItem,
  IntegrationDocumentGroupId,
  IntegrationItemCategory,
  IntegrationItemStatus,
  IntegrationOfficialCollection,
  IntegrationPendingDocumentInfo,
  IntegrationSubmissionReadiness,
  IntegrationType,
  IntegrationWorkflowStatus,
} from '../../types/sst';
import {
  CATEGORY_BY_ID,
  EMPLOYEE_DOCUMENT_CATALOG,
  MANDATORY_DOCUMENT_CATEGORIES,
  classifyIntegrationDocumentGroup,
  groupItemsByMandatoryCategories,
  suggestDocumentCatalogForFilename,
} from '../../utils/integrationDocumentCatalog';

interface CentralIntegracaoViewProps {
  initialSection?: 'nova' | 'acompanhamento';
}

type QueueItemUploadStatus = 'queued' | 'uploading' | 'success' | 'failed';

interface QueuedUploadFile {
  localId: string;
  file: File;
  arquivoNome: string;
  extension: string;
  sizeBytes: number;
  targetOwnerKey: string; // 'empresa' or collaborator key
  targetOwnerName: string;
  categoria: IntegrationItemCategory;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  /** Either `item:<existingItemId>` or `catalog:<codigoCanonico>` */
  targetSelection: string;
  itemId?: string;
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  documentoCodigoCanonico: string;
  nomeExibicao: string;
  origemColecao: IntegrationOfficialCollection;
  dataEmissao: string;
  dataValidade: string;
  semValidade: boolean;
  conclusaoAso: ConclusaoAptidao;
  observacoes: string;
  uploadStatus: QueueItemUploadStatus;
  progress: number;
  errorMessage?: string;
  uploadedItemId?: string;
  uploadedVersion?: number;
}

interface BatchRunSummary {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  finishedAt: string;
}

interface SolicitantePreviewState {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  objectUrl: string;
  itemLabel: string;
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const UPLOAD_CONCURRENCY = 2;

interface NewEmployeeDraft {
  localId: string;
  nomeCompleto: string;
  cpf: string;
  cargo: string;
  setor: string;
  telefone: string;
  email: string;
}

const INTEGRATION_STATUS_META: Record<
  IntegrationWorkflowStatus,
  { label: string; badgeClass: string }
> = {
  RASCUNHO: {
    label: 'Rascunho',
    badgeClass: 'bg-slate-700/60 text-slate-200 border-slate-600',
  },
  PENDENTE_DOCUMENTACAO: {
    label: 'Pendente de Documentação',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  EM_ENVIO: {
    label: 'Em Envio',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  ENVIADA: {
    label: 'Enviada',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  AGUARDANDO_ANALISE: {
    label: 'Aguardando Análise',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  EM_ANALISE: {
    label: 'Em Análise EHS',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  PENDENTE_CORRECAO: {
    label: 'Pendente de Correção',
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

const ITEM_STATUS_META: Record<IntegrationItemStatus, { label: string; badgeClass: string }> = {
  PENDENTE_ENVIO: {
    label: 'Pendente de Envio',
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600',
  },
  ENVIADO: {
    label: 'Enviado',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  EM_ANALISE: {
    label: 'Em Análise',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  APROVADO: {
    label: 'Aprovado',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  REPROVADO: {
    label: 'Reprovado',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  SUBSTITUIDO: {
    label: 'Substituído',
    badgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
  },
};

const QUICK_RENEWAL_DOCS: Array<{
  code: string;
  label: string;
  categoria: 'empresa' | 'colaborador';
  origem: IntegrationOfficialCollection;
}> = [
  { code: 'ASO', label: 'ASO — Atestado de Saúde Ocupacional', categoria: 'colaborador', origem: 'exams' },
  { code: 'NR-35', label: 'Certificado NR-35 — Trabalho em Altura', categoria: 'colaborador', origem: 'trainings' },
  { code: 'NR-33', label: 'Certificado NR-33 — Espaço Confinado', categoria: 'colaborador', origem: 'trainings' },
  { code: 'NR-10', label: 'Certificado NR-10 — Instalações Elétricas', categoria: 'colaborador', origem: 'trainings' },
  { code: 'NR-18', label: 'Certificado NR-18 — Escavação / Obra', categoria: 'colaborador', origem: 'trainings' },
  { code: 'PGR', label: 'PGR — Programa de Gerenciamento de Riscos', categoria: 'empresa', origem: 'documents' },
  { code: 'PCMSO', label: 'PCMSO — Programa de Controle Médico', categoria: 'empresa', origem: 'documents' },
  { code: 'FICHA_EPI', label: 'Ficha de Entrega de EPI Assinada', categoria: 'colaborador', origem: 'epiDeliveries' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Falha ao ler arquivo ${file.name}`));
    reader.readAsDataURL(file);
  });
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

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function digitsOnly(value?: string): string {
  return String(value || '').replace(/\D+/g, '');
}

const ACTIVE_INTEGRATION_STORAGE_KEY = 'ehs_more_active_integration_id';

function readSavedIntegrationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('integracao')?.trim();
    if (fromUrl) return fromUrl;
    const fromStorage = window.sessionStorage.getItem(ACTIVE_INTEGRATION_STORAGE_KEY)?.trim();
    return fromStorage || null;
  } catch {
    return null;
  }
}

function persistActiveIntegrationId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      window.sessionStorage.setItem(ACTIVE_INTEGRATION_STORAGE_KEY, id);
    } else {
      window.sessionStorage.removeItem(ACTIVE_INTEGRATION_STORAGE_KEY);
    }
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('integracao', id);
    } else {
      url.searchParams.delete('integracao');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // Ignore restricted history/storage environments
  }
}

export const CentralIntegracaoView: React.FC<CentralIntegracaoViewProps> = ({
  initialSection = 'nova',
}) => {
  const { activeEmpresaId, isSolicitante, isAuditor } = useAuth();
  const {
    companies,
    employees,
    activityProfiles,
    activityDocumentRequirements,
    contractorIntegrations,
    activityMatrixFirestoreError,
    integrationFirestoreError,
    getIntegrationDetailOnServer,
    checkIntegrationDuplicatesOnServer,
    createIntegrationOnServer,
    uploadIntegrationDocumentOnServer,
    fetchIntegrationItemFileBlobOnServer,
    renewIntegrationItemOnServer,
    submitIntegrationOnServer,
  } = useSST();

  const savedInitialId = useMemo(() => readSavedIntegrationId(), []);

  const [section, setSection] = useState<'nova' | 'acompanhamento'>(
    isAuditor || savedInitialId ? 'acompanhamento' : initialSection
  );

  useEffect(() => {
    if (isAuditor) {
      setSection('acompanhamento');
      return;
    }
    if (initialSection === 'acompanhamento') {
      setSection('acompanhamento');
    } else if (!readSavedIntegrationId()) {
      setSection(initialSection);
    }
  }, [initialSection, isAuditor]);

  // Feedback banner & inline creation error
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Active selected integration detail
  const [activeDetail, setActiveDetail] = useState<IntegrationServerDetailResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedHistoryItemId, setExpandedHistoryItemId] = useState<string | null>(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  // DOM refs for smooth scroll & reliable native file selector buttons
  const docsSectionRef = useRef<HTMLDivElement | null>(null);
  const createErrorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const openFilePicker = (pickerKey: string) => {
    const input = fileInputRefs.current[pickerKey];
    if (input) {
      input.value = '';
      input.click();
    }
  };

  // List filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Creation wizard state
  const [integrationType, setIntegrationType] = useState<IntegrationType>('INTEGRACAO_INICIAL');
  const [companyMode, setCompanyMode] = useState<'existing' | 'new'>('existing');
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>(() => activeEmpresaId || '');
  const [newCompanyForm, setNewCompanyForm] = useState({
    razaoSocial: '',
    nomeFantasia: '',
    cnpj: '',
    responsavelLegal: '',
    responsavelSST: '',
    telefone: '',
    email: '',
    endereco: '',
    unidadeAtendimento: '',
    atividadeContratada: '',
    dataInicioContrato: new Date().toISOString().slice(0, 10),
    dataTerminoContrato: '',
    contrato_indeterminado: true,
  });
  const [cnpjCheck, setCnpjCheck] = useState<IntegrationDuplicateCheckResult | null>(null);

  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [newEmployees, setNewEmployees] = useState<NewEmployeeDraft[]>([]);
  const [empDraft, setEmpDraft] = useState({
    nomeCompleto: '',
    cpf: '',
    cargo: '',
    setor: 'Operacional Terceirizado',
    telefone: '',
    email: '',
  });
  const [cpfCheck, setCpfCheck] = useState<IntegrationDuplicateCheckResult | null>(null);
  const [selectedRenewalCodes, setSelectedRenewalCodes] = useState<string[]>(['ASO']);
  const [observacoes, setObservacoes] = useState('');

  // Queued batch upload engine for active integration (1 file per HTTP request, concurrency controlled)
  const [uploadQueue, setUploadQueue] = useState<QueuedUploadFile[]>([]);
  const [isUploadingQueue, setIsUploadingQueue] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchRunSummary | null>(null);
  const [dragOverTargetKey, setDragOverTargetKey] = useState<string | null>(null);
  const [useSmartDocsAi, setUseSmartDocsAi] = useState(false);
  const uploadQueueRef = useRef<QueuedUploadFile[]>([]);
  uploadQueueRef.current = uploadQueue;

  // Protected file preview/download state
  const [previewDoc, setPreviewDoc] = useState<SolicitantePreviewState | null>(null);
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);

  const [renewingItem, setRenewingItem] = useState<ContractorIntegrationItem | null>(null);
  const [renewFileData, setRenewFileData] = useState<{
    arquivoNome: string;
    arquivoBase64: string;
    sizeBytes: number;
    dataEmissao: string;
    dataValidade: string;
    semValidade: boolean;
    conclusaoAso: ConclusaoAptidao;
    observacoes: string;
  } | null>(null);

  useEffect(() => {
    const currentUrl = previewDoc?.objectUrl;
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [previewDoc]);

  // Sync company default when activeEmpresaId loads
  useEffect(() => {
    if (isSolicitante && activeEmpresaId) {
      setSelectedEmpresaId(activeEmpresaId);
      setCompanyMode('existing');
    }
  }, [isSolicitante, activeEmpresaId]);

  const activeActivities = useMemo(
    () => activityProfiles.filter((a) => a.ativo),
    [activityProfiles]
  );

  const visibleCompanies = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return companies.filter((c) => c.id === activeEmpresaId);
    }
    return companies;
  }, [companies, isSolicitante, activeEmpresaId]);

  const companyEmployees = useMemo(() => {
    if (!selectedEmpresaId) return [];
    return employees.filter((e) => e.empresaId === selectedEmpresaId);
  }, [employees, selectedEmpresaId]);

  const visibleIntegrations = useMemo(() => {
    let list = contractorIntegrations;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((i) => i.empresaId === activeEmpresaId || !i.empresaId);
    }
    if (statusFilter !== 'ALL') {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.codigoProtocolo.toLowerCase().includes(q) ||
          i.empresaNome.toLowerCase().includes(q) ||
          i.empresaCnpj.toLowerCase().includes(q)
      );
    }
    return list;
  }, [contractorIntegrations, isSolicitante, activeEmpresaId, statusFilter, searchQuery]);

  // Preview count of Matrix requirements for selected activities
  const previewMatrixRequirementsCount = useMemo(() => {
    if (selectedActivityIds.length === 0) return 0;
    return activityDocumentRequirements.filter(
      (r) =>
        r.ativo &&
        selectedActivityIds.includes(r.activityId) &&
        r.origemColecao !== 'safetyPermits'
    ).length;
  }, [activityDocumentRequirements, selectedActivityIds]);

  const openIntegrationDetail = async (id: string, opts?: { scrollToDocs?: boolean }) => {
    setLoadingDetail(true);
    setFeedback(null);
    setBatchSummary(null);
    try {
      const detail = await getIntegrationDetailOnServer(id);
      if (!detail?.integration?.id) {
        throw new Error('O servidor não retornou um identificador válido para este protocolo.');
      }
      persistActiveIntegrationId(detail.integration.id);
      setActiveDetail(detail);
      setSection('acompanhamento');
      setUploadQueue([]);
      setRenewingItem(null);
      setRenewFileData(null);
      if (opts?.scrollToDocs) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            docsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 80);
        });
      }
    } catch (err: any) {
      if (err?.status === 404 || err?.status === 403) {
        persistActiveIntegrationId(null);
      }
      setFeedback({ type: 'error', text: err?.message || 'Erro ao carregar detalhes da integração.' });
    } finally {
      setLoadingDetail(false);
    }
  };

  // Restore active protocol automatically on page refresh (F5)
  const restoredOnMountRef = useRef(false);
  useEffect(() => {
    if (restoredOnMountRef.current || activeDetail) return;
    const savedId = readSavedIntegrationId();
    if (!savedId) return;
    restoredOnMountRef.current = true;
    openIntegrationDetail(savedId);
  }, []);

  const handleCheckCnpj = async () => {
    if (!newCompanyForm.cnpj.trim()) return;
    try {
      const res = await checkIntegrationDuplicatesOnServer({ cnpj: newCompanyForm.cnpj });
      setCnpjCheck(res);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao verificar CNPJ.' });
    }
  };

  const handleCheckCpf = async () => {
    if (!empDraft.cpf.trim()) return;
    try {
      const res = await checkIntegrationDuplicatesOnServer({ cpf: empDraft.cpf });
      setCpfCheck(res);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao verificar CPF.' });
    }
  };

  const handleAddNewEmployeeDraft = async () => {
    if (!empDraft.nomeCompleto.trim() || !empDraft.cpf.trim() || !empDraft.cargo.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe Nome Completo, CPF e Cargo/Função do colaborador terceirizado.',
      });
      return;
    }

    try {
      const dup = await checkIntegrationDuplicatesOnServer({ cpf: empDraft.cpf });
      setCpfCheck(dup);
      if (dup.cpfDuplicado) {
        if (dup.colaboradorExistente?.mesmaEmpresa && dup.colaboradorExistente.id) {
          if (!selectedEmployeeIds.includes(dup.colaboradorExistente.id)) {
            setSelectedEmployeeIds((prev) => [...prev, dup.colaboradorExistente!.id]);
          }
          setFeedback({
            type: 'info',
            text: `CPF já cadastrado na base oficial (${dup.colaboradorExistente.nomeCompleto}). O colaborador existente foi selecionado automaticamente sem duplicar cadastro.`,
          });
          setEmpDraft({
            nomeCompleto: '',
            cpf: '',
            cargo: '',
            setor: 'Operacional Terceirizado',
            telefone: '',
            email: '',
          });
          return;
        }
        setFeedback({
          type: 'error',
          text: 'Este CPF já pertence a outra empresa contratada na base oficial. Não é permitido duplicar cadastro.',
        });
        return;
      }

      setNewEmployees((prev) => [
        ...prev,
        {
          localId: `draft-emp-${Date.now()}-${prev.length}`,
          ...empDraft,
        },
      ]);
      setEmpDraft({
        nomeCompleto: '',
        cpf: '',
        cargo: '',
        setor: 'Operacional Terceirizado',
        telefone: '',
        email: '',
      });
      setCpfCheck(null);
      setFeedback(null);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao validar CPF do colaborador.' });
    }
  };

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuditor || busy) return;
    setFeedback(null);
    setCreateError(null);
    setBusy(true);

    const failCreation = (msg: string) => {
      setCreateError(msg);
      setFeedback({ type: 'error', text: msg });
      requestAnimationFrame(() => {
        createErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };

    try {
      // 1. Validate Company selection / registration data
      const effectiveEmpresaId =
        companyMode === 'existing' ? selectedEmpresaId || (isSolicitante ? activeEmpresaId || '' : '') : '';

      if (companyMode === 'existing') {
        if (!effectiveEmpresaId) {
          failCreation('Selecione uma empresa contratada antes de gerar o checklist.');
          return;
        }
      } else {
        if (!newCompanyForm.razaoSocial.trim() || digitsOnly(newCompanyForm.cnpj).length < 14) {
          failCreation(
            'Informe a Razão Social e um CNPJ válido (14 dígitos) para solicitar o cadastro de nova empresa contratada.'
          );
          return;
        }
      }

      // 2. Auto-include typed collaborator draft (empDraft) so data typed without clicking "+ Adicionar Terceirizado" is never discarded
      const finalEmployeeIds = [...selectedEmployeeIds];
      const finalNewEmployees = [...newEmployees];
      let draftWasIncluded = false;

      const hasAnyDraftField = Boolean(
        empDraft.nomeCompleto.trim() || empDraft.cpf.trim() || empDraft.cargo.trim()
      );
      if (integrationType === 'INTEGRACAO_INICIAL' && hasAnyDraftField) {
        const draftCpfDigits = digitsOnly(empDraft.cpf);
        if (!empDraft.nomeCompleto.trim() || draftCpfDigits.length !== 11 || !empDraft.cargo.trim()) {
          failCreation(
            'Você preencheu parcialmente um novo colaborador. Informe Nome Completo, CPF válido (11 dígitos) e Cargo/Função, ou limpe esses campos antes de continuar.'
          );
          return;
        }

        const alreadyInNew = finalNewEmployees.some(
          (emp) => digitsOnly(emp.cpf) === draftCpfDigits
        );
        if (!alreadyInNew) {
          const dup = await checkIntegrationDuplicatesOnServer({ cpf: empDraft.cpf });
          if (dup.cpfDuplicado) {
            if (dup.colaboradorExistente?.mesmaEmpresa && dup.colaboradorExistente.id) {
              if (!finalEmployeeIds.includes(dup.colaboradorExistente.id)) {
                finalEmployeeIds.push(dup.colaboradorExistente.id);
              }
              draftWasIncluded = true;
            } else {
              failCreation(
                'O CPF digitado no campo de novo colaborador já pertence a outra empresa contratada na base oficial. Não é permitido duplicar cadastro.'
              );
              return;
            }
          } else {
            finalNewEmployees.push({
              localId: `draft-auto-${Date.now()}`,
              ...empDraft,
            });
            draftWasIncluded = true;
          }
        }
      }

      // 3. Validate activities / renewal docs & collaborator selection
      const customItems: Array<{
        categoria: 'empresa' | 'colaborador';
        colaboradorId?: string;
        documentoCodigoCanonico: string;
        nomeExibicao: string;
        origemColecao: IntegrationOfficialCollection;
        obrigatorio: boolean;
      }> = [];

      if (integrationType === 'INTEGRACAO_INICIAL') {
        if (activeActivities.length === 0) {
          failCreation(
            activityMatrixFirestoreError
              ? `Não foi possível carregar a Matriz de Atividades: ${activityMatrixFirestoreError}`
              : 'Nenhuma atividade ativa disponível na Matriz de Atividades. Solicite ao Admin EHS a configuração das atividades.'
          );
          return;
        }
        if (selectedActivityIds.length === 0) {
          failCreation(
            'Selecione ao menos uma atividade na etapa "2. Atividades a Executar" para gerar o checklist obrigatório.'
          );
          return;
        }
        if (finalEmployeeIds.length === 0 && finalNewEmployees.length === 0) {
          failCreation(
            'Selecione ao menos um colaborador já cadastrado ou informe os dados de um novo colaborador terceirizado na etapa "3. Colaboradores Terceirizados Vinculados".'
          );
          return;
        }
      } else {
        if (selectedRenewalCodes.length === 0) {
          failCreation('Selecione ao menos um documento para renovação / atualização documental.');
          return;
        }
        for (const code of selectedRenewalCodes) {
          const def = QUICK_RENEWAL_DOCS.find((d) => d.code === code);
          if (!def) continue;
          if (def.categoria === 'empresa') {
            customItems.push({
              categoria: 'empresa',
              documentoCodigoCanonico: def.code,
              nomeExibicao: def.label,
              origemColecao: def.origem,
              obrigatorio: true,
            });
          } else {
            if (finalEmployeeIds.length === 0 && finalNewEmployees.length === 0) {
              failCreation(
                `Selecione ao menos um colaborador para atualizar o documento "${def.label}".`
              );
              return;
            }
            for (const empId of finalEmployeeIds) {
              customItems.push({
                categoria: 'colaborador',
                colaboradorId: empId,
                documentoCodigoCanonico: def.code,
                nomeExibicao: def.label,
                origemColecao: def.origem,
                obrigatorio: true,
              });
            }
          }
        }
      }

      // 4. Create protocol & persist dynamic checklist on server
      const detail = await createIntegrationOnServer({
        tipo: integrationType,
        empresaId: companyMode === 'existing' ? effectiveEmpresaId || undefined : undefined,
        solicitacaoNovaEmpresa: companyMode === 'new' ? newCompanyForm : undefined,
        atividadeIds: selectedActivityIds,
        colaboradorIds: finalEmployeeIds,
        novosColaboradores: finalNewEmployees.map((emp) => ({
          nomeCompleto: emp.nomeCompleto,
          cpf: emp.cpf,
          cargo: emp.cargo,
          setor: emp.setor,
          telefone: emp.telefone,
          email: emp.email,
          atividadesHabilitadasIds: selectedActivityIds,
        })),
        customItems: customItems.length > 0 ? customItems : undefined,
        observacoes,
      });

      // 5. Never show false success without a real persisted integration ID
      if (!detail?.integration?.id || !detail?.integration?.codigoProtocolo) {
        throw new Error(
          'A criação do protocolo não retornou um identificador persistido válido. Tente novamente.'
        );
      }

      // 6. Persist active protocol ID (survives page refresh), update state & navigate to DOCUMENTAÇÃO DOS COLABORADORES
      persistActiveIntegrationId(detail.integration.id);
      setActiveDetail(detail);
      setUploadQueue([]);
      setBatchSummary(null);
      setSection('acompanhamento');
      setNewEmployees([]);
      if (draftWasIncluded) {
        setEmpDraft({
          nomeCompleto: '',
          cpf: '',
          cargo: '',
          setor: 'Operacional Terceirizado',
          telefone: '',
          email: '',
        });
        setCpfCheck(null);
      }
      setObservacoes('');
      setCreateError(null);
      setFeedback({
        type: 'success',
        text: `Protocolo ${detail.integration.codigoProtocolo} gerado e salvo com ${detail.items.length} item(ns) no checklist dinâmico e ${detail.integration.colaboradoresCandidatos?.length || 0} colaborador(es). Anexe agora os documentos abaixo na seção DOCUMENTAÇÃO DOS COLABORADORES.`,
      });

      requestAnimationFrame(() => {
        setTimeout(() => {
          docsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      });
    } catch (err: any) {
      failCreation(
        err?.message || 'Não foi possível criar o processo de integração. Verifique os dados e tente novamente.'
      );
    } finally {
      setBusy(false);
    }
  };

  const groupedItems = useMemo(() => {
    if (!activeDetail) {
      return {
        empresa: [] as ContractorIntegrationItem[],
        colaboradores: [] as Array<{
          key: string;
          colaboradorId?: string;
          colaboradorCandidateId?: string;
          nome: string;
          cargo?: string;
          cpf?: string;
          items: ContractorIntegrationItem[];
        }>,
      };
    }

    const empresa = activeDetail.items.filter((i) => i.categoria !== 'colaborador');
    const colabMap = new Map<
      string,
      {
        key: string;
        colaboradorId?: string;
        colaboradorCandidateId?: string;
        nome: string;
        cargo?: string;
        cpf?: string;
        items: ContractorIntegrationItem[];
      }
    >();

    // Seed from integration.colaboradoresCandidatos so EVERY registered collaborator ALWAYS has a document area
    for (const cand of activeDetail.integration.colaboradoresCandidatos || []) {
      const key = cand.aprovadoEmployeeId || cand.colaboradorId || cand.candidateId;
      colabMap.set(key, {
        key,
        colaboradorId: cand.aprovadoEmployeeId || cand.colaboradorId,
        colaboradorCandidateId: cand.candidateId,
        nome: cand.nomeCompleto,
        cargo: cand.cargo,
        cpf: cand.cpf,
        items: [],
      });
    }

    for (const item of activeDetail.items.filter((i) => i.categoria === 'colaborador')) {
      let key =
        (item.colaboradorId && colabMap.has(item.colaboradorId) && item.colaboradorId) ||
        (item.colaboradorCandidateId &&
          colabMap.has(item.colaboradorCandidateId) &&
          item.colaboradorCandidateId) ||
        '';

      if (!key) {
        for (const [existingKey, existingGroup] of colabMap.entries()) {
          if (
            (item.colaboradorCpf &&
              existingGroup.cpf &&
              digitsOnly(item.colaboradorCpf) === digitsOnly(existingGroup.cpf)) ||
            (item.colaboradorNome &&
              existingGroup.nome.toLowerCase() === item.colaboradorNome.toLowerCase())
          ) {
            key = existingKey;
            break;
          }
        }
      }

      if (!key) {
        key = item.colaboradorId || item.colaboradorCandidateId || item.colaboradorNome || `col-${item.id}`;
        colabMap.set(key, {
          key,
          colaboradorId: item.colaboradorId,
          colaboradorCandidateId: item.colaboradorCandidateId,
          nome: item.colaboradorNome || 'Colaborador Terceirizado',
          cargo: item.colaboradorCargo,
          cpf: item.colaboradorCpf,
          items: [],
        });
      }
      colabMap.get(key)!.items.push(item);
    }

    return { empresa, colaboradores: Array.from(colabMap.values()) };
  }, [activeDetail]);

  const enqueueFilesForTarget = (
    rawFiles: File[] | FileList | null,
    opts: {
      ownerKey: string;
      ownerName: string;
      categoria: IntegrationItemCategory;
      colaboradorId?: string;
      colaboradorCandidateId?: string;
      forcedItemId?: string;
      forcedCatalogCode?: string;
      forcedCategoryGroup?: IntegrationDocumentGroupId;
    }
  ) => {
    if (!rawFiles || rawFiles.length === 0 || !activeDetail) return;

    const filesArray = Array.from(rawFiles);
    const ownerEditableItems = activeDetail.items.filter((it) => {
      if (it.status === 'APROVADO') return false;
      if (opts.categoria === 'empresa') return it.categoria !== 'colaborador';
      return (
        it.categoria === 'colaborador' &&
        ((opts.colaboradorId && it.colaboradorId === opts.colaboradorId) ||
          (opts.colaboradorCandidateId && it.colaboradorCandidateId === opts.colaboradorCandidateId) ||
          it.colaboradorNome?.toLowerCase() === opts.ownerName.toLowerCase())
      );
    });

    const forcedCatalogEntry = opts.forcedCatalogCode
      ? EMPLOYEE_DOCUMENT_CATALOG.find((c) => c.codigoCanonico === opts.forcedCatalogCode)
      : undefined;

    const staged: QueuedUploadFile[] = filesArray.map((file, idx) => {
      const ext = getFileExtension(file.name);
      const isValidExt = ALLOWED_EXTENSIONS.has(ext);
      const isTooLarge = file.size > MAX_UPLOAD_BYTES;
      const isEmpty = file.size <= 0;

      let validationError: string | undefined;
      if (!isValidExt) {
        validationError = `Formato ".${ext || 'desconhecido'}" não suportado. Use PDF, JPG ou PNG.`;
      } else if (isEmpty) {
        validationError = 'Arquivo vazio (0 bytes).';
      } else if (isTooLarge) {
        validationError = `Arquivo (${formatFileSize(file.size)}) excede o limite de 4 MB por arquivo.`;
      }

      let targetSelection = '';
      let itemId: string | undefined;
      let categoriaOrganizacional: IntegrationDocumentGroupId | undefined = opts.forcedCategoryGroup;
      let documentoCodigoCanonico = 'OUTROS_DOC_LEGAIS';
      let nomeExibicao = file.name;
      let origemColecao: IntegrationOfficialCollection = 'documents';
      let semValidade = false;

      if (opts.forcedItemId) {
        const matched = ownerEditableItems.find((i) => i.id === opts.forcedItemId);
        if (matched) {
          targetSelection = `item:${matched.id}`;
          itemId = matched.id;
          categoriaOrganizacional =
            matched.categoria === 'colaborador' ? classifyIntegrationDocumentGroup(matched) : undefined;
          documentoCodigoCanonico = matched.documentoCodigoCanonico;
          nomeExibicao = matched.nomeExibicao;
          origemColecao = matched.origemColecao;
          semValidade = Boolean(matched.semValidade);
        }
      } else if (forcedCatalogEntry) {
        // Check if this catalog entry already exists as an editable item for this employee
        const existingMatched = ownerEditableItems.find(
          (i) =>
            i.documentoCodigoCanonico.toUpperCase() === forcedCatalogEntry.codigoCanonico.toUpperCase() ||
            (forcedCatalogEntry.codigoCanonico === 'ASO' && i.origemColecao === 'exams') ||
            (forcedCatalogEntry.codigoCanonico === 'FICHA_EPI' && i.origemColecao === 'epiDeliveries')
        );
        if (existingMatched) {
          targetSelection = `item:${existingMatched.id}`;
          itemId = existingMatched.id;
          categoriaOrganizacional = classifyIntegrationDocumentGroup(existingMatched);
          documentoCodigoCanonico = existingMatched.documentoCodigoCanonico;
          nomeExibicao = existingMatched.nomeExibicao;
          origemColecao = existingMatched.origemColecao;
          semValidade = Boolean(existingMatched.semValidade ?? forcedCatalogEntry.semValidadePadrao);
        } else {
          targetSelection = `catalog:${forcedCatalogEntry.codigoCanonico}`;
          categoriaOrganizacional = forcedCatalogEntry.categoriaId;
          documentoCodigoCanonico = forcedCatalogEntry.codigoCanonico;
          nomeExibicao = forcedCatalogEntry.nomeExibicao;
          origemColecao = forcedCatalogEntry.origemColecao;
          semValidade = Boolean(forcedCatalogEntry.semValidadePadrao);
        }
      } else if (opts.categoria === 'colaborador') {
        const suggestion = suggestDocumentCatalogForFilename(file.name, ownerEditableItems);
        if (suggestion.matchedItemId) {
          targetSelection = `item:${suggestion.matchedItemId}`;
          itemId = suggestion.matchedItemId;
        } else {
          targetSelection = `catalog:${suggestion.codigoCanonico}`;
        }
        categoriaOrganizacional = opts.forcedCategoryGroup || suggestion.categoriaId;
        documentoCodigoCanonico = suggestion.codigoCanonico;
        nomeExibicao = suggestion.nomeExibicao;
        origemColecao = suggestion.origemColecao;
        semValidade = suggestion.semValidade;
      } else {
        // Company document auto-match
        const lower = file.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matched = ownerEditableItems.find((it) => {
          const code = it.documentoCodigoCanonico.toLowerCase().replace(/[^a-z0-9]/g, '');
          return Boolean(code) && lower.includes(code);
        });
        if (matched) {
          targetSelection = `item:${matched.id}`;
          itemId = matched.id;
          documentoCodigoCanonico = matched.documentoCodigoCanonico;
          nomeExibicao = matched.nomeExibicao;
          origemColecao = matched.origemColecao;
          semValidade = Boolean(matched.semValidade);
        } else {
          targetSelection = 'catalog:DOC_EMPRESA_ADICIONAL';
          documentoCodigoCanonico = 'DOC_EMPRESA_ADICIONAL';
          nomeExibicao = file.name.replace(/\.[^/.]+$/, '');
          origemColecao = 'documents';
        }
      }

      return {
        localId: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        arquivoNome: file.name,
        extension: ext.toUpperCase() || 'ARQ',
        sizeBytes: file.size,
        targetOwnerKey: opts.ownerKey,
        targetOwnerName: opts.ownerName,
        categoria: opts.categoria,
        colaboradorId: opts.colaboradorId,
        colaboradorCandidateId: opts.colaboradorCandidateId,
        targetSelection,
        itemId,
        categoriaOrganizacional,
        documentoCodigoCanonico,
        nomeExibicao,
        origemColecao,
        dataEmissao: '',
        dataValidade: '',
        semValidade,
        conclusaoAso: 'apto',
        observacoes: '',
        uploadStatus: validationError ? 'failed' : 'queued',
        progress: 0,
        errorMessage: validationError,
      };
    });

    // Additive selection: append without discarding previously selected files!
    setUploadQueue((prev) => [...prev, ...staged]);
    setBatchSummary(null);
  };

  const updateQueuedFileTarget = (localId: string, selectionValue: string) => {
    if (!activeDetail) return;
    setUploadQueue((prev) =>
      prev.map((q) => {
        if (q.localId !== localId) return q;
        if (selectionValue.startsWith('item:')) {
          const id = selectionValue.slice(5);
          const item = activeDetail.items.find((i) => i.id === id);
          if (!item) return q;
          return {
            ...q,
            targetSelection: selectionValue,
            itemId: item.id,
            categoriaOrganizacional:
              item.categoria === 'colaborador' ? classifyIntegrationDocumentGroup(item) : undefined,
            documentoCodigoCanonico: item.documentoCodigoCanonico,
            nomeExibicao: item.nomeExibicao,
            origemColecao: item.origemColecao,
            semValidade: Boolean(item.semValidade),
          };
        }
        if (selectionValue.startsWith('catalog:')) {
          const code = selectionValue.slice(8);
          const entry = EMPLOYEE_DOCUMENT_CATALOG.find((c) => c.codigoCanonico === code);
          if (entry) {
            return {
              ...q,
              targetSelection: selectionValue,
              itemId: undefined,
              categoriaOrganizacional: entry.categoriaId,
              documentoCodigoCanonico: entry.codigoCanonico,
              nomeExibicao: entry.nomeExibicao,
              origemColecao: entry.origemColecao,
              semValidade: Boolean(entry.semValidadePadrao),
            };
          }
          return {
            ...q,
            targetSelection: selectionValue,
            itemId: undefined,
            documentoCodigoCanonico: code || 'DOC_EMPRESA_ADICIONAL',
            nomeExibicao: q.arquivoNome.replace(/\.[^/.]+$/, ''),
            origemColecao: 'documents',
          };
        }
        return q;
      })
    );
  };

  const updateQueuedFileCategory = (
    localId: string,
    newCategory: IntegrationDocumentGroupId
  ) => {
    setUploadQueue((prev) =>
      prev.map((q) => {
        if (q.localId !== localId) return q;
        const firstCatalogInCat = EMPLOYEE_DOCUMENT_CATALOG.find(
          (entry) => entry.categoriaId === newCategory
        );
        const currentCatalog = EMPLOYEE_DOCUMENT_CATALOG.find(
          (entry) => entry.codigoCanonico === q.documentoCodigoCanonico
        );
        // Keep current document type if it already belongs to this category, otherwise pick the primary type in the new category
        if (currentCatalog && currentCatalog.categoriaId === newCategory) {
          return { ...q, categoriaOrganizacional: newCategory };
        }
        if (q.itemId) {
          return { ...q, categoriaOrganizacional: newCategory };
        }
        if (firstCatalogInCat) {
          return {
            ...q,
            categoriaOrganizacional: newCategory,
            targetSelection: `catalog:${firstCatalogInCat.codigoCanonico}`,
            itemId: undefined,
            documentoCodigoCanonico: firstCatalogInCat.codigoCanonico,
            nomeExibicao: firstCatalogInCat.nomeExibicao,
            origemColecao: firstCatalogInCat.origemColecao,
            semValidade: Boolean(firstCatalogInCat.semValidadePadrao),
          };
        }
        return { ...q, categoriaOrganizacional: newCategory };
      })
    );
  };

  const runQueuedBatchUpload = async (
    mode: 'pending' | 'failed_only' | 'single' | 'owner',
    options?: {
      autoSubmitAfter?: boolean;
      singleLocalId?: string;
      ownerKey?: string;
    }
  ) => {
    if (!activeDetail || isAuditor || isUploadingQueue) return;

    const currentSnapshot = uploadQueueRef.current;
    const targets = currentSnapshot.filter((q) => {
      if (mode === 'single') return q.localId === options?.singleLocalId;
      if (mode === 'failed_only') return q.uploadStatus === 'failed';
      if (mode === 'owner') {
        return (
          q.targetOwnerKey === options?.ownerKey &&
          (q.uploadStatus === 'queued' || q.uploadStatus === 'failed')
        );
      }
      return q.uploadStatus === 'queued' || q.uploadStatus === 'failed';
    });

    if (targets.length === 0) {
      setFeedback({
        type: 'info',
        text: 'Não há arquivos pendentes na fila para envio.',
      });
      return;
    }

    setIsUploadingQueue(true);
    setFeedback(null);
    setBatchSummary(null);

    const targetIds = new Set(targets.map((t) => t.localId));
    // Reset targeted items to queued before processing
    setUploadQueue((prev) =>
      prev.map((q) =>
        targetIds.has(q.localId)
          ? { ...q, uploadStatus: 'queued', progress: 0, errorMessage: undefined }
          : q
      )
    );

    let succeededCount = 0;
    let failedCount = 0;
    let latestDetail: IntegrationServerDetailResult = activeDetail;
    let cursor = 0;

    const processOne = async (queued: QueuedUploadFile) => {
      // Client-side pre-check so invalid files fail cleanly without blocking the rest of the queue
      const ext = getFileExtension(queued.arquivoNome);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        failedCount += 1;
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.localId === queued.localId
              ? {
                  ...q,
                  uploadStatus: 'failed',
                  progress: 0,
                  errorMessage: `Formato ".${ext || 'desconhecido'}" não suportado. Use PDF, JPG ou PNG.`,
                }
              : q
          )
        );
        return;
      }
      if (queued.sizeBytes <= 0 || queued.sizeBytes > MAX_UPLOAD_BYTES) {
        failedCount += 1;
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.localId === queued.localId
              ? {
                  ...q,
                  uploadStatus: 'failed',
                  progress: 0,
                  errorMessage:
                    queued.sizeBytes <= 0
                      ? 'Arquivo vazio (0 bytes).'
                      : `Arquivo (${formatFileSize(queued.sizeBytes)}) excede o limite de 4 MB por arquivo.`,
                }
              : q
          )
        );
        return;
      }

      setUploadQueue((prev) =>
        prev.map((q) =>
          q.localId === queued.localId
            ? { ...q, uploadStatus: 'uploading', progress: 5, errorMessage: undefined }
            : q
        )
      );

      try {
        const base64DataUrl = await readFileAsDataUrl(queued.file);
        const payload: IntegrationBatchFilePayload = {
          itemId: queued.itemId || undefined,
          categoria: queued.categoria,
          categoriaOrganizacional: queued.categoriaOrganizacional,
          colaboradorId: queued.colaboradorId,
          colaboradorCandidateId: queued.colaboradorCandidateId,
          documentoCodigoCanonico: queued.documentoCodigoCanonico,
          nomeExibicao: queued.nomeExibicao,
          origemColecao: queued.origemColecao,
          obrigatorio: false,
          arquivoNome: queued.arquivoNome,
          arquivoBase64: base64DataUrl,
          dataEmissao: queued.dataEmissao || undefined,
          dataValidade: queued.semValidade ? '' : queued.dataValidade || undefined,
          semValidade: queued.semValidade,
          conclusaoAso: queued.conclusaoAso,
          observacoes: queued.observacoes || undefined,
          runSmartDocsAi: useSmartDocsAi,
        };

        const result = await uploadIntegrationDocumentOnServer(
          activeDetail.integration.id,
          payload,
          (pct) => {
            setUploadQueue((prev) =>
              prev.map((q) =>
                q.localId === queued.localId ? { ...q, progress: pct } : q
              )
            );
          }
        );

        latestDetail = {
          integration: result.integration,
          items: result.items,
          compliancePreview: result.compliancePreview,
          submissionReadiness: result.submissionReadiness,
        };
        setActiveDetail(latestDetail);

        succeededCount += 1;
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.localId === queued.localId
              ? {
                  ...q,
                  uploadStatus: 'success',
                  progress: 100,
                  errorMessage: undefined,
                  uploadedItemId: result.item.id,
                  uploadedVersion: result.uploadedFile.versao,
                }
              : q
          )
        );
      } catch (err: any) {
        failedCount += 1;
        setUploadQueue((prev) =>
          prev.map((q) =>
            q.localId === queued.localId
              ? {
                  ...q,
                  uploadStatus: 'failed',
                  progress: 0,
                  errorMessage: err?.message || 'Erro ao enviar arquivo. Tente reenviar.',
                }
              : q
          )
        );
      }
    };

    const workerCount = Math.min(UPLOAD_CONCURRENCY, targets.length);
    await Promise.all(
      Array.from({ length: workerCount }).map(async () => {
        while (cursor < targets.length) {
          const idx = cursor;
          cursor += 1;
          await processOne(targets[idx]);
        }
      })
    );

    const summary: BatchRunSummary = {
      totalProcessed: targets.length,
      succeeded: succeededCount,
      failed: failedCount,
      finishedAt: new Date().toISOString(),
    };
    setBatchSummary(summary);

    if (options?.autoSubmitAfter && failedCount === 0 && succeededCount > 0) {
      try {
        const submitted = await submitIntegrationOnServer(latestDetail.integration.id, {
          expectedVersion: latestDetail.integration.versaoConcorrencia,
        });
        setActiveDetail(submitted);
        setFeedback({
          type: 'success',
          text: `Envio em lote concluído (${succeededCount}/${targets.length}) e processo submetido para análise do Admin EHS!`,
        });
      } catch (err: any) {
        setFeedback({
          type: 'error',
          text: `${succeededCount} arquivo(s) salvo(s) com sucesso, mas a submissão final retornou: ${err?.message || 'erro ao submeter'}.`,
        });
      }
    } else if (failedCount === 0) {
      setFeedback({
        type: 'success',
        text: `Envio concluído: ${succeededCount}/${targets.length} documento(s) anexado(s) com sucesso (status: Enviado — aguardando conferência do Admin EHS).`,
      });
    } else {
      setFeedback({
        type: 'error',
        text: `Envio finalizado com falhas parciais: ${succeededCount} enviado(s) com sucesso e ${failedCount} com falha. Os arquivos enviados foram preservados — corrija ou clique em "Reenviar Apenas Falhas".`,
      });
    }

    setIsUploadingQueue(false);
  };

  const openSolicitanteDocumentPreview = async (
    item: ContractorIntegrationItem,
    opts?: { version?: number; fileName?: string }
  ) => {
    if (!activeDetail) return;
    const key = `preview-${item.id}-v${opts?.version || item.versaoAtual || 1}`;
    setLoadingFileKey(key);
    setFeedback(null);
    try {
      const res = await fetchIntegrationItemFileBlobOnServer(activeDetail.integration.id, item.id, {
        version: opts?.version,
        download: false,
      });
      const objectUrl = URL.createObjectURL(res.blob);
      setPreviewDoc({
        fileName: opts?.fileName || item.arquivoNome || res.fileName,
        mimeType: res.mimeType,
        objectUrl,
        itemLabel: `${item.nomeExibicao}${opts?.version ? ` (v${opts.version})` : ''}`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível visualizar o documento protegido.',
      });
    } finally {
      setLoadingFileKey(null);
    }
  };

  const downloadSolicitanteDocument = async (
    item: ContractorIntegrationItem,
    opts?: { version?: number; fileName?: string }
  ) => {
    if (!activeDetail) return;
    const key = `download-${item.id}-v${opts?.version || item.versaoAtual || 1}`;
    setLoadingFileKey(key);
    setFeedback(null);
    try {
      const res = await fetchIntegrationItemFileBlobOnServer(activeDetail.integration.id, item.id, {
        version: opts?.version,
        download: true,
      });
      const objectUrl = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = opts?.fileName || item.arquivoNome || res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível baixar o documento protegido.',
      });
    } finally {
      setLoadingFileKey(null);
    }
  };

  const handleSubmitIntegration = async () => {
    if (!activeDetail || isAuditor || !submissionGate.canFinalizeAndSubmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await submitIntegrationOnServer(activeDetail.integration.id, {
        expectedVersion: activeDetail.integration.versaoConcorrencia,
      });
      setActiveDetail(updated);
      setFeedback({
        type: 'success',
        text: `Protocolo ${updated.integration.codigoProtocolo} enviado para conferência do Administrador EHS (${INTEGRATION_STATUS_META[updated.integration.status].label}).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível enviar a integração.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRenewItemSubmit = async () => {
    if (!activeDetail || !renewingItem || !renewFileData || isAuditor) return;
    if (renewFileData.sizeBytes > MAX_UPLOAD_BYTES) {
      setFeedback({
        type: 'error',
        text: `O arquivo selecionado (${formatFileSize(renewFileData.sizeBytes)}) excede o limite de 4 MB.`,
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await renewIntegrationItemOnServer(
        activeDetail.integration.id,
        renewingItem.id,
        {
          arquivoNome: renewFileData.arquivoNome,
          arquivoBase64: renewFileData.arquivoBase64,
          dataEmissao: renewFileData.dataEmissao || undefined,
          dataValidade: renewFileData.semValidade ? '' : renewFileData.dataValidade || undefined,
          semValidade: renewFileData.semValidade,
          conclusaoAso: renewFileData.conclusaoAso,
          observacoes: renewFileData.observacoes || undefined,
          runSmartDocsAi: useSmartDocsAi,
        }
      );
      setActiveDetail(updated);
      setRenewingItem(null);
      setRenewFileData(null);
      setFeedback({
        type: 'success',
        text: `Nova versão enviada para "${renewingItem.nomeExibicao}". A versão anterior permanece preservada no histórico até a aprovação humana do Admin EHS.`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao enviar renovação documental.',
      });
    } finally {
      setBusy(false);
    }
  };

  const queueStats = useMemo(() => {
    const total = uploadQueue.length;
    const queued = uploadQueue.filter((q) => q.uploadStatus === 'queued').length;
    const uploading = uploadQueue.filter((q) => q.uploadStatus === 'uploading').length;
    const success = uploadQueue.filter((q) => q.uploadStatus === 'success').length;
    const failed = uploadQueue.filter((q) => q.uploadStatus === 'failed').length;
    const globalPercent =
      total === 0
        ? 0
        : Math.round(
            uploadQueue.reduce((acc, q) => acc + (q.uploadStatus === 'success' ? 100 : q.progress), 0) /
              total
          );
    return { total, queued, uploading, success, failed, globalPercent };
  }, [uploadQueue]);

  const canUploadToActive =
    !isAuditor &&
    activeDetail &&
    ['RASCUNHO', 'PENDENTE_DOCUMENTACAO', 'EM_ENVIO', 'PENDENTE_CORRECAO'].includes(
      activeDetail.integration.status
    );

  const submissionGate = useMemo(() => {
    const hasPendingQueueUploads =
      queueStats.queued > 0 || queueStats.uploading > 0 || queueStats.failed > 0;

    if (!activeDetail) {
      const emptyReadiness: IntegrationSubmissionReadiness = {
        podeSubmeter: false,
        totalItens: 0,
        totalObrigatorios: 0,
        obrigatoriosConfirmados: 0,
        obrigatoriosPendentes: 0,
        totalOpcionais: 0,
        opcionaisEnviados: 0,
        pendenciasObrigatorias: [],
      };
      return {
        readiness: emptyReadiness,
        hasPendingQueueUploads,
        canFinalizeAndSubmit: false,
        mandatoryProgressPercent: 0,
      };
    }

    let readiness: IntegrationSubmissionReadiness;
    if (activeDetail.submissionReadiness) {
      readiness = activeDetail.submissionReadiness;
    } else {
      const mandatoryItems = activeDetail.items.filter((i) => i.obrigatorio);
      const optionalItems = activeDetail.items.filter((i) => !i.obrigatorio);
      const pendencias: IntegrationPendingDocumentInfo[] = [];
      let obrigatoriosConfirmados = 0;

      for (const item of mandatoryItems) {
        const confirmed = Boolean(item.arquivoNome) && item.hasStoredFile !== false;
        const okStatus =
          item.status === 'ENVIADO' || item.status === 'EM_ANALISE' || item.status === 'APROVADO';
        if (confirmed && okStatus) {
          obrigatoriosConfirmados += 1;
        } else {
          pendencias.push({
            itemId: item.id,
            documentoCodigoCanonico: item.documentoCodigoCanonico,
            nomeExibicao: item.nomeExibicao,
            categoria: item.categoria,
            categoriaOrganizacional:
              item.categoria === 'colaborador'
                ? item.categoriaOrganizacional || classifyIntegrationDocumentGroup(item)
                : undefined,
            colaboradorNome: item.colaboradorNome,
            status: item.status,
            motivo:
              item.status === 'REPROVADO'
                ? item.motivoReprovacao || 'Documento reprovado — exige correção e reenvio.'
                : !item.arquivoNome
                ? 'Documento obrigatório ainda não anexado.'
                : 'Arquivo ainda não confirmado no armazenamento seguro.',
          });
        }
      }

      const opcionaisEnviados = optionalItems.filter(
        (i) => Boolean(i.arquivoNome) && i.hasStoredFile !== false
      ).length;

      readiness = {
        podeSubmeter:
          activeDetail.items.length > 0 &&
          pendencias.length === 0 &&
          (mandatoryItems.length > 0 || opcionaisEnviados > 0),
        totalItens: activeDetail.items.length,
        totalObrigatorios: mandatoryItems.length,
        obrigatoriosConfirmados,
        obrigatoriosPendentes: pendencias.length,
        totalOpcionais: optionalItems.length,
        opcionaisEnviados,
        pendenciasObrigatorias: pendencias,
      };
    }

    const mandatoryProgressPercent =
      readiness.totalObrigatorios === 0
        ? readiness.podeSubmeter
          ? 100
          : 0
        : Math.round((readiness.obrigatoriosConfirmados / readiness.totalObrigatorios) * 100);

    const canFinalizeAndSubmit =
      Boolean(canUploadToActive) &&
      !busy &&
      !isUploadingQueue &&
      !hasPendingQueueUploads &&
      readiness.podeSubmeter;

    return {
      readiness,
      hasPendingQueueUploads,
      canFinalizeAndSubmit,
      mandatoryProgressPercent,
    };
  }, [activeDetail, canUploadToActive, busy, isUploadingQueue, queueStats]);

  const renderItemCard = (item: ContractorIntegrationItem, ownerKeyOverride?: string) => {
    const meta = ITEM_STATUS_META[item.status];
    const isApproved = item.status === 'APROVADO';
    const isRejected = item.status === 'REPROVADO';
    const isHistoryOpen = expandedHistoryItemId === item.id;
    const itemPickerKey = `item-picker-${item.id}`;

    return (
      <div
        key={item.id}
        className={`rounded-xl border p-4 transition-colors ${
          isRejected
            ? 'bg-rose-950/20 border-rose-500/40'
            : isApproved
            ? 'bg-emerald-950/15 border-emerald-500/30'
            : 'bg-slate-900/70 border-slate-800'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-blue-300 border border-slate-700">
                {item.documentoCodigoCanonico}
              </span>
              <h4 className="text-sm font-semibold text-white">{item.nomeExibicao}</h4>
              {item.obrigatorio ? (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Obrigatório
                </span>
              ) : (
                <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Opcional
                </span>
              )}
              {item.versaoAtual > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  v{item.versaoAtual}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {item.activityNome && <span>Atividade: {item.activityNome}</span>}
              {item.baseLegal && <span>Base legal: {item.baseLegal}</span>}
              {item.aptidaoEspecifica && (
                <span className="text-sky-300">Aptidão ASO: {item.aptidaoEspecifica}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.badgeClass}`}>
              {meta.label}
            </span>
          </div>
        </div>

        {/* File & dates metadata + Protected View/Download */}
        {item.arquivoNome && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300 bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <span className="flex items-center gap-1.5 font-medium text-white min-w-0">
                <FileText size={14} className="text-blue-400 shrink-0" />
                <span className="truncate max-w-[240px] sm:max-w-[340px]">{item.arquivoNome}</span>
              </span>
              {item.arquivoTamanhoBytes ? (
                <span className="text-slate-400 tabular-nums">
                  ({formatFileSize(item.arquivoTamanhoBytes)})
                </span>
              ) : null}
              {item.dataEmissao && <span className="tabular-nums">Emissão: {item.dataEmissao}</span>}
              {item.semValidade ? (
                <span className="text-emerald-300">Sem validade</span>
              ) : item.dataValidade ? (
                <span className="tabular-nums">Validade: {item.dataValidade}</span>
              ) : null}
              {item.analisadoPorNome && (
                <span className="text-slate-400">
                  Analisado por {item.analisadoPorNome} em {formatDateTimePt(item.dataAnalise)}
                </span>
              )}
            </div>

            {item.hasStoredFile !== false && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={loadingFileKey !== null}
                  onClick={() =>
                    openSolicitanteDocumentPreview(item, {
                      version: item.versaoAtual || 1,
                      fileName: item.arquivoNome,
                    })
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {loadingFileKey === `preview-${item.id}-v${item.versaoAtual || 1}` ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Eye size={12} />
                  )}
                  Visualizar
                </button>
                <button
                  type="button"
                  disabled={loadingFileKey !== null}
                  onClick={() =>
                    downloadSolicitanteDocument(item, {
                      version: item.versaoAtual || 1,
                      fileName: item.arquivoNome,
                    })
                  }
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {loadingFileKey === `download-${item.id}-v${item.versaoAtual || 1}` ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                  Baixar
                </button>
              </div>
            )}
          </div>
        )}

        {/* SmartDocs AI Suggestion Notice */}
        {item.smartDocsSugestao && (
          <div className="mt-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30 px-3 py-2 text-xs text-indigo-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-indigo-300">
              <Sparkles size={13} /> Sugestão SmartDocs IA (não aprova automaticamente)
            </p>
            <div className="flex flex-wrap gap-3 text-[11px] text-indigo-200/90">
              {item.smartDocsSugestao.tipoDocumentoSugerido && (
                <span>Tipo detectado: {item.smartDocsSugestao.tipoDocumentoSugerido}</span>
              )}
              {item.smartDocsSugestao.dataValidadeSugerida && (
                <span>Validade sugerida: {item.smartDocsSugestao.dataValidadeSugerida}</span>
              )}
              {item.smartDocsSugestao.qualidadeLeitura && (
                <span>Qualidade: {item.smartDocsSugestao.qualidadeLeitura}</span>
              )}
            </div>
            {item.smartDocsSugestao.alertas && item.smartDocsSugestao.alertas.length > 0 && (
              <p className="text-[11px] text-amber-300">
                {item.smartDocsSugestao.alertas.join(' • ')}
              </p>
            )}
          </div>
        )}

        {/* Rejection Reason */}
        {isRejected && item.motivoReprovacao && (
          <div className="mt-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-300">Motivo da Reprovação (correção necessária):</p>
              <p>{item.motivoReprovacao}</p>
            </div>
          </div>
        )}

        {/* Approved Preservation Notice */}
        {isApproved && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-300/90">
            <span className="flex items-center gap-1.5">
              <Lock size={13} />{' '}
              {item.officialCollection && item.officialRecordId
                ? `Documento aprovado e preservado oficialmente (${item.officialCollection}).`
                : 'Documento conferido e aprovado pelo Admin EHS (preservado — será oficializado na aprovação final completa do cadastro).'}
            </span>
            {!isAuditor &&
              activeDetail &&
              !['RASCUNHO', 'PENDENTE_DOCUMENTACAO', 'EM_ENVIO', 'ENCERRADA'].includes(
                activeDetail.integration.status
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    setRenewingItem(item);
                    setRenewFileData(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={12} /> Renovar / Enviar Nova Versão
                </button>
              )}
          </div>
        )}

        {/* Actions for pending/rejected item */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
          <div className="flex items-center gap-2">
            {canUploadToActive && !isApproved && (
              <>
                <button
                  type="button"
                  onClick={() => openFilePicker(itemPickerKey)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload size={13} />
                  <span>
                    {isRejected
                      ? 'Substituir Documento Reprovado'
                      : item.versaoAtual > 0
                      ? 'Enviar Nova Versão'
                      : 'Anexar Arquivo'}
                  </span>
                </button>
                <input
                  ref={(el) => {
                    fileInputRefs.current[itemPickerKey] = el;
                  }}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="sr-only"
                  onChange={(ev) => {
                    const resolvedOwnerKey =
                      ownerKeyOverride ||
                      (item.categoria === 'colaborador'
                        ? item.colaboradorId ||
                          item.colaboradorCandidateId ||
                          item.colaboradorNome ||
                          'colaborador'
                        : 'empresa');
                    enqueueFilesForTarget(ev.target.files, {
                      ownerKey: resolvedOwnerKey,
                      ownerName:
                        item.categoria === 'colaborador'
                          ? item.colaboradorNome || 'Colaborador'
                          : item.empresaNome,
                      categoria: item.categoria,
                      colaboradorId: item.colaboradorId,
                      colaboradorCandidateId: item.colaboradorCandidateId,
                      forcedItemId: item.id,
                    });
                    ev.target.value = '';
                  }}
                />
              </>
            )}
          </div>

          {item.versoes && item.versoes.length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedHistoryItemId(isHistoryOpen ? null : item.id)}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <History size={13} />
              <span>
                Histórico ({item.versoes.length} versão{item.versoes.length > 1 ? 'ões' : ''})
              </span>
              {isHistoryOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>

        {/* Version History */}
        {isHistoryOpen && item.versoes && item.versoes.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
            {[...item.versoes]
              .sort((a, b) => b.versao - a.versao)
              .map((ver) => (
                <div
                  key={ver.versao}
                  className="text-xs bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-200 mr-2 tabular-nums">
                      v{ver.versao}
                    </span>
                    <span className="text-slate-300">{ver.arquivoNome}</span>
                    <span className="text-slate-500 ml-2 tabular-nums">
                      ({formatFileSize(ver.arquivoTamanhoBytes)}) · Enviado por {ver.enviadoPorNome} em{' '}
                      {formatDateTimePt(ver.enviadoEm)}
                    </span>
                    {ver.motivoReprovacao && (
                      <p className="text-rose-300 mt-0.5">Reprovado: {ver.motivoReprovacao}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ver.hasStoredFile !== false && (
                      <button
                        type="button"
                        disabled={loadingFileKey !== null}
                        onClick={() =>
                          openSolicitanteDocumentPreview(item, {
                            version: ver.versao,
                            fileName: ver.arquivoNome,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 text-[11px] font-semibold cursor-pointer"
                      >
                        Visualizar
                      </button>
                    )}
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        ITEM_STATUS_META[ver.status].badgeClass
                      }`}
                    >
                      {ITEM_STATUS_META[ver.status].label}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  const renderQueuedFileRow = (qf: QueuedUploadFile, ownerItems: ContractorIntegrationItem[]) => {
    const editableOwnerItems = ownerItems.filter((it) => it.status !== 'APROVADO');
    const isLocked = qf.uploadStatus === 'uploading' || qf.uploadStatus === 'success';

    return (
      <div
        key={qf.localId}
        className={`rounded-xl border p-3 space-y-2.5 text-xs ${
          qf.uploadStatus === 'success'
            ? 'bg-emerald-950/20 border-emerald-500/30'
            : qf.uploadStatus === 'failed'
            ? 'bg-rose-950/25 border-rose-500/40'
            : qf.uploadStatus === 'uploading'
            ? 'bg-blue-950/25 border-blue-500/40'
            : 'bg-slate-950 border-slate-800'
        }`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
          {/* File Name, Format, Size, Owner */}
          <div className="lg:col-span-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700 shrink-0">
                {qf.extension}
              </span>
              <p className="font-semibold text-white truncate" title={qf.arquivoNome}>
                {qf.arquivoNome}
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums truncate">
              {formatFileSize(qf.sizeBytes)} · {qf.targetOwnerName}
            </p>
          </div>

          {/* Category (1-4) + Document Type Selectors */}
          <div className="lg:col-span-4 space-y-1.5">
            {qf.categoria === 'colaborador' && (
              <select
                value={
                  qf.categoriaOrganizacional ||
                  classifyIntegrationDocumentGroup({
                    documentoCodigoCanonico: qf.documentoCodigoCanonico,
                    nomeExibicao: qf.nomeExibicao,
                    origemColecao: qf.origemColecao,
                  })
                }
                disabled={isLocked}
                onChange={(e) =>
                  updateQueuedFileCategory(
                    qf.localId,
                    e.target.value as IntegrationDocumentGroupId
                  )
                }
                aria-label={`Categoria documental para ${qf.arquivoNome}`}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-[11px] text-sky-200 font-semibold disabled:opacity-60"
              >
                {MANDATORY_DOCUMENT_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.codigoEtiqueta} — {cat.titulo}
                  </option>
                ))}
              </select>
            )}
            <select
              value={qf.targetSelection}
              disabled={isLocked}
              onChange={(e) => updateQueuedFileTarget(qf.localId, e.target.value)}
              aria-label={`Tipo documental para ${qf.arquivoNome}`}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
            >
              {editableOwnerItems.length > 0 && (
                <optgroup label="Checklist da Matriz de Atividades">
                  {editableOwnerItems.map((it) => (
                    <option key={it.id} value={`item:${it.id}`}>
                      [{it.documentoCodigoCanonico}] {it.nomeExibicao}
                      {it.obrigatorio ? ' (Obrigatório)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {qf.categoria === 'colaborador' ? (
                MANDATORY_DOCUMENT_CATEGORIES.map((cat) => (
                  <optgroup key={cat.id} label={`${cat.codigoEtiqueta} — ${cat.titulo}`}>
                    {EMPLOYEE_DOCUMENT_CATALOG.filter((e) => e.categoriaId === cat.id).map((entry) => (
                      <option key={entry.codigoCanonico} value={`catalog:${entry.codigoCanonico}`}>
                        {entry.ordem}. {entry.nomeExibicao}
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <optgroup label="Documentação Complementar da Empresa">
                  <option value="catalog:DOC_EMPRESA_ADICIONAL">
                    Documento Complementar da Empresa
                  </option>
                </optgroup>
              )}
            </select>
          </div>

          {/* Emission & Expiration Dates */}
          <div className="lg:col-span-3 grid grid-cols-2 gap-2">
            <input
              type="date"
              value={qf.dataEmissao}
              disabled={isLocked}
              onChange={(e) =>
                setUploadQueue((prev) =>
                  prev.map((x) =>
                    x.localId === qf.localId ? { ...x, dataEmissao: e.target.value } : x
                  )
                )
              }
              title="Data de Emissão (opcional)"
              aria-label="Data de Emissão"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-[11px] text-white tabular-nums disabled:opacity-50"
            />
            <input
              type="date"
              value={qf.dataValidade}
              disabled={isLocked || qf.semValidade}
              onChange={(e) =>
                setUploadQueue((prev) =>
                  prev.map((x) =>
                    x.localId === qf.localId ? { ...x, dataValidade: e.target.value } : x
                  )
                )
              }
              title="Data de Validade (opcional)"
              aria-label="Data de Validade"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-[11px] text-white tabular-nums disabled:opacity-40"
            />
          </div>

          {/* Status Badge + Actions */}
          <div className="lg:col-span-2 flex items-center justify-end gap-2">
            {qf.uploadStatus === 'queued' && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded border bg-slate-800 text-slate-300 border-slate-700 whitespace-nowrap">
                Aguardando envio
              </span>
            )}
            {qf.uploadStatus === 'uploading' && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded border bg-blue-500/15 text-blue-300 border-blue-500/30 flex items-center gap-1 tabular-nums whitespace-nowrap">
                <Loader2 size={11} className="animate-spin" /> {qf.progress}%
              </span>
            )}
            {qf.uploadStatus === 'success' && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1 whitespace-nowrap">
                <CheckCircle2 size={11} /> Enviado
              </span>
            )}
            {qf.uploadStatus === 'failed' && (
              <button
                type="button"
                disabled={isUploadingQueue}
                onClick={() => runQueuedBatchUpload('single', { singleLocalId: qf.localId })}
                className="text-[11px] font-semibold px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <RotateCcw size={11} /> Reenviar
              </button>
            )}

            {qf.uploadStatus !== 'uploading' && (
              <button
                type="button"
                onClick={() =>
                  setUploadQueue((prev) => prev.filter((x) => x.localId !== qf.localId))
                }
                title="Remover arquivo da lista"
                aria-label={`Remover ${qf.arquivoNome}`}
                className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Individual Progress Bar */}
        {(qf.uploadStatus === 'uploading' || qf.uploadStatus === 'success') && (
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                qf.uploadStatus === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
              }`}
              style={{ width: `${qf.uploadStatus === 'success' ? 100 : qf.progress}%` }}
            />
          </div>
        )}

        {/* Per-File Error Message */}
        {qf.uploadStatus === 'failed' && qf.errorMessage && (
          <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
            <AlertTriangle size={12} className="shrink-0" />
            <span>{qf.errorMessage}</span>
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Layers className="text-blue-500" size={26} />
            Central de Integração de Terceiros
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Centralize o cadastro de contratadas, colaboradores terceirizados e envio em lote de documentos obrigatórios conforme a Matriz de Atividades.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isAuditor && (
            <button
              type="button"
              onClick={() => {
                persistActiveIntegrationId(null);
                setSection('nova');
                setActiveDetail(null);
                setFeedback(null);
                setCreateError(null);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
                section === 'nova'
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <Plus size={15} /> Nova Integração / Atualização
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSection('acompanhamento');
              setFeedback(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
              section === 'acompanhamento'
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            <Clock size={15} /> Acompanhamento ({visibleIntegrations.length})
          </button>
        </div>
      </div>

      {/* Auditor Read-Only Banner */}
      {isAuditor && (
        <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-200 flex items-center gap-2">
          <Eye size={16} className="text-emerald-400 shrink-0" />
          <span>
            Perfil <strong>Auditor</strong>: visualização somente leitura das integrações, documentos, versões e trilha de auditoria.
          </span>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-start justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : feedback.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              : 'bg-sky-950/40 border-sky-500/40 text-sky-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            ) : feedback.type === 'error' ? (
              <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <Info size={18} className="text-sky-400 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* SECTION 1: NEW INTEGRATION / DOCUMENT UPDATE WIZARD */}
      {section === 'nova' && !isAuditor && (
        <form noValidate onSubmit={handleCreateIntegration} className="space-y-6">
          {/* Type Switcher */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setIntegrationType('INTEGRACAO_INICIAL')}
              className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                integrationType === 'INTEGRACAO_INICIAL'
                  ? 'bg-blue-950/40 border-blue-500 shadow-lg shadow-blue-950/30'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <FileCheck2 size={18} className="text-blue-400" />
                  Integração Inicial de Terceiros
                </span>
                {integrationType === 'INTEGRACAO_INICIAL' && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-600 text-white">
                    Selecionado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Monta automaticamente o checklist completo de documentos obrigatórios da empresa e dos colaboradores conforme as atividades da Matriz.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setIntegrationType('ATUALIZACAO_DOCUMENTAL')}
              className={`text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                integrationType === 'ATUALIZACAO_DOCUMENTAL'
                  ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-950/30'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <RefreshCw size={18} className="text-indigo-400" />
                  Atualização / Renovação Documental
                </span>
                {integrationType === 'ATUALIZACAO_DOCUMENTAL' && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-600 text-white">
                    Selecionado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Renove documentos vencidos ou a vencer (ASO, NR-35, NR-33, PGR, PCMSO) sem refazer toda a integração e preservando todo o histórico aprovado.
              </p>
            </button>
          </div>

          {/* Step 1: Company Selection or New Registration Request */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 size={18} className="text-blue-400" />
                1. Empresa Contratada
              </h2>
              {(!isSolicitante || !activeEmpresaId) && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setCompanyMode('existing')}
                    className={`px-3 py-1.5 rounded-lg border font-medium cursor-pointer ${
                      companyMode === 'existing'
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700'
                    }`}
                  >
                    Empresa Existente
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompanyMode('new')}
                    className={`px-3 py-1.5 rounded-lg border font-medium cursor-pointer ${
                      companyMode === 'new'
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700'
                    }`}
                  >
                    Solicitar Cadastro de Nova Empresa
                  </button>
                </div>
              )}
            </div>

            {companyMode === 'existing' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Empresa Contratada *
                  </label>
                  <select
                    value={selectedEmpresaId}
                    onChange={(e) => {
                      setSelectedEmpresaId(e.target.value);
                      setSelectedEmployeeIds([]);
                    }}
                    disabled={isSolicitante && Boolean(activeEmpresaId)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-70"
                    required
                  >
                    <option value="">Selecione uma empresa contratada...</option>
                    {visibleCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.razaoSocial} — CNPJ: {c.cnpj}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-400 flex items-center gap-2">
                  <Info size={16} className="text-blue-400 shrink-0" />
                  <span>
                    Vincular uma empresa já existente reaproveita o cadastro oficial sem duplicar CNPJ nem sobrescrever documentos já aprovados.
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">CNPJ *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCompanyForm.cnpj}
                        onChange={(e) => setNewCompanyForm({ ...newCompanyForm, cnpj: e.target.value })}
                        placeholder="00.000.000/0001-00"
                        className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                        required
                      />
                      <button
                        type="button"
                        onClick={handleCheckCnpj}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white font-semibold shrink-0 cursor-pointer"
                      >
                        Verificar
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Razão Social *</label>
                    <input
                      type="text"
                      value={newCompanyForm.razaoSocial}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, razaoSocial: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Nome Fantasia</label>
                    <input
                      type="text"
                      value={newCompanyForm.nomeFantasia}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, nomeFantasia: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Responsável SST</label>
                    <input
                      type="text"
                      value={newCompanyForm.responsavelSST}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, responsavelSST: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail de Contato</label>
                    <input
                      type="email"
                      value={newCompanyForm.email}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, email: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={newCompanyForm.telefone}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, telefone: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                {cnpjCheck?.cnpjDuplicado && (
                  <div className="rounded-xl bg-amber-950/40 border border-amber-500/40 p-3 text-xs text-amber-200 flex items-center justify-between gap-3">
                    <span>
                      Atenção: este CNPJ já existe na base oficial
                      {cnpjCheck.empresaExistente
                        ? ` (${cnpjCheck.empresaExistente.razaoSocial})`
                        : ''}
                      . Utilize o cadastro existente para evitar duplicidade.
                    </span>
                    {cnpjCheck.empresaExistente && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEmpresaId(cnpjCheck.empresaExistente!.id);
                          setCompanyMode('existing');
                          setCnpjCheck(null);
                        }}
                        className="px-3 py-1 rounded-lg bg-amber-600 text-white font-semibold shrink-0 cursor-pointer"
                      >
                        Usar Empresa Existente
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Activities (Dynamic Matrix) or Renewal Docs */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldAlert size={18} className="text-amber-400" />
                {integrationType === 'INTEGRACAO_INICIAL'
                  ? '2. Atividades a Executar (Matriz Dinâmica de Requisitos)'
                  : '2. Documentos a Renovar / Atualizar'}
              </h2>
              {selectedActivityIds.length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold">
                  {previewMatrixRequirementsCount} requisito(s) mapeado(s) na Matriz
                </span>
              )}
            </div>

            {integrationType === 'ATUALIZACAO_DOCUMENTAL' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {QUICK_RENEWAL_DOCS.map((docDef) => {
                  const active = selectedRenewalCodes.includes(docDef.code);
                  return (
                    <button
                      key={docDef.code}
                      type="button"
                      onClick={() =>
                        setSelectedRenewalCodes((prev) =>
                          prev.includes(docDef.code)
                            ? prev.filter((c) => c !== docDef.code)
                            : [...prev, docDef.code]
                        )
                      }
                      className={`text-left p-3 rounded-xl border text-xs transition-all cursor-pointer ${
                        active
                          ? 'bg-indigo-600/20 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-indigo-300">{docDef.code}</span>
                        <span className="text-[10px] uppercase text-slate-400">{docDef.categoria}</span>
                      </div>
                      <p className="mt-1 font-medium">{docDef.label}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeActivities.length === 0 ? (
                  activityMatrixFirestoreError ? (
                    <div className="col-span-full rounded-xl bg-amber-950/35 border border-amber-500/40 p-4 text-xs text-amber-200 flex items-start gap-2.5">
                      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-bold text-amber-300">
                          Dependência de Infraestrutura Firestore (Matriz de Atividades indisponível)
                        </p>
                        <p>{activityMatrixFirestoreError}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 col-span-full">
                      Nenhuma atividade ativa encontrada na Matriz de Atividades. Solicite ao Admin EHS a configuração dos perfis.
                    </p>
                  )
                ) : (
                  activeActivities.map((act) => {
                    const selected = selectedActivityIds.includes(act.id);
                    return (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() =>
                          setSelectedActivityIds((prev) =>
                            prev.includes(act.id)
                              ? prev.filter((id) => id !== act.id)
                              : [...prev, act.id]
                          )
                        }
                        className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                          selected
                            ? 'bg-blue-600/20 border-blue-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold">{act.nome}</span>
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                            {act.nivelRisco}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                          {act.normasAplicaveis.join(' • ')}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Step 3: Third-party Employees (Existing + New with CPF dedup) */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Users size={18} className="text-emerald-400" />
              3. Colaboradores Terceirizados Vinculados
            </h2>

            {companyEmployees.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400">
                  Selecionar colaboradores já cadastrados nesta contratada:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-52 overflow-y-auto pr-1">
                  {companyEmployees.map((emp) => {
                    const checked = selectedEmployeeIds.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs cursor-pointer ${
                          checked
                            ? 'bg-emerald-950/30 border-emerald-500/50 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedEmployeeIds((prev) =>
                              prev.includes(emp.id)
                                ? prev.filter((id) => id !== emp.id)
                                : [...prev, emp.id]
                            )
                          }
                          className="mt-0.5 accent-emerald-500"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{emp.nomeCompleto}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {emp.cargo} • CPF: {emp.cpf}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add new third-party employee */}
            {integrationType === 'INTEGRACAO_INICIAL' && (
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-300">
                  Incluir novo colaborador terceirizado (com verificação automática de CPF duplicado):
                </p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Nome completo *"
                    value={empDraft.nomeCompleto}
                    onChange={(e) => setEmpDraft({ ...empDraft, nomeCompleto: e.target.value })}
                    className="rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white"
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="CPF (000.000.000-00) *"
                      value={empDraft.cpf}
                      onChange={(e) => setEmpDraft({ ...empDraft, cpf: e.target.value })}
                      onBlur={handleCheckCpf}
                      className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Cargo / Função (ex.: Eletricista) *"
                    value={empDraft.cargo}
                    onChange={(e) => setEmpDraft({ ...empDraft, cargo: e.target.value })}
                    className="rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddNewEmployeeDraft}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={14} /> Adicionar Terceirizado
                  </button>
                </div>

                {cpfCheck?.cpfDuplicado && (
                  <p className="text-xs text-amber-300">
                    CPF localizado na base oficial ({cpfCheck.colaboradorExistente?.nomeCompleto}). Ao clicar em adicionar, o registro existente será reutilizado sem duplicar.
                  </p>
                )}

                {newEmployees.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {newEmployees.map((emp) => (
                      <div
                        key={emp.localId}
                        className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                      >
                        <div>
                          <span className="font-semibold text-white">{emp.nomeCompleto}</span>
                          <span className="text-slate-400 ml-2">
                            {emp.cargo} • CPF: {emp.cpf}
                          </span>
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                            Novo cadastro (será oficializado após aprovação EHS)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setNewEmployees((prev) => prev.filter((x) => x.localId !== emp.localId))
                          }
                          className="text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Observações Gerais para o Admin EHS (opcional)
              </label>
              <textarea
                rows={2}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex.: Integração da equipe de manutenção elétrica para parada programada..."
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          {createError && (
            <div
              ref={createErrorRef}
              role="alert"
              className="rounded-xl bg-rose-950/50 border border-rose-500/50 px-4 py-3 text-xs text-rose-200 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <XCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-300">Não foi possível gerar o checklist:</p>
                  <p className="mt-0.5">{createError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateError(null)}
                className="text-rose-300 hover:text-white shrink-0 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          )}

          <div className="rounded-xl bg-blue-950/25 border border-blue-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-slate-300 space-y-0.5">
              <p className="font-semibold text-white">
                Próximo passo: Anexar Documentos dos Colaboradores em Lote
              </p>
              <p className="text-slate-400">
                Ao gerar o protocolo, você será direcionado à seção <strong>DOCUMENTAÇÃO DOS COLABORADORES</strong>, organizada nas 4 categorias oficiais, com botão <strong>ADICIONAR DOCUMENTOS</strong> e arrastar/soltar múltiplos arquivos por colaborador.
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 cursor-pointer whitespace-nowrap shrink-0"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16} />}
              <span>{busy ? 'Gerando Checklist...' : 'Gerar Checklist e Anexar Documentos'}</span>
            </button>
          </div>
        </form>
      )}

      {/* SECTION 2: TRACKING LIST + ACTIVE INTEGRATION WORKSPACE */}
      {section === 'acompanhamento' && (
        <div className="space-y-6">
          {/* Active Integration Detail Workspace */}
          {loadingDetail ? (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 flex items-center justify-center gap-3 text-slate-300">
              <Loader2 className="animate-spin text-blue-500" size={20} />
              <span className="text-sm">Carregando processo de integração...</span>
            </div>
          ) : activeDetail ? (
            <div className="space-y-5">
              {/* Top protocol bar */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          persistActiveIntegrationId(null);
                          setActiveDetail(null);
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      >
                        ← Voltar à lista
                      </button>
                      <span className="font-mono text-sm font-bold text-blue-400">
                        {activeDetail.integration.codigoProtocolo}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                          INTEGRATION_STATUS_META[activeDetail.integration.status].badgeClass
                        }`}
                      >
                        {INTEGRATION_STATUS_META[activeDetail.integration.status].label}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {activeDetail.integration.tipo === 'ATUALIZACAO_DOCUMENTAL'
                          ? 'Atualização Documental'
                          : 'Integração Inicial'}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-white mt-2">
                      {activeDetail.integration.empresaNome}
                    </h2>
                    <p className="text-xs text-slate-400">
                      CNPJ: {activeDetail.integration.empresaCnpj} • Atividades:{' '}
                      {activeDetail.integration.atividadeNomes.length > 0
                        ? activeDetail.integration.atividadeNomes.join(', ')
                        : 'Atualização direcionada'}
                    </p>
                  </div>

                  {/* Summary metrics */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2">
                      <p className="text-lg font-bold text-white">{activeDetail.integration.resumoItens.total}</p>
                      <p className="text-[10px] text-slate-400 uppercase">Total</p>
                    </div>
                    <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/30 px-3 py-2">
                      <p className="text-lg font-bold text-emerald-400">{activeDetail.integration.resumoItens.aprovados}</p>
                      <p className="text-[10px] text-emerald-300 uppercase">Aprovados</p>
                    </div>
                    <div className="rounded-xl bg-amber-950/30 border border-amber-500/30 px-3 py-2">
                      <p className="text-lg font-bold text-amber-400">
                        {activeDetail.integration.resumoItens.pendentesEnvio +
                          activeDetail.integration.resumoItens.enviados +
                          activeDetail.integration.resumoItens.emAnalise}
                      </p>
                      <p className="text-[10px] text-amber-300 uppercase">Pendentes</p>
                    </div>
                    <div className="rounded-xl bg-rose-950/30 border border-rose-500/30 px-3 py-2">
                      <p className="text-lg font-bold text-rose-400">{activeDetail.integration.resumoItens.reprovados}</p>
                      <p className="text-[10px] text-rose-300 uppercase">Reprovados</p>
                    </div>
                  </div>
                </div>

                {(activeDetail.integration.motivoReprovacaoOuDevolucao ||
                  (activeDetail.integration.itensPendentesCorrecao &&
                    activeDetail.integration.itensPendentesCorrecao.length > 0)) && (
                  <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-3.5 text-xs text-rose-200 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-rose-300">
                          Orientação do Admin EHS — Documentos que exigem correção ou substituição:
                        </p>
                        {activeDetail.integration.motivoReprovacaoOuDevolucao && (
                          <p>{activeDetail.integration.motivoReprovacaoOuDevolucao}</p>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const correctionList =
                        activeDetail.integration.itensPendentesCorrecao &&
                        activeDetail.integration.itensPendentesCorrecao.length > 0
                          ? activeDetail.integration.itensPendentesCorrecao
                          : activeDetail.items
                              .filter((i) => i.status === 'REPROVADO')
                              .map((i) => ({
                                itemId: i.id,
                                documentoCodigoCanonico: i.documentoCodigoCanonico,
                                nomeExibicao: i.nomeExibicao,
                                categoria: i.categoria,
                                categoriaOrganizacional:
                                  i.categoria === 'colaborador'
                                    ? i.categoriaOrganizacional || classifyIntegrationDocumentGroup(i)
                                    : undefined,
                                colaboradorNome: i.colaboradorNome,
                                status: i.status,
                                motivo:
                                  i.motivoReprovacao ||
                                  'Documento reprovado — exige substituição.',
                              }));
                      if (correctionList.length === 0) return null;
                      return (
                        <ul className="space-y-1.5 pt-2 border-t border-rose-500/30">
                          {correctionList.map((pend) => {
                            const catLabel = pend.categoriaOrganizacional
                              ? CATEGORY_BY_ID[pend.categoriaOrganizacional]?.titulo
                              : 'Documentação da Empresa';
                            const matchingItem = activeDetail.items.find(
                              (it) => it.id === pend.itemId
                            );
                            return (
                              <li
                                key={pend.itemId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-950/60 border border-rose-500/30 px-3 py-2"
                              >
                                <div className="space-y-0.5 min-w-0">
                                  <p className="font-semibold text-rose-100">
                                    <span className="font-mono text-rose-300 mr-1.5">
                                      [{pend.documentoCodigoCanonico}]
                                    </span>
                                    {pend.nomeExibicao}
                                    {pend.colaboradorNome ? ` — ${pend.colaboradorNome}` : ''}
                                  </p>
                                  <p className="text-[11px] text-rose-200/90">
                                    {catLabel} · {pend.motivo}
                                  </p>
                                </div>
                                {canUploadToActive &&
                                  matchingItem &&
                                  matchingItem.status !== 'APROVADO' && (
                                    <button
                                      type="button"
                                      onClick={() => openFilePicker(`item-picker-${pend.itemId}`)}
                                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                                    >
                                      <Upload size={12} /> Substituir agora
                                    </button>
                                  )}
                              </li>
                            );
                          })}
                        </ul>
                      );
                    })()}
                  </div>
                )}

                {activeDetail.integration.status === 'APROVADA' && (
                  <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/30 p-3 text-xs text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span>
                      Integração aprovada por <strong>{activeDetail.integration.aprovadoPorNome}</strong> em{' '}
                      {formatDateTimePt(activeDetail.integration.dataAprovacao)}. Os documentos oficiais estão ativos no motor de conformidade; a execução de atividades críticas continua exigindo Permissão de Trabalho (PT/APR).
                    </span>
                  </div>
                )}
              </div>

              {/* Global Queued Batch Upload Control Panel */}
              {canUploadToActive && (uploadQueue.length > 0 || batchSummary) && (
                <div className="rounded-2xl bg-slate-900 border border-blue-500/40 p-5 space-y-4 shadow-lg shadow-blue-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Upload size={17} className="text-blue-400" />
                        Fila de Envio em Lote ({queueStats.total} arquivo(s) selecionado(s))
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                        Envio individual controlado em fila (PDF, JPG ou PNG até 4 MB/arquivo) ·{' '}
                        <span className="text-slate-200">{queueStats.queued} aguardando</span> ·{' '}
                        <span className="text-blue-300">{queueStats.uploading} enviando</span> ·{' '}
                        <span className="text-emerald-300">{queueStats.success} enviado(s)</span>
                        {queueStats.failed > 0 && (
                          <>
                            {' '}
                            · <span className="text-rose-300 font-semibold">{queueStats.failed} com falha</span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-indigo-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useSmartDocsAi}
                          disabled={isUploadingQueue}
                          onChange={(e) => setUseSmartDocsAi(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        <Sparkles size={13} /> Sugestões SmartDocs IA
                      </label>

                      {queueStats.success > 0 && !isUploadingQueue && (
                        <button
                          type="button"
                          onClick={() =>
                            setUploadQueue((prev) => prev.filter((q) => q.uploadStatus !== 'success'))
                          }
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Limpar Concluídos ({queueStats.success})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Global Progress Bar */}
                  {uploadQueue.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                        <span>Progresso Geral do Lote</span>
                        <span className="font-semibold text-white">{queueStats.globalPercent}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            queueStats.failed > 0 && !isUploadingQueue
                              ? 'bg-amber-500'
                              : queueStats.globalPercent === 100
                              ? 'bg-emerald-500'
                              : 'bg-blue-500'
                          }`}
                          style={{ width: `${queueStats.globalPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Batch Completion Summary Banner */}
                  {batchSummary && !isUploadingQueue && (
                    <div
                      className={`rounded-xl border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                        batchSummary.failed === 0
                          ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200'
                          : 'bg-amber-950/30 border-amber-500/35 text-amber-200'
                      }`}
                    >
                      <span className="font-medium tabular-nums">
                        Resumo do lote: <strong>{batchSummary.succeeded}</strong> de{' '}
                        <strong>{batchSummary.totalProcessed}</strong> arquivo(s) enviado(s) com sucesso
                        {batchSummary.failed > 0
                          ? ` · ${batchSummary.failed} arquivo(s) com falha (os demais permanecem salvos).`
                          : ' · Todos os documentos foram registrados como ENVIADO (aguardando conferência do Admin EHS).'}
                      </span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  {uploadQueue.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                      {queueStats.failed > 0 && (
                        <button
                          type="button"
                          disabled={isUploadingQueue}
                          onClick={() => runQueuedBatchUpload('failed_only')}
                          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {isUploadingQueue ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                          Reenviar Apenas Falhas ({queueStats.failed})
                        </button>
                      )}
                      {queueStats.queued + queueStats.failed > 0 && (
                        <button
                          type="button"
                          disabled={isUploadingQueue}
                          onClick={() => runQueuedBatchUpload('pending', { autoSubmitAfter: false })}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {isUploadingQueue ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Upload size={14} />
                          )}
                          Enviar Fila ({queueStats.queued + queueStats.failed} arquivo(s))
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* SECTION A: DOCUMENTAÇÃO DOS COLABORADORES (4 MANDATORY CATEGORIES + ADICIONAR DOCUMENTOS PER EMPLOYEE) */}
              <div ref={docsSectionRef} id="documentacao-colaboradores" className="space-y-4 scroll-mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                      <Users size={18} className="text-emerald-400" />
                      DOCUMENTAÇÃO DOS COLABORADORES ({groupedItems.colaboradores.length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Selecione e envie todos os documentos de cada colaborador de uma única vez, organizados nas 4 categorias obrigatórias. Todos os arquivos enviados passam por conferência humana do Admin EHS.
                    </p>
                  </div>
                </div>

                {groupedItems.colaboradores.length === 0 ? (
                  <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 text-center text-xs text-slate-400">
                    Nenhum colaborador vinculado a este processo de integração.
                  </div>
                ) : (
                  groupedItems.colaboradores.map((group) => {
                    const employeeQueue = uploadQueue.filter((q) => q.targetOwnerKey === group.key);
                    const employeePendingCount = employeeQueue.filter(
                      (q) => q.uploadStatus === 'queued' || q.uploadStatus === 'failed'
                    ).length;
                    const categorizedSections = groupItemsByMandatoryCategories(group.items);
                    const isDragTarget = dragOverTargetKey === group.key;
                    const approvedCount = group.items.filter((i) => i.status === 'APROVADO').length;
                    const sentCount = group.items.filter((i) => Boolean(i.arquivoNome)).length;
                    const mainPickerKey = `emp-main-${group.key}`;

                    return (
                      <div
                        key={group.key}
                        onDragOver={(e) => {
                          if (!canUploadToActive) return;
                          e.preventDefault();
                          if (dragOverTargetKey !== group.key) {
                            setDragOverTargetKey(group.key);
                          }
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDragOverTargetKey((curr) => (curr === group.key ? null : curr));
                          }
                        }}
                        onDrop={(e) => {
                          if (!canUploadToActive) return;
                          e.preventDefault();
                          setDragOverTargetKey(null);
                          enqueueFilesForTarget(e.dataTransfer.files, {
                            ownerKey: group.key,
                            ownerName: group.nome,
                            categoria: 'colaborador',
                            colaboradorId: group.colaboradorId,
                            colaboradorCandidateId: group.colaboradorCandidateId,
                          });
                        }}
                        className={`rounded-2xl border p-5 space-y-5 transition-colors ${
                          isDragTarget
                            ? 'bg-blue-950/35 border-blue-400 ring-2 ring-blue-500/40'
                            : 'bg-slate-900/70 border-slate-800'
                        }`}
                      >
                        {/* Hidden reliable multi-file input for this collaborator */}
                        {canUploadToActive && (
                          <input
                            ref={(el) => {
                              fileInputRefs.current[mainPickerKey] = el;
                            }}
                            type="file"
                            multiple
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                            className="sr-only"
                            onChange={(ev) => {
                              enqueueFilesForTarget(ev.target.files, {
                                ownerKey: group.key,
                                ownerName: group.nome,
                                categoria: 'colaborador',
                                colaboradorId: group.colaboradorId,
                                colaboradorCandidateId: group.colaboradorCandidateId,
                              });
                              ev.target.value = '';
                            }}
                          />
                        )}

                        {/* Employee Card Header + Prominent ADICIONAR DOCUMENTOS CTA */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-bold text-white">{group.nome}</p>
                              {(() => {
                                const colReadiness = submissionGate.readiness.porColaborador?.find(
                                  (c) =>
                                    (group.colaboradorId && c.colaboradorId === group.colaboradorId) ||
                                    (group.colaboradorCandidateId &&
                                      c.colaboradorCandidateId === group.colaboradorCandidateId) ||
                                    c.colaboradorKey === group.key ||
                                    c.colaboradorNome === group.nome
                                );
                                if (!colReadiness || colReadiness.totalObrigatorios === 0) return null;
                                return colReadiness.completo ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-semibold text-emerald-300 tabular-nums">
                                    <CheckCircle2 size={12} /> Obrigatórios completos ({colReadiness.obrigatoriosConfirmados}/{colReadiness.totalObrigatorios})
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[11px] font-semibold text-amber-300 tabular-nums">
                                    <AlertTriangle size={12} /> Faltam {colReadiness.obrigatoriosPendentes} obrigatório(s) ({colReadiness.obrigatoriosConfirmados}/{colReadiness.totalObrigatorios})
                                  </span>
                                );
                              })()}
                              <span className="text-[11px] text-slate-400 tabular-nums">
                                · {sentCount} enviado(s) · {approvedCount}/{group.items.length} aprovado(s)
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                              {group.cargo || 'Colaborador Terceirizado'}
                              {group.cpf ? ` · CPF: ${group.cpf}` : ''}
                            </p>
                          </div>

                          {canUploadToActive && (
                            <button
                              type="button"
                              onClick={() => openFilePicker(mainPickerKey)}
                              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/20 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <FolderPlus size={15} />
                              <span>ADICIONAR DOCUMENTOS</span>
                            </button>
                          )}
                        </div>

                        {/* Interactive Drag-and-Drop Zone for this Collaborator */}
                        {canUploadToActive && (
                          <button
                            type="button"
                            onClick={() => openFilePicker(mainPickerKey)}
                            className={`w-full block rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors cursor-pointer ${
                              isDragTarget
                                ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                                : 'border-slate-700 bg-slate-950/60 hover:border-blue-500/60 hover:bg-slate-950 text-slate-300'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 text-xs">
                              <Upload size={18} className="text-blue-400 shrink-0" />
                              <span>
                                <strong>Arraste e solte múltiplos arquivos aqui</strong> ou clique para adicionar mais documentos de{' '}
                                <strong className="text-white">{group.nome}</strong> (PDF, JPG ou PNG · até 4 MB por arquivo · seleção aditiva sem perder arquivos anteriores).
                              </span>
                            </div>
                          </button>
                        )}

                        {/* Staged / Queued Files for This Collaborator */}
                        {employeeQueue.length > 0 && (
                          <div className="space-y-2.5 rounded-xl bg-slate-950/80 border border-blue-500/30 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                                <Upload size={13} />
                                Arquivos selecionados para {group.nome} ({employeeQueue.length})
                              </p>
                              <div className="flex items-center gap-2">
                                {employeePendingCount > 0 && (
                                  <button
                                    type="button"
                                    disabled={isUploadingQueue}
                                    onClick={() =>
                                      runQueuedBatchUpload('owner', {
                                        ownerKey: group.key,
                                        autoSubmitAfter: false,
                                      })
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {isUploadingQueue ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Upload size={12} />
                                    )}
                                    Enviar Arquivos ({employeePendingCount})
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {employeeQueue.map((qf) => renderQueuedFileRow(qf, group.items))}
                            </div>
                          </div>
                        )}

                        {/* 4 MANDATORY CATEGORIES IN EXACT ORDER (1 -> 2 -> 3 -> 4) */}
                        <div className="space-y-4">
                          {categorizedSections.map((sectionGroup) => {
                            const catalogSlots = EMPLOYEE_DOCUMENT_CATALOG.filter(
                              (entry) => entry.categoriaId === sectionGroup.category.id
                            );
                            const catPickerKey = `cat-${group.key}-${sectionGroup.category.id}`;
                            return (
                              <div
                                key={sectionGroup.category.id}
                                className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 space-y-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2 pb-2 border-b border-slate-800/80">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                                        {sectionGroup.category.codigoEtiqueta}
                                      </span>
                                      <h4 className="text-xs font-bold uppercase tracking-wide text-white">
                                        {sectionGroup.category.titulo}
                                      </h4>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                      {sectionGroup.category.descricao}
                                    </p>
                                  </div>

                                  {canUploadToActive && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => openFilePicker(catPickerKey)}
                                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                                      >
                                        <Plus size={12} /> Anexar nesta categoria
                                      </button>
                                      <input
                                        ref={(el) => {
                                          fileInputRefs.current[catPickerKey] = el;
                                        }}
                                        type="file"
                                        multiple
                                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                        className="sr-only"
                                        onChange={(ev) => {
                                          enqueueFilesForTarget(ev.target.files, {
                                            ownerKey: group.key,
                                            ownerName: group.nome,
                                            categoria: 'colaborador',
                                            colaboradorId: group.colaboradorId,
                                            colaboradorCandidateId: group.colaboradorCandidateId,
                                            forcedCategoryGroup: sectionGroup.category.id,
                                          });
                                          ev.target.value = '';
                                        }}
                                      />
                                    </>
                                  )}
                                </div>

                                {/* Standard Document Slots Reference for This Category */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {catalogSlots.map((slot) => {
                                    const slotPickerKey = `slot-${group.key}-${slot.codigoCanonico}`;
                                    const matchingCount = sectionGroup.items.filter(
                                      (it) =>
                                        it.documentoCodigoCanonico.toUpperCase() ===
                                          slot.codigoCanonico.toUpperCase() ||
                                        (slot.codigoCanonico === 'ASO' && it.origemColecao === 'exams') ||
                                        (slot.codigoCanonico === 'FICHA_EPI' &&
                                          it.origemColecao === 'epiDeliveries') ||
                                        (slot.codigoCanonico === 'TREINAMENTO_OBRIGATORIO' &&
                                          it.origemColecao === 'trainings')
                                    ).length;

                                    return (
                                      <div
                                        key={slot.codigoCanonico}
                                        className="rounded-lg bg-slate-900/70 border border-slate-800/90 px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                                      >
                                        <div className="min-w-0">
                                          <p className="font-semibold text-slate-200 truncate" title={slot.nomeExibicao}>
                                            {slot.ordem}. {slot.nomeExibicao}
                                          </p>
                                          <p className="text-[10px] text-slate-500 truncate">
                                            {matchingCount > 0
                                              ? `${matchingCount} item(ns) listado(s) abaixo`
                                              : slot.descricaoCurta}
                                          </p>
                                        </div>
                                        {canUploadToActive && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => openFilePicker(slotPickerKey)}
                                              className="px-2 py-1 rounded bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                                            >
                                              + Anexar
                                            </button>
                                            <input
                                              ref={(el) => {
                                                fileInputRefs.current[slotPickerKey] = el;
                                              }}
                                              type="file"
                                              multiple
                                              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                              className="sr-only"
                                              onChange={(ev) => {
                                                enqueueFilesForTarget(ev.target.files, {
                                                  ownerKey: group.key,
                                                  ownerName: group.nome,
                                                  categoria: 'colaborador',
                                                  colaboradorId: group.colaboradorId,
                                                  colaboradorCandidateId: group.colaboradorCandidateId,
                                                  forcedCatalogCode: slot.codigoCanonico,
                                                  forcedCategoryGroup: sectionGroup.category.id,
                                                });
                                                ev.target.value = '';
                                              }}
                                            />
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Checklist & Uploaded Items in this Category */}
                                {sectionGroup.items.length > 0 && (
                                  <div className="space-y-2.5 pt-1">
                                    {sectionGroup.items.map((it) => renderItemCard(it, group.key))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* SECTION B: DOCUMENTAÇÃO DA EMPRESA */}
              <div
                onDragOver={(e) => {
                  if (!canUploadToActive) return;
                  e.preventDefault();
                  if (dragOverTargetKey !== 'empresa') setDragOverTargetKey('empresa');
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverTargetKey((curr) => (curr === 'empresa' ? null : curr));
                  }
                }}
                onDrop={(e) => {
                  if (!canUploadToActive) return;
                  e.preventDefault();
                  setDragOverTargetKey(null);
                  enqueueFilesForTarget(e.dataTransfer.files, {
                    ownerKey: 'empresa',
                    ownerName: activeDetail.integration.empresaNome,
                    categoria: 'empresa',
                  });
                }}
                className={`rounded-2xl border p-5 space-y-4 transition-colors ${
                  dragOverTargetKey === 'empresa'
                    ? 'bg-blue-950/35 border-blue-400 ring-2 ring-blue-500/40'
                    : 'bg-slate-900/60 border-slate-800'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                      <Building2 size={16} className="text-blue-400" />
                      Documentação da Empresa ({groupedItems.empresa.length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      PGR, PCMSO, contrato social e demais documentos corporativos exigidos pela Matriz.
                    </p>
                  </div>

                  {canUploadToActive && (
                    <>
                      <button
                        type="button"
                        onClick={() => openFilePicker('company-docs-main')}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-300 text-xs font-bold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <FolderPlus size={14} />
                        <span>ADICIONAR DOCUMENTOS DA EMPRESA</span>
                      </button>
                      <input
                        ref={(el) => {
                          fileInputRefs.current['company-docs-main'] = el;
                        }}
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        className="sr-only"
                        onChange={(ev) => {
                          enqueueFilesForTarget(ev.target.files, {
                            ownerKey: 'empresa',
                            ownerName: activeDetail.integration.empresaNome,
                            categoria: 'empresa',
                          });
                          ev.target.value = '';
                        }}
                      />
                    </>
                  )}
                </div>

                {uploadQueue.filter((q) => q.targetOwnerKey === 'empresa').length > 0 && (
                  <div className="space-y-2 rounded-xl bg-slate-950/80 border border-blue-500/30 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-blue-300">
                        Arquivos da empresa na fila ({uploadQueue.filter((q) => q.targetOwnerKey === 'empresa').length})
                      </p>
                      {uploadQueue.filter(
                        (q) =>
                          q.targetOwnerKey === 'empresa' &&
                          (q.uploadStatus === 'queued' || q.uploadStatus === 'failed')
                      ).length > 0 && (
                        <button
                          type="button"
                          disabled={isUploadingQueue}
                          onClick={() =>
                            runQueuedBatchUpload('owner', {
                              ownerKey: 'empresa',
                              autoSubmitAfter: false,
                            })
                          }
                          className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Upload size={12} /> Enviar Arquivos da Empresa
                        </button>
                      )}
                    </div>
                    {uploadQueue
                      .filter((q) => q.targetOwnerKey === 'empresa')
                      .map((qf) => renderQueuedFileRow(qf, groupedItems.empresa))}
                  </div>
                )}

                {groupedItems.empresa.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Nenhum documento corporativo obrigatório pendente para esta integração. Você pode anexar documentos complementares acima se necessário.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {groupedItems.empresa.map((it) => renderItemCard(it, 'empresa'))}
                  </div>
                )}
              </div>

              {/* Strict Completion & Final Submission Gate */}
              {canUploadToActive && (
                <div
                  className={`rounded-2xl border p-5 space-y-4 ${
                    submissionGate.canFinalizeAndSubmit
                      ? 'bg-emerald-950/20 border-emerald-500/40'
                      : 'bg-slate-900 border-amber-500/40'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {submissionGate.canFinalizeAndSubmit ? (
                          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                        ) : (
                          <Lock size={17} className="text-amber-400 shrink-0" />
                        )}
                        <h3 className="text-sm font-bold text-white uppercase tracking-wide">
                          {submissionGate.canFinalizeAndSubmit
                            ? 'Documentação Obrigatória Completa — Pronto para Submissão'
                            : 'Submissão Bloqueada — Pendências Documentais Obrigatórias'}
                        </h3>
                      </div>

                      <p className="text-xs text-slate-300">
                        {activeDetail.integration.status === 'PENDENTE_CORRECAO'
                          ? 'Substitua todos os documentos reprovados ou pendentes obrigatórios antes de reenviar. Documentos já aprovados pelo Admin EHS permanecem preservados.'
                          : 'O cadastro inicial só é liberado para conferência do Admin EHS quando 100% dos documentos obrigatórios da Matriz de Atividades estiverem anexados e confirmados no armazenamento seguro. Documentos opcionais não bloqueiam a submissão.'}
                      </p>

                      {/* Mandatory Progress Bar */}
                      <div className="pt-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                          <span className="text-slate-300 font-semibold">
                            Obrigatórios confirmados:{' '}
                            <strong
                              className={
                                submissionGate.readiness.podeSubmeter
                                  ? 'text-emerald-300'
                                  : 'text-amber-300'
                              }
                            >
                              {submissionGate.readiness.obrigatoriosConfirmados}/
                              {submissionGate.readiness.totalObrigatorios}
                            </strong>
                            {submissionGate.readiness.totalOpcionais > 0 && (
                              <span className="text-slate-400 font-normal ml-2">
                                · Opcionais enviados: {submissionGate.readiness.opcionaisEnviados}/
                                {submissionGate.readiness.totalOpcionais} (não bloqueantes)
                              </span>
                            )}
                          </span>
                          <span className="font-bold text-white">
                            {submissionGate.mandatoryProgressPercent}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              submissionGate.canFinalizeAndSubmit
                                ? 'bg-emerald-500'
                                : 'bg-amber-500'
                            }`}
                            style={{ width: `${submissionGate.mandatoryProgressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={!submissionGate.canFinalizeAndSubmit}
                        onClick={handleSubmitIntegration}
                        className={`px-5 py-3 rounded-xl text-xs font-extrabold uppercase tracking-wide flex items-center gap-2 transition-colors whitespace-nowrap ${
                          submissionGate.canFinalizeAndSubmit
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-lg shadow-emerald-950/40'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-75'
                        }`}
                      >
                        {busy ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : submissionGate.canFinalizeAndSubmit ? (
                          <Send size={15} />
                        ) : (
                          <Lock size={15} />
                        )}
                        FINALIZAR CADASTRO E ENVIAR PARA APROVAÇÃO
                      </button>
                      <span className="text-[11px] text-slate-400">
                        {submissionGate.canFinalizeAndSubmit
                          ? 'Validação completa no servidor · Aprovação exclusiva do Admin EHS'
                          : 'Anexe e confirme todos os itens obrigatórios para habilitar'}
                      </span>
                    </div>
                  </div>

                  {/* Queue Pending/Failed Warning */}
                  {submissionGate.hasPendingQueueUploads && (
                    <div className="rounded-xl bg-amber-950/35 border border-amber-500/35 px-3.5 py-2.5 text-xs text-amber-200 flex items-center gap-2">
                      <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                      <span>
                        Existem arquivos pendentes, em envio ou com falha na <strong>Fila de Envio em Lote</strong> ({queueStats.queued} aguardando, {queueStats.uploading} enviando, {queueStats.failed} com falha). Conclua ou reenvie a fila antes de finalizar o cadastro.
                      </span>
                    </div>
                  )}

                  {/* Exact Missing/Pending Mandatory Items List */}
                  {submissionGate.readiness.pendenciasObrigatorias.length > 0 && (
                    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-2">
                      <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle size={14} className="shrink-0" />
                        Documentos obrigatórios pendentes ({submissionGate.readiness.pendenciasObrigatorias.length}):
                      </p>
                      <ul className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                        {submissionGate.readiness.pendenciasObrigatorias.map((pend) => {
                          const catLabel = pend.categoriaOrganizacional
                            ? CATEGORY_BY_ID[pend.categoriaOrganizacional]?.titulo
                            : 'Documentação da Empresa';
                          return (
                            <li
                              key={pend.itemId}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <span className="font-mono text-[11px] text-amber-300 mr-1.5">
                                  [{pend.documentoCodigoCanonico}]
                                </span>
                                <span className="font-semibold text-white">{pend.nomeExibicao}</span>
                                {pend.colaboradorNome && (
                                  <span className="text-slate-400"> · {pend.colaboradorNome}</span>
                                )}
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  {catLabel} — <span className="text-amber-200/90">{pend.motivo}</span>
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openFilePicker(`item-picker-${pend.itemId}`)}
                                className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                              >
                                <Upload size={11} /> Anexar
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Audit Trail Toggle */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <button
                  type="button"
                  onClick={() => setShowAuditTrail(!showAuditTrail)}
                  className="w-full flex items-center justify-between text-xs font-bold text-slate-300 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <History size={15} className="text-blue-400" />
                    Trilha de Auditoria do Processo ({activeDetail.integration.historicoWorkflow.length} evento(s))
                  </span>
                  {showAuditTrail ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {showAuditTrail && (
                  <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                    {activeDetail.integration.historicoWorkflow.map((ev, idx) => (
                      <div key={idx} className="text-xs bg-slate-950/70 rounded-lg px-3 py-2 border border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-white">{ev.acao}</span>
                          <span className="text-slate-400">{formatDateTimePt(ev.dataHora)}</span>
                        </div>
                        <p className="text-slate-300 mt-0.5">{ev.detalhes}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Usuário: {ev.usuarioNome} ({ev.usuarioRole})
                          {ev.justificativa ? ` • Justificativa: ${ev.justificativa}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* List of Integrations */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[240px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por protocolo, empresa ou CNPJ..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white"
                >
                  <option value="ALL">Todos os status</option>
                  {Object.entries(INTEGRATION_STATUS_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {integrationFirestoreError && (
                <div className="rounded-xl bg-amber-950/35 border border-amber-500/40 p-4 text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-amber-300">
                      Dependência de Infraestrutura Firestore (Listagem de Integrações)
                    </p>
                    <p>{integrationFirestoreError}</p>
                  </div>
                </div>
              )}

              {visibleIntegrations.length === 0 ? (
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center space-y-2">
                  <Layers size={32} className="mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">
                    Nenhuma integração encontrada.
                  </p>
                  <p className="text-xs text-slate-500">
                    {isAuditor
                      ? 'Nenhum processo de integração foi registrado até o momento.'
                      : 'Clique em "Nova Integração / Atualização" para iniciar o envio centralizado de documentos.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {visibleIntegrations.map((integ: ContractorIntegration) => (
                    <div
                      key={integ.id}
                      className="rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-400">
                            {integ.codigoProtocolo}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${
                              INTEGRATION_STATUS_META[integ.status].badgeClass
                            }`}
                          >
                            {INTEGRATION_STATUS_META[integ.status].label}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {integ.tipo === 'ATUALIZACAO_DOCUMENTAL'
                              ? 'Atualização Documental'
                              : 'Integração Inicial'}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-white truncate">{integ.empresaNome}</p>
                        <p className="text-xs text-slate-400">
                          CNPJ: {integ.empresaCnpj} • {integ.colaboradoresCandidatos?.length || 0} colaborador(es) • Atualizado em{' '}
                          {formatDateTimePt(integ.dataUltimaAtualizacao)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            {integ.resumoItens?.aprovados || 0} aprov.
                          </span>
                          <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            {(integ.resumoItens?.pendentesEnvio || 0) +
                              (integ.resumoItens?.enviados || 0) +
                              (integ.resumoItens?.emAnalise || 0)}{' '}
                            pend.
                          </span>
                          {(integ.resumoItens?.reprovados || 0) > 0 && (
                            <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/20">
                              {integ.resumoItens.reprovados} reprov.
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => openIntegrationDetail(integ.id)}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          {integ.status === 'PENDENTE_CORRECAO' && !isAuditor
                            ? 'Corrigir Pendências'
                            : 'Abrir Integração'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Renewal Modal */}
      {renewingItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <RefreshCw size={17} className="text-sky-400" />
                  Renovar / Enviar Nova Versão
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {renewingItem.nomeExibicao} (v{renewingItem.versaoAtual} preservada no histórico)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRenewingItem(null);
                  setRenewFileData(null);
                }}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Fechar
              </button>
            </div>

            <div className="rounded-xl bg-sky-950/30 border border-sky-500/30 p-3 text-xs text-sky-200">
              A versão anterior permanece registrada e ativa no motor de conformidade até que o Administrador EHS aprove esta nova versão.
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-300 mb-1">
                  Novo Arquivo (PDF, JPG ou PNG até 4 MB) *
                </span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const base64 = await readFileAsDataUrl(file);
                    setRenewFileData({
                      arquivoNome: file.name,
                      arquivoBase64: base64,
                      sizeBytes: file.size,
                      dataEmissao: new Date().toISOString().slice(0, 10),
                      dataValidade: '',
                      semValidade: false,
                      conclusaoAso: 'apto',
                      observacoes: '',
                    });
                  }}
                  className="w-full text-xs text-slate-300"
                />
              </label>

              {renewFileData && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    Arquivo selecionado: <strong className="text-white">{renewFileData.arquivoNome}</strong> ({formatFileSize(renewFileData.sizeBytes)})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Data de Emissão</label>
                      <input
                        type="date"
                        value={renewFileData.dataEmissao}
                        onChange={(e) =>
                          setRenewFileData({ ...renewFileData, dataEmissao: e.target.value })
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Data de Validade</label>
                      <input
                        type="date"
                        value={renewFileData.dataValidade}
                        disabled={renewFileData.semValidade}
                        onChange={(e) =>
                          setRenewFileData({ ...renewFileData, dataValidade: e.target.value })
                        }
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRenewingItem(null);
                  setRenewFileData(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!renewFileData || busy}
                onClick={handleRenewItemSubmit}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Enviar Nova Versão para Análise
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Protected Document Preview Modal (Solicitante) */}
      {previewDoc && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[86vh] rounded-2xl bg-slate-900 border border-slate-700 flex flex-col overflow-hidden">
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
                  <Download size={13} /> Baixar
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
