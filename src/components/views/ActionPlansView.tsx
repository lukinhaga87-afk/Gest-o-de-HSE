import React, { useState } from 'react';
import {
  Target,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  X,
  Search,
  Edit3,
  MessageSquare,
  Trash2,
  Send,
  Calendar,
  User as UserIcon,
  Check,
  FileText,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { ActionPlan, ActionPlanComment, ActionPlanStatus } from '../../types/sst';
import { formatDateBR } from '../../utils/trafficLight';

export const ActionPlansView: React.FC = () => {
  const { actionPlans, addActionPlan, updateActionPlan, deleteActionPlan } = useSST();
  const { canEdit, profile, isAdmin, isSolicitante, activeEmpresaId, activeEmpresaNome } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ActionPlan | null>(null);
  const [commentsPlan, setCommentsPlan] = useState<ActionPlan | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New action plan form state
  const [formData, setFormData] = useState<Omit<ActionPlan, 'id'>>({
    origem: 'Inspeção de Campo',
    descricaoAcao: '',
    responsavel: profile?.nome || 'Responsável EHS',
    prazo: new Date().toISOString().split('T')[0],
    status: 'pendente',
    observacoes: '',
    comentarios: [],
  });

  // Edit action plan form state
  const [editFormData, setEditFormData] = useState<{
    origem: string;
    descricaoAcao: string;
    responsavel: string;
    prazo: string;
    observacoes: string;
    status: ActionPlanStatus;
  }>({
    origem: '',
    descricaoAcao: '',
    responsavel: '',
    prazo: '',
    observacoes: '',
    status: 'pendente',
  });

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMessage({ text, type });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  const filtered = actionPlans.filter((plan) => {
    if (statusFilter !== 'todos') {
      if (statusFilter === 'concluido' && plan.status !== 'concluido') return false;
      if (
        statusFilter === 'pendente' &&
        plan.status !== 'pendente' &&
        plan.status !== 'em_andamento' &&
        plan.status !== 'a_iniciar' &&
        plan.status !== 'atrasado'
      )
        return false;
      if (statusFilter === 'cancelada' && plan.status !== 'cancelada') return false;
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        plan.descricaoAcao.toLowerCase().includes(q) ||
        plan.responsavel.toLowerCase().includes(q) ||
        plan.origem.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleOpenCreateModal = () => {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 15);

    setFormData({
      origem: 'Inspeção de Campo',
      descricaoAcao: '',
      responsavel: profile?.nome || 'Responsável EHS',
      prazo: nextDate.toISOString().split('T')[0],
      status: 'pendente',
      observacoes: '',
      empresaId: isSolicitante && activeEmpresaId ? activeEmpresaId : undefined,
      empresaNome: isSolicitante && activeEmpresaNome ? activeEmpresaNome : undefined,
      comentarios: [],
    });
    setIsCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.descricaoAcao.trim() || !formData.responsavel.trim()) {
      showFeedback('Descrição e responsável são obrigatórios.', 'error');
      return;
    }

    try {
      await addActionPlan({
        ...formData,
        empresaId: isSolicitante && activeEmpresaId ? activeEmpresaId : formData.empresaId,
        empresaNome: isSolicitante && activeEmpresaNome ? activeEmpresaNome : formData.empresaNome,
        status: isAdmin ? formData.status : 'pendente',
      });
      setIsCreateModalOpen(false);
      showFeedback('Plano de ação criado com sucesso!');
    } catch (e) {
      console.error(e);
      showFeedback('Erro ao cadastrar plano de ação.', 'error');
    }
  };

  const handleOpenEditModal = (plan: ActionPlan) => {
    setEditingPlan(plan);
    setEditFormData({
      origem: plan.origem,
      descricaoAcao: plan.descricaoAcao,
      responsavel: plan.responsavel,
      prazo: plan.prazo,
      observacoes: plan.observacoes || '',
      status: plan.status,
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    if (!editFormData.descricaoAcao.trim() || !editFormData.responsavel.trim()) {
      showFeedback('Descrição e responsável são obrigatórios.', 'error');
      return;
    }

    try {
      await updateActionPlan(editingPlan.id, {
        origem: editFormData.origem,
        descricaoAcao: editFormData.descricaoAcao.trim(),
        responsavel: editFormData.responsavel.trim(),
        prazo: editFormData.prazo,
        observacoes: editFormData.observacoes.trim(),
        ...(isAdmin ? { status: editFormData.status } : {}),
      });
      setEditingPlan(null);
      showFeedback('Plano de ação atualizado com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('Erro ao atualizar plano de ação.', 'error');
    }
  };

  // Status control: ONLY ADMINISTRATOR is permitted to change status
  const handleUpdateStatus = async (plan: ActionPlan, newStatus: ActionPlanStatus) => {
    if (!isAdmin) {
      showFeedback('Somente o perfil Administrador pode alterar o status das ações.', 'error');
      return;
    }
    try {
      await updateActionPlan(plan.id, { status: newStatus });
      const statusLabels: Record<string, string> = {
        concluido: 'Ação marcada como Concluída!',
        pendente: 'Ação retornada para Pendente (Acompanhamento)!',
      };
      showFeedback(statusLabels[newStatus] || 'Status atualizado com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('Erro ao atualizar status da ação.', 'error');
    }
  };

  // BOTÃO CANCELAR: Exclui a ação do sistema após confirmação. Somente Administrador.
  const handleCancelAndExcludeAction = async (plan: ActionPlan) => {
    if (!isAdmin) {
      showFeedback('Somente o perfil Administrador pode cancelar/excluir ações.', 'error');
      return;
    }

    const confirmed = window.confirm(
      `Deseja realmente cancelar e excluir a ação "${plan.descricaoAcao}"?\n\nApós a confirmação, a ação será removida do sistema e registrada no histórico administrativo.`
    );

    if (!confirmed) return;

    try {
      await deleteActionPlan(plan.id);
      showFeedback('Ação cancelada e excluída com sucesso do sistema.');
    } catch (err) {
      console.error(err);
      showFeedback('Erro ao cancelar ação.', 'error');
    }
  };

  const handleOpenCommentsModal = (plan: ActionPlan) => {
    const current = actionPlans.find((p) => p.id === plan.id) || plan;
    setCommentsPlan(current);
    setNewCommentText('');
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsPlan || !newCommentText.trim()) return;

    setIsSubmittingComment(true);
    try {
      const newComment: ActionPlanComment = {
        id: `cmt_${Date.now()}`,
        autor: profile?.nome || 'Usuário EHS',
        autorCpf: profile?.cpf,
        dataHora: new Date().toISOString(),
        texto: newCommentText.trim(),
      };

      const existingComments = commentsPlan.comentarios || [];
      const updatedComments = [...existingComments, newComment];

      await updateActionPlan(commentsPlan.id, {
        comentarios: updatedComments,
      });

      setCommentsPlan({
        ...commentsPlan,
        comentarios: updatedComments,
      });
      setNewCommentText('');
      showFeedback('Comentário registrado no histórico!');
    } catch (err) {
      console.error(err);
      showFeedback('Erro ao registrar comentário.', 'error');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeletePlan = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteActionPlan(id);
      showFeedback('Plano de ação excluído com sucesso.');
    } catch (err) {
      console.error(err);
      showFeedback('Erro ao excluir plano de ação.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback banner */}
      {feedbackMessage && (
        <div
          className={`px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          <span>{feedbackMessage.text}</span>
          <button onClick={() => setFeedbackMessage(null)} className="text-slate-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Target className="text-purple-400" />
            Planos de Ação e Tratamento de Desvios (5W2H)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gestão e acompanhamento de planos de ação (5W2H) com controle de status exclusivo para administradores.
          </p>
        </div>

        {canEdit && (
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all cursor-pointer"
          >
            <Plus size={16} />
            Novo Plano de Ação
          </button>
        )}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar ação, responsável ou origem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">Filtrar:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="todos">Todos os Status</option>
            <option value="concluido">🟢 Concluído (Verde)</option>
            <option value="pendente">🟡 Pendente (Amarelo)</option>
            <option value="cancelada">🔴 Cancelada (Vermelho)</option>
          </select>
        </div>
      </div>

      {/* List of Action Plans */}
      <div className="space-y-3.5">
        {filtered.length === 0 ? (
          <div className="py-12 text-center bg-slate-900 rounded-xl border border-slate-800">
            <Target size={40} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">Nenhum plano de ação encontrado</p>
            <p className="text-xs text-slate-400 mt-1">Crie um novo plano com descrição, responsável e evidência obrigatória.</p>
          </div>
        ) : (
          filtered.map((item) => {
            const commentsCount = item.comentarios?.length || 0;
            const isConcluido = item.status === 'concluido';
            const isPendente =
              item.status === 'pendente' ||
              item.status === 'em_andamento' ||
              item.status === 'a_iniciar' ||
              item.status === 'atrasado';
            const isCancelada = item.status === 'cancelada';

            return (
              <div
                key={item.id}
                className={`p-4 rounded-xl bg-slate-900 border transition-all flex flex-col gap-3.5 ${
                  isConcluido
                    ? 'border-emerald-500/40 hover:border-emerald-500/70'
                    : isCancelada
                    ? 'border-red-500/40 hover:border-red-500/70 opacity-80'
                    : 'border-amber-500/40 hover:border-amber-500/70'
                }`}
              >
                {/* Top Row: Tag, Status Badge, Comments, Title & Action Buttons */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/25">
                      {item.origem}
                    </span>

                    {/* Status Badge */}
                    <span
                      className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded flex items-center gap-1 ${
                        isConcluido
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : isCancelada
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {isConcluido && <CheckCircle2 size={11} />}
                      {isPendente && <Clock size={11} />}
                      {isCancelada && <XCircle size={11} />}
                      {isConcluido ? 'Concluído' : isCancelada ? 'Cancelada' : 'Pendente'}
                    </span>

                    {commentsCount > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                        <MessageSquare size={10} className="text-blue-400" />
                        {commentsCount} {commentsCount === 1 ? 'comentário' : 'comentários'}
                      </span>
                    )}
                  </div>

                  {/* Status Buttons: EXCLUSIVE for ADMINISTRATOR */}
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 flex-wrap self-end md:self-auto">
                      {/* BOTÃO CONCLUÍDO */}
                      <button
                        onClick={() => handleUpdateStatus(item, 'concluido')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isConcluido
                            ? 'bg-emerald-600 text-white border border-emerald-400 shadow-md shadow-emerald-600/30'
                            : 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white'
                        }`}
                        title="Concluir ação (Fechar ação)"
                      >
                        <CheckCircle2 size={13} />
                        <span>Concluído</span>
                      </button>

                      {/* BOTÃO PENDENTE */}
                      <button
                        onClick={() => handleUpdateStatus(item, 'pendente')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          isPendente
                            ? 'bg-amber-500 text-slate-950 border border-amber-300 shadow-md shadow-amber-500/30 font-extrabold'
                            : 'bg-amber-950/40 text-amber-300 border border-amber-500/40 hover:bg-amber-500 hover:text-slate-950'
                        }`}
                        title="Retornar ação para Pendente (Acompanhamento)"
                      >
                        <Clock size={13} />
                        <span>Pendente</span>
                      </button>

                      {/* BOTÃO CANCELAR */}
                      <button
                        onClick={() => handleCancelAndExcludeAction(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer bg-red-950/40 text-red-300 border border-red-500/40 hover:bg-red-600 hover:text-white"
                        title="Cancelar e excluir ação do sistema"
                      >
                        <XCircle size={13} />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Main Action Description */}
                <div>
                  <h3
                    className={`text-sm font-semibold break-words ${
                      isConcluido
                        ? 'line-through text-slate-400'
                        : isCancelada
                        ? 'line-through text-red-400/80'
                        : 'text-white'
                    }`}
                  >
                    {item.descricaoAcao}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <UserIcon size={12} className="text-slate-400" />
                      Responsável: <strong className="text-slate-300 font-medium">{item.responsavel}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={12} className="text-slate-400" />
                      Prazo: <span className="font-mono text-slate-300">{formatDateBR(item.prazo)}</span>
                    </span>
                  </div>

                  {item.observacoes && (
                    <p className="text-[11px] text-slate-400 mt-1.5 italic bg-slate-950/40 px-2 py-1 rounded border border-slate-800">
                      <span className="font-semibold text-slate-300 not-italic">Obs:</span> {item.observacoes}
                    </p>
                  )}
                </div>

                {/* Bottom Bar: Comentários e Editar */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <button
                    onClick={() => handleOpenCommentsModal(item)}
                    className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
                  >
                    <MessageSquare size={14} />
                    <span>Ver Comentários ({commentsCount})</span>
                  </button>

                  {canEdit && (
                    <button
                      onClick={() => handleOpenEditModal(item)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
                      title="Editar dados da ação"
                    >
                      <Edit3 size={13} className="text-blue-400" />
                      <span>Editar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Criar Plano de Ação (Com Evidência Obrigatória *) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus size={18} className="text-blue-400" />
                Criar Plano de Ação 5W2H
              </h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Origem da Demanda</label>
                  <select
                    value={formData.origem}
                    onChange={(e) => setFormData({ ...formData, origem: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="Inspeção de Campo">Inspeção de Campo</option>
                    <option value="Auditoria SST">Auditoria SST</option>
                    <option value="Investigação de Acidente">Investigação de Acidente</option>
                    <option value="Registro de Desvio">Registro de Desvio</option>
                    <option value="Exigência Legal / NR">Exigência Legal / NR</option>
                    <option value="Auditoria Ambiental">Auditoria Ambiental</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Prazo Limite</label>
                  <input
                    type="date"
                    required
                    value={formData.prazo}
                    onChange={(e) => setFormData({ ...formData, prazo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  O que será feito (Descrição da Ação) <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={formData.descricaoAcao}
                  onChange={(e) => setFormData({ ...formData, descricaoAcao: e.target.value })}
                  placeholder="Ex: Instalar linha de vida e rodapé padrão NR-18 no mezanino leste..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Observações / Acompanhamento
                </label>
                <textarea
                  rows={2}
                  value={formData.observacoes || ''}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="Orientações de campo, detalhes adicionais ou marcos operacionais..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Quem fará (Responsável) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.responsavel}
                    onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Status Inicial</label>
                  {isAdmin ? (
                    <select
                      value={formData.status}
                      onChange={(e: any) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="pendente">🟡 Pendente (Amarelo)</option>
                      <option value="concluido">🟢 Concluído (Verde)</option>
                      <option value="cancelada">🔴 Cancelada (Vermelho)</option>
                    </select>
                  ) : (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800 text-slate-300 font-medium">
                      🟡 Pendente (Ação Aberta)
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors shadow-md shadow-blue-600/30"
                >
                  Criar Ação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Plano de Ação */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 size={18} className="text-blue-400" />
                Editar Plano de Ação
              </h3>
              <button onClick={() => setEditingPlan(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Origem da Demanda</label>
                  <select
                    value={editFormData.origem}
                    onChange={(e) => setEditFormData({ ...editFormData, origem: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="Inspeção de Campo">Inspeção de Campo</option>
                    <option value="Auditoria SST">Auditoria SST</option>
                    <option value="Investigação de Acidente">Investigação de Acidente</option>
                    <option value="Registro de Desvio">Registro de Desvio</option>
                    <option value="Exigência Legal / NR">Exigência Legal / NR</option>
                    <option value="Auditoria Ambiental">Auditoria Ambiental</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Prazo Limite</label>
                  <input
                    type="date"
                    required
                    value={editFormData.prazo}
                    onChange={(e) => setEditFormData({ ...editFormData, prazo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Descrição da Ação <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={editFormData.descricaoAcao}
                  onChange={(e) => setEditFormData({ ...editFormData, descricaoAcao: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Observações / Acompanhamento
                </label>
                <textarea
                  rows={2}
                  value={editFormData.observacoes || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, observacoes: e.target.value })}
                  placeholder="Anotações de campo, evolução da ação ou informações de follow-up..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Responsável <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.responsavel}
                    onChange={(e) => setEditFormData({ ...editFormData, responsavel: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Status</label>
                  {isAdmin ? (
                    <select
                      value={editFormData.status}
                      onChange={(e: any) => setEditFormData({ ...editFormData, status: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="concluido">🟢 Concluído (Verde)</option>
                      <option value="pendente">🟡 Pendente (Amarelo)</option>
                      <option value="cancelada">🔴 Cancelada (Vermelho)</option>
                    </select>
                  ) : (
                    <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
                      <div className="font-semibold text-slate-200">
                        {editingPlan.status === 'concluido'
                          ? '🟢 Concluído'
                          : editingPlan.status === 'cancelada'
                          ? '🔴 Cancelada'
                          : '🟡 Pendente'}
                      </div>
                      <div className="text-[10px] text-amber-400">
                        Alteração de status exclusiva para o perfil Administrador
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const p = editingPlan;
                    setEditingPlan(null);
                    handleOpenCommentsModal(p);
                  }}
                  className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium"
                >
                  <MessageSquare size={14} />
                  Ver Comentários ({editingPlan.comentarios?.length || 0})
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPlan(null)}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors shadow-md shadow-blue-600/30"
                  >
                    Salvar Alterações
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Comentários e Histórico de Acompanhamento */}
      {commentsPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <MessageSquare size={18} className="text-blue-400" />
                  Comentários e Histórico de Evolução
                </h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                  Ação: <span className="text-slate-200">{commentsPlan.descricaoAcao}</span>
                </p>
              </div>
              <button onClick={() => setCommentsPlan(null)} className="text-slate-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {!commentsPlan.comentarios || commentsPlan.comentarios.length === 0 ? (
                <div className="py-8 text-center">
                  <MessageSquare size={32} className="mx-auto text-slate-400 mb-2 opacity-50" />
                  <p className="text-xs font-medium text-slate-300">Nenhum comentário registrado ainda</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Utilize o formulário abaixo para registrar notas de evolução, inspeções ou evidências.
                  </p>
                </div>
              ) : (
                commentsPlan.comentarios.map((c) => {
                  let formattedDate = c.dataHora;
                  try {
                    formattedDate = new Date(c.dataHora).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  } catch (e) {
                    // keep raw
                  }
                  return (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                        <span className="font-semibold text-blue-400 flex items-center gap-1.5">
                          <UserIcon size={12} />
                          {c.autor}
                          {c.autorCpf && <span className="text-slate-400 font-mono font-normal">({c.autorCpf})</span>}
                        </span>
                        <span className="text-[10px] text-slate-400">{formattedDate}</span>
                      </div>
                      <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{c.texto}</p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Comment Input */}
            <form onSubmit={handleAddComment} className="p-4 border-t border-slate-800 bg-slate-900/50">
              <div className="flex flex-col gap-2">
                <textarea
                  rows={2}
                  required
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder={`Escreva um comentário como ${profile?.nome || 'você'}...`}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    O comentário será registrado com seu usuário e carimbo de data/hora.
                  </span>
                  <button
                    type="submit"
                    disabled={isSubmittingComment || !newCommentText.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all cursor-pointer"
                  >
                    <Send size={13} />
                    <span>Enviar Comentário</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
