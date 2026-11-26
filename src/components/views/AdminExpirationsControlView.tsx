import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  User,
  ExternalLink,
  Calendar,
  X,
  Loader2,
  Eye,
  Download,
  Plus,
  Trash2,
  Lock,
  ShieldAlert,
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
  STANDARDIZED_STATUS_META,
  StandardizedDocStatus,
  formatDateTimePt,
  getExpirationInfo,
  resolveIntegrationItemStandardizedStatus,
} from '../../utils/documentStatus';
import { ProtectedDocumentButton } from '../common/ProtectedDocumentButton';

interface AdminExpirationsControlViewProps {
  onNavigate?: (
    tab: NavItemKey,
    opts?: { integrationId?: string; companyId?: string; employeeId?: string }
  ) => void;
}

const MAX_DIRECT_FILE_BYTES = 700 * 1024;

type AdminExpirationEntry =
  | {
      source: 'integration';
      uid: string;
      empresaId: string;
      empresaNome: string;
      colaboradorId?: string;
      colaboradorNome?: string;
      integrationId: string;
      codigoProtocolo: string;
      title: string;
      scopeLabel: 'Empresa' | 'Colaborador';
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
      source: 'document';
      uid: string;
      empresaId: string;
      empresaNome: string;
      colaboradorId?: string;
      colaboradorNome?: string;
      title: string;
      scopeLabel: 'Empresa' | 'Colaborador';
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
      source: 'exam';
      uid: string;
      empresaId: string;
      empresaNome: string;
      colaboradorId: string;
      colaboradorNome: string;
      title: string;
      scopeLabel: 'Colaborador';
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
      source: 'training';
      uid: string;
      empresaId: string;
      empresaNome: string;
      colaboradorId: string;
      colaboradorNome: string;
      title: string;
      scopeLabel: 'Colaborador';
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

function resolveDirectStatus(
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

export const AdminExpirationsControlView: React.FC<AdminExpirationsControlViewProps> = ({
  onNavigate,
}) => {
  const { isAdmin, isAuditor, profile } = useAuth();
  const {
    companies,
    employees,
    contractorIntegrationItems,
    documents,
    exams,
    trainings,
    listIntegrationItemsOnServer,
    reviewIntegrationItemOnServer,
    updateIntegrationItemValidityOnServer,
    fetchIntegrationItemFileBlobOnServer,
    addDocument,
    updateDocument,
    approveDocument,
    rejectDocument,
    deleteDocument,
    addExam,
    updateExam,
    approveExam,
    rejectExam,
    deleteExam,
    addTraining,
    updateTraining,
    approveTraining,
    rejectTraining,
    deleteTraining,
  } = useSST();

  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState<
    'ALL' | 'VENCIDO' | 'PROXIMO' | 'VALIDO' | 'SEM_VALIDADE' | 'PENDENTE'
  >('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'Empresa' | 'Colaborador'>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Preview state for integration items
  const [previewDoc, setPreviewDoc] = useState<{
    fileName: string;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    objectUrl: string;
    label: string;
  } | null>(null);
  const [loadingFileKey, setLoadingFileKey] = useState<string | null>(null);

  // Validity / Approve / Reject Modal
  const [actionModal, setActionModal] = useState<{
    entry: AdminExpirationEntry;
    mode: 'APROVADO' | 'REPROVADO' | 'VALIDADE';
  } | null>(null);
  const [modalValidade, setModalValidade] = useState('');
  const [modalSemValidade, setModalSemValidade] = useState(false);
  const [modalMotivo, setModalMotivo] = useState('');
  const [modalObs, setModalObs] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  // Delete Confirmation Modal (Admin-only, non-integration items)
  const [deleteTarget, setDeleteTarget] = useState<AdminExpirationEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Include New Document Modal (Admin-only)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addKind, setAddKind] = useState<'document' | 'exam' | 'training'>('document');
  const [addForm, setAddForm] = useState({
    empresaId: '',
    colaboradorId: '',
    titulo: '',
    categoria: 'Documento Empresarial',
    conclusao: 'apto' as 'apto' | 'inapto',
    cargaHoraria: '8h',
    dataEmissao: new Date().toISOString().slice(0, 10),
    dataValidade: '',
    semValidade: false,
    situacao: 'aprovado' as 'aprovado' | 'pendente',
    observacoes: '',
    arquivoNome: '',
    arquivoUrl: '',
  });
  const [savingAdd, setSavingAdd] = useState(false);

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
      await listIntegrationItemsOnServer();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível atualizar os vencimentos.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const entries = useMemo<AdminExpirationEntry[]>(() => {
    const list: AdminExpirationEntry[] = [];

    for (const item of contractorIntegrationItems) {
      list.push({
        source: 'integration',
        uid: `int-${item.id}`,
        empresaId: item.empresaId || '',
        empresaNome: item.empresaNome,
        colaboradorId: item.colaboradorId,
        colaboradorNome: item.colaboradorNome,
        integrationId: item.integrationId,
        codigoProtocolo: item.codigoProtocolo,
        title: item.nomeExibicao,
        scopeLabel: item.colaboradorId || item.colaboradorNome ? 'Colaborador' : 'Empresa',
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
      list.push({
        source: 'document',
        uid: `doc-${doc.id}`,
        empresaId: doc.empresaId,
        empresaNome: doc.empresaNome,
        colaboradorId: doc.colaboradorId,
        colaboradorNome: doc.colaboradorNome,
        title: doc.nomeDocumento,
        scopeLabel: doc.colaboradorId ? 'Colaborador' : 'Empresa',
        dataValidade: doc.dataValidade,
        semValidade: doc.semValidade,
        analisadoPor: doc.analisadoPor,
        dataAnalise: doc.dataAnalise,
        motivoReprovacao: doc.motivoReprovacao,
        arquivoNome: doc.arquivoNome,
        arquivoUrl: doc.arquivoUrl,
        hasFile: Boolean(doc.arquivoUrl),
        stdStatus: resolveDirectStatus(doc.situacao, doc.dataValidade, doc.semValidade),
        raw: doc,
      });
    }

    for (const ex of exams) {
      list.push({
        source: 'exam',
        uid: `exam-${ex.id}`,
        empresaId: ex.empresaId,
        empresaNome: ex.empresaNome,
        colaboradorId: ex.colaboradorId,
        colaboradorNome: ex.colaboradorNome,
        title: `ASO / Exame: ${ex.tipoExame}`,
        scopeLabel: 'Colaborador',
        dataValidade: ex.dataValidade,
        semValidade: ex.semValidade,
        analisadoPor: ex.analisadoPor,
        dataAnalise: ex.dataAnalise,
        motivoReprovacao: ex.motivoReprovacao,
        arquivoNome: ex.anexoNome,
        arquivoUrl: ex.anexoUrl,
        hasFile: Boolean(ex.anexoUrl),
        stdStatus: resolveDirectStatus(ex.situacao, ex.dataValidade, ex.semValidade),
        raw: ex,
      });
    }

    for (const tr of trainings) {
      list.push({
        source: 'training',
        uid: `train-${tr.id}`,
        empresaId: tr.empresaId,
        empresaNome: tr.empresaNome,
        colaboradorId: tr.colaboradorId,
        colaboradorNome: tr.colaboradorNome,
        title: `Treinamento: ${tr.nomeTreinamento}`,
        scopeLabel: 'Colaborador',
        dataValidade: tr.dataValidade,
        semValidade: tr.semValidade,
        analisadoPor: tr.analisadoPor,
        dataAnalise: tr.dataAnalise,
        motivoReprovacao: tr.motivoReprovacao,
        arquivoNome: tr.certificadoNome,
        arquivoUrl: tr.certificadoUrl,
        hasFile: Boolean(tr.certificadoUrl),
        stdStatus: resolveDirectStatus(tr.situacao, tr.dataValidade, tr.semValidade),
        raw: tr,
      });
    }

    return list;
  }, [contractorIntegrationItems, documents, exams, trainings]);

  const enriched = useMemo(() => {
    return entries.map((entry) => ({
      entry,
      exp: getExpirationInfo(entry.dataValidade, entry.semValidade),
    }));
  }, [entries]);

  const counts = useMemo(() => {
    let vencido = 0;
    let proximo = 0;
    let valido = 0;
    let semValidade = 0;
    let pendente = 0;
    for (const { entry, exp } of enriched) {
      if (entry.stdStatus === 'AGUARDANDO_ANALISE' || entry.stdStatus === 'EM_ANALISE') {
        pendente += 1;
      }
      if (exp.state === 'expired') vencido += 1;
      else if (exp.state === 'expiring') proximo += 1;
      else if (exp.state === 'valid') valido += 1;
      else semValidade += 1;
    }
    return { total: enriched.length, vencido, proximo, valido, semValidade, pendente };
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched
      .filter(({ entry, exp }) => {
        if (companyFilter !== 'ALL' && entry.empresaId !== companyFilter) return false;
        if (scopeFilter !== 'ALL' && entry.scopeLabel !== scopeFilter) return false;
        if (bucketFilter === 'VENCIDO' && exp.state !== 'expired') return false;
        if (bucketFilter === 'PROXIMO' && exp.state !== 'expiring') return false;
        if (bucketFilter === 'VALIDO' && exp.state !== 'valid') return false;
        if (bucketFilter === 'SEM_VALIDADE' && exp.state !== 'none') return false;
        if (
          bucketFilter === 'PENDENTE' &&
          entry.stdStatus !== 'AGUARDANDO_ANALISE' &&
          entry.stdStatus !== 'EM_ANALISE'
        ) {
          return false;
        }
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const hay = [
            entry.title,
            entry.empresaNome,
            entry.colaboradorNome || '',
            entry.source === 'integration' ? entry.codigoProtocolo : '',
            entry.analisadoPor || '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const order = { expired: 0, expiring: 1, valid: 2, none: 3 };
        const diff = order[a.exp.state] - order[b.exp.state];
        if (diff !== 0) return diff;
        if (a.exp.daysRemaining !== null && b.exp.daysRemaining !== null) {
          return a.exp.daysRemaining - b.exp.daysRemaining;
        }
        return a.entry.title.localeCompare(b.entry.title, 'pt-BR');
      });
  }, [enriched, companyFilter, scopeFilter, bucketFilter, search]);

  const handleOpenIntegrationFile = async (
    item: MirroredIntegrationDocumentItem,
    download = false
  ) => {
    const key = `${item.id}-${download ? 'dl' : 'vw'}`;
    setLoadingFileKey(key);
    setFeedback(null);
    try {
      const res = await fetchIntegrationItemFileBlobOnServer(item.integrationId, item.id, {
        download,
      });
      const url = URL.createObjectURL(res.blob);
      if (download) {
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
          label: item.nomeExibicao,
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao abrir documento.' });
    } finally {
      setLoadingFileKey(null);
    }
  };

  const openActionModal = (
    entry: AdminExpirationEntry,
    mode: 'APROVADO' | 'REPROVADO' | 'VALIDADE'
  ) => {
    if (!isAdmin) return;
    setActionModal({ entry, mode });
    setModalValidade(entry.dataValidade ? entry.dataValidade.slice(0, 10) : '');
    setModalSemValidade(Boolean(entry.semValidade));
    setModalMotivo(entry.motivoReprovacao || '');
    setModalObs(entry.raw.observacoes || '');
  };

  const handleConfirmAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal || !isAdmin) return;
    const { entry, mode } = actionModal;

    if (mode === 'REPROVADO' && !modalMotivo.trim()) {
      setFeedback({
        type: 'error',
        text: 'Informe obrigatoriamente a justificativa da recusa.',
      });
      return;
    }

    setSavingAction(true);
    setFeedback(null);
    try {
      if (entry.source === 'integration') {
        if (mode === 'VALIDADE') {
          await updateIntegrationItemValidityOnServer(entry.integrationId, entry.raw.id, {
            dataValidade: modalSemValidade ? '' : modalValidade,
            semValidade: modalSemValidade,
            observacoes: modalObs,
          });
        } else {
          await reviewIntegrationItemOnServer(entry.integrationId, entry.raw.id, {
            decisao: mode,
            motivo: mode === 'REPROVADO' ? modalMotivo.trim() : undefined,
            dataValidade:
              mode === 'APROVADO' && !modalSemValidade ? modalValidade || undefined : undefined,
            semValidade: mode === 'APROVADO' ? modalSemValidade : undefined,
            observacoes: modalObs || undefined,
          });
        }
        await listIntegrationItemsOnServer();
      } else if (entry.source === 'document') {
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
      } else if (entry.source === 'exam') {
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
      } else if (entry.source === 'training') {
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
            ? `Validade de "${entry.title}" atualizada.`
            : mode === 'APROVADO'
            ? `"${entry.title}" aceito/aprovado e espelhado para a contratada.`
            : `"${entry.title}" recusado com justificativa espelhada para a contratada.`,
      });
      setActionModal(null);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao salvar alteração.' });
    } finally {
      setSavingAction(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !isAdmin || deleteTarget.source === 'integration') return;
    setDeleting(true);
    setFeedback(null);
    try {
      if (deleteTarget.source === 'document') {
        await deleteDocument(deleteTarget.raw.id);
      } else if (deleteTarget.source === 'exam') {
        await deleteExam(deleteTarget.raw.id);
      } else if (deleteTarget.source === 'training') {
        await deleteTraining(deleteTarget.raw.id);
      }
      setFeedback({
        type: 'success',
        text: `Documento "${deleteTarget.title}" excluído com registro em trilha de auditoria.`,
      });
      setDeleteTarget(null);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao excluir documento.' });
    } finally {
      setDeleting(false);
    }
  };

  const handleAddFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_DIRECT_FILE_BYTES) {
      setFeedback({
        type: 'error',
        text: 'Arquivo excede o limite de 700 KB para inclusão direta.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setAddForm((prev) => ({
          ...prev,
          arquivoNome: file.name,
          arquivoUrl: String(ev.target?.result),
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitNewDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const comp = companies.find((c) => c.id === addForm.empresaId);
    if (!comp) {
      setFeedback({ type: 'error', text: 'Selecione uma empresa contratada.' });
      return;
    }
    const emp = addForm.colaboradorId
      ? employees.find((x) => x.id === addForm.colaboradorId)
      : undefined;
    if ((addKind === 'exam' || addKind === 'training') && !emp) {
      setFeedback({
        type: 'error',
        text: 'Exames e treinamentos devem ser vinculados a um colaborador.',
      });
      return;
    }
    if (!addForm.titulo.trim()) {
      setFeedback({ type: 'error', text: 'Informe o nome/título do documento.' });
      return;
    }
    if (!addForm.semValidade && !addForm.dataValidade) {
      setFeedback({
        type: 'error',
        text: 'Informe a data de validade ou marque "Sem validade".',
      });
      return;
    }

    setSavingAdd(true);
    setFeedback(null);
    try {
      if (addKind === 'document') {
        await addDocument({
          empresaId: comp.id,
          empresaNome: comp.razaoSocial,
          colaboradorId: emp?.id,
          colaboradorNome: emp?.nomeCompleto,
          nomeDocumento: addForm.titulo.trim(),
          categoria: addForm.categoria,
          dataEmissao: addForm.dataEmissao,
          dataValidade: addForm.semValidade ? '' : addForm.dataValidade,
          semValidade: addForm.semValidade,
          observacoes: addForm.observacoes.trim(),
          arquivoNome: addForm.arquivoNome,
          arquivoUrl: addForm.arquivoUrl,
          responsavelEnvio: profile?.nome || 'Administrador EHS',
          versao: 1,
          situacao: addForm.situacao,
          origemEnvio: 'admin',
        });
      } else if (addKind === 'exam' && emp) {
        await addExam({
          empresaId: comp.id,
          empresaNome: comp.razaoSocial,
          colaboradorId: emp.id,
          colaboradorNome: emp.nomeCompleto,
          tipoExame: addForm.titulo.trim(),
          conclusao: addForm.conclusao,
          dataRealizacao: addForm.dataEmissao,
          dataValidade: addForm.semValidade ? '' : addForm.dataValidade,
          semValidade: addForm.semValidade,
          observacoes: addForm.observacoes.trim(),
          anexoNome: addForm.arquivoNome,
          anexoUrl: addForm.arquivoUrl,
          situacao: addForm.situacao,
        });
      } else if (addKind === 'training' && emp) {
        await addTraining({
          empresaId: comp.id,
          empresaNome: comp.razaoSocial,
          colaboradorId: emp.id,
          colaboradorNome: emp.nomeCompleto,
          nomeTreinamento: addForm.titulo.trim(),
          cargaHoraria: addForm.cargaHoraria,
          dataRealizacao: addForm.dataEmissao,
          dataValidade: addForm.semValidade ? '' : addForm.dataValidade,
          semValidade: addForm.semValidade,
          observacoes: addForm.observacoes.trim(),
          certificadoNome: addForm.arquivoNome,
          certificadoUrl: addForm.arquivoUrl,
          situacao: addForm.situacao,
        });
      }
      setFeedback({
        type: 'success',
        text: `Documento "${addForm.titulo}" incluído no Controle de Vencimentos.`,
      });
      setIsAddModalOpen(false);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Erro ao incluir novo documento.' });
    } finally {
      setSavingAdd(false);
    }
  };

  const employeesForSelectedAddCompany = useMemo(
    () => employees.filter((e) => !addForm.empresaId || e.empresaId === addForm.empresaId),
    [employees, addForm.empresaId]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <CalendarClock className="text-blue-400" size={22} />
            Controle de Vencimentos (Administrador EHS)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitoramento unificado de validades com abertura individual, acesso direto ao dossiê, inclusão, exclusão, aceite e recusa espelhada para a contratada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setAddForm({
                  empresaId: companies[0]?.id || '',
                  colaboradorId: '',
                  titulo: '',
                  categoria: 'Documento Empresarial',
                  conclusao: 'apto',
                  cargaHoraria: '8h',
                  dataEmissao: new Date().toISOString().slice(0, 10),
                  dataValidade: '',
                  semValidade: false,
                  situacao: 'aprovado',
                  observacoes: '',
                  arquivoNome: '',
                  arquivoUrl: '',
                });
                setAddKind('document');
                setIsAddModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20"
            >
              <Plus size={15} />
              Incluir Novo Documento
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {isAuditor && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2">
          <ShieldAlert size={16} className="shrink-0 text-amber-400" />
          <span>
            Perfil Auditor em modo <strong>somente leitura</strong>. Inclusão, exclusão e decisões documentais são exclusivas do Administrador EHS.
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

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setBucketFilter('VENCIDO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucketFilter === 'VENCIDO' ? 'border-red-400' : 'border-red-500/30 hover:border-red-400/60'
          }`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-300 flex items-center gap-1.5">
            <XCircle size={13} /> Vencidos
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.vencido}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucketFilter('PROXIMO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucketFilter === 'PROXIMO'
              ? 'border-orange-400'
              : 'border-orange-500/30 hover:border-orange-400/60'
          }`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-300 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Próx. Venc. (30d)
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.proximo}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucketFilter('VALIDO')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucketFilter === 'VALIDO'
              ? 'border-emerald-400'
              : 'border-emerald-500/30 hover:border-emerald-400/60'
          }`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Válidos
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.valido}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucketFilter('SEM_VALIDADE')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors ${
            bucketFilter === 'SEM_VALIDADE'
              ? 'border-slate-400'
              : 'border-slate-700 hover:border-slate-500'
          }`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Clock size={13} /> Sem Validade
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.semValidade}</p>
        </button>

        <button
          type="button"
          onClick={() => setBucketFilter('PENDENTE')}
          className={`text-left p-4 rounded-xl bg-slate-900 border transition-colors col-span-2 lg:col-span-1 ${
            bucketFilter === 'PENDENTE'
              ? 'border-sky-400'
              : 'border-sky-500/30 hover:border-sky-400/60'
          }`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
            <Clock size={13} /> Aguardando Análise
          </span>
          <p className="text-2xl font-extrabold text-white mt-1.5">{counts.pendente}</p>
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
            placeholder="Buscar por documento, empresa, colaborador ou protocolo..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white max-w-[200px]"
          >
            <option value="ALL">Todas as Empresas</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nomeFantasia || c.razaoSocial}
              </option>
            ))}
          </select>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
          >
            <option value="ALL">Empresa e Colaborador</option>
            <option value="Empresa">Somente Empresa</option>
            <option value="Colaborador">Somente Colaborador</option>
          </select>

          <select
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
          >
            <option value="ALL">Todas as Validades ({counts.total})</option>
            <option value="VENCIDO">Vencidos ({counts.vencido})</option>
            <option value="PROXIMO">Próx. Vencimento ({counts.proximo})</option>
            <option value="VALIDO">Válidos ({counts.valido})</option>
            <option value="SEM_VALIDADE">Sem Validade ({counts.semValidade})</option>
            <option value="PENDENTE">Aguardando Análise ({counts.pendente})</option>
          </select>

          {(search ||
            companyFilter !== 'ALL' ||
            scopeFilter !== 'ALL' ||
            bucketFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCompanyFilter('ALL');
                setScopeFilter('ALL');
                setBucketFilter('ALL');
              }}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Unified Expiration List */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 size={30} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-white">
              Nenhum documento encontrado para os filtros aplicados
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map(({ entry, exp }) => {
              const meta = STANDARDIZED_STATUS_META[entry.stdStatus];
              const isIntegration = entry.source === 'integration';

              return (
                <div
                  key={entry.uid}
                  className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </span>
                      <h4 className="text-sm font-bold text-white">{entry.title}</h4>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
                        {entry.scopeLabel}
                      </span>
                      {isIntegration && (
                        <span className="text-[11px] font-mono text-blue-400">
                          {entry.codigoProtocolo}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={12} />
                        <strong className="text-slate-200">{entry.empresaNome}</strong>
                      </span>
                      {entry.colaboradorNome && (
                        <span className="inline-flex items-center gap-1">
                          <User size={12} />
                          <strong className="text-slate-200">{entry.colaboradorNome}</strong>
                        </span>
                      )}
                      <span>
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
                        {exp.daysRemaining !== null && (
                          <span className="text-slate-500"> ({exp.label})</span>
                        )}
                      </span>
                      {entry.analisadoPor && (
                        <span>
                          Avaliado por <strong className="text-slate-300">{entry.analisadoPor}</strong>{' '}
                          ({formatDateTimePt(entry.dataAnalise)})
                        </span>
                      )}
                    </div>

                    {entry.motivoReprovacao && (
                      <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded px-2.5 py-1.5 mt-1">
                        <strong>Justificativa da recusa:</strong> {entry.motivoReprovacao}
                      </p>
                    )}
                  </div>

                  {/* Admin Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {/* View / Open individual document */}
                    {isIntegration && entry.hasFile && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenIntegrationFile(entry.raw, false)}
                          disabled={loadingFileKey !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium"
                        >
                          {loadingFileKey === `${entry.raw.id}-vw` ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Eye size={12} />
                          )}
                          Abrir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenIntegrationFile(entry.raw, true)}
                          disabled={loadingFileKey !== null}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                          title="Baixar arquivo"
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
                        label="Abrir"
                        icon={<Eye size={12} />}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium"
                      />
                    )}

                    {/* Direct navigation to Dossier */}
                    {onNavigate && entry.colaboradorId ? (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate('colaboradores', { employeeId: entry.colaboradorId })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-semibold text-blue-300"
                        title="Abrir dossiê do colaborador"
                      >
                        <ExternalLink size={12} />
                        Dossiê Colaborador
                      </button>
                    ) : onNavigate && entry.empresaId ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('empresas', { companyId: entry.empresaId })}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-semibold text-blue-300"
                        title="Abrir dossiê da empresa"
                      >
                        <ExternalLink size={12} />
                        Dossiê Empresa
                      </button>
                    ) : null}

                    {/* Accept / Reject / Validity */}
                    {isAdmin && entry.stdStatus !== 'APROVADO' && (!isIntegration || entry.hasFile) && (
                      <button
                        type="button"
                        onClick={() => openActionModal(entry, 'APROVADO')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                      >
                        <CheckCircle2 size={12} />
                        Aceitar
                      </button>
                    )}

                    {isAdmin && entry.stdStatus !== 'REPROVADO' && (!isIntegration || entry.hasFile) && (
                      <button
                        type="button"
                        onClick={() => openActionModal(entry, 'REPROVADO')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
                      >
                        <XCircle size={12} />
                        Recusar
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openActionModal(entry, 'VALIDADE')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
                        title="Editar validade"
                      >
                        <Calendar size={12} />
                        Validade
                      </button>
                    )}

                    {/* Delete (Admin-only, preserves immutable integration protocol history) */}
                    {isAdmin &&
                      (isIntegration ? (
                        <span
                          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-600 cursor-not-allowed"
                          title="Itens de protocolo de integração possuem histórico auditável protegido contra exclusão"
                        >
                          <Lock size={13} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(entry)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                          title="Excluir documento"
                        >
                          <Trash2 size={14} />
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Include New Document Modal (Admin Only) */}
      {isAddModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <form
            onSubmit={handleSubmitNewDoc}
            className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus size={18} className="text-blue-400" />
                Incluir Novo Documento
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { id: 'document' as const, label: 'Documento' },
                { id: 'exam' as const, label: 'Exame / ASO' },
                { id: 'training' as const, label: 'Treinamento' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAddKind(t.id)}
                  className={`py-2 px-2.5 rounded-lg border font-semibold ${
                    addKind === t.id
                      ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Empresa Contratada *
                </label>
                <select
                  required
                  value={addForm.empresaId}
                  onChange={(e) =>
                    setAddForm({ ...addForm, empresaId: e.target.value, colaboradorId: '' })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                >
                  <option value="">Selecione a empresa...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razaoSocial}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Colaborador {addKind === 'document' ? '(opcional — vazio = documento da empresa)' : '*'}
                </label>
                <select
                  required={addKind !== 'document'}
                  value={addForm.colaboradorId}
                  onChange={(e) => setAddForm({ ...addForm, colaboradorId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                >
                  <option value="">
                    {addKind === 'document'
                      ? 'Documento da Empresa (sem colaborador específico)'
                      : 'Selecione o colaborador...'}
                  </option>
                  {employeesForSelectedAddCompany.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nomeCompleto} ({emp.cargo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  {addKind === 'exam'
                    ? 'Tipo de Exame / ASO *'
                    : addKind === 'training'
                    ? 'Nome do Treinamento *'
                    : 'Nome do Documento *'}
                </label>
                <input
                  type="text"
                  required
                  value={addForm.titulo}
                  onChange={(e) => setAddForm({ ...addForm, titulo: e.target.value })}
                  placeholder="Ex: PGR 2026, ASO Periódico, NR-35"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">
                    Data de Emissão / Realização
                  </label>
                  <input
                    type="date"
                    value={addForm.dataEmissao}
                    onChange={(e) => setAddForm({ ...addForm, dataEmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Data de Validade</label>
                  <input
                    type="date"
                    disabled={addForm.semValidade}
                    required={!addForm.semValidade}
                    value={addForm.semValidade ? '' : addForm.dataValidade}
                    onChange={(e) => setAddForm({ ...addForm, dataValidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white disabled:opacity-40"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addForm.semValidade}
                  onChange={(e) =>
                    setAddForm((prev) => ({
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
                  Anexo (PDF, JPG ou PNG — até 700 KB)
                </label>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png"
                  onChange={handleAddFileChange}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200"
                />
                {addForm.arquivoNome && (
                  <p className="text-[11px] text-emerald-400 mt-1">Anexado: {addForm.arquivoNome}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingAdd}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {savingAdd ? 'Salvando...' : 'Incluir Documento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Action Modal (Approve / Reject / Validity) */}
      {actionModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmAction}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {actionModal.mode === 'APROVADO'
                    ? 'Aceitar Documento'
                    : actionModal.mode === 'REPROVADO'
                    ? 'Recusar Documento (Justificativa Obrigatória)'
                    : 'Editar Data de Validade'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {actionModal.entry.title} · {actionModal.entry.empresaNome}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              {actionModal.mode === 'REPROVADO' ? (
                <div>
                  <label className="block font-semibold text-rose-300 mb-1.5">
                    Motivo / Justificativa da Recusa *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={modalMotivo}
                    onChange={(e) => setModalMotivo(e.target.value)}
                    placeholder="Informe o motivo da recusa que será exibido à contratada..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-xs text-white"
                  />
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalSemValidade}
                      onChange={(e) => setModalSemValidade(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-950"
                    />
                    <span>Documento sem data de validade</span>
                  </label>

                  {!modalSemValidade && (
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">
                        Data de Validade {actionModal.mode === 'VALIDADE' ? '*' : '(opcional)'}
                      </label>
                      <input
                        type="date"
                        required={actionModal.mode === 'VALIDADE'}
                        value={modalValidade}
                        onChange={(e) => setModalValidade(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Observações</label>
                    <textarea
                      rows={2}
                      value={modalObs}
                      onChange={(e) => setModalObs(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-xs text-white"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingAction}
                className={`px-4 py-2 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 ${
                  actionModal.mode === 'REPROVADO'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : actionModal.mode === 'APROVADO'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {savingAction && <Loader2 size={13} className="animate-spin" />}
                {actionModal.mode === 'APROVADO'
                  ? 'Confirmar Aceite'
                  : actionModal.mode === 'REPROVADO'
                  ? 'Confirmar Recusa'
                  : 'Salvar Validade'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal (Admin Only) */}
      {deleteTarget && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Exclusão de Documento</h3>
                <p className="text-xs text-slate-400">Esta ação é registrada na trilha de auditoria.</p>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              Confirma a exclusão de <strong className="text-white">{deleteTarget.title}</strong> ({deleteTarget.empresaNome})?
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white"
              >
                {deleting ? 'Excluindo...' : 'Excluir Documento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration File Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">{previewDoc.label}</h3>
                <p className="text-[11px] text-slate-400">{previewDoc.fileName}</p>
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
