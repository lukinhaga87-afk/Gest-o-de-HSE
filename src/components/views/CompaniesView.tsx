import React, { useState, useMemo } from 'react';
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
  FileWarning,
  X,
  Users,
  Layers,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Company } from '../../types/sst';
import { formatCNPJ, formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';
import { evaluateActivityCompliance } from '../../utils/activityComplianceEngine';
import { ComplianceChecklistPanel } from './ComplianceChecklistPanel';
import { ProtectedDocumentButton } from '../common/ProtectedDocumentButton';

export const CompaniesView: React.FC = () => {
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
    addCompany,
    updateCompany,
    deleteCompany,
  } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativa' | 'inativa'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [selectedCompanyDetail, setSelectedCompanyDetail] = useState<Company | null>(null);
  const [detailTab, setDetailTab] = useState<
    'dados' | 'conformidade' | 'documentos' | 'solicitacoes'
  >('dados');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null
  );
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<Company | null>(null);

  // Form states
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

  // Compute consolidated compliance summary per company using the official compliance engine
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

  // Filter scoped list
  const filteredCompanies = useMemo(() => {
    let list = companies;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((c) => c.id === activeEmpresaId);
    }
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
  }, [companies, isSolicitante, activeEmpresaId, statusFilter, searchTerm]);

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
        await addCompany(payload);
        setFeedback({ type: 'success', message: `Empresa "${payload.razaoSocial}" cadastrada.` });
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

  const openDetails = (company: Company, initialTab: 'dados' | 'conformidade' | 'documentos' | 'solicitacoes' = 'dados') => {
    setSelectedCompanyDetail(company);
    setDetailTab(initialTab);
  };

  const selectedCompanyDocs = useMemo(() => {
    if (!selectedCompanyDetail) return [];
    return documents
      .filter((d) => d.empresaId === selectedCompanyDetail.id)
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  }, [documents, selectedCompanyDetail]);

  const selectedCompanyPermits = useMemo(() => {
    if (!selectedCompanyDetail) return [];
    return safetyPermits
      .filter((p) => p.empresaId === selectedCompanyDetail.id)
      .sort((a, b) => (b.updatedAt || b.createdAt || b.dataInicio || '').localeCompare(a.updatedAt || a.createdAt || a.dataInicio || ''));
  }, [safetyPermits, selectedCompanyDetail]);

  const selectedCompanyCompliance = useMemo(() => {
    if (!selectedCompanyDetail) return null;
    return companyComplianceMap.get(selectedCompanyDetail.id) || null;
  }, [selectedCompanyDetail, companyComplianceMap]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-blue-500" />
            Empresas Contratadas e Prestadoras de Serviço
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gestão de terceiras, contratos, atividades autorizadas, conformidade documental e histórico de liberações
          </p>
        </div>

        {(isAdmin || isSolicitante) && (
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
          >
            <Plus size={16} />
            Adicionar Empresa Contratada
          </button>
        )}
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

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Razão, CNPJ ou Responsável..."
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
            <option value="todos">Todas as Situações</option>
            <option value="ativa">Somente Ativas</option>
            <option value="inativa">Somente Inativas</option>
          </select>
        </div>
      </div>

      {/* Companies Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredCompanies.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <Building2 size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhuma empresa encontrada</p>
            <p className="text-xs text-slate-400 mt-1">
              Ajuste os filtros ou adicione uma nova empresa contratada.
            </p>
          </div>
        ) : (
          filteredCompanies.map((company) => {
            const companyEmployeesCount = employees.filter((e) => e.empresaId === company.id).length;
            const companyDocsCount = documents.filter((d) => d.empresaId === company.id).length;
            const companyPermitsCount = safetyPermits.filter((p) => p.empresaId === company.id).length;
            const compliance = companyComplianceMap.get(company.id) || null;
            const authorizedNames = (company.atividadesAutorizadasIds || [])
              .map((id) => activityProfiles.find((a) => a.id === id)?.nome)
              .filter(Boolean) as string[];

            return (
              <div
                key={company.id}
                className="rounded-xl bg-slate-900 border border-slate-800 p-5 flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white block truncate">
                        {company.nomeFantasia || company.razaoSocial}
                      </span>
                      <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                        {company.razaoSocial}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        company.situacao === 'ativa'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {company.situacao}
                    </span>
                  </div>

                  {/* Consolidated Compliance Indicator */}
                  <div className="mt-3">
                    {compliance ? (
                      <button
                        type="button"
                        onClick={() => openDetails(company, 'conformidade')}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                          compliance.statusGeral === 'conforme'
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15'
                            : compliance.statusGeral === 'atencao'
                            ? 'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/15'
                            : 'bg-rose-500/10 border-rose-500/25 text-rose-300 hover:bg-rose-500/15'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {compliance.statusGeral === 'conforme' ? (
                            <ShieldCheck size={15} className="shrink-0" />
                          ) : compliance.statusGeral === 'atencao' ? (
                            <AlertTriangle size={15} className="shrink-0" />
                          ) : (
                            <ShieldAlert size={15} className="shrink-0" />
                          )}
                          <span className="text-[11px] font-semibold truncate">
                            {compliance.statusGeral === 'conforme'
                              ? 'Conformidade Empresarial OK'
                              : compliance.statusGeral === 'atencao'
                              ? `Atenção: ${compliance.resumo.alertasAVencer} doc(s) a vencer`
                              : `${compliance.resumo.bloqueiosObrigatorios} pendência(s) bloqueante(s)`}
                          </span>
                        </div>
                        <span className="text-[10px] underline shrink-0">Ver</span>
                      </button>
                    ) : (
                      <div className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] text-slate-400">
                        Configure atividades na Matriz EHS para apurar conformidade
                      </div>
                    )}
                  </div>

                  <div className="mt-3.5 space-y-1.5 text-xs text-slate-300">
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">CNPJ:</span>
                      <span className="font-mono text-slate-200">{formatCNPJ(company.cnpj)}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">Resp. SST:</span>
                      <span className="text-slate-200 truncate">
                        {company.responsavelSST || 'Não informado'}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">Término Contrato:</span>
                      <span
                        className={
                          company.contrato_indeterminado
                            ? 'text-blue-300 font-medium'
                            : 'text-slate-200'
                        }
                      >
                        {company.contrato_indeterminado
                          ? 'Prazo indeterminado'
                          : formatDateBR(company.dataTerminoContrato)}
                      </span>
                    </p>
                    <div className="pt-1">
                      <span className="text-[11px] text-slate-400 font-medium block mb-1">
                        Atividades Autorizadas ({authorizedNames.length}):
                      </span>
                      {authorizedNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {authorizedNames.slice(0, 3).map((name) => (
                            <span
                              key={name}
                              className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-300"
                            >
                              {name}
                            </span>
                          ))}
                          {authorizedNames.length > 3 && (
                            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400">
                              +{authorizedNames.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {company.atividadeContratada || 'Não vinculadas à matriz'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 tabular-nums">
                    <span className="inline-flex items-center gap-1" title="Colaboradores terceirizados">
                      <Users size={13} className="text-blue-400" />
                      {companyEmployeesCount}
                    </span>
                    <span className="inline-flex items-center gap-1" title="Documentos vinculados">
                      <FileText size={13} className="text-emerald-400" />
                      {companyDocsCount}
                    </span>
                    <span className="inline-flex items-center gap-1" title="Solicitações / PTs">
                      <FileWarning size={13} className="text-amber-400" />
                      {companyPermitsCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openDetails(company, 'dados')}
                      className="px-2.5 py-1 text-xs text-blue-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                      title="Ver dossiê completo da contratada"
                    >
                      Dossiê
                    </button>

                    {isAdmin && (
                      <>
                        <button
                          onClick={() => handleOpenEditModal(company)}
                          className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                          title="Editar cadastro"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setPendingDeleteCompany(company)}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                          title="Excluir empresa"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

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

      {/* Add / Edit Company Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 size={18} className="text-blue-500" />
                {editingCompany ? 'Editar Empresa Contratada' : 'Cadastrar Nova Empresa Contratada'}
              </h3>
              <button
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
                    placeholder="Nome completo do diretor/sócio"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Responsável Segurança do Trabalho (SST)
                  </label>
                  <input
                    type="text"
                    value={formData.responsavelSST}
                    onChange={(e) => setFormData({ ...formData, responsavelSST: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Engenheiro ou Técnico SST"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Telefone de Contato
                  </label>
                  <input
                    type="text"
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="(00) 0000-0000"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    E-mail de Contato SST
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="sst@empresa.com.br"
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
                    placeholder="Ex: Planta Industrial SP"
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
                    placeholder="Ex: Montagem Mecânica, Manutenção Elétrica"
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
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="md:col-span-2 -mt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
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
                      className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Prazo indeterminado</span>
                  </label>
                </div>
              </div>

              {/* Atividades Críticas Autorizadas */}
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
                    Nenhuma atividade ativa cadastrada na Matriz de Atividades.
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
                  placeholder="Rua, Número, Bairro, Cidade - UF, CEP"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/30 transition-all"
                >
                  Salvar Empresa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evolved Tabbed Company Dossier Modal */}
      {selectedCompanyDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
                  <Building2 size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    {selectedCompanyDetail.razaoSocial}
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
              <button
                onClick={() => setSelectedCompanyDetail(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-900/60 overflow-x-auto text-xs">
              {[
                { id: 'dados' as const, label: 'Dados & Contrato' },
                { id: 'conformidade' as const, label: 'Conformidade Documental' },
                {
                  id: 'documentos' as const,
                  label: `Histórico de Documentos (${selectedCompanyDocs.length})`,
                },
                {
                  id: 'solicitacoes' as const,
                  label: `Solicitações e Atividades (${selectedCompanyPermits.length})`,
                },
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
                  </div>

                  <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-slate-400 block text-[11px]">Endereço</span>
                    <span className="text-slate-200">
                      {selectedCompanyDetail.endereco || 'Não informado'}
                    </span>
                  </div>

                  <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-slate-400 block text-[11px]">
                      Atividades Críticas Autorizadas
                    </span>
                    {(selectedCompanyDetail.atividadesAutorizadasIds || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedCompanyDetail.atividadesAutorizadasIds || []).map((actId) => {
                          const act = activityProfiles.find((a) => a.id === actId);
                          return (
                            <span
                              key={actId}
                              className="px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-semibold"
                            >
                              {act ? `${act.nome} (${act.codigo})` : actId}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-slate-400">
                        Nenhuma atividade específica vinculada — escopo livre:{' '}
                        {selectedCompanyDetail.atividadeContratada || 'Não informado'}
                      </p>
                    )}
                  </div>
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

              {detailTab === 'documentos' && (
                <div className="space-y-2.5">
                  {selectedCompanyDocs.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 bg-slate-950/50 rounded-xl border border-slate-800">
                      Nenhum documento cadastrado na coleção oficial para esta contratada.
                    </div>
                  ) : (
                    selectedCompanyDocs.map((docItem) => {
                      const farol = getTrafficLightStatus(
                        docItem.dataValidade,
                        docItem.semValidade,
                        docItem.situacao
                      );
                      return (
                        <div
                          key={docItem.id}
                          className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-white">{docItem.nomeDocumento}</span>
                              {docItem.tipoDocumentoCanonico && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                  {docItem.tipoDocumentoCanonico}
                                </span>
                              )}
                              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-300">
                                {docItem.categoria}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              Emissão: {formatDateBR(docItem.dataEmissao)} • Validade:{' '}
                              {docItem.semValidade
                                ? 'Sem vencimento'
                                : formatDateBR(docItem.dataValidade)}
                              {docItem.colaboradorNome
                                ? ` • Colaborador: ${docItem.colaboradorNome}`
                                : ' • Escopo: Empresa'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${farol.badgeClass}`}
                            >
                              {farol.label}
                            </span>
                            {docItem.arquivoUrl && (
                              <ProtectedDocumentButton
                                url={docItem.arquivoUrl}
                                fileName={docItem.arquivoNome || docItem.nomeDocumento}
                                title={`Abrir ${docItem.nomeDocumento}`}
                                label="Abrir"
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {detailTab === 'solicitacoes' && (
                <div className="space-y-2.5">
                  {selectedCompanyPermits.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 bg-slate-950/50 rounded-xl border border-slate-800">
                      Nenhuma solicitação de atividade ou permissão registrada para esta contratada.
                    </div>
                  ) : (
                    selectedCompanyPermits.map((perm) => (
                      <div
                        key={perm.id}
                        className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                              {perm.tipo}
                            </span>
                            <span className="font-bold text-white">{perm.titulo}</span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Local: {perm.localTrabalho} • Período: {formatDateBR(perm.dataInicio)} a{' '}
                            {formatDateBR(perm.dataFim)}
                          </p>
                          {(perm.atividadeNomes || []).length > 0 && (
                            <p className="text-[11px] text-blue-300">
                              Atividades: {(perm.atividadeNomes || []).join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-[10px] font-bold uppercase text-slate-200">
                            {perm.status === 'liberado' || perm.status === 'aprovado' ? (
                              <CheckCircle2 size={12} className="text-emerald-400" />
                            ) : (
                              <Clock size={12} className="text-amber-400" />
                            )}
                            {perm.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end">
              <button
                onClick={() => setSelectedCompanyDetail(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-xs text-white hover:bg-slate-700"
              >
                Fechar Dossiê
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
