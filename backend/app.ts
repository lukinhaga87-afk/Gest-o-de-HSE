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

  // Writing credentials to .env at runtime is disabled for Netlify serverless security
  app.post('/api/notifications/save-smtp-config', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    return res.status(405).json({
      success: false,
      readOnlyEnv: true,
      message:
        'A gravação de credenciais SMTP em arquivo .env foi desativada por segurança. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM e SMTP_SECURE diretamente nas variáveis de ambiente protegidas do Netlify.',
      smtp: getSafeSmtpDiagnostics(),
    });
  });

  app.post('/api/notifications/verify-smtp', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await verifySmtpConnection();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ connected: false, message: err.message || 'Erro ao verificar conexão SMTP.' });
    }
  });

  app.post('/api/notifications/test-email', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { recipient, subject, message, senderName } = req.body || {};

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

      const result = await sendTestEmailDirect({
        recipient: trimmedRecipient,
        subject: finalSubject,
        message: finalMessage,
        senderName: responsible,
      });

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

  app.post('/api/notifications/run-check', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await executeDailyNotificationMonitoring();
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
