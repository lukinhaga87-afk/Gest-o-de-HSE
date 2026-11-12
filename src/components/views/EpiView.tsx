import React, { useState, useMemo } from 'react';
import {
  HardHat,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  FileCheck,
  Building2,
  User,
  ShieldAlert,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { EPIDelivery } from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

export const EpiView: React.FC = () => {
  const { epiDeliveries, employees, companies, addEPIDelivery, deleteEPIDelivery } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId, profile } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState<Omit<EPIDelivery, 'id'>>({
    colaboradorId: '',
    colaboradorNome: '',
    empresaId: '',
    empresaNome: '',
    nomeEpi: '',
    caNumero: '',
    dataEntrega: new Date().toISOString().split('T')[0],
    quantidade: 1,
    responsavelEntrega: profile?.nome || 'Técnico de Segurança',
    assinaturaUrl: '',
    comprovanteNome: '',
    observacoes: '',
  });

  const filteredEPIs = useMemo(() => {
    let list = epiDeliveries;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((ep) => ep.empresaId === activeEmpresaId);
    }
    if (employeeFilter !== 'todos') {
      list = list.filter((ep) => ep.colaboradorId === employeeFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (ep) =>
          ep.nomeEpi.toLowerCase().includes(q) ||
          ep.caNumero.toLowerCase().includes(q) ||
          ep.colaboradorNome.toLowerCase().includes(q) ||
          ep.empresaNome.toLowerCase().includes(q)
      );
    }
    return list;
  }, [epiDeliveries, isSolicitante, activeEmpresaId, employeeFilter, searchTerm]);

  const handleOpenAddModal = () => {
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    const defaultColab = employees.find((e) => e.empresaId === defaultEmp?.id) || employees[0];

    setFormData({
      colaboradorId: defaultColab?.id || '',
      colaboradorNome: defaultColab?.nomeCompleto || '',
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      nomeEpi: '',
      caNumero: '',
      dataEntrega: new Date().toISOString().split('T')[0],
      quantidade: 1,
      responsavelEntrega: profile?.nome || 'Técnico de Segurança',
      assinaturaUrl: '',
      comprovanteNome: '',
      observacoes: 'EPI entregue higienizado e em perfeito estado de conservação.',
    });
    setIsModalOpen(true);
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setFormData((prev) => ({
            ...prev,
            assinaturaUrl: String(ev.target?.result),
            comprovanteNome: file.name,
          }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nomeEpi.trim() || !formData.caNumero.trim() || !formData.colaboradorId) {
      alert('Nome do EPI, número do CA e colaborador são obrigatórios.');
      return;
    }

    try {
      const colab = employees.find((em) => em.id === formData.colaboradorId);
      const comp = companies.find((c) => c.id === formData.empresaId);

      const payload = {
        ...formData,
        colaboradorNome: colab?.nomeCompleto || formData.colaboradorNome,
        empresaNome: comp?.razaoSocial || formData.empresaNome,
      };

      await addEPIDelivery(payload);
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao registrar entrega de EPI.');
    }
  };

  const handleDelete = async (id: string, epiName: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST pode excluir registros de entrega de EPI.');
      return;
    }
    if (confirm(`Confirma a exclusão do registro de entrega de "${epiName}"?`)) {
      try {
        await deleteEPIDelivery(id);
      } catch (err) {
        console.error(err);
        alert('Erro ao excluir entrega de EPI.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <HardHat className="text-amber-500" />
            Controle de Fornecimento de EPI (NR-06)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Ficha individual de fornecimento de Equipamentos de Proteção Individual com Certificado de Aprovação (CA)
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
        >
          <Plus size={16} />
          Registrar Entrega de EPI
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por EPI, CA, Colaborador ou Empresa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 whitespace-nowrap">Filtrar Colaborador:</span>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[220px]"
          >
            <option value="todos">Todos os Colaboradores</option>
            {employees.map((em) => (
              <option key={em.id} value={em.id}>
                {em.nomeCompleto}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table of Deliveries */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Equipamento (EPI)</th>
                <th className="px-4 py-3">Certificado de Aprovação (CA)</th>
                <th className="px-4 py-3">Colaborador Beneficiário</th>
                <th className="px-4 py-3">Empresa Contratada</th>
                <th className="px-4 py-3">Data & Quantidade</th>
                <th className="px-4 py-3">Responsável pela Entrega</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredEPIs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    <HardHat size={36} className="mx-auto text-slate-400 mb-2" />
                    Nenhum registro de entrega de EPI encontrado.
                  </td>
                </tr>
              ) : (
                filteredEPIs.map((ep) => (
                  <tr key={ep.id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-white text-sm">{ep.nomeEpi}</div>
                      {ep.observacoes && (
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                          {ep.observacoes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-amber-400 font-semibold">
                      CA {ep.caNumero}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-slate-200">{ep.colaboradorNome}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 truncate max-w-[180px]">
                      {ep.empresaNome}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-slate-200">{formatDateBR(ep.dataEntrega)}</div>
                      <div className="text-[11px] text-slate-400 font-mono">Qtd: {ep.quantidade} un</div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {ep.responsavelEntrega}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {ep.assinaturaUrl && (
                          <a
                            href={ep.assinaturaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-blue-400 hover:text-white rounded hover:bg-slate-800"
                            title="Comprovante / Assinatura"
                          >
                            <FileCheck size={15} />
                          </a>
                        )}

                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(ep.id, ep.nomeEpi)}
                            className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800"
                            title="Excluir Registro"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add EPI Delivery Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <HardHat size={18} className="text-amber-500" />
                Registrar Entrega de EPI
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
                    Nome do EPI <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nomeEpi}
                    onChange={(e) => setFormData({ ...formData, nomeEpi: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Capacete com jugular, Protetor auricular, Luva nitrílica"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Número do CA (Certificado de Aprovação) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.caNumero}
                    onChange={(e) => setFormData({ ...formData, caNumero: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                    placeholder="Ex: 34125"
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
                    Data de Entrega <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dataEntrega}
                    onChange={(e) => setFormData({ ...formData, dataEntrega: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    value={formData.quantidade}
                    onChange={(e) => setFormData({ ...formData, quantidade: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Responsável pela Entrega / Almoxarifado SST
                </label>
                <input
                  type="text"
                  value={formData.responsavelEntrega}
                  onChange={(e) => setFormData({ ...formData, responsavelEntrega: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Nome do técnico ou encarregado"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Comprovante Assinado / Ficha Digital de EPI (Opcional)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 cursor-pointer">
                  <Upload size={14} className="text-blue-400" />
                  <span className="truncate">
                    {formData.comprovanteNome || 'Selecionar comprovante assinado...'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={handleReceiptUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Observações</label>
                <textarea
                  rows={2}
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Observações sobre o estado do EPI, substituição periódica, etc."
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
                  Registrar Fornecimento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
