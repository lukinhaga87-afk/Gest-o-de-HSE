import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  Shield,
  Building,
  Eye,
  History,
  Lock,
  Search,
  CheckCircle,
  Plus,
  UserPlus,
  Users,
  X,
  Trash2,
  Edit3,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  CreditCard,
  KeyRound,
  Camera,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import { UserProfile, UserRole } from '../../types/sst';
import { formatCPF, maskCPFInput } from '../../utils/trafficLight';

export const UsersPermissionsView: React.FC = () => {
  const { auditLogs, companies } = useSST();
  const {
    profile,
    activeRole,
    setSimulatedRole,
    resetSimulatedRole,
    isSimulatingRole,
    isAdmin,
    registerUser,
    updateUser,
    deleteUser,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'usuarios' | 'perfis' | 'auditoria'>('usuarios');
  const [searchTerm, setSearchTerm] = useState('');
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);

  // New user form states - CPF is the primary identifier
  const [newNome, setNewNome] = useState('');
  const [newCpf, setNewCpf] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('solicitante');
  const [newEmpresaNome, setNewEmpresaNome] = useState('');
  const [newFotoPerfilUrl, setNewFotoPerfilUrl] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // User edit state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editCpf, setEditCpf] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('solicitante');
  const [editEmpresaNome, setEditEmpresaNome] = useState('');
  const [editFotoPerfilUrl, setEditFotoPerfilUrl] = useState('');
  const [updatingUser, setUpdatingUser] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handlePhotoUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    callback: (dataUrl: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const isAllowedExt = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!allowedTypes.includes(file.type.toLowerCase()) && !isAllowedExt) {
      alert('Formato de imagem inválido. Selecione um arquivo JPG, JPEG, PNG ou WEBP.');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      alert('A fotografia excede o limite máximo permitido de 3 MB. Selecione uma imagem menor.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // User deletion state
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Success toast/message
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Subscribe to userProfiles (stripping passwordHash in client state)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'userProfiles'), (snap) => {
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const { passwordHash: _ignored, ...safeData } = d.data() as Omit<UserProfile, 'id'>;
        list.push({ id: d.id, ...safeData });
      });
      setUsersList(list);
    });
    return () => unsub();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setFormError('Somente o Administrador de EHS possui autorização para cadastrar perfis.');
      return;
    }

    const cleanCpfDigits = newCpf.replace(/\D/g, '');
    if (!newNome.trim() || cleanCpfDigits.length !== 11 || !newEmail.trim() || !newPassword.trim()) {
      setFormError('Preencha todos os campos obrigatórios. O CPF deve conter exatamente 11 dígitos.');
      return;
    }

    if (newPassword.length < 6) {
      setFormError('A senha deve conter no mínimo 6 caracteres.');
      return;
    }

    try {
      setSavingUser(true);
      setFormError(null);

      const trimmedEmpresa = newEmpresaNome.trim();
      const matchedCompany = companies.find(
        (c) =>
          c.razaoSocial.trim().toLowerCase() === trimmedEmpresa.toLowerCase() ||
          (c.nomeFantasia && c.nomeFantasia.trim().toLowerCase() === trimmedEmpresa.toLowerCase())
      );

      const finalEmpresaNome = trimmedEmpresa || undefined;
      const finalEmpresaId = matchedCompany
        ? matchedCompany.id
        : (trimmedEmpresa ? `emp_${Date.now()}` : undefined);

      await registerUser(
        newNome,
        newCpf,
        newEmail,
        newPassword,
        newRole,
        finalEmpresaId,
        finalEmpresaNome,
        newFotoPerfilUrl || '',
        false
      );

      setIsAddUserModalOpen(false);
      setNewNome('');
      setNewCpf('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('solicitante');
      setNewEmpresaNome('');
      setNewFotoPerfilUrl('');
      showSuccess(`Usuário ${newNome} cadastrado com sucesso.`);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Erro ao cadastrar perfil na plataforma.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleOpenEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setEditNome(u.nome || '');
    setEditCpf(formatCPF(u.cpf || u.username || ''));
    setEditEmail(u.email || '');
    setEditPassword('');
    setEditRole(u.role || 'solicitante');
    const existingEmpresaNome =
      u.empresaNome ||
      (u.empresaId ? companies.find((c) => c.id === u.empresaId)?.razaoSocial || '' : '');
    setEditEmpresaNome(existingEmpresaNome);
    setEditFotoPerfilUrl(u.fotoPerfilUrl || '');
    setEditError(null);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!isAdmin) {
      setEditError('Somente o Administrador de EHS tem permissão para editar usuários.');
      return;
    }

    const cleanCpfDigits = editCpf.replace(/\D/g, '');
    if (!editNome.trim() || cleanCpfDigits.length !== 11 || !editEmail.trim()) {
      setEditError('Preencha os campos obrigatórios. O CPF deve ter 11 dígitos.');
      return;
    }

    if (editPassword.trim().length > 0 && editPassword.trim().length < 6) {
      setEditError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    try {
      setUpdatingUser(true);
      setEditError(null);

      const trimmedEmpresa = editEmpresaNome.trim();
      const matchedCompany = companies.find(
        (c) =>
          c.razaoSocial.trim().toLowerCase() === trimmedEmpresa.toLowerCase() ||
          (c.nomeFantasia && c.nomeFantasia.trim().toLowerCase() === trimmedEmpresa.toLowerCase())
      );

      const finalEmpresaNome = trimmedEmpresa || undefined;
      const finalEmpresaId = matchedCompany
        ? matchedCompany.id
        : (trimmedEmpresa ? (editingUser.empresaId || `emp_${Date.now()}`) : undefined);

      await updateUser(editingUser.id, {
        nome: editNome.trim(),
        cpf: editCpf,
        email: editEmail.trim(),
        role: editRole,
        empresaId: finalEmpresaId,
        empresaNome: finalEmpresaNome,
        newPassword: editPassword.trim().length > 0 ? editPassword.trim() : undefined,
        fotoPerfilUrl: editFotoPerfilUrl || '',
      });

      setEditingUser(null);
      showSuccess(`Usuário ${editNome} atualizado com sucesso.`);
    } catch (err: any) {
      console.error(err);
      setEditError(err.message || 'Erro ao atualizar dados do usuário.');
    } finally {
      setUpdatingUser(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    if (!isAdmin) {
      setDeleteError('Somente o Administrador de EHS pode excluir perfis.');
      return;
    }

    try {
      setDeletingUser(true);
      setDeleteError(null);
      await deleteUser(userToDelete.id, userToDelete.cpf || userToDelete.username);
      setUserToDelete(null);
      showSuccess('Perfil excluído com sucesso.');
    } catch (err: any) {
      console.error(err);
      setDeleteError(err.message || 'Falha ao excluir perfil.');
    } finally {
      setDeletingUser(false);
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        log.acao.toLowerCase().includes(q) ||
        log.entidade.toLowerCase().includes(q) ||
        log.usuario.toLowerCase().includes(q) ||
        log.detalhes.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredUsers = usersList.filter((u) => {
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const cleanQ = searchTerm.replace(/\D/g, '');
      const cpfDigits = (u.cpf || '').replace(/\D/g, '');

      return (
        u.nome.toLowerCase().includes(q) ||
        (cleanQ && cpfDigits.includes(cleanQ)) ||
        (u.cpf && u.cpf.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        (u.empresaNome && u.empresaNome.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-slate-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <UserCheck className="text-blue-500" />
            Gestão de Usuários, Perfis e Acessos por CPF (EHS)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Controle de acessos com credenciais vinculadas ao <strong className="text-white">CPF</strong>. O Administrador possui permissão total para cadastrar, editar e excluir usuários.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('usuarios')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'usuarios'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Users size={14} /> Usuários Cadastrados
          </button>
          <button
            onClick={() => setActiveTab('perfis')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'perfis'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Matriz de Permissões
          </button>
          <button
            onClick={() => setActiveTab('auditoria')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'auditoria'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <History size={14} /> Auditoria ({auditLogs.length})
          </button>
        </div>
      </div>

      {/* Security Rule Notice Banner */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
            <ShieldAlert size={16} />
          </div>
          <div>
            <span className="font-semibold text-white">Regra de Segurança e Conformidade:</span>{' '}
            <span className="text-slate-300">
              O acesso é realizado pelo <strong className="text-white">número do CPF</strong>. O <strong className="text-blue-400">Administrador de EHS</strong> pode cadastrar, editar dados/perfis ou excluir usuários.
            </span>
          </div>
        </div>
        <div className="shrink-0">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isAdmin
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            {isAdmin ? 'Você é Admin (Acesso Total)' : 'Modo Somente Leitura'}
          </span>
        </div>
      </div>

      {/* TAB 1: USUÁRIOS CADASTRADOS */}
      {activeTab === 'usuarios' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-xl border border-slate-800">
            <div className="relative w-full sm:w-80">
              <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar usuário por nome, CPF ou empresa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            {isAdmin ? (
              <button
                onClick={() => {
                  setFormError(null);
                  setIsAddUserModalOpen(true);
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all shrink-0 cursor-pointer"
              >
                <UserPlus size={15} />
                Novo Usuário por CPF (Admin)
              </button>
            ) : (
              <div className="text-[11px] text-slate-500 italic">
                Apenas o Administrador de EHS pode cadastrar ou editar perfis.
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Nome do Usuário</th>
                    <th className="px-4 py-3">CPF (Login de Acesso)</th>
                    <th className="px-4 py-3">E-mail Cadastrado</th>
                    <th className="px-4 py-3">Perfil de Acesso</th>
                    <th className="px-4 py-3">Empresa Vinculada</th>
                    <th className="px-4 py-3">Segurança</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {/* Master Root User: Lucas Valdeci Gonçalves */}
                  {(() => {
                    const liveMaster = usersList.find(
                      (u) => u.id === 'user-452.066.308-37' || u.cpf === '452.066.308-37'
                    );
                    const masterNome = liveMaster?.nome || 'Lucas Valdeci Gonçalves';
                    const masterEmail = liveMaster?.email || 'lucastecseg1@gmail.com';
                    const masterPhoto =
                      liveMaster?.fotoPerfilUrl ||
                      (profile?.cpf === '452.066.308-37' ? profile.fotoPerfilUrl : undefined);
                    const masterNeedsReset = liveMaster?.passwordResetRequired === true;

                    return (
                      <tr className="hover:bg-slate-850/50 bg-blue-950/20">
                        <td className="px-4 py-3.5 font-bold text-white flex items-center gap-2.5">
                          {masterPhoto ? (
                            <img
                              src={masterPhoto}
                              alt={masterNome}
                              className="h-8 w-8 rounded-full object-cover border border-blue-400 shrink-0 shadow-sm"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs shrink-0 border border-blue-400/40">
                              {masterNome[0]?.toUpperCase() || 'L'}
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span>{masterNome}</span>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                Mestre
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-blue-400 font-bold">
                          452.066.308-37
                        </td>
                        <td className="px-4 py-3.5 text-slate-300">{masterEmail}</td>
                        <td className="px-4 py-3.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40">
                            Administrador Mestre EHS
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-300">Todas as Contratadas (Global)</td>
                        <td className="px-4 py-3.5 text-[11px] font-medium">
                          {masterNeedsReset ? (
                            <span className="text-amber-400">Aguardando Troca Inicial (bcrypt)</span>
                          ) : (
                            <span className="text-emerald-400">Senha Protegida (bcrypt)</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAdmin && (
                              <button
                                onClick={() =>
                                  handleOpenEditUser({
                                    id: liveMaster?.id || 'user-452.066.308-37',
                                    nome: masterNome,
                                    cpf: '452.066.308-37',
                                    username: '452.066.308-37',
                                    email: masterEmail,
                                    role: 'admin',
                                    cargo: liveMaster?.cargo || 'Administrador Mestre EHS',
                                    empresaNome: liveMaster?.empresaNome,
                                    fotoPerfilUrl: masterPhoto,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-950/50 text-blue-300 hover:bg-blue-900/60 border border-blue-500/30 text-[11px] font-medium transition-colors"
                                title="Editar Dados do Administrador"
                              >
                                <Edit3 size={13} />
                                <span>Editar</span>
                              </button>
                            )}
                            <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                              Mestre Protegido
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}

                  {/* Registered individual users */}
                  {filteredUsers
                    .filter(
                      (u) =>
                        u.username !== 'admin.sst' &&
                        u.username !== 'solicitante' &&
                        u.cpf !== '000.000.000-00' &&
                        u.cpf !== '123.456.789-00' &&
                        u.cpf !== '452.066.308-37' &&
                        u.cpf !== '543.066.308-37'
                    )
                    .map((u) => (
                      <tr key={u.id} className="hover:bg-slate-850/50">
                        <td className="px-4 py-3.5 font-bold text-white flex items-center gap-2.5">
                          {u.fotoPerfilUrl ? (
                            <img
                              src={u.fotoPerfilUrl}
                              alt={u.nome}
                              className="h-8 w-8 rounded-full object-cover border border-slate-700 shrink-0 shadow-sm"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-xs border border-slate-700 shrink-0">
                              {u.nome?.[0]?.toUpperCase() || 'U'}
                            </div>
                          )}
                          <div>
                            <div>{u.nome}</div>
                            {u.cargo && <div className="text-[10px] text-slate-400 font-normal">{u.cargo}</div>}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-blue-300 font-semibold">
                          {formatCPF(u.cpf || u.username)}
                        </td>
                        <td className="px-4 py-3.5 text-slate-300">{u.email}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              u.role === 'admin'
                                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                : u.role === 'solicitante'
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-300">
                          {u.empresaNome || (u.role === 'admin' ? 'Todas' : '-')}
                        </td>
                        <td className="px-4 py-3.5 text-[11px] font-medium">
                          {u.passwordResetRequired ? (
                            <span className="text-amber-400">Aguardando Troca de Senha</span>
                          ) : (
                            <span className="text-emerald-400">Senha Protegida (bcrypt)</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAdmin ? (
                              <>
                                <button
                                  onClick={() => handleOpenEditUser(u)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-950/50 text-blue-300 hover:bg-blue-900/60 border border-blue-500/30 text-[11px] font-medium transition-colors"
                                  title="Editar Usuário"
                                >
                                  <Edit3 size={13} />
                                  <span>Editar</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setDeleteError(null);
                                    setUserToDelete(u);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 text-red-400 hover:bg-red-900/60 border border-red-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                                  title="Excluir Perfil de Usuário"
                                >
                                  <Trash2 size={13} />
                                  <span>Excluir</span>
                                </button>
                              </>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">
                                Apenas Admin
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MATRIZ DE PERMISSÕES */}
      {activeTab === 'perfis' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-lg border border-blue-500/30">
                <Shield size={24} />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-medium">Sua Sessão Ativa:</span>
                <h3 className="text-base font-bold text-white">
                  {profile?.nome || 'Lucas Valdeci Gonçalves'}
                </h3>
                <p className="text-xs text-slate-300 font-mono">
                  CPF: {formatCPF(profile?.cpf || profile?.username)} • Perfil:{' '}
                  <span className="text-blue-400 font-bold uppercase font-sans">{activeRole}</span>
                </p>
              </div>
            </div>

            {profile?.role === 'admin' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Alternar Perfil:</span>
                <button
                  onClick={() => setSimulatedRole('admin')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    activeRole === 'admin'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Admin EHS
                </button>
                <button
                  onClick={() => {
                    const comp = companies[0];
                    setSimulatedRole('solicitante', comp?.id, comp?.razaoSocial);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    activeRole === 'solicitante'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Solicitante da Contratada
                </button>
                <button
                  onClick={() => setSimulatedRole('auditor')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    activeRole === 'auditor'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Auditor
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-900 border border-blue-500/30 p-5 space-y-4">
              <div className="flex items-center gap-2 text-blue-400">
                <Shield size={20} />
                <h3 className="font-bold text-white text-sm">ADMINISTRADOR EHS</h3>
              </div>
              <p className="text-xs text-slate-300">
                Acesso completo: cadastro, edição e exclusão de empresas, colaboradores, documentos, exames, permissões, e <strong className="text-white">gestão total (cadastro, edição de dados e exclusão) de perfis de usuários por CPF</strong>.
              </p>
            </div>

            <div className="rounded-xl bg-slate-900 border border-amber-500/30 p-5 space-y-4">
              <div className="flex items-center gap-2 text-amber-400">
                <Building size={20} />
                <h3 className="font-bold text-white text-sm">SOLICITANTE DA CONTRATADA</h3>
              </div>
              <p className="text-xs text-slate-300">
                Acesso restrito: visualiza somente sua própria empresa e colaboradores vinculados, envia documentos e atestados, e consulta justificativas. Não pode cadastrar nem excluir perfis.
              </p>
            </div>

            <div className="rounded-xl bg-slate-900 border border-emerald-500/30 p-5 space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <Eye size={20} />
                <h3 className="font-bold text-white text-sm">AUDITOR</h3>
              </div>
              <p className="text-xs text-slate-300">
                Modo consulta: visualização de indicadores, documentos e emissão de relatórios em PDF e Excel, sem permissão de alteração de registros nem gestão de usuários.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TRILHA DE AUDITORIA */}
      {activeTab === 'auditoria' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Data e Hora</th>
                    <th className="px-4 py-3">Ação</th>
                    <th className="px-4 py-3">Entidade</th>
                    <th className="px-4 py-3">Usuário Responsável</th>
                    <th className="px-4 py-3">Detalhes da Operação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-400">
                        Nenhum registro de auditoria encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-850/50">
                        <td className="px-4 py-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                          {new Date(log.dataHora).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] uppercase bg-blue-500/10 text-blue-300">
                            {log.acao}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-300">{log.entidade}</td>
                        <td className="px-4 py-3 text-slate-200">
                          <div>{log.usuario}</div>
                          <div className="text-[10px] text-slate-400">{log.usuarioEmail}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-md truncate" title={log.detalhes}>
                          {log.detalhes}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cadastrar Novo Usuário por CPF (Exclusivo Admin) */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus size={18} className="text-blue-500" />
                Cadastrar Perfil de Usuário
              </h3>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-2">
              O <strong className="text-white">CPF</strong> será o identificador de login de acesso à plataforma.
            </p>

            {formError && (
              <div className="mt-3 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="mt-4 space-y-3.5 text-xs">
              {/* Foto de Perfil */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Foto de Perfil (Opcional)
                </label>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  {newFotoPerfilUrl ? (
                    <img
                      src={newFotoPerfilUrl}
                      alt="Pré-visualização"
                      className="h-14 w-14 rounded-full object-cover border-2 border-blue-500 shrink-0 shadow"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-slate-800 text-slate-400 flex flex-col items-center justify-center shrink-0 border border-slate-700">
                      <Camera size={20} />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5">
                        <Camera size={13} />
                        <span>{newFotoPerfilUrl ? 'Substituir Fotografia' : 'Selecionar Fotografia'}</span>
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp"
                          onChange={(e) => handlePhotoUpload(e, setNewFotoPerfilUrl)}
                          className="hidden"
                        />
                      </label>
                      {newFotoPerfilUrl && (
                        <button
                          type="button"
                          onClick={() => setNewFotoPerfilUrl('')}
                          className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-xs font-medium cursor-pointer"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Formatos permitidos: JPG, JPEG, PNG, WEBP (Máx: 3 MB).
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nome Completo <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNome}
                  onChange={(e) => setNewNome(e.target.value)}
                  placeholder="Nome do colaborador ou gestor"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Número do CPF (Login) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newCpf}
                    onChange={(e) => setNewCpf(maskCPFInput(e.target.value))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    E-mail <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="email@empresa.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Senha Individual <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Perfil de Acesso</label>
                  <select
                    value={newRole}
                    onChange={(e: any) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="solicitante">Solicitante da Contratada</option>
                    <option value="admin">Administrador EHS</option>
                    <option value="auditor">Auditor (Somente Leitura)</option>
                  </select>
                </div>
              </div>

              {newRole === 'solicitante' && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Empresa Vinculada
                  </label>
                  <input
                    type="text"
                    list="empresas-sugeridas-novo"
                    value={newEmpresaNome}
                    onChange={(e) => setNewEmpresaNome(e.target.value)}
                    placeholder="Digite o nome da empresa..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <datalist id="empresas-sugeridas-novo">
                    {companies.map((c) => (
                      <option key={c.id} value={c.razaoSocial} />
                    ))}
                  </datalist>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                >
                  {savingUser ? 'Cadastrando...' : 'Cadastrar Perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Usuário Existente (Exclusivo Admin) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 size={18} className="text-blue-500" />
                Editar Dados do Usuário
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-2">
              Atualize as informações cadastrais, o perfil de permissão ou redefina a senha de acesso.
            </p>

            {editError && (
              <div className="mt-3 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-400" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditUser} className="mt-4 space-y-3.5 text-xs">
              {/* Foto de Perfil */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Foto de Perfil
                </label>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  {editFotoPerfilUrl ? (
                    <img
                      src={editFotoPerfilUrl}
                      alt="Pré-visualização"
                      className="h-14 w-14 rounded-full object-cover border-2 border-blue-500 shrink-0 shadow"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-slate-800 text-slate-400 flex flex-col items-center justify-center shrink-0 border border-slate-700">
                      <Camera size={20} />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5">
                        <Camera size={13} />
                        <span>{editFotoPerfilUrl ? 'Substituir Fotografia' : 'Selecionar Fotografia'}</span>
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp"
                          onChange={(e) => handlePhotoUpload(e, setEditFotoPerfilUrl)}
                          className="hidden"
                        />
                      </label>
                      {editFotoPerfilUrl && (
                        <button
                          type="button"
                          onClick={() => setEditFotoPerfilUrl('')}
                          className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-xs font-medium cursor-pointer"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Formatos permitidos: JPG, JPEG, PNG, WEBP (Máx: 3 MB).
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nome Completo <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Número do CPF (Login) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editCpf}
                    onChange={(e) => setEditCpf(maskCPFInput(e.target.value))}
                    maxLength={14}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    E-mail <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                    <KeyRound size={12} className="text-slate-400" />
                    Nova Senha (Opcional)
                  </label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Em branco para manter"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Perfil de Acesso</label>
                  <select
                    value={editRole}
                    onChange={(e: any) => setEditRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="solicitante">Solicitante da Contratada</option>
                    <option value="admin">Administrador EHS</option>
                    <option value="auditor">Auditor (Somente Leitura)</option>
                  </select>
                </div>
              </div>

              {editRole === 'solicitante' && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Empresa Vinculada
                  </label>
                  <input
                    type="text"
                    list="empresas-sugeridas-edicao"
                    value={editEmpresaNome}
                    onChange={(e) => setEditEmpresaNome(e.target.value)}
                    placeholder="Digite o nome da empresa..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <datalist id="empresas-sugeridas-edicao">
                    {companies.map((c) => (
                      <option key={c.id} value={c.razaoSocial} />
                    ))}
                  </datalist>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updatingUser}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-500 disabled:opacity-50 cursor-pointer shadow-md shadow-blue-600/30"
                >
                  {updatingUser ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Exclusão de Perfil (Exclusivo Admin) */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-red-500/40 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-red-600/20 text-red-400 flex items-center justify-center border border-red-500/30 shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Exclusão de Perfil</h3>
                <p className="text-[11px] text-slate-400">Ação restrita ao Administrador de EHS</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Tem certeza de que deseja excluir permanentemente o acesso do usuário{' '}
              <strong className="text-white">{userToDelete.nome}</strong> (CPF:{' '}
              <code className="text-blue-400 font-mono">
                {formatCPF(userToDelete.cpf || userToDelete.username)}
              </code>)?
            </p>

            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-[11px] mb-4">
              Esta ação revogará permanentemente as credenciais e será registrada na Trilha de Auditoria com data e identificação do Administrador.
            </div>

            {deleteError && (
              <div className="mb-4 p-2.5 rounded-lg bg-red-950/80 border border-red-500 text-red-300 text-xs">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingUser}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={14} />
                <span>{deletingUser ? 'Excluindo...' : 'Sim, Excluir Perfil'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
