import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  FileText,
  X,
  Users,
  Layers,
  CheckCircle2,
  XCircle,
  Upload,
  History,
  FileEdit,
  Clock,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Company, CompanyEditableFields, DocumentSST } from '../../types/sst';
import { formatCNPJ, formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';
import { evaluateActivityCompliance } from '../../utils/activityComplianceEngine';
import { ComplianceChecklistPanel } from './ComplianceChecklistPanel';
import { ProtectedDocumentButton } from '../common/ProtectedDocumentButton';
import type { NavItemKey } from '../layout/Sidebar';

interface CompaniesViewProps {
  initialCompanyId?: string | null;
  onNavigate?: (
    tab: NavItemKey,
    opts?: { integrationId?: string; companyId?: string; employeeId?: string }
  ) => void;
}

const MAX_DIRECT_FILE_BYTES = 4 * 1024 * 1024; // 4 MB verified private backend storage

const CHANGE_FIELD_LABELS: Record<keyof CompanyEditableFields, string> = {
  razaoSocial: 'Razão Social',
  nomeFantasia: 'Nome Fantasia',
  cnpj: 'CNPJ',
  responsavelLegal: 'Responsável Legal',
  responsavelSST: 'Responsável SST',
  telefone: 'Telefone',
  email: 'E-mail SST',
  endereco: 'Endereço',
  unidadeAtendimento: 'Unidade de Atendimento',
  atividadeContratada: 'Atividade Contratada',
  dataInicioContrato: 'Início do Contrato',
  dataTerminoContrato: 'Término do Contrato',
  contrato_indeterminado: 'Prazo Indeterminado',
};

const COMPANY_DOC_CATEGORIES = [
  'PGR / PPRA',
  'PCMSO',
  'Contrato Social / CNPJ',
  'Certidão Negativa / Regularidade',
  'Alvará / Licença',
  'Seguro / Apólice',
  'LTCAT / Laudo Técnico',
  'Outro Documento Empresarial',
];

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

function formatFieldValue(key: keyof CompanyEditableFields, value: unknown): string {
  if (key === 'contrato_indeterminado') return value ? 'Sim' : 'Não';
  if (key === 'dataInicioContrato' || key === 'dataTerminoContrato') {
    return value ? formatDateBR(String(value)) : '—';
  }
  if (key === 'cnpj') return value ? formatCNPJ(String(value)) : '—';
  return value ? String(value) : '—';
}

export const CompaniesView: React.FC<CompaniesViewProps> = ({
  initialCompanyId,
  onNavigate,
}) => {
  const {
    companies,
    authorizedCompanies,
    effectiveAuthorizedEmpresaIds,
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
    userProfiles,
    addCompany,
    updateCompany,
    updateCompanySolicitanteLinks,
    deleteCompany,
    requestCompanyChange,
    approveCompanyChange,
    rejectCompanyChange,
    uploadDirectDocument,
    addDocument,
    updateDocument,
    approveDocument,
    rejectDocument,
  } = useSST();
  const { isAdmin, isSolicitante, profile } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativa' | 'inativa'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [activeSolicitanteCompanyId, setActiveSolicitanteCompanyId] = useState<string | null>(
    initialCompanyId || null
  );
  const [linkedSolicitanteDraft, setLinkedSolicitanteDraft] = useState<string[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);
  const [detailTab, setDetailTab] = useState<
    'dados' | 'documentos' | 'alteracoes' | 'conformidade' | 'historico'
  >('dados');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null
  );
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<Company | null>(null);

  // Solicitante: Request Change Modal
  const [changeRequestCompany, setChangeRequestCompany] = useState<Company | null>(null);
  const [changeForm, setChangeForm] = useState<Partial<CompanyEditableFields>>({});
  const [changeJustification, setChangeJustification] = useState('');
  const [submittingChange, setSubmittingChange] = useState(false);

  // Direct Company Document Upload / Resubmit Modal
  const [uploadCompany, setUploadCompany] = useState<Company | null>(null);
  const [resubmitDoc, setResubmitDoc] = useState<DocumentSST | null>(null);
  const [docForm, setDocForm] = useState({
    nomeDocumento: '',
    categoria: COMPANY_DOC_CATEGORIES[0],
    tipoDocumentoCanonico: '',
    numeroDocumento: '',
    dataEmissao: new Date().toISOString().slice(0, 10),
    dataValidade: '',
    semValidade: false,
    observacoes: '',
    arquivoNome: '',
    arquivoUrl: '',
  });
  const [selectedDocFile, setSelectedDocFile] = useState<File | null>(null);
  const [submittingDoc, setSubmittingDoc] = useState(false);

  // Admin: Reject justification modal (for Company Document OR Company Change Request)
  const [rejectModal, setRejectModal] = useState<
    | { kind: 'document'; doc: DocumentSST }
    | { kind: 'change_request'; companyId: string; requestId: string; title: string }
    | null
  >(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Auto-open dossier or select active company when navigated with initialCompanyId
  useEffect(() => {
    if (initialCompanyId && companies.some((c) => c.id === initialCompanyId)) {
      if (isSolicitante) {
        setActiveSolicitanteCompanyId(initialCompanyId);
      } else {
        setSelectedCompanyId(initialCompanyId);
        setDetailTab('dados');
      }
    }
  }, [initialCompanyId, companies, isSolicitante]);

  const selectedCompanyDetail = useMemo(
    () => (selectedCompanyId ? companies.find((c) => c.id === selectedCompanyId) || null : null),
    [companies, selectedCompanyId]
  );

  const solicitanteUsers = useMemo(
    () =>
      userProfiles
        .filter((u) => u.role === 'solicitante')
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [userProfiles]
  );

  useEffect(() => {
    if (!selectedCompanyDetail) {
      setLinkedSolicitanteDraft([]);
      return;
    }
    const linked = new Set<string>(selectedCompanyDetail.solicitantesAutorizadosIds || []);
    for (const u of solicitanteUsers) {
      if (
        u.empresaId === selectedCompanyDetail.id ||
        (Array.isArray(u.empresaIds) && u.empresaIds.includes(selectedCompanyDetail.id))
      ) {
        linked.add(u.id);
      }
    }
    setLinkedSolicitanteDraft(Array.from(linked));
  }, [selectedCompanyDetail, solicitanteUsers]);

  // Form states (Admin create/edit or Solicitante initial registration)
  const [formData, setFormData] = useState<Omit<Company, 'id'>>({
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
    atividadesAutorizadasIds: [],
    dataInicioContrato: '',
    dataTerminoContrato: '',
    contrato_indeterminado: false,
    situacao: 'ativa',
  });

  const activeActivities = useMemo(
    () => activityProfiles.filter((a) => a.ativo),
    [activityProfiles]
  );

  const companyComplianceMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateActivityCompliance> | null>();
    const activeActivityIds = activeActivities.map((a) => a.id);

    for (const company of companies) {
      const authorized = (company.atividadesAutorizadasIds || []).filter((id) =>
        activeActivities.some((a) => a.id === id)
      );
      const targetActivityIds = authorized.length > 0 ? authorized : activeActivityIds;
      if (targetActivityIds.length === 0) {
        map.set(company.id, null);
        continue;
      }
      const result = evaluateActivityCompliance({
        company,
        atividadeIds: targetActivityIds,
        colaboradorIds: [],
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
      map.set(company.id, result);
    }
    return map;
  }, [
    companies,
    activeActivities,
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

  const filteredCompanies = useMemo(() => {
    let list = isSolicitante ? authorizedCompanies : companies;
    if (statusFilter !== 'todos') {
      list = list.filter((c) => c.situacao === statusFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.razaoSocial.toLowerCase().includes(q) ||
          c.nomeFantasia.toLowerCase().includes(q) ||
          c.cnpj.includes(q) ||
          c.responsavelSST.toLowerCase().includes(q)
      );
    }
    return list;
  }, [companies, authorizedCompanies, isSolicitante, statusFilter, searchTerm]);

  const handleOpenAddModal = () => {
    setFeedback(null);
    setEditingCompany(null);
    setFormData({
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
      atividadesAutorizadasIds: [],
      dataInicioContrato: '',
      dataTerminoContrato: '',
      contrato_indeterminado: false,
      situacao: 'ativa',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (comp: Company) => {
    if (!isAdmin) return;
    setFeedback(null);
    const isIndeterminate = Boolean(comp.contrato_indeterminado);
    setEditingCompany(comp);
    setFormData({
      razaoSocial: comp.razaoSocial,
      nomeFantasia: comp.nomeFantasia,
      cnpj: comp.cnpj,
      responsavelLegal: comp.responsavelLegal,
      responsavelSST: comp.responsavelSST,
      telefone: comp.telefone,
      email: comp.email,
      endereco: comp.endereco,
      unidadeAtendimento: comp.unidadeAtendimento,
      atividadeContratada: comp.atividadeContratada,
      atividadesAutorizadasIds: [...(comp.atividadesAutorizadasIds || [])],
      dataInicioContrato: comp.dataInicioContrato || '',
      dataTerminoContrato: isIndeterminate ? '' : comp.dataTerminoContrato || '',
      contrato_indeterminado: isIndeterminate,
      situacao: comp.situacao,
    });
    setIsModalOpen(true);
  };

  const handleOpenChangeRequestModal = (comp: Company) => {
    setFeedback(null);
    setChangeRequestCompany(comp);
    setChangeForm({
      razaoSocial: comp.razaoSocial,
      nomeFantasia: comp.nomeFantasia,
      cnpj: comp.cnpj,
      responsavelLegal: comp.responsavelLegal,
      responsavelSST: comp.responsavelSST,
      telefone: comp.telefone,
      email: comp.email,
      endereco: comp.endereco,
      unidadeAtendimento: comp.unidadeAtendimento,
      atividadeContratada: comp.atividadeContratada,
      dataInicioContrato: comp.dataInicioContrato || '',
      dataTerminoContrato: comp.contrato_indeterminado ? '' : comp.dataTerminoContrato || '',
      contrato_indeterminado: Boolean(comp.contrato_indeterminado),
    });
    setChangeJustification('');
  };

  const handleSubmitChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeRequestCompany) return;
    if (!changeJustification.trim()) {
      setFeedback({
        type: 'error',
        message: 'Informe a justificativa da solicitação de alteração cadastral.',
      });
      return;
    }

    const diff: Partial<CompanyEditableFields> = {};
    (Object.keys(CHANGE_FIELD_LABELS) as Array<keyof CompanyEditableFields>).forEach((key) => {
      const prevVal = changeRequestCompany[key] ?? '';
      const nextVal = changeForm[key] ?? '';
      if (String(prevVal) !== String(nextVal)) {
        (diff as any)[key] = changeForm[key];
      }
    });

    if (Object.keys(diff).length === 0) {
      setFeedback({
        type: 'error',
        message: 'Altere ao menos um campo antes de enviar a solicitação de alteração.',
      });
      return;
    }

    setSubmittingChange(true);
    try {
      await requestCompanyChange(changeRequestCompany.id, diff, changeJustification.trim());
      setFeedback({
        type: 'success',
        message:
          'Solicitação de alteração cadastral enviada ao Administrador EHS. Os dados oficiais serão atualizados após aprovação.',
      });
      setChangeRequestCompany(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao enviar solicitação de alteração cadastral.',
      });
    } finally {
      setSubmittingChange(false);
    }
  };

  const handleOpenUploadDocModal = (
    comp: Company,
    existingDoc?: DocumentSST,
    preset?: { nomeDocumento?: string; categoria?: string; tipoDocumentoCanonico?: string }
  ) => {
    setFeedback(null);
    setUploadCompany(comp);
    setSelectedDocFile(null);
    if (existingDoc) {
      setResubmitDoc(existingDoc);
      setDocForm({
        nomeDocumento: existingDoc.nomeDocumento,
        categoria: existingDoc.categoria || COMPANY_DOC_CATEGORIES[0],
        tipoDocumentoCanonico:
          existingDoc.tipoDocumentoCanonico || preset?.tipoDocumentoCanonico || '',
        numeroDocumento: existingDoc.numeroDocumento || '',
        dataEmissao: existingDoc.dataEmissao || new Date().toISOString().slice(0, 10),
        dataValidade: existingDoc.semValidade ? '' : existingDoc.dataValidade || '',
        semValidade: Boolean(existingDoc.semValidade),
        observacoes: existingDoc.observacoes || '',
        arquivoNome: existingDoc.arquivoNome || '',
        arquivoUrl: existingDoc.arquivoUrl || '',
      });
    } else {
      setResubmitDoc(null);
      setDocForm({
        nomeDocumento: preset?.nomeDocumento || '',
        categoria: preset?.categoria || COMPANY_DOC_CATEGORIES[0],
        tipoDocumentoCanonico: preset?.tipoDocumentoCanonico || '',
        numeroDocumento: '',
        dataEmissao: new Date().toISOString().slice(0, 10),
        dataValidade: '',
        semValidade: false,
        observacoes: '',
        arquivoNome: '',
        arquivoUrl: '',
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_DIRECT_FILE_BYTES) {
      setFeedback({
        type: 'error',
        message: 'O arquivo excede o limite de 4 MB permitido para armazenamento seguro (PDF, JPG ou PNG).',
      });
      return;
    }
    setSelectedDocFile(file);
    setDocForm((prev) => ({
      ...prev,
      arquivoNome: file.name,
    }));
  };

  const handleSubmitCompanyDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadCompany) return;
    if (!docForm.nomeDocumento.trim()) {
      setFeedback({ type: 'error', message: 'Informe o nome do documento.' });
      return;
    }
    if (!docForm.semValidade && !docForm.dataValidade) {
      setFeedback({
        type: 'error',
        message: 'Informe a data de validade ou marque "Documento sem validade".',
      });
      return;
    }

    setSubmittingDoc(true);
    setFeedback(null);
    try {
      if (selectedDocFile) {
        const res = await uploadDirectDocument({
          kind: 'documento',
          recordId: resubmitDoc?.id,
          empresaId: uploadCompany.id,
          nomeDocumento: docForm.nomeDocumento.trim(),
          categoria: docForm.categoria,
          tipoDocumentoCanonico: docForm.tipoDocumentoCanonico || undefined,
          numeroDocumento: docForm.numeroDocumento.trim(),
          dataEmissao: docForm.dataEmissao,
          dataValidade: docForm.semValidade ? '' : docForm.dataValidade,
          semValidade: docForm.semValidade,
          observacoes: docForm.observacoes.trim(),
          arquivoNome: selectedDocFile.name || docForm.arquivoNome || `${docForm.nomeDocumento.trim()}.pdf`,
          file: selectedDocFile,
        });
        setFeedback({
          type: 'success',
          message: isAdmin
            ? `Documento "${docForm.nomeDocumento}" armazenado com verificação de integridade (v${res.versao}) e aprovado na base oficial.`
            : resubmitDoc?.situacao === 'aprovado'
            ? `Nova versão (v${res.versao}) de "${docForm.nomeDocumento}" enviada para análise do EHS. A versão aprovada anterior permanece válida até aprovação.`
            : `Documento "${docForm.nomeDocumento}" armazenado com verificação de integridade (v${res.versao}) e enviado para análise do Administrador EHS.`,
        });
        setUploadCompany(null);
        setResubmitDoc(null);
        setSelectedDocFile(null);
        return;
      }

      if (resubmitDoc) {
        await updateDocument(resubmitDoc.id, {
          nomeDocumento: docForm.nomeDocumento.trim(),
          categoria: docForm.categoria,
          numeroDocumento: docForm.numeroDocumento.trim(),
          dataEmissao: docForm.dataEmissao,
          dataValidade: docForm.semValidade ? '' : docForm.dataValidade,
          semValidade: docForm.semValidade,
          observacoes: docForm.observacoes.trim(),
          arquivoNome: docForm.arquivoNome,
          arquivoUrl: docForm.arquivoUrl,
          situacao: isAdmin ? 'aprovado' : 'pendente',
          motivoReprovacao: '',
          origemEnvio: isAdmin ? 'admin' : 'empresa',
        });
        setFeedback({
          type: 'success',
          message: `Documento "${docForm.nomeDocumento}" reenviado para nova avaliação do Administrador EHS.`,
        });
      } else {
        await addDocument({
          empresaId: uploadCompany.id,
          empresaNome: uploadCompany.razaoSocial,
          nomeDocumento: docForm.nomeDocumento.trim(),
          categoria: docForm.categoria,
          numeroDocumento: docForm.numeroDocumento.trim(),
          dataEmissao: docForm.dataEmissao,
          dataValidade: docForm.semValidade ? '' : docForm.dataValidade,
          semValidade: docForm.semValidade,
          observacoes: docForm.observacoes.trim(),
          arquivoNome: docForm.arquivoNome,
          arquivoUrl: docForm.arquivoUrl,
          responsavelEnvio: profile?.nome || 'Usuário',
          versao: 1,
          situacao: isAdmin ? 'aprovado' : 'pendente',
          origemEnvio: isAdmin ? 'admin' : 'empresa',
          solicitacaoCodigo: `EMP-${uploadCompany.cnpj.replace(/\D/g, '').slice(0, 6) || uploadCompany.id.slice(0, 6)}`,
        });
        setFeedback({
          type: 'success',
          message: isAdmin
            ? `Documento "${docForm.nomeDocumento}" incluído no dossiê da empresa.`
            : `Documento "${docForm.nomeDocumento}" enviado com sucesso e aguardando avaliação do Administrador EHS.`,
        });
      }
      setUploadCompany(null);
      setResubmitDoc(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao salvar documento da empresa.',
      });
    } finally {
      setSubmittingDoc(false);
    }
  };

  const handleApproveDoc = async (doc: DocumentSST) => {
    if (!isAdmin) return;
    setSubmittingDecision(true);
    try {
      await approveDocument(doc.id);
      setFeedback({
        type: 'success',
        message: `Documento "${doc.nomeDocumento}" aprovado e espelhado para a contratada.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao aprovar documento.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleApproveChangeReq = async (companyId: string, requestId: string) => {
    if (!isAdmin) return;
    setSubmittingDecision(true);
    try {
      await approveCompanyChange(companyId, requestId);
      setFeedback({
        type: 'success',
        message: 'Alteração cadastral aprovada e aplicada ao cadastro oficial da empresa.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao aprovar alteração cadastral.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModal || !isAdmin) return;
    if (!rejectReason.trim()) {
      setFeedback({
        type: 'error',
        message: 'A justificativa é obrigatória para recusar.',
      });
      return;
    }

    setSubmittingDecision(true);
    try {
      if (rejectModal.kind === 'document') {
        await rejectDocument(rejectModal.doc.id, rejectReason.trim());
        setFeedback({
          type: 'success',
          message: `Documento "${rejectModal.doc.nomeDocumento}" recusado com justificativa visível para a contratada.`,
        });
      } else {
        await rejectCompanyChange(
          rejectModal.companyId,
          rejectModal.requestId,
          rejectReason.trim()
        );
        setFeedback({
          type: 'success',
          message: 'Solicitação de alteração cadastral recusada com justificativa registrada.',
        });
      }
      setRejectModal(null);
      setRejectReason('');
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao registrar recusa.' });
    } finally {
      setSubmittingDecision(false);
    }
  };

  const toggleAuthorizedActivity = (actId: string) => {
    setFormData((prev) => {
      const current = prev.atividadesAutorizadasIds || [];
      const exists = current.includes(actId);
      return {
        ...prev,
        atividadesAutorizadasIds: exists
          ? current.filter((id) => id !== actId)
          : [...current, actId],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!formData.razaoSocial.trim() || !formData.cnpj.trim()) {
      setFeedback({ type: 'error', message: 'Razão Social e CNPJ são campos obrigatórios.' });
      return;
    }

    const isIndeterminate = Boolean(formData.contrato_indeterminado);
    const payload: Omit<Company, 'id'> = {
      ...formData,
      contrato_indeterminado: isIndeterminate,
      dataTerminoContrato: isIndeterminate ? '' : formData.dataTerminoContrato,
      atividadesAutorizadasIds: formData.atividadesAutorizadasIds || [],
    };

    try {
      if (editingCompany) {
        await updateCompany(editingCompany.id, payload);
        setFeedback({ type: 'success', message: `Empresa "${payload.razaoSocial}" atualizada.` });
      } else {
        const createdId = await addCompany(payload);
        if (isSolicitante) {
          setActiveSolicitanteCompanyId(createdId);
        }
        setFeedback({
          type: 'success',
          message: isSolicitante
            ? `Empresa "${payload.razaoSocial}" cadastrada e vinculada automaticamente ao seu perfil em Minhas Empresas.`
            : `Empresa "${payload.razaoSocial}" cadastrada.`,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao salvar os dados da empresa.',
      });
    }
  };

  const handleSaveCompanyLinks = async () => {
    if (!isAdmin || !selectedCompanyDetail) return;
    setSavingLinks(true);
    setFeedback(null);
    try {
      await updateCompanySolicitanteLinks(selectedCompanyDetail.id, linkedSolicitanteDraft);
      setFeedback({
        type: 'success',
        message: `Vínculos de solicitantes atualizados para "${selectedCompanyDetail.razaoSocial}" (${linkedSolicitanteDraft.length} autorizado(s)).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Não foi possível salvar os vínculos de solicitantes.',
      });
    } finally {
      setSavingLinks(false);
    }
  };

  const confirmDeleteCompany = async () => {
    if (!pendingDeleteCompany) return;
    if (!isAdmin) {
      setFeedback({
        type: 'error',
        message: 'Apenas o Administrador EHS tem autorização para excluir empresas.',
      });
      setPendingDeleteCompany(null);
      return;
    }
    try {
      await deleteCompany(pendingDeleteCompany.id);
      if (selectedCompanyId === pendingDeleteCompany.id) {
        setSelectedCompanyId(null);
      }
      setFeedback({
        type: 'success',
        message: `Empresa "${pendingDeleteCompany.razaoSocial}" removida do cadastro.`,
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao excluir empresa.',
      });
    } finally {
      setPendingDeleteCompany(null);
    }
  };

  const openDetails = (
    company: Company,
    initialTab: 'dados' | 'documentos' | 'alteracoes' | 'conformidade' | 'historico' = 'dados'
  ) => {
    setSelectedCompanyId(company.id);
    setDetailTab(initialTab);
  };

  const selectedCompanyDocs = useMemo(() => {
    if (!selectedCompanyDetail) return [];
    return documents
      .filter((d) => d.empresaId === selectedCompanyDetail.id)
      .sort((a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
      );
  }, [documents, selectedCompanyDetail]);

  const selectedCompanyChangeRequests = useMemo(() => {
    if (!selectedCompanyDetail) return [];
    return [...(selectedCompanyDetail.solicitacoesAlteracao || [])].sort((a, b) =>
      b.dataSolicitacao.localeCompare(a.dataSolicitacao)
    );
  }, [selectedCompanyDetail]);

  const selectedCompanyLogs = useMemo(() => {
    if (!selectedCompanyDetail) return [];
    return auditLogs.filter(
      (l) =>
        l.entidadeId === selectedCompanyDetail.id ||
        l.detalhes.includes(selectedCompanyDetail.razaoSocial)
    );
  }, [auditLogs, selectedCompanyDetail]);

  const selectedCompanyCompliance = useMemo(() => {
    if (!selectedCompanyDetail) return null;
    return companyComplianceMap.get(selectedCompanyDetail.id) || null;
  }, [selectedCompanyDetail, companyComplianceMap]);

  const myCompany = isSolicitante
    ? filteredCompanies.find((c) => c.id === activeSolicitanteCompanyId) ||
      filteredCompanies[0] ||
      null
    : null;

  const corporateMatrixRequirements = useMemo(() => {
    if (!myCompany) return [];
    const authorizedActs = myCompany.atividadesAutorizadasIds || [];
    const allCorpReqs = activityDocumentRequirements.filter(
      (req) => req.ativo && req.escopo === 'empresa'
    );
    const scoped =
      authorizedActs.length > 0
        ? allCorpReqs.filter((r) => authorizedActs.includes(r.activityId))
        : allCorpReqs;
    const dedup = new Map<string, typeof allCorpReqs[number]>();
    for (const r of scoped.length > 0 ? scoped : allCorpReqs) {
      const key = (r.documentoCodigoCanonico || r.nomeExibicao).trim().toLowerCase();
      if (!dedup.has(key)) dedup.set(key, r);
    }
    return Array.from(dedup.values());
  }, [myCompany, activityDocumentRequirements]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-blue-500" />
            {isSolicitante ? 'Minhas Empresas' : 'Empresas Contratadas'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isSolicitante
              ? 'Gerencie suas empresas vinculadas, envie documentos empresariais da Matriz EHS diretamente nesta tela e inicie integrações com dados reaproveitados automaticamente.'
              : 'Visualização em lista de empresas contratadas. Selecione uma empresa para abrir o cadastro, dossiê documental, vínculos de solicitantes, solicitações de alteração e histórico.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSolicitante && myCompany && (
            <>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('envio_documentos', { companyId: myCompany.id })}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all"
                >
                  <ShieldCheck size={15} />
                  Iniciar Integração
                </button>
              )}
              <button
                type="button"
                onClick={() => handleOpenUploadDocModal(myCompany)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
              >
                <Upload size={15} />
                Enviar Documento da Empresa
              </button>
              <button
                type="button"
                onClick={() => handleOpenChangeRequestModal(myCompany)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-all"
              >
                <FileEdit size={15} />
                Solicitar Alteração Cadastral
              </button>
            </>
          )}

          {(isAdmin || isSolicitante) && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
            >
              <Plus size={16} />
              {isSolicitante
                ? filteredCompanies.length === 0
                  ? 'Cadastrar Minha Empresa'
                  : 'Cadastrar Nova Empresa'
                : 'Adicionar Empresa Contratada'}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters and Search Bar (Admin / Auditor) */}
      {!isSolicitante && (
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
          <div className="relative w-full sm:w-96">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por Razão Social, Nome Fantasia, CNPJ ou Responsável..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-400 whitespace-nowrap">Situação:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'todos' | 'ativa' | 'inativa')}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="todos">Todas as Situações ({filteredCompanies.length})</option>
              <option value="ativa">Somente Ativas</option>
              <option value="inativa">Somente Inativas</option>
            </select>
          </div>
        </div>
      )}

      {/* SOLICITANTE: Multi-Company Selector + Selected Company Summary + Inline EHS Matrix Docs */}
      {isSolicitante && myCompany ? (
        <div className="space-y-6">
          {filteredCompanies.length > 1 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">
                  Empresas Vinculadas ao Seu Perfil ({filteredCompanies.length})
                </span>
                <span className="text-[11px] text-slate-400">
                  Selecione uma empresa para gerenciar seus documentos ou iniciar integração
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {filteredCompanies.map((comp) => {
                  const isSelected = comp.id === myCompany.id;
                  return (
                    <button
                      key={comp.id}
                      type="button"
                      onClick={() => setActiveSolicitanteCompanyId(comp.id)}
                      className={`px-3.5 py-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-blue-600/20 border-blue-500 text-white shadow-sm'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-xs font-bold block">
                        {comp.nomeFantasia || comp.razaoSocial}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {formatCNPJ(comp.cnpj)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                  <Building2 size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{myCompany.razaoSocial}</h3>
                  <p className="text-xs text-slate-400">
                    {myCompany.nomeFantasia ? `${myCompany.nomeFantasia} · ` : ''}
                    <span className="font-mono text-slate-300">{formatCNPJ(myCompany.cnpj)}</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase ${
                    myCompany.situacao === 'ativa'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                  }`}
                >
                  {myCompany.situacao}
                </span>
                <button
                  type="button"
                  onClick={() => openDetails(myCompany, 'dados')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-blue-300"
                >
                  <Eye size={14} />
                  Abrir Dossiê Completo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Responsável Legal</span>
                <strong className="text-slate-100">{myCompany.responsavelLegal || '—'}</strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Responsável SST</span>
                <strong className="text-slate-100">{myCompany.responsavelSST || '—'}</strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Contato</span>
                <strong className="text-slate-100">{myCompany.telefone || myCompany.email || '—'}</strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Vigência Contratual</span>
                <strong className="text-slate-100">
                  {myCompany.contrato_indeterminado
                    ? 'Prazo indeterminado'
                    : formatDateBR(myCompany.dataTerminoContrato)}
                </strong>
              </div>
            </div>

            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 px-3.5 py-2.5 text-[11px] text-blue-200 flex items-center justify-between gap-2 flex-wrap">
              <span>
                Para alterar dados oficiais da empresa, envie uma <strong>Solicitação de Alteração Cadastral</strong> para validação do Administrador EHS.
              </span>
              {(myCompany.solicitacoesAlteracao || []).length > 0 && (
                <button
                  type="button"
                  onClick={() => openDetails(myCompany, 'alteracoes')}
                  className="text-blue-300 hover:text-white underline font-semibold"
                >
                  Ver solicitações ({(myCompany.solicitacoesAlteracao || []).length})
                </button>
              )}
            </div>
          </div>

          {/* Direct Company Documents Section right inside Minha Empresa */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText size={16} className="text-blue-400" />
                  Documentos da Empresa
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Envie cada documento uma única vez — após aprovação do Administrador EHS, ele será reaproveitado automaticamente em todas as integrações, sem novo upload.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOpenUploadDocModal(myCompany)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0"
              >
                <Upload size={14} />
                Enviar Documento
              </button>
            </div>

            {/* Inline EHS Matrix Corporate Checklist directly inside Minhas Empresas */}
            {corporateMatrixRequirements.length > 0 && (
              <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <Layers size={13} />
                    Checklist Documental da Empresa (Matriz EHS)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Arquivos PDF/JPG/PNG até 4 MB • Aprovação exclusiva pelo Administrador EHS
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {corporateMatrixRequirements.map((req) => {
                    const reqKey = (req.documentoCodigoCanonico || req.nomeExibicao).toLowerCase();
                    const matchedDoc = documents
                      .filter((d) => d.empresaId === myCompany.id && !d.colaboradorId)
                      .sort((a, b) =>
                        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
                      )
                      .find(
                        (d) =>
                          (d.tipoDocumentoCanonico || '').toLowerCase() === reqKey ||
                          d.nomeDocumento.toLowerCase().includes(req.nomeExibicao.toLowerCase()) ||
                          req.nomeExibicao.toLowerCase().includes(d.nomeDocumento.toLowerCase())
                      );
                    const statusLabel = !matchedDoc
                      ? 'Pendente de envio'
                      : matchedDoc.situacao === 'aprovado'
                      ? 'Aprovado (Base Oficial)'
                      : matchedDoc.situacao === 'reprovado'
                      ? 'Recusado — Corrigir'
                      : 'Enviado — Aguardando Análise';
                    const statusBadge = !matchedDoc
                      ? 'bg-slate-800 text-slate-300 border-slate-700'
                      : matchedDoc.situacao === 'aprovado'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : matchedDoc.situacao === 'reprovado'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : 'bg-sky-500/15 text-sky-300 border-sky-500/30';

                    return (
                      <div
                        key={req.id}
                        className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-white truncate">
                              {req.nomeExibicao}
                            </span>
                            {req.obrigatorioParaLiberacao && (
                              <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                                Obrigatório
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${statusBadge}`}
                          >
                            {statusLabel}
                          </span>
                          {matchedDoc?.motivoReprovacao && (
                            <p className="text-[10px] text-rose-300 mt-1 line-clamp-2">
                              Motivo: {matchedDoc.motivoReprovacao}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {matchedDoc?.arquivoUrl && (
                            <ProtectedDocumentButton
                              url={matchedDoc.arquivoUrl}
                              fileName={matchedDoc.arquivoNome || matchedDoc.nomeDocumento}
                              title={`Visualizar ${matchedDoc.nomeDocumento}`}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300"
                            />
                          )}
                          {(!matchedDoc || matchedDoc.situacao === 'reprovado') && (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenUploadDocModal(
                                  myCompany,
                                  matchedDoc?.situacao === 'reprovado' ? matchedDoc : undefined,
                                  {
                                    nomeDocumento: req.nomeExibicao,
                                    categoria: COMPANY_DOC_CATEGORIES[0],
                                    tipoDocumentoCanonico: req.documentoCodigoCanonico,
                                  }
                                )
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white ${
                                matchedDoc?.situacao === 'reprovado'
                                  ? 'bg-amber-600 hover:bg-amber-500'
                                  : 'bg-blue-600 hover:bg-blue-500'
                              }`}
                            >
                              <Upload size={12} />
                              {matchedDoc?.situacao === 'reprovado' ? 'Substituir' : 'Enviar'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(() => {
              const myCompanyDocs = documents
                .filter((d) => d.empresaId === myCompany.id && !d.colaboradorId)
                .sort((a, b) =>
                  (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
                );

              if (myCompanyDocs.length === 0) {
                return (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Nenhum documento empresarial enviado ainda. Clique em <strong>Enviar Documento</strong> para iniciar.
                  </div>
                );
              }

              return (
                <div className="divide-y divide-slate-800">
                  {myCompanyDocs.map((doc) => {
                    const farol = getTrafficLightStatus(doc.dataValidade, doc.semValidade, doc.situacao);
                    return (
                      <div
                        key={doc.id}
                        className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-800/30"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-white text-xs">{doc.nomeDocumento}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                              {doc.categoria}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 font-mono text-[10px]">
                              v{doc.versao || 1}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                              {doc.situacao === 'pendente'
                                ? 'Aguardando Avaliação EHS'
                                : doc.situacao === 'reprovado'
                                ? 'Recusado — Reenvio Necessário'
                                : farol.label}
                            </span>
                            {doc.versaoPendente && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                Atualização v{doc.versaoPendente.versao} em análise
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Validade: {doc.semValidade ? 'Sem vencimento' : formatDateBR(doc.dataValidade)}
                            {doc.analisadoPor ? ` · Avaliado por ${doc.analisadoPor} em ${formatDateTimeBR(doc.dataAnalise)}` : ''}
                            {doc.situacao === 'aprovado' && farol.status !== 'vermelho'
                              ? ' · Reaproveitado automaticamente nas integrações'
                              : ''}
                          </p>
                          {doc.versaoPendente && (
                            <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded px-2.5 py-1 mt-1">
                              Nova versão v{doc.versaoPendente.versao} ({doc.versaoPendente.arquivoNome}) aguardando aprovação do EHS. A versão aprovada atual permanece válida até aprovação.
                            </p>
                          )}
                          {doc.motivoReprovacao && (
                            <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                              <strong>Motivo da recusa:</strong> {doc.motivoReprovacao}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {doc.arquivoUrl && (
                            <ProtectedDocumentButton
                              url={doc.arquivoUrl}
                              fileName={doc.arquivoNome || doc.nomeDocumento}
                              title={`Visualizar ${doc.nomeDocumento}`}
                              label="Abrir"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium"
                            />
                          )}
                          {doc.situacao === 'reprovado' ? (
                            <button
                              type="button"
                              onClick={() => handleOpenUploadDocModal(myCompany, doc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                            >
                              <RefreshCw size={12} />
                              Corrigir e Reenviar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenUploadDocModal(myCompany, doc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold"
                              title="Enviar nova versão deste documento sem invalidar a versão aprovada vigente"
                            >
                              <RefreshCw size={12} />
                              Atualizar Versão
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        /* ADMIN / AUDITOR (or empty Solicitante): List View Table */
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          {filteredCompanies.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 size={40} className="mx-auto text-slate-500 mb-2" />
              <p className="text-sm font-semibold text-slate-300">Nenhuma empresa encontrada</p>
              <p className="text-xs text-slate-400 mt-1">
                {isSolicitante
                  ? 'Clique em "Cadastrar Minha Empresa" para registrar os dados da sua contratada.'
                  : 'Ajuste os filtros ou adicione uma nova empresa contratada.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Empresa Contratada</th>
                    <th className="py-3 px-4">CNPJ</th>
                    <th className="py-3 px-4">Situação</th>
                    <th className="py-3 px-4">Equipe & Docs</th>
                    <th className="py-3 px-4">Conformidade / Pendências</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs">
                  {filteredCompanies.map((company) => {
                    const companyEmployeesCount = employees.filter(
                      (e) => e.empresaId === company.id
                    ).length;
                    const companyDocs = documents.filter((d) => d.empresaId === company.id);
                    const pendingDocsCount = companyDocs.filter(
                      (d) => d.situacao === 'pendente'
                    ).length;
                    const pendingChangesCount = (company.solicitacoesAlteracao || []).filter(
                      (r) => r.status === 'pendente'
                    ).length;
                    const compliance = companyComplianceMap.get(company.id) || null;

                    return (
                      <tr
                        key={company.id}
                        onClick={() => openDetails(company, 'dados')}
                        className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">
                            {company.nomeFantasia || company.razaoSocial}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-xs">
                            {company.razaoSocial}
                          </div>
                          {company.responsavelSST && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              SST: {company.responsavelSST}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 font-mono text-slate-200 whitespace-nowrap">
                          {formatCNPJ(company.cnpj)}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              company.situacao === 'ativa'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {company.situacao}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-3 text-slate-300 tabular-nums">
                            <span className="inline-flex items-center gap-1" title="Colaboradores">
                              <Users size={13} className="text-blue-400" />
                              {companyEmployeesCount}
                            </span>
                            <span className="inline-flex items-center gap-1" title="Documentos">
                              <FileText size={13} className="text-emerald-400" />
                              {companyDocs.length}
                            </span>
                            {pendingDocsCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold">
                                {pendingDocsCount} p/ analisar
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {pendingChangesCount > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetails(company, 'alteracoes');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] font-bold hover:bg-amber-500/25"
                              >
                                <FileEdit size={11} />
                                {pendingChangesCount} alteração(ões) pendente(s)
                              </button>
                            )}
                            {compliance ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                  compliance.statusGeral === 'conforme'
                                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                    : compliance.statusGeral === 'atencao'
                                    ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                                    : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                                }`}
                              >
                                {compliance.statusGeral === 'conforme' ? (
                                  <ShieldCheck size={12} />
                                ) : compliance.statusGeral === 'atencao' ? (
                                  <AlertTriangle size={12} />
                                ) : (
                                  <ShieldAlert size={12} />
                                )}
                                {compliance.statusGeral === 'conforme'
                                  ? 'Conforme'
                                  : compliance.statusGeral === 'atencao'
                                  ? `${compliance.resumo.alertasAVencer} a vencer`
                                  : `${compliance.resumo.bloqueiosObrigatorios} pendência(s)`}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">Sem matriz vinculada</span>
                            )}
                          </div>
                        </td>

                        <td
                          className="py-3.5 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openDetails(company, 'dados')}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold transition-colors"
                            >
                              Abrir Dossiê
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(company)}
                                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                                  title="Editar cadastro"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteCompany(company)}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                                  title="Excluir empresa"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Inline Delete Confirmation Modal */}
      {pendingDeleteCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Exclusão</h3>
                <p className="text-xs text-slate-400">Esta operação remove o cadastro da contratada.</p>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              Confirma a exclusão da empresa{' '}
              <span className="font-semibold text-white">{pendingDeleteCompany.razaoSocial}</span>{' '}
              (CNPJ: {formatCNPJ(pendingDeleteCompany.cnpj)})?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPendingDeleteCompany(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteCompany}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
              >
                Excluir Empresa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Company Modal (Admin OR Solicitante initial registration) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 size={18} className="text-blue-500" />
                {editingCompany ? 'Editar Empresa Contratada' : 'Cadastrar Nova Empresa Contratada'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Razão Social <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.razaoSocial}
                    onChange={(e) => setFormData({ ...formData, razaoSocial: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Construtora Alvorada Ltda"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nome Fantasia
                  </label>
                  <input
                    type="text"
                    value={formData.nomeFantasia}
                    onChange={(e) => setFormData({ ...formData, nomeFantasia: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Alvorada Engenharia"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    CNPJ <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="00.000.000/0000-00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Situação Contratual
                  </label>
                  <select
                    value={formData.situacao}
                    onChange={(e) =>
                      setFormData({ ...formData, situacao: e.target.value as 'ativa' | 'inativa' })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="ativa">Ativa</option>
                    <option value="inativa">Inativa</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Responsável Legal
                  </label>
                  <input
                    type="text"
                    value={formData.responsavelLegal}
                    onChange={(e) => setFormData({ ...formData, responsavelLegal: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Responsável SST
                  </label>
                  <input
                    type="text"
                    value={formData.responsavelSST}
                    onChange={(e) => setFormData({ ...formData, responsavelSST: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    E-mail SST
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Unidade de Atendimento
                  </label>
                  <input
                    type="text"
                    value={formData.unidadeAtendimento}
                    onChange={(e) =>
                      setFormData({ ...formData, unidadeAtendimento: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Escopo / Atividade Contratada
                  </label>
                  <input
                    type="text"
                    value={formData.atividadeContratada}
                    onChange={(e) =>
                      setFormData({ ...formData, atividadeContratada: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Início do Contrato
                  </label>
                  <input
                    type="date"
                    value={formData.dataInicioContrato}
                    onChange={(e) =>
                      setFormData({ ...formData, dataInicioContrato: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Término do Contrato
                  </label>
                  <input
                    type="date"
                    disabled={Boolean(formData.contrato_indeterminado)}
                    value={formData.contrato_indeterminado ? '' : formData.dataTerminoContrato}
                    onChange={(e) =>
                      setFormData({ ...formData, dataTerminoContrato: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-40"
                  />
                </div>

                <div className="md:col-span-2 -mt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.contrato_indeterminado)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => ({
                          ...prev,
                          contrato_indeterminado: checked,
                          dataTerminoContrato: checked ? '' : prev.dataTerminoContrato,
                        }));
                      }}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <span>Prazo indeterminado</span>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Layers size={14} className="text-blue-400" />
                    Atividades Críticas Autorizadas (Matriz EHS)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {(formData.atividadesAutorizadasIds || []).length} selecionada(s)
                  </span>
                </div>
                {activeActivities.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Nenhuma atividade ativa cadastrada na Matriz de EHS.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeActivities.map((act) => {
                      const checked = (formData.atividadesAutorizadasIds || []).includes(act.id);
                      return (
                        <label
                          key={act.id}
                          className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-colors ${
                            checked
                              ? 'bg-blue-500/15 border-blue-500/40 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAuthorizedActivity(act.id)}
                            className="mt-0.5 rounded bg-slate-950 border-slate-700 text-blue-600"
                          />
                          <div className="min-w-0">
                            <span className="font-semibold block truncate">{act.nome}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {act.codigo} • Risco {act.nivelRisco.toUpperCase()}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Endereço Completo
                </label>
                <input
                  type="text"
                  value={formData.endereco}
                  onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
                >
                  Salvar Empresa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Solicitante: Request Company Change Modal */}
      {changeRequestCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleSubmitChangeRequest}
            className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 max-h-[92vh] overflow-y-auto custom-scrollbar space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileEdit size={18} className="text-amber-400" />
                  Solicitar Alteração Cadastral
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  As alterações propostas serão enviadas para validação e aprovação do Administrador EHS antes de atualizar o cadastro oficial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChangeRequestCompany(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Razão Social</label>
                <input
                  type="text"
                  value={changeForm.razaoSocial || ''}
                  onChange={(e) => setChangeForm({ ...changeForm, razaoSocial: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Nome Fantasia</label>
                <input
                  type="text"
                  value={changeForm.nomeFantasia || ''}
                  onChange={(e) => setChangeForm({ ...changeForm, nomeFantasia: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Responsável Legal</label>
                <input
                  type="text"
                  value={changeForm.responsavelLegal || ''}
                  onChange={(e) =>
                    setChangeForm({ ...changeForm, responsavelLegal: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Responsável SST</label>
                <input
                  type="text"
                  value={changeForm.responsavelSST || ''}
                  onChange={(e) =>
                    setChangeForm({ ...changeForm, responsavelSST: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">Telefone</label>
                <input
                  type="text"
                  value={changeForm.telefone || ''}
                  onChange={(e) => setChangeForm({ ...changeForm, telefone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">E-mail SST</label>
                <input
                  type="email"
                  value={changeForm.email || ''}
                  onChange={(e) => setChangeForm({ ...changeForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Unidade de Atendimento
                </label>
                <input
                  type="text"
                  value={changeForm.unidadeAtendimento || ''}
                  onChange={(e) =>
                    setChangeForm({ ...changeForm, unidadeAtendimento: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Atividade Contratada
                </label>
                <input
                  type="text"
                  value={changeForm.atividadeContratada || ''}
                  onChange={(e) =>
                    setChangeForm({ ...changeForm, atividadeContratada: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-medium text-slate-300 mb-1">Endereço Completo</label>
                <input
                  type="text"
                  value={changeForm.endereco || ''}
                  onChange={(e) => setChangeForm({ ...changeForm, endereco: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block font-semibold text-amber-300 mb-1">
                  Justificativa da Alteração <span className="text-red-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={changeJustification}
                  onChange={(e) => setChangeJustification(e.target.value)}
                  placeholder="Explique o motivo da atualização cadastral (ex.: troca de responsável SST, atualização de endereço/contato)..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setChangeRequestCompany(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submittingChange}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {submittingChange ? 'Enviando...' : 'Enviar Solicitação para EHS'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Direct Company Document Upload / Resubmit Modal */}
      {uploadCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleSubmitCompanyDoc}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Upload size={18} className="text-blue-400" />
                  {resubmitDoc
                    ? resubmitDoc.situacao === 'aprovado'
                      ? 'Atualizar Versão do Documento'
                      : 'Corrigir e Reenviar Documento'
                    : 'Enviar Documento da Empresa'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{uploadCompany.razaoSocial}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadCompany(null);
                  setResubmitDoc(null);
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {resubmitDoc?.situacao === 'aprovado' && isSolicitante && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-200">
                A versão aprovada vigente (v{resubmitDoc.versao || 1}) continuará válida e reaproveitada nas integrações até que o Administrador EHS aprove a nova versão enviada.
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Nome do Documento <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={docForm.nomeDocumento}
                  onChange={(e) => setDocForm({ ...docForm, nomeDocumento: e.target.value })}
                  placeholder="Ex: PGR 2026, PCMSO, Contrato Social"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Categoria</label>
                  <select
                    value={docForm.categoria}
                    onChange={(e) => setDocForm({ ...docForm, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  >
                    {COMPANY_DOC_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Número / Código</label>
                  <input
                    type="text"
                    value={docForm.numeroDocumento}
                    onChange={(e) => setDocForm({ ...docForm, numeroDocumento: e.target.value })}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Data de Emissão</label>
                  <input
                    type="date"
                    value={docForm.dataEmissao}
                    onChange={(e) => setDocForm({ ...docForm, dataEmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Data de Validade</label>
                  <input
                    type="date"
                    disabled={docForm.semValidade}
                    required={!docForm.semValidade}
                    value={docForm.semValidade ? '' : docForm.dataValidade}
                    onChange={(e) => setDocForm({ ...docForm, dataValidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white disabled:opacity-40"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={docForm.semValidade}
                  onChange={(e) =>
                    setDocForm((prev) => ({
                      ...prev,
                      semValidade: e.target.checked,
                      dataValidade: e.target.checked ? '' : prev.dataValidade,
                    }))
                  }
                  className="rounded bg-slate-950 border-slate-700 text-blue-600"
                />
                <span>Documento sem data de validade</span>
              </label>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Anexo (PDF, JPG ou PNG — até 4 MB)
                </label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                />
                {docForm.arquivoNome && (
                  <p className="text-[11px] text-emerald-400 mt-1">
                    Arquivo anexado: {docForm.arquivoNome}
                  </p>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={docForm.observacoes}
                  onChange={(e) => setDocForm({ ...docForm, observacoes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  placeholder="Informações complementares..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setUploadCompany(null);
                  setResubmitDoc(null);
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submittingDoc}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {submittingDoc
                  ? 'Enviando...'
                  : resubmitDoc
                  ? 'Reenviar para Avaliação'
                  : 'Enviar Documento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Evolved Tabbed Company Dossier Modal */}
      {selectedCompanyDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
                  <Building2 size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    Dossiê da Empresa — {selectedCompanyDetail.razaoSocial}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    CNPJ: {formatCNPJ(selectedCompanyDetail.cnpj)} •{' '}
                    <span
                      className={
                        selectedCompanyDetail.situacao === 'ativa'
                          ? 'text-emerald-400 font-sans font-semibold uppercase'
                          : 'text-rose-400 font-sans font-semibold uppercase'
                      }
                    >
                      {selectedCompanyDetail.situacao}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isSolicitante &&
                  effectiveAuthorizedEmpresaIds.includes(selectedCompanyDetail.id) && (
                  <button
                    type="button"
                    onClick={() => handleOpenChangeRequestModal(selectedCompanyDetail)}
                    className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 text-xs font-semibold"
                  >
                    Solicitar Alteração
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCompanyId(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-900/60 overflow-x-auto text-xs">
              {[
                { id: 'dados' as const, label: 'Dados & Contrato' },
                { id: 'documentos' as const, label: `Documentos (${selectedCompanyDocs.length})` },
                {
                  id: 'alteracoes' as const,
                  label: `Solicitações de Alteração (${
                    selectedCompanyChangeRequests.filter((r) => r.status === 'pendente').length
                  })`,
                },
                { id: 'conformidade' as const, label: 'Conformidade Matriz EHS' },
                { id: 'historico' as const, label: `Histórico (${selectedCompanyLogs.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDetailTab(t.id)}
                  className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap ${
                    detailTab === t.id
                      ? 'border-blue-500 text-blue-400 font-bold'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar text-xs">
              {detailTab === 'dados' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Nome Fantasia</span>
                      <span className="font-semibold text-white">
                        {selectedCompanyDetail.nomeFantasia || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Unidade de Atendimento</span>
                      <span className="text-slate-200">
                        {selectedCompanyDetail.unidadeAtendimento || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Responsável Legal</span>
                      <span className="text-slate-200">
                        {selectedCompanyDetail.responsavelLegal || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Responsável SST</span>
                      <span className="text-slate-200">
                        {selectedCompanyDetail.responsavelSST || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Telefone</span>
                      <span className="text-slate-200">{selectedCompanyDetail.telefone || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">E-mail SST</span>
                      <span className="text-slate-200">{selectedCompanyDetail.email || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Início do Contrato</span>
                      <span className="text-slate-200">
                        {formatDateBR(selectedCompanyDetail.dataInicioContrato)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Término do Contrato</span>
                      <span className="text-slate-200">
                        {selectedCompanyDetail.contrato_indeterminado
                          ? 'Prazo indeterminado'
                          : formatDateBR(selectedCompanyDetail.dataTerminoContrato)}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-slate-400 block text-[11px]">Atividade Contratada</span>
                      <span className="text-slate-200">
                        {selectedCompanyDetail.atividadeContratada || '—'}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-slate-400 block text-[11px]">Endereço Completo</span>
                      <span className="text-slate-200">{selectedCompanyDetail.endereco || '—'}</span>
                    </div>
                  </div>

                  {/* Admin EHS: Manage Authorized Solicitantes Links for this Company */}
                  {isAdmin && (
                    <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Users size={14} className="text-blue-400" />
                            Solicitantes Autorizados para esta Empresa ({linkedSolicitanteDraft.length})
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Um solicitante pode gerenciar múltiplas empresas e uma empresa pode ter múltiplos solicitantes autorizados.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={savingLinks}
                          onClick={handleSaveCompanyLinks}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold"
                        >
                          {savingLinks ? 'Salvando...' : 'Salvar Vínculos'}
                        </button>
                      </div>

                      {solicitanteUsers.length === 0 ? (
                        <p className="text-[11px] text-slate-400">
                          Nenhum usuário com perfil Solicitante ativo cadastrado.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {solicitanteUsers.map((u) => {
                            const checked = linkedSolicitanteDraft.includes(u.id);
                            return (
                              <label
                                key={u.id}
                                className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                  checked
                                    ? 'bg-blue-500/15 border-blue-500/40 text-white'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setLinkedSolicitanteDraft((prev) =>
                                      prev.includes(u.id)
                                        ? prev.filter((id) => id !== u.id)
                                        : [...prev, u.id]
                                    )
                                  }
                                  className="rounded bg-slate-950 border-slate-700 text-blue-600"
                                />
                                <div className="min-w-0">
                                  <span className="text-xs font-semibold block truncate">{u.nome}</span>
                                  <span className="text-[10px] text-slate-400 truncate block">
                                    {u.email}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'documentos' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-slate-400">
                      Documentos vinculados à empresa, com abertura de arquivo e decisão de aprovação/recusa do Administrador EHS.
                    </p>
                    {(isAdmin ||
                      (isSolicitante &&
                        effectiveAuthorizedEmpresaIds.includes(selectedCompanyDetail.id))) && (
                      <button
                        type="button"
                        onClick={() => handleOpenUploadDocModal(selectedCompanyDetail)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0"
                      >
                        <Upload size={13} />
                        Enviar Documento
                      </button>
                    )}
                  </div>

                  {selectedCompanyDocs.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                      Nenhum documento cadastrado para esta empresa.
                    </div>
                  ) : (
                    selectedCompanyDocs.map((doc) => {
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
                              <span className="font-bold text-white text-sm">
                                {doc.nomeDocumento}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                {doc.categoria}
                              </span>
                              {doc.colaboradorNome && (
                                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px]">
                                  Colaborador: {doc.colaboradorNome}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}
                              >
                                {doc.situacao === 'pendente'
                                  ? 'Aguardando Análise'
                                  : doc.situacao === 'reprovado'
                                  ? 'Recusado'
                                  : farol.label}
                              </span>
                            </div>
                            <p className="text-slate-400 text-[11px]">
                              Emissão: {formatDateBR(doc.dataEmissao)} · Validade:{' '}
                              {doc.semValidade ? 'Sem vencimento' : formatDateBR(doc.dataValidade)}
                              {doc.analisadoPor
                                ? ` · Avaliado por ${doc.analisadoPor} em ${formatDateTimeBR(
                                    doc.dataAnalise
                                  )}`
                                : ''}
                            </p>
                            {doc.motivoReprovacao && (
                              <p className="text-rose-300 text-[11px] bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                                <strong>Justificativa da recusa:</strong> {doc.motivoReprovacao}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {doc.arquivoUrl && (
                              <ProtectedDocumentButton
                                url={doc.arquivoUrl}
                                fileName={doc.arquivoNome || doc.nomeDocumento}
                                title={`Visualizar ${doc.nomeDocumento}`}
                                label="Abrir Arquivo"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                              />
                            )}
                            {isAdmin && doc.situacao !== 'aprovado' && (
                              <button
                                type="button"
                                disabled={submittingDecision}
                                onClick={() => handleApproveDoc(doc)}
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
                                  setRejectModal({ kind: 'document', doc });
                                  setRejectReason(doc.motivoReprovacao || '');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                              >
                                <XCircle size={13} />
                                Recusar
                              </button>
                            )}
                            {isSolicitante && doc.situacao === 'reprovado' && !doc.colaboradorId && (
                              <button
                                type="button"
                                onClick={() => handleOpenUploadDocModal(selectedCompanyDetail, doc)}
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

              {detailTab === 'alteracoes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-slate-400">
                      Solicitações de alteração cadastral enviadas pela contratada para validação do Administrador EHS.
                    </p>
                    {isSolicitante &&
                      effectiveAuthorizedEmpresaIds.includes(selectedCompanyDetail.id) && (
                      <button
                        type="button"
                        onClick={() => handleOpenChangeRequestModal(selectedCompanyDetail)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                      >
                        <FileEdit size={13} />
                        Nova Solicitação
                      </button>
                    )}
                  </div>

                  {selectedCompanyChangeRequests.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                      Nenhuma solicitação de alteração cadastral registrada para esta empresa.
                    </div>
                  ) : (
                    selectedCompanyChangeRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                req.status === 'pendente'
                                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                  : req.status === 'aprovada'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {req.status === 'pendente'
                                ? 'Aguardando Avaliação EHS'
                                : req.status === 'aprovada'
                                ? 'Aprovada'
                                : 'Recusada'}
                            </span>
                            <span className="text-slate-300 font-semibold">
                              Solicitado por {req.solicitadoPorNome}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            {formatDateTimeBR(req.dataSolicitacao)}
                          </span>
                        </div>

                        <p className="text-slate-300 bg-slate-900 rounded-lg p-2.5 border border-slate-800">
                          <strong className="text-slate-400">Justificativa da contratada:</strong>{' '}
                          {req.justificativaSolicitante}
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {(
                            Object.keys(req.dadosSolicitados) as Array<keyof CompanyEditableFields>
                          ).map((key) => (
                            <div
                              key={key}
                              className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800"
                            >
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                {CHANGE_FIELD_LABELS[key] || key}
                              </span>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="text-slate-400 line-through">
                                  {formatFieldValue(key, req.dadosAnteriores[key])}
                                </span>
                                <span className="text-slate-500">→</span>
                                <span className="font-semibold text-blue-300">
                                  {formatFieldValue(key, req.dadosSolicitados[key])}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {req.analisadoPorNome && (
                          <div className="text-[11px] text-slate-400 pt-1">
                            Avaliado por <strong className="text-slate-200">{req.analisadoPorNome}</strong> em{' '}
                            {formatDateTimeBR(req.dataAnalise)}
                            {req.justificativaAnalise && (
                              <div className="mt-1 text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5">
                                <strong>Justificativa EHS:</strong> {req.justificativaAnalise}
                              </div>
                            )}
                          </div>
                        )}

                        {isAdmin && req.status === 'pendente' && (
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                            <button
                              type="button"
                              disabled={submittingDecision}
                              onClick={() =>
                                handleApproveChangeReq(selectedCompanyDetail.id, req.id)
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                            >
                              <CheckCircle2 size={13} />
                              Aceitar Alteração
                            </button>
                            <button
                              type="button"
                              disabled={submittingDecision}
                              onClick={() => {
                                setRejectModal({
                                  kind: 'change_request',
                                  companyId: selectedCompanyDetail.id,
                                  requestId: req.id,
                                  title: `Solicitação de Alteração — ${selectedCompanyDetail.razaoSocial}`,
                                });
                                setRejectReason('');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                            >
                              <XCircle size={13} />
                              Recusar Alteração
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'conformidade' && (
                <ComplianceChecklistPanel
                  compliance={selectedCompanyCompliance}
                  activityProfiles={activityProfiles}
                  sourceLabel="preview"
                  defaultTab="empresa"
                />
              )}

              {detailTab === 'historico' && (
                <div className="space-y-2">
                  {selectedCompanyLogs.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400">
                      <History size={28} className="mx-auto text-slate-500 mb-2" />
                      Nenhum registro de auditoria ou alteração encontrado para esta empresa.
                    </div>
                  ) : (
                    selectedCompanyLogs.map((log) => (
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

            <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCompanyId(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
              >
                Fechar Dossiê
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Mandatory Justification Reject Modal */}
      {rejectModal && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmReject}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <XCircle size={16} className="text-rose-400" />
                Justificativa Obrigatória da Recusa
              </h3>
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              {rejectModal.kind === 'document'
                ? `Documento: ${rejectModal.doc.nomeDocumento}`
                : rejectModal.title}
            </p>
            <div>
              <label className="block text-xs font-semibold text-rose-300 mb-1.5">
                Motivo da Recusa *
              </label>
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Descreva claramente o motivo da recusa e o que deve ser corrigido pela contratada..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRejectModal(null)}
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
