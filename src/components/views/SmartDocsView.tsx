import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileSearch,
  Upload,
  Plus,
  Search,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Building2,
  User,
  Calendar,
  Clock,
  ShieldCheck,
  Lock,
  History,
  FileText,
  Image as ImageIcon,
  X,
  Save,
  Settings,
  Trash2,
  ExternalLink,
  MessageSquareWarning,
  Loader2,
  Check,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSST } from '../../context/SSTContext';
import {
  SmartDocCategoryGroup,
  SmartDocExtractedData,
  SmartDocProcessingState,
  SmartDocRecord,
  SmartDocValidityRule,
  SmartDocValidityStatus,
} from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

const CATEGORY_LABELS: Record<SmartDocCategoryGroup, string> = {
  saude_ocupacional: 'Saúde Ocupacional',
  treinamentos: 'Treinamentos e Capacitações',
  documentos_empresariais: 'Documentos Empresariais',
  outros: 'Outros / Classificação Manual',
};

const TAXONOMY_OPTIONS: Record<SmartDocCategoryGroup, string[]> = {
  saude_ocupacional: ['ASO', 'Exames ocupacionais', 'Atestados de saúde ocupacional'],
  treinamentos: [
    'NR-01',
    'NR-05',
    'NR-06',
    'NR-10',
    'NR-11',
    'NR-12',
    'NR-13',
    'NR-18',
    'NR-20',
    'NR-23',
    'NR-26',
    'NR-33',
    'NR-35',
    'Operador de empilhadeira',
    'Operador de plataforma elevatória',
    'Operador de guindaste',
    'Outros treinamentos',
  ],
  documentos_empresariais: [
    'PGR',
    'PCMSO',
    'LTCAT',
    'APR',
    'Procedimentos de segurança',
    'Documentação de terceiros',
  ],
  outros: ['Classificação manual', 'Documento não listado'],
};

const PROCESSING_BADGE: Record<
  SmartDocProcessingState,
  { label: string; cls: string }
> = {
  AGUARDANDO_PROCESSAMENTO: {
    label: 'Aguardando',
    cls: 'bg-slate-800 text-slate-300 border border-slate-700',
  },
  PROCESSANDO: {
    label: 'Processando IA',
    cls: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  PROCESSADO: {
    label: 'Processado',
    cls: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30',
  },
  ERRO_LEITURA: {
    label: 'Erro na Leitura',
    cls: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
  PENDENTE_APROVACAO: {
    label: 'Pendente de Aprovação',
    cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  },
  APROVADO: {
    label: 'Aprovado',
    cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  },
  REJEITADO: {
    label: 'Rejeitado',
    cls: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
};

const VALIDITY_BADGE: Record<SmartDocValidityStatus, { label: string; cls: string }> = {
  REGULAR: {
    label: 'Regular',
    cls: 'bg-emerald-950/70 text-emerald-400 border border-emerald-700/60',
  },
  A_VENCER: {
    label: 'A Vencer (≤30d)',
    cls: 'bg-amber-950/70 text-amber-300 border border-amber-600/60',
  },
  VENCIDO: {
    label: 'Vencido',
    cls: 'bg-red-950/70 text-red-400 border border-red-700/60',
  },
  SEM_VALIDADE_DEFINIDA: {
    label: 'Sem validade definida',
    cls: 'bg-slate-800 text-slate-300 border border-slate-700',
  },
  PENDENTE_APROVACAO: {
    label: 'Aguardando aprovação',
    cls: 'bg-slate-800 text-slate-400 border border-slate-700',
  },
  REJEITADO: {
    label: 'Rejeitado',
    cls: 'bg-red-950/60 text-red-400 border border-red-800/70',
  },
};

async function readAndOptimizeFileForUpload(file: File): Promise<{
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  dataUrl: string;
}> {
  const lower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
  const isPng = file.type === 'image/png' || lower.endsWith('.png');
  const isJpg =
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg');

  if (!isPdf && !isPng && !isJpg) {
    throw new Error('Formato não suportado. Selecione apenas PDF, JPG, JPEG ou PNG.');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('O arquivo excede o limite de 5 MB por operação.');
  }

  const readAsDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
      reader.readAsDataURL(blob);
    });

  const rawDataUrl = await readAsDataUrl(file);
  if (isPdf) {
    return { fileName: file.name, mimeType: 'application/pdf', dataUrl: rawDataUrl };
  }

  const baseMime: 'image/jpeg' | 'image/png' = isPng ? 'image/png' : 'image/jpeg';

  // Compress large camera photos (> 480 KB) safely so inline preview persists within Firestore 1 MB cap
  if (rawDataUrl.length <= 650_000) {
    return { fileName: file.name, mimeType: baseMime, dataUrl: rawDataUrl };
  }

  const optimizedUrl = await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1800;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });

  return {
    fileName: file.name.replace(/\.png$/i, '.jpg'),
    mimeType: optimizedUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : baseMime,
    dataUrl: optimizedUrl,
  };
}

const FieldLabel: React.FC<{ label: string; value?: string; required?: boolean }> = ({
  label,
  value,
  required,
}) => {
  const isMissing = !value || !value.trim();
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <label className="text-xs font-medium text-slate-300">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {isMissing && (
        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[9px] font-bold uppercase tracking-wider text-amber-300 shrink-0">
          NÃO IDENTIFICADO
        </span>
      )}
    </div>
  );
};

export const SmartDocsView: React.FC = () => {
  const { authorizedFetch, isAdmin, isSolicitante, isAuditor, canEdit, activeEmpresaId } = useAuth();
  const { companies, employees } = useSST();

  const [items, setItems] = useState<SmartDocRecord[]>([]);
  const [aiConfigured, setAiConfigured] = useState<boolean>(true);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string>('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState('todas');
  const [colaboradorFilter, setColaboradorFilter] = useState('todos');
  const [categoriaFilter, setCategoriaFilter] = useState('todas');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Upload modal
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewLocalUrl, setPreviewLocalUrl] = useState<string>('');
  const [useManualClass, setUseManualClass] = useState(false);
  const [manualCategoria, setManualCategoria] = useState<SmartDocCategoryGroup>('documentos_empresariais');
  const [manualTipo, setManualTipo] = useState('');
  const [uploadStep, setUploadStep] = useState<
    'IDLE' | 'AGUARDANDO_PROCESSAMENTO' | 'PROCESSANDO' | 'PROCESSADO' | 'ERRO_LEITURA'
  >('IDLE');
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Review / Conference modal
  const [activeDoc, setActiveDoc] = useState<SmartDocRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editCategoria, setEditCategoria] = useState<SmartDocCategoryGroup>('documentos_empresariais');
  const [editTipo, setEditTipo] = useState('');
  const [editCustomTipo, setEditCustomTipo] = useState('');
  const [editEmpresaId, setEditEmpresaId] = useState('');
  const [editColaboradorId, setEditColaboradorId] = useState('');
  const [editDados, setEditDados] = useState<SmartDocExtractedData>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Correction / Rejection modals
  const [decisionModal, setDecisionModal] = useState<'correction' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  // Validity rules modal
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [validityRules, setValidityRules] = useState<SmartDocValidityRule[]>([]);
  const [newRuleType, setNewRuleType] = useState('ASO');
  const [newRuleMonths, setNewRuleMonths] = useState(12);
  const [newRuleObs, setNewRuleObs] = useState('');

  const loadSmartDocs = async () => {
    setLoadingList(true);
    setListError('');
    try {
      const resp = await authorizedFetch('/api/smartdocs');
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Erro ao carregar documentos do SmartDocs.');
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setAiConfigured(Boolean(data.aiConfigured));
    } catch (err: any) {
      setListError(err?.message || 'Não foi possível carregar os registros do SmartDocs.');
    } finally {
      setLoadingList(false);
    }
  };

  const loadValidityRules = async () => {
    try {
      const resp = await authorizedFetch('/api/smartdocs/validity-rules');
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        setValidityRules(Array.isArray(data.rules) ? data.rules : []);
      }
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    loadSmartDocs();
    loadValidityRules();
  }, []);

  const populateReviewForm = (record: SmartDocRecord) => {
    setActiveDoc(record);
    setEditCategoria(record.categoriaGrupo);
    const knownOptions = TAXONOMY_OPTIONS[record.categoriaGrupo] || [];
    if (knownOptions.includes(record.tipoDocumento)) {
      setEditTipo(record.tipoDocumento);
      setEditCustomTipo('');
    } else {
      setEditTipo('Classificação manual');
      setEditCustomTipo(record.tipoDocumento);
    }
    setEditEmpresaId(record.empresaId || '');
    setEditColaboradorId(record.colaboradorId || '');
    setEditDados({ ...(record.dadosExtraidos || {}) });
    setActionBanner(null);
  };

  const handleOpenDetail = async (id: string) => {
    setLoadingDetail(true);
    setActionBanner(null);
    try {
      const resp = await authorizedFetch(`/api/smartdocs/${encodeURIComponent(id)}`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success || !data?.item) {
        throw new Error(data?.message || 'Erro ao abrir documento.');
      }
      populateReviewForm(data.item as SmartDocRecord);
    } catch (err: any) {
      setListError(err?.message || 'Falha ao carregar detalhes do documento.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadFeedback(null);
    setUploadStep('IDLE');
    if (!file) {
      setSelectedFile(null);
      setPreviewLocalUrl('');
      return;
    }

    const lower = file.name.toLowerCase();
    if (
      !lower.endsWith('.pdf') &&
      !lower.endsWith('.jpg') &&
      !lower.endsWith('.jpeg') &&
      !lower.endsWith('.png')
    ) {
      setUploadFeedback({
        type: 'error',
        msg: 'Formato inválido. Permitidos exclusivamente: PDF, JPG, JPEG e PNG.',
      });
      setSelectedFile(null);
      setPreviewLocalUrl('');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadFeedback({
        type: 'error',
        msg: 'O arquivo excede o limite de 5 MB. Reduza o tamanho e tente novamente.',
      });
      setSelectedFile(null);
      setPreviewLocalUrl('');
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewLocalUrl(objectUrl);
  };

  const handleProcessUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadFeedback({ type: 'error', msg: 'Selecione 1 arquivo (PDF, JPG, JPEG ou PNG) para processar.' });
      return;
    }

    setUploadFeedback(null);
    setUploadStep('AGUARDANDO_PROCESSAMENTO');

    try {
      const prepared = await readAndOptimizeFileForUpload(selectedFile);
      setUploadStep('PROCESSANDO');

      const resp = await authorizedFetch('/api/smartdocs/process', {
        method: 'POST',
        body: JSON.stringify({
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
          ...(useManualClass
            ? {
                manualCategoriaGrupo: manualCategoria,
                manualTipoDocumento: manualTipo.trim() || 'Classificação manual',
              }
            : {}),
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data?.success) {
        setUploadStep('ERRO_LEITURA');
        setUploadFeedback({
          type: 'error',
          msg: data?.message || 'Não foi possível concluir a leitura inteligente do documento.',
        });
        await loadSmartDocs();
        if (data?.item) {
          populateReviewForm(data.item as SmartDocRecord);
        }
        return;
      }

      setUploadStep('PROCESSADO');
      await loadSmartDocs();
      if (data?.item) {
        setIsUploadOpen(false);
        setSelectedFile(null);
        setPreviewLocalUrl('');
        setUploadStep('IDLE');
        populateReviewForm(data.item as SmartDocRecord);
      }
    } catch (err: any) {
      setUploadStep('ERRO_LEITURA');
      setUploadFeedback({
        type: 'error',
        msg: err?.message || 'Erro ao preparar ou enviar o documento.',
      });
    }
  };

  const resolvedTipoDocumento =
    editTipo === 'Classificação manual'
      ? editCustomTipo.trim() || 'Classificação manual'
      : editTipo;

  const handleSaveEdits = async () => {
    if (!activeDoc || !canEdit) return;
    setActionBusy(true);
    setActionBanner(null);
    try {
      const resp = await authorizedFetch(`/api/smartdocs/${encodeURIComponent(activeDoc.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          categoriaGrupo: editCategoria,
          tipoDocumento: resolvedTipoDocumento,
          classificacaoManual: editTipo === 'Classificação manual' || resolvedTipoDocumento !== activeDoc.tipoDocumento,
          empresaId: editEmpresaId,
          colaboradorId: editColaboradorId,
          dadosExtraidos: editDados,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Erro ao salvar conferência.');
      }
      populateReviewForm(data.item as SmartDocRecord);
      setActionBanner({ type: 'success', text: 'Dados revisados salvos no SmartDocs (permanece pendente até aprovação).' });
      await loadSmartDocs();
    } catch (err: any) {
      setActionBanner({ type: 'error', text: err?.message || 'Falha ao salvar alterações.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReprocess = async (docId: string, replacementFile?: File) => {
    setActionBusy(true);
    setActionBanner(null);
    try {
      let bodyPayload: Record<string, any> = {};
      if (replacementFile) {
        const prepared = await readAndOptimizeFileForUpload(replacementFile);
        bodyPayload = {
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
        };
      }

      const resp = await authorizedFetch(`/api/smartdocs/${encodeURIComponent(docId)}/reprocess`, {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Falha no reprocessamento pela IA.');
      }
      if (activeDoc && activeDoc.id === docId && data.item) {
        populateReviewForm(data.item as SmartDocRecord);
        setActionBanner({ type: 'success', text: 'Reprocessamento concluído com sucesso.' });
      }
      await loadSmartDocs();
    } catch (err: any) {
      if (activeDoc && activeDoc.id === docId) {
        setActionBanner({ type: 'error', text: err?.message || 'Erro ao reprocessar documento.' });
      } else {
        setListError(err?.message || 'Erro ao reprocessar documento.');
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!activeDoc || !isAdmin) return;
    setActionBusy(true);
    setActionBanner(null);
    try {
      const resp = await authorizedFetch(`/api/smartdocs/${encodeURIComponent(activeDoc.id)}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          categoriaGrupo: editCategoria,
          tipoDocumento: resolvedTipoDocumento,
          empresaId: editEmpresaId,
          colaboradorId: editColaboradorId,
          dadosExtraidos: editDados,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Não foi possível aprovar e integrar o documento.');
      }
      populateReviewForm(data.item as SmartDocRecord);
      setActionBanner({
        type: 'success',
        text: `Aprovado definitivamente e integrado em ${data.integratedCollection}/${data.integratedDocId}!`,
      });
      await loadSmartDocs();
    } catch (err: any) {
      setActionBanner({ type: 'error', text: err?.message || 'Erro ao aprovar documento.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleDecisionConfirm = async () => {
    if (!activeDoc || !isAdmin || !decisionModal) return;
    if (!decisionReason.trim()) return;

    setActionBusy(true);
    setActionBanner(null);
    const endpoint =
      decisionModal === 'correction'
        ? `/api/smartdocs/${encodeURIComponent(activeDoc.id)}/request-correction`
        : `/api/smartdocs/${encodeURIComponent(activeDoc.id)}/reject`;

    try {
      const resp = await authorizedFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ motivo: decisionReason.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Erro ao registrar decisão.');
      }
      setDecisionModal(null);
      setDecisionReason('');
      populateReviewForm(data.item as SmartDocRecord);
      setActionBanner({ type: 'success', text: data.message });
      await loadSmartDocs();
    } catch (err: any) {
      setActionBanner({ type: 'error', text: err?.message || 'Falha ao processar decisão.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddValidityRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newRuleType.trim()) return;
    try {
      const resp = await authorizedFetch('/api/smartdocs/validity-rules', {
        method: 'POST',
        body: JSON.stringify({
          tipoDocumento: newRuleType.trim(),
          mesesValidade: Number(newRuleMonths),
          ativo: true,
          observacao: newRuleObs.trim(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        throw new Error(data?.message || 'Erro ao criar regra.');
      }
      setNewRuleObs('');
      await loadValidityRules();
    } catch (err: any) {
      setListError(err?.message || 'Erro ao salvar regra.');
    }
  };

  const handleDeleteValidityRule = async (id: string) => {
    if (!isAdmin) return;
    await authorizedFetch(`/api/smartdocs/validity-rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await loadValidityRules();
  };

  const kpis = useMemo(() => {
    return {
      total: items.length,
      pendentes: items.filter((d) => d.status === 'PENDENTE_APROVACAO').length,
      aprovados: items.filter((d) => d.status === 'APROVADO').length,
      rejeitados: items.filter((d) => d.status === 'REJEITADO').length,
      inconsistencias: items.filter((d) => (d.inconsistencias || []).length > 0).length,
      semValidade: items.filter((d) => !d.dadosExtraidos?.semValidade && !d.dadosExtraidos?.dataValidade).length,
    };
  }, [items]);

  const availableFilterEmployees = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return employees.filter((e) => e.empresaId === activeEmpresaId);
    }
    if (empresaFilter !== 'todas') {
      return employees.filter((e) => e.empresaId === empresaFilter);
    }
    return employees;
  }, [employees, empresaFilter, isSolicitante, activeEmpresaId]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (empresaFilter !== 'todas' && item.empresaId !== empresaFilter) return false;
      if (colaboradorFilter !== 'todos' && item.colaboradorId !== colaboradorFilter) return false;
      if (categoriaFilter !== 'todas' && item.categoriaGrupo !== categoriaFilter) return false;
      if (statusFilter !== 'todos' && item.status !== statusFilter) return false;

      const sendDay = (item.dataEnvio || '').slice(0, 10);
      if (dateFrom && sendDay < dateFrom) return false;
      if (dateTo && sendDay > dateTo) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const hit =
          item.arquivoNome.toLowerCase().includes(q) ||
          item.tipoDocumento.toLowerCase().includes(q) ||
          (item.empresaNome || '').toLowerCase().includes(q) ||
          (item.colaboradorNome || '').toLowerCase().includes(q) ||
          (item.dadosExtraidos?.cpf || '').toLowerCase().includes(q) ||
          (item.dadosExtraidos?.cnpj || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [items, empresaFilter, colaboradorFilter, categoriaFilter, statusFilter, dateFrom, dateTo, searchTerm]);

  const activeDocEmployees = useMemo(() => {
    if (!editEmpresaId) return employees;
    return employees.filter((e) => e.empresaId === editEmpresaId);
  }, [employees, editEmpresaId]);

  const isLocked = activeDoc?.status === 'APROVADO' || activeDoc?.status === 'REJEITADO';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <FileSearch className="text-blue-500" />
            EHS SmartDocs — Leitura Inteligente de Documentos
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            OCR + IA para interpretação de ASO, Certificados NR e Documentação Empresarial com aprovação técnica e sigilo LGPD
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsRulesOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors whitespace-nowrap"
            >
              <Settings size={15} className="text-slate-400" />
              Regras de Validade
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setPreviewLocalUrl('');
                setUploadFeedback(null);
                setUploadStep('IDLE');
                setUseManualClass(false);
                setIsUploadOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all whitespace-nowrap"
            >
              <Plus size={16} />
              Novo documento
            </button>
          )}
        </div>
      </div>

      {/* Diagnostic banner if GEMINI_API_KEY is not configured */}
      {!aiConfigured && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-3 text-xs">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-300">
              Motor de Leitura Inteligente (GEMINI_API_KEY) pendente de configuração no servidor
            </p>
            <p className="text-amber-200/80 mt-0.5">
              Nenhum dado é simulado ou fabricado sem IA real. Configure a variável protegida <code className="font-mono bg-slate-950 px-1.5 py-0.5 rounded">GEMINI_API_KEY</code> no ambiente do servidor / Netlify para habilitar o processamento automático.
            </p>
          </div>
        </div>
      )}

      {listError && (
        <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 flex items-center justify-between gap-3 text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{listError}</span>
          </div>
          <button onClick={() => setListError('')} className="text-red-400 hover:text-white">
            <X size={15} />
          </button>
        </div>
      )}

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
          <p className="text-[11px] font-medium text-slate-400">Total Processados</p>
          <p className="text-2xl font-bold text-white mt-1 tabular-nums">{kpis.total}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 border border-amber-500/30">
          <p className="text-[11px] font-medium text-amber-300">Pendentes Aprovação</p>
          <p className="text-2xl font-bold text-amber-400 mt-1 tabular-nums">{kpis.pendentes}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-500/30">
          <p className="text-[11px] font-medium text-emerald-300">Aprovados</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1 tabular-nums">{kpis.aprovados}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 border border-red-500/30">
          <p className="text-[11px] font-medium text-red-300">Rejeitados</p>
          <p className="text-2xl font-bold text-red-400 mt-1 tabular-nums">{kpis.rejeitados}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 border border-orange-500/30">
          <p className="text-[11px] font-medium text-orange-300">Com Inconsistências</p>
          <p className="text-2xl font-bold text-orange-400 mt-1 tabular-nums">{kpis.inconsistencias}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-700">
          <p className="text-[11px] font-medium text-slate-400">Sem Data de Validade</p>
          <p className="text-2xl font-bold text-slate-200 mt-1 tabular-nums">{kpis.semValidade}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar arquivo, tipo, empresa, colaborador, CPF/CNPJ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          {!isSolicitante && (
            <select
              value={empresaFilter}
              onChange={(e) => {
                setEmpresaFilter(e.target.value);
                setColaboradorFilter('todos');
              }}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="todas">Todas as Empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia || c.razaoSocial}
                </option>
              ))}
            </select>
          )}

          <select
            value={colaboradorFilter}
            onChange={(e) => setColaboradorFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Colaboradores</option>
            {availableFilterEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.nomeCompleto}
              </option>
            ))}
          </select>

          <select
            value={categoriaFilter}
            onChange={(e) => setCategoriaFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todas">Todas as Categorias</option>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Status</option>
            <option value="PENDENTE_APROVACAO">Pendente de Aprovação</option>
            <option value="APROVADO">Aprovado</option>
            <option value="REJEITADO">Rejeitado</option>
            <option value="ERRO_LEITURA">Erro na Leitura</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Calendar size={14} />
            <span>Período de envio:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
            />
            <span>até</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
            />
          </div>

          {(searchTerm ||
            empresaFilter !== 'todas' ||
            colaboradorFilter !== 'todos' ||
            categoriaFilter !== 'todas' ||
            statusFilter !== 'todos' ||
            dateFrom ||
            dateTo) && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setEmpresaFilter('todas');
                setColaboradorFilter('todos');
                setCategoriaFilter('todas');
                setStatusFilter('todos');
                setDateFrom('');
                setDateTo('');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1"
            >
              <X size={13} />
              Limpar filtros
            </button>
          )}

          <button
            type="button"
            onClick={loadSmartDocs}
            className="ml-auto px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} />
            Atualizar fila
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Colaborador</th>
                <th className="px-4 py-3">Tipo Documental</th>
                <th className="px-4 py-3">Data de Envio</th>
                <th className="px-4 py-3">Data de Vencimento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Responsável Análise</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loadingList ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 text-blue-400" />
                    Carregando fila de leitura inteligente...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileSearch size={36} className="mx-auto text-slate-500 mb-2" />
                    <p className="text-sm font-semibold text-slate-300">
                      Nenhum documento encontrado no EHS SmartDocs
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Envie um documento em PDF, JPG, JPEG ou PNG para leitura automática por OCR + IA.
                    </p>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setIsUploadOpen(true)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                      >
                        <Plus size={15} />
                        Novo documento
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredItems.map((docItem) => {
                  const procBadge = PROCESSING_BADGE[docItem.status] || PROCESSING_BADGE.PENDENTE_APROVACAO;
                  const valBadge = VALIDITY_BADGE[docItem.statusValidade] || VALIDITY_BADGE.SEM_VALIDADE_DEFINIDA;
                  const incCount = (docItem.inconsistencias || []).length;

                  return (
                    <tr key={docItem.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-200 max-w-[180px] truncate">
                          {docItem.empresaNome || (
                            <span className="text-amber-400 font-normal">Não vinculada</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                          {docItem.arquivoNome}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-200 font-medium max-w-[170px] truncate">
                          {docItem.colaboradorNome ||
                            docItem.dadosExtraidos?.nomeColaborador || (
                              <span className="text-slate-500">—</span>
                            )}
                        </div>
                        {docItem.isSensitiveMedical && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-rose-300 mt-0.5">
                            <Lock size={10} /> Sigilo Médico LGPD
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold text-[11px]">
                            {docItem.tipoDocumento}
                          </span>
                          {incCount > 0 && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 text-[10px] font-bold tabular-nums"
                              title={`${incCount} inconsistência(s) detectada(s)`}
                            >
                              {incCount} alerta{incCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {CATEGORY_LABELS[docItem.categoriaGrupo]}
                          {docItem.classificacaoConfianca > 0 && (
                            <span className="ml-1.5 font-mono tabular-nums text-slate-500">
                              ({docItem.classificacaoConfianca}% IA)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">
                        <div>{new Date(docItem.dataEnvio).toLocaleDateString('pt-BR')}</div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(docItem.dataEnvio).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {docItem.dadosExtraidos?.semValidade ? (
                          <span className="text-slate-400">Sem vencimento</span>
                        ) : docItem.dadosExtraidos?.dataValidade ? (
                          <div>
                            <span className="text-slate-200 font-medium">
                              {formatDateBR(docItem.dadosExtraidos.dataValidade)}
                            </span>
                            <div className="mt-0.5">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${valBadge.cls}`}>
                                {valBadge.label}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Sem validade definida</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${procBadge.cls}`}>
                          {procBadge.label}
                        </span>
                        {docItem.correcaoSolicitada && docItem.status === 'PENDENTE_APROVACAO' && (
                          <div className="text-[10px] text-amber-300 mt-0.5 font-medium">
                            Correção solicitada
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {docItem.analisadoPorNome || (
                          <span className="text-slate-500 italic">Aguardando EHS</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenDetail(docItem.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-xs font-medium transition-colors"
                          >
                            Conferir
                          </button>
                          {canEdit && docItem.status === 'ERRO_LEITURA' && (
                            <button
                              type="button"
                              onClick={() => handleReprocess(docItem.id)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-600/20 text-amber-400"
                              title="Reprocessar leitura inteligente"
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW DOCUMENT UPLOAD MODAL (SINGLE FILE) */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Upload size={18} className="text-blue-400" />
                  Novo Documento — Leitura Inteligente (EHS SmartDocs)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Envie 1 arquivo individual (PDF, JPG, JPEG ou PNG) para interpretação por OCR + IA
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleProcessUpload} className="mt-4 space-y-4">
              {/* Single File Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-blue-500/70 rounded-xl p-6 text-center cursor-pointer bg-slate-950/60 transition-colors"
              >
                <Upload size={28} className="mx-auto text-blue-400 mb-2" />
                <p className="text-sm font-semibold text-white">
                  {selectedFile ? selectedFile.name : 'Clique para selecionar 1 documento'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Formatos aceitos: PDF, JPG, JPEG, PNG • Máximo 5 MB • Apenas 1 arquivo por operação
                </p>
                {selectedFile && (
                  <p className="text-[11px] font-mono text-blue-300 mt-2">
                    Tamanho: {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  multiple={false}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {/* Local Preview before send */}
              {selectedFile && previewLocalUrl && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                  <p className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                    {selectedFile.type === 'application/pdf' ? <FileText size={13} /> : <ImageIcon size={13} />}
                    Pré-visualização do arquivo selecionado
                  </p>
                  {selectedFile.type === 'application/pdf' ? (
                    <iframe
                      src={previewLocalUrl}
                      title="Preview PDF"
                      className="w-full h-56 rounded-lg border border-slate-800 bg-white"
                    />
                  ) : (
                    <img
                      src={previewLocalUrl}
                      alt="Preview documento"
                      className="max-h-56 mx-auto rounded-lg object-contain border border-slate-800"
                    />
                  )}
                </div>
              )}

              {/* Optional manual classification */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useManualClass}
                    onChange={(e) => setUseManualClass(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-blue-600"
                  />
                  <span>Definir classificação manual (útil para documentos não listados)</span>
                </label>

                {useManualClass && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Grupo Documental</label>
                      <select
                        value={manualCategoria}
                        onChange={(e) => setManualCategoria(e.target.value as SmartDocCategoryGroup)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                      >
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Nome / Tipo do Documento</label>
                      <input
                        type="text"
                        value={manualTipo}
                        onChange={(e) => setManualTipo(e.target.value)}
                        placeholder="Ex: Ordem de Serviço NR-01, Ficha de EPI..."
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Processing Progress Indicator */}
              {uploadStep !== 'IDLE' && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-2">
                      {uploadStep === 'PROCESSANDO' || uploadStep === 'AGUARDANDO_PROCESSAMENTO' ? (
                        <Loader2 size={14} className="animate-spin text-blue-400" />
                      ) : uploadStep === 'ERRO_LEITURA' ? (
                        <XCircle size={14} className="text-red-400" />
                      ) : (
                        <CheckCircle size={14} className="text-emerald-400" />
                      )}
                      {uploadStep === 'AGUARDANDO_PROCESSAMENTO' && 'Validando arquivo e integridade...'}
                      {uploadStep === 'PROCESSANDO' && 'Executando leitura OCR + interpretação Gemini AI...'}
                      {uploadStep === 'PROCESSADO' && 'Leitura concluída! Registrado como PENDENTE DE APROVAÇÃO.'}
                      {uploadStep === 'ERRO_LEITURA' && 'Falha na leitura automática do documento.'}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">{uploadStep}</span>
                  </div>
                  <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        uploadStep === 'ERRO_LEITURA'
                          ? 'w-full bg-red-500'
                          : uploadStep === 'PROCESSADO'
                          ? 'w-full bg-emerald-500'
                          : uploadStep === 'PROCESSANDO'
                          ? 'w-2/3 bg-blue-500 animate-pulse'
                          : 'w-1/3 bg-blue-400'
                      }`}
                    />
                  </div>
                </div>
              )}

              {uploadFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                    uploadFeedback.type === 'error'
                      ? 'bg-red-950/50 border border-red-500/40 text-red-300'
                      : 'bg-emerald-950/50 border border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{uploadFeedback.msg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!selectedFile || uploadStep === 'PROCESSANDO' || uploadStep === 'AGUARDANDO_PROCESSAMENTO'}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-2"
                >
                  {uploadStep === 'PROCESSANDO' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <FileSearch size={14} />
                      Enviar e Ler Documento
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SIDE-BY-SIDE DOCUMENT CONFERENCE & APPROVAL MODAL */}
      {(activeDoc || loadingDetail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/90 backdrop-blur-sm">
          <div className="w-full max-w-7xl h-[92vh] rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-white truncate">
                    {activeDoc ? activeDoc.arquivoNome : 'Carregando documento...'}
                  </h3>
                  {activeDoc && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PROCESSING_BADGE[activeDoc.status].cls}`}>
                      {PROCESSING_BADGE[activeDoc.status].label}
                    </span>
                  )}
                  {activeDoc?.isSensitiveMedical && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-semibold flex items-center gap-1">
                      <Lock size={11} /> Sigilo Médico LGPD
                    </span>
                  )}
                </div>
                {activeDoc && (
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    Enviado por {activeDoc.enviadoPorNome} em {new Date(activeDoc.dataEnvio).toLocaleString('pt-BR')} • SHA-256: <span className="font-mono">{activeDoc.arquivoHashSha256.slice(0, 12)}</span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveDoc(null);
                  setActionBanner(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {loadingDetail && !activeDoc ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                <Loader2 size={24} className="animate-spin mr-2 text-blue-400" />
                Carregando documento e trilha LGPD...
              </div>
            ) : activeDoc ? (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
                {/* LEFT PANE: DOCUMENT PREVIEW */}
                <div className="lg:col-span-5 bg-slate-950 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col min-h-[260px] lg:min-h-0">
                  <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
                    <span className="font-semibold flex items-center gap-1.5">
                      {activeDoc.arquivoMimeType === 'application/pdf' ? (
                        <FileText size={14} className="text-blue-400" />
                      ) : (
                        <ImageIcon size={14} className="text-blue-400" />
                      )}
                      Visualização do Documento Original
                    </span>
                    {activeDoc.arquivoUrl && !activeDoc.lgpdRedacted && (
                      <a
                        href={activeDoc.arquivoUrl}
                        download={activeDoc.arquivoNome}
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <ExternalLink size={12} /> Baixar cópia
                      </a>
                    )}
                  </div>

                  <div className="flex-1 p-3 overflow-auto flex items-center justify-center">
                    {activeDoc.lgpdRedacted ? (
                      <div className="max-w-sm text-center p-6 rounded-xl bg-slate-900 border border-rose-500/30">
                        <Lock size={32} className="mx-auto text-rose-400 mb-3" />
                        <p className="text-sm font-bold text-white">Documento Protegido por Sigilo Médico (LGPD)</p>
                        <p className="text-xs text-slate-400 mt-2">
                          {activeDoc.previewIndisponivelMotivo ||
                            'A visualização integral deste documento clínico é restrita ao Administrador EHS / SESMT.'}
                        </p>
                      </div>
                    ) : activeDoc.arquivoUrl ? (
                      activeDoc.arquivoMimeType === 'application/pdf' ? (
                        <object
                          data={activeDoc.arquivoUrl}
                          type="application/pdf"
                          className="w-full h-full min-h-[340px] rounded-lg bg-white"
                        >
                          <iframe
                            src={activeDoc.arquivoUrl}
                            title={activeDoc.arquivoNome}
                            className="w-full h-full min-h-[340px] rounded-lg bg-white"
                          />
                        </object>
                      ) : (
                        <img
                          src={activeDoc.arquivoUrl}
                          alt={activeDoc.arquivoNome}
                          className="max-w-full max-h-full object-contain rounded-lg border border-slate-800"
                        />
                      )
                    ) : (
                      <div className="max-w-sm text-center p-6 rounded-xl bg-slate-900 border border-slate-800">
                        <Info size={28} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-xs font-semibold text-slate-200">
                          Preview inline não armazenado
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {activeDoc.previewIndisponivelMotivo ||
                            'Arquivo excedeu 500 KB para armazenamento inline; a leitura completa pela IA foi realizada sobre o binário enviado.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT PANE: EXTRACTED DATA & REVIEW FORM */}
                <div className="lg:col-span-7 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                    {actionBanner && (
                      <div
                        className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                          actionBanner.type === 'success'
                            ? 'bg-emerald-950/50 border border-emerald-500/40 text-emerald-300'
                            : 'bg-red-950/50 border border-red-500/40 text-red-300'
                        }`}
                      >
                        {actionBanner.type === 'success' ? (
                          <CheckCircle size={16} className="shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        )}
                        <span>{actionBanner.text}</span>
                      </div>
                    )}

                    {/* Status / Correction / Error alerts */}
                    {activeDoc.status === 'ERRO_LEITURA' && (
                      <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs space-y-2">
                        <p className="font-bold text-red-300 flex items-center gap-1.5">
                          <XCircle size={15} /> Erro no processamento automático
                        </p>
                        <p className="text-red-200/90">{activeDoc.erroLeitura}</p>
                        {canEdit && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {activeDoc.arquivoUrl && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleReprocess(activeDoc.id)}
                                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center gap-1.5"
                              >
                                <RefreshCw size={13} /> Reprocessar Agora
                              </button>
                            )}
                            <label className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
                              Enviar arquivo corrigido e reprocessar
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                className="hidden"
                                onChange={(ev) => {
                                  const f = ev.target.files?.[0];
                                  if (f) handleReprocess(activeDoc.id, f);
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    )}

                    {activeDoc.correcaoSolicitada && activeDoc.motivoCorrecao && activeDoc.status === 'PENDENTE_APROVACAO' && (
                      <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs space-y-2">
                        <p className="font-bold text-amber-300 flex items-center gap-1.5">
                          <MessageSquareWarning size={15} /> Correção Solicitada por {activeDoc.analisadoPorNome}
                        </p>
                        <p className="text-amber-100">{activeDoc.motivoCorrecao}</p>
                        {canEdit && (
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer">
                            <Upload size={13} /> Enviar arquivo corrigido
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              onChange={(ev) => {
                                const f = ev.target.files?.[0];
                                if (f) handleReprocess(activeDoc.id, f);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    )}

                    {activeDoc.status === 'REJEITADO' && (
                      <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs">
                        <p className="font-bold text-red-300">
                          Documento Rejeitado por {activeDoc.analisadoPorNome}
                        </p>
                        <p className="text-red-200 mt-1">Justificativa: {activeDoc.motivoRejeicao}</p>
                      </div>
                    )}

                    {activeDoc.status === 'APROVADO' && (
                      <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-emerald-300">
                            Aprovado por {activeDoc.analisadoPorNome}
                          </p>
                          <p className="text-emerald-200/80 mt-0.5">
                            Integrado oficialmente em <code className="font-mono">{activeDoc.integratedCollection}/{activeDoc.integratedDocId}</code> • Monitoramento de validade ativo
                          </p>
                        </div>
                        <CheckCircle size={20} className="text-emerald-400 shrink-0" />
                      </div>
                    )}

                    {/* Automatic Inconsistencies */}
                    {(activeDoc.inconsistencias || []).length > 0 && (
                      <div className="p-3.5 rounded-xl bg-orange-950/30 border border-orange-500/40 space-y-2">
                        <p className="text-xs font-bold text-orange-300 flex items-center gap-1.5">
                          <AlertTriangle size={15} />
                          Inconsistências e Alertas Detectados ({activeDoc.inconsistencias.length})
                        </p>
                        <ul className="space-y-1 text-xs">
                          {activeDoc.inconsistencias.map((inc, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-orange-100/90">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 mt-0.5 ${
                                  inc.severidade === 'alta'
                                    ? 'bg-red-500/20 text-red-300'
                                    : 'bg-amber-500/20 text-amber-300'
                                }`}
                              >
                                {inc.severidade}
                              </span>
                              <span>{inc.mensagem}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Classification Block */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                          1. Classificação Documental
                        </h4>
                        <span className="text-[11px] font-mono text-blue-300 tabular-nums">
                          Confiança IA: {activeDoc.classificacaoConfianca}%
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Categoria Principal
                          </label>
                          <select
                            disabled={isLocked || !canEdit}
                            value={editCategoria}
                            onChange={(e) => {
                              const nextCat = e.target.value as SmartDocCategoryGroup;
                              setEditCategoria(nextCat);
                              const firstOpt = TAXONOMY_OPTIONS[nextCat]?.[0] || 'Classificação manual';
                              setEditTipo(firstOpt);
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                          >
                            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Tipo de Documento
                          </label>
                          <select
                            disabled={isLocked || !canEdit}
                            value={editTipo}
                            onChange={(e) => setEditTipo(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                          >
                            {(TAXONOMY_OPTIONS[editCategoria] || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                            <option value="Classificação manual">Classificação manual (outro tipo)</option>
                          </select>
                        </div>

                        {editTipo === 'Classificação manual' && (
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-300 mb-1">
                              Especificação do Documento Não Listado
                            </label>
                            <input
                              type="text"
                              disabled={isLocked || !canEdit}
                              value={editCustomTipo}
                              onChange={(e) => setEditCustomTipo(e.target.value)}
                              placeholder="Informe o nome exato do documento..."
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Contractor Registry Linking */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                        2. Vínculo com Gestão de Contratadas
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                              <Building2 size={13} className="text-blue-400" /> Empresa Contratada
                            </label>
                            <span className="text-[10px] font-mono text-slate-400">
                              [{activeDoc.empresaMatchMetodo || 'nao_vinculada'}]
                            </span>
                          </div>
                          <select
                            disabled={isLocked || !canEdit || isSolicitante}
                            value={editEmpresaId}
                            onChange={(e) => {
                              setEditEmpresaId(e.target.value);
                              setEditColaboradorId('');
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                          >
                            <option value="">Selecione a empresa vinculada...</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.razaoSocial} ({c.cnpj})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                              <User size={13} className="text-cyan-400" /> Colaborador
                            </label>
                            <span className="text-[10px] font-mono text-slate-400">
                              [{activeDoc.colaboradorMatchMetodo || 'nao_vinculado'}]
                            </span>
                          </div>
                          <select
                            disabled={isLocked || !canEdit}
                            value={editColaboradorId}
                            onChange={(e) => setEditColaboradorId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                          >
                            <option value="">Nenhum / Selecionar colaborador...</option>
                            {activeDocEmployees.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.nomeCompleto} (CPF: {emp.cpf})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Extracted Data Form (Strictly No Fabricated Values) */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                          3. Dados Extraídos pela IA (Conferência Obrigatória)
                        </h4>
                        <span className="text-[11px] text-slate-400">
                          Campos vazios não foram localizados no documento
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Shared Identity Fields */}
                        <div>
                          <FieldLabel label="Empresa identificada no doc" value={editDados.empresa || editDados.razaoSocial} />
                          <input
                            type="text"
                            disabled={isLocked || !canEdit}
                            value={editDados.empresa || ''}
                            onChange={(e) => setEditDados({ ...editDados, empresa: e.target.value, razaoSocial: e.target.value })}
                            placeholder="Vazio (não identificado)"
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                          />
                        </div>

                        <div>
                          <FieldLabel label="CNPJ identificado no doc" value={editDados.cnpj} />
                          <input
                            type="text"
                            disabled={isLocked || !canEdit}
                            value={editDados.cnpj || ''}
                            onChange={(e) => setEditDados({ ...editDados, cnpj: e.target.value })}
                            placeholder="Vazio (não identificado)"
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono placeholder-slate-600 disabled:opacity-60"
                          />
                        </div>

                        {(editCategoria === 'saude_ocupacional' || editCategoria === 'treinamentos') && (
                          <>
                            <div>
                              <FieldLabel label="Nome do Colaborador (no doc)" value={editDados.nomeColaborador} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.nomeColaborador || ''}
                                onChange={(e) => setEditDados({ ...editDados, nomeColaborador: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="CPF (no doc)" value={editDados.cpf} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.cpf || ''}
                                onChange={(e) => setEditDados({ ...editDados, cpf: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                          </>
                        )}

                        {/* Category Specific Fields */}
                        {editCategoria === 'saude_ocupacional' && (
                          <>
                            <div>
                              <FieldLabel label="Função / Cargo" value={editDados.funcao} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.funcao || ''}
                                onChange={(e) => setEditDados({ ...editDados, funcao: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Tipo de Exame" value={editDados.tipoExame} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.tipoExame || ''}
                                onChange={(e) => setEditDados({ ...editDados, tipoExame: e.target.value })}
                                placeholder="Ex: ASO Periódico, Admissional..."
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Data de Realização" value={editDados.dataRealizacao} required />
                              <input
                                type="date"
                                disabled={isLocked || !canEdit}
                                value={editDados.dataRealizacao || ''}
                                onChange={(e) => setEditDados({ ...editDados, dataRealizacao: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel
                                label="Resultado de Aptidão"
                                value={activeDoc.lgpdRedacted ? 'PROTEGIDO' : editDados.resultadoAptidao}
                              />
                              {activeDoc.lgpdRedacted ? (
                                <div className="px-3 py-2 rounded-lg bg-slate-900 border border-rose-500/30 text-xs text-rose-300">
                                  Protegido por Sigilo Médico (LGPD)
                                </div>
                              ) : (
                                <select
                                  disabled={isLocked || !canEdit}
                                  value={editDados.resultadoAptidao || ''}
                                  onChange={(e) =>
                                    setEditDados({
                                      ...editDados,
                                      resultadoAptidao: e.target.value as SmartDocExtractedData['resultadoAptidao'],
                                    })
                                  }
                                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                                >
                                  <option value="">Não identificado</option>
                                  <option value="apto">Apto</option>
                                  <option value="apto_com_restricoes">Apto com restrições</option>
                                  <option value="inapto">Inapto</option>
                                </select>
                              )}
                            </div>
                            <div>
                              <FieldLabel label="Médico Responsável" value={editDados.medicoResponsavel} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit || Boolean(activeDoc.lgpdRedacted)}
                                value={editDados.medicoResponsavel || ''}
                                onChange={(e) => setEditDados({ ...editDados, medicoResponsavel: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="CRM" value={editDados.crm} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit || Boolean(activeDoc.lgpdRedacted)}
                                value={editDados.crm || ''}
                                onChange={(e) => setEditDados({ ...editDados, crm: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                          </>
                        )}

                        {editCategoria === 'treinamentos' && (
                          <>
                            <div className="sm:col-span-2">
                              <FieldLabel label="Nome do Treinamento" value={editDados.nomeTreinamento} required />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.nomeTreinamento || ''}
                                onChange={(e) => setEditDados({ ...editDados, nomeTreinamento: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="NR Correspondente" value={editDados.nrCorrespondente} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.nrCorrespondente || ''}
                                onChange={(e) => setEditDados({ ...editDados, nrCorrespondente: e.target.value })}
                                placeholder="Ex: NR-35, NR-10..."
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Carga Horária" value={editDados.cargaHoraria} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.cargaHoraria || ''}
                                onChange={(e) => setEditDados({ ...editDados, cargaHoraria: e.target.value })}
                                placeholder="Ex: 8h, 40h"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Data de Realização" value={editDados.dataRealizacao} required />
                              <input
                                type="date"
                                disabled={isLocked || !canEdit}
                                value={editDados.dataRealizacao || ''}
                                onChange={(e) => setEditDados({ ...editDados, dataRealizacao: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Instituição Emissora" value={editDados.instituicaoEmissora} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.instituicaoEmissora || ''}
                                onChange={(e) => setEditDados({ ...editDados, instituicaoEmissora: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Nome do Instrutor" value={editDados.nomeInstrutor} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.nomeInstrutor || ''}
                                onChange={(e) => setEditDados({ ...editDados, nomeInstrutor: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Registro Profissional do RT/Instrutor" value={editDados.registroProfissionalInstrutor} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.registroProfissionalInstrutor || ''}
                                onChange={(e) =>
                                  setEditDados({ ...editDados, registroProfissionalInstrutor: e.target.value })
                                }
                                placeholder="Ex: CREA, MTE, COREN..."
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                          </>
                        )}

                        {(editCategoria === 'documentos_empresariais' || editCategoria === 'outros') && (
                          <>
                            <div className="sm:col-span-2">
                              <FieldLabel label="Título / Denominação do Documento" value={editDados.nomeDocumento} required />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.nomeDocumento || ''}
                                onChange={(e) => setEditDados({ ...editDados, nomeDocumento: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Unidade / Obra" value={editDados.unidade} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.unidade || ''}
                                onChange={(e) => setEditDados({ ...editDados, unidade: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Número / Código do Documento" value={editDados.numeroDocumento} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.numeroDocumento || ''}
                                onChange={(e) => setEditDados({ ...editDados, numeroDocumento: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Data de Emissão" value={editDados.dataEmissao} />
                              <input
                                type="date"
                                disabled={isLocked || !canEdit}
                                value={editDados.dataEmissao || ''}
                                onChange={(e) => setEditDados({ ...editDados, dataEmissao: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Data de Revisão" value={editDados.dataRevisao} />
                              <input
                                type="date"
                                disabled={isLocked || !canEdit}
                                value={editDados.dataRevisao || ''}
                                onChange={(e) => setEditDados({ ...editDados, dataRevisao: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Responsável Técnico" value={editDados.responsavelTecnico} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.responsavelTecnico || ''}
                                onChange={(e) => setEditDados({ ...editDados, responsavelTecnico: e.target.value })}
                                placeholder="Vazio (não identificado)"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <FieldLabel label="Registro Profissional" value={editDados.registroProfissionalRT} />
                              <input
                                type="text"
                                disabled={isLocked || !canEdit}
                                value={editDados.registroProfissionalRT || ''}
                                onChange={(e) =>
                                  setEditDados({ ...editDados, registroProfissionalRT: e.target.value })
                                }
                                placeholder="Ex: CREA, CRM, MTE"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-600 disabled:opacity-60"
                              />
                            </div>
                          </>
                        )}

                        {/* Expiration Date with Explicit/Configured Origin Badge */}
                        <div className="sm:col-span-2 p-3 rounded-lg bg-slate-900 border border-slate-800">
                          <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-200">
                                Data de Vencimento / Validade
                              </span>
                              {!editDados.semValidade && !editDados.dataValidade && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[9px] font-bold uppercase text-amber-300">
                                  SEM VALIDADE DEFINIDA
                                </span>
                              )}
                              {editDados.validadeOrigem && editDados.dataValidade && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-[10px] text-blue-300">
                                  Origem: {editDados.validadeOrigem.replace('_', ' ')}
                                </span>
                              )}
                            </div>

                            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={isLocked || !canEdit}
                                checked={Boolean(editDados.semValidade)}
                                onChange={(e) =>
                                  setEditDados({
                                    ...editDados,
                                    semValidade: e.target.checked,
                                    dataValidade: e.target.checked ? '' : editDados.dataValidade,
                                  })
                                }
                                className="rounded bg-slate-950 border-slate-700 text-blue-600"
                              />
                              Documento sem vencimento
                            </label>
                          </div>

                          <input
                            type="date"
                            disabled={isLocked || !canEdit || Boolean(editDados.semValidade)}
                            value={editDados.dataValidade || ''}
                            onChange={(e) =>
                              setEditDados({
                                ...editDados,
                                dataValidade: e.target.value,
                                validadeOrigem: e.target.value ? 'manual' : 'nao_identificada',
                              })
                            }
                            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white disabled:opacity-50"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Observações da Conferência Técnica
                          </label>
                          <textarea
                            rows={2}
                            disabled={isLocked || !canEdit || Boolean(activeDoc.lgpdRedacted)}
                            value={editDados.observacoes || ''}
                            onChange={(e) => setEditDados({ ...editDados, observacoes: e.target.value })}
                            placeholder="Anotações de revisão SSMA..."
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white disabled:opacity-60"
                          />
                        </div>
                      </div>

                      {editDados.resumoConteudo && (
                        <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
                          <span className="font-semibold text-blue-300">Resumo OCR/IA: </span>
                          {editDados.resumoConteudo}
                        </div>
                      )}
                    </div>

                    {/* Audit & Alteration History */}
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                        <History size={14} className="text-blue-400" />
                        Trilha de Auditoria e Alterações
                      </h4>
                      <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                        {(activeDoc.historico || []).slice().reverse().map((h, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-200">{h.acao}</span>
                              <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                                {new Date(h.dataHora).toLocaleString('pt-BR')}
                              </span>
                            </div>
                            <p className="text-slate-400 mt-0.5">
                              {h.usuarioNome} ({h.usuarioRole}) — {h.detalhes}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Action Footer */}
                  <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      {!isLocked && canEdit && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={handleSaveEdits}
                          className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Save size={14} />
                          Salvar Conferência
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin && !isLocked && (
                        <>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              setDecisionReason('');
                              setDecisionModal('reject');
                            }}
                            className="px-3.5 py-2 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <XCircle size={14} />
                            Rejeitar
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              setDecisionReason('');
                              setDecisionModal('correction');
                            }}
                            className="px-3.5 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <MessageSquareWarning size={14} />
                            Solicitar Correção
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={handleApprove}
                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/25 flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
                            Aprovar e Integrar
                          </button>
                        </>
                      )}

                      {isAuditor && (
                        <span className="text-[11px] text-slate-400 italic">
                          Perfil Auditor: visualização somente leitura
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* CORRECTION / REJECTION REASON MODAL */}
      {decisionModal && activeDoc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              {decisionModal === 'reject' ? (
                <>
                  <XCircle size={18} className="text-red-400" />
                  Justificativa Obrigatória de Rejeição
                </>
              ) : (
                <>
                  <MessageSquareWarning size={18} className="text-amber-400" />
                  Solicitar Correção à Contratada
                </>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Documento: <span className="text-slate-200 font-medium">{activeDoc.arquivoNome}</span>
            </p>

            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {decisionModal === 'reject'
                  ? 'Motivo da rejeição definitiva *'
                  : 'O que precisa ser corrigido ou reenviado *'}
              </label>
              <textarea
                rows={3}
                required
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder={
                  decisionModal === 'reject'
                    ? 'Ex: Certificado sem assinatura do RT ou adulteração na data de validade...'
                    : 'Ex: CPF ilegível na digitalização, reenviar com melhor nitidez...'
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!decisionReason.trim() || actionBusy}
                onClick={handleDecisionConfirm}
                className={`px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 ${
                  decisionModal === 'reject'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {decisionModal === 'reject' ? 'Confirmar Rejeição' : 'Enviar Solicitação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VALIDITY RULES CONFIGURATION MODAL (ADMIN ONLY) */}
      {isRulesOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock size={18} className="text-blue-400" />
                  Regras Configuradas de Validade (SmartDocs)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  O cálculo automático de vencimento só ocorre quando o documento não traz data impressa E há regra configurada aqui.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRulesOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddValidityRule} className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">Tipo Documental</label>
                  <input
                    type="text"
                    required
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value)}
                    placeholder="Ex: ASO, NR-35, NR-10, PGR..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Prazo (meses)</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    required
                    value={newRuleMonths}
                    onChange={(e) => setNewRuleMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white tabular-nums"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newRuleObs}
                  onChange={(e) => setNewRuleObs(e.target.value)}
                  placeholder="Observação normativa (ex: NR-07 item 7.5.8)"
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shrink-0"
                >
                  Adicionar Regra
                </button>
              </div>
            </form>

            <div className="mt-4 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {validityRules.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  Nenhuma regra automática configurada. Documentos sem validade impressa permanecerão como "SEM VALIDADE DEFINIDA".
                </p>
              ) : (
                validityRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{rule.tipoDocumento}</span>
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono tabular-nums text-[11px]">
                        +{rule.mesesValidade} meses
                      </span>
                      {rule.observacao && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{rule.observacao}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteValidityRule(rule.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-900"
                      title="Remover regra"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
