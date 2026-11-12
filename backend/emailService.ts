import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EmailNotificationPayload,
  buildNotificationHtml,
} from '../src/utils/notificationTemplate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env reliably from multiple candidate locations
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export type { EmailNotificationPayload };
export { buildNotificationHtml };

export interface SendResult {
  success: boolean;
  status: 'sucesso' | 'falha' | 'simulado';
  messageId?: string;
  error?: string;
  destinatarios: string[];
  detalhes?: string;
}

export interface CustomEmailOptions {
  to: string[];
  companyId?: string;
  companyName: string;
  subject: string;
  message: string;
  attachmentName?: string;
  attachmentDataUrl?: string;
  senderName?: string;
  senderEmail?: string;
}

/**
 * Checks if real SMTP credentials are fully provided in the environment
 */
export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return Boolean(host && user && pass && host.trim() !== '' && user.trim() !== '');
}

/**
 * Gets the configured SMTP transport
 */
export function getMailTransporter() {
  if (!isSmtpConfigured()) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // Prevents self-signed cert blocks in corporate relays
    },
  });
}

/**
 * Verifies SMTP connection
 */
export async function verifySmtpConnection(): Promise<{ connected: boolean; message: string }> {
  if (!isSmtpConfigured()) {
    return {
      connected: false,
      message: 'Credenciais SMTP não configuradas no arquivo .env (SMTP_HOST, SMTP_USER, SMTP_PASS).',
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) {
      return { connected: false, message: 'Não foi possível inicializar o transporte SMTP.' };
    }
    await transporter.verify();
    return { connected: true, message: 'Conexão SMTP verificada com sucesso!' };
  } catch (err: any) {
    return {
      connected: false,
      message: `Erro na autenticação SMTP: ${err.message || String(err)}`,
    };
  }
}

/**
 * Sends notification email via real SMTP if configured, or performs simulated dispatch
 */
export async function sendNotificationEmail(payload: EmailNotificationPayload): Promise<SendResult> {
  const recipients = payload.to.filter((e) => e && e.includes('@'));

  if (recipients.length === 0) {
    return {
      success: false,
      status: 'falha',
      error: 'Nenhum e-mail de destinatário válido informado.',
      destinatarios: [],
    };
  }

  const subject = `[Gestão SST] ${
    payload.milestone === 'hoje'
      ? '🚨 VENCE HOJE'
      : payload.milestone === '15_dias'
      ? '⚠️ Vence em 15 Dias'
      : '⏳ Vence em 30 Dias'
  }: ${payload.documentTitle} - ${payload.companyName}`;

  const htmlContent = buildNotificationHtml(payload);
  const textContent = `
[Gestão SST - Alerta de Vencimento Documental]
Marco: ${payload.milestone === 'hoje' ? 'VENCE HOJE' : payload.milestone === '15_dias' ? '15 Dias' : '30 Dias'}
Documento: ${payload.documentTitle}
Categoria: ${payload.category}
Empresa: ${payload.companyName}
${payload.employeeName ? `Colaborador: ${payload.employeeName}\n` : ''}
Data de Vencimento: ${payload.expirationDate}
Dias Restantes: ${payload.daysRemaining}

Acesse a plataforma para regularizar: ${payload.appUrl || 'https://gestao-sst.app'}
  `.trim();

  // 1. If SMTP is configured, send real email!
  if (isSmtpConfigured()) {
    try {
      const transporter = getMailTransporter();
      if (!transporter) throw new Error('Falha ao inicializar o transporter nodemailer');

      const fromAddress = process.env.SMTP_FROM || `Gestão SST <${process.env.SMTP_USER}>`;

      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipients.join(', '),
        subject,
        text: textContent,
        html: htmlContent,
      });

      console.log(`[SMTP REAL] E-mail enviado com sucesso. MessageID: ${info.messageId} para: ${recipients.join(', ')}`);

      return {
        success: true,
        status: 'sucesso',
        messageId: info.messageId,
        destinatarios: recipients,
        detalhes: `Enviado via SMTP (${process.env.SMTP_HOST}) para ${recipients.length} destinatário(s).`,
      };
    } catch (err: any) {
      console.error('[SMTP REAL] Erro no envio:', err);
      return {
        success: false,
        status: 'falha',
        error: `Erro ao enviar via SMTP: ${err.message || String(err)}`,
        destinatarios: recipients,
      };
    }
  }

// When SMTP credentials are not populated in .env, never disguise simulation as success
  console.warn(`[SMTP NÃO CONFIGURADO] Tentativa de envio para ${recipients.join(', ')} bloqueada por ausência de credenciais no .env.`);

  return {
    success: false,
    status: 'falha',
    error: 'Servidor SMTP não configurado. Defina as variáveis de ambiente SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no .env para envio real.',
    destinatarios: recipients,
    detalhes: 'Envio não realizado: credenciais SMTP ausentes ou incompletas no arquivo de configuração do servidor (.env).',
  };
}

export interface TestEmailOptions {
  recipient: string;
  subject?: string;
  message?: string;
  senderName?: string;
}

/**
 * Formats plain text or simple markdown (bold, italic, lists, links) into email-safe HTML
 */
export function formatMessageBody(raw: string): string {
  if (!raw) return '';
  // Escape html characters
  let text = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown links: [text](https://example.com)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>');

  // Standalone URLs: https://...
  text = text.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>');

  // Bold: **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  text = text.replace(/\n/g, '<br/>');

  return text;
}

/**
 * Sends a direct test email immediately to validate SMTP configuration
 */
export async function sendTestEmailDirect(options: TestEmailOptions): Promise<SendResult> {
  const recipient = (options.recipient || '').trim();
  if (!recipient || !recipient.includes('@') || !recipient.includes('.')) {
    return {
      success: false,
      status: 'falha',
      error: 'E-mail destinatário inválido ou não informado.',
      destinatarios: [],
    };
  }

  if (!isSmtpConfigured()) {
    return {
      success: false,
      status: 'falha',
      error: 'Servidor SMTP não configurado. Defina as variáveis de ambiente SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS no .env para envio real.',
      destinatarios: [recipient],
      detalhes: 'Credenciais SMTP ausentes ou incompletas no servidor.',
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) throw new Error('Não foi possível inicializar o transporte SMTP.');

    const fromAddress = process.env.SMTP_FROM || `Gestão SST <${process.env.SMTP_USER}>`;
    const subject = options.subject?.trim() || 'Teste de Integração SMTP - Gestão SST';
    const customMessage = options.message?.trim() || 'Esta é uma mensagem de validação imediata enviada pelo sistema Gestão SST para confirmar o funcionamento do servidor de e-mail.';
    const formattedBody = formatMessageBody(customMessage);
    const sentAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .card { max-width: 620px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4); }
    .header { background: linear-gradient(135deg, #059669, #0d9488); padding: 28px 24px; color: white; }
    .badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.95; }
    .content { padding: 28px 24px; color: #e2e8f0; font-size: 14px; line-height: 1.6; }
    .box { background: #0b1120; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
    .row:last-child { margin-bottom: 0; }
    .label { color: #94a3b8; font-weight: 600; }
    .val { color: #ffffff; font-weight: 500; word-break: break-all; }
    .msg-box { background: #0f172a; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 14px; }
    .footer { padding: 20px 24px; background: #0b1120; border-top: 1px solid #334155; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge">E-mail de Teste</div>
      <h1>${subject}</h1>
      <p>Gestão SST — Ambiente, Saúde e Segurança do Trabalho</p>
    </div>
    <div class="content">
      <p style="margin-top: 0; color: #f1f5f9; font-size: 15px; font-weight: 600;">
        Conexão com o servidor SMTP estabelecida e verificada com sucesso!
      </p>
      <div class="box">
        <div class="row"><span class="label">Destinatário:</span> <span class="val">${recipient}</span></div>
        <div class="row"><span class="label">Servidor SMTP:</span> <span class="val">${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'}</span></div>
        <div class="row"><span class="label">Remetente:</span> <span class="val">${fromAddress}</span></div>
        <div class="row"><span class="label">Data e Horário:</span> <span class="val">${sentAt}</span></div>
        <div class="row"><span class="label">Responsável:</span> <span class="val">${options.senderName || 'Administrador do Sistema'}</span></div>
      </div>
      <div class="msg-box">
        <div style="font-weight: 600; color: #10b981; margin-bottom: 6px; font-size: 12px; text-transform: uppercase;">Mensagem de Teste:</div>
        <div style="color: #f8fafc; line-height: 1.6;">${formattedBody}</div>
      </div>
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        Se você está recebendo esta mensagem, o seu serviço de e-mail está pronto para disparos avulsos e notificações de vencimentos.
      </p>
    </div>
    <div class="footer">
      Gestão SST &bull; Sistema de Gestão de Saúde e Segurança do Trabalho
    </div>
  </div>
</body>
</html>
    `.trim();

    const text = `
[Gestão SST - E-mail de Teste]
${subject}

Conexão com o servidor SMTP estabelecida e verificada com sucesso!
Destinatário: ${recipient}
Servidor SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'}
Remetente: ${fromAddress}
Data e Horário: ${sentAt}
Responsável: ${options.senderName || 'Administrador do Sistema'}

Mensagem:
${customMessage}

Gestão SST - Sistema de Gestão de Saúde e Segurança do Trabalho
    `.trim();

    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipient,
      subject,
      text,
      html,
    });

    console.log(`[SMTP TESTE DIRETO] E-mail de teste enviado para ${recipient}. ID: ${info.messageId}`);

    return {
      success: true,
      status: 'sucesso',
      messageId: info.messageId,
      destinatarios: [recipient],
      detalhes: `E-mail de teste enviado com sucesso via ${process.env.SMTP_HOST} para ${recipient}.`,
    };
  } catch (err: any) {
    console.error('[SMTP TESTE DIRETO] Erro ao enviar:', err);
    return {
      success: false,
      status: 'falha',
      error: `Erro no servidor SMTP (${process.env.SMTP_HOST || 'host'}): ${err.message || String(err)}`,
      destinatarios: [recipient],
      detalhes: err.message || String(err),
    };
  }
}

/**
 * Sends a custom email message composed by an Administrator
 * Uses BCC (Cópia Oculta) so recipient emails are never exposed to each other
 */
export async function sendCustomEmail(options: CustomEmailOptions): Promise<SendResult> {
  const recipients = options.to.filter((e) => e && e.includes('@') && e.includes('.'));
  if (recipients.length === 0) {
    return {
      success: false,
      status: 'falha',
      error: 'Nenhum e-mail de destinatário válido informado.',
      destinatarios: [],
    };
  }

  if (!isSmtpConfigured()) {
    return {
      success: false,
      status: 'falha',
      error: 'Servidor SMTP não configurado. Configure as credenciais no .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) para envio real.',
      destinatarios: recipients,
      detalhes: 'Envio não realizado: credenciais SMTP ausentes ou incompletas no arquivo de configuração do servidor (.env).',
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) throw new Error('Falha ao inicializar o transporter nodemailer.');

    const fromAddress = process.env.SMTP_FROM || `Gestão SST <${process.env.SMTP_USER}>`;

    // Format rich text with markdown and link support
    const formattedMessageHtml = formatMessageBody(options.message);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b1120; color: #f1f5f9; margin: 0; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4); }
    .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 24px; color: white; }
    .badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 4px 0 0; font-size: 12px; opacity: 0.9; }
    .content { padding: 24px; color: #e2e8f0; font-size: 14px; line-height: 1.6; }
    .info-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 12px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #94a3b8; font-weight: 600; }
    .info-value { color: #ffffff; font-weight: 500; }
    .footer { padding: 16px 24px; background: #0f172a; border-top: 1px solid #334155; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge">Comunicado Avulso</div>
      <h1>${options.subject}</h1>
      <p>Gestão SST — Ambiente, Saúde e Segurança do Trabalho</p>
    </div>
    <div class="content">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Empresa:</span>
          <span class="info-value">${options.companyName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Remetente:</span>
          <span class="info-value">${options.senderName || 'Administrador EHS'}</span>
        </div>
      </div>
      <div style="margin-top: 16px; font-size: 14px; line-height: 1.6; color: #f8fafc;">
        ${formattedMessageHtml}
      </div>
    </div>
    <div class="footer">
      Esta mensagem foi enviada pelo sistema Gestão SST com privacidade preservada (BCC). Por favor, não responda diretamente a este e-mail automático.
    </div>
  </div>
</body>
</html>
    `.trim();

    // Attachments handling
    const attachments: any[] = [];
    if (options.attachmentName && options.attachmentDataUrl) {
      const match = options.attachmentDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        attachments.push({
          filename: options.attachmentName,
          content: Buffer.from(match[2], 'base64'),
          contentType: match[1],
        });
      }
    }

    // CRITICAL: Use BCC to keep recipients hidden from each other!
    const info = await transporter.sendMail({
      from: fromAddress,
      to: fromAddress, // Sent to sender address as main 'to'
      bcc: recipients, // Blind Carbon Copy ensures no recipient can see any other recipient's email address
      subject: options.subject,
      text: `${options.subject}\n\nEmpresa: ${options.companyName}\nRemetente: ${options.senderName || 'Administrador EHS'}\n\n${options.message}`,
      html,
      attachments,
    });

    console.log(`[SMTP DISPARO AVULSO BCC] E-mail enviado com sucesso. MessageID: ${info.messageId} para: ${recipients.length} destinatários`);

    return {
      success: true,
      status: 'sucesso',
      messageId: info.messageId,
      destinatarios: recipients,
      detalhes: `Enviado com sucesso via SMTP (${process.env.SMTP_HOST}) para ${recipients.length} destinatário(s) em cópia oculta (BCC).`,
    };
  } catch (err: any) {
    console.error('[SMTP DISPARO AVULSO] Erro:', err);
    return {
      success: false,
      status: 'falha',
      error: `Erro no servidor SMTP (${process.env.SMTP_HOST}): ${err.message || String(err)}`,
      destinatarios: recipients,
      detalhes: 'Falha durante envio via nodemailer.',
    };
  }
}
