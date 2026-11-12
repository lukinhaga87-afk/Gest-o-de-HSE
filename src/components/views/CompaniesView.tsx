import React, { useState, useMemo } from 'react';
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  ShieldAlert,
  FileText,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CheckCircle,
  XCircle,
  X,
  ExternalLink,
  Users,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Company } from '../../types/sst';
import { formatCNPJ, formatDateBR } from '../../utils/trafficLight';

export const CompaniesView: React.FC = () => {
  const { companies, employees, addCompany, updateCompany, deleteCompany } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativa' | 'inativa'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [selectedCompanyDetail, setSelectedCompanyDetail] = useState<Company | null>(null);

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
    dataInicioContrato: '',
    dataTerminoContrato: '',
    situacao: 'ativa',
  });

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
      dataInicioContrato: '',
      dataTerminoContrato: '',
      situacao: 'ativa',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (comp: Company) => {
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
      dataInicioContrato: comp.dataInicioContrato,
      dataTerminoContrato: comp.dataTerminoContrato,
      situacao: comp.situacao,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.razaoSocial || !formData.cnpj) {
      alert('Razão Social e CNPJ são campos obrigatórios.');
      return;
    }

    try {
      if (editingCompany) {
        await updateCompany(editingCompany.id, formData);
      } else {
        await addCompany(formData);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar os dados da empresa.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para excluir empresas.');
      return;
    }
    if (confirm(`Confirma a exclusão da empresa "${name}" e desvinculação de seus colaboradores?`)) {
      try {
        await deleteCompany(id);
      } catch (err) {
        console.error(err);
        alert('Erro ao excluir empresa.');
      }
    }
  };

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
            Gestão de fornecedores, contratos, responsáveis legais e responsáveis pela segurança
          </p>
        </div>

        {(isAdmin || isSolicitante) && (
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
          >
            <Plus size={16} />
            + ADICIONAR EMPRESA
          </button>
        )}
      </div>

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
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todas as Situações</option>
            <option value="ativa">Somente Ativas</option>
            <option value="inativa">Somente Inativas</option>
          </select>
        </div>
      </div>

      {/* Companies Cards / Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredCompanies.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <Building2 size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhuma empresa encontrada</p>
            <p className="text-xs text-slate-400 mt-1">Ajuste os filtros ou adicione uma nova empresa.</p>
          </div>
        ) : (
          filteredCompanies.map((company) => {
            const companyEmployeesCount = employees.filter((e) => e.empresaId === company.id).length;
            return (
              <div
                key={company.id}
                className="rounded-xl bg-slate-900 border border-slate-800 p-5 flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        {company.nomeFantasia || company.razaoSocial}
                      </span>
                      <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                        {company.razaoSocial}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        company.situacao === 'ativa'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {company.situacao}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-xs text-slate-300">
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">CNPJ:</span>
                      <span className="font-mono text-slate-200">{formatCNPJ(company.cnpj)}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">Resp. SST:</span>
                      <span className="text-slate-200 truncate">{company.responsavelSST || 'Não informado'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-slate-400 font-medium">Unidade:</span>
                      <span className="text-slate-200">{company.unidadeAtendimento || 'Matriz'}</span>
                    </p>
                    <p className="text-slate-400 text-[11px] line-clamp-2">
                      <span className="font-medium text-slate-400">Atividade: </span>
                      {company.atividadeContratada || 'Prestação de serviços'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Users size={14} className="text-blue-400" />
                    <span>{companyEmployeesCount} Colaboradores</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedCompanyDetail(company)}
                      className="px-2.5 py-1 text-xs text-blue-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                      title="Ver detalhes completos"
                    >
                      Detalhes
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
                          onClick={() => handleDelete(company.id, company.razaoSocial)}
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

      {/* Add / Edit Company Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome Fantasia</label>
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Situação Contratual</label>
                  <select
                    value={formData.situacao}
                    onChange={(e: any) => setFormData({ ...formData, situacao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="ativa">Ativa</option>
                    <option value="inativa">Inativa</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Responsável Legal</label>
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Telefone de Contato</label>
                  <input
                    type="text"
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="(00) 0000-0000"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">E-mail de Contato SST</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="sst@empresa.com.br"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Unidade de Atendimento</label>
                  <input
                    type="text"
                    value={formData.unidadeAtendimento}
                    onChange={(e) => setFormData({ ...formData, unidadeAtendimento: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Matriz SP ou Planta Betim"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Atividade Contratada</label>
                  <input
                    type="text"
                    value={formData.atividadeContratada}
                    onChange={(e) => setFormData({ ...formData, atividadeContratada: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Montagem Mecânica, Obras Civis"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Início do Contrato</label>
                  <input
                    type="date"
                    value={formData.dataInicioContrato}
                    onChange={(e) => setFormData({ ...formData, dataInicioContrato: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Término do Contrato</label>
                  <input
                    type="date"
                    value={formData.dataTerminoContrato}
                    onChange={(e) => setFormData({ ...formData, dataTerminoContrato: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Endereço Completo</label>
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
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-xs text-slate-300 transition-colors"
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

      {/* Details Modal */}
      {selectedCompanyDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{selectedCompanyDetail.razaoSocial}</h3>
                  <p className="text-xs text-slate-400">CNPJ: {formatCNPJ(selectedCompanyDetail.cnpj)}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCompanyDetail(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">Nome Fantasia:</span>
                  <span className="font-semibold text-white">{selectedCompanyDetail.nomeFantasia || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Situação:</span>
                  <span className="font-semibold text-emerald-400 uppercase">{selectedCompanyDetail.situacao}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Responsável Legal:</span>
                  <span className="text-slate-200">{selectedCompanyDetail.responsavelLegal || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Responsável SST:</span>
                  <span className="text-slate-200">{selectedCompanyDetail.responsavelSST || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Telefone:</span>
                  <span className="text-slate-200">{selectedCompanyDetail.telefone || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">E-mail:</span>
                  <span className="text-slate-200">{selectedCompanyDetail.email || '-'}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[11px]">Endereço:</span>
                <span className="text-slate-200">{selectedCompanyDetail.endereco || 'Não informado'}</span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[11px]">Atividade Contratada:</span>
                <span className="text-slate-200">{selectedCompanyDetail.atividadeContratada || '-'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">Início do Contrato:</span>
                  <span className="text-slate-200">{formatDateBR(selectedCompanyDetail.dataInicioContrato)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Término do Contrato:</span>
                  <span className="text-slate-200">{formatDateBR(selectedCompanyDetail.dataTerminoContrato)}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedCompanyDetail(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-xs text-white hover:bg-slate-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
