import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  FileWarning,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Edit2,
  X,
  Building2,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Users,
  Send,
  Play,
  FileText,
  XCircle,
  Ban,
  CheckSquare,
  RefreshCw,
  Paperclip,
  Upload,
  ExternalLink,
  History,
  Lock,
  Eye,
  Wrench,
  FilePlus2,
  Info,
} from 'lucide-react';
import {
  useSST,
  PermitApiClientError,
  PermitServerDraftInput,
  PermitServerEvaluationResult,
} from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import {
  OperationalControlAttachmentType,
  SafetyPermit,
  SafetyPermitControlAttachment,
  SafetyPermitStatus,
  SafetyPermitType,
} from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';
import { evaluateActivityCompliance } from '../../utils/activityComplianceEngine';
import { ComplianceChecklistPanel } from './ComplianceChecklistPanel';

type WorkflowActionType =
  | 'submit'
  | 'start-review'
  | 'request-docs'
  | 'request-correction'
  | 'approve'
  | 'release'
  | 'reject'
  | 'cancel'
  | 'close';

interface StatusMeta {
  label: string;
  badgeClass: string;
}

const PERMIT_STATUS_META: Record<SafetyPermitStatus, StatusMeta> = {
  elaboracao: {
    label: 'Rascunho / Elaboração',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
  },
  pendente_liberacao: {
    label: 'Aguardando Análise',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  em_analise: {
    label: 'Em Análise EHS',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  pendente_documentacao: {
    label: 'Pendente Documentação',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  pendente_correcao: {
    label: 'Pendente Correção',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  aprovado: {
    label: 'Aprovado (Aguard. Liberação)',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  liberado: {
    label: 'Liberado p/ Execução',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  em_execucao: {
    label: 'Em Execução (Legado)',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  reprovado: {
    label: 'Reprovado',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  cancelado: {
    label: 'Cancelado',
    badgeClass: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
  encerrado: {
    label: 'Encerrado',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
};

const EDITABLE_STATUSES: SafetyPermitStatus[] = [
  'elaboracao',
  'pendente_documentacao',
  'pendente_correcao',
];

const SOLICITANTE_CANCELABLE_STATUSES: SafetyPermitStatus[] = [
  'elaboracao',
  'pendente_liberacao',
  'pendente_documentacao',
  'pendente_correcao',
];

const CONTROL_TYPES: OperationalControlAttachmentType[] = ['APR', 'PT', 'LOTO', 'PET'];

interface DraftFormState {
  tipo: SafetyPermitType;
  titulo: string;
  descricaoServico: string;
  empresaId: string;
  localTrabalho: string;
  dataInicio: string;
  dataFim: string;
  responsavelEmissao: string;
  responsavelAtividade: string;
  riscosIdentificados: string;
  medidasPreventivas: string;
  observacoes: string;
  anexoUrl: string;
  atividadeIds: string[];
  colaboradorIds: string[];
  anexosControles: SafetyPermitControlAttachment[];
}

function createEmptyDraft(defaultEmpresaId: string, defaultResponsavel: string, tipo: SafetyPermitType = 'PT'): DraftFormState {
  const today = new Date().toISOString().split('T')[0];
  return {
    tipo,
    titulo: '',
    descricaoServico: '',
    empresaId: defaultEmpresaId,
    localTrabalho: '',
    dataInicio: today,
    dataFim: today,
    responsavelEmissao: defaultResponsavel,
    responsavelAtividade: '',
    riscosIdentificados: '',
    medidasPreventivas: '',
    observacoes: '',
    anexoUrl: '',
    atividadeIds: [],
    colaboradorIds: [],
    anexosControles: [],
  };
}

export const PermitsView: React.FC = () => {
  const {
    safetyPermits,
    companies,
    employees,
    documents,
    trainings,
    exams,
    epiDeliveries,
    activityProfiles,
    activityDocumentRequirements,
    smartDocs,
    createPermitDraftOnServer,
    updatePermitDraftOnServer,
    evaluatePermitOnServer,
    submitPermitOnServer,
    startPermitReviewOnServer,
    requestPermitDocsOnServer,
    requestPermitCorrectionOnServer,
    approvePermitOnServer,
    releasePermitOnServer,
    rejectPermitOnServer,
    cancelPermitOnServer,
    closePermitOnServer,
  } = useSST();

  const { isAdmin, isSolicitante, isAuditor, activeEmpresaId, profile } = useAuth();
  const canCreateOrEdit = isAdmin || isSolicitante;

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'todos' | SafetyPermitType>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | SafetyPermitStatus>('todos');
  const [companyFilter, setCompanyFilter] = useState<string>('todas');

  // Global inline feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create / Edit Modal
  const [isDraftModalOpen, setIsDraftModalOpen] = useState(false);
  const [editingPermit, setEditingPermit] = useState<SafetyPermit | null>(null);
  const [draftForm, setDraftForm] = useState<DraftFormState>(() =>
    createEmptyDraft(activeEmpresaId || '', profile?.nome || '')
  );
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftErrorDetails, setDraftErrorDetails] = useState<string[]>([]);

  // Attachment helper inside Draft Modal
  const [newAttachmentType, setNewAttachmentType] = useState<OperationalControlAttachmentType>('APR');
  const [newAttachmentName, setNewAttachmentName] = useState('');
  const [newAttachmentUrl, setNewAttachmentUrl] = useState('');

  // Analysis & Release Modal
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'checklist' | 'controles' | 'historico'>('checklist');
  const [serverEvaluation, setServerEvaluation] = useState<PermitServerEvaluationResult | null>(null);
  const [evaluatingServer, setEvaluatingServer] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailErrorReasons, setDetailErrorReasons] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Action Confirmation / Justification Modal
  const [pendingAction, setPendingAction] = useState<{
    type: WorkflowActionType;
    title: string;
    description: string;
    requireJustification: boolean;
    confirmLabel: string;
    confirmTone: 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
  } | null>(null);
  const [actionJustification, setActionJustification] = useState('');

  // Active catalogs (strictly third-party companies & active activities)
  const activeCompanies = useMemo(() => {
    const base = companies.filter((c) => c.situacao === 'ativa');
    if (isSolicitante && activeEmpresaId) {
      return base.filter((c) => c.id === activeEmpresaId);
    }
    return base;
  }, [companies, isSolicitante, activeEmpresaId]);

  const activeActivities = useMemo(
    () => activityProfiles.filter((a) => a.ativo),
    [activityProfiles]
  );

  // Active third-party employees strictly belonging to the selected company
  const eligibleEmployeesForDraft = useMemo(() => {
    if (!draftForm.empresaId) return [];
    return employees.filter(
      (emp) => emp.empresaId === draftForm.empresaId && emp.situacaoCadastral === 'ativo'
    );
  }, [employees, draftForm.empresaId]);

  // Auto-calculated operational controls from selected activities in Draft Modal
  const draftOperationalControls = useMemo(() => {
    const selected = activityProfiles.filter((a) => draftForm.atividadeIds.includes(a.id));
    return {
      exigeAPR: selected.some((a) => a.exigeAPR),
      exigePT: selected.some((a) => a.exigePT),
      exigeLOTO: selected.some((a) => a.exigeLOTO),
      exigePET: selected.some((a) => Boolean(a.exigePET)),
    };
  }, [activityProfiles, draftForm.atividadeIds]);

  // Live local compliance PREVIEW inside Draft Modal (strictly informational; server enforces official gate)
  const draftCompliancePreview = useMemo(() => {
    if (!isDraftModalOpen || !draftForm.empresaId || draftForm.atividadeIds.length === 0) {
      return null;
    }
    const company = companies.find((c) => c.id === draftForm.empresaId);
    if (!company) return null;

    return evaluateActivityCompliance({
      company,
      atividadeIds: draftForm.atividadeIds,
      colaboradorIds: draftForm.colaboradorIds,
      dataReferenciaAtividade: draftForm.dataInicio || undefined,
      dataFimAtividade: draftForm.dataFim || undefined,
      activityProfiles,
      requirements: activityDocumentRequirements,
      employees,
      documents,
      trainings,
      exams,
      epiDeliveries,
      safetyPermits,
      smartDocs,
      permitAtualId: editingPermit?.id,
    });
  }, [
    isDraftModalOpen,
    draftForm.empresaId,
    draftForm.atividadeIds,
    draftForm.colaboradorIds,
    draftForm.dataInicio,
    draftForm.dataFim,
    companies,
    activityProfiles,
    activityDocumentRequirements,
    employees,
    documents,
    trainings,
    exams,
    epiDeliveries,
    safetyPermits,
    smartDocs,
    editingPermit?.id,
  ]);

  // Scoped & filtered permits list
  const scopedPermits = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return safetyPermits.filter((p) => p.empresaId === activeEmpresaId);
    }
    return safetyPermits;
  }, [safetyPermits, isSolicitante, activeEmpresaId]);

  const filteredPermits = useMemo(() => {
    let list = scopedPermits;
    if (companyFilter !== 'todas') {
      list = list.filter((p) => p.empresaId === companyFilter);
    }
    if (typeFilter !== 'todos') {
      list = list.filter((p) => p.tipo === typeFilter);
    }
    if (statusFilter !== 'todos') {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (p) =>
          p.titulo.toLowerCase().includes(q) ||
          p.localTrabalho.toLowerCase().includes(q) ||
          p.empresaNome.toLowerCase().includes(q) ||
          (p.atividadeNomes || []).some((a) => a.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const da = a.updatedAt || a.createdAt || a.dataInicio || '';
      const db = b.updatedAt || b.createdAt || b.dataInicio || '';
      return db.localeCompare(da);
    });
  }, [scopedPermits, companyFilter, typeFilter, statusFilter, searchTerm]);

  // KPIs
  const kpis = useMemo(() => {
    const emFluxo = scopedPermits.filter((p) =>
      ['pendente_liberacao', 'em_analise', 'pendente_documentacao', 'pendente_correcao'].includes(
        p.status
      )
    ).length;
    const aprovadas = scopedPermits.filter((p) => p.status === 'aprovado').length;
    const liberadas = scopedPermits.filter(
      (p) => p.status === 'liberado' || p.status === 'em_execucao'
    ).length;
    const bloqueadas = scopedPermits.filter(
      (p) =>
        p.statusConformidade === 'bloqueado' &&
        !['cancelado', 'encerrado', 'reprovado'].includes(p.status)
    ).length;
    return { total: scopedPermits.length, emFluxo, aprovadas, liberadas, bloqueadas };
  }, [scopedPermits]);

  // Currently opened permit from live Firestore state or latest server evaluation
  const selectedPermit = useMemo(() => {
    if (!selectedPermitId) return null;
    const live = safetyPermits.find((p) => p.id === selectedPermitId);
    if (live) return live;
    if (serverEvaluation?.permit.id === selectedPermitId) return serverEvaluation.permit;
    return null;
  }, [selectedPermitId, safetyPermits, serverEvaluation]);

  const runServerEvaluation = useCallback(
    async (permitId: string) => {
      setEvaluatingServer(true);
      setDetailError(null);
      setDetailErrorReasons([]);
      try {
        const result = await evaluatePermitOnServer(permitId);
        setServerEvaluation(result);
      } catch (err) {
        const apiErr = err as PermitApiClientError;
        setDetailError(
          apiErr?.message || 'Não foi possível executar a validação oficial de conformidade no servidor.'
        );
        if (apiErr?.motivosBloqueio) setDetailErrorReasons(apiErr.motivosBloqueio);
        else if (apiErr?.errors) setDetailErrorReasons(apiErr.errors);
      } finally {
        setEvaluatingServer(false);
      }
    },
    [evaluatePermitOnServer]
  );

  useEffect(() => {
    if (selectedPermitId) {
      setDetailTab('checklist');
      setServerEvaluation(null);
      runServerEvaluation(selectedPermitId);
    }
  }, [selectedPermitId, runServerEvaluation]);

  const handleOpenCreateModal = (defaultType: SafetyPermitType = 'PT') => {
    if (!canCreateOrEdit) return;
    setEditingPermit(null);
    setDraftError(null);
    setDraftErrorDetails([]);
    const defaultEmpId =
      isSolicitante && activeEmpresaId
        ? activeEmpresaId
        : activeCompanies[0]?.id || '';
    setDraftForm(createEmptyDraft(defaultEmpId, profile?.nome || '', defaultType));
    setNewAttachmentName('');
    setNewAttachmentUrl('');
    setIsDraftModalOpen(true);
  };

  const handleOpenEditModal = (permit: SafetyPermit) => {
    if (!canCreateOrEdit) return;
    if (!EDITABLE_STATUSES.includes(permit.status)) return;
    setEditingPermit(permit);
    setDraftError(null);
    setDraftErrorDetails([]);
    setDraftForm({
      tipo: permit.tipo,
      titulo: permit.titulo,
      descricaoServico: permit.descricaoServico || '',
      empresaId: permit.empresaId,
      localTrabalho: permit.localTrabalho,
      dataInicio: permit.dataInicio || '',
      dataFim: permit.dataFim || '',
      responsavelEmissao: permit.responsavelEmissao || profile?.nome || '',
      responsavelAtividade: permit.responsavelAtividade || '',
      riscosIdentificados: permit.riscosIdentificados || '',
      medidasPreventivas: permit.medidasPreventivas || '',
      observacoes: permit.observacoes || '',
      anexoUrl: permit.anexoUrl || '',
      atividadeIds: [...(permit.atividadeIds || [])],
      colaboradorIds: [...(permit.colaboradorIds || [])],
      anexosControles: [...(permit.anexosControles || [])],
    });
    setNewAttachmentName('');
    setNewAttachmentUrl('');
    setIsDraftModalOpen(true);
  };

  const toggleDraftActivity = (actId: string) => {
    setDraftForm((prev) => {
      const exists = prev.atividadeIds.includes(actId);
      return {
        ...prev,
        atividadeIds: exists
          ? prev.atividadeIds.filter((id) => id !== actId)
          : [...prev.atividadeIds, actId],
      };
    });
  };

  const toggleDraftEmployee = (empId: string) => {
    setDraftForm((prev) => {
      const exists = prev.colaboradorIds.includes(empId);
      return {
        ...prev,
        colaboradorIds: exists
          ? prev.colaboradorIds.filter((id) => id !== empId)
          : [...prev.colaboradorIds, empId],
      };
    });
  };

  const handleAddControlAttachmentUrl = () => {
    if (!newAttachmentName.trim() || !newAttachmentUrl.trim()) {
      setDraftError('Informe o nome e o link/arquivo do controle operacional antes de anexar.');
      return;
    }
    const newItem: SafetyPermitControlAttachment = {
      tipo: newAttachmentType,
      nomeArquivo: newAttachmentName.trim(),
      url: newAttachmentUrl.trim(),
      enviadoEm: new Date().toISOString(),
      enviadoPorNome: profile?.nome || 'Usuário',
    };
    setDraftForm((prev) => ({
      ...prev,
      anexosControles: [...prev.anexosControles, newItem],
    }));
    setNewAttachmentName('');
    setNewAttachmentUrl('');
    setDraftError(null);
  };

  const handleControlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setDraftError('O anexo de controle operacional deve ter no máximo 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const newItem: SafetyPermitControlAttachment = {
        tipo: newAttachmentType,
        nomeArquivo: newAttachmentName.trim() || file.name,
        url: dataUrl,
        enviadoEm: new Date().toISOString(),
        enviadoPorNome: profile?.nome || 'Usuário',
      };
      setDraftForm((prev) => ({
        ...prev,
        anexosControles: [...prev.anexosControles, newItem],
      }));
      setNewAttachmentName('');
      setNewAttachmentUrl('');
      setDraftError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveControlAttachment = (indexToRemove: number) => {
    setDraftForm((prev) => ({
      ...prev,
      anexosControles: prev.anexosControles.filter((_, idx) => idx !== indexToRemove),
    }));
  };

  const handleSaveDraft = async (submitAfterSave: boolean) => {
    setDraftError(null);
    setDraftErrorDetails([]);

    if (!draftForm.titulo.trim() || !draftForm.empresaId || !draftForm.localTrabalho.trim()) {
      setDraftError('Preencha Título, Empresa Contratada e Local de Trabalho.');
      return;
    }
    if (draftForm.atividadeIds.length === 0) {
      setDraftError('Selecione ao menos uma atividade crítica para vincular os requisitos obrigatórios.');
      return;
    }
    if (draftForm.colaboradorIds.length === 0) {
      setDraftError('Selecione ao menos um colaborador terceirizado ativo vinculado à empresa contratada.');
      return;
    }

    const payload: PermitServerDraftInput = {
      tipo: draftForm.tipo,
      titulo: draftForm.titulo.trim(),
      descricaoServico: draftForm.descricaoServico.trim(),
      empresaId: draftForm.empresaId,
      localTrabalho: draftForm.localTrabalho.trim(),
      dataInicio: draftForm.dataInicio,
      dataFim: draftForm.dataFim,
      responsavelEmissao: draftForm.responsavelEmissao.trim(),
      responsavelAtividade: draftForm.responsavelAtividade.trim(),
      riscosIdentificados: draftForm.riscosIdentificados.trim(),
      medidasPreventivas: draftForm.medidasPreventivas.trim(),
      observacoes: draftForm.observacoes.trim(),
      anexoUrl: draftForm.anexoUrl.trim(),
      atividadeIds: draftForm.atividadeIds,
      colaboradorIds: draftForm.colaboradorIds,
      anexosControles: draftForm.anexosControles,
      ...(editingPermit?.versaoConcorrencia
        ? { expectedVersion: editingPermit.versaoConcorrencia }
        : {}),
    };

    setDraftSubmitting(true);
    try {
      let savedPermit: SafetyPermit;
      if (editingPermit) {
        const res = await updatePermitDraftOnServer(editingPermit.id, payload);
        savedPermit = res.permit;
      } else {
        const res = await createPermitDraftOnServer(payload);
        savedPermit = res.permit;
      }

      if (submitAfterSave) {
        const submitted = await submitPermitOnServer(savedPermit.id, {
          expectedVersion: savedPermit.versaoConcorrencia,
        });
        savedPermit = submitted.permit;
      }

      setIsDraftModalOpen(false);
      setFeedback({
        type: 'success',
        message: submitAfterSave
          ? `Solicitação "${savedPermit.titulo}" salva e enviada para análise oficial do EHS.`
          : `Rascunho "${savedPermit.titulo}" salvo com validação do servidor.`,
      });
      setSelectedPermitId(savedPermit.id);
    } catch (err) {
      const apiErr = err as PermitApiClientError;
      setDraftError(apiErr?.message || 'Erro ao salvar solicitação no servidor.');
      if (apiErr?.errors && apiErr.errors.length > 0) {
        setDraftErrorDetails(apiErr.errors);
      } else if (apiErr?.motivosBloqueio && apiErr.motivosBloqueio.length > 0) {
        setDraftErrorDetails(apiErr.motivosBloqueio);
      }
    } finally {
      setDraftSubmitting(false);
    }
  };

  const openActionDialog = (action: WorkflowActionType) => {
    setActionJustification('');
    setDetailError(null);
    setDetailErrorReasons([]);

    const configs: Record<
      WorkflowActionType,
      {
        title: string;
        description: string;
        requireJustification: boolean;
        confirmLabel: string;
        confirmTone: 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
      }
    > = {
      submit: {
        title: 'Enviar Solicitação para Análise EHS',
        description:
          'A solicitação será validada no servidor e encaminhada à fila de análise do Administrador EHS.',
        requireJustification: false,
        confirmLabel: 'Confirmar Envio',
        confirmTone: 'blue',
      },
      'start-review': {
        title: 'Iniciar Análise Técnica EHS',
        description:
          'Marca oficialmente o início da análise documental pelo Administrador EHS.',
        requireJustification: false,
        confirmLabel: 'Iniciar Análise',
        confirmTone: 'blue',
      },
      'request-docs': {
        title: 'Solicitar Documentação Complementar',
        description:
          'Retorna a solicitação para a contratada com status "Pendente Documentação" para regularização.',
        requireJustification: true,
        confirmLabel: 'Solicitar Documentação',
        confirmTone: 'amber',
      },
      'request-correction': {
        title: 'Solicitar Correção de Dados / Controles',
        description:
          'Retorna a solicitação para ajustes cadastrais, de escopo ou controles operacionais.',
        requireJustification: true,
        confirmLabel: 'Solicitar Correção',
        confirmTone: 'amber',
      },
      approve: {
        title: 'Aprovar Solicitação (Etapa 1 de 2)',
        description:
          'O servidor revalidará 100% dos requisitos obrigatórios antes de registrar a aprovação. A execução só será autorizada após a Liberação Oficial.',
        requireJustification: false,
        confirmLabel: 'Confirmar Aprovação',
        confirmTone: 'blue',
      },
      release: {
        title: 'Liberar Execução da Atividade (Etapa 2 de 2)',
        description:
          'O servidor revalidará toda a documentação e o fingerprint de conformidade. Qualquer alteração concorrente após a aprovação bloqueará a liberação.',
        requireJustification: false,
        confirmLabel: 'Confirmar Liberação Oficial',
        confirmTone: 'emerald',
      },
      reject: {
        title: 'Reprovar Solicitação',
        description:
          'Encerra o ciclo desta solicitação como Reprovada. A justificativa técnica ficará registrada na trilha de auditoria.',
        requireJustification: true,
        confirmLabel: 'Confirmar Reprovação',
        confirmTone: 'rose',
      },
      cancel: {
        title: 'Cancelar Solicitação',
        description:
          'Solicitações nunca são excluídas fisicamente. O cancelamento preserva integralmente o histórico para auditoria EHS.',
        requireJustification: true,
        confirmLabel: 'Confirmar Cancelamento',
        confirmTone: 'rose',
      },
      close: {
        title: 'Encerrar Atividade Executada',
        description:
          'Registra o encerramento formal da atividade crítica liberada e preserva o dossiê completo.',
        requireJustification: false,
        confirmLabel: 'Confirmar Encerramento',
        confirmTone: 'purple',
      },
    };

    setPendingAction({ type: action, ...configs[action] });
  };

  const handleConfirmWorkflowAction = async () => {
    if (!selectedPermit || !pendingAction) return;
    const trimmedJust = actionJustification.trim();
    if (pendingAction.requireJustification && !trimmedJust) {
      setDetailError('Informe uma justificativa técnica antes de confirmar esta ação.');
      return;
    }

    const expectedVersion =
      serverEvaluation?.versaoConcorrencia ?? selectedPermit.versaoConcorrencia;
    const expectedComplianceFingerprint = serverEvaluation?.complianceFingerprint;

    setActionLoading(true);
    setDetailError(null);
    setDetailErrorReasons([]);

    try {
      switch (pendingAction.type) {
        case 'submit':
          await submitPermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust || undefined,
            expectedVersion,
          });
          break;
        case 'start-review':
          await startPermitReviewOnServer(selectedPermit.id, {
            justificativa: trimmedJust || undefined,
            expectedVersion,
          });
          break;
        case 'request-docs':
          await requestPermitDocsOnServer(selectedPermit.id, {
            justificativa: trimmedJust,
            expectedVersion,
          });
          break;
        case 'request-correction':
          await requestPermitCorrectionOnServer(selectedPermit.id, {
            justificativa: trimmedJust,
            expectedVersion,
          });
          break;
        case 'approve':
          await approvePermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust || undefined,
            expectedVersion,
            expectedComplianceFingerprint,
          });
          break;
        case 'release':
          await releasePermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust || undefined,
            expectedVersion,
            expectedComplianceFingerprint,
          });
          break;
        case 'reject':
          await rejectPermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust,
            expectedVersion,
          });
          break;
        case 'cancel':
          await cancelPermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust,
            expectedVersion,
          });
          break;
        case 'close':
          await closePermitOnServer(selectedPermit.id, {
            justificativa: trimmedJust || undefined,
            expectedVersion,
          });
          break;
      }

      const actionTitle = pendingAction.title;
      setPendingAction(null);
      setActionJustification('');
      setFeedback({
        type: 'success',
        message: `${actionTitle} concluída com validação oficial do servidor.`,
      });
      await runServerEvaluation(selectedPermit.id);
    } catch (err) {
      const apiErr = err as PermitApiClientError;
      setPendingAction(null);
      setDetailError(apiErr?.message || 'Não foi possível concluir a transição no servidor.');
      if (apiErr?.motivosBloqueio && apiErr.motivosBloqueio.length > 0) {
        setDetailErrorReasons(apiErr.motivosBloqueio);
      } else if (apiErr?.errors && apiErr.errors.length > 0) {
        setDetailErrorReasons(apiErr.errors);
      }
      if (apiErr?.compliance && selectedPermit) {
        setServerEvaluation((prev) =>
          prev
            ? {
                ...prev,
                compliance: apiErr.compliance!,
              }
            : prev
        );
      }
    } finally {
      setActionLoading(false);
    }
  };

  const renderStatusBadge = (status: SafetyPermitStatus) => {
    const meta = PERMIT_STATUS_META[status] || PERMIT_STATUS_META.elaboracao;
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}`}
      >
        {meta.label}
      </span>
    );
  };

  const renderComplianceBadge = (permit: SafetyPermit) => {
    const status = permit.statusConformidade;
    if (status === 'conforme') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
          <ShieldCheck size={11} />
          Conforme
        </span>
      );
    }
    if (status === 'atencao') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border-amber-500/30">
          <AlertTriangle size={11} />
          Atenção ({permit.pendenciasAlertaCount || 0})
        </span>
      );
    }
    if (status === 'bloqueado') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase bg-rose-500/15 text-rose-300 border-rose-500/30">
          <ShieldAlert size={11} />
          Bloqueado ({permit.pendenciasObrigatoriasCount || 0})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold uppercase bg-slate-800 text-slate-400 border-slate-700">
        Registro Legado
      </span>
    );
  };

  const canApproveServerSide =
    Boolean(serverEvaluation) &&
    serverEvaluation!.compliance.podeLiberar &&
    serverEvaluation!.structuralErrors.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="text-emerald-400" />
            Solicitação e Liberação de Atividades Críticas (Terceiros)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gestão operacional de APR, PT, LOTO e PET para empresas contratadas com validação documental server-side e fluxo em 2 etapas (Aprovação → Liberação).
          </p>
        </div>

        {canCreateOrEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenCreateModal('PT')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30"
            >
              <Plus size={15} />
              Nova Solicitação de Atividade
            </button>
            <button
              type="button"
              onClick={() => handleOpenCreateModal('APR')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
            >
              <FilePlus2 size={14} />
              APR
            </button>
            <button
              type="button"
              onClick={() => handleOpenCreateModal('LOTO')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
            >
              <Lock size={14} />
              LOTO
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300">
            <Eye size={14} className="text-sky-400" />
            Modo Auditoria (Somente Leitura)
          </div>
        )}
      </div>

      {/* Inline Global Feedback */}
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert size={16} className="text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white p-0.5"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5">
          <p className="text-[11px] font-medium text-slate-400">Total de Solicitações</p>
          <p className="text-2xl font-bold text-white tabular-nums mt-1">{kpis.total}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-sky-500/20 p-3.5">
          <p className="text-[11px] font-medium text-sky-400">Em Análise / Pendências</p>
          <p className="text-2xl font-bold text-sky-300 tabular-nums mt-1">{kpis.emFluxo}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-blue-500/20 p-3.5">
          <p className="text-[11px] font-medium text-blue-400">Aprovadas (Etapa 1)</p>
          <p className="text-2xl font-bold text-blue-300 tabular-nums mt-1">{kpis.aprovadas}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-emerald-500/20 p-3.5">
          <p className="text-[11px] font-medium text-emerald-400">Liberadas p/ Execução</p>
          <p className="text-2xl font-bold text-emerald-300 tabular-nums mt-1">{kpis.liberadas}</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-rose-500/25 p-3.5">
          <p className="text-[11px] font-medium text-rose-400">Com Bloqueio Documental</p>
          <p className="text-2xl font-bold text-rose-300 tabular-nums mt-1">{kpis.bloqueadas}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por título, frente de serviço, empresa ou atividade..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isSolicitante && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="todas">Todas as Contratadas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razaoSocial}
                </option>
              ))}
            </select>
          )}

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'todos' | SafetyPermitType)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Tipos</option>
            <option value="PT">PT (Permissão de Trabalho)</option>
            <option value="APR">APR (Análise de Risco)</option>
            <option value="LOTO">LOTO (Bloqueio/Etiquetagem)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'todos' | SafetyPermitStatus)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Status</option>
            <option value="elaboracao">Rascunho / Elaboração</option>
            <option value="pendente_liberacao">Aguardando Análise</option>
            <option value="em_analise">Em Análise EHS</option>
            <option value="pendente_documentacao">Pendente Documentação</option>
            <option value="pendente_correcao">Pendente Correção</option>
            <option value="aprovado">Aprovado (Aguard. Liberação)</option>
            <option value="liberado">Liberado p/ Execução</option>
            <option value="reprovado">Reprovado</option>
            <option value="cancelado">Cancelado</option>
            <option value="encerrado">Encerrado</option>
            <option value="em_execucao">Em Execução (Legado)</option>
          </select>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredPermits.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <FileWarning size={40} className="mx-auto text-slate-500 mb-2" />
            <p className="text-sm font-semibold text-slate-300">
              Nenhuma solicitação de atividade encontrada
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {canCreateOrEdit
                ? 'Clique em "Nova Solicitação de Atividade" para abrir um rascunho vinculado a atividades críticas e colaboradores terceirizados.'
                : 'Ajuste os filtros para consultar as solicitações registradas.'}
            </p>
          </div>
        ) : (
          filteredPermits.map((item) => {
            const isEditable =
              canCreateOrEdit &&
              EDITABLE_STATUSES.includes(item.status) &&
              (!isSolicitante || item.empresaId === activeEmpresaId);
            const controls = item.controlesOperacionais;
            const actNames = item.atividadeNomes || [];
            const execCount = (item.colaboradorIds || []).length;

            return (
              <div
                key={item.id}
                className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all flex flex-col justify-between shadow-sm"
              >
                <div className="space-y-3">
                  {/* Badges row */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                          item.tipo === 'APR'
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                            : item.tipo === 'PT'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {item.tipo}
                      </span>
                      {renderComplianceBadge(item)}
                    </div>
                    {renderStatusBadge(item.status)}
                  </div>

                  {/* Title & Context */}
                  <div>
                    <h3 className="text-sm font-bold text-white line-clamp-1" title={item.titulo}>
                      {item.titulo}
                    </h3>
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                      <p className="flex items-center gap-1.5 truncate">
                        <Building2 size={12} className="text-slate-500 shrink-0" />
                        <span className="truncate">{item.empresaNome}</span>
                      </p>
                      <p className="truncate">Frente de serviço: {item.localTrabalho}</p>
                      <p className="flex items-center gap-3 text-slate-400">
                        <span>
                          Período: {formatDateBR(item.dataInicio)}
                          {item.dataFim ? ` → ${formatDateBR(item.dataFim)}` : ''}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Activities & Executantes */}
                  <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Layers size={12} className="text-blue-400" />
                        Atividades ({actNames.length})
                      </span>
                      <span className="text-slate-300 font-semibold flex items-center gap-1">
                        <Users size={12} className="text-emerald-400" />
                        {execCount} terceirizado(s)
                      </span>
                    </div>

                    {actNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {actNames.slice(0, 3).map((name, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-200 truncate max-w-[180px]"
                          >
                            {name}
                          </span>
                        ))}
                        {actNames.length > 3 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                            +{actNames.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic">
                        Solicitação legada sem atividades da matriz vinculadas.
                      </p>
                    )}

                    {/* Operational controls pills */}
                    {controls && (
                      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-500 mr-1">Controles:</span>
                        {controls.exigeAPR && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-bold">
                            APR
                          </span>
                        )}
                        {controls.exigePT && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                            PT
                          </span>
                        )}
                        {controls.exigeLOTO && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
                            LOTO
                          </span>
                        )}
                        {controls.exigePET && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                            PET
                          </span>
                        )}
                        {!controls.exigeAPR &&
                          !controls.exigePT &&
                          !controls.exigeLOTO &&
                          !controls.exigePET && (
                            <span className="text-[10px] text-slate-500">Padrão</span>
                          )}
                      </div>
                    )}
                  </div>

                  {/* Last justification / rejection reason preview */}
                  {item.motivoBloqueioOuRejeicao && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-2.5 py-1.5 text-[11px] text-amber-200 line-clamp-2">
                      <span className="font-semibold">Obs. EHS:</span> {item.motivoBloqueioOuRejeicao}
                    </div>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPermitId(item.id)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/30 text-xs font-semibold transition-colors"
                  >
                    <Shield size={13} />
                    {isAdmin ? 'Analisar & Liberar' : 'Checklist & Status'}
                  </button>
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
                      title="Editar Rascunho"
                    >
                      <Edit2 size={13} />
                      Editar
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: CRIAR / EDITAR SOLICITAÇÃO (RASCUNHO VIA /api/permits)        */}
      {/* ===================================================================== */}
      {isDraftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-6 space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileWarning size={18} className="text-amber-400" />
                  {editingPermit
                    ? `Editar Solicitação — ${editingPermit.titulo}`
                    : 'Nova Solicitação de Atividade Crítica (Contratadas)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  O status inicial é controlado exclusivamente pelo servidor. Nenhuma liberação ocorre sem validação documental oficial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDraftModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {draftError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert size={15} className="text-rose-400 shrink-0" />
                  {draftError}
                </p>
                {draftErrorDetails.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-rose-200/90">
                    {draftErrorDetails.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Dados Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tipo Principal <span className="text-rose-400">*</span>
                </label>
                <select
                  value={draftForm.tipo}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, tipo: e.target.value as SafetyPermitType }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 font-semibold"
                >
                  <option value="PT">PT (Permissão de Trabalho)</option>
                  <option value="APR">APR (Análise Preliminar de Risco)</option>
                  <option value="LOTO">LOTO (Bloqueio e Etiquetagem)</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Título da Operação / Serviço <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={draftForm.titulo}
                  onChange={(e) => setDraftForm((prev) => ({ ...prev, titulo: e.target.value }))}
                  placeholder="Ex: Manutenção em telhado e linha de vida — Galpão B"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Empresa Contratada Ativa <span className="text-rose-400">*</span>
                </label>
                <select
                  value={draftForm.empresaId}
                  disabled={isSolicitante}
                  onChange={(e) =>
                    setDraftForm((prev) => ({
                      ...prev,
                      empresaId: e.target.value,
                      colaboradorIds: [],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
                >
                  <option value="">Selecione a contratada ativa...</option>
                  {activeCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razaoSocial} ({c.cnpj})
                    </option>
                  ))}
                </select>
                {activeCompanies.length === 0 && (
                  <p className="text-[11px] text-amber-400 mt-1">
                    Nenhuma empresa contratada com situação "ativa" disponível.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Local / Frente de Serviço <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={draftForm.localTrabalho}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, localTrabalho: e.target.value }))
                  }
                  placeholder="Ex: Subestação 13.8kV / Caldeira 02"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data Início</label>
                  <input
                    type="date"
                    value={draftForm.dataInicio}
                    onChange={(e) =>
                      setDraftForm((prev) => ({ ...prev, dataInicio: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data Fim</label>
                  <input
                    type="date"
                    value={draftForm.dataFim}
                    onChange={(e) => setDraftForm((prev) => ({ ...prev, dataFim: e.target.value }))}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Responsável pela Emissão
                </label>
                <input
                  type="text"
                  value={draftForm.responsavelEmissao}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, responsavelEmissao: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Responsável / Líder da Atividade (Contratada)
                </label>
                <input
                  type="text"
                  value={draftForm.responsavelAtividade}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, responsavelAtividade: e.target.value }))
                  }
                  placeholder="Nome do encarregado ou supervisor terceiro"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Descrição Resumida do Serviço
                </label>
                <input
                  type="text"
                  value={draftForm.descricaoServico}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, descricaoServico: e.target.value }))
                  }
                  placeholder="Detalhamento operacional da tarefa"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Seleção de Atividades Críticas + Executantes Terceirizados */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Atividades Críticas */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Layers size={14} className="text-blue-400" />
                    Atividades Críticas Vinculadas ({draftForm.atividadeIds.length})
                  </h4>
                  <span className="text-[10px] text-slate-400">Somente ativas da Matriz EHS</span>
                </div>
                {activeActivities.length === 0 ? (
                  <p className="text-xs text-amber-300">
                    Nenhuma atividade ativa cadastrada na Matriz de Atividades. Peça ao Admin EHS para carregar os padrões.
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {activeActivities.map((act) => {
                      const checked = draftForm.atividadeIds.includes(act.id);
                      return (
                        <label
                          key={act.id}
                          className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'bg-blue-600/15 border-blue-500/40 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftActivity(act.id)}
                            className="mt-0.5 rounded border-slate-600 bg-slate-950 text-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-tight">{act.nome}</p>
                            <div className="flex flex-wrap items-center gap-1 mt-1 text-[10px] text-slate-400">
                              <span className="font-mono">{act.codigo}</span>
                              {act.exigeAPR && (
                                <span className="px-1 rounded bg-blue-500/20 text-blue-300">APR</span>
                              )}
                              {act.exigePT && (
                                <span className="px-1 rounded bg-amber-500/20 text-amber-300">PT</span>
                              )}
                              {act.exigeLOTO && (
                                <span className="px-1 rounded bg-rose-500/20 text-rose-300">LOTO</span>
                              )}
                              {act.exigePET && (
                                <span className="px-1 rounded bg-purple-500/20 text-purple-300">PET</span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Auto-required operational controls */}
                {draftForm.atividadeIds.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-400 font-medium">Controles exigidos:</span>
                    {draftOperationalControls.exigeAPR && (
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-bold">
                        APR Obrigatória
                      </span>
                    )}
                    {draftOperationalControls.exigePT && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                        PT Obrigatória
                      </span>
                    )}
                    {draftOperationalControls.exigeLOTO && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold">
                        LOTO Obrigatório
                      </span>
                    )}
                    {draftOperationalControls.exigePET && (
                      <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold">
                        PET Obrigatória
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Colaboradores Terceirizados */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Users size={14} className="text-emerald-400" />
                    Executantes Terceirizados ({draftForm.colaboradorIds.length})
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    Somente ativos da contratada selecionada
                  </span>
                </div>

                {!draftForm.empresaId ? (
                  <p className="text-xs text-slate-400">
                    Selecione primeiro a empresa contratada para listar os colaboradores terceirizados ativos.
                  </p>
                ) : eligibleEmployeesForDraft.length === 0 ? (
                  <p className="text-xs text-amber-300">
                    Nenhum colaborador terceirizado ativo cadastrado para esta empresa.
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {eligibleEmployeesForDraft.map((emp) => {
                      const checked = draftForm.colaboradorIds.includes(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'bg-emerald-600/15 border-emerald-500/40 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftEmployee(emp.id)}
                            className="mt-0.5 rounded border-slate-600 bg-slate-950 text-emerald-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-tight">{emp.nomeCompleto}</p>
                            <p className="text-[11px] text-slate-400">
                              {emp.cargo} • CPF {emp.cpf}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Riscos, Medidas Preventivas e Anexos de Controles Operacionais */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Riscos Críticos Identificados
                </label>
                <textarea
                  rows={2}
                  value={draftForm.riscosIdentificados}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, riscosIdentificados: e.target.value }))
                  }
                  placeholder="Ex: Queda em altura, choque elétrico, atmosfera confinada, projeção de fagulhas..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Medidas Preventivas e Controles de Campo
                </label>
                <textarea
                  rows={2}
                  value={draftForm.medidasPreventivas}
                  onChange={(e) =>
                    setDraftForm((prev) => ({ ...prev, medidasPreventivas: e.target.value }))
                  }
                  placeholder="Ex: Linha de vida certificada, bloqueio LOTO com cadeado individual, detector 4 gases..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Anexos de Controles Operacionais (APR / PT / LOTO / PET) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Paperclip size={14} className="text-amber-400" />
                  Anexos de Controles Operacionais (APR / PT / LOTO / PET)
                </h4>
                <span className="text-[10px] text-slate-400">
                  {draftForm.anexosControles.length} anexo(s)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                <select
                  value={newAttachmentType}
                  onChange={(e) =>
                    setNewAttachmentType(e.target.value as OperationalControlAttachmentType)
                  }
                  className="md:col-span-2 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-semibold"
                >
                  {CONTROL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newAttachmentName}
                  onChange={(e) => setNewAttachmentName(e.target.value)}
                  placeholder="Nome do documento (ex: APR-014 Assinada)"
                  className="md:col-span-3 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
                <input
                  type="text"
                  value={newAttachmentUrl}
                  onChange={(e) => setNewAttachmentUrl(e.target.value)}
                  placeholder="Link URL (ou use Enviar Arquivo)"
                  className="md:col-span-4 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
                <div className="md:col-span-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleAddControlAttachmentUrl}
                    className="flex-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700"
                  >
                    + Link
                  </button>
                  <label className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold cursor-pointer">
                    <Upload size={12} />
                    Arquivo
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={handleControlFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {draftForm.anexosControles.length > 0 && (
                <div className="space-y-1.5">
                  {draftForm.anexosControles.map((att, idx) => (
                    <div
                      key={`${att.tipo}_${att.nomeArquivo}_${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-bold text-amber-300">
                          {att.tipo}
                        </span>
                        <span className="text-slate-200 truncate">{att.nomeArquivo}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveControlAttachment(idx)}
                        className="text-slate-400 hover:text-rose-400 p-1"
                        title="Remover anexo"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pré-avaliação Automática de Conformidade */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" />
                Pré-Checklist Automático de Conformidade Documental
              </h4>
              <ComplianceChecklistPanel
                compliance={draftCompliancePreview}
                activityProfiles={activityProfiles}
                sourceLabel="preview"
                compact
              />
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={draftSubmitting}
                onClick={() => setIsDraftModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={draftSubmitting}
                onClick={() => handleSaveDraft(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-white disabled:opacity-50"
              >
                {draftSubmitting ? 'Salvando...' : 'Salvar Rascunho'}
              </button>
              <button
                type="button"
                disabled={draftSubmitting}
                onClick={() => handleSaveDraft(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/30 disabled:opacity-50"
              >
                <Send size={13} />
                {draftSubmitting ? 'Processando...' : 'Salvar e Enviar para Análise EHS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: ANÁLISE OFICIAL, CHECKLIST SERVER-SIDE & FLUXO DE LIBERAÇÃO   */}
      {/* ===================================================================== */}
      {selectedPermit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase">
                    {selectedPermit.tipo}
                  </span>
                  {renderStatusBadge(selectedPermit.status)}
                  {selectedPermit.versaoConcorrencia !== undefined && (
                    <span className="text-[10px] font-mono text-slate-400">
                      v{selectedPermit.versaoConcorrencia}
                    </span>
                  )}
                  {selectedPermit.validadoServerSide && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                      <ShieldCheck size={12} />
                      Validado Server-Side
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-white">{selectedPermit.titulo}</h3>
                <p className="text-xs text-slate-400">
                  Contratada: <span className="text-slate-200 font-medium">{selectedPermit.empresaNome}</span> •
                  Local: <span className="text-slate-200">{selectedPermit.localTrabalho}</span> •
                  Período: {formatDateBR(selectedPermit.dataInicio)}
                  {selectedPermit.dataFim ? ` até ${formatDateBR(selectedPermit.dataFim)}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={evaluatingServer}
                  onClick={() => runServerEvaluation(selectedPermit.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={evaluatingServer ? 'animate-spin' : ''} />
                  Reavaliar no Servidor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPermitId(null);
                    setServerEvaluation(null);
                    setDetailError(null);
                    setDetailErrorReasons([]);
                  }}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Auditor Read-Only Notice */}
            {isAuditor && (
              <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-4 py-2.5 flex items-center gap-2 text-xs text-sky-200">
                <Eye size={15} className="text-sky-400 shrink-0" />
                Perfil Auditor: visualização completa do dossiê, checklist oficial e trilha de auditoria (ações de alteração bloqueadas).
              </div>
            )}

            {/* Approval / Release Summary Stamp */}
            {(selectedPermit.aprovadoPorNome || selectedPermit.liberadoPorNome) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedPermit.aprovadoPorNome && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs">
                    <p className="font-bold text-blue-300 flex items-center gap-1.5">
                      <CheckSquare size={14} />
                      Etapa 1 — Aprovado por {selectedPermit.aprovadoPorNome}
                    </p>
                    <p className="text-[11px] text-blue-200/80 mt-0.5">
                      {selectedPermit.dataAprovacao
                        ? new Date(selectedPermit.dataAprovacao).toLocaleString('pt-BR')
                        : '—'}
                    </p>
                  </div>
                )}
                {selectedPermit.liberadoPorNome && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                    <p className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <ShieldCheck size={14} />
                      Etapa 2 — Liberado Oficialmente por {selectedPermit.liberadoPorNome}
                    </p>
                    <p className="text-[11px] text-emerald-200/80 mt-0.5">
                      {selectedPermit.dataLiberacao
                        ? new Date(selectedPermit.dataLiberacao).toLocaleString('pt-BR')
                        : '—'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Error Banner (409 Concurrency / 422 Compliance Block / 403 RBAC) */}
            {detailError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert size={15} className="text-rose-400 shrink-0" />
                  {detailError}
                </p>
                {detailErrorReasons.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-rose-200/90">
                    {detailErrorReasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Structural Validation Errors */}
            {serverEvaluation && serverEvaluation.structuralErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                  Impedimentos Estruturais Detectados pelo Servidor:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {serverEvaluation.structuralErrors.map((errMsg, idx) => (
                    <li key={idx}>{errMsg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detail Sub-tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
              {[
                { id: 'checklist' as const, label: 'Checklist Oficial de Conformidade', icon: ShieldCheck },
                { id: 'controles' as const, label: 'Controles Operacionais & Dados', icon: FileText },
                {
                  id: 'historico' as const,
                  label: `Histórico & Auditoria (${(selectedPermit.historicoWorkflow || []).length})`,
                  icon: History,
                },
              ].map((t) => {
                const Icon = t.icon;
                const active = detailTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDetailTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <Icon size={14} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Server Compliance Checklist */}
            {detailTab === 'checklist' && (
              <div className="space-y-3">
                {evaluatingServer && !serverEvaluation ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-xs text-slate-400">
                    <RefreshCw size={22} className="mx-auto animate-spin text-blue-400 mb-2" />
                    Executando validação oficial de conformidade no servidor...
                  </div>
                ) : (
                  <>
                    <ComplianceChecklistPanel
                      compliance={serverEvaluation?.compliance || null}
                      activityProfiles={activityProfiles}
                      sourceLabel="server"
                    />
                    {serverEvaluation?.complianceFingerprint && (
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
                        <span>
                          Fingerprint oficial de conformidade:{' '}
                          {serverEvaluation.complianceFingerprint.slice(0, 16)}...
                        </span>
                        <span>Versão de concorrência: v{serverEvaluation.versaoConcorrencia}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Tab 2: Operational Controls & Permit Details */}
            {detailTab === 'controles' && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <h4 className="font-bold text-white">Controles Operacionais Exigidos</h4>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'APR', active: serverEvaluation?.controlesOperacionais.exigeAPR ?? selectedPermit.controlesOperacionais?.exigeAPR },
                        { key: 'PT', active: serverEvaluation?.controlesOperacionais.exigePT ?? selectedPermit.controlesOperacionais?.exigePT },
                        { key: 'LOTO', active: serverEvaluation?.controlesOperacionais.exigeLOTO ?? selectedPermit.controlesOperacionais?.exigeLOTO },
                        { key: 'PET', active: serverEvaluation?.controlesOperacionais.exigePET ?? selectedPermit.controlesOperacionais?.exigePET },
                      ].map((ctrl) => (
                        <span
                          key={ctrl.key}
                          className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${
                            ctrl.active
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : 'bg-slate-900 text-slate-500 border-slate-800'
                          }`}
                        >
                          {ctrl.key}: {ctrl.active ? 'EXIGIDO' : 'Não exigido'}
                        </span>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-slate-800 space-y-1 text-slate-300">
                      <p>
                        <span className="text-slate-400">Responsável emissão:</span>{' '}
                        {selectedPermit.responsavelEmissao || '—'}
                      </p>
                      <p>
                        <span className="text-slate-400">Responsável atividade:</span>{' '}
                        {selectedPermit.responsavelAtividade || '—'}
                      </p>
                      <p>
                        <span className="text-slate-400">Descrição do serviço:</span>{' '}
                        {selectedPermit.descricaoServico || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <h4 className="font-bold text-white">Riscos e Medidas Preventivas</h4>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">Riscos Críticos</p>
                      <p className="text-slate-200 mt-0.5 whitespace-pre-wrap">
                        {selectedPermit.riscosIdentificados || 'Não informado.'}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-slate-800">
                      <p className="text-[10px] font-bold uppercase text-slate-400">
                        Medidas Preventivas
                      </p>
                      <p className="text-slate-200 mt-0.5 whitespace-pre-wrap">
                        {selectedPermit.medidasPreventivas || 'Não informado.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Anexos de Controles */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
                  <h4 className="font-bold text-white flex items-center gap-1.5">
                    <Paperclip size={14} className="text-amber-400" />
                    Documentos Operacionais Anexados ({(selectedPermit.anexosControles || []).length})
                  </h4>
                  {(selectedPermit.anexosControles || []).length === 0 ? (
                    <p className="text-slate-400">
                      Nenhum anexo de controle operacional (APR/PT/LOTO/PET) vinculado ainda.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {(selectedPermit.anexosControles || []).map((att, idx) => (
                        <div
                          key={`${att.tipo}_${att.nomeArquivo}_${idx}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                              {att.tipo}
                            </span>
                            <span className="text-slate-200 font-medium truncate">
                              {att.nomeArquivo}
                            </span>
                            <span className="text-[10px] text-slate-500 hidden sm:inline">
                              {att.enviadoPorNome ? `por ${att.enviadoPorNome}` : ''}
                              {att.enviadoEm
                                ? ` em ${new Date(att.enviadoEm).toLocaleDateString('pt-BR')}`
                                : ''}
                            </span>
                          </div>
                          {att.url && (
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={att.url.startsWith('data:') ? att.nomeArquivo : undefined}
                              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-semibold shrink-0"
                            >
                              Abrir <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Workflow & Audit History */}
            {detailTab === 'historico' && (
              <div className="space-y-2.5">
                {(selectedPermit.historicoWorkflow || []).length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
                    Nenhum evento de workflow registrado ainda (registro legado ou anterior à Etapa 4).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...(selectedPermit.historicoWorkflow || [])].reverse().map((entry, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-white">{entry.acao}</span>
                            {entry.statusAnterior && (
                              <span className="text-[10px] font-mono text-slate-400">
                                {entry.statusAnterior} → {entry.statusNovo}
                              </span>
                            )}
                            {!entry.statusAnterior && (
                              <span className="text-[10px] font-mono text-slate-400">
                                → {entry.statusNovo}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Por <span className="text-slate-200 font-medium">{entry.usuarioNome}</span> (
                            {entry.usuarioRole})
                          </p>
                          {entry.justificativa && (
                            <p className="text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 mt-1">
                              Justificativa: {entry.justificativa}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          {new Date(entry.dataHora).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* ROLE-GUARDED WORKFLOW ACTION BAR (FAIL-CLOSED SERVER ENDPOINTS) */}
            {/* ============================================================= */}
            {!isAuditor && (
              <div className="pt-4 border-t border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Edit Draft (Admin or Solicitante in editable statuses) */}
                    {canCreateOrEdit && EDITABLE_STATUSES.includes(selectedPermit.status) && (
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          setSelectedPermitId(null);
                          handleOpenEditModal(selectedPermit);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                      >
                        <Edit2 size={13} />
                        Editar Rascunho
                      </button>
                    )}

                    {/* Submit for Review (Admin or Solicitante in editable statuses) */}
                    {canCreateOrEdit && EDITABLE_STATUSES.includes(selectedPermit.status) && (
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => openActionDialog('submit')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                      >
                        <Send size={13} />
                        Enviar para Análise EHS
                      </button>
                    )}

                    {/* ADMIN-ONLY ACTIONS */}
                    {isAdmin && selectedPermit.status === 'pendente_liberacao' && (
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => openActionDialog('start-review')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                      >
                        <Play size={13} />
                        Iniciar Análise
                      </button>
                    )}

                    {isAdmin &&
                      ['pendente_liberacao', 'em_analise', 'pendente_correcao'].includes(
                        selectedPermit.status
                      ) && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => openActionDialog('request-docs')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-semibold"
                        >
                          <FileWarning size={13} />
                          Solicitar Documentação
                        </button>
                      )}

                    {isAdmin &&
                      ['pendente_liberacao', 'em_analise', 'pendente_documentacao'].includes(
                        selectedPermit.status
                      ) && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => openActionDialog('request-correction')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 text-xs font-semibold"
                        >
                          <Wrench size={13} />
                          Solicitar Correção
                        </button>
                      )}

                    {/* Step 1: Approve (Admin only, when pendente_liberacao or em_analise) */}
                    {isAdmin &&
                      ['pendente_liberacao', 'em_analise'].includes(selectedPermit.status) && (
                        <button
                          type="button"
                          disabled={actionLoading || evaluatingServer || !canApproveServerSide}
                          title={
                            !canApproveServerSide
                              ? 'Bloqueado: existem pendências obrigatórias na avaliação oficial do servidor.'
                              : 'Aprovar solicitação (Etapa 1 de 2)'
                          }
                          onClick={() => openActionDialog('approve')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <CheckSquare size={13} />
                          Aprovar Solicitação
                        </button>
                      )}

                    {/* Step 2: Release (Admin only, STRICTLY when aprovado) */}
                    {isAdmin && selectedPermit.status === 'aprovado' && (
                      <button
                        type="button"
                        disabled={actionLoading || evaluatingServer || !canApproveServerSide}
                        title={
                          !canApproveServerSide
                            ? 'Bloqueado: documentação mudou ou possui pendências obrigatórias.'
                            : 'Liberar execução oficialmente (Etapa 2 de 2)'
                        }
                        onClick={() => openActionDialog('release')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ShieldCheck size={14} />
                        Liberar Execução
                      </button>
                    )}

                    {/* Close (Admin only, when liberado, em_execucao, or aprovado) */}
                    {isAdmin &&
                      ['liberado', 'em_execucao', 'aprovado'].includes(selectedPermit.status) && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => openActionDialog('close')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold"
                        >
                          <CheckCircle2 size={13} />
                          Encerrar Atividade
                        </button>
                      )}
                  </div>

                  {/* Destructive / Negative Workflow Transitions (Reject / Cancel — NEVER physical delete) */}
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin &&
                      [
                        'pendente_liberacao',
                        'em_analise',
                        'pendente_documentacao',
                        'pendente_correcao',
                        'aprovado',
                      ].includes(selectedPermit.status) && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => openActionDialog('reject')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold"
                        >
                          <XCircle size={13} />
                          Reprovar
                        </button>
                      )}

                    {((isAdmin &&
                      !['cancelado', 'encerrado'].includes(selectedPermit.status)) ||
                      (isSolicitante &&
                        SOLICITANTE_CANCELABLE_STATUSES.includes(selectedPermit.status))) && (
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => openActionDialog('cancel')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/15 hover:bg-red-600/25 text-red-300 border border-red-500/30 text-xs font-semibold"
                      >
                        <Ban size={13} />
                        Cancelar Solicitação
                      </button>
                    )}
                  </div>
                </div>

                {isAdmin &&
                  ['pendente_liberacao', 'em_analise', 'aprovado'].includes(
                    selectedPermit.status
                  ) &&
                  !canApproveServerSide &&
                  !evaluatingServer && (
                    <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <Info size={13} className="shrink-0" />
                      Aprovação e Liberação permanecem bloqueadas até que todas as pendências obrigatórias do servidor sejam sanadas.
                    </p>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: CONFIRMAÇÃO & JUSTIFICATIVA DE TRANSIÇÃO DE WORKFLOW          */}
      {/* ===================================================================== */}
      {pendingAction && selectedPermit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-bold text-white">{pendingAction.title}</h4>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setPendingAction(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{pendingAction.description}</p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {pendingAction.requireJustification
                  ? 'Justificativa Técnica (Obrigatória)'
                  : 'Observação / Justificativa (Opcional)'}
                {pendingAction.requireJustification && <span className="text-rose-400"> *</span>}
              </label>
              <textarea
                rows={3}
                value={actionJustification}
                onChange={(e) => setActionJustification(e.target.value)}
                placeholder={
                  pendingAction.requireJustification
                    ? 'Descreva claramente o motivo técnico para registro em auditoria...'
                    : 'Observação opcional para a trilha de auditoria...'
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setPendingAction(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={
                  actionLoading ||
                  (pendingAction.requireJustification && !actionJustification.trim())
                }
                onClick={handleConfirmWorkflowAction}
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 ${
                  pendingAction.confirmTone === 'emerald'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : pendingAction.confirmTone === 'amber'
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : pendingAction.confirmTone === 'rose'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : pendingAction.confirmTone === 'purple'
                    ? 'bg-purple-600 hover:bg-purple-500'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {actionLoading ? 'Validando no servidor...' : pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
