import express, { Request, Response } from 'express';
import { collection, addDoc } from 'firebase/firestore';
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
  requireAdmin,
  requireAuthenticatedEditor,
  AuthenticatedRequest,
} from './authMiddleware';

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
  // AUTHENTICATION SESSION EXCHANGE (Issues HMAC-signed Bearer token for APIs)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/session', async (req: Request, res: Response) => {
    const { cpfOrIdentifier, password, userId, passwordHash } = req.body || {};

    if (!cpfOrIdentifier && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de usuário obrigatório.',
      });
    }

    if (!password && !passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'Credenciais obrigatórias para emissão de sessão.',
      });
    }

    try {
      const authenticated = await authenticateUserCredentials({
        cpfOrIdentifier,
        password,
        userId,
        passwordHash,
      });

      if (!authenticated) {
        return res.status(401).json({
          success: false,
          message: 'Credenciais inválidas.',
        });
      }

      const { token, expiresAt } = signAuthToken(authenticated);
      return res.json({
        success: true,
        token,
        expiresAt,
        role: authenticated.role,
      });
    } catch (err: any) {
      console.error('[API auth/session Error]:', err);
      return res.status(500).json({
        success: false,
        message: 'Erro ao validar sessão no servidor.',
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
