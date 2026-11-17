import express, { Request, Response } from 'express';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  executeDailyNotificationMonitoring,
  db,
} from './notificationEngine';
import {
  sendCustomEmail,
  sendTestEmailDirect,
  verifySmtpConnection,
  isSmtpConfigured,
  getSafeSmtpDiagnostics,
  setRuntimeSmtpConfig,
  clearRuntimeSmtpConfig,
  SmtpOverrideConfig,
} from './emailService';
import {
  authenticateUserCredentials,
  signAuthToken,
  requireAuth,
  requireAdmin,
  requireAuthenticatedEditor,
  AuthenticatedRequest,
  getValidatedApiAuthSecret,
  hashPasswordBcrypt,
  sanitizeUserProfile,
  isValidRole,
  AuthConfigError,
  AuthServiceUnavailableError,
} from './authMiddleware';
import { isMasterAdminIdentifier } from '../src/utils/cryptoAuth';
import { formatCPF } from '../src/utils/trafficLight';
import type {
  Company,
  DocumentSST,
  Employee,
  OccupationalExam,
  SmartDocCategoryGroup,
  SmartDocExtractedData,
  SmartDocHistoryEntry,
  SmartDocRecord,
  SmartDocValidityRule,
  Training,
  UserProfile,
} from '../src/types/sst';
import {
  applyConfiguredValidityRule,
  applyLgpdProjection,
  computeSmartDocInconsistencies,
  computeSmartDocValidityStatus,
  computeUnidentifiedFields,
  findDuplicateBySha256,
  getSmartDocByIdRaw,
  isMedicalCategory,
  linkToContractorsRegistry,
  logSmartDocAudit,
  MAX_FIRESTORE_INLINE_DATAURL_CHARS,
  normalizeIsoDate,
  removeUndefinedDeep,
  runGeminiDocumentExtraction,
  saveSmartDocRecord,
  SmartDocsAiConfigError,
  SmartDocsValidationError,
  updateSmartDocFields,
  validateUploadedFile,
} from './smartDocsService';
import {
  adminGenerateRecoveryCode,
  getRecoveryChannelsStatus,
  RecoveryChannelUnconfiguredError,
  RecoveryRateLimitError,
  RecoveryValidationError,
  requestChannelRecoveryCode,
  resetPasswordWithRecoveryCode,
  verifyRecoveryCodeStatus,
} from './passwordRecoveryService';

function getClientIp(req: Request): string {
  const nfIp = req.headers['x-nf-client-connection-ip'];
  if (typeof nfIp === 'string' && nfIp.trim()) return nfIp.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function removeUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean as Partial<T>;
}

export function createApiApp() {
  const app = express();

  app.use(express.json({ limit: '25mb' }));

  // Normalize path when invoked via Netlify Functions redirect (/.netlify/functions/api/* -> /api/*)
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      const stripped = req.url.slice('/.netlify/functions/api'.length);
      req.url = stripped.startsWith('/api') ? stripped : `/api${stripped.startsWith('/') ? stripped : `/${stripped}`}`;
    } else if (
      req.url.startsWith('/notifications/') ||
      req.url.startsWith('/auth/') ||
      req.url.startsWith('/smartdocs')
    ) {
      req.url = `/api${req.url}`;
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // AUTHENTICATION SESSION EXCHANGE (Requires plaintext credentials + bcrypt)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/session', async (req: Request, res: Response) => {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Serviço de autenticação indisponível: variável API_AUTH_SECRET ausente ou inválida no servidor.',
      });
    }

    const body = req.body || {};
    const { cpfOrIdentifier, password } = body;

    // Explicitly reject hash-based login attempts
    if (body.passwordHash !== undefined) {
      return res.status(400).json({
        success: false,
        message: 'Autenticação via hash não é permitida. Informe CPF e senha.',
      });
    }

    if (typeof cpfOrIdentifier !== 'string' || !cpfOrIdentifier.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de usuário (CPF ou e-mail) obrigatório.',
      });
    }

    if (typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Senha obrigatória para emissão de sessão.',
      });
    }

    try {
      const authenticated = await authenticateUserCredentials({
        cpfOrIdentifier,
        password,
      });

      if (!authenticated) {
        return res.status(401).json({
          success: false,
          message: 'CPF ou senha incorretos. Verifique suas credenciais de acesso.',
        });
      }

      const { token, expiresAt } = signAuthToken(authenticated);
      return res.json({
        success: true,
        token,
        expiresAt,
        role: authenticated.role,
        user: authenticated,
      });
    } catch (err: any) {
      if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({
          success: false,
          message: err.message,
        });
      }
      console.error('[API auth/session Error]:', err);
      return res.status(500).json({
        success: false,
        message: 'Erro ao validar sessão no servidor.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // SELF-SERVICE PASSWORD CHANGE (Requires valid current password via bcrypt)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Serviço de autenticação indisponível: variável API_AUTH_SECRET ausente ou inválida no servidor.',
      });
    }

    const { cpfOrIdentifier, currentPassword, newPassword } = req.body || {};

    if (typeof cpfOrIdentifier !== 'string' || !cpfOrIdentifier.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Informe o CPF ou identificador cadastrado.',
      });
    }

    if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Informe a senha atual.',
      });
    }

    if (typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'A nova senha deve conter no mínimo 6 caracteres.',
      });
    }

    if (currentPassword.trim() === newPassword.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A nova senha deve ser diferente da senha atual.',
      });
    }

    try {
      const authenticated = await authenticateUserCredentials({
        cpfOrIdentifier,
        password: currentPassword,
      });

      if (!authenticated) {
        return res.status(401).json({
          success: false,
          message: 'CPF ou senha atual incorretos.',
        });
      }

      const newPasswordHash = await hashPasswordBcrypt(newPassword);
      const updatedAt = new Date().toISOString();
      const nextTokenVersion =
        (typeof authenticated.tokenVersion === 'number' ? authenticated.tokenVersion : 1) + 1;

      await setDoc(
        doc(db, 'userProfiles', authenticated.id),
        {
          passwordHash: newPasswordHash,
          hashAlgorithm: 'bcrypt',
          passwordResetRequired: false,
          tokenVersion: nextTokenVersion,
          passwordChangedAt: updatedAt,
          updatedAt,
        },
        { merge: true }
      );

      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: authenticated.nome,
          usuarioEmail: authenticated.email,
          acao: 'Alteração de Senha',
          entidade: 'Usuários',
          entidadeId: authenticated.id,
          detalhes: `Usuário ${authenticated.nome} (CPF: ${authenticated.cpf}) alterou sua própria senha de acesso`,
          dataHora: updatedAt,
        });
      } catch (auditErr) {
        console.warn('[AuditLog] Falha ao registrar alteração de senha:', auditErr);
      }

      return res.json({
        success: true,
        message: 'Senha alterada com sucesso! Utilize a nova senha para acessar a plataforma.',
      });
    } catch (err: any) {
      if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({
          success: false,
          message: err.message,
        });
      }
      return res.status(400).json({
        success: false,
        message: err?.message || 'Não foi possível alterar a senha.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // PASSWORD RECOVERY BY CPF + SINGLE-USE 10-MIN SECURITY CODE (OPTIONS A & B)
  // ---------------------------------------------------------------------------
  app.get('/api/auth/recovery/channels-status', (_req: Request, res: Response) => {
    const status = getRecoveryChannelsStatus();
    return res.json({
      success: true,
      ...status,
    });
  });

  app.post(
    '/api/auth/recovery/admin-generate',
    requireAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.authUser || !req.officialProfile || req.tokenRoleDiverged) {
        return res.status(401).json({
          success: false,
          message: 'Sessão administrativa inválida.',
        });
      }

      const { userId, cpf } = req.body || {};
      if (
        (typeof userId !== 'string' || !userId.trim()) &&
        (typeof cpf !== 'string' || !cpf.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: 'Informe o identificador ou CPF do usuário.',
        });
      }

      try {
        const result = await adminGenerateRecoveryCode({
          targetUserId: typeof userId === 'string' ? userId : undefined,
          targetCpf: typeof cpf === 'string' ? cpf : undefined,
          adminUser: {
            id: req.authUser.sub,
            nome: req.officialProfile.nome,
            cpf: req.officialProfile.cpf,
            email: req.officialProfile.email,
          },
        });

        return res.status(201).json({
          success: true,
          message: 'Código gerado com sucesso.',
          ...result,
        });
      } catch (err: any) {
        if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
          return res.status(503).json({ success: false, message: err.message });
        }
        if (err instanceof RecoveryValidationError) {
          return res.status(err.httpStatus).json({ success: false, message: err.message });
        }
        console.error('[API auth/recovery/admin-generate Error]:', err);
        return res.status(500).json({
          success: false,
          message: 'Não foi possível concluir a geração do código de recuperação.',
        });
      }
    }
  );

  app.post('/api/auth/recovery/request-channel', async (req: Request, res: Response) => {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Serviço de recuperação indisponível: API_AUTH_SECRET ausente ou inválido no servidor.',
      });
    }

    const { cpf, canal } = req.body || {};
    if (canal !== 'whatsapp' && canal !== 'sms') {
      return res.status(400).json({
        success: false,
        message: 'Canal de envio inválido. Selecione whatsapp ou sms.',
      });
    }

    if (typeof cpf !== 'string' || cpf.replace(/\D/g, '').length !== 11) {
      return res.status(400).json({
        success: false,
        message: 'Informe um CPF cadastrado válido com 11 dígitos.',
      });
    }

    try {
      const result = await requestChannelRecoveryCode({
        cpf,
        canal,
        ip: getClientIp(req),
      });
      return res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      if (err instanceof RecoveryChannelUnconfiguredError) {
        return res.status(503).json({
          success: false,
          configured: false,
          message: err.message,
        });
      }
      if (err instanceof RecoveryRateLimitError) {
        return res.status(429).json({
          success: false,
          retryAfterSeconds: err.retryAfterSeconds,
          message: err.message,
        });
      }
      if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({ success: false, message: err.message });
      }
      if (err instanceof RecoveryValidationError) {
        return res.status(err.httpStatus).json({ success: false, message: err.message });
      }
      console.error('[API auth/recovery/request-channel Error]:', err);
      return res.status(500).json({
        success: false,
        message: 'Não foi possível concluir a recuperação.',
      });
    }
  });

  app.post('/api/auth/recovery/verify', async (req: Request, res: Response) => {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Serviço de recuperação indisponível: API_AUTH_SECRET ausente ou inválido no servidor.',
      });
    }

    const { cpf, code } = req.body || {};
    if (typeof cpf !== 'string' || typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Código inválido ou expirado.',
      });
    }

    try {
      await verifyRecoveryCodeStatus({
        cpf,
        code,
        ip: getClientIp(req),
      });
      return res.json({ success: true });
    } catch (err: any) {
      if (err instanceof RecoveryRateLimitError) {
        return res.status(429).json({
          success: false,
          retryAfterSeconds: err.retryAfterSeconds,
          message: err.message,
        });
      }
      if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({ success: false, message: err.message });
      }
      if (err instanceof RecoveryValidationError) {
        return res.status(err.httpStatus).json({ success: false, message: err.message });
      }
      return res.status(400).json({
        success: false,
        message: 'Código inválido ou expirado.',
      });
    }
  });

  app.post('/api/auth/recovery/reset', async (req: Request, res: Response) => {
    if (!getValidatedApiAuthSecret()) {
      return res.status(503).json({
        success: false,
        message: 'Serviço de recuperação indisponível: API_AUTH_SECRET ausente ou inválido no servidor.',
      });
    }

    const { cpf, code, newPassword, confirmPassword } = req.body || {};
    if (
      typeof cpf !== 'string' ||
      !cpf.trim() ||
      typeof code !== 'string' ||
      !code.trim() ||
      typeof newPassword !== 'string' ||
      !newPassword.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Preencha CPF cadastrado, código de recuperação e a nova senha.',
      });
    }

    try {
      const result = await resetPasswordWithRecoveryCode({
        cpf,
        code,
        newPassword,
        confirmPassword: typeof confirmPassword === 'string' ? confirmPassword : undefined,
        ip: getClientIp(req),
      });

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err: any) {
      if (err instanceof RecoveryRateLimitError) {
        return res.status(429).json({
          success: false,
          retryAfterSeconds: err.retryAfterSeconds,
          message: err.message,
        });
      }
      if (err instanceof AuthConfigError || err instanceof AuthServiceUnavailableError) {
        return res.status(503).json({ success: false, message: err.message });
      }
      if (err instanceof RecoveryValidationError) {
        return res.status(err.httpStatus).json({ success: false, message: err.message });
      }
      console.error('[API auth/recovery/reset Error]:', err);
      return res.status(500).json({
        success: false,
        message: 'Não foi possível concluir a recuperação.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // CURRENT SESSION PROFILE (Authoritative Firestore profile & role)
  // ---------------------------------------------------------------------------
  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.tokenRoleDiverged || !req.officialProfile) {
      return res.status(401).json({
        success: false,
        message: 'Perfil de acesso divergente ou atualizado no cadastro oficial. Faça login novamente.',
      });
    }
    return res.json({
      success: true,
      user: req.officialProfile,
    });
  });

  app.put('/api/auth/me/photo', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.tokenRoleDiverged || !req.authUser || !req.officialProfile) {
      return res.status(401).json({
        success: false,
        message: 'Sessão inválida. Faça login novamente.',
      });
    }

    const fotoPerfilUrl =
      typeof req.body?.fotoPerfilUrl === 'string' ? req.body.fotoPerfilUrl : '';
    const updatedAt = new Date().toISOString();

    try {
      await setDoc(
        doc(db, 'userProfiles', req.authUser.sub),
        { fotoPerfilUrl, updatedAt },
        { merge: true }
      );
      return res.json({
        success: true,
        user: { ...req.officialProfile, fotoPerfilUrl, updatedAt },
      });
    } catch (err: any) {
      console.error('[API auth/me/photo Error]:', err);
      return res.status(503).json({
        success: false,
        message: 'Não foi possível salvar a foto no banco de dados.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN-ONLY USER MANAGEMENT (bcrypt password hashing + Firestore persistence)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/users', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { nome, cpf, email, password, role, empresaId, empresaNome, fotoPerfilUrl } = req.body || {};

    const cleanCpfDigits = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
    if (
      typeof nome !== 'string' ||
      !nome.trim() ||
      cleanCpfDigits.length !== 11 ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      password.trim().length < 6
    ) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos. Informe nome, CPF (11 dígitos), e-mail e senha com no mínimo 6 caracteres.',
      });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({
        success: false,
        message: 'Perfil de acesso inválido.',
      });
    }

    try {
      const passwordHash = await hashPasswordBcrypt(password);
      const formattedCpf = formatCPF(cpf);
      const normalizedEmail = email.trim().toLowerCase();

      const existingSnap = await getDocs(collection(db, 'userProfiles'));
      for (const existingDoc of existingSnap.docs) {
        const u = existingDoc.data() as UserProfile;
        const uDigits = (u.cpf || u.username || '').replace(/\D/g, '');
        if (uDigits === cleanCpfDigits) {
          return res.status(409).json({
            success: false,
            message: 'Já existe um usuário cadastrado com este CPF.',
          });
        }
        if ((u.email || '').trim().toLowerCase() === normalizedEmail) {
          return res.status(409).json({
            success: false,
            message: 'Já existe um usuário cadastrado com este e-mail.',
          });
        }
      }

      const userId = `usr_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const newProfile: UserProfile = {
        id: userId,
        cpf: formattedCpf,
        username: formattedCpf,
        email: normalizedEmail,
        nome: nome.trim(),
        role,
        passwordHash,
        hashAlgorithm: 'bcrypt',
        passwordResetRequired: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (typeof empresaId === 'string' && empresaId.trim()) {
        newProfile.empresaId = empresaId.trim();
      }
      if (typeof empresaNome === 'string' && empresaNome.trim()) {
        newProfile.empresaNome = empresaNome.trim();
      }
      if (typeof fotoPerfilUrl === 'string' && fotoPerfilUrl.trim()) {
        newProfile.fotoPerfilUrl = fotoPerfilUrl;
      }

      await setDoc(doc(db, 'userProfiles', userId), removeUndefinedFields(newProfile));

      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: req.authUser?.nome || 'Administrador EHS',
          usuarioEmail: req.authUser?.email || '',
          acao: 'Cadastro de Perfil',
          entidade: 'Usuários',
          entidadeId: userId,
          detalhes: `Novo usuário cadastrado com CPF ${newProfile.cpf} (${newProfile.nome}) - perfil ${newProfile.role.toUpperCase()}`,
          dataHora: nowIso,
        });
      } catch (auditErr) {
        console.warn('[AuditLog] Falha ao registrar cadastro de usuário:', auditErr);
      }

      return res.status(201).json({
        success: true,
        user: sanitizeUserProfile(userId, newProfile),
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err?.message || 'Erro ao cadastrar perfil de usuário.',
      });
    }
  });

  app.put('/api/auth/users/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    const { nome, cpf, email, role, empresaId, empresaNome, cargo, newPassword, fotoPerfilUrl } =
      req.body || {};

    const cleanCpfDigits = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
    if (
      typeof nome !== 'string' ||
      !nome.trim() ||
      cleanCpfDigits.length !== 11 ||
      typeof email !== 'string' ||
      !email.trim() ||
      !isValidRole(role)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Preencha nome, CPF (11 dígitos), e-mail e perfil válido.',
      });
    }

    if (isMasterAdminIdentifier(targetId) && role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'O Administrador Mestre EHS não pode ter seu perfil rebaixado.',
      });
    }

    try {
      const userRef = doc(db, 'userProfiles', targetId);
      const existingSnap = await getDoc(userRef);
      if (!existingSnap.exists()) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado.',
        });
      }

      const formattedCpf = formatCPF(cpf);
      const nowIso = new Date().toISOString();
      const updatePayload: Partial<UserProfile> = {
        cpf: formattedCpf,
        username: formattedCpf,
        email: email.trim().toLowerCase(),
        nome: nome.trim(),
        role,
        updatedAt: nowIso,
      };

      if (typeof empresaId === 'string') updatePayload.empresaId = empresaId.trim() || '';
      if (typeof empresaNome === 'string') updatePayload.empresaNome = empresaNome.trim() || '';
      if (typeof cargo === 'string' && cargo.trim()) updatePayload.cargo = cargo.trim();
      if (typeof fotoPerfilUrl === 'string') updatePayload.fotoPerfilUrl = fotoPerfilUrl;

      const existingData = existingSnap.data() as UserProfile;

      if (typeof newPassword === 'string' && newPassword.trim().length > 0) {
        updatePayload.passwordHash = await hashPasswordBcrypt(newPassword);
        updatePayload.hashAlgorithm = 'bcrypt';
        updatePayload.passwordResetRequired = false;
        updatePayload.tokenVersion =
          (typeof existingData.tokenVersion === 'number' ? existingData.tokenVersion : 1) + 1;
        updatePayload.passwordChangedAt = nowIso;
      }

      await setDoc(userRef, removeUndefinedFields(updatePayload), { merge: true });

      const updatedSnap = await getDoc(userRef);
      const updatedData = (updatedSnap.data() || updatePayload) as UserProfile;

      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: req.authUser?.nome || 'Administrador EHS',
          usuarioEmail: req.authUser?.email || '',
          acao: 'Edição de Perfil de Usuário',
          entidade: 'Usuários',
          entidadeId: targetId,
          detalhes: `Usuário ${nome.trim()} (CPF: ${formattedCpf}) atualizado pelo Administrador`,
          dataHora: nowIso,
        });
      } catch (auditErr) {
        console.warn('[AuditLog] Falha ao registrar edição de usuário:', auditErr);
      }

      return res.json({
        success: true,
        user: sanitizeUserProfile(targetId, updatedData),
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        message: err?.message || 'Erro ao atualizar dados do usuário.',
      });
    }
  });

  app.delete('/api/auth/users/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    if (req.authUser?.sub === targetId) {
      return res.status(400).json({
        success: false,
        message: 'Você não pode excluir sua própria conta atualmente ativa.',
      });
    }

    try {
      const userRef = doc(db, 'userProfiles', targetId);
      const existingSnap = await getDoc(userRef);
      if (!existingSnap.exists()) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado.',
        });
      }

      const existingData = existingSnap.data() as UserProfile;
      if (isMasterAdminIdentifier(targetId) || isMasterAdminIdentifier(existingData.cpf)) {
        return res.status(403).json({
          success: false,
          message: 'O perfil do Administrador Mestre não pode ser excluído.',
        });
      }

      await deleteDoc(userRef);

      try {
        await addDoc(collection(db, 'auditLogs'), {
          usuario: req.authUser?.nome || 'Administrador EHS',
          usuarioEmail: req.authUser?.email || '',
          acao: 'Exclusão de Perfil',
          entidade: 'Usuários',
          entidadeId: targetId,
          detalhes: `Perfil de usuário excluído (CPF: ${existingData.cpf || targetId}) pelo Administrador`,
          dataHora: new Date().toISOString(),
        });
      } catch (auditErr) {
        console.warn('[AuditLog] Falha ao registrar exclusão de usuário:', auditErr);
      }

      return res.json({
        success: true,
        message: 'Perfil excluído com sucesso.',
      });
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        message: err?.message || 'Falha ao excluir perfil no banco de dados.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // PUBLIC HEALTHCHECK (Never exposes SMTP host, user, pass, from, or tokens)
  // ---------------------------------------------------------------------------
  app.get('/api/notifications/health', async (_req: Request, res: Response) => {
    res.json({
      status: 'online',
      service: 'Gestão SST - Serviço de Notificações',
      scheduler: 'Netlify Scheduled Function (Execução Diária)',
      smtpConfigured: isSmtpConfigured(),
      serverTime: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // ADMIN-ONLY SMTP & NOTIFICATION ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/notifications/smtp-status', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      success: true,
      smtp: getSafeSmtpDiagnostics(),
      managedBy: 'Netlify Environment Variables',
    });
  });

  const sanitizeSmtpOverride = (raw: any): SmtpOverrideConfig | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const host = typeof raw.host === 'string' ? raw.host.trim() : '';
    const user = typeof raw.user === 'string' ? raw.user.trim() : '';
    const pass = typeof raw.pass === 'string' ? raw.pass : '';
    if (!host || !user || !pass) return undefined;
    return {
      host,
      port: raw.port !== undefined ? String(raw.port).trim() : '587',
      secure: raw.secure,
      user,
      pass,
      from: typeof raw.from === 'string' ? raw.from.trim() : '',
    };
  };

  // Ephemeral in-memory SMTP session configuration (never writes to .env or Firestore)
  app.post('/api/notifications/save-smtp-config', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { host, port, secure, user, pass, from, clear, verify } = req.body || {};

    if (clear === true) {
      clearRuntimeSmtpConfig();
      return res.json({
        success: true,
        cleared: true,
        message: 'Configuração SMTP da sessão removida da memória do servidor.',
        smtp: getSafeSmtpDiagnostics(),
      });
    }

    const candidate: SmtpOverrideConfig = {
      host: typeof host === 'string' ? host.trim() : '',
      port: port !== undefined ? String(port).trim() : '587',
      secure,
      user: typeof user === 'string' ? user.trim() : '',
      pass: typeof pass === 'string' ? pass : '',
      from: typeof from === 'string' ? from.trim() : '',
    };

    try {
      if (!candidate.host || !candidate.user || !candidate.pass) {
        return res.status(400).json({
          success: false,
          connected: false,
          message: 'Informe Servidor SMTP (host), Usuário e Senha para ativar o envio real.',
          smtp: getSafeSmtpDiagnostics(),
        });
      }

      if (verify !== false) {
        const verification = await verifySmtpConnection(candidate);
        if (!verification.connected) {
          return res.status(400).json({
            success: false,
            connected: false,
            message: verification.message,
            smtp: getSafeSmtpDiagnostics(),
          });
        }
      }

      setRuntimeSmtpConfig(candidate);
      return res.json({
        success: true,
        connected: true,
        memoryOnly: true,
        message:
          'Servidor SMTP validado e ativado na sessão do servidor! Os envios de teste, avulsos e manuais agora serão entregues diretamente aos destinatários.',
        smtp: getSafeSmtpDiagnostics(),
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        connected: false,
        message: err?.message || 'Erro ao aplicar configuração SMTP.',
        smtp: getSafeSmtpDiagnostics(),
      });
    }
  });

  app.post('/api/notifications/verify-smtp', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const smtpOverride = sanitizeSmtpOverride(req.body?.smtpConfig);
      const result = await verifySmtpConnection(smtpOverride);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ connected: false, message: err.message || 'Erro ao verificar conexão SMTP.' });
    }
  });

  app.post('/api/notifications/test-email', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { recipient, subject, message, senderName, smtpConfig } = req.body || {};

    const trimmedRecipient = (recipient || '').trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedRecipient || !emailRegex.test(trimmedRecipient)) {
      return res.status(400).json({
        success: false,
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        error: 'Endereço de e-mail de teste inválido ou em formato incorreto.',
      });
    }

    try {
      const finalSubject = (subject || '').trim() || 'Teste de Integração SMTP - Gestão SST';
      const finalMessage =
        (message || '').trim() ||
        'Esta é uma mensagem de validação imediata enviada pelo sistema Gestão SST para confirmar o funcionamento do servidor de e-mail.';
      const responsible = senderName || req.authUser?.nome || 'Administrador';
      const smtpOverride = sanitizeSmtpOverride(smtpConfig);

      const result = await sendTestEmailDirect({
        recipient: trimmedRecipient,
        subject: finalSubject,
        message: finalMessage,
        senderName: responsible,
        smtpConfig: smtpOverride,
      });

      if (result.success && smtpOverride && !process.env.SMTP_HOST) {
        try {
          setRuntimeSmtpConfig(smtpOverride);
        } catch {
          // Ignore runtime cache failure
        }
      }

      const logRecord = {
        dataHora: new Date().toISOString(),
        destinatarios: [trimmedRecipient],
        destinatariosDetalhados: [
          {
            nome: responsible,
            email: trimmedRecipient,
            empresa: 'SESMT Central',
            origem: 'usuario' as const,
          },
        ],
        documentoId: 'teste-smtp',
        documentoTitulo: finalSubject,
        categoria: 'Diagnóstico',
        empresaNome: 'SESMT Central',
        colaboradorNome: responsible,
        usuarioResponsavel: responsible,
        assunto: finalSubject,
        tipoEnvio: 'teste' as const,
        marco: 'teste' as const,
        dataVencimento: new Date().toISOString().split('T')[0],
        diasRestantes: 0,
        status: result.status,
        mensagem: finalMessage,
        erro: result.error || '',
        idempotencyKey: `teste_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        recalculado: false,
        createdAt: new Date().toISOString(),
      };

      try {
        await addDoc(collection(db, 'notificationLogs'), logRecord);
      } catch (logErr) {
        console.warn('[Log Teste] Falha ao gravar log no Firestore:', logErr);
      }

      if (result.success) {
        return res.json({
          success: true,
          status: result.status,
          message: 'E-mail de teste enviado com sucesso. Verifique a caixa de entrada do destinatário.',
          messageId: result.messageId,
          destinatarios: result.destinatarios,
          detalhes: result.detalhes,
        });
      } else {
        return res.status(500).json({
          success: false,
          status: result.status,
          message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
          error: result.error || result.detalhes || 'Falha na comunicação com o servidor SMTP.',
          detalhes: result.detalhes,
        });
      }
    } catch (err: any) {
      console.error('[API test-email Error]:', err);
      return res.status(500).json({
        success: false,
        status: 'falha',
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        error: err.message || String(err),
      });
    }
  });

  app.post('/api/notifications/custom-send', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const {
      to,
      recipientsDetails,
      companyId,
      companyName,
      subject,
      message,
      attachmentName,
      attachmentDataUrl,
      senderName,
      senderEmail,
      smtpConfig,
    } = req.body || {};

    if (!to || !Array.isArray(to) || to.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Não foi possível realizar o envio. Informe pelo menos um destinatário válido.',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validRecipients = to.filter((e: string) => typeof e === 'string' && emailRegex.test(e.trim()));
    if (validRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Não foi possível realizar o envio. Nenhum endereço de e-mail válido foi fornecido.',
      });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Não foi possível realizar o envio. O campo Assunto é obrigatório.',
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Não foi possível realizar o envio. O campo Mensagem é obrigatório.',
      });
    }

    try {
      const finalSubject = subject.trim();
      const finalMessage = message.trim();
      const finalCompany = companyName || 'Todas as Empresas';
      const responsible = senderName || req.authUser?.nome || 'Administrador';
      const smtpOverride = sanitizeSmtpOverride(smtpConfig);

      const result = await sendCustomEmail({
        to: validRecipients,
        companyId,
        companyName: finalCompany,
        subject: finalSubject,
        message: finalMessage,
        attachmentName,
        attachmentDataUrl,
        senderName: responsible,
        senderEmail: senderEmail || req.authUser?.email,
        smtpConfig: smtpOverride,
      });

      try {
        await addDoc(collection(db, 'notificationLogs'), {
          dataHora: new Date().toISOString(),
          destinatarios: validRecipients,
          destinatariosDetalhados:
            Array.isArray(recipientsDetails) && recipientsDetails.length > 0
              ? recipientsDetails
              : validRecipients.map((em: string) => ({
                  nome: em.split('@')[0],
                  email: em,
                  empresa: finalCompany,
                  origem: 'manual' as const,
                })),
          documentoId: 'disparo-avulso',
          documentoTitulo: finalSubject,
          categoria: 'Comunicação Avulsa',
          empresaId: companyId || '',
          empresaNome: finalCompany,
          colaboradorNome: responsible,
          usuarioResponsavel: responsible,
          assunto: finalSubject,
          tipoEnvio: 'avulso',
          marco: 'avulso',
          dataVencimento: '',
          diasRestantes: 0,
          status: result.status,
          mensagem: finalMessage.substring(0, 500),
          erro: result.error || '',
          idempotencyKey: `avulso_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          recalculado: false,
          createdAt: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('[Log Custom Send] Falha ao gravar log no Firestore:', logErr);
      }

      if (result.success) {
        return res.json({
          success: true,
          message: 'E-mail avulso enviado com sucesso!',
          messageId: result.messageId,
          destinatarios: result.destinatarios,
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Não foi possível enviar o e-mail avulso. Verifique as configurações SMTP e os detalhes do erro.',
          error: result.error || result.detalhes,
        });
      }
    } catch (err: any) {
      console.error('[API custom-send Error]:', err);
      return res.status(500).json({
        success: false,
        message: 'Não foi possível enviar o e-mail avulso. Verifique as configurações SMTP e os detalhes do erro.',
        error: err.message || String(err),
      });
    }
  });

  app.post('/api/notifications/run-check', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const smtpOverride = sanitizeSmtpOverride(req.body?.smtpConfig);
      const result = await executeDailyNotificationMonitoring(smtpOverride);
      res.json({
        success: true,
        message: 'Verificação de vencimentos executada com sucesso no backend.',
        dispatched: result.dispatched,
        skippedDuplicates: result.skippedDuplicates,
        totalEvaluated: result.totalEvaluated,
        logs: result.logs,
        timestamp: result.timestamp,
      });
    } catch (err: any) {
      console.error('[API run-check] Erro ao executar monitoramento:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Erro durante execução do monitoramento de vencimentos.',
      });
    }
  });

  app.post(
    '/api/notifications/recalculate',
    requireAuthenticatedEditor,
    async (req: AuthenticatedRequest, res: Response) => {
      const { documentoId, documentoTitulo, novaDataValidade, entidade } = req.body || {};

      if (!documentoId || !novaDataValidade) {
        return res.status(400).json({ success: false, error: 'Parâmetros incompletos.' });
      }

      try {
        const logData = {
          dataHora: new Date().toISOString(),
          destinatarios: ['sistema@gestao-sst.local'],
          documentoId,
          documentoTitulo: documentoTitulo || 'Documento Atualizado',
          categoria: entidade || 'Documento',
          empresaNome: 'Sistema SST',
          usuarioResponsavel: req.authUser?.nome || 'Sistema SST',
          marco: 'recalculo',
          dataVencimento: novaDataValidade,
          status: 'sucesso',
          mensagem: `Vencimento atualizado para ${novaDataValidade}. Próximos alertas (30d, 15d, 0d) recalculados e histórico anterior preservado.`,
          idempotencyKey: `recalc_${documentoId}_${Date.now()}`,
          recalculado: true,
          createdAt: new Date().toISOString(),
        };

        const docRef = await addDoc(collection(db, 'notificationLogs'), logData);

        res.json({
          success: true,
          message: 'Recálculo de alertas registrado com sucesso.',
          logId: docRef.id,
        });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message || String(err) });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // EHS SMARTDOCS – LEITURA INTELIGENTE DE DOCUMENTOS (OCR + IA + APROVAÇÃO)
  // ---------------------------------------------------------------------------
  const isGeminiConfigured = (): boolean => {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key !== 'CONFIGURE_YOUR_GEMINI_API_KEY');
  };

  app.get('/api/smartdocs/validity-rules', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await getDocs(collection(db, 'smartDocValidityRules'));
      const rules: SmartDocValidityRule[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SmartDocValidityRule, 'id'>),
      }));
      rules.sort((a, b) => a.tipoDocumento.localeCompare(b.tipoDocumento));
      return res.json({ success: true, rules });
    } catch (err: any) {
      console.error('[SmartDocs] Erro ao listar regras de validade:', err);
      return res.status(500).json({ success: false, message: 'Erro ao carregar regras de validade.' });
    }
  });

  app.post('/api/smartdocs/validity-rules', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { tipoDocumento, mesesValidade, ativo = true, observacao = '' } = req.body || {};
    const months = Number(mesesValidade);

    if (typeof tipoDocumento !== 'string' || !tipoDocumento.trim() || !Number.isFinite(months) || months <= 0 || months > 240) {
      return res.status(400).json({
        success: false,
        message: 'Informe um tipo documental válido e prazo em meses entre 1 e 240.',
      });
    }

    try {
      const nowIso = new Date().toISOString();
      const rulePayload = {
        tipoDocumento: tipoDocumento.trim(),
        mesesValidade: Math.round(months),
        ativo: Boolean(ativo),
        observacao: typeof observacao === 'string' ? observacao.trim() : '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const docRef = await addDoc(collection(db, 'smartDocValidityRules'), rulePayload);
      await logSmartDocAudit({
        usuarioNome: req.authUser?.nome || 'Administrador EHS',
        usuarioEmail: req.authUser?.email || '',
        acao: 'Configuração de Regra de Validade',
        entidadeId: docRef.id,
        detalhes: `Regra "${rulePayload.tipoDocumento}" definida para ${rulePayload.mesesValidade} meses.`,
      });
      return res.status(201).json({ success: true, rule: { id: docRef.id, ...rulePayload } });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao salvar regra de validade.' });
    }
  });

  app.delete('/api/smartdocs/validity-rules/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await deleteDoc(doc(db, 'smartDocValidityRules', req.params.id));
      return res.json({ success: true, message: 'Regra removida com sucesso.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao excluir regra.' });
    }
  });

  app.get('/api/smartdocs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await getDocs(collection(db, 'smartDocs'));
      const viewerRole = req.authUser!.role;
      const solicitanteEmpresaId = req.officialProfile?.empresaId || '';

      let list: SmartDocRecord[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SmartDocRecord, 'id'>),
      }));

      if (viewerRole === 'solicitante') {
        list = list.filter((item) => {
          if (solicitanteEmpresaId && item.empresaId === solicitanteEmpresaId) return true;
          return item.enviadoPorId === req.authUser!.sub;
        });
      }

      list.sort((a, b) => (b.dataEnvio > a.dataEnvio ? 1 : -1));

      const projected = list.map((item) => {
        const dynamicValidity = computeSmartDocValidityStatus(item.status, item.dadosExtraidos || {});
        return applyLgpdProjection(
          { ...item, statusValidade: dynamicValidity },
          viewerRole,
          { includeFileUrl: false }
        );
      });

      const stats = {
        total: projected.length,
        pendentes: projected.filter((d) => d.status === 'PENDENTE_APROVACAO').length,
        aprovados: projected.filter((d) => d.status === 'APROVADO').length,
        rejeitados: projected.filter((d) => d.status === 'REJEITADO').length,
        comInconsistencias: projected.filter((d) => (d.inconsistencias || []).length > 0).length,
        semValidade: projected.filter(
          (d) => !d.dadosExtraidos?.semValidade && !d.dadosExtraidos?.dataValidade
        ).length,
        errosLeitura: projected.filter((d) => d.status === 'ERRO_LEITURA').length,
      };

      return res.json({
        success: true,
        aiConfigured: isGeminiConfigured(),
        items: projected,
        stats,
      });
    } catch (err: any) {
      console.error('[SmartDocs] Erro ao listar documentos:', err);
      return res.status(503).json({
        success: false,
        message: 'Falha ao consultar fila do SmartDocs no banco de dados.',
      });
    }
  });

  app.get('/api/smartdocs/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const record = await getSmartDocByIdRaw(req.params.id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Documento SmartDocs não encontrado.' });
      }

      const viewerRole = req.authUser!.role;
      const solicitanteEmpresaId = req.officialProfile?.empresaId || '';

      if (
        viewerRole === 'solicitante' &&
        record.enviadoPorId !== req.authUser!.sub &&
        (!solicitanteEmpresaId || record.empresaId !== solicitanteEmpresaId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado: documento pertence a outra empresa contratada.',
        });
      }

      const isMedical = record.isSensitiveMedical || isMedicalCategory(record.categoriaGrupo, record.tipoDocumento);
      if (isMedical && viewerRole === 'admin') {
        await logSmartDocAudit({
          usuarioNome: req.authUser!.nome,
          usuarioEmail: req.authUser!.email,
          acao: 'Acesso a Documento Médico (LGPD)',
          entidadeId: record.id,
          detalhes: `Administrador ${req.authUser!.nome} acessou visualização clínica de ${record.tipoDocumento} (${record.colaboradorNome || record.arquivoNome}).`,
        });
      }

      const dynamicValidity = computeSmartDocValidityStatus(record.status, record.dadosExtraidos || {});
      return res.json({
        success: true,
        item: applyLgpdProjection(
          { ...record, statusValidade: dynamicValidity },
          viewerRole,
          { includeFileUrl: true }
        ),
      });
    } catch (err: any) {
      console.error('[SmartDocs] Erro ao carregar detalhe:', err);
      return res.status(500).json({ success: false, message: 'Erro ao carregar detalhes do documento.' });
    }
  });

  app.post('/api/smartdocs/process', requireAuthenticatedEditor, async (req: AuthenticatedRequest, res: Response) => {
    const {
      fileName,
      mimeType,
      dataUrl,
      manualCategoriaGrupo,
      manualTipoDocumento,
      manualEmpresaId,
      manualColaboradorId,
    } = req.body || {};

    try {
      const validatedFile = validateUploadedFile({
        fileName: typeof fileName === 'string' ? fileName : '',
        mimeType: typeof mimeType === 'string' ? mimeType : '',
        dataUrl: typeof dataUrl === 'string' ? dataUrl : '',
      });

      // Prevent duplicate submission of identical binary document
      const duplicate = await findDuplicateBySha256(validatedFile.sha256);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_DOCUMENT',
          existingId: duplicate.id,
          message: `Documento duplicado detectado: o arquivo "${duplicate.arquivoNome}" (status: ${duplicate.status}) já possui o mesmo conteúdo.`,
        });
      }

      const nowIso = new Date().toISOString();
      const docId = `sdoc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const inlineStoredUrl =
        validatedFile.cleanDataUrl.length <= MAX_FIRESTORE_INLINE_DATAURL_CHARS
          ? validatedFile.cleanDataUrl
          : '';
      const previewTruncated = !inlineStoredUrl;

      const forcedEmpresaId =
        req.authUser!.role === 'solicitante' ? req.officialProfile?.empresaId || '' : undefined;

      const baseHistory: SmartDocHistoryEntry[] = [
        {
          dataHora: nowIso,
          usuarioId: req.authUser!.sub,
          usuarioNome: req.authUser!.nome,
          usuarioRole: req.authUser!.role,
          acao: 'ENVIO_INICIAL',
          detalhes: `Arquivo "${fileName}" (${Math.round(validatedFile.sizeBytes / 1024)} KB) enviado para leitura inteligente.`,
        },
      ];

      // Execute real OCR + Gemini AI extraction
      try {
        const aiResult = await runGeminiDocumentExtraction({
          base64Data: validatedFile.base64Data,
          mimeType: validatedFile.mimeType,
          fileName: String(fileName),
          manualClassification:
            manualTipoDocumento || manualCategoriaGrupo
              ? {
                  categoriaGrupo: manualCategoriaGrupo,
                  tipoDocumento: manualTipoDocumento,
                }
              : undefined,
        });

        const finalCategoria: SmartDocCategoryGroup =
          manualCategoriaGrupo && manualTipoDocumento ? manualCategoriaGrupo : aiResult.categoriaGrupo;
        const finalTipo =
          typeof manualTipoDocumento === 'string' && manualTipoDocumento.trim()
            ? manualTipoDocumento.trim()
            : aiResult.tipoDocumento;

        const dadosWithRules = await applyConfiguredValidityRule(aiResult.dadosExtraidos, finalTipo);

        const linking = await linkToContractorsRegistry({
          dados: dadosWithRules,
          forcedEmpresaId,
          manualEmpresaId: typeof manualEmpresaId === 'string' ? manualEmpresaId : undefined,
          manualColaboradorId: typeof manualColaboradorId === 'string' ? manualColaboradorId : undefined,
        });

        // If Solicitante uploaded a document with CNPJ of a different company, flag scope warning
        if (
          forcedEmpresaId &&
          linking.matchedCompany &&
          dadosWithRules.cnpj &&
          linking.matchedCompany.cnpj.replace(/\D/g, '') !== dadosWithRules.cnpj.replace(/\D/g, '')
        ) {
          linking.extraInconsistencies.push({
            codigo: 'EMPRESA_FORA_ESCOPO',
            severidade: 'alta',
            campo: 'cnpj',
            mensagem: 'O CNPJ extraído do documento pertence a outra empresa fora do escopo do usuário solicitante.',
          });
        }

        const camposNaoIdentificados = computeUnidentifiedFields(finalCategoria, dadosWithRules);
        const inconsistencias = computeSmartDocInconsistencies({
          categoriaGrupo: finalCategoria,
          dados: dadosWithRules,
          empresaId: linking.empresaId,
          colaboradorId: linking.colaboradorId,
          linkInconsistencies: linking.extraInconsistencies,
        });

        const isMedical = isMedicalCategory(finalCategoria, finalTipo);
        const completedIso = new Date().toISOString();

        const record: SmartDocRecord = {
          id: docId,
          arquivoNome: String(fileName).trim().slice(0, 240),
          arquivoMimeType: validatedFile.mimeType,
          arquivoTamanhoBytes: validatedFile.sizeBytes,
          arquivoHashSha256: validatedFile.sha256,
          arquivoUrl: inlineStoredUrl,
          previewTruncated,
          previewIndisponivelMotivo: previewTruncated
            ? 'Arquivo superior a 500 KB: leitura integral pela IA concluída; preview inline omitido para respeitar limite do banco documental.'
            : '',
          categoriaGrupo: finalCategoria,
          tipoDocumento: finalTipo,
          classificacaoManual: Boolean(manualTipoDocumento),
          classificacaoConfianca: aiResult.classificacaoConfianca,
          status: 'PENDENTE_APROVACAO',
          statusValidade: 'PENDENTE_APROVACAO',
          empresaId: linking.empresaId,
          empresaNome: linking.empresaNome,
          empresaMatchMetodo: linking.empresaMatchMetodo,
          colaboradorId: linking.colaboradorId,
          colaboradorNome: linking.colaboradorNome,
          colaboradorMatchMetodo: linking.colaboradorMatchMetodo,
          dadosExtraidos: dadosWithRules,
          camposNaoIdentificados,
          inconsistencias,
          isSensitiveMedical: isMedical,
          enviadoPorId: req.authUser!.sub,
          enviadoPorNome: req.authUser!.nome,
          enviadoPorEmail: req.authUser!.email,
          dataEnvio: nowIso,
          historico: [
            ...baseHistory,
            {
              dataHora: completedIso,
              usuarioId: 'smartdocs-ai',
              usuarioNome: 'Motor OCR + Gemini AI',
              usuarioRole: 'admin',
              acao: 'PROCESSAMENTO_IA',
              detalhes: `Documento classificado como "${finalTipo}" (${aiResult.classificacaoConfianca}% confiança). Campos não identificados: ${camposNaoIdentificados.length}. Inconsistências: ${inconsistencias.length}.`,
            },
          ],
          createdAt: nowIso,
          updatedAt: completedIso,
        };

        await saveSmartDocRecord(record);
        await logSmartDocAudit({
          usuarioNome: req.authUser!.nome,
          usuarioEmail: req.authUser!.email,
          acao: 'Leitura Inteligente SmartDocs',
          entidadeId: docId,
          detalhes: `Arquivo "${record.arquivoNome}" processado como ${finalTipo} e colocado em PENDENTE DE APROVAÇÃO.`,
        });

        return res.status(201).json({
          success: true,
          message: 'Documento lido e estruturado com sucesso. Aguardando aprovação técnica.',
          item: applyLgpdProjection(record, req.authUser!.role, { includeFileUrl: true }),
        });
      } catch (aiErr: any) {
        const failedIso = new Date().toISOString();
        const isConfigErr = aiErr instanceof SmartDocsAiConfigError;
        const safeErrMessage = aiErr?.message || 'Falha durante processamento OCR/IA do documento.';

        const failedRecord: SmartDocRecord = {
          id: docId,
          arquivoNome: String(fileName).trim().slice(0, 240),
          arquivoMimeType: validatedFile.mimeType,
          arquivoTamanhoBytes: validatedFile.sizeBytes,
          arquivoHashSha256: validatedFile.sha256,
          arquivoUrl: inlineStoredUrl,
          previewTruncated,
          previewIndisponivelMotivo: previewTruncated
            ? 'Arquivo superior a 500 KB: preview inline omitido.'
            : '',
          categoriaGrupo: manualCategoriaGrupo || 'outros',
          tipoDocumento:
            typeof manualTipoDocumento === 'string' && manualTipoDocumento.trim()
              ? manualTipoDocumento.trim()
              : 'Documento não listado',
          classificacaoManual: Boolean(manualTipoDocumento),
          classificacaoConfianca: 0,
          status: 'ERRO_LEITURA',
          statusValidade: 'PENDENTE_APROVACAO',
          erroLeitura: safeErrMessage,
          empresaId: forcedEmpresaId || '',
          empresaNome:
            req.authUser!.role === 'solicitante' ? req.officialProfile?.empresaNome || '' : '',
          empresaMatchMetodo: forcedEmpresaId ? 'manual' : 'nao_vinculada',
          colaboradorId: '',
          colaboradorNome: '',
          colaboradorMatchMetodo: 'nao_vinculado',
          dadosExtraidos: {},
          camposNaoIdentificados: [],
          inconsistencias: [
            {
              codigo: 'ERRO_LEITURA_IA',
              severidade: 'alta',
              mensagem: safeErrMessage,
            },
          ],
          isSensitiveMedical: false,
          enviadoPorId: req.authUser!.sub,
          enviadoPorNome: req.authUser!.nome,
          enviadoPorEmail: req.authUser!.email,
          dataEnvio: nowIso,
          historico: [
            ...baseHistory,
            {
              dataHora: failedIso,
              usuarioId: 'smartdocs-ai',
              usuarioNome: 'Motor OCR + Gemini AI',
              usuarioRole: 'admin',
              acao: 'ERRO_PROCESSAMENTO',
              detalhes: safeErrMessage,
            },
          ],
          createdAt: nowIso,
          updatedAt: failedIso,
        };

        await saveSmartDocRecord(failedRecord);
        await logSmartDocAudit({
          usuarioNome: req.authUser!.nome,
          usuarioEmail: req.authUser!.email,
          acao: 'Erro na Leitura SmartDocs',
          entidadeId: docId,
          detalhes: `Falha ao processar "${failedRecord.arquivoNome}": ${safeErrMessage}`,
        });

        return res.status(isConfigErr ? 503 : 502).json({
          success: false,
          code: isConfigErr ? 'GEMINI_API_KEY_MISSING' : 'AI_PROCESSING_FAILED',
          message: safeErrMessage,
          item: applyLgpdProjection(failedRecord, req.authUser!.role, { includeFileUrl: true }),
        });
      }
    } catch (err: any) {
      if (err instanceof SmartDocsValidationError) {
        return res.status(err.statusCode).json({
          success: false,
          code: err.code,
          message: err.message,
        });
      }
      console.error('[SmartDocs Process Error]:', err);
      return res.status(500).json({
        success: false,
        message: err?.message || 'Erro interno ao processar arquivo no SmartDocs.',
      });
    }
  });

  app.post('/api/smartdocs/:id/reprocess', requireAuthenticatedEditor, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await getSmartDocByIdRaw(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
      }
      if (existing.status === 'APROVADO') {
        return res.status(409).json({
          success: false,
          message: 'Documentos já aprovados não podem ser reprocessados.',
        });
      }
      if (
        req.authUser!.role === 'solicitante' &&
        existing.enviadoPorId !== req.authUser!.sub &&
        existing.empresaId !== req.officialProfile?.empresaId
      ) {
        return res.status(403).json({ success: false, message: 'Acesso negado a este documento.' });
      }

      const { fileName, mimeType, dataUrl } = req.body || {};
      let targetMime = existing.arquivoMimeType;
      let targetFileName = existing.arquivoNome;
      let base64Data = '';
      let sha256 = existing.arquivoHashSha256;
      let sizeBytes = existing.arquivoTamanhoBytes;
      let storedUrl = existing.arquivoUrl || '';
      let previewTruncated = Boolean(existing.previewTruncated);

      if (typeof dataUrl === 'string' && dataUrl.trim()) {
        const validated = validateUploadedFile({
          fileName: typeof fileName === 'string' && fileName.trim() ? fileName : existing.arquivoNome,
          mimeType: typeof mimeType === 'string' ? mimeType : existing.arquivoMimeType,
          dataUrl,
        });
        const dup = await findDuplicateBySha256(validated.sha256, existing.id);
        if (dup) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_DOCUMENT',
            message: `O novo arquivo enviado é idêntico ao documento "${dup.arquivoNome}" já cadastrado.`,
          });
        }
        targetMime = validated.mimeType;
        targetFileName = String(fileName || existing.arquivoNome).trim().slice(0, 240);
        base64Data = validated.base64Data;
        sha256 = validated.sha256;
        sizeBytes = validated.sizeBytes;
        storedUrl =
          validated.cleanDataUrl.length <= MAX_FIRESTORE_INLINE_DATAURL_CHARS
            ? validated.cleanDataUrl
            : '';
        previewTruncated = !storedUrl;
      } else if (existing.arquivoUrl) {
        const m = existing.arquivoUrl.match(/^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/);
        if (!m) {
          return res.status(400).json({
            success: false,
            message: 'Arquivo original não disponível inline. Reenvie o arquivo para reprocessamento.',
          });
        }
        base64Data = m[1];
      } else {
        return res.status(400).json({
          success: false,
          message: 'Arquivo excedeu armazenamento inline; selecione novamente o arquivo para reprocessar.',
        });
      }

      try {
        const aiResult = await runGeminiDocumentExtraction({
          base64Data,
          mimeType: targetMime,
          fileName: targetFileName,
          manualClassification: existing.classificacaoManual
            ? { categoriaGrupo: existing.categoriaGrupo, tipoDocumento: existing.tipoDocumento }
            : undefined,
        });

        const finalCategoria = existing.classificacaoManual
          ? existing.categoriaGrupo
          : aiResult.categoriaGrupo;
        const finalTipo = existing.classificacaoManual
          ? existing.tipoDocumento
          : aiResult.tipoDocumento;

        const dadosWithRules = await applyConfiguredValidityRule(aiResult.dadosExtraidos, finalTipo);
        const forcedEmpresaId =
          req.authUser!.role === 'solicitante' ? req.officialProfile?.empresaId || '' : undefined;

        const linking = await linkToContractorsRegistry({
          dados: dadosWithRules,
          forcedEmpresaId,
          manualEmpresaId: existing.empresaId || undefined,
          manualColaboradorId: existing.colaboradorId || undefined,
        });

        const camposNaoIdentificados = computeUnidentifiedFields(finalCategoria, dadosWithRules);
        const inconsistencias = computeSmartDocInconsistencies({
          categoriaGrupo: finalCategoria,
          dados: dadosWithRules,
          empresaId: linking.empresaId,
          colaboradorId: linking.colaboradorId,
          linkInconsistencies: linking.extraInconsistencies,
        });

        const nowIso = new Date().toISOString();
        const updates: Partial<SmartDocRecord> = {
          arquivoNome: targetFileName,
          arquivoMimeType: targetMime,
          arquivoTamanhoBytes: sizeBytes,
          arquivoHashSha256: sha256,
          arquivoUrl: storedUrl,
          previewTruncated,
          categoriaGrupo: finalCategoria,
          tipoDocumento: finalTipo,
          classificacaoConfianca: aiResult.classificacaoConfianca,
          status: 'PENDENTE_APROVACAO',
          statusValidade: 'PENDENTE_APROVACAO',
          erroLeitura: '',
          correcaoSolicitada: false,
          empresaId: linking.empresaId,
          empresaNome: linking.empresaNome,
          empresaMatchMetodo: linking.empresaMatchMetodo,
          colaboradorId: linking.colaboradorId,
          colaboradorNome: linking.colaboradorNome,
          colaboradorMatchMetodo: linking.colaboradorMatchMetodo,
          dadosExtraidos: dadosWithRules,
          camposNaoIdentificados,
          inconsistencias,
          isSensitiveMedical: isMedicalCategory(finalCategoria, finalTipo),
          historico: [
            ...(existing.historico || []),
            {
              dataHora: nowIso,
              usuarioId: req.authUser!.sub,
              usuarioNome: req.authUser!.nome,
              usuarioRole: req.authUser!.role,
              acao: 'REPROCESSAMENTO_IA',
              detalhes: `Reprocessamento inteligente concluído (${aiResult.classificacaoConfianca}% confiança).`,
            },
          ],
          updatedAt: nowIso,
        };

        await updateSmartDocFields(existing.id, updates);
        const updated = { ...existing, ...updates };
        await logSmartDocAudit({
          usuarioNome: req.authUser!.nome,
          usuarioEmail: req.authUser!.email,
          acao: 'Reprocessamento SmartDocs',
          entidadeId: existing.id,
          detalhes: `Documento "${targetFileName}" reprocessado via IA e colocado em PENDENTE DE APROVAÇÃO.`,
        });

        return res.json({
          success: true,
          message: 'Documento reprocessado com sucesso.',
          item: applyLgpdProjection(updated, req.authUser!.role, { includeFileUrl: true }),
        });
      } catch (aiErr: any) {
        const nowIso = new Date().toISOString();
        const isConfigErr = aiErr instanceof SmartDocsAiConfigError;
        const errMsg = aiErr?.message || 'Erro no reprocessamento inteligente.';

        await updateSmartDocFields(existing.id, {
          status: 'ERRO_LEITURA',
          erroLeitura: errMsg,
          historico: [
            ...(existing.historico || []),
            {
              dataHora: nowIso,
              usuarioId: req.authUser!.sub,
              usuarioNome: req.authUser!.nome,
              usuarioRole: req.authUser!.role,
              acao: 'ERRO_PROCESSAMENTO',
              detalhes: errMsg,
            },
          ],
          updatedAt: nowIso,
        });

        return res.status(isConfigErr ? 503 : 502).json({
          success: false,
          code: isConfigErr ? 'GEMINI_API_KEY_MISSING' : 'AI_REPROCESS_FAILED',
          message: errMsg,
        });
      }
    } catch (err: any) {
      if (err instanceof SmartDocsValidationError) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao reprocessar documento.' });
    }
  });

  app.put('/api/smartdocs/:id', requireAuthenticatedEditor, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await getSmartDocByIdRaw(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
      }
      if (existing.status === 'APROVADO' || existing.status === 'REJEITADO') {
        return res.status(409).json({
          success: false,
          message: `Documento com status "${existing.status}" não pode mais ser editado.`,
        });
      }
      if (
        req.authUser!.role === 'solicitante' &&
        existing.enviadoPorId !== req.authUser!.sub &&
        existing.empresaId !== req.officialProfile?.empresaId
      ) {
        return res.status(403).json({ success: false, message: 'Acesso negado a este documento.' });
      }

      const {
        categoriaGrupo,
        tipoDocumento,
        classificacaoManual,
        empresaId,
        colaboradorId,
        dadosExtraidos,
      } = req.body || {};

      const validGroups: SmartDocCategoryGroup[] = [
        'saude_ocupacional',
        'treinamentos',
        'documentos_empresariais',
        'outros',
      ];
      const nextCategoria: SmartDocCategoryGroup = validGroups.includes(categoriaGrupo)
        ? categoriaGrupo
        : existing.categoriaGrupo;
      const nextTipo =
        typeof tipoDocumento === 'string' && tipoDocumento.trim()
          ? tipoDocumento.trim()
          : existing.tipoDocumento;

      const incomingDados: SmartDocExtractedData = {
        ...(existing.dadosExtraidos || {}),
        ...(dadosExtraidos && typeof dadosExtraidos === 'object' ? dadosExtraidos : {}),
      };

      // Protect clinical fields from accidental overwrite by non-admin solicitante
      const isMedical = isMedicalCategory(nextCategoria, nextTipo);
      if (isMedical && req.authUser!.role !== 'admin') {
        incomingDados.resultadoAptidao = existing.dadosExtraidos?.resultadoAptidao || '';
        incomingDados.medicoResponsavel = existing.dadosExtraidos?.medicoResponsavel || '';
        incomingDados.crm = existing.dadosExtraidos?.crm || '';
        incomingDados.observacoes = existing.dadosExtraidos?.observacoes || '';
      }

      if (incomingDados.dataRealizacao) incomingDados.dataRealizacao = normalizeIsoDate(incomingDados.dataRealizacao);
      if (incomingDados.dataEmissao) incomingDados.dataEmissao = normalizeIsoDate(incomingDados.dataEmissao);
      if (incomingDados.dataRevisao) incomingDados.dataRevisao = normalizeIsoDate(incomingDados.dataRevisao);
      if (incomingDados.dataValidade) incomingDados.dataValidade = normalizeIsoDate(incomingDados.dataValidade);
      if (incomingDados.semValidade) {
        incomingDados.dataValidade = '';
      } else if (
        dadosExtraidos?.dataValidade !== undefined &&
        dadosExtraidos.dataValidade !== existing.dadosExtraidos?.dataValidade
      ) {
        incomingDados.validadeOrigem = dadosExtraidos.dataValidade ? 'manual' : 'nao_identificada';
      }

      const forcedEmpresaId =
        req.authUser!.role === 'solicitante' ? req.officialProfile?.empresaId || '' : undefined;

      const nextManualEmpresaId =
        typeof empresaId === 'string' ? empresaId : existing.empresaId || '';
      const nextManualColabId =
        typeof colaboradorId === 'string' ? colaboradorId : existing.colaboradorId || '';

      const linking = await linkToContractorsRegistry({
        dados: incomingDados,
        forcedEmpresaId,
        manualEmpresaId: nextManualEmpresaId || undefined,
        manualColaboradorId: nextManualColabId || undefined,
      });

      const finalEmpresaId = nextManualEmpresaId ? linking.empresaId : '';
      const finalEmpresaNome = nextManualEmpresaId ? linking.empresaNome : '';
      const finalColabId = nextManualColabId ? linking.colaboradorId : '';
      const finalColabNome = nextManualColabId ? linking.colaboradorNome : '';

      const camposNaoIdentificados = computeUnidentifiedFields(nextCategoria, incomingDados);
      const inconsistencias = computeSmartDocInconsistencies({
        categoriaGrupo: nextCategoria,
        dados: incomingDados,
        empresaId: finalEmpresaId,
        colaboradorId: finalColabId,
        linkInconsistencies: linking.extraInconsistencies,
      });

      // Compute changed fields for history
      const changedFields: string[] = [];
      if (nextCategoria !== existing.categoriaGrupo) changedFields.push('categoriaGrupo');
      if (nextTipo !== existing.tipoDocumento) changedFields.push('tipoDocumento');
      if (finalEmpresaId !== (existing.empresaId || '')) changedFields.push('empresaId');
      if (finalColabId !== (existing.colaboradorId || '')) changedFields.push('colaboradorId');
      for (const [k, v] of Object.entries(incomingDados)) {
        if ((existing.dadosExtraidos as any)?.[k] !== v) {
          changedFields.push(k);
        }
      }

      const nowIso = new Date().toISOString();
      const updates: Partial<SmartDocRecord> = {
        categoriaGrupo: nextCategoria,
        tipoDocumento: nextTipo,
        classificacaoManual:
          typeof classificacaoManual === 'boolean' ? classificacaoManual : existing.classificacaoManual || nextTipo !== existing.tipoDocumento,
        empresaId: finalEmpresaId,
        empresaNome: finalEmpresaNome,
        empresaMatchMetodo: nextManualEmpresaId && nextManualEmpresaId !== existing.empresaId ? 'manual' : existing.empresaMatchMetodo,
        colaboradorId: finalColabId,
        colaboradorNome: finalColabNome,
        colaboradorMatchMetodo: nextManualColabId && nextManualColabId !== existing.colaboradorId ? 'manual' : existing.colaboradorMatchMetodo,
        dadosExtraidos: incomingDados,
        camposNaoIdentificados,
        inconsistencias,
        isSensitiveMedical: isMedical,
        status: existing.status === 'ERRO_LEITURA' ? 'PENDENTE_APROVACAO' : existing.status,
        historico: [
          ...(existing.historico || []),
          {
            dataHora: nowIso,
            usuarioId: req.authUser!.sub,
            usuarioNome: req.authUser!.nome,
            usuarioRole: req.authUser!.role,
            acao: 'EDICAO_MANUAL',
            detalhes:
              changedFields.length > 0
                ? `Campos revisados/editados (${changedFields.join(', ')}).`
                : 'Conferência salva sem alteração de valores.',
            camposAlterados: changedFields,
          },
        ],
        updatedAt: nowIso,
      };

      await updateSmartDocFields(existing.id, updates);
      const updated = { ...existing, ...updates };
      await logSmartDocAudit({
        usuarioNome: req.authUser!.nome,
        usuarioEmail: req.authUser!.email,
        acao: 'Edição SmartDocs',
        entidadeId: existing.id,
        detalhes: `Dados do documento "${existing.arquivoNome}" atualizados antes da aprovação (${changedFields.join(', ') || 'sem mudanças'}).`,
      });

      return res.json({
        success: true,
        message: 'Alterações salvas com sucesso.',
        item: applyLgpdProjection(updated, req.authUser!.role, { includeFileUrl: true }),
      });
    } catch (err: any) {
      console.error('[SmartDocs Update Error]:', err);
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao salvar edição.' });
    }
  });

  app.post('/api/smartdocs/:id/approve', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await getSmartDocByIdRaw(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
      }
      if (existing.status === 'APROVADO') {
        return res.status(409).json({
          success: false,
          message: 'Este documento já foi aprovado e integrado anteriormente.',
        });
      }

      const body = req.body || {};
      const finalCategoria: SmartDocCategoryGroup = body.categoriaGrupo || existing.categoriaGrupo;
      const finalTipo: string =
        typeof body.tipoDocumento === 'string' && body.tipoDocumento.trim()
          ? body.tipoDocumento.trim()
          : existing.tipoDocumento;

      const finalDados: SmartDocExtractedData = {
        ...(existing.dadosExtraidos || {}),
        ...(body.dadosExtraidos && typeof body.dadosExtraidos === 'object' ? body.dadosExtraidos : {}),
      };
      if (finalDados.dataRealizacao) finalDados.dataRealizacao = normalizeIsoDate(finalDados.dataRealizacao);
      if (finalDados.dataEmissao) finalDados.dataEmissao = normalizeIsoDate(finalDados.dataEmissao);
      if (finalDados.dataValidade) finalDados.dataValidade = normalizeIsoDate(finalDados.dataValidade);
      if (finalDados.semValidade) finalDados.dataValidade = '';

      const targetEmpresaId =
        typeof body.empresaId === 'string' ? body.empresaId.trim() : existing.empresaId || '';
      const targetColaboradorId =
        typeof body.colaboradorId === 'string' ? body.colaboradorId.trim() : existing.colaboradorId || '';

      if (!targetEmpresaId) {
        return res.status(400).json({
          success: false,
          message: 'Vincule uma Empresa Contratada antes de aprovar o documento.',
        });
      }

      const compSnap = await getDoc(doc(db, 'companies', targetEmpresaId));
      if (!compSnap.exists()) {
        return res.status(400).json({ success: false, message: 'Empresa vinculada não encontrada no cadastro.' });
      }
      const company = compSnap.data() as Company;

      let employee: Employee | null = null;
      if (targetColaboradorId) {
        const empSnap = await getDoc(doc(db, 'employees', targetColaboradorId));
        if (!empSnap.exists()) {
          return res.status(400).json({ success: false, message: 'Colaborador vinculado não encontrado.' });
        }
        employee = empSnap.data() as Employee;
      }

      const nowIso = new Date().toISOString();
      const analisadoPorNome = req.authUser!.nome;

      let integratedCollection: 'exams' | 'trainings' | 'documents';
      let integratedDocId: string;

      if (finalCategoria === 'saude_ocupacional') {
        if (!employee) {
          return res.status(400).json({
            success: false,
            message: 'Documentos de Saúde Ocupacional / ASO exigem vínculo com um Colaborador antes da aprovação.',
          });
        }
        if (!finalDados.dataRealizacao) {
          return res.status(400).json({
            success: false,
            message: 'Informe a Data de Realização do exame/ASO antes de aprovar.',
          });
        }
        const conclusao = finalDados.resultadoAptidao || 'apto';
        if (!['apto', 'inapto', 'apto_com_restricoes'].includes(conclusao)) {
          return res.status(400).json({
            success: false,
            message: 'Selecione a conclusão de aptidão (Apto, Inapto ou Apto com restrições).',
          });
        }

        const examPayload: Omit<OccupationalExam, 'id'> = removeUndefinedDeep({
          tipoExame: finalDados.tipoExame || finalTipo || 'ASO Periódico',
          colaboradorId: targetColaboradorId,
          colaboradorNome: employee.nomeCompleto,
          empresaId: targetEmpresaId,
          empresaNome: company.razaoSocial,
          dataRealizacao: finalDados.dataRealizacao,
          dataValidade: finalDados.semValidade ? '' : finalDados.dataValidade || '',
          semValidade: Boolean(finalDados.semValidade),
          medicoResponsavel: finalDados.medicoResponsavel || '',
          crmMedico: finalDados.crm || '',
          conclusao: conclusao as OccupationalExam['conclusao'],
          anexoUrl: existing.arquivoUrl || '',
          anexoNome: existing.arquivoNome,
          observacoes:
            finalDados.observacoes ||
            `Integrado via EHS SmartDocs (${finalTipo}).`,
          situacao: 'aprovado',
          analisadoPor: analisadoPorNome,
          dataAnalise: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const examRef = await addDoc(collection(db, 'exams'), examPayload);
        integratedCollection = 'exams';
        integratedDocId = examRef.id;
      } else if (finalCategoria === 'treinamentos') {
        if (!employee) {
          return res.status(400).json({
            success: false,
            message: 'Certificados e treinamentos exigem vínculo com um Colaborador antes da aprovação.',
          });
        }
        if (!finalDados.dataRealizacao) {
          return res.status(400).json({
            success: false,
            message: 'Informe a Data de Realização do treinamento antes de aprovar.',
          });
        }

        const nomeTreinamento = (
          finalDados.nomeTreinamento ||
          finalDados.nrCorrespondente ||
          finalTipo
        ).trim();

        const trainingPayload: Omit<Training, 'id'> = removeUndefinedDeep({
          nomeTreinamento,
          colaboradorId: targetColaboradorId,
          colaboradorNome: employee.nomeCompleto,
          empresaId: targetEmpresaId,
          empresaNome: company.razaoSocial,
          instituicaoResponsavel: finalDados.instituicaoEmissora || '',
          instrutor: finalDados.nomeInstrutor
            ? `${finalDados.nomeInstrutor}${finalDados.registroProfissionalInstrutor ? ` (${finalDados.registroProfissionalInstrutor})` : ''}`
            : '',
          dataRealizacao: finalDados.dataRealizacao,
          cargaHoraria: finalDados.cargaHoraria || '',
          dataValidade: finalDados.semValidade ? '' : finalDados.dataValidade || '',
          semValidade: Boolean(finalDados.semValidade),
          certificadoUrl: existing.arquivoUrl || '',
          certificadoNome: existing.arquivoNome,
          observacoes:
            finalDados.observacoes ||
            `Integrado via EHS SmartDocs (${finalTipo}).`,
          situacao: 'aprovado',
          analisadoPor: analisadoPorNome,
          dataAnalise: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const trnRef = await addDoc(collection(db, 'trainings'), trainingPayload);
        integratedCollection = 'trainings';
        integratedDocId = trnRef.id;
      } else {
        const nomeDocumento = (
          finalDados.nomeDocumento ||
          finalTipo ||
          existing.arquivoNome
        ).trim();

        const docPayload: Omit<DocumentSST, 'id'> = removeUndefinedDeep({
          nomeDocumento,
          categoria: finalCategoria === 'documentos_empresariais' ? 'Documento Empresarial' : 'Outros',
          empresaId: targetEmpresaId,
          empresaNome: company.razaoSocial,
          colaboradorId: targetColaboradorId || '',
          colaboradorNome: employee ? employee.nomeCompleto : '',
          numeroDocumento: finalDados.numeroDocumento || '',
          dataEmissao: finalDados.dataEmissao || finalDados.dataRealizacao || nowIso.split('T')[0],
          dataValidade: finalDados.semValidade ? '' : finalDados.dataValidade || '',
          semValidade: Boolean(finalDados.semValidade),
          responsavelEnvio: existing.enviadoPorNome,
          arquivoUrl: existing.arquivoUrl || '',
          arquivoNome: existing.arquivoNome,
          observacoes:
            finalDados.observacoes ||
            `RT: ${finalDados.responsavelTecnico || 'Não informado'} (${finalDados.registroProfissionalRT || '-'}). Integrado via EHS SmartDocs.`,
          situacao: 'aprovado',
          analisadoPor: analisadoPorNome,
          dataAnalise: nowIso,
          versao: 1,
          historicoVersoes: [
            {
              versao: 1,
              arquivoUrl: existing.arquivoUrl || '',
              arquivoNome: existing.arquivoNome,
              dataEnvio: existing.dataEnvio,
              responsavelEnvio: existing.enviadoPorNome,
              observacoes: 'Aprovado e integrado via EHS SmartDocs',
              situacao: 'aprovado',
              analisadoPor: analisadoPorNome,
              dataAnalise: nowIso,
            },
          ],
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const docRef = await addDoc(collection(db, 'documents'), docPayload);
        integratedCollection = 'documents';
        integratedDocId = docRef.id;
      }

      const camposNaoIdentificados = computeUnidentifiedFields(finalCategoria, finalDados);
      const inconsistencias = computeSmartDocInconsistencies({
        categoriaGrupo: finalCategoria,
        dados: finalDados,
        empresaId: targetEmpresaId,
        colaboradorId: targetColaboradorId,
      });
      const statusValidade = computeSmartDocValidityStatus('APROVADO', finalDados);

      const updates: Partial<SmartDocRecord> = {
        categoriaGrupo: finalCategoria,
        tipoDocumento: finalTipo,
        empresaId: targetEmpresaId,
        empresaNome: company.razaoSocial,
        colaboradorId: targetColaboradorId,
        colaboradorNome: employee ? employee.nomeCompleto : '',
        dadosExtraidos: finalDados,
        camposNaoIdentificados,
        inconsistencias,
        status: 'APROVADO',
        statusValidade,
        correcaoSolicitada: false,
        motivoCorrecao: '',
        motivoRejeicao: '',
        analisadoPorId: req.authUser!.sub,
        analisadoPorNome,
        dataAnalise: nowIso,
        integratedCollection,
        integratedDocId,
        isSensitiveMedical: isMedicalCategory(finalCategoria, finalTipo),
        historico: [
          ...(existing.historico || []),
          {
            dataHora: nowIso,
            usuarioId: req.authUser!.sub,
            usuarioNome: analisadoPorNome,
            usuarioRole: req.authUser!.role,
            acao: 'APROVACAO',
            detalhes: `Documento aprovado definitivamente e integrado à coleção "${integratedCollection}" (ID: ${integratedDocId}).`,
          },
        ],
        updatedAt: nowIso,
      };

      await updateSmartDocFields(existing.id, updates);
      const updated = { ...existing, ...updates };

      await logSmartDocAudit({
        usuarioNome: analisadoPorNome,
        usuarioEmail: req.authUser!.email,
        acao: 'Aprovação Definitiva SmartDocs',
        entidadeId: existing.id,
        detalhes: `Documento "${existing.arquivoNome}" aprovado por ${analisadoPorNome} e integrado em ${integratedCollection}/${integratedDocId}.`,
      });

      return res.json({
        success: true,
        message: 'Documento aprovado definitivamente e integrado ao módulo oficial!',
        integratedCollection,
        integratedDocId,
        item: applyLgpdProjection(updated, req.authUser!.role, { includeFileUrl: true }),
      });
    } catch (err: any) {
      console.error('[SmartDocs Approve Error]:', err);
      return res.status(500).json({
        success: false,
        message: err?.message || 'Erro ao aprovar e integrar documento.',
      });
    }
  });

  app.post('/api/smartdocs/:id/request-correction', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
      return res.status(400).json({
        success: false,
        message: 'Informe obrigatoriamente o motivo/orientação para solicitar correção.',
      });
    }

    try {
      const existing = await getSmartDocByIdRaw(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
      }
      if (existing.status === 'APROVADO') {
        return res.status(409).json({
          success: false,
          message: 'Documento já aprovado não pode voltar para correção.',
        });
      }

      const nowIso = new Date().toISOString();
      const analisadoPorNome = req.authUser!.nome;
      const updates: Partial<SmartDocRecord> = {
        status: 'PENDENTE_APROVACAO',
        statusValidade: 'PENDENTE_APROVACAO',
        correcaoSolicitada: true,
        motivoCorrecao: motivo,
        analisadoPorId: req.authUser!.sub,
        analisadoPorNome,
        dataAnalise: nowIso,
        historico: [
          ...(existing.historico || []),
          {
            dataHora: nowIso,
            usuarioId: req.authUser!.sub,
            usuarioNome: analisadoPorNome,
            usuarioRole: req.authUser!.role,
            acao: 'SOLICITACAO_CORRECAO',
            detalhes: `Correção solicitada por ${analisadoPorNome}: ${motivo}`,
          },
        ],
        updatedAt: nowIso,
      };

      await updateSmartDocFields(existing.id, updates);
      const updated = { ...existing, ...updates };
      await logSmartDocAudit({
        usuarioNome: analisadoPorNome,
        usuarioEmail: req.authUser!.email,
        acao: 'Solicitação de Correção SmartDocs',
        entidadeId: existing.id,
        detalhes: `Correção solicitada em "${existing.arquivoNome}". Motivo: ${motivo}`,
      });

      return res.json({
        success: true,
        message: 'Solicitação de correção registrada com sucesso.',
        item: applyLgpdProjection(updated, req.authUser!.role, { includeFileUrl: true }),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao solicitar correção.' });
    }
  });

  app.post('/api/smartdocs/:id/reject', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
      return res.status(400).json({
        success: false,
        message: 'A justificativa técnica é obrigatória para rejeitar um documento.',
      });
    }

    try {
      const existing = await getSmartDocByIdRaw(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Documento não encontrado.' });
      }
      if (existing.status === 'APROVADO') {
        return res.status(409).json({
          success: false,
          message: 'Documento já aprovado não pode ser rejeitado.',
        });
      }

      const nowIso = new Date().toISOString();
      const analisadoPorNome = req.authUser!.nome;
      const updates: Partial<SmartDocRecord> = {
        status: 'REJEITADO',
        statusValidade: 'REJEITADO',
        correcaoSolicitada: false,
        motivoRejeicao: motivo,
        analisadoPorId: req.authUser!.sub,
        analisadoPorNome,
        dataAnalise: nowIso,
        historico: [
          ...(existing.historico || []),
          {
            dataHora: nowIso,
            usuarioId: req.authUser!.sub,
            usuarioNome: analisadoPorNome,
            usuarioRole: req.authUser!.role,
            acao: 'REJEICAO',
            detalhes: `Documento rejeitado por ${analisadoPorNome}. Justificativa: ${motivo}`,
          },
        ],
        updatedAt: nowIso,
      };

      await updateSmartDocFields(existing.id, updates);
      const updated = { ...existing, ...updates };
      await logSmartDocAudit({
        usuarioNome: analisadoPorNome,
        usuarioEmail: req.authUser!.email,
        acao: 'Rejeição SmartDocs',
        entidadeId: existing.id,
        detalhes: `Documento "${existing.arquivoNome}" rejeitado. Justificativa: ${motivo}`,
      });

      return res.json({
        success: true,
        message: 'Documento rejeitado. Nenhuma alteração definitiva foi aplicada aos cadastros oficiais.',
        item: applyLgpdProjection(updated, req.authUser!.role, { includeFileUrl: true }),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Erro ao rejeitar documento.' });
    }
  });

  return app;
}
