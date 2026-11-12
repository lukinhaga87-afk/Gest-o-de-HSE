import React, { useState, useMemo } from 'react';
import {
  FileWarning,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  X,
  Building2,
  AlertTriangle,
  Shield,
  Layers,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { SafetyPermit, SafetyPermitType, SafetyPermitStatus } from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

export const PermitsView: React.FC = () => {
  const { safetyPermits, companies, addSafetyPermit, updateSafetyPermit, deleteSafetyPermit } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId, profile } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'todos' | SafetyPermitType>('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | SafetyPermitStatus>('todos');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPermit, setEditingPermit] = useState<SafetyPermit | null>(null);

  const [formData, setFormData] = useState<Omit<SafetyPermit, 'id'>>({
    tipo: 'APR',
    titulo: '',
    empresaId: '',
    empresaNome: '',
    localTrabalho: '',
    dataInicio: new Date().toISOString().split('T')[0],
    dataFim: '',
    responsavelEmissao: profile?.nome || 'Engenheiro de Segurança',
    riscosIdentificados: '',
    medidasPreventivas: '',
    status: 'elaboracao',
    anexoUrl: '',
  });

  const filteredPermits = useMemo(() => {
    let list = safetyPermits;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((p) => p.empresaId === activeEmpresaId);
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
          p.empresaNome.toLowerCase().includes(q)
      );
    }
    return list;
  }, [safetyPermits, isSolicitante, activeEmpresaId, typeFilter, statusFilter, searchTerm]);

  const handleOpenAddModal = (defaultType: SafetyPermitType = 'APR') => {
    setEditingPermit(null);
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    setFormData({
      tipo: defaultType,
      titulo: '',
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      localTrabalho: '',
      dataInicio: new Date().toISOString().split('T')[0],
      dataFim: '',
      responsavelEmissao: profile?.nome || 'Engenheiro de Segurança',
      riscosIdentificados: '',
      medidasPreventivas: '',
      status: 'elaboracao',
      anexoUrl: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (p: SafetyPermit) => {
    setEditingPermit(p);
    setFormData({
      tipo: p.tipo,
      titulo: p.titulo,
      empresaId: p.empresaId,
      empresaNome: p.empresaNome,
      localTrabalho: p.localTrabalho,
      dataInicio: p.dataInicio,
      dataFim: p.dataFim,
      responsavelEmissao: p.responsavelEmissao,
      riscosIdentificados: p.riscosIdentificados,
      medidasPreventivas: p.medidasPreventivas,
      status: p.status,
      anexoUrl: p.anexoUrl || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.titulo.trim() || !formData.empresaId || !formData.localTrabalho) {
      alert('Título, empresa e local são campos obrigatórios.');
      return;
    }

    try {
      const comp = companies.find((c) => c.id === formData.empresaId);
      const payload = {
        ...formData,
        empresaNome: comp ? comp.razaoSocial : formData.empresaNome,
      };

      if (editingPermit) {
        await updateSafetyPermit(editingPermit.id, payload);
      } else {
        await addSafetyPermit(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar permissão de segurança.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para excluir registros de segurança.');
      return;
    }
    if (confirm(`Confirma a exclusão de "${name}"?`)) {
      try {
        await deleteSafetyPermit(id);
      } catch (err) {
        console.error(err);
        alert('Erro ao excluir registro.');
      }
    }
  };

  const getStatusBadge = (status: SafetyPermitStatus) => {
    switch (status) {
      case 'elaboracao':
        return <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold uppercase">Em Elaboração</span>;
      case 'aprovado':
        return <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[10px] font-bold uppercase">Aprovado</span>;
      case 'em_execucao':
        return <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase">Em Execução</span>;
      case 'encerrado':
        return <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 text-[10px] font-bold uppercase">Encerrado</span>;
      case 'cancelado':
        return <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-bold uppercase">Cancelado</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileWarning className="text-amber-500" />
            APR, Permissão de Trabalho (PT) e LOTO
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Análise Preliminar de Riscos, Permissões para Trabalho Crítico e Bloqueio/Etiquetagem de Energias Perigosas
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenAddModal('APR')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30"
          >
            <Plus size={15} />
            Nova APR
          </button>
          <button
            onClick={() => handleOpenAddModal('PT')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md shadow-amber-600/30"
          >
            <Plus size={15} />
            Emitir PT
          </button>
          <button
            onClick={() => handleOpenAddModal('LOTO')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30"
          >
            <Plus size={15} />
            Mapa LOTO
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Título, Local ou Empresa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={typeFilter}
            onChange={(e: any) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Tipos (APR, PT, LOTO)</option>
            <option value="APR">Somente APR</option>
            <option value="PT">Somente PT</option>
            <option value="LOTO">Somente LOTO</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Status</option>
            <option value="elaboracao">Em Elaboração</option>
            <option value="aprovado">Aprovado</option>
            <option value="em_execucao">Em Execução</option>
            <option value="encerrado">Encerrado</option>
          </select>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPermits.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <FileWarning size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhuma APR ou PT cadastrada</p>
            <p className="text-xs text-slate-400 mt-1">Clique em "Nova APR" ou "Emitir PT" para criar.</p>
          </div>
        ) : (
          filteredPermits.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all flex flex-col justify-between shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      item.tipo === 'APR'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : item.tipo === 'PT'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {item.tipo}
                  </span>
                  {getStatusBadge(item.status)}
                </div>

                <h3 className="text-sm font-bold text-white mt-2.5 line-clamp-1">{item.titulo}</h3>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  Local: {item.localTrabalho}
                </p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  Empresa: {item.empresaNome}
                </p>

                <div className="mt-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">
                      Riscos Identificados:
                    </span>
                    <p className="text-slate-300 line-clamp-2">
                      {item.riscosIdentificados || 'Trabalho em altura, eletricidade, projeção de partículas'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block mt-1">
                      Medidas Preventivas:
                    </span>
                    <p className="text-slate-300 line-clamp-2">
                      {item.medidasPreventivas || 'Uso de cinto tipo paraquedista, isolamento de área e trava-quedas'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>Início: {formatDateBR(item.dataInicio)}</span>
                <div className="flex items-center gap-1">
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => handleOpenEditModal(item)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                        title="Editar"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id, item.titulo)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800"
                        title="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileWarning size={18} className="text-amber-500" />
                {editingPermit ? `Editar ${formData.tipo}` : `Nova ${formData.tipo}`}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Tipo de Documento</label>
                  <select
                    value={formData.tipo}
                    onChange={(e: any) => setFormData({ ...formData, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 font-bold"
                  >
                    <option value="APR">APR (Análise Preliminar de Risco)</option>
                    <option value="PT">PT (Permissão de Trabalho)</option>
                    <option value="LOTO">LOTO (Bloqueio e Etiquetagem)</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Título / Descrição da Operação <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.titulo}
                    onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Montagem de andaime em altura no Tanque T-04"
                  />
                </div>

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
                    Local de Trabalho / Frente de Serviço <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.localTrabalho}
                    onChange={(e) => setFormData({ ...formData, localTrabalho: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Galpão A, Subestação 13.8kV"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e: any) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="elaboracao">Em Elaboração</option>
                    <option value="aprovado">Aprovado</option>
                    <option value="em_execucao">Em Execução</option>
                    <option value="encerrado">Encerrado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data Início</label>
                  <input
                    type="date"
                    value={formData.dataInicio}
                    onChange={(e) => setFormData({ ...formData, dataInicio: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data Término</label>
                  <input
                    type="date"
                    value={formData.dataFim}
                    onChange={(e) => setFormData({ ...formData, dataFim: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Responsável pela Emissão</label>
                  <input
                    type="text"
                    value={formData.responsavelEmissao}
                    onChange={(e) => setFormData({ ...formData, responsavelEmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Riscos Críticos Identificados
                </label>
                <textarea
                  rows={2}
                  value={formData.riscosIdentificados}
                  onChange={(e) => setFormData({ ...formData, riscosIdentificados: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Ex: Queda com diferença de nível, choque elétrico, atmosferas inflamáveis..."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Medidas Preventivas e Controles Operacionais
                </label>
                <textarea
                  rows={2}
                  value={formData.medidasPreventivas}
                  onChange={(e) => setFormData({ ...formData, medidasPreventivas: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Ex: Instalação de linha de vida, aterramento temporário, teste com detector de quatro gases..."
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
                  Salvar Documento de Permissão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
