import React, { useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  Building2,
  Briefcase,
  Camera,
  Upload,
  User,
  X,
  FileDown,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Employee, SituacaoColaborador } from '../../types/sst';
import { formatCPF, formatDateBR } from '../../utils/trafficLight';
import { EmployeeDossierModal } from './EmployeeDossierModal';

const SAMPLE_AVATARS = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&fit=crop&crop=faces&q=80',
];

export const EmployeesView: React.FC = () => {
  const { employees, companies, addEmployee, updateEmployee, deleteEmployee } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  const [selectedDossierEmployee, setSelectedDossierEmployee] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Form states
  const [formData, setFormData] = useState<Omit<Employee, 'id'>>({
    empresaId: '',
    empresaNome: '',
    nomeCompleto: '',
    cpf: '',
    rg: '',
    dataNascimento: '',
    telefone: '',
    email: '',
    matricula: '',
    cargo: '',
    setor: '',
    atividadeExecutada: '',
    unidadeAlocacao: '',
    dataAdmissao: '',
    dataIntegracao: '',
    responsavelEmpresa: '',
    situacaoCadastral: 'ativo',
    fotoUrl: '',
  });

  // Filter scoped list
  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((e) => e.empresaId === activeEmpresaId);
    }
    if (companyFilter !== 'todos') {
      list = list.filter((e) => e.empresaId === companyFilter);
    }
    if (statusFilter !== 'todos') {
      list = list.filter((e) => e.situacaoCadastral === statusFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (e) =>
          e.nomeCompleto.toLowerCase().includes(q) ||
          e.cpf.includes(q) ||
          (e.matricula && e.matricula.toLowerCase().includes(q)) ||
          e.empresaNome.toLowerCase().includes(q) ||
          e.cargo.toLowerCase().includes(q) ||
          e.setor.toLowerCase().includes(q)
      );
    }
    return list;
  }, [employees, isSolicitante, activeEmpresaId, companyFilter, statusFilter, searchTerm]);

  const handleOpenAddModal = () => {
    setEditingEmployee(null);
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    setFormData({
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      nomeCompleto: '',
      cpf: '',
      rg: '',
      dataNascimento: '',
      telefone: '',
      email: '',
      matricula: '',
      cargo: '',
      setor: '',
      atividadeExecutada: '',
      unidadeAlocacao: '',
      dataAdmissao: '',
      dataIntegracao: '',
      responsavelEmpresa: defaultEmp?.responsavelLegal || '',
      situacaoCadastral: 'ativo',
      fotoUrl: SAMPLE_AVATARS[0],
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormData({
      empresaId: emp.empresaId,
      empresaNome: emp.empresaNome,
      nomeCompleto: emp.nomeCompleto,
      cpf: emp.cpf,
      rg: emp.rg || '',
      dataNascimento: emp.dataNascimento || '',
      telefone: emp.telefone || '',
      email: emp.email || '',
      matricula: emp.matricula || '',
      cargo: emp.cargo,
      setor: emp.setor,
      atividadeExecutada: emp.atividadeExecutada || '',
      unidadeAlocacao: emp.unidadeAlocacao || '',
      dataAdmissao: emp.dataAdmissao || '',
      dataIntegracao: emp.dataIntegracao || '',
      responsavelEmpresa: emp.responsavelEmpresa || '',
      situacaoCadastral: emp.situacaoCadastral,
      fotoUrl: emp.fotoUrl || '',
    });
    setIsModalOpen(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('A fotografia deve ter até 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        if (uploadEvent.target?.result) {
          setFormData((prev) => ({ ...prev, fotoUrl: String(uploadEvent.target?.result) }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nomeCompleto || !formData.cpf || !formData.empresaId || !formData.cargo) {
      alert('Nome, CPF, Empresa e Cargo são obrigatórios.');
      return;
    }

    try {
      const targetEmpresaId = isSolicitante && activeEmpresaId ? activeEmpresaId : formData.empresaId;
      const selectedComp = companies.find((c) => c.id === targetEmpresaId);
      const payload = {
        ...formData,
        empresaId: targetEmpresaId,
        empresaNome: selectedComp ? selectedComp.razaoSocial : formData.empresaNome,
      };

      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, payload);
      } else {
        await addEmployee(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar os dados do colaborador.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para excluir colaboradores.');
      return;
    }
    if (confirm(`Confirma a exclusão do colaborador "${name}"?`)) {
      try {
        await deleteEmployee(id);
      } catch (err) {
        console.error(err);
        alert('Erro ao excluir colaborador.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="text-blue-500" />
            Cadastro Completo de Colaboradores
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Ficha individual, prontuário SST, exames ocupacionais, ASO, treinamentos e controle de EPI
          </p>
        </div>

        {(isAdmin || isSolicitante) && (
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
          >
            <Plus size={16} />
            + ADICIONAR COLABORADOR
          </button>
        )}
      </div>

      {/* Search & Filters (Section 6 Requirement: nome, CPF, matrícula, empresa, cargo e setor) */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Pesquisar por Nome, CPF, Matrícula, Empresa, Cargo ou Setor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isSolicitante && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[200px]"
            >
              <option value="todos">Todas as Empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia || c.razaoSocial}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todas as Situações</option>
            <option value="ativo">Ativo</option>
            <option value="afastado">Afastado</option>
            <option value="ferias">Férias</option>
            <option value="demitido">Demitido</option>
          </select>
        </div>
      </div>

      {/* Employees Grid with Photo Displays */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredEmployees.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <Users size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhum colaborador encontrado</p>
            <p className="text-xs text-slate-400 mt-1">Ajuste os filtros ou cadastre um novo colaborador.</p>
          </div>
        ) : (
          filteredEmployees.map((emp) => (
            <div
              key={emp.id}
              className="rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all flex flex-col justify-between shadow-sm"
            >
              <div>
                <div className="flex items-start gap-3.5">
                  {/* Photo Thumbnail */}
                  <div className="relative shrink-0">
                    {emp.fotoUrl ? (
                      <img
                        src={emp.fotoUrl}
                        alt={emp.nomeCompleto}
                        className="h-14 w-14 rounded-xl object-cover border border-slate-700 shadow-sm"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700">
                        <User size={24} />
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-slate-900 ${
                        emp.situacaoCadastral === 'ativo'
                          ? 'bg-emerald-500'
                          : emp.situacaoCadastral === 'ferias'
                          ? 'bg-blue-500'
                          : 'bg-amber-500'
                      }`}
                    />
                  </div>

                  {/* Name and Info */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white truncate">{emp.nomeCompleto}</h3>
                    <p className="text-xs text-blue-400 font-medium truncate mt-0.5">
                      {emp.cargo}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {emp.setor} • {emp.empresaNome}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">CPF:</span>
                    <span className="font-mono text-slate-200">{formatCPF(emp.cpf)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Matrícula:</span>
                    <span className="font-mono text-slate-200">{emp.matricula || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Admissão:</span>
                    <span className="text-slate-200">{formatDateBR(emp.dataAdmissao)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Integração:</span>
                    <span className="text-slate-200">{formatDateBR(emp.dataIntegracao)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => setSelectedDossierEmployee(emp)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold transition-colors"
                >
                  <Eye size={14} />
                  Ficha Individual
                </button>

                <div className="flex items-center gap-1">
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => handleOpenEditModal(emp)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                        title="Editar colaborador"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(emp.id, emp.nomeCompleto)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                        title="Excluir colaborador"
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

      {/* Add / Edit Employee Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users size={18} className="text-blue-500" />
                {editingEmployee ? 'Editar Ficha do Colaborador' : 'Cadastrar Novo Colaborador'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Photo Upload / Avatar Selection Section */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row items-center gap-4">
                <div className="relative">
                  {formData.fotoUrl ? (
                    <img
                      src={formData.fotoUrl}
                      alt="Foto Prévia"
                      className="h-20 w-20 rounded-2xl object-cover border-2 border-blue-500 shadow-md"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700">
                      <Camera size={28} />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 text-center sm:text-left">
                  <span className="text-xs font-semibold text-white block">Fotografia do Colaborador</span>
                  <p className="text-[11px] text-slate-400">
                    Selecione um arquivo de imagem (PNG, JPG) ou escolha um avatar padrão.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
                    <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer transition-colors">
                      <Upload size={13} />
                      Carregar Foto
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>

                    {SAMPLE_AVATARS.slice(0, 5).map((av, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setFormData({ ...formData, fotoUrl: av })}
                        className={`h-7 w-7 rounded-lg overflow-hidden border transition-all ${
                          formData.fotoUrl === av ? 'border-blue-400 ring-2 ring-blue-500' : 'border-slate-700 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img src={av} alt="Avatar" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Form Fields Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nome Completo <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nomeCompleto}
                    onChange={(e) => setFormData({ ...formData, nomeCompleto: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Nome e Sobrenome"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    CPF <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.cpf}
                    onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="000.000.000-00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">RG</label>
                  <input
                    type="text"
                    value={formData.rg}
                    onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Número e Órgão Emissor"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data de Nascimento</label>
                  <input
                    type="date"
                    value={formData.dataNascimento}
                    onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Matrícula</label>
                  <input
                    type="text"
                    value={formData.matricula}
                    onChange={(e) => setFormData({ ...formData, matricula: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: MAT-2026-01"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Empresa Contratada <span className="text-red-400">*</span>
                  </label>
                  {isSolicitante ? (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-2">
                        <Building2 size={15} className="text-blue-400 shrink-0" />
                        <span className="font-semibold text-white">
                          {companies.find((c) => c.id === (activeEmpresaId || formData.empresaId))?.razaoSocial || formData.empresaNome || 'Sua Empresa Contratada'}
                        </span>
                      </div>
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-medium">
                        Bloqueado para sua empresa
                      </span>
                    </div>
                  ) : (
                    <select
                      required
                      value={formData.empresaId}
                      onChange={(e) => {
                        const sel = companies.find((c) => c.id === e.target.value);
                        setFormData({
                          ...formData,
                          empresaId: e.target.value,
                          empresaNome: sel?.razaoSocial || '',
                          responsavelEmpresa: sel?.responsavelLegal || formData.responsavelEmpresa,
                        });
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Selecione a empresa vinculada...</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.razaoSocial} (CNPJ: {c.cnpj})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Situação Cadastral</label>
                  <select
                    value={formData.situacaoCadastral}
                    onChange={(e: any) => setFormData({ ...formData, situacaoCadastral: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="afastado">Afastado</option>
                    <option value="ferias">Férias</option>
                    <option value="demitido">Demitido</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Cargo / Função <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.cargo}
                    onChange={(e) => setFormData({ ...formData, cargo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Soldador TIG, Eletricista"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Setor</label>
                  <input
                    type="text"
                    value={formData.setor}
                    onChange={(e) => setFormData({ ...formData, setor: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Manutenção, SESMT"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Unidade de Alocação</label>
                  <input
                    type="text"
                    value={formData.unidadeAlocacao}
                    onChange={(e) => setFormData({ ...formData, unidadeAlocacao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: Planta Industrial RJ"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data de Admissão</label>
                  <input
                    type="date"
                    value={formData.dataAdmissao}
                    onChange={(e) => setFormData({ ...formData, dataAdmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Data de Integração SST</label>
                  <input
                    type="date"
                    value={formData.dataIntegracao}
                    onChange={(e) => setFormData({ ...formData, dataIntegracao: e.target.value })}
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
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Atividade Executada Detalhada</label>
                <textarea
                  rows={2}
                  value={formData.atividadeExecutada}
                  onChange={(e) => setFormData({ ...formData, atividadeExecutada: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Descreva as tarefas e operações executadas pelo colaborador..."
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
                  Salvar Colaborador
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Individual Dossier Modal */}
      {selectedDossierEmployee && (
        <EmployeeDossierModal
          employee={selectedDossierEmployee}
          onClose={() => setSelectedDossierEmployee(null)}
        />
      )}
    </div>
  );
};
