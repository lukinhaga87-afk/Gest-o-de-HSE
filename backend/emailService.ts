import nodemailer, { type SendMailOptions } from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import {
  EmailNotificationPayload,
  buildNotificationHtml,
} from '../src/utils/notificationTemplate';

// Load local .env only when not running on Netlify serverless environment
if (process.env.NETLIFY !== 'true') {
  try {
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  } catch {
    // Ignore in serverless environments
  }
}

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

function cleanEnv(val?: string): string {
  if (!val) return '';
  let trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractEmailAddress(value?: string): string | null {
  if (!value) return null;
  const cleaned = cleanEnv(value);
  const bracketMatch = cleaned.match(/<([^>]+@[^>]+)>/);
  const candidate = (bracketMatch ? bracketMatch[1] : cleaned).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function getSmtpConfigValues() {
  const host = cleanEnv(process.env.SMTP_HOST);
  const portRaw = cleanEnv(process.env.SMTP_PORT) || '587';
  const parsedPort = parseInt(portRaw, 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587;

  const user = cleanEnv(process.env.SMTP_USER);
  let pass = cleanEnv(process.env.SMTP_PASS);

  // Google App Passwords are often copied as 4 groups of 4 chars separated by spaces
  if (host.toLowerCase().includes('gmail.com') && /^[a-zA-Z0-9]{4}(?:\s[a-zA-Z0-9]{4}){3}$/.test(pass)) {
    pass = pass.replace(/\s+/g, '');
  }

  // Port 465 always uses implicit SSL; port 587/25 uses STARTTLS (secure: false)
  const rawSecure = cleanEnv(process.env.SMTP_SECURE).toLowerCase();
  const secure =
    port === 465
      ? true
      : port === 587 || port === 25
      ? false
      : rawSecure === 'true' || rawSecure === '1';

  const fromEnv = cleanEnv(process.env.SMTP_FROM);
  const fromAddress = fromEnv || (user.includes('@') ? `Gestão SST <${user}>` : '');

  return { host, port, secure, user, pass, fromAddress };
}

function formatSmtpError(err: any): string {
  const rawMsg = err?.message || String(err);
  const code = err?.code || '';
  const responseCode = err?.responseCode ? ` (${err.responseCode})` : '';

  if (code === 'EAUTH' || err?.responseCode === 535) {
    return `Falha na autenticação SMTP${responseCode}: usuário ou senha rejeitados pelo servidor. Para Gmail ou Microsoft 365, utilize uma Senha de App válida em SMTP_PASS. Detalhe: ${rawMsg}`;
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED') {
    return `Falha de conexão com o servidor SMTP (${code}): verifique SMTP_HOST, SMTP_PORT (587 para STARTTLS ou 465 para SSL) e regras de rede. Detalhe: ${rawMsg}`;
  }
  if (code === 'EENVELOPE' || err?.responseCode === 550 || err?.responseCode === 553) {
    return `Remetente ou destinatário rejeitado pelo servidor SMTP${responseCode}: verifique se SMTP_FROM corresponde ao domínio/conta autorizada em SMTP_USER. Detalhe: ${rawMsg}`;
  }
  return `${code ? `[${code}] ` : ''}${rawMsg}`;
}

/**
 * Checks if real SMTP credentials are fully provided in the environment
 */
export function isSmtpConfigured(): boolean {
  const { host, user, pass } = getSmtpConfigValues();
  return Boolean(host && user && pass);
}

/**
 * Returns non-sensitive SMTP diagnostics exclusively for authenticated administrators
 * Never exposes SMTP_PASS, full SMTP_USER, or secret tokens.
 */
export function getSafeSmtpDiagnostics() {
  const { host, port, secure, user, pass, fromAddress } = getSmtpConfigValues();
  const configured = Boolean(host && user && pass);

  const missingVars: string[] = [];
  if (!host) missingVars.push('SMTP_HOST');
  if (!user) missingVars.push('SMTP_USER');
  if (!pass) missingVars.push('SMTP_PASS');

  const maskEmail = (emailStr: string): string => {
    if (!emailStr) return 'Não configurado';
    const [local, domain] = emailStr.split('@');
    if (!domain) return `${emailStr.slice(0, 2)}***`;
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  };

  return {
    configured,
    mode: configured ? 'SMTP Real Ativo (Variáveis de Ambiente Protegidas)' : 'Aguardando Configuração SMTP no Servidor',
    hostConfigured: Boolean(host),
    hostLabel: host || 'Não configurado',
    port: String(port),
    secure,
    userConfigured: Boolean(user),
    userMasked: maskEmail(user),
    passConfigured: Boolean(pass),
    fromConfigured: Boolean(fromAddress),
    missingVars,
  };
}

/**
 * Gets the configured SMTP transport
 */
export function getMailTransporter() {
  if (!isSmtpConfigured()) {
    return null;
  }

  const { host, port, secure, user, pass } = getSmtpConfigValues();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: port === 587,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
      user,
      pass,
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
  const diag = getSafeSmtpDiagnostics();
  if (!diag.configured) {
    return {
      connected: false,
      message: `Variáveis de ambiente SMTP ausentes no servidor: ${diag.missingVars.join(', ')}. Configure-as nas variáveis protegidas do ambiente.`,
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) {
      return { connected: false, message: 'Não foi possível inicializar o transporte SMTP.' };
    }
    await transporter.verify();
    return { connected: true, message: 'Conexão e autenticação SMTP verificadas com sucesso!' };
  } catch (err: any) {
    return {
      connected: false,
      message: formatSmtpError(err),
    };
  }
}

/**
 * Sends notification email via real SMTP if configured
 */
export async function sendNotificationEmail(payload: EmailNotificationPayload): Promise<SendResult> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipients = Array.from(
    new Set(
      (payload.to || [])
        .map((e) => (e || '').trim().toLowerCase())
        .filter((e) => emailRegex.test(e))
    )
  );

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

Acesse a plataforma para regularizar: ${payload.appUrl || 'https://gestao-sst.netlify.app'}
  `.trim();

  if (isSmtpConfigured()) {
    const { host, fromAddress } = getSmtpConfigValues();
    if (!extractEmailAddress(fromAddress)) {
      return {
        success: false,
        status: 'falha',
        error: 'Variável SMTP_FROM inválida ou ausente. Defina um e-mail remetente válido em SMTP_FROM.',
        destinatarios: recipients,
      };
    }

    try {
      const transporter = getMailTransporter();
      if (!transporter) throw new Error('Falha ao inicializar o transporter nodemailer');

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
        detalhes: `Enviado via SMTP (${host}) para ${recipients.length} destinatário(s).`,
      };
    } catch (err: any) {
      console.error('[SMTP REAL] Erro no envio:', err);
      return {
        success: false,
        status: 'falha',
        error: formatSmtpError(err),
        destinatarios: recipients,
      };
    }
  }

  const diag = getSafeSmtpDiagnostics();
  console.warn(`[SMTP NÃO CONFIGURADO] Tentativa de envio para ${recipients.join(', ')} bloqueada por ausência de variáveis: ${diag.missingVars.join(', ')}.`);

  return {
    success: false,
    status: 'falha',
    error: `Servidor SMTP não configurado. Defina as variáveis de ambiente ${diag.missingVars.join(', ')} no servidor / Netlify para habilitar o envio real.`,
    destinatarios: recipients,
    detalhes: `Variáveis ausentes: ${diag.missingVars.join(', ')}.`,
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
  let text = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>'
  );
  text = text.replace(
    /(?<!href=")(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\n/g, '<br/>');

  return text;
}

/**
 * Sends a direct test email immediately to validate SMTP configuration
 */
export async function sendTestEmailDirect(options: TestEmailOptions): Promise<SendResult> {
  const recipient = (options.recipient || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return {
      success: false,
      status: 'falha',
      error: 'E-mail destinatário inválido ou não informado.',
      destinatarios: [],
    };
  }

  const diag = getSafeSmtpDiagnostics();
  if (!diag.configured) {
    return {
      success: false,
      status: 'falha',
      error: `Servidor SMTP não configurado. Defina as variáveis de ambiente ${diag.missingVars.join(', ')} no servidor / Netlify para envio real.`,
      destinatarios: [recipient],
      detalhes: `Variáveis ausentes no servidor: ${diag.missingVars.join(', ')}.`,
    };
  }

  const { host, port, fromAddress } = getSmtpConfigValues();
  if (!extractEmailAddress(fromAddress)) {
    return {
      success: false,
      status: 'falha',
      error: 'Variável SMTP_FROM inválida ou ausente. Informe um e-mail remetente válido em SMTP_FROM.',
      destinatarios: [recipient],
      detalhes: 'SMTP_USER não possui formato de e-mail e SMTP_FROM não foi definido.',
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) throw new Error('Não foi possível inicializar o transporte SMTP.');

    const subject = options.subject?.trim() || 'Teste de Integração SMTP - Gestão SST';
    const customMessage =
      options.message?.trim() ||
      'Esta é uma mensagem de validação imediata enviada pelo sistema Gestão SST para confirmar o funcionamento do servidor de e-mail.';
    const formattedBody = formatMessageBody(customMessage);
    const sentAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const safeSender = escapeHtml(options.senderName || 'Administrador do Sistema');
    const safeSubject = escapeHtml(subject);
    const safeFrom = escapeHtml(fromAddress);

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
      <h1>${safeSubject}</h1>
      <p>Gestão SST — Ambiente, Saúde e Segurança do Trabalho</p>
    </div>
    <div class="content">
      <p style="margin-top: 0; color: #f1f5f9; font-size: 15px; font-weight: 600;">
        Conexão com o servidor SMTP estabelecida e verificada com sucesso!
      </p>
      <div class="box">
        <div class="row"><span class="label">Destinatário:</span> <span class="val">${escapeHtml(recipient)}</span></div>
        <div class="row"><span class="label">Servidor SMTP:</span> <span class="val">${escapeHtml(host)}:${port}</span></div>
        <div class="row"><span class="label">Remetente:</span> <span class="val">${safeFrom}</span></div>
        <div class="row"><span class="label">Data e Horário:</span> <span class="val">${escapeHtml(sentAt)}</span></div>
        <div class="row"><span class="label">Responsável:</span> <span class="val">${safeSender}</span></div>
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
Servidor SMTP: ${host}:${port}
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
      detalhes: `E-mail de teste enviado com sucesso via ${host} para ${recipient}.`,
    };
  } catch (err: any) {
    console.error('[SMTP TESTE DIRETO] Erro ao enviar:', err);
    const formattedErr = formatSmtpError(err);
    return {
      success: false,
      status: 'falha',
      error: formattedErr,
      destinatarios: [recipient],
      detalhes: formattedErr,
    };
  }
}

/**
 * Sends a custom email message composed by an Administrator
 * Uses BCC (Cópia Oculta) when sending to multiple recipients so emails are never exposed to each other
 */
export async function sendCustomEmail(options: CustomEmailOptions): Promise<SendResult> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipients = Array.from(
    new Set(
      (options.to || [])
        .map((e) => (e || '').trim().toLowerCase())
        .filter((e) => emailRegex.test(e))
    )
  );

  if (recipients.length === 0) {
    return {
      success: false,
      status: 'falha',
      error: 'Nenhum e-mail de destinatário válido informado.',
      destinatarios: [],
    };
  }

  const diag = getSafeSmtpDiagnostics();
  if (!diag.configured) {
    return {
      success: false,
      status: 'falha',
      error: `Servidor SMTP não configurado. Defina as variáveis de ambiente ${diag.missingVars.join(', ')} no servidor / Netlify para envio real.`,
      destinatarios: recipients,
      detalhes: `Variáveis ausentes no servidor: ${diag.missingVars.join(', ')}.`,
    };
  }

  const { host, fromAddress } = getSmtpConfigValues();
  const validFromEmail = extractEmailAddress(fromAddress);
  if (!validFromEmail) {
    return {
      success: false,
      status: 'falha',
      error: 'Variável SMTP_FROM inválida ou ausente. Defina um endereço remetente válido em SMTP_FROM.',
      destinatarios: recipients,
      detalhes: 'SMTP_USER não possui formato de e-mail e SMTP_FROM não foi definido.',
    };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) throw new Error('Falha ao inicializar o transporter nodemailer.');

    const formattedMessageHtml = formatMessageBody(options.message);
    const safeSubject = escapeHtml(options.subject);
    const safeCompany = escapeHtml(options.companyName);
    const safeSender = escapeHtml(options.senderName || 'Administrador EHS');

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
      <h1>${safeSubject}</h1>
      <p>Gestão SST — Ambiente, Saúde e Segurança do Trabalho</p>
    </div>
    <div class="content">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Empresa:</span>
          <span class="info-value">${safeCompany}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Remetente:</span>
          <span class="info-value">${safeSender}</span>
        </div>
      </div>
      <div style="margin-top: 16px; font-size: 14px; line-height: 1.6; color: #f8fafc;">
        ${formattedMessageHtml}
      </div>
    </div>
    <div class="footer">
      Esta mensagem foi enviada pelo sistema Gestão SST com privacidade preservada (BCC).
    </div>
  </div>
</body>
</html>
    `.trim();

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

    const validReplyTo = extractEmailAddress(options.senderEmail);
    const mailOptions: SendMailOptions = {
      from: fromAddress,
      subject: options.subject,
      text: `${options.subject}\n\nEmpresa: ${options.companyName}\nRemetente: ${options.senderName || 'Administrador EHS'}\n\n${options.message}`,
      html,
      attachments,
      ...(validReplyTo ? { replyTo: validReplyTo } : {}),
    };

    if (recipients.length === 1) {
      // Single recipient: send directly so relays never reject undisclosed/self-addressed headers
      mailOptions.to = recipients[0];
    } else {
      // Multiple recipients: send via BCC only so no recipient ever sees another recipient's address
      mailOptions.bcc = recipients;
      mailOptions.envelope = {
        from: validFromEmail,
        to: recipients,
      };
    }

    const info = await transporter.sendMail(mailOptions);

    console.log(`[SMTP DISPARO AVULSO BCC] E-mail enviado com sucesso. MessageID: ${info.messageId} para: ${recipients.length} destinatários`);

    return {
      success: true,
      status: 'sucesso',
      messageId: info.messageId,
      destinatarios: recipients,
      detalhes: `Enviado com sucesso via SMTP (${host}) para ${recipients.length} destinatário(s) em cópia oculta (BCC).`,
    };
  } catch (err: any) {
    console.error('[SMTP DISPARO AVULSO] Erro:', err);
    const formattedErr = formatSmtpError(err);
    return {
      success: false,
      status: 'falha',
      error: formattedErr,
      destinatarios: recipients,
      detalhes: formattedErr,
    };
  }
}
