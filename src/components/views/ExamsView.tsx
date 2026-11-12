import React, { useState, useMemo } from 'react';
import {
  HeartPulse,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  Trash2,
  Edit2,
  Upload,
  X,
  FileText,
  ShieldCheck,
  Building2,
  User,
  AlertTriangle,
  Lock,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { OccupationalExam, TipoExame, ConclusaoAptidao } from '../../types/sst';
import { formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';

const TIPOS_EXAME: TipoExame[] = [
  'ASO Admissional',
  'ASO Periódico',
  'ASO Retorno ao Trabalho',
  'ASO Mudança de Riscos Ocupacionais',
  'ASO Demissional',
  'Exame Complementar - Audiometria',
  'Exame Complementar - Espirometria',
  'Exame Complementar - Raio-X do Tórax OIT',
  'Exame Complementar - Acuidade Visual',
  'Exame Complementar - Eletrocardiograma (ECG)',
  'Exame Complementar - Eletroencefalograma (EEG)',
  'Exame Complementar - Toxicológico / Laboratorial',
];

export const ExamsView: React.FC = () => {
  const { exams, employees, companies, addExam, updateExam, deleteExam } = useSST();
  const { isAdmin, isSolicitante, activeEmpresaId } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState<string>('todos');
  const [conclusaoFilter, setConclusaoFilter] = useState<string>('todos');
  const [farolFilter, setFarolFilter] = useState<string>('todos');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<OccupationalExam | null>(null);

  // Intelligent Search for Empresa in Modal
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);

  // Form states
  const [formData, setFormData] = useState<Omit<OccupationalExam, 'id'>>({
    tipoExame: 'ASO Periódico',
    colaboradorId: '',
    colaboradorNome: '',
    empresaId: '',
    empresaNome: '',
    dataRealizacao: new Date().toISOString().split('T')[0],
    dataValidade: '',
    semValidade: false,
    medicoResponsavel: '',
    crmMedico: '',
    conclusao: 'apto',
    anexoUrl: '',
    anexoNome: '',
    observacoes: '',
    situacao: 'aprovado',
  });

  const filteredExams = useMemo(() => {
    let list = exams;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((e) => e.empresaId === activeEmpresaId);
    }
    if (tipoFilter !== 'todos') {
      list = list.filter((e) => e.tipoExame === tipoFilter);
    }
    if (conclusaoFilter !== 'todos') {
      list = list.filter((e) => e.conclusao === conclusaoFilter);
    }
    if (farolFilter !== 'todos') {
      list = list.filter(
        (e) => getTrafficLightStatus(e.dataValidade, e.semValidade, e.situacao).status === farolFilter
      );
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (e) =>
          e.colaboradorNome.toLowerCase().includes(q) ||
          e.empresaNome.toLowerCase().includes(q) ||
          e.tipoExame.toLowerCase().includes(q) ||
          (e.medicoResponsavel && e.medicoResponsavel.toLowerCase().includes(q))
      );
    }
    return list;
  }, [exams, isSolicitante, activeEmpresaId, tipoFilter, conclusaoFilter, farolFilter, searchTerm]);

  // Dynamic filter for company combobox search in modal
  const searchedCompanies = useMemo(() => {
    let list = companies;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((c) => c.id === activeEmpresaId);
    }
    if (!companySearchQuery.trim()) return list;
    const q = companySearchQuery.toLowerCase();
    const cleanQ = q.replace(/\D/g, '');
    return list.filter((c) => {
      const matchName = c.razaoSocial.toLowerCase().includes(q);
      const matchFantasy = c.nomeFantasia && c.nomeFantasia.toLowerCase().includes(q);
      const matchCnpj = cleanQ && cleanQ.length >= 2 ? c.cnpj.replace(/\D/g, '').includes(cleanQ) : c.cnpj.includes(q);
      return matchName || matchFantasy || matchCnpj;
    });
  }, [companies, companySearchQuery, isSolicitante, activeEmpresaId]);

  const handleOpenAddModal = () => {
    setEditingExam(null);
    setCompanySearchQuery('');
    setIsCompanyDropdownOpen(false);
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    const defaultColab = employees.find((e) => e.empresaId === defaultEmp?.id) || employees[0];

    // Default validity: 1 year from now for Periodic ASO
    const inOneYear = new Date();
    inOneYear.setFullYear(inOneYear.getFullYear() + 1);

    setFormData({
      tipoExame: 'ASO Periódico',
      colaboradorId: defaultColab?.id || '',
      colaboradorNome: defaultColab?.nomeCompleto || '',
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      dataRealizacao: new Date().toISOString().split('T')[0],
      dataValidade: inOneYear.toISOString().split('T')[0],
      semValidade: false,
      medicoResponsavel: 'Dr. Roberto Silveira',
      crmMedico: 'CRM/SP 124.580',
      conclusao: 'apto',
      anexoUrl: '',
      anexoNome: '',
      observacoes: 'Apto para atividades com risco ocupacional identificado no PGR.',
      situacao: 'aprovado',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (ex: OccupationalExam) => {
    setEditingExam(ex);
    setCompanySearchQuery('');
    setIsCompanyDropdownOpen(false);
    setFormData({
      tipoExame: ex.tipoExame,
      colaboradorId: ex.colaboradorId,
      colaboradorNome: ex.colaboradorNome,
      empresaId: ex.empresaId,
      empresaNome: ex.empresaNome,
      dataRealizacao: ex.dataRealizacao,
      dataValidade: ex.dataValidade || '',
      semValidade: !!ex.semValidade,
      medicoResponsavel: ex.medicoResponsavel || '',
      crmMedico: ex.crmMedico || '',
      conclusao: ex.conclusao,
      anexoUrl: ex.anexoUrl || '',
      anexoNome: ex.anexoNome || '',
      observacoes: ex.observacoes || '',
      situacao: ex.situacao,
    });
    setIsModalOpen(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setFormData((prev) => ({
            ...prev,
            anexoUrl: String(ev.target?.result),
            anexoNome: file.name,
          }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.colaboradorId || !formData.empresaId || !formData.dataRealizacao) {
      alert('Colaborador, empresa e data de realização são obrigatórios.');
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

      if (editingExam) {
        await updateExam(editingExam.id, payload);
      } else {
        await addExam(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar exame.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para excluir registros de exames.');
      return;
    }
    if (confirm(`Confirma a exclusão deste registro de exame (${name})?`)) {
      try {
        await deleteExam(id);
      } catch (e) {
        console.error(e);
        alert('Erro ao excluir exame.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <HeartPulse className="text-rose-500" />
            Gestão de Exames Ocupacionais e ASO (NR-07)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Controle de ASO Admissional, Periódico, Demissional, Retorno e Exames Complementares com sigilo médico
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
        >
          <Plus size={16} />
          Cadastrar Exame / ASO
        </button>
      </div>

      {/* LGPD Security Warning Box (Section 10 Requirement) */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-xs text-slate-300">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
          <Lock size={18} />
        </div>
        <div>
          <span className="font-semibold text-white">Sigilo Médico e Proteção de Dados (LGPD):</span>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Os dados de saúde e aptidão ocupacional são protegidos por sigilo profissional médico e restritos exclusivamente aos perfis autorizados de Gestão de EHS e Auditoria.
          </p>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Colaborador, Empresa, Tipo de Exame ou Médico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="todos">Todos os Tipos de Exame</option>
            {TIPOS_EXAME.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={conclusaoFilter}
            onChange={(e) => setConclusaoFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todas as Conclusões</option>
            <option value="apto">Apto</option>
            <option value="inapto">Inapto</option>
            <option value="apto_com_restricoes">Apto c/ Restrições</option>
          </select>

          <select
            value={farolFilter}
            onChange={(e) => setFarolFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Faróis</option>
            <option value="verde">Farol Verde (&gt; 30d)</option>
            <option value="amarelo">Farol Amarelo (≤ 30d)</option>
            <option value="vermelho">Farol Vermelho (Vencido)</option>
          </select>
        </div>
      </div>

      {/* Exams Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Tipo de Exame / ASO</th>
                <th className="px-4 py-3">Colaborador & Empresa</th>
                <th className="px-4 py-3">Realização & Validade</th>
                <th className="px-4 py-3">Médico Responsável</th>
                <th className="px-4 py-3">Aptidão</th>
                <th className="px-4 py-3">Farol SST</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredExams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    <HeartPulse size={36} className="mx-auto text-slate-400 mb-2" />
                    Nenhum exame ocupacional registrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredExams.map((ex) => {
                  const farol = getTrafficLightStatus(ex.dataValidade, ex.semValidade, ex.situacao);
                  return (
                    <tr key={ex.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white text-sm">{ex.tipoExame}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                          {ex.observacoes || 'Sem observações'}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-200">{ex.colaboradorNome}</div>
                        <div className="text-[11px] text-slate-400">{ex.empresaNome}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-slate-300">
                          Realizado: {formatDateBR(ex.dataRealizacao)}
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Validade: {ex.semValidade ? 'Sem Vencimento' : formatDateBR(ex.dataValidade)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-300">
                        <div>{ex.medicoResponsavel || 'Não informado'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{ex.crmMedico || '-'}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            ex.conclusao === 'apto'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : ex.conclusao === 'inapto'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {ex.conclusao}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {ex.anexoUrl && (
                            <a
                              href={ex.anexoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-blue-400 hover:text-white rounded hover:bg-slate-800"
                              title="Visualizar ASO Anexado"
                            >
                              <FileText size={15} />
                            </a>
                          )}

                          {isAdmin && (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(ex)}
                                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                title="Editar Exame"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(ex.id, ex.tipoExame)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-800"
                                title="Excluir Registro"
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

      {/* Add / Edit Exam Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <HeartPulse size={18} className="text-rose-500" />
                {editingExam ? 'Editar Registro de Exame Ocupacional' : 'Novo Exame Ocupacional / ASO'}
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
                    Tipo de Exame Ocupacional <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={formData.tipoExame}
                    onChange={(e) => setFormData({ ...formData, tipoExame: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {TIPOS_EXAME.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {tipo}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Conclusão Médica (Aptidão) <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={formData.conclusao}
                    onChange={(e: any) => setFormData({ ...formData, conclusao: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 font-bold"
                  >
                    <option value="apto">APTO</option>
                    <option value="inapto">INAPTO</option>
                    <option value="apto_com_restricoes">APTO COM RESTRIÇÕES</option>
                  </select>
                </div>

                {/* Empresa Contratada com Pesquisa Inteligente */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Empresa Contratada <span className="text-red-400">*</span>
                    </label>
                    {formData.empresaId && !isSolicitante && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, empresaId: '', empresaNome: '', colaboradorId: '', colaboradorNome: '' });
                          setIsCompanyDropdownOpen(true);
                          setCompanySearchQuery('');
                        }}
                        className="text-[10px] text-blue-400 hover:text-blue-300 underline font-medium"
                      >
                        Trocar Empresa
                      </button>
                    )}
                  </div>

                  {isSolicitante ? (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 flex items-center justify-between">
                      <span className="font-semibold text-white truncate">{formData.empresaNome || 'Sua Empresa'}</span>
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 shrink-0">
                        Vinculada ao Perfil
                      </span>
                    </div>
                  ) : formData.empresaId ? (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-blue-500/40 text-xs text-white flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 size={16} className="text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">{formData.empresaNome}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {companies.find((c) => c.id === formData.empresaId)?.cnpj || ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, empresaId: '', empresaNome: '', colaboradorId: '', colaboradorNome: '' });
                          setIsCompanyDropdownOpen(true);
                          setCompanySearchQuery('');
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
                        title="Limpar seleção"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Pesquisar por Razão Social, Fantasia ou CNPJ..."
                          value={companySearchQuery}
                          onFocus={() => setIsCompanyDropdownOpen(true)}
                          onChange={(e) => {
                            setCompanySearchQuery(e.target.value);
                            setIsCompanyDropdownOpen(true);
                          }}
                          className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
                          className="absolute right-2 top-2 p-1 text-slate-400 hover:text-white"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {isCompanyDropdownOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 custom-scrollbar">
                          {searchedCompanies.length === 0 ? (
                            <div className="p-3 text-center text-xs text-slate-400">
                              Nenhuma empresa encontrada para "{companySearchQuery}".
                            </div>
                          ) : (
                            searchedCompanies.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    empresaId: c.id,
                                    empresaNome: c.razaoSocial,
                                    colaboradorId: employees.some((emp) => emp.id === prev.colaboradorId && emp.empresaId === c.id)
                                      ? prev.colaboradorId
                                      : '',
                                    colaboradorNome: employees.some((emp) => emp.id === prev.colaboradorId && emp.empresaId === c.id)
                                      ? prev.colaboradorNome
                                      : '',
                                  }));
                                  setIsCompanyDropdownOpen(false);
                                  setCompanySearchQuery('');
                                }}
                                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800 transition-colors border-b border-slate-800/60 last:border-0 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white truncate">{c.razaoSocial}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                    {c.nomeFantasia && <span>Fantasia: {c.nomeFantasia}</span>}
                                    <span>CNPJ: {c.cnpj}</span>
                                  </div>
                                </div>
                                <span className="text-[10px] text-blue-400 font-bold px-1.5 py-0.5 rounded bg-blue-500/10 shrink-0">
                                  Selecionar
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <input
                    type="text"
                    required
                    readOnly
                    tabIndex={-1}
                    value={formData.empresaId}
                    className="opacity-0 h-0 w-0 absolute pointer-events-none"
                  />
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
                    Médico Responsável / Examinador
                  </label>
                  <input
                    type="text"
                    value={formData.medicoResponsavel}
                    onChange={(e) => setFormData({ ...formData, medicoResponsavel: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Nome do Médico"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    CRM do Médico
                  </label>
                  <input
                    type="text"
                    value={formData.crmMedico}
                    onChange={(e) => setFormData({ ...formData, crmMedico: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: CRM/SP 123456"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Anexo do ASO Assinado (PDF ou Imagem)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 cursor-pointer">
                  <Upload size={14} className="text-blue-400" />
                  <span className="truncate">
                    {formData.anexoNome || 'Selecionar atestado médico...'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Observações Médicas e Restrições Ocupacionais
                </label>
                <textarea
                  rows={2}
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  placeholder="Restrições ergonômicas, ruído, altura, espaço confinado, etc."
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
                  Salvar Exame Ocupacional
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
