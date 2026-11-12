import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Edit2,
  Upload,
  X,
  ExternalLink,
  AlertTriangle,
  History,
  FileCheck,
  RefreshCw,
  Building2,
  User,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { DocumentSST, DocumentCategory, DocumentStatus } from '../../types/sst';
import { formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';

const CATEGORIES: DocumentCategory[] = [
  'Documento Empresarial',
  'Documento Individual',
  'ASO',
  'Treinamento',
  'Documento Ambiental',
  'Outros',
];

export const DocumentsView: React.FC = () => {
  const {
    documents,
    companies,
    employees,
    addDocument,
    updateDocument,
    approveDocument,
    rejectDocument,
    deleteDocument,
  } = useSST();

  const { isAdmin, isSolicitante, activeEmpresaId, profile } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [farolFilter, setFarolFilter] = useState<string>('todos');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentSST | null>(null);
  const [viewingHistoryDoc, setViewingHistoryDoc] = useState<DocumentSST | null>(null);

  // Approval / Rejection modal
  const [rejectingDoc, setRejectingDoc] = useState<DocumentSST | null>(null);
  const [motivoReprovacao, setMotivoReprovacao] = useState('');

  // Form states - CRITICAL: nomeDocumento is FREE TEXT and INITIALLY EMPTY
  const [formData, setFormData] = useState<Omit<DocumentSST, 'id'>>({
    nomeDocumento: '', // Campo livre e inicialmente em branco
    categoria: 'Documento Empresarial',
    empresaId: '',
    empresaNome: '',
    colaboradorId: '',
    colaboradorNome: '',
    numeroDocumento: '',
    dataEmissao: new Date().toISOString().split('T')[0],
    dataValidade: '',
    semValidade: false,
    responsavelEnvio: profile?.nome || 'Responsável',
    arquivoUrl: '',
    arquivoNome: '',
    observacoes: '',
    situacao: 'pendente',
    versao: 1,
  });

  // Filter scoped list
  const filteredDocuments = useMemo(() => {
    let list = documents;
    if (isSolicitante && activeEmpresaId) {
      list = list.filter((d) => d.empresaId === activeEmpresaId);
    }
    if (categoryFilter !== 'todos') {
      list = list.filter((d) => d.categoria === categoryFilter);
    }
    if (statusFilter !== 'todos') {
      list = list.filter((d) => d.situacao === statusFilter);
    }
    if (farolFilter !== 'todos') {
      list = list.filter(
        (d) => getTrafficLightStatus(d.dataValidade, d.semValidade, d.situacao).status === farolFilter
      );
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (d) =>
          d.nomeDocumento.toLowerCase().includes(q) ||
          d.empresaNome.toLowerCase().includes(q) ||
          (d.colaboradorNome && d.colaboradorNome.toLowerCase().includes(q)) ||
          (d.numeroDocumento && d.numeroDocumento.toLowerCase().includes(q))
      );
    }
    return list;
  }, [documents, isSolicitante, activeEmpresaId, categoryFilter, statusFilter, farolFilter, searchTerm]);

  const handleOpenAddModal = () => {
    setEditingDoc(null);
    const defaultEmp = isSolicitante && activeEmpresaId
      ? companies.find((c) => c.id === activeEmpresaId)
      : companies[0];

    setFormData({
      nomeDocumento: '', // LIVRE E INICIALMENTE EM BRANCO
      categoria: 'Documento Empresarial',
      empresaId: defaultEmp?.id || '',
      empresaNome: defaultEmp?.razaoSocial || '',
      colaboradorId: '',
      colaboradorNome: '',
      numeroDocumento: '',
      dataEmissao: new Date().toISOString().split('T')[0],
      dataValidade: '',
      semValidade: false,
      responsavelEnvio: profile?.nome || 'Responsável',
      arquivoUrl: '',
      arquivoNome: '',
      observacoes: '',
      situacao: 'pendente',
      versao: 1,
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (docItem: DocumentSST) => {
    setEditingDoc(docItem);
    setFormData({
      nomeDocumento: docItem.nomeDocumento,
      categoria: docItem.categoria,
      empresaId: docItem.empresaId,
      empresaNome: docItem.empresaNome,
      colaboradorId: docItem.colaboradorId || '',
      colaboradorNome: docItem.colaboradorNome || '',
      numeroDocumento: docItem.numeroDocumento || '',
      dataEmissao: docItem.dataEmissao || '',
      dataValidade: docItem.dataValidade || '',
      semValidade: !!docItem.semValidade,
      responsavelEnvio: docItem.responsavelEnvio,
      arquivoUrl: docItem.arquivoUrl,
      arquivoNome: docItem.arquivoNome,
      observacoes: docItem.observacoes || '',
      situacao: docItem.situacao,
      versao: docItem.versao,
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
            arquivoUrl: String(ev.target?.result),
            arquivoNome: file.name,
          }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nomeDocumento.trim()) {
      alert('Por favor, informe o nome do documento.');
      return;
    }
    if (!formData.empresaId) {
      alert('Selecione a empresa vinculada.');
      return;
    }

    try {
      const comp = companies.find((c) => c.id === formData.empresaId);
      const colab = employees.find((em) => em.id === formData.colaboradorId);

      const payload = {
        ...formData,
        empresaNome: comp ? comp.razaoSocial : formData.empresaNome,
        colaboradorNome: colab ? colab.nomeCompleto : '',
        responsavelEnvio: profile?.nome || formData.responsavelEnvio,
      };

      if (editingDoc) {
        // If re-submitting after rejection, automatically resets to 'pendente'
        if (editingDoc.situacao === 'reprovado') {
          payload.situacao = 'pendente';
        }
        await updateDocument(editingDoc.id, payload);
      } else {
        await addDocument(payload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar documento.');
    }
  };

  const handleApprove = async (id: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para aprovar documentos.');
      return;
    }
    try {
      await approveDocument(id);
    } catch (e) {
      console.error(e);
      alert('Erro ao aprovar documento.');
    }
  };

  const handleRejectConfirm = async () => {
    if (!motivoReprovacao.trim()) {
      alert('O motivo da reprovação é obrigatório.');
      return;
    }
    if (rejectingDoc) {
      try {
        await rejectDocument(rejectingDoc.id, motivoReprovacao);
        setRejectingDoc(null);
        setMotivoReprovacao('');
      } catch (e) {
        console.error(e);
        alert('Erro ao reprovar documento.');
      }
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!isAdmin) {
      alert('Apenas o Administrador SST tem autorização para excluir documentos.');
      return;
    }
    if (confirm(`Confirma a exclusão definitiva do documento "${name}"?`)) {
      try {
        await deleteDocument(id);
      } catch (e) {
        console.error(e);
        alert('Erro ao excluir documento.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="text-blue-500" />
            Gestão de Documentos e Conformidade Legal
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Cadastro com digitação livre de nomes, categorização flexível, versionamento e fluxo de aprovação
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all"
        >
          <Plus size={16} />
          Enviar Documento
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por Nome do Documento, Empresa, Colaborador ou Número..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todas as Categorias</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todas as Situações</option>
            <option value="aprovado">Aprovado</option>
            <option value="pendente">Pendente de Análise</option>
            <option value="reprovado">Reprovado</option>
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
            <option value="cinza">Farol Cinza (Pendente)</option>
          </select>
        </div>
      </div>

      {/* Documents Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Documento & Versão</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Empresa / Colaborador</th>
                <th className="px-4 py-3">Emissão & Validade</th>
                <th className="px-4 py-3">Farol SST</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    <FileText size={36} className="mx-auto text-slate-400 mb-2" />
                    Nenhum documento encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((docItem) => {
                  const farol = getTrafficLightStatus(
                    docItem.dataValidade,
                    docItem.semValidade,
                    docItem.situacao
                  );
                  return (
                    <tr key={docItem.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-white text-sm flex items-center gap-1.5">
                          {docItem.nomeDocumento}
                          <span className="text-[10px] font-mono px-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            v{docItem.versao || 1}
                          </span>
                        </div>
                        {docItem.numeroDocumento && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Doc: {docItem.numeroDocumento}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {docItem.categoria}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-200">{docItem.empresaNome}</div>
                        {docItem.colaboradorNome && (
                          <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                            Colab: {docItem.colaboradorNome}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-slate-300">
                          Emissão: {formatDateBR(docItem.dataEmissao)}
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Validade: {docItem.semValidade ? 'Sem Vencimento' : formatDateBR(docItem.dataValidade)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            docItem.situacao === 'aprovado'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : docItem.situacao === 'reprovado'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {docItem.situacao}
                        </span>
                        {docItem.motivoReprovacao && (
                          <p className="text-[10px] text-red-400 mt-0.5 max-w-[180px] truncate" title={docItem.motivoReprovacao}>
                            Motivo: {docItem.motivoReprovacao}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* File Preview */}
                          {docItem.arquivoUrl && (
                            <a
                              href={docItem.arquivoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-blue-400 hover:text-white rounded hover:bg-slate-800"
                              title="Visualizar Arquivo"
                            >
                              <FileText size={15} />
                            </a>
                          )}

                          {/* Version History Button */}
                          <button
                            onClick={() => setViewingHistoryDoc(docItem)}
                            className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                            title="Histórico de Versões"
                          >
                            <History size={15} />
                          </button>

                          {/* Approval / Rejection (Admin only, Section 14) */}
                          {isAdmin && docItem.situacao === 'pendente' && (
                            <>
                              <button
                                onClick={() => handleApprove(docItem.id)}
                                className="p-1.5 text-emerald-400 hover:text-white rounded hover:bg-emerald-600/20"
                                title="Aprovar Documento"
                              >
                                <CheckCircle size={15} />
                              </button>
                              <button
                                onClick={() => {
                                  setRejectingDoc(docItem);
                                  setMotivoReprovacao('');
                                }}
                                className="p-1.5 text-red-400 hover:text-white rounded hover:bg-red-600/20"
                                title="Reprovar Documento (informar motivo)"
                              >
                                <XCircle size={15} />
                              </button>
                            </>
                          )}

                          {/* Contractor re-send if rejected */}
                          {docItem.situacao === 'reprovado' && (
                            <button
                              onClick={() => handleOpenEditModal(docItem)}
                              className="p-1.5 text-amber-400 hover:text-white rounded hover:bg-amber-600/20"
                              title="Corrigir e Reenviar Documento"
                            >
                              <RefreshCw size={15} />
                            </button>
                          )}

                          {isAdmin && (
                            <>
                              <button
                                onClick={() => handleOpenEditModal(docItem)}
                                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                title="Editar"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(docItem.id, docItem.nomeDocumento)}
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

      {/* Add / Edit Document Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileText size={18} className="text-blue-500" />
                {editingDoc ? 'Editar / Reenviar Documento' : 'Cadastrar / Enviar Novo Documento'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* CRITICAL REQUIREMENT 9: NOME DO DOCUMENTO É CAMPO LIVRE E EM BRANCO */}
              <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30">
                <label className="block text-xs font-bold text-blue-300 mb-1">
                  Nome do Documento (Campo Livre) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.nomeDocumento}
                  onChange={(e) => setFormData({ ...formData, nomeDocumento: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-blue-500/50 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400"
                  placeholder="Digite livremente o nome (ex: PGR, PCMSO, Ordem de Serviço, Ficha de EPI, Licença Ambiental...)"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Atenção: Não há listas fixas de nomes. Digite qualquer denominação necessária.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Categoria do Registro <span className="text-red-400">*</span>
                  </label>
                  <select
                    required
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Número / Registro do Documento
                  </label>
                  <input
                    type="text"
                    value={formData.numeroDocumento}
                    onChange={(e) => setFormData({ ...formData, numeroDocumento: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="Ex: LA-2026/04, OS-NR01-08"
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
                    Colaborador Vinculado (Opcional)
                  </label>
                  <select
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
                    <option value="">Nenhum (Documento Geral da Empresa)</option>
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
                    Data de Emissão <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dataEmissao}
                    onChange={(e) => setFormData({ ...formData, dataEmissao: e.target.value })}
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
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Arquivo do Documento (PDF, Imagem ou Laudo)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-xs text-slate-300 cursor-pointer">
                  <Upload size={14} className="text-blue-400" />
                  <span className="truncate">
                    {formData.arquivoNome || 'Selecionar arquivo do documento...'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/*,.doc,.docx"
                    onChange={handleFileUpload}
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
                  placeholder="Informações adicionais para a equipe técnica..."
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
                  Submeter Documento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rejection Modal with Mandatory Reason (Section 14) */}
      {rejectingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-red-500/50 shadow-2xl p-6">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <span className="p-2 rounded-lg bg-red-500/20 text-red-400">
                <AlertTriangle size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Justificativa Obrigatória de Reprovação</h3>
                <p className="text-xs text-slate-400">
                  Documento: {rejectingDoc.nomeDocumento}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-300">
                O fluxo de aprovação de SST exige o preenchimento obrigatório da justificativa técnica para que a contratada saiba exatamente o que deve ser corrigido.
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
                  placeholder="Ex: Assinatura do responsável técnico ausente, data de validade divergente da ART..."
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectingDoc(null)}
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

      {/* Version History Modal */}
      {viewingHistoryDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <History size={18} className="text-blue-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Histórico de Versões e Decisões</h3>
                  <p className="text-xs text-slate-400">{viewingHistoryDoc.nomeDocumento}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingHistoryDoc(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {(!viewingHistoryDoc.historicoVersoes || viewingHistoryDoc.historicoVersoes.length === 0) ? (
                <p className="text-xs text-slate-400 italic text-center py-4">
                  Histórico detalhado inicial (Versão 1).
                </p>
              ) : (
                viewingHistoryDoc.historicoVersoes.map((v, i) => (
                  <div
                    key={i}
                    className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        Versão {v.versao}
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                            v.situacao === 'aprovado'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : v.situacao === 'reprovado'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {v.situacao}
                        </span>
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        {new Date(v.dataEnvio).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    <p className="text-slate-400">
                      Enviado por: <span className="text-slate-200">{v.responsavelEnvio}</span>
                    </p>

                    {v.analisadoPor && (
                      <p className="text-slate-400">
                        Analisado por: <span className="text-slate-200">{v.analisadoPor}</span> em{' '}
                        {v.dataAnalise ? new Date(v.dataAnalise).toLocaleString('pt-BR') : '-'}
                      </p>
                    )}

                    {v.motivoReprovacao && (
                      <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-[11px] mt-1">
                        <strong>Justificativa da Reprovação:</strong> {v.motivoReprovacao}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setViewingHistoryDoc(null)}
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
