import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  FileDown,
  User,
  Building2,
  Briefcase,
  ShieldCheck,
  HeartPulse,
  GraduationCap,
  FileText,
  History,
  Layers,
  Upload,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { ConclusaoAptidao, DocumentSST, Employee, OccupationalExam, Training } from '../../types/sst';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { formatCPF, formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';
import { generateIndividualEmployeePDF } from '../../utils/exportUtils';
import { evaluateActivityCompliance } from '../../utils/activityComplianceEngine';
import { ComplianceChecklistPanel } from './ComplianceChecklistPanel';
import { ProtectedDocumentButton } from '../common/ProtectedDocumentButton';
import {
  STANDARDIZED_STATUS_META,
  resolveIntegrationItemStandardizedStatus,
} from '../../utils/documentStatus';

interface EmployeeDossierModalProps {
  employee: Employee;
  openUploadOnMount?: boolean;
  onClose: () => void;
}

const MAX_DIRECT_FILE_BYTES = 700 * 1024;

type DirectUploadKind = 'documento' | 'exame' | 'treinamento';

function formatDateTimeBR(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const EmployeeDossierModal: React.FC<EmployeeDossierModalProps> = ({
  employee,
  openUploadOnMount = false,
  onClose,
}) => {
  const {
    companies,
    employees,
    documents,
    trainings,
    exams,
    epiDeliveries,
    safetyPermits,
    activityProfiles,
    activityDocumentRequirements,
    smartDocs,
    auditLogs,
    contractorIntegrationItems,
    addDocument,
    updateDocument,
    approveDocument,
    rejectDocument,
    addExam,
    updateExam,
    approveExam,
    rejectExam,
    addTraining,
    updateTraining,
    approveTraining,
    rejectTraining,
  } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId, profile } = useAuth();

  const liveEmployee = useMemo(
    () => employees.find((e) => e.id === employee.id) || employee,
    [employees, employee]
  );

  const canUploadForEmployee =
    isAdmin || (isSolicitante && Boolean(activeEmpresaId) && activeEmpresaId === liveEmployee.empresaId);

  const [activeTab, setActiveTab] = useState<
    'visao_geral' | 'conformidade_atividade' | 'documentos' | 'exames' | 'treinamentos' | 'historico'
  >('visao_geral');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Direct Upload / Resubmit modal state (ZERO minimum file count requirement)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<DirectUploadKind>('documento');
  const [resubmitTarget, setResubmitTarget] = useState<
    | { kind: 'documento'; item: DocumentSST }
    | { kind: 'exame'; item: OccupationalExam }
    | { kind: 'treinamento'; item: Training }
    | null
  >(null);
  const [uploadForm, setUploadForm] = useState({
    titulo: '',
    categoria: 'Documento Individual',
    numero: '',
    conclusao: 'apto' as ConclusaoAptidao,
    medicoResponsavel: '',
    crmMedico: '',
    cargaHoraria: '',
    instrutor: '',
    dataEmissao: new Date().toISOString().slice(0, 10),
    dataValidade: '',
    semValidade: false,
    observacoes: '',
    arquivoNome: '',
    arquivoUrl: '',
  });
  const [submittingUpload, setSubmittingUpload] = useState(false);

  // Admin: Reject justification modal
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'documento'; id: string; title: string }
    | { kind: 'exame'; id: string; title: string }
    | { kind: 'treinamento'; id: string; title: string }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  useEffect(() => {
    if (openUploadOnMount && canUploadForEmployee) {
      openFreshUpload('documento');
    }
  }, [openUploadOnMount, canUploadForEmployee]);

  const activeActivities = useMemo(
    () => activityProfiles.filter((a) => a.ativo),
    [activityProfiles]
  );

  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>(() => {
    const enabled = (liveEmployee.atividadesHabilitadasIds || []).filter((id) =>
      activityProfiles.some((a) => a.id === id && a.ativo)
    );
    if (enabled.length > 0) return enabled;
    return activeActivities.slice(0, 1).map((a) => a.id);
  });

  const linkedCompany = companies.find((c) => c.id === liveEmployee.empresaId);
  const empDocs = documents.filter((d) => d.colaboradorId === liveEmployee.id);
  const empTrainings = trainings.filter((t) => t.colaboradorId === liveEmployee.id);
  const empExams = exams.filter((e) => e.colaboradorId === liveEmployee.id);
  const empEpis = epiDeliveries.filter((ep) => ep.colaboradorId === liveEmployee.id);
  const empLogs = auditLogs.filter(
    (l) => l.entidadeId === liveEmployee.id || l.detalhes.includes(liveEmployee.nomeCompleto)
  );

  const normalizedCpf = liveEmployee.cpf.replace(/\D/g, '');
  const empIntegrationItems = useMemo(
    () =>
      contractorIntegrationItems.filter(
        (it) =>
          it.colaboradorId === liveEmployee.id ||
          (normalizedCpf &&
            it.colaboradorCpf &&
            it.colaboradorCpf.replace(/\D/g, '') === normalizedCpf)
      ),
    [contractorIntegrationItems, liveEmployee.id, normalizedCpf]
  );

  const employeeActivityCompliance = useMemo(() => {
    if (!linkedCompany || selectedActivityIds.length === 0) return null;
    return evaluateActivityCompliance({
      company: linkedCompany,
      atividadeIds: selectedActivityIds,
      colaboradorIds: [liveEmployee.id],
      activityProfiles,
      requirements: activityDocumentRequirements,
      employees,
      documents,
      trainings,
      exams,
      epiDeliveries,
      safetyPermits,
      smartDocs,
    });
  }, [
    linkedCompany,
    selectedActivityIds,
    liveEmployee.id,
    activityProfiles,
    activityDocumentRequirements,
    employees,
    documents,
    trainings,
    exams,
    epiDeliveries,
    safetyPermits,
    smartDocs,
  ]);

  const toggleEvalActivity = (actId: string) => {
    setSelectedActivityIds((prev) =>
      prev.includes(actId) ? prev.filter((id) => id !== actId) : [...prev, actId]
    );
  };

  let validCount = 0;
  let warningCount = 0;
  let expiredCount = 0;
  let pendingCount = 0;

  const allItems = [
    ...empDocs.map((d) => ({
      type: 'Documento',
      name: d.nomeDocumento,
      validade: d.dataValidade,
      semValidade: d.semValidade,
      status: d.situacao,
    })),
    ...empTrainings.map((t) => ({
      type: 'Treinamento',
      name: t.nomeTreinamento,
      validade: t.dataValidade,
      semValidade: t.semValidade,
      status: t.situacao,
    })),
    ...empExams.map((e) => ({
      type: 'ASO / Exame',
      name: `${e.tipoExame} (${e.conclusao.toUpperCase()})`,
      validade: e.dataValidade,
      semValidade: e.semValidade,
      status: e.situacao,
    })),
  ];

  allItems.forEach((it) => {
    const f = getTrafficLightStatus(it.validade, it.semValidade, it.status);
    if (f.status === 'verde') validCount++;
    else if (f.status === 'amarelo') warningCount++;
    else if (f.status === 'vermelho') expiredCount++;
    else pendingCount++;
  });

  const handleDownloadPDF = () => {
    generateIndividualEmployeePDF(
      liveEmployee,
      linkedCompany,
      empDocs,
      empTrainings,
      empExams,
      empEpis
    );
  };

  const openFreshUpload = (kind: DirectUploadKind) => {
    setResubmitTarget(null);
    setUploadKind(kind);
    setUploadForm({
      titulo: kind === 'exame' ? 'ASO Periódico' : '',
      categoria: 'Documento Individual',
      numero: '',
      conclusao: 'apto',
      medicoResponsavel: '',
      crmMedico: '',
      cargaHoraria: '8h',
      instrutor: '',
      dataEmissao: new Date().toISOString().slice(0, 10),
      dataValidade: '',
      semValidade: false,
      observacoes: '',
      arquivoNome: '',
      arquivoUrl: '',
    });
    setIsUploadModalOpen(true);
  };

  const openResubmit = (
    target:
      | { kind: 'documento'; item: DocumentSST }
      | { kind: 'exame'; item: OccupationalExam }
      | { kind: 'treinamento'; item: Training }
  ) => {
    setResubmitTarget(target);
    setUploadKind(target.kind);
    if (target.kind === 'documento') {
      const d = target.item;
      setUploadForm({
        titulo: d.nomeDocumento,
        categoria: d.categoria || 'Documento Individual',
        numero: d.numeroDocumento || '',
        conclusao: 'apto',
        medicoResponsavel: '',
        crmMedico: '',
        cargaHoraria: '',
        instrutor: '',
        dataEmissao: d.dataEmissao || new Date().toISOString().slice(0, 10),
        dataValidade: d.semValidade ? '' : d.dataValidade || '',
        semValidade: Boolean(d.semValidade),
        observacoes: d.observacoes || '',
        arquivoNome: d.arquivoNome || '',
        arquivoUrl: d.arquivoUrl || '',
      });
    } else if (target.kind === 'exame') {
      const ex = target.item;
      setUploadForm({
        titulo: ex.tipoExame,
        categoria: 'Exame / ASO',
        numero: '',
        conclusao: ex.conclusao,
        medicoResponsavel: ex.medicoResponsavel || '',
        crmMedico: ex.crmMedico || '',
        cargaHoraria: '',
        instrutor: '',
        dataEmissao: ex.dataRealizacao || new Date().toISOString().slice(0, 10),
        dataValidade: ex.semValidade ? '' : ex.dataValidade || '',
        semValidade: Boolean(ex.semValidade),
        observacoes: ex.observacoes || '',
        arquivoNome: ex.anexoNome || '',
        arquivoUrl: ex.anexoUrl || '',
      });
    } else {
      const tr = target.item;
      setUploadForm({
        titulo: tr.nomeTreinamento,
        categoria: 'Treinamento / NR',
        numero: '',
        conclusao: 'apto',
        medicoResponsavel: '',
        crmMedico: '',
        cargaHoraria: tr.cargaHoraria || '',
        instrutor: tr.instrutor || '',
        dataEmissao: tr.dataRealizacao || new Date().toISOString().slice(0, 10),
        dataValidade: tr.semValidade ? '' : tr.dataValidade || '',
        semValidade: Boolean(tr.semValidade),
        observacoes: tr.observacoes || '',
        arquivoNome: tr.certificadoNome || '',
        arquivoUrl: tr.certificadoUrl || '',
      });
    }
    setIsUploadModalOpen(true);
  };

  const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_DIRECT_FILE_BYTES) {
      setFeedback({
        type: 'error',
        text: 'O arquivo excede o limite de 700 KB para envio direto. Comprima o PDF/imagem e tente novamente.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setUploadForm((prev) => ({
          ...prev,
          arquivoNome: file.name,
          arquivoUrl: String(ev.target?.result),
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitDirectUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!uploadForm.titulo.trim()) {
      setFeedback({ type: 'error', text: 'Informe o nome/título do documento.' });
      return;
    }
    if (!uploadForm.semValidade && !uploadForm.dataValidade) {
      setFeedback({
        type: 'error',
        text: 'Informe a data de validade ou marque "Sem data de validade".',
      });
      return;
    }

    setSubmittingUpload(true);
    try {
      const targetStatus = isAdmin ? 'aprovado' : 'pendente';

      if (uploadKind === 'documento') {
        if (resubmitTarget && resubmitTarget.kind === 'documento') {
          await updateDocument(resubmitTarget.item.id, {
            nomeDocumento: uploadForm.titulo.trim(),
            categoria: uploadForm.categoria,
            numeroDocumento: uploadForm.numero.trim(),
            dataEmissao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            arquivoNome: uploadForm.arquivoNome,
            arquivoUrl: uploadForm.arquivoUrl,
            situacao: targetStatus,
            motivoReprovacao: '',
            origemEnvio: isAdmin ? 'admin' : 'colaborador',
          });
        } else {
          await addDocument({
            empresaId: liveEmployee.empresaId,
            empresaNome: liveEmployee.empresaNome,
            colaboradorId: liveEmployee.id,
            colaboradorNome: liveEmployee.nomeCompleto,
            nomeDocumento: uploadForm.titulo.trim(),
            categoria: uploadForm.categoria,
            numeroDocumento: uploadForm.numero.trim(),
            dataEmissao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            arquivoNome: uploadForm.arquivoNome,
            arquivoUrl: uploadForm.arquivoUrl,
            responsavelEnvio: profile?.nome || 'Usuário',
            versao: 1,
            situacao: targetStatus,
            origemEnvio: isAdmin ? 'admin' : 'colaborador',
            solicitacaoCodigo: `COL-${liveEmployee.cpf.replace(/\D/g, '').slice(0, 6) || liveEmployee.id.slice(0, 6)}`,
          });
        }
        setActiveTab('documentos');
      } else if (uploadKind === 'exame') {
        if (resubmitTarget && resubmitTarget.kind === 'exame') {
          await updateExam(resubmitTarget.item.id, {
            tipoExame: uploadForm.titulo.trim(),
            conclusao: uploadForm.conclusao,
            medicoResponsavel: uploadForm.medicoResponsavel.trim(),
            crmMedico: uploadForm.crmMedico.trim(),
            dataRealizacao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            anexoNome: uploadForm.arquivoNome,
            anexoUrl: uploadForm.arquivoUrl,
            situacao: targetStatus,
            motivoReprovacao: '',
          });
        } else {
          await addExam({
            empresaId: liveEmployee.empresaId,
            empresaNome: liveEmployee.empresaNome,
            colaboradorId: liveEmployee.id,
            colaboradorNome: liveEmployee.nomeCompleto,
            tipoExame: uploadForm.titulo.trim(),
            conclusao: uploadForm.conclusao,
            medicoResponsavel: uploadForm.medicoResponsavel.trim(),
            crmMedico: uploadForm.crmMedico.trim(),
            dataRealizacao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            anexoNome: uploadForm.arquivoNome,
            anexoUrl: uploadForm.arquivoUrl,
            situacao: targetStatus,
          });
        }
        setActiveTab('exames');
      } else {
        if (resubmitTarget && resubmitTarget.kind === 'treinamento') {
          await updateTraining(resubmitTarget.item.id, {
            nomeTreinamento: uploadForm.titulo.trim(),
            cargaHoraria: uploadForm.cargaHoraria.trim(),
            instrutor: uploadForm.instrutor.trim(),
            dataRealizacao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            certificadoNome: uploadForm.arquivoNome,
            certificadoUrl: uploadForm.arquivoUrl,
            situacao: targetStatus,
            motivoReprovacao: '',
          });
        } else {
          await addTraining({
            empresaId: liveEmployee.empresaId,
            empresaNome: liveEmployee.empresaNome,
            colaboradorId: liveEmployee.id,
            colaboradorNome: liveEmployee.nomeCompleto,
            nomeTreinamento: uploadForm.titulo.trim(),
            cargaHoraria: uploadForm.cargaHoraria.trim(),
            instrutor: uploadForm.instrutor.trim(),
            dataRealizacao: uploadForm.dataEmissao,
            dataValidade: uploadForm.semValidade ? '' : uploadForm.dataValidade,
            semValidade: uploadForm.semValidade,
            observacoes: uploadForm.observacoes.trim(),
            certificadoNome: uploadForm.arquivoNome,
            certificadoUrl: uploadForm.arquivoUrl,
            situacao: targetStatus,
          });
        }
        setActiveTab('treinamentos');
      }

      setFeedback({
        type: 'success',
        text: isAdmin
          ? `"${uploadForm.titulo}" incluído no dossiê do colaborador.`
          : `"${uploadForm.titulo}" enviado com sucesso e aguardando avaliação do Administrador EHS.`,
      });
      setIsUploadModalOpen(false);
      setResubmitTarget(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao enviar documento do colaborador.',
      });
    } finally {
      setSubmittingUpload(false);
    }
  };

  const handleApproveItem = async (kind: DirectUploadKind, id: string, title: string) => {
    if (!isAdmin) return;
    setSubmittingDecision(true);
    setFeedback(null);
    try {
      if (kind === 'documento') await approveDocument(id);
      else if (kind === 'exame') await approveExam(id);
      else await approveTraining(id);
      setFeedback({
        type: 'success',
        text: `"${title}" aceito/aprovado e espelhado para a contratada.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao aprovar item.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !isAdmin) return;
    if (!rejectReason.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe obrigatoriamente a justificativa da recusa.',
      });
      return;
    }

    setSubmittingDecision(true);
    setFeedback(null);
    try {
      if (rejectTarget.kind === 'documento') {
        await rejectDocument(rejectTarget.id, rejectReason.trim());
      } else if (rejectTarget.kind === 'exame') {
        await rejectExam(rejectTarget.id, rejectReason.trim());
      } else {
        await rejectTraining(rejectTarget.id, rejectReason.trim());
      }
      setFeedback({
        type: 'success',
        text: `"${rejectTarget.title}" recusado com justificativa registrada e visível para a contratada.`,
      });
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao registrar recusa.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-blue-600/20 text-blue-400">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Dossiê Individual do Colaborador
              </h3>
              <p className="text-xs text-slate-400">
                Prontuário de documentos, exames ocupacionais (ASO), treinamentos e histórico de avaliações
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canUploadForEmployee && (
              <button
                type="button"
                onClick={() => openFreshUpload('documento')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20"
              >
                <Upload size={14} />
                Enviar Documento
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              title="Gerar Relatório Individual em PDF"
            >
              <FileDown size={14} />
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Employee Header Profile Strip */}
        <div className="p-5 bg-slate-900/90 border-b border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              {liveEmployee.fotoUrl ? (
                <img
                  src={liveEmployee.fotoUrl}
                  alt={liveEmployee.nomeCompleto}
                  className="h-16 w-16 rounded-2xl object-cover border-2 border-blue-500/50 shadow-md"
                />
              ) : (
                <div className="h-16 w-16 rounded-2xl bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-400">
                  <User size={30} />
                </div>
              )}
              <span
                className={`absolute -bottom-1.5 -right-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                  liveEmployee.situacaoCadastral === 'ativo'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-amber-500 text-slate-950'
                }`}
              >
                {liveEmployee.situacaoCadastral}
              </span>
            </div>

            <div>
              <h2 className="text-lg font-bold text-white">{liveEmployee.nomeCompleto}</h2>
              <p className="text-xs text-blue-400 font-medium flex items-center gap-1.5 mt-0.5">
                <Briefcase size={13} />
                {liveEmployee.cargo} • {liveEmployee.setor || 'Geral'}
              </p>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                <Building2 size={13} />
                {liveEmployee.empresaNome}
                <span className="font-mono text-slate-400">· CPF {formatCPF(liveEmployee.cpf)}</span>
              </p>
            </div>
          </div>

          {/* Traffic Light Counter Strip */}
          <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-emerald-400">{validCount}</span>
              <span className="text-[10px] text-slate-400">Válidos</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-amber-400">{warningCount}</span>
              <span className="text-[10px] text-slate-400">Vencendo</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-rose-400">{expiredCount}</span>
              <span className="text-[10px] text-slate-400">Irregulares</span>
            </div>
            <div className="text-center px-3">
              <span className="block text-base font-extrabold text-sky-400">{pendingCount}</span>
              <span className="text-[10px] text-slate-400">Em Análise</span>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`mx-6 mt-3 rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-2 ${
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

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-900/50 overflow-x-auto text-xs">
          {[
            { id: 'visao_geral' as const, label: 'Visão Geral', icon: null },
            {
              id: 'documentos' as const,
              label: `Documentos (${empDocs.length + empIntegrationItems.length})`,
              icon: <FileText size={14} />,
            },
            {
              id: 'exames' as const,
              label: `Exames e ASO (${empExams.length})`,
              icon: <HeartPulse size={14} />,
            },
            {
              id: 'treinamentos' as const,
              label: `Treinamentos (${empTrainings.length})`,
              icon: <GraduationCap size={14} />,
            },
            {
              id: 'conformidade_atividade' as const,
              label: 'Conformidade Matriz',
              icon: <Layers size={14} />,
            },
            {
              id: 'historico' as const,
              label: `Histórico (${empLogs.length})`,
              icon: <History size={14} />,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400 font-bold'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar text-xs">
          {/* TAB 1: VISÃO GERAL */}
          {activeTab === 'visao_geral' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-blue-400 mb-2">
                    Dados Pessoais
                  </h4>
                  <p className="flex justify-between">
                    <span className="text-slate-400">CPF:</span>
                    <span className="font-mono text-slate-200">{formatCPF(liveEmployee.cpf)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">RG:</span>
                    <span className="text-slate-200">{liveEmployee.rg || 'Não informado'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Nascimento:</span>
                    <span className="text-slate-200">{formatDateBR(liveEmployee.dataNascimento)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Telefone:</span>
                    <span className="text-slate-200">{liveEmployee.telefone || 'Não informado'}</span>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-blue-400 mb-2">
                    Dados Profissionais & Alocação
                  </h4>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Empresa:</span>
                    <span className="text-slate-200 font-semibold">{liveEmployee.empresaNome}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Matrícula:</span>
                    <span className="font-mono text-slate-200">{liveEmployee.matricula || '-'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Admissão:</span>
                    <span className="text-slate-200">{formatDateBR(liveEmployee.dataAdmissao)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Integração SST:</span>
                    <span className="text-slate-200">{formatDateBR(liveEmployee.dataIntegracao)}</span>
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <h4 className="font-bold text-xs uppercase tracking-wider text-blue-400 mb-3">
                  Quadro Geral de Documentos, Exames e Treinamentos
                </h4>
                {allItems.length === 0 ? (
                  <p className="text-slate-400 italic">
                    Nenhum documento, exame ou treinamento vinculado ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {allItems.map((it, idx) => {
                      const f = getTrafficLightStatus(it.validade, it.semValidade, it.status);
                      return (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-lg bg-slate-900 border flex items-center justify-between ${f.borderClass}`}
                        >
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold mr-1.5">
                              [{it.type}]
                            </span>
                            <span className="font-semibold text-slate-200">{it.name}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${f.badgeClass}`}>
                            {it.status === 'pendente'
                              ? 'Aguardando Análise'
                              : it.status === 'reprovado'
                              ? 'Recusado'
                              : f.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: DOCUMENTOS */}
          {activeTab === 'documentos' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-400">
                  Documentos individuais do colaborador (envio livre sem mínimo de arquivos) e documentos recebidos via Integração.
                </p>
                {canUploadForEmployee && (
                  <button
                    type="button"
                    onClick={() => openFreshUpload('documento')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    <Upload size={13} />
                    Enviar Documento Individual
                  </button>
                )}
              </div>

              {empDocs.length === 0 && empIntegrationItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <FileText size={32} className="mx-auto text-slate-500 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum documento individual enviado</p>
                </div>
              ) : (
                <>
                  {empDocs.map((doc) => {
                    const farol = getTrafficLightStatus(
                      doc.dataValidade,
                      doc.semValidade,
                      doc.situacao
                    );
                    return (
                      <div
                        key={doc.id}
                        className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-white text-sm">{doc.nomeDocumento}</span>
                            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">
                              {doc.categoria}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                              {doc.situacao === 'pendente'
                                ? 'Aguardando Análise'
                                : doc.situacao === 'reprovado'
                                ? 'Recusado'
                                : farol.label}
                            </span>
                          </div>
                          <p className="text-slate-400 text-[11px]">
                            Emissão: {formatDateBR(doc.dataEmissao)} · Validade:{' '}
                            {doc.semValidade ? 'Sem Vencimento' : formatDateBR(doc.dataValidade)}
                            {doc.analisadoPor
                              ? ` · Avaliado por ${doc.analisadoPor} em ${formatDateTimeBR(doc.dataAnalise)}`
                              : ''}
                          </p>
                          {doc.motivoReprovacao && (
                            <p className="text-rose-300 text-[11px] bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                              <strong>Motivo da Recusa:</strong> {doc.motivoReprovacao}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {doc.arquivoUrl && (
                            <ProtectedDocumentButton
                              url={doc.arquivoUrl}
                              fileName={doc.arquivoNome || doc.nomeDocumento}
                              title={`Abrir ${doc.nomeDocumento}`}
                              label="Abrir"
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
                            />
                          )}
                          {isAdmin && doc.situacao !== 'aprovado' && (
                            <button
                              type="button"
                              disabled={submittingDecision}
                              onClick={() => handleApproveItem('documento', doc.id, doc.nomeDocumento)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                            >
                              <CheckCircle2 size={13} />
                              Aceitar
                            </button>
                          )}
                          {isAdmin && doc.situacao !== 'reprovado' && (
                            <button
                              type="button"
                              disabled={submittingDecision}
                              onClick={() => {
                                setRejectTarget({
                                  kind: 'documento',
                                  id: doc.id,
                                  title: doc.nomeDocumento,
                                });
                                setRejectReason(doc.motivoReprovacao || '');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                            >
                              <XCircle size={13} />
                              Recusar
                            </button>
                          )}
                          {isSolicitante && canUploadForEmployee && doc.situacao === 'reprovado' && (
                            <button
                              type="button"
                              onClick={() => openResubmit({ kind: 'documento', item: doc })}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                            >
                              <RefreshCw size={12} />
                              Reenviar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {empIntegrationItems.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Documentos Enviados via Gestão de Integração ({empIntegrationItems.length})
                      </h5>
                      {empIntegrationItems.map((it) => {
                        const st = resolveIntegrationItemStandardizedStatus(it, it.protocoloStatus);
                        const meta = STANDARDIZED_STATUS_META[st];
                        return (
                          <div
                            key={it.id}
                            className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2"
                          >
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-white">{it.nomeExibicao}</span>
                                <span className="font-mono text-[10px] text-blue-400">
                                  {it.codigoProtocolo}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                                >
                                  {meta.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Validade: {it.semValidade ? 'Sem validade' : formatDateBR(it.dataValidade)}
                                {it.analisadoPorNome
                                  ? ` · Avaliado por ${it.analisadoPorNome} em ${formatDateTimeBR(it.dataAnalise)}`
                                  : ''}
                              </p>
                              {it.motivoReprovacao && (
                                <p className="text-[11px] text-rose-300">
                                  Motivo da recusa: {it.motivoReprovacao}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB: EXAMES E ASO */}
          {activeTab === 'exames' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-slate-400">Exames ocupacionais e ASOs vinculados ao colaborador.</p>
                {canUploadForEmployee && (
                  <button
                    type="button"
                    onClick={() => openFreshUpload('exame')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    <Upload size={13} />
                    Enviar Exame / ASO
                  </button>
                )}
              </div>

              {empExams.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <HeartPulse size={32} className="mx-auto text-slate-500 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum exame cadastrado</p>
                </div>
              ) : (
                empExams.map((ex) => {
                  const farol = getTrafficLightStatus(ex.dataValidade, ex.semValidade, ex.situacao);
                  return (
                    <div
                      key={ex.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white text-sm">{ex.tipoExame}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              ex.conclusao === 'apto'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {ex.conclusao}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                            {ex.situacao === 'pendente'
                              ? 'Aguardando Análise'
                              : ex.situacao === 'reprovado'
                              ? 'Recusado'
                              : farol.label}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px]">
                          Médico: {ex.medicoResponsavel || 'Não informado'} | CRM: {ex.crmMedico || '-'}
                        </p>
                        <p className="text-slate-400 text-[11px]">
                          Realização: {formatDateBR(ex.dataRealizacao)} | Validade:{' '}
                          {ex.semValidade ? 'Sem Vencimento' : formatDateBR(ex.dataValidade)}
                          {ex.analisadoPor
                            ? ` · Avaliado por ${ex.analisadoPor} em ${formatDateTimeBR(ex.dataAnalise)}`
                            : ''}
                        </p>
                        {ex.motivoReprovacao && (
                          <p className="text-rose-300 text-[11px] bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                            <strong>Motivo da Recusa:</strong> {ex.motivoReprovacao}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {ex.anexoUrl && (
                          <ProtectedDocumentButton
                            url={ex.anexoUrl}
                            fileName={ex.anexoNome || `${ex.tipoExame} - ${liveEmployee.nomeCompleto}`}
                            title="Visualizar ASO"
                            label="Ver ASO"
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
                          />
                        )}
                        {isAdmin && ex.situacao !== 'aprovado' && (
                          <button
                            type="button"
                            disabled={submittingDecision}
                            onClick={() => handleApproveItem('exame', ex.id, ex.tipoExame)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                          >
                            <CheckCircle2 size={13} />
                            Aceitar
                          </button>
                        )}
                        {isAdmin && ex.situacao !== 'reprovado' && (
                          <button
                            type="button"
                            disabled={submittingDecision}
                            onClick={() => {
                              setRejectTarget({ kind: 'exame', id: ex.id, title: ex.tipoExame });
                              setRejectReason(ex.motivoReprovacao || '');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                          >
                            <XCircle size={13} />
                            Recusar
                          </button>
                        )}
                        {isSolicitante && canUploadForEmployee && ex.situacao === 'reprovado' && (
                          <button
                            type="button"
                            onClick={() => openResubmit({ kind: 'exame', item: ex })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                          >
                            <RefreshCw size={12} />
                            Reenviar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB: TREINAMENTOS */}
          {activeTab === 'treinamentos' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-slate-400">Capacitações e certificados de Normas Regulamentadoras (NRs).</p>
                {canUploadForEmployee && (
                  <button
                    type="button"
                    onClick={() => openFreshUpload('treinamento')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    <Upload size={13} />
                    Enviar Treinamento / NR
                  </button>
                )}
              </div>

              {empTrainings.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <GraduationCap size={32} className="mx-auto text-slate-500 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum treinamento registrado</p>
                </div>
              ) : (
                empTrainings.map((tr) => {
                  const farol = getTrafficLightStatus(tr.dataValidade, tr.semValidade, tr.situacao);
                  return (
                    <div
                      key={tr.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white text-sm">{tr.nomeTreinamento}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                            {tr.situacao === 'pendente'
                              ? 'Aguardando Análise'
                              : tr.situacao === 'reprovado'
                              ? 'Recusado'
                              : farol.label}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px]">
                          Carga Horária: {tr.cargaHoraria || '-'} | Instrutor:{' '}
                          {tr.instrutor || 'Não informado'}
                        </p>
                        <p className="text-slate-400 text-[11px]">
                          Realizado em: {formatDateBR(tr.dataRealizacao)} | Vencimento:{' '}
                          {tr.semValidade ? 'Sem Vencimento' : formatDateBR(tr.dataValidade)}
                          {tr.analisadoPor
                            ? ` · Avaliado por ${tr.analisadoPor} em ${formatDateTimeBR(tr.dataAnalise)}`
                            : ''}
                        </p>
                        {tr.motivoReprovacao && (
                          <p className="text-rose-300 text-[11px] bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                            <strong>Motivo da Recusa:</strong> {tr.motivoReprovacao}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {tr.certificadoUrl && (
                          <ProtectedDocumentButton
                            url={tr.certificadoUrl}
                            fileName={
                              tr.certificadoNome ||
                              `${tr.nomeTreinamento} - ${liveEmployee.nomeCompleto}`
                            }
                            title="Visualizar Certificado"
                            label="Certificado"
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
                          />
                        )}
                        {isAdmin && tr.situacao !== 'aprovado' && (
                          <button
                            type="button"
                            disabled={submittingDecision}
                            onClick={() =>
                              handleApproveItem('treinamento', tr.id, tr.nomeTreinamento)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                          >
                            <CheckCircle2 size={13} />
                            Aceitar
                          </button>
                        )}
                        {isAdmin && tr.situacao !== 'reprovado' && (
                          <button
                            type="button"
                            disabled={submittingDecision}
                            onClick={() => {
                              setRejectTarget({
                                kind: 'treinamento',
                                id: tr.id,
                                title: tr.nomeTreinamento,
                              });
                              setRejectReason(tr.motivoReprovacao || '');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                          >
                            <XCircle size={13} />
                            Recusar
                          </button>
                        )}
                        {isSolicitante && canUploadForEmployee && tr.situacao === 'reprovado' && (
                          <button
                            type="button"
                            onClick={() => openResubmit({ kind: 'treinamento', item: tr })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                          >
                            <RefreshCw size={12} />
                            Reenviar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB: CONFORMIDADE POR ATIVIDADE */}
          {activeTab === 'conformidade_atividade' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-white text-xs">
                      Simulação de Conformidade por Atividade (Matriz de EHS)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Verifica ASO, treinamentos e certificados frente aos requisitos da Matriz de EHS.
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {selectedActivityIds.length} atividade(s) selecionada(s)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeActivities.map((act) => {
                    const active = selectedActivityIds.includes(act.id);
                    return (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => toggleEvalActivity(act.id)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {act.nome} ({act.codigo})
                      </button>
                    );
                  })}
                </div>
              </div>

              <ComplianceChecklistPanel
                compliance={employeeActivityCompliance}
                activityProfiles={activityProfiles}
                sourceLabel="preview"
                defaultTab="colaborador"
                compact
              />
            </div>
          )}

          {/* TAB: HISTÓRICO */}
          {activeTab === 'historico' && (
            <div className="space-y-2">
              {empLogs.length === 0 ? (
                <p className="text-slate-400 italic py-6 text-center">
                  Nenhuma alteração ou avaliação registrada recentemente para este colaborador.
                </p>
              ) : (
                empLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-start justify-between gap-4"
                  >
                    <div>
                      <span className="font-semibold text-white">{log.acao}</span>
                      <p className="text-slate-400 text-[11px] mt-0.5">{log.detalhes}</p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Responsável: {log.usuario} ({log.usuarioEmail})
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {formatDateTimeBR(log.dataHora)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-between items-center">
          <span className="text-[11px] text-slate-400">
            Conforme NR-01, NR-07 e Lei Geral de Proteção de Dados (LGPD)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
          >
            Fechar Dossiê
          </button>
        </div>
      </div>

      {/* Direct Employee Document / Exam / Training Upload Modal (NO minimum file count) */}
      {isUploadModalOpen && canUploadForEmployee && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleSubmitDirectUpload}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Upload size={17} className="text-blue-400" />
                  {resubmitTarget
                    ? 'Corrigir e Reenviar Documento'
                    : 'Enviar Documento do Colaborador'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {liveEmployee.nomeCompleto} · Envio individual livre (sem mínimo de documentos)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setResubmitTarget(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {!resubmitTarget && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { id: 'documento' as const, label: 'Documento Individual' },
                  { id: 'exame' as const, label: 'Exame / ASO' },
                  { id: 'treinamento' as const, label: 'Treinamento / NR' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setUploadKind(opt.id)}
                    className={`py-2 px-2.5 rounded-lg border font-semibold transition-colors ${
                      uploadKind === opt.id
                        ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  {uploadKind === 'exame'
                    ? 'Tipo de Exame / ASO *'
                    : uploadKind === 'treinamento'
                    ? 'Nome do Treinamento / NR *'
                    : 'Nome do Documento *'}
                </label>
                <input
                  type="text"
                  required
                  value={uploadForm.titulo}
                  onChange={(e) => setUploadForm({ ...uploadForm, titulo: e.target.value })}
                  placeholder={
                    uploadKind === 'exame'
                      ? 'Ex: ASO Admissional, ASO Periódico'
                      : uploadKind === 'treinamento'
                      ? 'Ex: NR-35 Trabalho em Altura, NR-10 Básico'
                      : 'Ex: Ficha de Registro, Ordem de Serviço NR-01, CNH'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              {uploadKind === 'exame' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Conclusão</label>
                    <select
                      value={uploadForm.conclusao}
                      onChange={(e) =>
                        setUploadForm({
                          ...uploadForm,
                          conclusao: e.target.value as ConclusaoAptidao,
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="apto">Apto</option>
                      <option value="apto_com_restricoes">Apto com Restrições</option>
                      <option value="inapto">Inapto</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Médico</label>
                    <input
                      type="text"
                      value={uploadForm.medicoResponsavel}
                      onChange={(e) =>
                        setUploadForm({ ...uploadForm, medicoResponsavel: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">CRM</label>
                    <input
                      type="text"
                      value={uploadForm.crmMedico}
                      onChange={(e) => setUploadForm({ ...uploadForm, crmMedico: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                </div>
              )}

              {uploadKind === 'treinamento' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Carga Horária</label>
                    <input
                      type="text"
                      value={uploadForm.cargaHoraria}
                      onChange={(e) =>
                        setUploadForm({ ...uploadForm, cargaHoraria: e.target.value })
                      }
                      placeholder="Ex: 8h, 16h, 40h"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">
                      Instrutor / Entidade
                    </label>
                    <input
                      type="text"
                      value={uploadForm.instrutor}
                      onChange={(e) => setUploadForm({ ...uploadForm, instrutor: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Data de Emissão / Realização
                  </label>
                  <input
                    type="date"
                    value={uploadForm.dataEmissao}
                    onChange={(e) => setUploadForm({ ...uploadForm, dataEmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Data de Validade</label>
                  <input
                    type="date"
                    disabled={uploadForm.semValidade}
                    required={!uploadForm.semValidade}
                    value={uploadForm.semValidade ? '' : uploadForm.dataValidade}
                    onChange={(e) => setUploadForm({ ...uploadForm, dataValidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white disabled:opacity-40"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadForm.semValidade}
                  onChange={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      semValidade: e.target.checked,
                      dataValidade: e.target.checked ? '' : prev.dataValidade,
                    }))
                  }
                  className="rounded bg-slate-950 border-slate-700 text-blue-600"
                />
                <span>Sem data de validade</span>
              </label>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Arquivo (PDF, JPG ou PNG — até 700 KB)
                </label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png"
                  onChange={handleUploadFileChange}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                />
                {uploadForm.arquivoNome && (
                  <p className="text-[11px] text-emerald-400 mt-1">
                    Arquivo anexado: {uploadForm.arquivoNome}
                  </p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={uploadForm.observacoes}
                  onChange={(e) => setUploadForm({ ...uploadForm, observacoes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setResubmitTarget(null);
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submittingUpload}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {submittingUpload
                  ? 'Enviando...'
                  : resubmitTarget
                  ? 'Reenviar para Avaliação'
                  : 'Enviar para Avaliação EHS'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin: Mandatory Justification Reject Modal */}
      {rejectTarget && isAdmin && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmReject}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <XCircle size={16} className="text-rose-400" />
                Recusar Documento (Justificativa Obrigatória)
              </h3>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Item: <strong className="text-white">{rejectTarget.title}</strong> ·{' '}
              {liveEmployee.nomeCompleto}
            </p>
            <div>
              <label className="block text-xs font-semibold text-rose-300 mb-1.5">
                Justificativa da Recusa *
              </label>
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Descreva claramente o motivo da recusa para orientação de reenvio da contratada..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submittingDecision}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {submittingDecision ? 'Salvando...' : 'Confirmar Recusa'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
