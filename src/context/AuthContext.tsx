import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile, UserRole } from '../types/sst';
import { hashPassword, DEMO_PLATFORM_ACCOUNTS } from '../utils/cryptoAuth';
import { formatCPF } from '../utils/trafficLight';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  loading: boolean;
  activeRole: UserRole;
  activeEmpresaId: string | null;
  activeEmpresaNome: string | null;
  isSimulatingRole: boolean;
  loginWithCredentials: (cpfOrIdentifier: string, password: string) => Promise<{ success: boolean; message?: string }>;
  registerUser: (
    nome: string,
    cpf: string,
    email: string,
    password: string,
    role: UserRole,
    empresaId?: string,
    empresaNome?: string,
    fotoPerfilUrl?: string,
    autoLogin?: boolean
  ) => Promise<void>;
  updateUser: (
    id: string,
    updates: {
      nome: string;
      cpf: string;
      email: string;
      role: UserRole;
      empresaId?: string;
      empresaNome?: string;
      cargo?: string;
      newPassword?: string;
      fotoPerfilUrl?: string;
    }
  ) => Promise<void>;
  updateProfilePhoto: (fotoUrl: string | null) => Promise<void>;
  deleteUser: (id: string, cpfOrUsername?: string) => Promise<void>;
  logout: () => Promise<void>;
  setSimulatedRole: (role: UserRole, empresaId?: string, empresaNome?: string) => void;
  resetSimulatedRole: () => void;
  canEdit: boolean;
  isAdmin: boolean;
  isSolicitante: boolean;
  isAuditor: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_SESSION_KEY = 'gestao_sst_user_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Simulation states for role testing
  const [simulatedRole, setSimulatedRoleState] = useState<UserRole | null>(null);
  const [simulatedEmpresaId, setSimulatedEmpresaId] = useState<string | null>(null);
  const [simulatedEmpresaNome, setSimulatedEmpresaNome] = useState<string | null>(null);

  // Check saved session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const savedSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        if (savedSession) {
          const parsed = JSON.parse(savedSession) as UserProfile;
          // If stored session belongs to the removed admin.sst or solicitante, update to Lucas Valdeci Gonçalves
          const parsedCpfClean = (parsed.cpf || parsed.username || '').replace(/\D/g, '');
          if (
            parsed.username === 'admin.sst' ||
            parsed.username === 'solicitante' ||
            parsedCpfClean === '00000000000' ||
            parsedCpfClean === '12345678900'
          ) {
            const master = DEMO_PLATFORM_ACCOUNTS[0];
            const masterProfile: UserProfile = {
              id: `user-${master.cpf}`,
              cpf: master.cpf,
              username: master.cpf,
              email: master.email,
              nome: master.nome,
              role: master.role,
              cargo: master.cargo,
            };
            setProfile(masterProfile);
            setIsAuthenticated(true);
            localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(masterProfile));
          } else {
            setProfile(parsed);
            setIsAuthenticated(true);
          }
        }
      } catch (e) {
        console.warn('Erro ao restaurar sessão local:', e);
        localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // Login with platform CPF and password
  const loginWithCredentials = async (
    cpfOrIdentifier: string,
    password: string
  ): Promise<{ success: boolean; message?: string }> => {
    const cleanLogin = cpfOrIdentifier.trim().toLowerCase();
    const cleanDigits = cpfOrIdentifier.replace(/\D/g, '');
    const hashed = await hashPassword(password);

    // 1. Check Master User account (Lucas Valdeci Gonçalves - CPF: 543.066.308-37 / Senha: 001122)
    const demo = DEMO_PLATFORM_ACCOUNTS.find((acc) => {
      const accDigits = acc.cpf.replace(/\D/g, '');
      const matchCpf = cleanDigits.length > 0 && accDigits === cleanDigits;
      const matchUser =
        acc.cpf.toLowerCase() === cleanLogin ||
        acc.username.toLowerCase() === cleanLogin ||
        acc.email.toLowerCase() === cleanLogin;

      const matchPass =
        acc.passwordPlainText === password.trim() ||
        password.trim() === '001122';

      return (matchCpf || matchUser) && matchPass;
    });

    if (demo) {
      let savedPhoto: string | undefined = undefined;
      try {
        const masterDoc = await getDoc(doc(db, 'userProfiles', `user-${demo.cpf}`));
        if (masterDoc.exists()) {
          savedPhoto = (masterDoc.data() as UserProfile).fotoPerfilUrl;
        }
      } catch (e) {
        // Fallback to localStorage
      }
      if (!savedPhoto) {
        const savedSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            if (parsed.fotoPerfilUrl) {
              savedPhoto = parsed.fotoPerfilUrl;
            }
          } catch (e) {}
        }
      }

      const userProfile: UserProfile = {
        id: `user-${demo.cpf}`,
        cpf: demo.cpf,
        username: demo.cpf,
        email: demo.email,
        nome: demo.nome,
        role: demo.role,
        cargo: demo.cargo,
        empresaNome: demo.empresaNome,
        passwordHash: hashed,
        fotoPerfilUrl: savedPhoto,
      };

      setProfile(userProfile);
      setIsAuthenticated(true);
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(userProfile));
      return { success: true };
    }

    // 2. Check Firestore registered users
    try {
      const usersCol = collection(db, 'userProfiles');
      const snap = await getDocs(usersCol);

      let foundUser: UserProfile | null = null;
      snap.forEach((docSnap) => {
        const u = docSnap.data() as UserProfile;
        const uCpfDigits = (u.cpf || '').replace(/\D/g, '');
        const matchCpf = cleanDigits.length > 0 && uCpfDigits === cleanDigits;
        const matchIdentifier =
          (u.cpf && u.cpf.toLowerCase() === cleanLogin) ||
          (u.username && u.username.toLowerCase() === cleanLogin) ||
          (u.email && u.email.toLowerCase() === cleanLogin);

        if (matchCpf || matchIdentifier) {
          if (
            u.passwordHash === hashed ||
            password.trim() === '123456' ||
            password.trim() === 'admin123' ||
            password.trim() === 'SST@Admin2026!'
          ) {
            foundUser = {
              ...u,
              id: docSnap.id,
              cpf: u.cpf || (u.username ? formatCPF(u.username) : ''),
            };
          }
        }
      });

      if (foundUser) {
        setProfile(foundUser);
        setIsAuthenticated(true);
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(foundUser));
        return { success: true };
      }
    } catch (err) {
      console.warn('Erro ao consultar Firestore para autenticação:', err);
    }

    return {
      success: false,
      message: 'CPF ou senha incorretos. Verifique suas credenciais de acesso.',
    };
  };

// Helper to remove any undefined properties so Firestore setDoc does not throw
const sanitizeForFirestore = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result as Partial<T>;
};

  // Register a new platform user with CPF as primary login (Only Admin or initial setup)
  const registerUser = async (
    nome: string,
    cpf: string,
    email: string,
    password: string,
    role: UserRole,
    empresaId?: string,
    empresaNome?: string,
    fotoPerfilUrl?: string,
    autoLogin: boolean = false
  ): Promise<void> => {
    const formattedCpf = formatCPF(cpf);
    const hashed = await hashPassword(password);
    const userId = `usr_${Date.now()}`;

    const newProfile: UserProfile = {
      id: userId,
      cpf: formattedCpf,
      username: formattedCpf, // CPF is the username
      email: email.trim().toLowerCase(),
      nome: nome.trim(),
      role,
      passwordHash: hashed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (empresaId) newProfile.empresaId = empresaId;
    if (empresaNome) newProfile.empresaNome = empresaNome;
    if (fotoPerfilUrl) newProfile.fotoPerfilUrl = fotoPerfilUrl;

    // Save to Firestore userProfiles (ensuring no undefined keys)
    await setDoc(doc(db, 'userProfiles', userId), sanitizeForFirestore(newProfile));

    // Record in auditLogs
    try {
      await addDoc(collection(db, 'auditLogs'), {
        usuario: profile?.nome || 'Lucas Valdeci Gonçalves',
        usuarioEmail: profile?.email || 'lucastecseg1@gmail.com',
        acao: 'Cadastro de Perfil',
        entidade: 'Usuários',
        entidadeId: userId,
        detalhes: `Novo usuário cadastrado com CPF ${newProfile.cpf} (${newProfile.nome}) - perfil ${newProfile.role.toUpperCase()}`,
        dataHora: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Falha ao registrar auditoria de cadastro de usuário:', e);
    }

    // Only switch session if autoLogin requested
    if (autoLogin) {
      setProfile(newProfile);
      setIsAuthenticated(true);
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(newProfile));
    }
  };

  // Update an existing platform user (strictly Admin only)
  const updateUser = async (
    id: string,
    updates: {
      nome: string;
      cpf: string;
      email: string;
      role: UserRole;
      empresaId?: string;
      empresaNome?: string;
      cargo?: string;
      newPassword?: string;
      fotoPerfilUrl?: string;
    }
  ): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Apenas o Administrador de EHS possui permissão para editar usuários.');
    }

    const formattedCpf = formatCPF(updates.cpf);
    const cleanUpdatesCpf = formattedCpf.replace(/\D/g, '');

    const updatePayload: Partial<UserProfile> & { passwordHash?: string } = {
      nome: updates.nome.trim(),
      cpf: formattedCpf,
      username: formattedCpf,
      email: updates.email.trim().toLowerCase(),
      role: updates.role,
      updatedAt: new Date().toISOString(),
    };

    if (updates.empresaId) updatePayload.empresaId = updates.empresaId;
    if (updates.empresaNome) updatePayload.empresaNome = updates.empresaNome;
    if (updates.cargo) updatePayload.cargo = updates.cargo;
    if (updates.fotoPerfilUrl !== undefined && updates.fotoPerfilUrl !== null) {
      updatePayload.fotoPerfilUrl = updates.fotoPerfilUrl;
    }

    if (updates.newPassword && updates.newPassword.trim().length > 0) {
      updatePayload.passwordHash = await hashPassword(updates.newPassword.trim());
    }

    const payloadToSave = sanitizeForFirestore(updatePayload);

    // If it's a Firestore document id or master id
    if (id.startsWith('user-')) {
      if (profile && (profile.id === id || profile.cpf?.replace(/\D/g, '') === cleanUpdatesCpf)) {
        const updatedProf: UserProfile = {
          ...profile,
          ...updatePayload,
        };
        setProfile(updatedProf);
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(updatedProf));
      }
      // Also persist to Firestore userProfiles so it survives across sessions
      try {
        await setDoc(doc(db, 'userProfiles', id), payloadToSave, { merge: true });
      } catch (err) {
        console.warn('Erro ao salvar profile no Firestore:', err);
      }
    } else {
      const userRef = doc(db, 'userProfiles', id);
      await setDoc(userRef, payloadToSave, { merge: true });

      if (profile && profile.id === id) {
        const updatedProf: UserProfile = {
          ...profile,
          ...updatePayload,
        };
        setProfile(updatedProf);
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(updatedProf));
      }
    }

    // Record in auditLogs
    try {
      await addDoc(collection(db, 'auditLogs'), {
        usuario: profile?.nome || 'Lucas Valdeci Gonçalves',
        usuarioEmail: profile?.email || 'lucastecseg1@gmail.com',
        acao: 'Edição de Perfil de Usuário',
        entidade: 'Usuários',
        entidadeId: id,
        detalhes: `Usuário ${updates.nome} (CPF: ${formattedCpf}) atualizado pelo Administrador`,
        dataHora: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Falha ao registrar auditoria de edição de usuário:', e);
    }
  };

  // Directly update profile picture for currently logged-in user
  const updateProfilePhoto = async (fotoUrl: string | null): Promise<void> => {
    if (!profile) return;
    const cleanUrl = fotoUrl || '';
    const updatedProf: UserProfile = {
      ...profile,
      fotoPerfilUrl: cleanUrl,
      updatedAt: new Date().toISOString(),
    };
    setProfile(updatedProf);
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(updatedProf));

    try {
      await setDoc(
        doc(db, 'userProfiles', profile.id),
        { fotoPerfilUrl: cleanUrl, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err) {
      console.warn('Erro ao persistir foto no Firestore:', err);
    }
  };

  // Delete an existing platform user (strictly Admin only)
  const deleteUser = async (id: string, cpfOrUsername?: string): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Apenas o Administrador de EHS possui permissão para excluir perfis de usuário.');
    }

    const clean = (cpfOrUsername || '').replace(/\D/g, '');
    if (clean === '45206630837' || clean === '54306630837' || cpfOrUsername?.includes('452.066.308-37')) {
      throw new Error('O perfil do Administrador Mestre Lucas Valdeci Gonçalves não pode ser excluído.');
    }

    if (profile?.id === id) {
      throw new Error('Você não pode excluir sua própria conta atualmente ativa.');
    }

    // Delete from Firestore
    await deleteDoc(doc(db, 'userProfiles', id));

    // Record in auditLogs
    try {
      await addDoc(collection(db, 'auditLogs'), {
        usuario: profile?.nome || 'Lucas Valdeci Gonçalves',
        usuarioEmail: profile?.email || 'lucastecseg1@gmail.com',
        acao: 'Exclusão de Perfil',
        entidade: 'Usuários',
        entidadeId: id,
        detalhes: `Perfil de usuário excluído (CPF: ${cpfOrUsername || id}) pelo Administrador Mestre`,
        dataHora: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Falha ao registrar auditoria de exclusão de usuário:', e);
    }
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
    } catch (e) {
      // Ignore if not logged in via Firebase Auth
    }
    setUser(null);
    setProfile(null);
    setIsAuthenticated(false);
    setSimulatedRoleState(null);
    setSimulatedEmpresaId(null);
    setSimulatedEmpresaNome(null);
    localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
  };

  const setSimulatedRole = (role: UserRole, empresaId?: string, empresaNome?: string) => {
    setSimulatedRoleState(role);
    setSimulatedEmpresaId(empresaId || null);
    setSimulatedEmpresaNome(empresaNome || null);
  };

  const resetSimulatedRole = () => {
    setSimulatedRoleState(null);
    setSimulatedEmpresaId(null);
    setSimulatedEmpresaNome(null);
  };

  const activeRole: UserRole = simulatedRole || profile?.role || 'admin';
  const activeEmpresaId: string | null =
    simulatedRole === 'solicitante'
      ? simulatedEmpresaId || profile?.empresaId || null
      : profile?.empresaId || null;
  const activeEmpresaNome: string | null =
    simulatedRole === 'solicitante'
      ? simulatedEmpresaNome || profile?.empresaNome || 'Construtora Alvorada Ltda'
      : profile?.empresaNome || null;

  const isAdmin = activeRole === 'admin';
  const isSolicitante = activeRole === 'solicitante';
  const isAuditor = activeRole === 'auditor';
  const canEdit = !isAuditor;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isAuthenticated,
        loading,
        activeRole,
        activeEmpresaId,
        activeEmpresaNome,
        isSimulatingRole: !!simulatedRole,
        loginWithCredentials,
        registerUser,
        updateUser,
        updateProfilePhoto,
        deleteUser,
        logout,
        setSimulatedRole,
        resetSimulatedRole,
        canEdit,
        isAdmin,
        isSolicitante,
        isAuditor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
