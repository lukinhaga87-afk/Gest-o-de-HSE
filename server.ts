import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  executeDailyNotificationMonitoring,
  db,
} from './backend/notificationEngine';
import {
  sendNotificationEmail,
  sendCustomEmail,
  sendTestEmailDirect,
  verifySmtpConnection,
  isSmtpConfigured,
} from './backend/emailService';
import { collection, addDoc, getDocs } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env reliably
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

// API Routes for Automatic Notifications Module
app.post('/api/notifications/save-smtp-config', async (req: Request, res: Response) => {
  const { host, port, user, pass, from, secure } = req.body;

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let currentContent = '';
    if (fs.existsSync(envPath)) {
      currentContent = fs.readFileSync(envPath, 'utf-8');
    }

    const updates: Record<string, string> = {
      SMTP_HOST: host !== undefined ? host.trim() : process.env.SMTP_HOST || '',
      SMTP_PORT: port !== undefined ? String(port).trim() : process.env.SMTP_PORT || '587',
      SMTP_USER: user !== undefined ? user.trim() : process.env.SMTP_USER || '',
      SMTP_PASS: pass !== undefined ? pass.trim() : process.env.SMTP_PASS || '',
      SMTP_FROM: from !== undefined ? from.trim() : process.env.SMTP_FROM || 'Gestão SST <notificacoes.sst@gmail.com>',
      SMTP_SECURE: secure !== undefined ? String(secure) : process.env.SMTP_SECURE || 'false',
    };

    // Update in-memory process.env immediately
    for (const [k, v] of Object.entries(updates)) {
      process.env[k] = v;
    }

    // Update .env file contents
    let lines = currentContent.split('\n');
    for (const [key, val] of Object.entries(updates)) {
      const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
      const lineStr = `${key}="${val.replace(/"/g, '\\"')}"`;
      if (idx >= 0) {
        lines[idx] = lineStr;
      } else {
        lines.push(lineStr);
      }
    }
    fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');

    // Also write to __dirname/.env if different
    const dirnameEnv = path.resolve(__dirname, '.env');
    if (dirnameEnv !== envPath) {
      try {
        fs.writeFileSync(dirnameEnv, lines.join('\n'), 'utf-8');
      } catch (_) {}
    }

    // Test connection if host and user provided
    let verifyResult = { connected: false, message: 'Credenciais salvas no arquivo de configuração (.env).' };
    if (isSmtpConfigured()) {
      verifyResult = await verifySmtpConnection();
    }

    res.json({
      success: true,
      message: 'Configurações SMTP salvas com sucesso no servidor.',
      verification: verifyResult,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Erro ao salvar configurações SMTP: ${err.message || String(err)}`,
    });
  }
});

app.post('/api/notifications/custom-send', async (req: Request, res: Response) => {
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
  } = req.body;

  if (!to || !Array.isArray(to) || to.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Não foi possível realizar o envio. Informe pelo menos um destinatário válido.',
    });
  }

  // Filter only valid emails
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

    const result = await sendCustomEmail({
      to: validRecipients,
      companyId,
      companyName: finalCompany,
      subject: finalSubject,
      message: finalMessage,
      attachmentName,
      attachmentDataUrl,
      senderName,
      senderEmail,
    });

    // Record log in notificationLogs with full details
    try {
      await addDoc(collection(db, 'notificationLogs'), {
        dataHora: new Date().toISOString(),
        destinatarios: validRecipients,
        destinatariosDetalhados: Array.isArray(recipientsDetails) && recipientsDetails.length > 0
          ? recipientsDetails
          : validRecipients.map((em: string) => ({
              nome: em.split('@')[0],
              email: em,
              empresa: finalCompany,
              tipo: 'usuario' as const,
            })),
        documentoId: 'disparo-avulso',
        documentoTitulo: finalSubject,
        categoria: 'Comunicação Avulsa',
        empresaId: companyId || '',
        empresaNome: finalCompany,
        colaboradorNome: senderName || 'Administrador',
        usuarioResponsavel: senderName || 'Administrador',
        assunto: finalSubject,
        tipoEnvio: 'avulso',
        marco: 'avulso',
        dataVencimento: '',
        diasRestantes: 0,
        status: result.status,
        mensagem: finalMessage.substring(0, 500),
        erro: result.error || '',
        motivoFalha: result.error || '',
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

app.get('/api/notifications/health', async (_req: Request, res: Response) => {
  const smtpActive = isSmtpConfigured();
  res.json({
    status: 'online',
    service: 'Gestão SST - Serviço de Notificações Automáticas',
    scheduler: 'Ativo (Ciclo Diário no Backend)',
    serverTime: new Date().toISOString(),
    smtp: {
      configured: smtpActive,
      host: process.env.SMTP_HOST || 'Não configurado',
      port: process.env.SMTP_PORT || '587',
      user: process.env.SMTP_USER || 'Não configurado',
      from: process.env.SMTP_FROM || 'Gestão SST <notificacoes.sst@gmail.com>',
      mode: smtpActive ? 'SMTP Real Ativo' : 'Não configurado (Requer SMTP no .env)',
    },
  });
});

app.post('/api/notifications/verify-smtp', async (_req: Request, res: Response) => {
  try {
    const result = await verifySmtpConnection();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ connected: false, message: err.message || 'Erro ao verificar conexão SMTP.' });
  }
});

app.post('/api/notifications/test-email', async (req: Request, res: Response) => {
  const { recipient, subject, message, senderName } = req.body;

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
    const finalMessage = (message || '').trim() || 'Esta é uma mensagem de validação imediata enviada pelo sistema Gestão SST para confirmar o funcionamento do servidor de e-mail.';

    const result = await sendTestEmailDirect({
      recipient: trimmedRecipient,
      subject: finalSubject,
      message: finalMessage,
      senderName: senderName || 'Administrador',
    });

    const logRecord = {
      dataHora: new Date().toISOString(),
      destinatarios: [trimmedRecipient],
      destinatariosDetalhados: [
        {
          nome: senderName || 'Destinatário de Teste',
          email: trimmedRecipient,
          empresa: 'SESMT Central',
          tipo: 'usuario' as const,
        },
      ],
      documentoId: 'teste-smtp',
      documentoTitulo: finalSubject,
      categoria: 'Diagnóstico',
      empresaNome: 'SESMT Central',
      colaboradorNome: senderName || 'Administrador',
      usuarioResponsavel: senderName || 'Administrador',
      assunto: finalSubject,
      tipoEnvio: 'teste' as const,
      marco: 'teste' as const,
      dataVencimento: new Date().toISOString().split('T')[0],
      diasRestantes: 0,
      status: result.status,
      mensagem: finalMessage,
      erro: result.error || '',
      motivoFalha: result.error || '',
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
        message: 'E-mail de teste enviado com sucesso. Verifique a caixa de entrada do destinatário.',
        messageId: result.messageId,
        destinatarios: result.destinatarios,
        detalhes: result.detalhes,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        error: result.error || result.detalhes || 'Falha na comunicação com o servidor SMTP.',
        detalhes: result.detalhes,
      });
    }
  } catch (err: any) {
    console.error('[API test-email Error]:', err);
    return res.status(500).json({
      success: false,
      message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
      error: err.message || String(err),
    });
  }
});

// Run Backend Daily Monitoring On-Demand (or via manual trigger in UI)
app.post('/api/notifications/run-check', async (_req: Request, res: Response) => {
  try {
    const result = await executeDailyNotificationMonitoring();
    res.json({
      success: true,
      message: `Verificação de vencimentos executada com sucesso no backend.`,
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

// Recalculate Alerts Endpoint (called when a document/training/ASO expiration date is updated)
app.post('/api/notifications/recalculate', async (req: Request, res: Response) => {
  const { documentoId, documentoTitulo, novaDataValidade, entidade } = req.body;

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
});

// Start Background Routine (Scheduler in Backend)
function startDailyMonitoringScheduler() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily: every 24 hours

  console.log('[Scheduler Backend] Serviço de monitoramento diário ativado.');

  // Run initial check after 15 seconds to let server boot cleanly
  setTimeout(() => {
    executeDailyNotificationMonitoring().catch((e) =>
      console.error('[Scheduler Initial Check Error]:', e)
    );
  }, 15000);

  // Set recurring daily timer
  setInterval(() => {
    console.log('[Scheduler Recurring Check] Executando rotina diária agendada...');
    executeDailyNotificationMonitoring().catch((e) =>
      console.error('[Scheduler Recurring Check Error]:', e)
    );
  }, INTERVAL_MS);
}

// Vite integration or static dist
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gestão SST] Servidor ativo em http://0.0.0.0:${PORT}`);
    startDailyMonitoringScheduler();
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Erro ao iniciar servidor:', err);
});
