import React, { useState } from 'react';
import {
  ClipboardCheck,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Search,
  Building2,
  Calendar,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Inspection } from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

export const InspectionsView: React.FC = () => {
  const { inspections, companies, addInspection, updateInspection } = useSST();
  const { canEdit, profile, isAdmin } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'todos' | 'inspecao' | 'auditoria'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState<Omit<Inspection, 'id'>>({
    tipo: 'inspecao',
    titulo: '',
    local: '',
    data: new Date().toISOString().split('T')[0],
    auditor: profile?.nome || 'Auditor SST',
    empresaAuditadaId: '',
    empresaAuditadaNome: '',
    conformidades: 0,
    naoConformidades: 0,
    observacoes: '',
    status: 'planejada',
  });

  const filtered = inspections.filter((insp) => {
    if (typeFilter !== 'todos' && insp.tipo !== typeFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        insp.titulo.toLowerCase().includes(q) ||
        insp.local.toLowerCase().includes(q) ||
        (insp.empresaAuditadaNome && insp.empresaAuditadaNome.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenModal = () => {
    setFormData({
      tipo: 'inspecao',
      titulo: '',
      local: '',
      data: new Date().toISOString().split('T')[0],
      auditor: profile?.nome || 'Auditor SST',
      empresaAuditadaId: companies[0]?.id || '',
      empresaAuditadaNome: companies[0]?.razaoSocial || '',
      conformidades: 10,
      naoConformidades: 0,
      observacoes: 'Auditoria conforme requisitos das NRs aplicáveis.',
      status: 'concluida',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.titulo.trim() || !formData.local.trim()) {
      alert('Título e local são obrigatórios.');
      return;
    }

    try {
      const comp = companies.find((c) => c.id === formData.empresaAuditadaId);
      await addInspection({
        ...formData,
        empresaAuditadaNome: comp ? comp.razaoSocial : formData.empresaAuditadaNome,
      });
      setIsModalOpen(false);
    } catch (e) {
      console.error(e);
      alert('Erro ao registrar inspeção.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ClipboardCheck className="text-emerald-500" />
            Inspeções de Segurança e Auditorias SST
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Auditorias de campo, conformidade de frentes de trabalho e verificação de não conformidades
          </p>
        </div>

        {canEdit && (
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30"
          >
            <Plus size={16} />
            Registrar Inspeção / Auditoria
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Título, Local ou Empresa Auditada..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e: any) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
        >
          <option value="todos">Todos os Tipos</option>
          <option value="inspecao">Inspeções de Rotina</option>
          <option value="auditoria">Auditorias Formais</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <ClipboardCheck size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhuma inspeção registrada</p>
            <p className="text-xs text-slate-400 mt-1">Clique no botão para cadastrar uma nova inspeção.</p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
                    {item.tipo}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{formatDateBR(item.data)}</span>
                </div>

                <h3 className="text-sm font-bold text-white mt-2.5">{item.titulo}</h3>
                <p className="text-xs text-slate-300 mt-0.5">Local: {item.local}</p>
                {item.empresaAuditadaNome && (
                  <p className="text-[11px] text-slate-400 mt-0.5">Empresa: {item.empresaAuditadaNome}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-0.5">Auditor: {item.auditor}</p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-400 font-bold block">Conformidades</span>
                    <span className="text-base font-extrabold text-emerald-400">{item.conformidades}</span>
                  </div>
                  <div className="p-2 rounded bg-red-950/40 border border-red-500/20">
                    <span className="text-[10px] text-red-400 font-bold block">Não Conformidades</span>
                    <span className="text-base font-extrabold text-red-400">{item.naoConformidades}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-400 truncate max-w-[200px]" title={item.observacoes}>
                  {item.observacoes || 'Sem notas adicionais'}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-semibold">
                  {item.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Nova Inspeção ou Auditoria</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Tipo</label>
                  <select
                    value={formData.tipo}
                    onChange={(e: any) => setFormData({ ...formData, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  >
                    <option value="inspecao">Inspeção de Campo</option>
                    <option value="auditoria">Auditoria SST</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Data</label>
                  <input
                    type="date"
                    required
                    value={formData.data}
                    onChange={(e) => setFormData({ ...formData, data: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Título da Inspeção</label>
                <input
                  type="text"
                  required
                  value={formData.titulo}
                  onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                  placeholder="Ex: Auditoria Mensal de Canteiro e Andaimes"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Empresa Auditada</label>
                  <select
                    value={formData.empresaAuditadaId}
                    onChange={(e) => {
                      const comp = companies.find((c) => c.id === e.target.value);
                      setFormData({
                        ...formData,
                        empresaAuditadaId: e.target.value,
                        empresaAuditadaNome: comp?.razaoSocial || '',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  >
                    <option value="">Selecione...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.razaoSocial}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Local</label>
                  <input
                    type="text"
                    required
                    value={formData.local}
                    onChange={(e) => setFormData({ ...formData, local: e.target.value })}
                    placeholder="Ex: Frente 2 - Obra Civil"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Itens Conformes</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.conformidades}
                    onChange={(e) => setFormData({ ...formData, conformidades: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Não Conformidades</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.naoConformidades}
                    onChange={(e) => setFormData({ ...formData, naoConformidades: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Observações e Recomendações</label>
                <textarea
                  rows={2}
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="Relatório sucinto das constatações..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300"
                >
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white font-semibold">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
