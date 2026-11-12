import React, { useState, useMemo } from 'react';
import {
  GraduationCap,
  Plus,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Edit2,
  FileText,
  Upload,
  X,
  ExternalLink,
  AlertTriangle,
  Building2,
  User,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Training } from '../../types/sst';
import { formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';

export const TrainingsView: React.FC = () => {
  const {
    trainings,
    employees,
    companies,
    addTraining,
    updateTraining,
    approveTraining,
    rejectTraining,
    deleteTraining,
  } = useSST();

  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState<string>('todas');
  const [colaboradorFilter, setColaboradorFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [farolFilter, setFarolFilter] = useState<string>('todos');

  // Filtered employees list based on selected company
  const availableEmployees = useMemo(() => {
    if (empresaFilter === 'todas') {
      return employees;
    }
    return employees.filter((e) => e.empresaId === empresaFilter);
  }, [employees, empresaFilter]);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTraining, setEditingTraining] = useState<Training | null>(null);

  // Approval / Rejection modal
  const [rejectingItem, setRejectingItem] = useState<Training | null>(null);
  const [motivoReprovacao, setMotivoReprovacao] = useState('');

  // Form states - CRITICAL: nomeTreinamento is FREE TEXT and INITIALLY EMPTY
  const [formData, setFormData] = useState<Omit<Training, 'id'>>({
    nomeTreinamento: '', // Campo livre e inicialmente em branco
    colaboradorId: '',
    colaboradorNome: '',
    empresaId: '',
    empresaNome: '',
    instituicaoResponsavel: '',
    instrutor: '',
    dataRealizacao: '',
    cargaHoraria: '',
    dataValidade: '',
    semValidade: false,
    certificadoUrl: '',
    certificadoNome: '',
    observacoes: '',
    situacao: 'pendente',
  });

  // Scoped list separated by Empresa and Funcionário
  const filteredTrainings = useMemo(() => {
    let list = trainings;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((t) => t.empresaId === activeEmpresaId);
    } else if (empresaFilter !== 'todas') {
      list = list.filter((t) => t.empresaId === empresaFilter);
    }

    if (colaboradorFilter !== 'todos') {
      list = list.filter((t) => t.colaboradorId === colaboradorFilter);
    }

    if (statusFilter !== 'todos') {
      list = list.filter((t) => t.situacao === statusFilter);
    }
    if (farolFilter !== 'todos') {
      list = list.filter(
        (t) => getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao).status === farolFilter
      );
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (t) =>
          t.nomeTreinamento.toLowerCase().includes(q) ||
          t.colaboradorNome.toLowerCase().includes(q) ||
          t.empresaNome.toLowerCase().includes(q) ||
          (t.instrutor && t.instrutor.toLowerCase().includes(q))
      );
    }
    return list;
  }, [
    trainings,
    isSolicitante,
    activeEmpresaId,
    empresaFilter,
    colaboradorFilter,
    statusFilter,
    farolFilter,
    searchTerm,
  ]);

  const handleOpenAddModal = () => {
    setEditingTraining(null);
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    const defaultColab = employees.find((e) => e.empresaId === defaultEmp?.id) || employees[0];

    setFormData({
      nomeTreinamento: '', // LIVRE E INICIALMENTE EM BRANCO
      colaboradorId: defaultColab?.id || '',
      colaboradorNome: defaultColab?.nomeCompleto || '',
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      instituicaoResponsavel: '',
      instrutor: '',
      dataRealizacao: new Date().toISOString().split('T')[0],
      cargaHoraria: '',
      dataValidade: '',
      semValidade: false,
      certificadoUrl: '',
      certificadoNome: '',
      observacoes: '',
      situacao: 'pendente',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (t: Training) => {
    setEditingTraining(t);
    setFormData({
      nomeTreinamento: t.nomeTreinamento,
      colaboradorId: t.colaboradorId,
      colaboradorNome: t.colaboradorNome,
      empresaId: t.empresaId,
      empresaNome: t.empresaNome,
      instituicaoResponsavel: t.instituicaoResponsavel || '',
      instrutor: t.instrutor || '',
      dataRealizacao: t.dataRealizacao,
      cargaHoraria: t.cargaHoraria || '',
      dataValidade: t.dataValidade || '',
      semValidade: !!t.semValidade,
      certificadoUrl: t.certificadoUrl || '',
      certificadoNome: t.certificadoNome || '',
      observacoes: t.observacoes || '',
      situacao: t.situacao,
    });
    setIsModalOpen(true);
  };

  const handleCertificateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setFormData((prev) => ({
            ...prev,
            certificadoUrl: String(ev.target?.result),
            certificadoNome: file.name,
          }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nomeTreinamento.trim()) {
      alert('Por favor, informe o nome do treinamento.');
      return;
    }
    if (!formData.colaboradorId || !formData.empresaId) {
      alert('Selecione o colaborador e a empresa contratada.');
      return;
    }

    try {
      const colab = employees.find((e) => e.id === formData.colaboradorId);
      const comp = companies.find((c) => c.id === formData.empresaId);

      const payload = {
        ...formData,
        colaboradorNome: colab?.nomeCompleto || formData.colaboradorNome,
        empresaNome: comp?.razaoSocial || formData.empresaNome,
      };

      if (editingTraining) {
        await updateTraining(editingTraining.id, payload);
      } else {
        await addTraining(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar treinamento.');
    }
  };

  const handleApprove = async (id: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para aprovar treinamentos.');
      return;
    }
    try {
      await approveTraining(id);
    } catch (e) {
      console.error(e);
      alert('Erro ao aprovar treinamento.');
    }
  };

  const handleRejectConfirm = async () => {
    if (!motivoReprovacao.trim()) {
      alert('O motivo da reprovação é obrigatório.');
      return;
    }
    if (rejectingItem) {
      try {
        await rejectTraining(rejectingItem.id, motivoReprovacao);
        setRejectingItem(null);
        setMotivoReprovacao('');
      } catch (e) {
        console.error(e);
        alert('Erro ao reprovar treinamento.');
      }
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST pode excluir treinamentos aprovados.');
      return;
    }
    if (confirm(`Confirma a exclusão do treinamento "${name}"?`)) {
      try {
        await deleteTraining(id);
      } catch (e) {
        console.error(e);
        alert('Erro ao excluir treinamento.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <GraduationCap className="text-blue-500" />
            Gestão de Treinamentos e Capacitações
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Cadastro com digitação livre de treinamentos, capacitações, reciclagens e controle de validade
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
        >
          <Plus size={16} />
          Cadastrar Treinamento
        </button>
      </div>

      {/* Filters and Search - Separate by Company and Employee */}
      <div className="flex flex-col gap-3 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por Nome do Treinamento, Colaborador, Empresa ou Instrutor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Caixa de Seleção: Empresa */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-700">
              <Building2 size={14} className="text-blue-400 shrink-0" />
              <select
                value={empresaFilter}
                onChange={(e) => {
                  const newEmp = e.target.value;
                  setEmpresaFilter(newEmp);
                  if (newEmp !== 'todas' && colaboradorFilter !== 'todos') {
                    const empBelongs = employees.some(
                      (emp) => emp.id === colaboradorFilter && emp.empresaId === newEmp
                    );
                    if (!empBelongs) {
                      setColaboradorFilter('todos');
                    }
                  }
                }}
                className="bg-transparent text-xs text-white focus:outline-none max-w-[190px] truncate py-1 cursor-pointer"
                title="Separar por Empresa"
              >
                <option value="todas" className="bg-slate-900 text-white">
                  🏢 Todas as Empresas ({companies.length})
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {c.nomeFantasia || c.razaoSocial}
                  </option>
                ))}
              </select>
            </div>

            {/* Caixa de Seleção: Funcionário */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-700">
              <User size={14} className="text-cyan-400 shrink-0" />
              <select
                value={colaboradorFilter}
                onChange={(e) => setColaboradorFilter(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none max-w-[200px] truncate py-1 cursor-pointer"
                title="Separar por Funcionário"
              >
                <option value="todos" className="bg-slate-900 text-white">
                  👤 Todos os Funcionários ({availableEmployees.length})
                </option>
                {availableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id} className="bg-slate-900 text-white">
                    {emp.nomeCompleto}
                  </option>
                ))}
              </select>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="todos">Todas as Situações</option>
              <option value="aprovado">Aprovado</option>
              <option value="pendente">Pendente de Análise</option>
              <option value="reprovado">Reprovado</option>
            </select>

            <select
              value={farolFilter}
              onChange={(e) => setFarolFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="todos">Todos os Faróis</option>
              <option value="verde">Farol Verde (Válido &gt; 30d)</option>
              <option value="amarelo">Farol Amarelo (Vence em 30d)</option>
              <option value="vermelho">Farol Vermelho (Vencido)</option>
              <option value="cinza">Farol Cinza (Pendente)</option>
            </select>

            {(empresaFilter !== 'todas' ||
              colaboradorFilter !== 'todos' ||
              statusFilter !== 'todos' ||
              farolFilter !== 'todos' ||
              searchTerm) && (
              <button
                onClick={() => {
                  setEmpresaFilter('todas');
                  setColaboradorFilter('todos');
                  setStatusFilter('todos');
                  setFarolFilter('todos');
                  setSearchTerm('');
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs flex items-center gap-1 transition-colors cursor-pointer"
                title="Limpar todos os filtros"
              >
                <X size={13} />
                <span>Limpar</span>
              </button>
            )}
          </div>
        </div>

        {/* Informative separation banner when company or employee is selected */}
        {(empresaFilter !== 'todas' || colaboradorFilter !== 'todos') && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300 flex-wrap">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Filter size={13} className="text-blue-400" />
              Filtrado por:
            </span>
            {empresaFilter !== 'todas' && (
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 font-medium">
                🏢 {companies.find((c) => c.id === empresaFilter)?.nomeFantasia || companies.find((c) => c.id === empresaFilter)?.razaoSocial}
              </span>
            )}
            {colaboradorFilter !== 'todos' && (
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-medium">
                👤 {employees.find((e) => e.id === colaboradorFilter)?.nomeCompleto}
              </span>
            )}
            <span className="text-[11px] text-slate-400 ml-auto font-mono">
              {filteredTrainings.length} {filteredTrainings.length === 1 ? 'treinamento listado' : 'treinamentos listados'}
            </span>
          </div>
        )}
      </div>

      {/* Table of Trainings */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Treinamento / Capacitação</th>
                <th className="px-4 py-3">Colaborador & Empresa</th>
                <th className="px-4 py-3">Realização & Validade</th>
                <th className="px-4 py-3">Carga Horária</th>
                <th className="px-4 py-3">Farol SST</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredTrainings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    <GraduationCap size={36} className="mx-auto text-slate-400 mb-2" />
                    Nenhum treinamento encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredTrainings.map((t) => {
                  const farol = getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao);
                  return (
                    <tr key={t.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white text-sm">{t.nomeTreinamento}</div>
                        {t.instrutor && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Instrutor: {t.instrutor}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-200">{t.colaboradorNome}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {t.empresaNome}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-slate-300">
                          Realizado: {formatDateBR(t.dataRealizacao)}
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Validade: {t.semValidade ? 'Sem Vencimento' : formatDateBR(t.dataValidade)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-300 font-mono">
                        {t.cargaHoraria || '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            t.situacao === 'aprovado'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : t.situacao === 'reprovado'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {t.situacao}
                        </span>
                        {t.motivoReprovacao && (
                          <p className="text-[10px] text-red-400 mt-0.5 max-w-[160px] truncate" title={t.motivoReprovacao}>
                            Motivo: {t.motivoReprovacao}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {t.certificadoUrl && (
                            <a
                              href={t.certificadoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-blue-400 hover:text-white rounded hover:bg-slate-800"
                              title="Visualizar Certificado"
                            >
                              <FileText size={15} />
                            </a>
                          )}

                          {isAdmin && t.situacao === 'pendente' && (
                            <>
                              <button
                                onClick={() => handleApprove(t.id)}
                                className="p-1.5 text-emerald-400 hover:text-white rounded hover:bg-emerald-600/20"
                                title="Aprovar Treinamento"
                              >
                                <CheckCircle size={15} />
                              </button>
                              <button
                                onClick={() => {
                                  setRejectingItem(t);
                                  setMotivoReprovacao('');
                                }}
                                className="p-1.5 text-red-400 hover:text-white rounded hover:bg-red-600/20"
                                title="Reprovar Treinamento"
                              >
                                <XCircle size={15} />
                              </button>
                            </>
                          )}

                          {isAdmin && (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(t)}
                                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                title="Editar"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(t.id, t.nomeTreinamento)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800"
                                title="Excluir"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
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

      {/* Add / Edit Training Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <GraduationCap size={18} className="text-blue-500" />
                {editingTraining ? 'Editar Treinamento' : 'Novo Treinamento / Capacitação'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* CRITICAL REQUIREMENT 8: NOME LIVRE E INICIALMENTE EM BRANCO */}
              <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30">
                <label className="block text-xs font-bold text-blue-300 mb-1">
                  Nome do Treinamento / Capacitação (Campo Livre) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.nomeTreinamento}
                  onChange={(e) => setFormData({ ...formData, nomeTreinamento: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-blue-500/50 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400"
                  placeholder="Digite livremente o nome (ex: NR-10 Básico, NR-35 Trabalho em Altura, Operação de Plataforma Elevatória...)"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Atenção: Não há opções fixas. Digite qualquer qualificação ou curso necessário.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Empresa Contratada <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={formData.empresaId}
                    onChange={(e) => {
                      const comp = companies.find((c) => c.id === e.target.value);
                      setFormData({
                        ...formData,
                        empresaId: e.target.value,
                        empresaNome: comp?.razaoSocial || '',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Colaborador <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={formData.colaboradorId}
                    onChange={(e) => {
                      const emp = employees.find((em) => em.id === e.target.value);
                      setFormData({
                        ...formData,
                        colaboradorId: e.target.value,
                        colaboradorNome: emp?.nomeCompleto || '',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Selecione o colaborador...</option>
                    {employees
                      .filter((emp) => !formData.empresaId || emp.empresaId === formData.empresaId)
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nomeCompleto} ({emp.cargo})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Instituição Responsável / Escola
                  </label>
                  <input
                    type="text"
                    value={formData.instituicaoResponsavel}
                    onChange={(e) =>
                      setFormData({ ...formData, instituicaoResponsavel: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: SENAI, SESI, Consultoria SST"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Instrutor / Profissional Habilitado
                  </label>
                  <input
                    type="text"
                    value={formData.instrutor}
                    onChange={(e) => setFormData({ ...formData, instrutor: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Nome e registro profissional"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Data de Realização <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dataRealizacao}
                    onChange={(e) => setFormData({ ...formData, dataRealizacao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Carga Horária</label>
                  <input
                    type="text"
                    value={formData.cargaHoraria}
                    onChange={(e) => setFormData({ ...formData, cargaHoraria: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: 8h, 16h, 40h"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">Data de Validade</label>
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.semValidade}
                        onChange={(e) =>
                          setFormData({ ...formData, semValidade: e.target.checked, dataValidade: '' })
                        }
                        className="rounded bg-slate-950 border-slate-700 text-blue-600"
                      />
                      Sem Vencimento
                    </label>
                  </div>
                  <input
                    type="date"
                    disabled={formData.semValidade}
                    value={formData.dataValidade}
                    onChange={(e) => setFormData({ ...formData, dataValidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Anexo do Certificado (PDF ou Imagem)
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 cursor-pointer">
                    <Upload size={14} className="text-blue-400" />
                    <span className="truncate">
                      {formData.certificadoNome || 'Selecionar certificado...'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={handleCertificateUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Conteúdo programático, reciclagem bienal, etc."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/30"
                >
                  Salvar Treinamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory Reason for Rejection Modal */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-red-500/50 shadow-2xl p-6">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <span className="p-2 rounded-lg bg-red-500/20 text-red-400">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Justificativa de Reprovação</h3>
                <p className="text-xs text-slate-400">
                  Treinamento: {rejectingItem.nomeTreinamento}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-300">
                Conforme a Seção 14 (Fluxo de Aprovação), ao reprovar qualquer registro é{' '}
                <strong className="text-red-400">obrigatório informar o motivo</strong> para que a empresa
                contratada possa providenciar as devidas correções.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Motivo da Reprovação <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={motivoReprovacao}
                  onChange={(e) => setMotivoReprovacao(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-red-500/40 text-xs text-white focus:outline-none focus:border-red-500"
                  placeholder="Ex: Certificado ilegível, carga horária divergente da NR-35, assinatura do instrutor ausente..."
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectingItem(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-750"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-bold text-white shadow-md shadow-red-600/30"
              >
                Confirmar Reprovação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
