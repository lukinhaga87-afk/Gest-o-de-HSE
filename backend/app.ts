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
import type { UserProfile } from '../src/types/sst';

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
    } else if (req.url.startsWith('/notifications/') || req.url.startsWith('/auth/')) {
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

      if (typeof newPassword === 'string' && newPassword.trim().length > 0) {
        updatePayload.passwordHash = await hashPasswordBcrypt(newPassword);
        updatePayload.hashAlgorithm = 'bcrypt';
        updatePayload.passwordResetRequired = false;
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

  return app;
}
