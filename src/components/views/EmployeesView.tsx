import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  Eye,
  Edit2,
  Trash2,
  Building2,
  Camera,
  Upload,
  User,
  X,
  Layers,
  FileText,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { Employee } from '../../types/sst';
import { formatCPF, formatDateBR } from '../../utils/trafficLight';
import { EmployeeDossierModal } from './EmployeeDossierModal';

interface EmployeesViewProps {
  initialEmployeeId?: string | null;
}

const SAMPLE_AVATARS = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=300&fit=crop&crop=faces&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&fit=crop&crop=faces&q=80',
];

export const EmployeesView: React.FC<EmployeesViewProps> = ({ initialEmployeeId }) => {
  const {
    employees,
    companies,
    authorizedCompanies,
    effectiveAuthorizedEmpresaIds,
    documents,
    exams,
    trainings,
    activityProfiles,
    contractorIntegrations,
    addEmployee,
    updateEmployee,
    deleteEmployee,
  } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');

  const [selectedDossierEmployeeId, setSelectedDossierEmployeeId] = useState<string | null>(null);
  const [openUploadOnMount, setOpenUploadOnMount] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null
  );
  const [pendingDeleteEmployee, setPendingDeleteEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    if (initialEmployeeId && employees.some((e) => e.id === initialEmployeeId)) {
      setSelectedDossierEmployeeId(initialEmployeeId);
      setOpenUploadOnMount(false);
    }
  }, [initialEmployeeId, employees]);

  const selectedDossierEmployee = useMemo(
    () =>
      selectedDossierEmployeeId
        ? employees.find((e) => e.id === selectedDossierEmployeeId) || null
        : null,
    [employees, selectedDossierEmployeeId]
  );

  const activeActivities = useMemo(
    () => activityProfiles.filter((a) => a.ativo),
    [activityProfiles]
  );

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
    atividadesHabilitadasIds: [],
    unidadeAlocacao: '',
    dataAdmissao: '',
    dataIntegracao: '',
    responsavelEmpresa: '',
    situacaoCadastral: 'ativo',
    fotoUrl: '',
  });

  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (isSolicitante) {
      const allowedSet = new Set(effectiveAuthorizedEmpresaIds);
      list = list.filter((e) => allowedSet.has(e.empresaId));
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
  }, [employees, isSolicitante, effectiveAuthorizedEmpresaIds, companyFilter, statusFilter, searchTerm]);

  const docCountByEmployee = useMemo(() => {
    const map = new Map<string, { total: number; approved: number; pending: number; rejected: number }>();
    const bump = (empId: string | undefined, situacao: string) => {
      if (!empId) return;
      const cur = map.get(empId) || { total: 0, approved: 0, pending: 0, rejected: 0 };
      cur.total += 1;
      if (situacao === 'aprovado') cur.approved += 1;
      else if (situacao === 'pendente') cur.pending += 1;
      else if (situacao === 'reprovado') cur.rejected += 1;
      map.set(empId, cur);
    };
    documents.forEach((d) => bump(d.colaboradorId, d.situacao));
    exams.forEach((ex) => bump(ex.colaboradorId, ex.situacao));
    trainings.forEach((tr) => bump(tr.colaboradorId, tr.situacao));
    return map;
  }, [documents, exams, trainings]);

  const integrationStatusByEmployee = useMemo(() => {
    const map = new Map<string, { label: string; toneClass: string }>();
    for (const emp of employees) {
      const normCpf = emp.cpf.replace(/\D/g, '');
      const related = contractorIntegrations.filter(
        (integ) =>
          (integ.colaboradorIds || []).includes(emp.id) ||
          (integ.colaboradoresCandidatos || []).some(
            (nc) =>
              nc.aprovadoEmployeeId === emp.id ||
              nc.colaboradorId === emp.id ||
              (normCpf && nc.cpf && nc.cpf.replace(/\D/g, '') === normCpf)
          )
      );
      if (related.length === 0) {
        map.set(emp.id, {
          label: 'Sem Integração',
          toneClass: 'bg-slate-800 text-slate-400 border border-slate-700',
        });
        continue;
      }
      if (related.some((r) => r.status === 'APROVADA')) {
        map.set(emp.id, {
          label: 'Integrado',
          toneClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
        });
      } else if (related.some((r) => r.status === 'REPROVADA' || r.status === 'PENDENTE_CORRECAO')) {
        map.set(emp.id, {
          label: 'Correção Necessária',
          toneClass: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
        });
      } else if (related.some((r) => r.status === 'AGUARDANDO_ANALISE' || r.status === 'EM_ANALISE')) {
        map.set(emp.id, {
          label: 'Em Análise EHS',
          toneClass: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
        });
      } else {
        map.set(emp.id, {
          label: 'Rascunho / Pendente',
          toneClass: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
        });
      }
    }
    return map;
  }, [employees, contractorIntegrations]);

  const handleOpenAddModal = () => {
    setFeedback(null);
    setEditingEmployee(null);
    const selectableCompanies = isSolicitante ? authorizedCompanies : companies;
    const defaultEmp =
      (isSolicitante && companyFilter !== 'todos'
        ? selectableCompanies.find((c) => c.id === companyFilter)
        : undefined) ||
      (isSolicitante && activeEmpresaId
        ? selectableCompanies.find((c) => c.id === activeEmpresaId)
        : undefined) ||
      selectableCompanies.find((c) => c.situacao === 'ativa') ||
      selectableCompanies[0];

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
      atividadesHabilitadasIds: [],
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
    setFeedback(null);
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
      atividadesHabilitadasIds: [...(emp.atividadesHabilitadasIds || [])],
      unidadeAlocacao: emp.unidadeAlocacao || '',
      dataAdmissao: emp.dataAdmissao || '',
      dataIntegracao: emp.dataIntegracao || '',
      responsavelEmpresa: emp.responsavelEmpresa || '',
      situacaoCadastral: emp.situacaoCadastral,
      fotoUrl: emp.fotoUrl || '',
    });
    setIsModalOpen(true);
  };

  const toggleEnabledActivity = (actId: string) => {
    setFormData((prev) => {
      const current = prev.atividadesHabilitadasIds || [];
      return {
        ...prev,
        atividadesHabilitadasIds: current.includes(actId)
          ? current.filter((id) => id !== actId)
          : [...current, actId],
      };
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 700 * 1024) {
        setFeedback({ type: 'error', message: 'A fotografia deve ter no máximo 700 KB.' });
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
    setFeedback(null);
    if (
      !formData.nomeCompleto.trim() ||
      !formData.cpf.trim() ||
      !formData.empresaId ||
      !formData.cargo.trim()
    ) {
      setFeedback({
        type: 'error',
        message: 'Nome completo, CPF, Empresa Contratada e Cargo/Função são obrigatórios.',
      });
      return;
    }

    try {
      const targetEmpresaId = isSolicitante
        ? effectiveAuthorizedEmpresaIds.includes(formData.empresaId)
          ? formData.empresaId
          : effectiveAuthorizedEmpresaIds[0] || ''
        : formData.empresaId;
      const selectedComp = companies.find((c) => c.id === targetEmpresaId);
      if (!selectedComp) {
        setFeedback({
          type: 'error',
          message:
            'Vincule obrigatoriamente o colaborador terceirizado a uma empresa contratada cadastrada e autorizada.',
        });
        return;
      }

      const payload: Omit<Employee, 'id'> = {
        ...formData,
        empresaId: targetEmpresaId,
        empresaNome: selectedComp.razaoSocial,
        atividadesHabilitadasIds: formData.atividadesHabilitadasIds || [],
      };

      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, payload);
        setFeedback({
          type: 'success',
          message: `Colaborador "${payload.nomeCompleto}" atualizado.`,
        });
      } else {
        await addEmployee(payload);
        setFeedback({
          type: 'success',
          message: `Colaborador terceirizado "${payload.nomeCompleto}" cadastrado.`,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao salvar os dados do colaborador.',
      });
    }
  };

  const confirmDeleteEmployee = async () => {
    if (!pendingDeleteEmployee) return;
    if (!isAdmin) {
      setFeedback({
        type: 'error',
        message: 'Apenas o Administrador EHS tem autorização para excluir colaboradores.',
      });
      setPendingDeleteEmployee(null);
      return;
    }
    try {
      await deleteEmployee(pendingDeleteEmployee.id);
      if (selectedDossierEmployeeId === pendingDeleteEmployee.id) {
        setSelectedDossierEmployeeId(null);
      }
      setFeedback({
        type: 'success',
        message: `Colaborador "${pendingDeleteEmployee.nomeCompleto}" removido.`,
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({
        type: 'error',
        message: err?.message || 'Erro ao excluir colaborador.',
      });
    } finally {
      setPendingDeleteEmployee(null);
    }
  };

  const openDossier = (emp: Employee, openUpload = false) => {
    setSelectedDossierEmployeeId(emp.id);
    setOpenUploadOnMount(openUpload);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="text-blue-500" />
            {isSolicitante ? 'Meus Colaboradores' : 'Colaboradores'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isSolicitante
              ? 'Gerencie seus colaboradores, acesse o dossiê individual e envie documentos, exames (ASO) ou treinamentos individualmente (sem mínimo de arquivos).'
              : 'Visualização em lista dos colaboradores terceirizados. Selecione um colaborador para abrir a ficha individual, documentos e histórico de avaliações.'}
          </p>
        </div>

        {(isAdmin || (isSolicitante && effectiveAuthorizedEmpresaIds.length > 0)) && (
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
          >
            <Plus size={16} />
            Adicionar Colaborador
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

      {/* Search & Filters */}
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
          {(!isSolicitante || authorizedCompanies.length > 1) && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[220px]"
            >
              <option value="todos">
                {isSolicitante ? 'Todas as Minhas Empresas' : 'Todas as Empresas'}
              </option>
              {(isSolicitante ? authorizedCompanies : companies).map((c) => (
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
            <option value="todos">Todas as Situações ({filteredEmployees.length})</option>
            <option value="ativo">Ativo</option>
            <option value="afastado">Afastado</option>
            <option value="ferias">Férias</option>
            <option value="demitido">Demitido</option>
          </select>
        </div>
      </div>

      {/* Employees List / Table View */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        {filteredEmployees.length === 0 ? (
          <div className="py-12 text-center">
            <Users size={40} className="mx-auto text-slate-500 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhum colaborador encontrado</p>
            <p className="text-xs text-slate-400 mt-1">
              Ajuste os filtros ou cadastre um novo colaborador.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Colaborador</th>
                  <th className="py-3 px-4">CPF / Matrícula</th>
                  <th className="py-3 px-4">Cargo / Setor</th>
                  {(!isSolicitante || authorizedCompanies.length > 1) && (
                    <th className="py-3 px-4">Empresa</th>
                  )}
                  <th className="py-3 px-4">Situação / Integração</th>
                  <th className="py-3 px-4">Documentação</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs">
                {filteredEmployees.map((emp) => {
                  const counts = docCountByEmployee.get(emp.id) || {
                    total: 0,
                    approved: 0,
                    pending: 0,
                    rejected: 0,
                  };
                  const integStatus = integrationStatusByEmployee.get(emp.id) || {
                    label: 'Sem Integração',
                    toneClass: 'bg-slate-800 text-slate-400 border border-slate-700',
                  };
                  const canEditOwn =
                    isSolicitante && effectiveAuthorizedEmpresaIds.includes(emp.empresaId);

                  return (
                    <tr
                      key={emp.id}
                      onClick={() => openDossier(emp, false)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {emp.fotoUrl ? (
                            <img
                              src={emp.fotoUrl}
                              alt={emp.nomeCompleto}
                              className="h-9 w-9 rounded-lg object-cover border border-slate-700 shrink-0"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700 shrink-0">
                              <User size={16} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate max-w-[200px]">
                              {emp.nomeCompleto}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Admissão: {formatDateBR(emp.dataAdmissao)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-slate-200">{formatCPF(emp.cpf)}</div>
                        {emp.matricula && (
                          <div className="text-[10px] font-mono text-slate-500">
                            Mat: {emp.matricula}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium text-blue-300">{emp.cargo}</div>
                        <div className="text-[11px] text-slate-400">{emp.setor || '—'}</div>
                      </td>

                      {(!isSolicitante || authorizedCompanies.length > 1) && (
                        <td className="py-3 px-4 text-slate-300 max-w-[180px] truncate">
                          {emp.empresaNome}
                        </td>
                      )}

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              emp.situacaoCadastral === 'ativo'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : emp.situacaoCadastral === 'ferias'
                                ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                                : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            }`}
                          >
                            {emp.situacaoCadastral}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${integStatus.toneClass}`}>
                            {integStatus.label}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-slate-300 tabular-nums">
                            <FileText size={13} className="text-slate-400" />
                            {counts.approved}/{counts.total} aprov.
                          </span>
                          {counts.pending > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold">
                              {counts.pending} pendente(s)
                            </span>
                          )}
                          {counts.rejected > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-bold">
                              {counts.rejected} recusado(s)
                            </span>
                          )}
                        </div>
                      </td>

                      <td
                        className="py-3 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {(isSolicitante && canEditOwn) && (
                            <button
                              type="button"
                              onClick={() => openDossier(emp, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/30 text-emerald-300 hover:text-white text-xs font-semibold transition-colors"
                              title="Enviar documento individual, ASO ou treinamento"
                            >
                              <Upload size={12} />
                              Enviar Doc
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openDossier(emp, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold transition-colors"
                          >
                            <Eye size={13} />
                            Dossiê
                          </button>

                          {(isAdmin || canEditOwn) && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(emp)}
                              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                              title="Editar colaborador"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteEmployee(emp)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                              title="Excluir colaborador"
                            >
                              <Trash2 size={14} />
                            </button>
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
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Photo Upload */}
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
                  <span className="text-xs font-semibold text-white block">
                    Fotografia do Colaborador
                  </span>
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
                    {SAMPLE_AVATARS.map((av, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setFormData({ ...formData, fotoUrl: av })}
                        className={`h-7 w-7 rounded-lg overflow-hidden border transition-all ${
                          formData.fotoUrl === av
                            ? 'border-blue-400 ring-2 ring-blue-500'
                            : 'border-slate-700 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img src={av} alt="Avatar" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fields */}
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
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
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
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    placeholder="000.000.000-00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">RG</label>
                  <input
                    type="text"
                    value={formData.rg}
                    onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Data de Nascimento
                  </label>
                  <input
                    type="date"
                    value={formData.dataNascimento}
                    onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Matrícula</label>
                  <input
                    type="text"
                    value={formData.matricula}
                    onChange={(e) => setFormData({ ...formData, matricula: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Empresa Contratada <span className="text-red-400">*</span>
                  </label>
                  {isSolicitante && authorizedCompanies.length <= 1 ? (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 size={15} className="text-blue-400 shrink-0" />
                        <span className="font-semibold text-white">
                          {authorizedCompanies[0]?.razaoSocial ||
                            formData.empresaNome ||
                            'Sua Empresa'}
                        </span>
                      </div>
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        Vinculado à sua empresa
                      </span>
                    </div>
                  ) : (
                    <select
                      required
                      value={formData.empresaId}
                      onChange={(e) => {
                        const pool = isSolicitante ? authorizedCompanies : companies;
                        const sel = pool.find((c) => c.id === e.target.value);
                        setFormData({
                          ...formData,
                          empresaId: e.target.value,
                          empresaNome: sel?.razaoSocial || '',
                          responsavelEmpresa: sel?.responsavelLegal || formData.responsavelEmpresa,
                        });
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    >
                      <option value="">Selecione a empresa vinculada...</option>
                      {(isSolicitante ? authorizedCompanies : companies).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.razaoSocial} (CNPJ: {c.cnpj})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Situação Cadastral
                  </label>
                  <select
                    value={formData.situacaoCadastral}
                    onChange={(e: any) =>
                      setFormData({ ...formData, situacaoCadastral: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
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
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Setor</label>
                  <input
                    type="text"
                    value={formData.setor}
                    onChange={(e) => setFormData({ ...formData, setor: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Unidade de Alocação
                  </label>
                  <input
                    type="text"
                    value={formData.unidadeAlocacao}
                    onChange={(e) => setFormData({ ...formData, unidadeAlocacao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Data de Admissão
                  </label>
                  <input
                    type="date"
                    value={formData.dataAdmissao}
                    onChange={(e) => setFormData({ ...formData, dataAdmissao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Data de Integração SST
                  </label>
                  <input
                    type="date"
                    value={formData.dataIntegracao}
                    onChange={(e) => setFormData({ ...formData, dataIntegracao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
              </div>

              {/* Atividades Críticas Habilitadas */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Layers size={14} className="text-blue-400" />
                    Atividades Críticas Habilitadas (Matriz EHS)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {(formData.atividadesHabilitadasIds || []).length} selecionada(s)
                  </span>
                </div>
                {activeActivities.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Nenhuma atividade crítica ativa cadastrada na Matriz EHS.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeActivities.map((act) => {
                      const checked = (formData.atividadesHabilitadasIds || []).includes(act.id);
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
                            onChange={() => toggleEnabledActivity(act.id)}
                            className="mt-0.5 rounded bg-slate-950 border-slate-700 text-blue-600"
                          />
                          <div className="min-w-0">
                            <span className="font-semibold block truncate">{act.nome}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {act.codigo}
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
                  Atividade Executada Detalhada
                </label>
                <textarea
                  rows={2}
                  value={formData.atividadeExecutada}
                  onChange={(e) =>
                    setFormData({ ...formData, atividadeExecutada: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
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
                  Salvar Colaborador
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inline Delete Confirmation Modal */}
      {pendingDeleteEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Exclusão</h3>
                <p className="text-xs text-slate-400">
                  Remover cadastro do colaborador terceirizado.
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-300">
              Confirma a exclusão de{' '}
              <span className="font-semibold text-white">
                {pendingDeleteEmployee.nomeCompleto}
              </span>
              ?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPendingDeleteEmployee(null)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteEmployee}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Individual Dossier Modal */}
      {selectedDossierEmployee && (
        <EmployeeDossierModal
          employee={selectedDossierEmployee}
          openUploadOnMount={openUploadOnMount}
          onClose={() => {
            setSelectedDossierEmployeeId(null);
            setOpenUploadOnMount(false);
          }}
        />
      )}
    </div>
  );
};
