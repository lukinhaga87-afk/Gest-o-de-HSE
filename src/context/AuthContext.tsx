import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { UserProfile, UserRole } from '../types/sst';
import { isMasterAdminIdentifier } from '../utils/cryptoAuth';

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
  changePassword: (
    cpfOrIdentifier: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; message: string }>;
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
  apiToken: string | null;
  getAuthHeaders: () => Record<string, string>;
  refreshApiSession: () => Promise<string | null>;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_SESSION_KEY = 'gestao_sst_user_session';
const LOCAL_STORAGE_API_TOKEN_KEY = 'gestao_sst_api_token';

function isTokenStructurallyUnexpired(token: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (!payload?.exp) return false;
    return payload.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}

function stripSensitiveProfileFields(user: UserProfile): UserProfile {
  const { passwordHash: _ignored, ...safe } = user;
  return safe;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_API_TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Simulation states for role preview (strictly restricted to verified admins)
  const [simulatedRole, setSimulatedRoleState] = useState<UserRole | null>(null);
  const [simulatedEmpresaId, setSimulatedEmpresaId] = useState<string | null>(null);
  const [simulatedEmpresaNome, setSimulatedEmpresaNome] = useState<string | null>(null);

  const clearLocalSession = () => {
    setProfile(null);
    setApiToken(null);
    setIsAuthenticated(false);
    setSimulatedRoleState(null);
    setSimulatedEmpresaId(null);
    setSimulatedEmpresaNome(null);
    try {
      localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      localStorage.removeItem(LOCAL_STORAGE_API_TOKEN_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  // Validate saved Bearer token against backend + Firestore on mount (fail-closed)
  useEffect(() => {
    const initAuth = async () => {
      try {
        const savedToken = localStorage.getItem(LOCAL_STORAGE_API_TOKEN_KEY);
        if (!savedToken || !isTokenStructurallyUnexpired(savedToken)) {
          clearLocalSession();
          return;
        }

        const resp = await fetch('/api/auth/me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${savedToken}` },
        });

        if (!resp.ok) {
          clearLocalSession();
          return;
        }

        const data = await resp.json();
        if (data?.success && data?.user) {
          const safeUser = stripSensitiveProfileFields(data.user as UserProfile);
          setProfile(safeUser);
          setApiToken(savedToken);
          setIsAuthenticated(true);
          localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(safeUser));
        } else {
          clearLocalSession();
        }
      } catch (err) {
        console.warn('Falha ao validar sessão no servidor:', err);
        clearLocalSession();
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // Login strictly via backend bcrypt + Firestore verification
  const loginWithCredentials = async (
    cpfOrIdentifier: string,
    password: string
  ): Promise<{ success: boolean; message?: string }> => {
    const cleanIdentifier = cpfOrIdentifier.trim();
    const cleanPassword = password.trim();

    if (!cleanIdentifier || !cleanPassword) {
      return {
        success: false,
        message: 'Por favor, informe seu CPF e sua senha.',
      };
    }

    try {
      const resp = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpfOrIdentifier: cleanIdentifier,
          password: cleanPassword,
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data?.success || !data?.token || !data?.user) {
        return {
          success: false,
          message:
            data?.message ||
            'CPF ou senha incorretos. Verifique suas credenciais de acesso.',
        };
      }

      const safeUser = stripSensitiveProfileFields(data.user as UserProfile);
      localStorage.setItem(LOCAL_STORAGE_API_TOKEN_KEY, data.token);
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(safeUser));
      setApiToken(data.token);
      setProfile(safeUser);
      setIsAuthenticated(true);
      setSimulatedRoleState(null);
      setSimulatedEmpresaId(null);
      setSimulatedEmpresaNome(null);

      return { success: true };
    } catch (err) {
      console.error('Erro ao autenticar com o servidor:', err);
      return {
        success: false,
        message: 'Não foi possível conectar ao servidor de autenticação.',
      };
    }
  };

  // Self-service password change verified by current password on backend
  const changePassword = async (
    cpfOrIdentifier: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> => {
    const cleanIdentifier = cpfOrIdentifier.trim();
    const cleanCurrent = currentPassword.trim();
    const cleanNew = newPassword.trim();

    if (!cleanIdentifier || !cleanCurrent || !cleanNew) {
      return {
        success: false,
        message: 'Preencha CPF, senha atual e nova senha.',
      };
    }

    try {
      const resp = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpfOrIdentifier: cleanIdentifier,
          currentPassword: cleanCurrent,
          newPassword: cleanNew,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        return {
          success: false,
          message: data?.message || 'Não foi possível alterar a senha.',
        };
      }

      return {
        success: true,
        message: data.message || 'Senha alterada com sucesso!',
      };
    } catch (err) {
      console.error('Erro ao alterar senha no servidor:', err);
      return {
        success: false,
        message: 'Não foi possível conectar ao servidor para alterar a senha.',
      };
    }
  };

  // Register a new platform user via admin-protected backend API (bcrypt hashing on server)
  const registerUser = async (
    nome: string,
    cpf: string,
    email: string,
    password: string,
    role: UserRole,
    empresaId?: string,
    empresaNome?: string,
    fotoPerfilUrl?: string,
    _autoLogin: boolean = false
  ): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Apenas o Administrador de EHS possui permissão para cadastrar perfis.');
    }

    const resp = await authorizedFetch('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        nome,
        cpf,
        email,
        password,
        role,
        empresaId,
        empresaNome,
        fotoPerfilUrl,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      throw new Error(data?.message || 'Erro ao cadastrar perfil na plataforma.');
    }
  };

  // Update an existing platform user via admin-protected backend API
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

    const resp = await authorizedFetch(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      throw new Error(data?.message || 'Erro ao atualizar dados do usuário.');
    }

    if (profile && profile.id === id && data.user) {
      const safeUser = stripSensitiveProfileFields(data.user as UserProfile);
      setProfile(safeUser);
      localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(safeUser));
    }
  };

  // Directly update profile picture for currently logged-in user via backend API
  const updateProfilePhoto = async (fotoUrl: string | null): Promise<void> => {
    if (!profile) return;
    const cleanUrl = fotoUrl || '';

    const resp = await authorizedFetch('/api/auth/me/photo', {
      method: 'PUT',
      body: JSON.stringify({ fotoPerfilUrl: cleanUrl }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success || !data?.user) {
      throw new Error(data?.message || 'Erro ao salvar foto de perfil.');
    }

    const safeUser = stripSensitiveProfileFields(data.user as UserProfile);
    setProfile(safeUser);
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(safeUser));
  };

  // Delete an existing platform user via admin-protected backend API
  const deleteUser = async (id: string, cpfOrUsername?: string): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Apenas o Administrador de EHS possui permissão para excluir perfis de usuário.');
    }

    if (isMasterAdminIdentifier(id) || isMasterAdminIdentifier(cpfOrUsername)) {
      throw new Error('O perfil do Administrador Mestre Lucas Valdeci Gonçalves não pode ser excluído.');
    }

    if (profile?.id === id) {
      throw new Error('Você não pode excluir sua própria conta atualmente ativa.');
    }

    const resp = await authorizedFetch(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      throw new Error(data?.message || 'Falha ao excluir perfil de usuário.');
    }
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
    } catch {
      // Ignore if not logged in via Firebase Auth
    }
    setUser(null);
    clearLocalSession();
    try {
      sessionStorage.removeItem('gestao_sst_smtp_session');
    } catch {
      // Ignore storage errors
    }
  };

  // Only verified real admins may preview lower roles in the UI
  const setSimulatedRole = (role: UserRole, empresaId?: string, empresaNome?: string) => {
    if (!isAuthenticated || profile?.role !== 'admin') {
      return;
    }
    setSimulatedRoleState(role);
    setSimulatedEmpresaId(empresaId || null);
    setSimulatedEmpresaNome(empresaNome || null);
  };

  const resetSimulatedRole = () => {
    setSimulatedRoleState(null);
    setSimulatedEmpresaId(null);
    setSimulatedEmpresaNome(null);
  };

  const activeRole: UserRole =
    profile?.role === 'admin' && simulatedRole ? simulatedRole : profile?.role || 'auditor';
  const activeEmpresaId: string | null =
    profile?.role === 'admin' && simulatedRole === 'solicitante'
      ? simulatedEmpresaId || profile?.empresaId || null
      : profile?.empresaId || null;
  const activeEmpresaNome: string | null =
    profile?.role === 'admin' && simulatedRole === 'solicitante'
      ? simulatedEmpresaNome || profile?.empresaNome || 'Construtora Alvorada Ltda'
      : profile?.empresaNome || null;

  const isAdmin = activeRole === 'admin';
  const isSolicitante = activeRole === 'solicitante';
  const isAuditor = activeRole === 'auditor';
  const canEdit = isAuthenticated && !isAuditor;

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const activeToken = apiToken || localStorage.getItem(LOCAL_STORAGE_API_TOKEN_KEY);
    if (activeToken) {
      headers.Authorization = `Bearer ${activeToken}`;
    }
    return headers;
  };

  const refreshApiSession = async (): Promise<string | null> => {
    const token = apiToken || localStorage.getItem(LOCAL_STORAGE_API_TOKEN_KEY);
    if (!token || !isTokenStructurallyUnexpired(token)) {
      clearLocalSession();
      return null;
    }

    try {
      const resp = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        clearLocalSession();
        return null;
      }
      const data = await resp.json();
      if (data?.success && data?.user) {
        const safeUser = stripSensitiveProfileFields(data.user as UserProfile);
        setProfile(safeUser);
        setIsAuthenticated(true);
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(safeUser));
        return token;
      }
    } catch {
      // Network/availability issue - do not elevate or bypass
    }
    return null;
  };

  const authorizedFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const token: string | null = apiToken || localStorage.getItem(LOCAL_STORAGE_API_TOKEN_KEY);

    const buildHeaders = (tok: string | null): HeadersInit => {
      const base: Record<string, string> = { 'Content-Type': 'application/json' };
      if (init.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)) {
        Object.assign(base, init.headers);
      }
      if (tok) {
        base.Authorization = `Bearer ${tok}`;
      }
      return base;
    };

    const response = await fetch(input, { ...init, headers: buildHeaders(token) });
    if (response.status === 401) {
      clearLocalSession();
    }
    return response;
  };

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
        isSimulatingRole: profile?.role === 'admin' && !!simulatedRole,
        loginWithCredentials,
        changePassword,
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
        apiToken,
        getAuthHeaders,
        refreshApiSession,
        authorizedFetch,
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
