import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit2,
  FileCheck2,
  HardHat,
  Info,
  Loader2,
  Lock,
  Plus,
  Power,
  PowerOff,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  ActivityRequirementScope,
  ActivityRequirementSourceCollection,
  ActivityRiskLevel,
} from '../../types/sst';

const RISK_LEVEL_LABELS: Record<ActivityRiskLevel, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  critico: 'Crítico',
};

const RISK_LEVEL_TEXT_CLASS: Record<ActivityRiskLevel, string> = {
  baixo: 'text-emerald-400',
  medio: 'text-amber-400',
  alto: 'text-orange-400',
  critico: 'text-red-400',
};

const SCOPE_LABELS: Record<ActivityRequirementScope, string> = {
  empresa: 'Empresa Contratada',
  colaborador: 'Colaborador Terceirizado',
  atividade_pt: 'Atividade / PT',
};

const COLLECTION_LABELS: Record<ActivityRequirementSourceCollection, string> = {
  documents: 'Documentos (documents)',
  trainings: 'Treinamentos (trainings)',
  exams: 'Exames e ASO (exams)',
  epiDeliveries: 'Entrega de EPI (epiDeliveries)',
  safetyPermits: 'APR / PT / LOTO (safetyPermits)',
};

const CANONICAL_CODE_SUGGESTIONS = [
  'NR-35',
  'NR-33',
  'NR-33-SUPERVISOR',
  'NR-10',
  'NR-10-SEP',
  'NR-18',
  'NR-23',
  'NR-11',
  'NR-12',
  'NR-20',
  'ASO',
  'PGR',
  'PCMSO',
  'APR',
  'PT',
  'PET',
  'LOTO',
  'EPI_ALTURA',
  'EPI_ELETRICO',
  'EPI_TRABALHO_QUENTE',
  'EPI_ESCAVACAO',
  'SONDAGEM_INTERFERENCIAS',
  'ART_ESCORAMENTO',
  'TRABALHO_QUENTE_CAPACITACAO',
];

const APTITUDE_SUGGESTIONS = [
  'trabalho_altura',
  'espaco_confinado',
  'eletricidade',
  'trabalho_quente',
  'escavacao',
];

function parseCommaList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function parseLineOrSemicolonList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

interface ActivityFormState {
  codigo: string;
  nome: string;
  descricao: string;
  nivelRisco: ActivityRiskLevel;
  riscosText: string;
  normasText: string;
  exigeAPR: boolean;
  exigePT: boolean;
  exigeLOTO: boolean;
  exigePET: boolean;
  ativo: boolean;
}

interface RequirementFormState {
  nomeExibicao: string;
  descricao: string;
  documentoCodigoCanonico: string;
  palavrasChaveText: string;
  escopo: ActivityRequirementScope;
  origemColecao: ActivityRequirementSourceCollection;
  funcoesText: string;
  exigeAptoASO: boolean;
  aptidaoEspecifica: string;
  validadePadraoMeses: string;
  obrigatorioParaLiberacao: boolean;
  baseLegal: string;
  ordemExibicao: string;
  ativo: boolean;
}

interface FeedbackBanner {
  type: 'success' | 'error' | 'info';
  message: string;
}

interface DeactivateTarget {
  kind: 'activity' | 'requirement';
  id: string;
  title: string;
}

const EMPTY_ACTIVITY_FORM: ActivityFormState = {
  codigo: '',
  nome: '',
  descricao: '',
  nivelRisco: 'critico',
  riscosText: '',
  normasText: '',
  exigeAPR: true,
  exigePT: true,
  exigeLOTO: false,
  exigePET: false,
  ativo: true,
};

const EMPTY_REQUIREMENT_FORM: RequirementFormState = {
  nomeExibicao: '',
  descricao: '',
  documentoCodigoCanonico: '',
  palavrasChaveText: '',
  escopo: 'colaborador',
  origemColecao: 'trainings',
  funcoesText: '',
  exigeAptoASO: false,
  aptidaoEspecifica: '',
  validadePadraoMeses: '',
  obrigatorioParaLiberacao: true,
  baseLegal: '',
  ordemExibicao: '',
  ativo: true,
};

export const ActivityMatrixView: React.FC = () => {
  const {
    activityProfiles,
    activityDocumentRequirements,
    addActivityProfile,
    updateActivityProfile,
    deactivateActivityProfile,
    addActivityDocumentRequirement,
    updateActivityDocumentRequirement,
    deactivateActivityDocumentRequirement,
    seedInitialActivityTemplates,
  } = useSST();

  const { isAdmin, isAuditor, isSolicitante } = useAuth();

  // Filters & Selection
  const [searchTerm, setSearchTerm] = useState('');
  const [activityStatusFilter, setActivityStatusFilter] = useState<'todas' | 'ativas' | 'inativas'>('todas');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [reqScopeFilter, setReqScopeFilter] = useState<'todos' | ActivityRequirementScope>('todos');
  const [showInactiveReqs, setShowInactiveReqs] = useState(true);

  // Feedback & Busy states
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSavingActivity, setIsSavingActivity] = useState(false);
  const [isSavingReq, setIsSavingReq] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  // Activity Modal
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityProfile | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityFormState>(EMPTY_ACTIVITY_FORM);
  const [activityFormError, setActivityFormError] = useState<string | null>(null);

  // Requirement Modal
  const [isReqModalOpen, setIsReqModalOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<ActivityDocumentRequirement | null>(null);
  const [reqForm, setReqForm] = useState<RequirementFormState>(EMPTY_REQUIREMENT_FORM);
  const [reqFormError, setReqFormError] = useState<string | null>(null);

  // Confirmation Modal before deactivation
  const [deactivateTarget, setDeactivateTarget] = useState<DeactivateTarget | null>(null);

  // Requirement counts indexed by activityId
  const reqStatsByActivity = useMemo(() => {
    const map = new Map<
      string,
      { total: number; ativos: number; bloqueantes: number; inativos: number }
    >();
    for (const req of activityDocumentRequirements) {
      const current = map.get(req.activityId) || {
        total: 0,
        ativos: 0,
        bloqueantes: 0,
        inativos: 0,
      };
      current.total += 1;
      if (req.ativo) {
        current.ativos += 1;
        if (req.obrigatorioParaLiberacao) current.bloqueantes += 1;
      } else {
        current.inativos += 1;
      }
      map.set(req.activityId, current);
    }
    return map;
  }, [activityDocumentRequirements]);

  // Global KPI counters
  const globalStats = useMemo(() => {
    const totalActivities = activityProfiles.length;
    const activeActivities = activityProfiles.filter((a) => a.ativo).length;
    const activeReqs = activityDocumentRequirements.filter((r) => r.ativo);
    const blockingReqs = activeReqs.filter((r) => r.obrigatorioParaLiberacao).length;
    const specializedReqs = activeReqs.filter(
      (r) => (r.funcoesAplicaveis && r.funcoesAplicaveis.length > 0) || r.exigeAptoASO
    ).length;

    return {
      totalActivities,
      activeActivities,
      activeReqsCount: activeReqs.length,
      blockingReqs,
      specializedReqs,
    };
  }, [activityProfiles, activityDocumentRequirements]);

  // Filtered activity list
  const filteredActivities = useMemo(() => {
    let list = activityProfiles;
    if (activityStatusFilter === 'ativas') {
      list = list.filter((a) => a.ativo);
    } else if (activityStatusFilter === 'inativas') {
      list = list.filter((a) => !a.ativo);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.nome.toLowerCase().includes(q) ||
          a.codigo.toLowerCase().includes(q) ||
          a.descricao.toLowerCase().includes(q) ||
          a.normasAplicaveis.some((n) => n.toLowerCase().includes(q)) ||
          a.riscosAssociados.some((r) => r.toLowerCase().includes(q))
      );
    }
    return list;
  }, [activityProfiles, activityStatusFilter, searchTerm]);

  // Keep a valid selected activity whenever list updates
  useEffect(() => {
    if (isSolicitante) return;
    if (filteredActivities.length === 0) {
      if (selectedActivityId && !activityProfiles.some((a) => a.id === selectedActivityId)) {
        setSelectedActivityId(null);
      }
      return;
    }
    if (!selectedActivityId || !activityProfiles.some((a) => a.id === selectedActivityId)) {
      setSelectedActivityId(filteredActivities[0].id);
    }
  }, [isSolicitante, filteredActivities, activityProfiles, selectedActivityId]);

  const selectedActivity = useMemo(
    () => activityProfiles.find((a) => a.id === selectedActivityId) || null,
    [activityProfiles, selectedActivityId]
  );

  const selectedActivityRequirements = useMemo(() => {
    if (!selectedActivity) return [];
    let list = activityDocumentRequirements.filter((r) => r.activityId === selectedActivity.id);
    if (!showInactiveReqs) {
      list = list.filter((r) => r.ativo);
    }
    if (reqScopeFilter !== 'todos') {
      list = list.filter((r) => r.escopo === reqScopeFilter);
    }
    return list;
  }, [activityDocumentRequirements, selectedActivity, showInactiveReqs, reqScopeFilter]);

  const selectedActivitySummary = useMemo(() => {
    if (!selectedActivity) {
      return { totalAtivos: 0, bloqueantes: 0, empresa: 0, colaborador: 0, atividadePt: 0 };
    }
    const activeForAct = activityDocumentRequirements.filter(
      (r) => r.activityId === selectedActivity.id && r.ativo
    );
    return {
      totalAtivos: activeForAct.length,
      bloqueantes: activeForAct.filter((r) => r.obrigatorioParaLiberacao).length,
      empresa: activeForAct.filter((r) => r.escopo === 'empresa').length,
      colaborador: activeForAct.filter((r) => r.escopo === 'colaborador').length,
      atividadePt: activeForAct.filter((r) => r.escopo === 'atividade_pt').length,
    };
  }, [activityDocumentRequirements, selectedActivity]);

  // Handlers — Seed EHS Templates
  const handleSeedTemplates = async () => {
    if (!isAdmin || isSeeding) return;
    setFeedback(null);
    setIsSeeding(true);
    try {
      const res = await seedInitialActivityTemplates();
      if (res.createdActivities === 0 && res.createdRequirements === 0) {
        setFeedback({
          type: 'info',
          message: `Todos os padrões EHS já estavam carregados (${res.skippedActivities} atividades e ${res.skippedRequirements} requisitos preservados sem duplicidade).`,
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Padrões EHS carregados com sucesso: ${res.createdActivities} atividade(s) e ${res.createdRequirements} requisito(s) criados (${res.skippedActivities} atividade(s) e ${res.skippedRequirements} requisito(s) já existentes mantidos sem duplicação).`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Não foi possível carregar os padrões EHS. Verifique sua conexão e permissões.',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  // Handlers — Activity CRUD
  const openCreateActivityModal = () => {
    if (!isAdmin) return;
    setEditingActivity(null);
    setActivityForm(EMPTY_ACTIVITY_FORM);
    setActivityFormError(null);
    setIsActivityModalOpen(true);
  };

  const openEditActivityModal = (activity: ActivityProfile) => {
    if (!isAdmin) return;
    setEditingActivity(activity);
    setActivityForm({
      codigo: activity.codigo,
      nome: activity.nome,
      descricao: activity.descricao || '',
      nivelRisco: activity.nivelRisco,
      riscosText: (activity.riscosAssociados || []).join('\n'),
      normasText: (activity.normasAplicaveis || []).join(', '),
      exigeAPR: activity.exigeAPR,
      exigePT: activity.exigePT,
      exigeLOTO: activity.exigeLOTO,
      exigePET: Boolean(activity.exigePET),
      ativo: activity.ativo,
    });
    setActivityFormError(null);
    setIsActivityModalOpen(true);
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const cleanCodigo = activityForm.codigo.trim().toUpperCase().replace(/\s+/g, '_');
    const cleanNome = activityForm.nome.trim();
    const cleanDescricao = activityForm.descricao.trim();
    const riscos = parseLineOrSemicolonList(activityForm.riscosText);
    const normas = parseCommaList(activityForm.normasText).map((n) => n.toUpperCase());

    if (cleanNome.length < 2 || cleanNome.length > 180) {
      setActivityFormError('Informe o nome da atividade (entre 2 e 180 caracteres).');
      return;
    }
    if (cleanCodigo.length < 2 || cleanCodigo.length > 80 || !/^[A-Z0-9_-]+$/.test(cleanCodigo)) {
      setActivityFormError(
        'O código deve ter entre 2 e 80 caracteres usando apenas letras, números, "_" ou "-" (ex.: TRABALHO_ALTURA).'
      );
      return;
    }
    const duplicateCode = activityProfiles.find(
      (a) => a.codigo.trim().toUpperCase() === cleanCodigo && a.id !== editingActivity?.id
    );
    if (duplicateCode) {
      setActivityFormError(`Já existe uma atividade cadastrada com o código "${cleanCodigo}".`);
      return;
    }
    if (cleanDescricao.length > 1000) {
      setActivityFormError('A descrição técnica deve ter no máximo 1000 caracteres.');
      return;
    }
    if (riscos.length > 50) {
      setActivityFormError('Informe no máximo 50 riscos associados.');
      return;
    }
    if (normas.length > 30) {
      setActivityFormError('Informe no máximo 30 normas aplicáveis.');
      return;
    }

    setActivityFormError(null);
    setIsSavingActivity(true);
    try {
      if (editingActivity) {
        await updateActivityProfile(editingActivity.id, {
          codigo: cleanCodigo,
          nome: cleanNome,
          descricao: cleanDescricao,
          nivelRisco: activityForm.nivelRisco,
          riscosAssociados: riscos,
          normasAplicaveis: normas,
          exigeAPR: activityForm.exigeAPR,
          exigePT: activityForm.exigePT,
          exigeLOTO: activityForm.exigeLOTO,
          exigePET: activityForm.exigePET,
          ativo: activityForm.ativo,
        });
        setFeedback({
          type: 'success',
          message: `Atividade "${cleanNome}" atualizada com sucesso.`,
        });
      } else {
        const newId = await addActivityProfile({
          codigo: cleanCodigo,
          nome: cleanNome,
          descricao: cleanDescricao,
          nivelRisco: activityForm.nivelRisco,
          riscosAssociados: riscos,
          normasAplicaveis: normas,
          exigeAPR: activityForm.exigeAPR,
          exigePT: activityForm.exigePT,
          exigeLOTO: activityForm.exigeLOTO,
          exigePET: activityForm.exigePET,
          ativo: true,
        });
        setSelectedActivityId(newId);
        setFeedback({
          type: 'success',
          message: `Atividade "${cleanNome}" cadastrada com sucesso.`,
        });
      }
      setIsActivityModalOpen(false);
    } catch (err) {
      setActivityFormError(
        err instanceof Error ? err.message : 'Erro ao salvar atividade crítica.'
      );
    } finally {
      setIsSavingActivity(false);
    }
  };

  const handleReactivateActivity = async (activity: ActivityProfile) => {
    if (!isAdmin) return;
    setFeedback(null);
    try {
      await updateActivityProfile(activity.id, { ativo: true });
      setFeedback({
        type: 'success',
        message: `Atividade "${activity.nome}" reativada com sucesso.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao reativar atividade.',
      });
    }
  };

  // Handlers — Requirement CRUD
  const openCreateReqModal = () => {
    if (!isAdmin || !selectedActivity) return;
    const nextOrder =
      activityDocumentRequirements.filter((r) => r.activityId === selectedActivity.id).length + 1;
    setEditingReq(null);
    setReqForm({
      ...EMPTY_REQUIREMENT_FORM,
      ordemExibicao: String(nextOrder),
    });
    setReqFormError(null);
    setIsReqModalOpen(true);
  };

  const openEditReqModal = (req: ActivityDocumentRequirement) => {
    if (!isAdmin) return;
    setEditingReq(req);
    setReqForm({
      nomeExibicao: req.nomeExibicao,
      descricao: req.descricao || '',
      documentoCodigoCanonico: req.documentoCodigoCanonico,
      palavrasChaveText: (req.palavrasChaveMatch || []).join(', '),
      escopo: req.escopo,
      origemColecao: req.origemColecao,
      funcoesText: (req.funcoesAplicaveis || []).join(', '),
      exigeAptoASO: Boolean(req.exigeAptoASO),
      aptidaoEspecifica: req.aptidaoEspecifica || '',
      validadePadraoMeses:
        req.validadePadraoMeses !== undefined ? String(req.validadePadraoMeses) : '',
      obrigatorioParaLiberacao: req.obrigatorioParaLiberacao,
      baseLegal: req.baseLegal || '',
      ordemExibicao: req.ordemExibicao !== undefined ? String(req.ordemExibicao) : '',
      ativo: req.ativo,
    });
    setReqFormError(null);
    setIsReqModalOpen(true);
  };

  const handleSaveReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !selectedActivity) return;

    const cleanNome = reqForm.nomeExibicao.trim();
    const cleanCanonico = reqForm.documentoCodigoCanonico.trim().toUpperCase().replace(/\s+/g, '-');
    const cleanDescricao = reqForm.descricao.trim();
    const cleanBaseLegal = reqForm.baseLegal.trim();
    const cleanAptidao = reqForm.aptidaoEspecifica.trim();
    const palavrasChave = parseCommaList(reqForm.palavrasChaveText).map((k) => k.toLowerCase());
    const funcoes = parseCommaList(reqForm.funcoesText).map((f) => f.toLowerCase());

    if (cleanNome.length < 2 || cleanNome.length > 200) {
      setReqFormError('Informe o nome de exibição do requisito (entre 2 e 200 caracteres).');
      return;
    }
    if (cleanCanonico.length < 2 || cleanCanonico.length > 100) {
      setReqFormError('Informe o código canônico do documento (entre 2 e 100 caracteres, ex.: NR-35, ASO, PGR).');
      return;
    }
    if (cleanDescricao.length > 1000) {
      setReqFormError('A descrição do requisito deve ter no máximo 1000 caracteres.');
      return;
    }
    if (cleanBaseLegal.length > 200) {
      setReqFormError('A base legal deve ter no máximo 200 caracteres.');
      return;
    }
    if (cleanAptidao.length > 100) {
      setReqFormError('A aptidão específica do ASO deve ter no máximo 100 caracteres.');
      return;
    }
    if (palavrasChave.length > 40) {
      setReqFormError('Informe no máximo 40 palavras-chave para documentos legados.');
      return;
    }
    if (funcoes.length > 50) {
      setReqFormError('Informe no máximo 50 cargos/funções aplicáveis.');
      return;
    }

    let parsedValidade: number | undefined;
    if (reqForm.validadePadraoMeses.trim() !== '') {
      const n = Number(reqForm.validadePadraoMeses);
      if (!Number.isFinite(n) || n < 0 || n > 240) {
        setReqFormError('A validade padrão em meses deve ser um número entre 0 e 240.');
        return;
      }
      parsedValidade = Math.round(n);
    }

    let parsedOrdem: number | undefined;
    if (reqForm.ordemExibicao.trim() !== '') {
      const n = Number(reqForm.ordemExibicao);
      if (!Number.isFinite(n) || n < 0 || n > 999) {
        setReqFormError('A ordem de exibição deve ser um número entre 0 e 999.');
        return;
      }
      parsedOrdem = Math.round(n);
    }

    setReqFormError(null);
    setIsSavingReq(true);
    try {
      const payloadBase = {
        activityId: selectedActivity.id,
        activityCodigo: selectedActivity.codigo,
        nomeExibicao: cleanNome,
        descricao: cleanDescricao,
        documentoCodigoCanonico: cleanCanonico,
        palavrasChaveMatch: palavrasChave,
        escopo: reqForm.escopo,
        origemColecao: reqForm.origemColecao,
        funcoesAplicaveis: funcoes,
        exigeAptoASO: reqForm.exigeAptoASO,
        aptidaoEspecifica: reqForm.exigeAptoASO ? cleanAptidao : '',
        ...(parsedValidade !== undefined ? { validadePadraoMeses: parsedValidade } : {}),
        obrigatorioParaLiberacao: reqForm.obrigatorioParaLiberacao,
        baseLegal: cleanBaseLegal,
        ...(parsedOrdem !== undefined ? { ordemExibicao: parsedOrdem } : {}),
        ativo: editingReq ? reqForm.ativo : true,
      };

      if (editingReq) {
        await updateActivityDocumentRequirement(editingReq.id, payloadBase);
        setFeedback({
          type: 'success',
          message: `Requisito "${cleanNome}" atualizado com sucesso.`,
        });
      } else {
        await addActivityDocumentRequirement(payloadBase);
        setFeedback({
          type: 'success',
          message: `Requisito "${cleanNome}" adicionado à atividade "${selectedActivity.nome}".`,
        });
      }
      setIsReqModalOpen(false);
    } catch (err) {
      setReqFormError(
        err instanceof Error ? err.message : 'Erro ao salvar requisito documental.'
      );
    } finally {
      setIsSavingReq(false);
    }
  };

  const handleReactivateReq = async (req: ActivityDocumentRequirement) => {
    if (!isAdmin) return;
    setFeedback(null);
    try {
      await updateActivityDocumentRequirement(req.id, { ativo: true });
      setFeedback({
        type: 'success',
        message: `Requisito "${req.nomeExibicao}" reativado com sucesso.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao reativar requisito.',
      });
    }
  };

  // Confirmation modal handler for deactivation
  const handleConfirmDeactivate = async () => {
    if (!isAdmin || !deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setFeedback(null);
    try {
      if (deactivateTarget.kind === 'activity') {
        await deactivateActivityProfile(deactivateTarget.id);
        setFeedback({
          type: 'info',
          message: `Atividade "${deactivateTarget.title}" desativada. O histórico de auditoria foi preservado e ela pode ser reativada a qualquer momento.`,
        });
      } else {
        await deactivateActivityDocumentRequirement(deactivateTarget.id);
        setFeedback({
          type: 'info',
          message: `Requisito "${deactivateTarget.title}" desativado. Ele não será mais exigido em novas liberações até eventual reativação.`,
        });
      }
      setDeactivateTarget(null);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao desativar registro.',
      });
    } finally {
      setIsDeactivating(false);
    }
  };

  const isAsoContext =
    reqForm.origemColecao === 'exams' ||
    reqForm.documentoCodigoCanonico.trim().toUpperCase() === 'ASO';

  // Defense-in-depth: Solicitante never accesses administrative matrix
  if (isSolicitante) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center max-w-xl mx-auto mt-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
          <Lock size={22} />
        </div>
        <h2 className="text-lg font-bold text-white">Acesso Restrito</h2>
        <p className="text-sm text-slate-400 mt-2">
          A administração da Matriz de Atividades e Documentos Obrigatórios é exclusiva para o Administrador EHS (com consulta em modo leitura para Auditores).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <ClipboardList className="text-blue-500 shrink-0" size={22} />
            Matriz de Atividades e Documentos Obrigatórios
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configuração das atividades críticas de terceiros, riscos, normas e exigências documentais para liberação de trabalho
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAuditor && !isAdmin && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
              <Info size={14} className="text-blue-400 shrink-0" />
              <span>Perfil Auditor · Somente leitura</span>
            </div>
          )}

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={handleSeedTemplates}
                disabled={isSeeding}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-100 border border-slate-700 text-xs font-semibold transition-colors"
              >
                {isSeeding ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Carregar Padrões EHS
              </button>

              <button
                type="button"
                onClick={openCreateActivityModal}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/25 transition-colors"
              >
                <Plus size={15} />
                Nova Atividade
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3 border text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200'
              : feedback.type === 'error'
                ? 'bg-red-950/40 border-red-800/70 text-red-200'
                : 'bg-blue-950/40 border-blue-800/70 text-blue-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            ) : feedback.type === 'error' ? (
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            ) : (
              <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white shrink-0"
            aria-label="Fechar mensagem"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Global Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400">Atividades Ativas</div>
          <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-2xl font-bold text-white">{globalStats.activeActivities}</span>
            <span className="text-xs text-slate-500">de {globalStats.totalActivities} cadastradas</span>
          </div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400">Documentos Obrigatórios Ativos</div>
          <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-2xl font-bold text-blue-400">{globalStats.activeReqsCount}</span>
            <span className="text-xs text-slate-500">regras vinculadas</span>
          </div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400">Requisitos Bloqueantes</div>
          <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-2xl font-bold text-amber-400">{globalStats.blockingReqs}</span>
            <span className="text-xs text-slate-500">travam liberação</span>
          </div>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400">Filtros por Função / ASO</div>
          <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-2xl font-bold text-emerald-400">{globalStats.specializedReqs}</span>
            <span className="text-xs text-slate-500">regras especializadas</span>
          </div>
        </div>
      </div>

      {/* Main Master-Detail Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Activities List */}
        <section className="xl:col-span-4 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Atividades Cadastradas</h3>
              <span className="text-xs text-slate-400 tabular-nums">
                {filteredActivities.length} exibida(s)
              </span>
            </div>

            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar atividade, código ou NR..."
                className="w-full rounded-lg bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
              {(['todas', 'ativas', 'inativas'] as const).map((statusKey) => (
                <button
                  key={statusKey}
                  type="button"
                  onClick={() => setActivityStatusFilter(statusKey)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    activityStatusFilter === statusKey
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {statusKey === 'todas' ? 'Todas' : statusKey === 'ativas' ? 'Ativas' : 'Inativas'}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 max-h-[640px] overflow-y-auto custom-scrollbar">
            {filteredActivities.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <HardHat size={28} className="mx-auto text-slate-600" />
                <div className="text-sm font-medium text-slate-300">
                  {activityProfiles.length === 0
                    ? 'Nenhuma atividade configurada'
                    : 'Nenhuma atividade encontrada para o filtro atual'}
                </div>
                <p className="text-xs text-slate-500">
                  {activityProfiles.length === 0
                    ? isAdmin
                      ? 'Clique em "Carregar Padrões EHS" para iniciar com NR-35, NR-33, NR-10, Trabalho a Quente e Escavação, ou cadastre uma nova atividade.'
                      : 'Ainda não há atividades configuradas pelo Administrador EHS.'
                    : 'Ajuste a busca ou o filtro de situação para visualizar outras atividades.'}
                </p>
              </div>
            ) : (
              filteredActivities.map((activity) => {
                const isSelected = selectedActivity?.id === activity.id;
                const stats = reqStatsByActivity.get(activity.id) || {
                  total: 0,
                  ativos: 0,
                  bloqueantes: 0,
                  inativos: 0,
                };
                return (
                  <button
                    key={activity.id}
                    type="button"
                    onClick={() => setSelectedActivityId(activity.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected
                        ? 'bg-blue-600/15 text-white'
                        : 'hover:bg-slate-800/60 text-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`text-sm font-semibold leading-snug ${
                          activity.ativo ? 'text-white' : 'text-slate-400 line-through'
                        }`}
                      >
                        {activity.nome}
                      </span>
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${
                          RISK_LEVEL_TEXT_CLASS[activity.nivelRisco]
                        }`}
                      >
                        {RISK_LEVEL_LABELS[activity.nivelRisco]}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                      <span className="font-mono text-slate-300">{activity.codigo}</span>
                      <span aria-hidden="true">·</span>
                      <span className={activity.ativo ? 'text-emerald-400' : 'text-slate-500'}>
                        {activity.ativo ? 'Ativa' : 'Inativa'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {stats.ativos} doc(s) ({stats.bloqueantes} bloq.)
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Selected Activity Details + Mandatory Documents */}
        <section className="xl:col-span-8 space-y-6">
          {!selectedActivity ? (
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-10 text-center space-y-3">
              <FileCheck2 size={32} className="mx-auto text-slate-600" />
              <h3 className="text-base font-semibold text-white">Selecione uma atividade</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Escolha uma atividade crítica na lista ao lado para consultar riscos, normas, controles exigidos (APR, PT, LOTO, PET) e gerenciar os documentos obrigatórios para terceiros.
              </p>
            </div>
          ) : (
            <>
              {/* Selected Activity Details */}
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                      <span className="font-mono text-slate-300">{selectedActivity.codigo}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${RISK_LEVEL_TEXT_CLASS[selectedActivity.nivelRisco]}`}>
                        Risco {RISK_LEVEL_LABELS[selectedActivity.nivelRisco]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={selectedActivity.ativo ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                        {selectedActivity.ativo ? 'Atividade Ativa' : 'Atividade Inativa'}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{selectedActivity.nome}</h3>
                    {selectedActivity.descricao && (
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {selectedActivity.descricao}
                      </p>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditActivityModal(selectedActivity)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition-colors"
                      >
                        <Edit2 size={14} />
                        Editar
                      </button>

                      {selectedActivity.ativo ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDeactivateTarget({
                              kind: 'activity',
                              id: selectedActivity.id,
                              title: selectedActivity.nome,
                            })
                          }
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800/70 text-xs font-semibold transition-colors"
                        >
                          <PowerOff size={14} />
                          Desativar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReactivateActivity(selectedActivity)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/70 text-xs font-semibold transition-colors"
                        >
                          <Power size={14} />
                          Ativar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Controls, Norms & Summary Divider Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4 border-t border-slate-800">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Controles Operacionais
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: 'APR', enabled: selectedActivity.exigeAPR },
                        { label: 'PT', enabled: selectedActivity.exigePT },
                        { label: 'LOTO', enabled: selectedActivity.exigeLOTO },
                        { label: 'PET (NR-33)', enabled: Boolean(selectedActivity.exigePET) },
                      ].map((ctrl) => (
                        <div
                          key={ctrl.label}
                          className={`flex items-center gap-1.5 ${
                            ctrl.enabled ? 'text-slate-100 font-medium' : 'text-slate-500'
                          }`}
                        >
                          {ctrl.enabled ? (
                            <Check size={14} className="text-emerald-400 shrink-0" />
                          ) : (
                            <span className="w-3.5 text-center text-slate-600">—</span>
                          )}
                          <span>{ctrl.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Normas Aplicáveis
                    </div>
                    {selectedActivity.normasAplicaveis.length > 0 ? (
                      <div className="text-xs text-slate-200 leading-relaxed">
                        {selectedActivity.normasAplicaveis.join(' · ')}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">Nenhuma norma informada</div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Resumo dos Requisitos
                    </div>
                    <div className="space-y-1 text-xs text-slate-300 tabular-nums">
                      <div>
                        Ativos: <strong className="text-white">{selectedActivitySummary.totalAtivos}</strong>{' '}
                        <span className="text-slate-500">·</span> Bloqueantes:{' '}
                        <strong className="text-amber-400">{selectedActivitySummary.bloqueantes}</strong>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Empresa: {selectedActivitySummary.empresa} · Terceiro:{' '}
                        {selectedActivitySummary.colaborador} · Atividade/PT:{' '}
                        {selectedActivitySummary.atividadePt}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risks */}
                <div className="pt-4 border-t border-slate-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Riscos Associados
                  </div>
                  {selectedActivity.riscosAssociados.length > 0 ? (
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-300">
                      {selectedActivity.riscosAssociados.map((risco, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <ShieldAlert size={13} className="text-amber-400 shrink-0 mt-0.5" />
                          <span>{risco}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">Nenhum risco cadastrado para esta atividade.</p>
                  )}
                </div>
              </div>

              {/* Mandatory Documents List */}
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <div className="p-5 border-b border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <ShieldCheck size={17} className="text-blue-400" />
                        Documentos Obrigatórios da Atividade
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Regras avaliadas automaticamente pelo motor de conformidade para empresas contratadas e terceirizados
                      </p>
                    </div>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={openCreateReqModal}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shrink-0"
                      >
                        <Plus size={14} />
                        Adicionar Requisito
                      </button>
                    )}
                  </div>

                  {/* Scope Filter & Show Inactive Toggle */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto">
                      {(
                        [
                          { key: 'todos', label: 'Todos os Escopos' },
                          { key: 'empresa', label: 'Empresa' },
                          { key: 'colaborador', label: 'Colaborador' },
                          { key: 'atividade_pt', label: 'Atividade / PT' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setReqScopeFilter(tab.key)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                            reqScopeFilter === tab.key
                              ? 'bg-slate-800 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showInactiveReqs}
                        onChange={(e) => setShowInactiveReqs(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                      />
                      Exibir inativos
                    </label>
                  </div>
                </div>

                {/* Requirements Table/List */}
                {selectedActivityRequirements.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-300">
                      Nenhum requisito documental encontrado para este filtro.
                    </p>
                    <p className="text-xs text-slate-500">
                      {isAdmin
                        ? 'Adicione documentos obrigatórios clicando em "Adicionar Requisito" ou ajuste o filtro de escopo.'
                        : 'Ajuste o filtro de escopo para visualizar os demais requisitos.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/80">
                    {selectedActivityRequirements.map((req) => (
                      <div
                        key={req.id}
                        className={`p-4 sm:px-5 transition-colors ${
                          req.ativo ? 'hover:bg-slate-800/35' : 'bg-slate-950/40 opacity-70'
                        }`}
                      >
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span
                                className={`text-sm font-semibold ${
                                  req.ativo ? 'text-white' : 'text-slate-400 line-through'
                                }`}
                              >
                                {req.nomeExibicao}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                              <span className="font-mono text-blue-300">
                                {req.documentoCodigoCanonico}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{SCOPE_LABELS[req.escopo]}</span>
                              <span aria-hidden="true">·</span>
                              <span>{COLLECTION_LABELS[req.origemColecao]}</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  req.obrigatorioParaLiberacao
                                    ? 'text-amber-400 font-semibold'
                                    : 'text-slate-400'
                                }
                              >
                                {req.obrigatorioParaLiberacao
                                  ? 'Bloqueante na liberação'
                                  : 'Recomendado (não bloqueante)'}
                              </span>
                              {!req.ativo && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-red-400 font-medium">Inativo</span>
                                </>
                              )}
                            </div>

                            {req.descricao && (
                              <p className="text-xs text-slate-400 leading-relaxed">
                                {req.descricao}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-slate-400">
                              <span>
                                <strong className="text-slate-300 font-medium">Funções:</strong>{' '}
                                {req.funcoesAplicaveis && req.funcoesAplicaveis.length > 0
                                  ? req.funcoesAplicaveis.join(', ')
                                  : 'Todos os terceirizados executantes'}
                              </span>

                              {req.exigeAptoASO && (
                                <span>
                                  <strong className="text-slate-300 font-medium">ASO:</strong> Apto
                                  obrigatório
                                  {req.aptidaoEspecifica
                                    ? ` (aptidão: ${req.aptidaoEspecifica})`
                                    : ''}
                                </span>
                              )}

                              {req.validadePadraoMeses !== undefined && req.validadePadraoMeses > 0 && (
                                <span className="tabular-nums">
                                  <strong className="text-slate-300 font-medium">
                                    Validade padrão:
                                  </strong>{' '}
                                  {req.validadePadraoMeses} meses
                                </span>
                              )}

                              {req.baseLegal && (
                                <span>
                                  <strong className="text-slate-300 font-medium">Base legal:</strong>{' '}
                                  {req.baseLegal}
                                </span>
                              )}
                            </div>

                            {req.palavrasChaveMatch && req.palavrasChaveMatch.length > 0 && (
                              <div className="text-[11px] text-slate-500">
                                Palavras-chave legado: {req.palavrasChaveMatch.join(', ')}
                              </div>
                            )}
                          </div>

                          {isAdmin && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditReqModal(req)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                              >
                                <Edit2 size={13} />
                                Editar
                              </button>

                              {req.ativo ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeactivateTarget({
                                      kind: 'requirement',
                                      id: req.id,
                                      title: req.nomeExibicao,
                                    })
                                  }
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/50 text-red-300 border border-red-800/60 text-xs font-medium transition-colors"
                                >
                                  <PowerOff size={13} />
                                  Desativar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleReactivateReq(req)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/60 text-xs font-medium transition-colors"
                                >
                                  <Power size={13} />
                                  Reativar
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Modal: Create / Edit ActivityProfile */}
      {isActivityModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingActivity ? 'Editar Atividade Crítica' : 'Nova Atividade Crítica'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defina os dados, riscos, normas e controles exigidos para terceiros
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsActivityModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveActivity} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              {activityFormError && (
                <div className="rounded-lg bg-red-950/50 border border-red-800/70 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2">
                  <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{activityFormError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nome da Atividade *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    value={activityForm.nome}
                    onChange={(e) => setActivityForm((prev) => ({ ...prev, nome: e.target.value }))}
                    placeholder="Ex.: Trabalho em Altura — NR-35"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Código Identificador *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={activityForm.codigo}
                    onChange={(e) =>
                      setActivityForm((prev) => ({
                        ...prev,
                        codigo: e.target.value.toUpperCase().replace(/\s+/g, '_'),
                      }))
                    }
                    placeholder="Ex.: TRABALHO_ALTURA"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nível de Risco *
                  </label>
                  <select
                    value={activityForm.nivelRisco}
                    onChange={(e) =>
                      setActivityForm((prev) => ({
                        ...prev,
                        nivelRisco: e.target.value as ActivityRiskLevel,
                      }))
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="baixo">Baixo</option>
                    <option value="medio">Médio</option>
                    <option value="alto">Alto</option>
                    <option value="critico">Crítico</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Normas Aplicáveis (separadas por vírgula)
                  </label>
                  <input
                    type="text"
                    value={activityForm.normasText}
                    onChange={(e) =>
                      setActivityForm((prev) => ({ ...prev, normasText: e.target.value }))
                    }
                    placeholder="Ex.: NR-35, NR-06, NR-01, NR-07"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descrição Operacional
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={activityForm.descricao}
                  onChange={(e) =>
                    setActivityForm((prev) => ({ ...prev, descricao: e.target.value }))
                  }
                  placeholder="Descreva o escopo da atividade executada por empresas contratadas..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Riscos Associados (um por linha ou separados por ponto e vírgula)
                </label>
                <textarea
                  rows={3}
                  value={activityForm.riscosText}
                  onChange={(e) =>
                    setActivityForm((prev) => ({ ...prev, riscosText: e.target.value }))
                  }
                  placeholder={'Queda com diferença de nível (> 2,0 m)\nQueda de ferramentas e materiais'}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 border-t border-slate-800">
                <div className="text-xs font-semibold text-slate-300 mb-2.5">
                  Controles de Permissão Exigidos
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { key: 'exigeAPR', label: 'Exige APR' },
                    { key: 'exigePT', label: 'Exige PT' },
                    { key: 'exigeLOTO', label: 'Exige LOTO' },
                    { key: 'exigePET', label: 'Exige PET' },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(activityForm[item.key as keyof ActivityFormState])}
                        onChange={(e) =>
                          setActivityForm((prev) => ({
                            ...prev,
                            [item.key]: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {editingActivity && (
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={activityForm.ativo}
                    onChange={(e) =>
                      setActivityForm((prev) => ({ ...prev, ativo: e.target.checked }))
                    }
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                  />
                  Atividade ativa para vinculação em solicitações e liberações
                </label>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsActivityModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingActivity}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                >
                  {isSavingActivity && <Loader2 size={14} className="animate-spin" />}
                  {editingActivity ? 'Salvar Alterações' : 'Cadastrar Atividade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit ActivityDocumentRequirement */}
      {isReqModalOpen && isAdmin && selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingReq ? 'Editar Requisito Documental' : 'Adicionar Requisito Documental'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Atividade vinculada: <strong className="text-slate-200">{selectedActivity.nome}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReqModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveReq} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              {reqFormError && (
                <div className="rounded-lg bg-red-950/50 border border-red-800/70 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2">
                  <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{reqFormError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nome do Requisito *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={reqForm.nomeExibicao}
                    onChange={(e) =>
                      setReqForm((prev) => ({ ...prev, nomeExibicao: e.target.value }))
                    }
                    placeholder="Ex.: Certificado de Capacitação NR-35 (Trabalho em Altura)"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Código Canônico *
                  </label>
                  <input
                    type="text"
                    list="canonical-codes-list"
                    required
                    maxLength={100}
                    value={reqForm.documentoCodigoCanonico}
                    onChange={(e) =>
                      setReqForm((prev) => ({
                        ...prev,
                        documentoCodigoCanonico: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Ex.: NR-35, ASO, PGR"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <datalist id="canonical-codes-list">
                    {CANONICAL_CODE_SUGGESTIONS.map((code) => (
                      <option key={code} value={code} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Escopo da Exigência *
                  </label>
                  <select
                    value={reqForm.escopo}
                    onChange={(e) =>
                      setReqForm((prev) => ({
                        ...prev,
                        escopo: e.target.value as ActivityRequirementScope,
                      }))
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="empresa">Empresa Contratada</option>
                    <option value="colaborador">Colaborador Terceirizado</option>
                    <option value="atividade_pt">Atividade / PT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Coleção de Origem *
                  </label>
                  <select
                    value={reqForm.origemColecao}
                    onChange={(e) => {
                      const nextCol = e.target.value as ActivityRequirementSourceCollection;
                      setReqForm((prev) => ({
                        ...prev,
                        origemColecao: nextCol,
                        exigeAptoASO: nextCol === 'exams' ? true : prev.exigeAptoASO,
                      }));
                    }}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="trainings">Treinamentos (trainings)</option>
                    <option value="exams">Exames e ASO (exams)</option>
                    <option value="documents">Documentos (documents)</option>
                    <option value="epiDeliveries">Entrega de EPI (epiDeliveries)</option>
                    <option value="safetyPermits">APR / PT / LOTO (safetyPermits)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Palavras-chave para Documentos Legados (separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={reqForm.palavrasChaveText}
                  onChange={(e) =>
                    setReqForm((prev) => ({ ...prev, palavrasChaveText: e.target.value }))
                  }
                  placeholder="Ex.: nr-35, nr 35, nr35, trabalho em altura"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Utilizado quando documentos antigos ainda não possuem código canônico preenchido.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Cargos / Funções Aplicáveis (separados por vírgula — opcional)
                </label>
                <input
                  type="text"
                  value={reqForm.funcoesText}
                  onChange={(e) =>
                    setReqForm((prev) => ({ ...prev, funcoesText: e.target.value }))
                  }
                  placeholder="Ex.: supervisor de entrada, eletricista sep, soldador"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Deixe em branco para exigir de todos os terceirizados escalados para esta atividade.
                </p>
              </div>

              {/* ASO & Aptitude Controls */}
              <div
                className={`rounded-lg border p-3.5 space-y-3 ${
                  isAsoContext
                    ? 'bg-slate-950/90 border-blue-900/60'
                    : 'bg-slate-950/40 border-slate-800'
                }`}
              >
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={reqForm.exigeAptoASO}
                    onChange={(e) =>
                      setReqForm((prev) => ({ ...prev, exigeAptoASO: e.target.checked }))
                    }
                    className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                  />
                  Exigir conclusão APTO no ASO (bloqueia se inapto ou com restrições)
                </label>

                {reqForm.exigeAptoASO && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Aptidão Específica Exigida no ASO (opcional)
                    </label>
                    <input
                      type="text"
                      list="aptitude-suggestions-list"
                      maxLength={100}
                      value={reqForm.aptidaoEspecifica}
                      onChange={(e) =>
                        setReqForm((prev) => ({ ...prev, aptidaoEspecifica: e.target.value }))
                      }
                      placeholder="Ex.: trabalho_altura, espaco_confinado, eletricidade"
                      className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                    <datalist id="aptitude-suggestions-list">
                      {APTITUDE_SUGGESTIONS.map((apt) => (
                        <option key={apt} value={apt} />
                      ))}
                    </datalist>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Validade Padrão (meses)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    value={reqForm.validadePadraoMeses}
                    onChange={(e) =>
                      setReqForm((prev) => ({ ...prev, validadePadraoMeses: e.target.value }))
                    }
                    placeholder="Ex.: 24"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Ordem de Exibição
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={reqForm.ordemExibicao}
                    onChange={(e) =>
                      setReqForm((prev) => ({ ...prev, ordemExibicao: e.target.value }))
                    }
                    placeholder="Ex.: 1"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Base Legal Aplicável
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={reqForm.baseLegal}
                    onChange={(e) =>
                      setReqForm((prev) => ({ ...prev, baseLegal: e.target.value }))
                    }
                    placeholder="Ex.: NR-35 / NR-07"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Descrição / Orientação Técnica
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={reqForm.descricao}
                  onChange={(e) =>
                    setReqForm((prev) => ({ ...prev, descricao: e.target.value }))
                  }
                  placeholder="Detalhe o critério de aceitação deste documento para terceirizados..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={reqForm.obrigatorioParaLiberacao}
                    onChange={(e) =>
                      setReqForm((prev) => ({
                        ...prev,
                        obrigatorioParaLiberacao: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                  />
                  Exigência bloqueante (impede liberação da atividade se ausente, vencida, inapta ou pendente)
                </label>

                {editingReq && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reqForm.ativo}
                      onChange={(e) =>
                        setReqForm((prev) => ({ ...prev, ativo: e.target.checked }))
                      }
                      className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                    />
                    Requisito ativo
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsReqModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingReq}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                >
                  {isSavingReq && <Loader2 size={14} className="animate-spin" />}
                  {editingReq ? 'Salvar Requisito' : 'Adicionar Requisito'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmation before Deactivation */}
      {deactivateTarget && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400 border border-red-500/30">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Confirmar desativação
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Deseja desativar{' '}
                  {deactivateTarget.kind === 'activity' ? 'a atividade' : 'o requisito documental'}{' '}
                  <strong className="text-white">"{deactivateTarget.title}"</strong>?
                </p>
                <p className="text-[11px] text-slate-400 mt-2">
                  O registro será marcado como inativo para preservar a trilha de auditoria e poderá ser reativado posteriormente pelo Administrador EHS.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeactivateTarget(null)}
                disabled={isDeactivating}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={isDeactivating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
              >
                {isDeactivating && <Loader2 size={14} className="animate-spin" />}
                Confirmar Desativação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
