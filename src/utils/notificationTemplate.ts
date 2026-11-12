import { NotificationMilestone } from '../types/sst';

export interface EmailNotificationPayload {
  to: string[];
  documentTitle: string;
  category: string;
  companyName: string;
  employeeName?: string;
  expirationDate: string;
  daysRemaining: number;
  milestone: NotificationMilestone;
  appUrl?: string;
}

/**
 * Builds HTML Email Template with Gestão SST branding.
 * Pure TypeScript utility, completely safe for both browser and Node.js environments.
 */
export function buildNotificationHtml(payload: EmailNotificationPayload): string {
  const {
    documentTitle,
    category,
    companyName,
    employeeName,
    expirationDate,
    daysRemaining,
    milestone,
    appUrl = 'https://gestao-sst.app',
  } = payload;

  let milestoneBadgeColor = '#f59e0b'; // amber
  let milestoneBadgeBg = '#fef3c7';
  let milestoneTitle = 'Aviso: Vencimento em 30 Dias';
  let milestoneDescription =
    'Este documento vencerá em 30 dias. Providencie a renovação antecipada junto aos responsáveis técnicos.';

  if (milestone === '15_dias') {
    milestoneBadgeColor = '#ea580c'; // orange
    milestoneBadgeBg = '#ffedd5';
    milestoneTitle = 'Atenção Crítica: Vencimento em 15 Dias';
    milestoneDescription =
      'Restam apenas 15 dias para o vencimento deste documento. Risco iminente de não conformidade legal.';
  } else if (milestone === 'hoje') {
    milestoneBadgeColor = '#dc2626'; // red
    milestoneBadgeBg = '#fee2e2';
    milestoneTitle = 'URGENTE: VENCIMENTO NA DATA DE HOJE';
    milestoneDescription =
      'Este documento atinge o vencimento hoje! Ação imediata é necessária para evitar paralisação ou penalidades.';
  }

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alerta de Vencimento Documental - Gestão SST</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
    }
    .wrapper {
      max-width: 600px;
      margin: 20px auto;
      background-color: #1e293b;
      border-radius: 12px;
      border: 1px solid #334155;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
      padding: 24px;
      text-align: left;
      border-bottom: 1px solid #3b82f6;
    }
    .brand-title {
      color: #ffffff;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0;
      display: inline-block;
    }
    .brand-subtitle {
      color: #94a3b8;
      font-size: 12px;
      margin-top: 4px;
      margin-bottom: 0;
    }
    .content {
      padding: 28px 24px;
    }
    .milestone-badge {
      display: inline-block;
      background-color: ${milestoneBadgeBg};
      color: ${milestoneBadgeColor};
      font-size: 13px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 20px;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-title {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 8px 0;
    }
    .card-text {
      color: #cbd5e1;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      background-color: #0f172a;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #334155;
    }
    .details-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #1e293b;
      font-size: 13px;
    }
    .details-table tr:last-child td {
      border-bottom: none;
    }
    .label-col {
      color: #94a3b8;
      font-weight: 600;
      width: 35%;
    }
    .value-col {
      color: #f8fafc;
      font-weight: 500;
    }
    .highlight-val {
      color: ${milestoneBadgeColor};
      font-weight: 700;
      font-size: 14px;
    }
    .cta-container {
      text-align: center;
      margin: 30px 0 10px 0;
    }
    .btn-action {
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      display: inline-block;
      box-shadow: 0 4px 12px rgba(37,99,235,0.3);
    }
    .footer {
      background-color: #0f172a;
      padding: 20px 24px;
      text-align: center;
      border-top: 1px solid #334155;
      font-size: 11px;
      color: #64748b;
    }
    .footer p {
      margin: 4px 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1 class="brand-title">Gestão de EHS - Meio Ambiente, Saúde & Segurança</h1>
      <p class="brand-subtitle">Monitoramento Diário Automatizado de Vencimentos</p>
    </div>

    <div class="content">
      <div class="milestone-badge">
        ${milestone === 'hoje' ? '🚨' : milestone === '15_dias' ? '⚠️' : '⏳'} ${milestoneTitle}
      </div>

      <h2 class="card-title">Alerta Preventivo de Conformidade Legal</h2>
      <p class="card-text">${milestoneDescription}</p>

      <table class="details-table">
        <tr>
          <td class="label-col">Documento / Item:</td>
          <td class="value-col"><strong>${documentTitle}</strong></td>
        </tr>
        <tr>
          <td class="label-col">Categoria:</td>
          <td class="value-col">${category}</td>
        </tr>
        <tr>
          <td class="label-col">Empresa Contratada:</td>
          <td class="value-col">${companyName}</td>
        </tr>
        ${
          employeeName
            ? `
        <tr>
          <td class="label-col">Colaborador Vinculado:</td>
          <td class="value-col">${employeeName}</td>
        </tr>
        `
            : ''
        }
        <tr>
          <td class="label-col">Data de Vencimento:</td>
          <td class="value-col highlight-val">${expirationDate}</td>
        </tr>
        <tr>
          <td class="label-col">Prazo Restante:</td>
          <td class="value-col highlight-val">
            ${daysRemaining === 0 ? 'Vence HOJE' : `${daysRemaining} dias restantes`}
          </td>
        </tr>
        <tr>
          <td class="label-col">Marco do Disparo:</td>
          <td class="value-col">${
            milestone === '30_dias'
              ? '30 dias antes'
              : milestone === '15_dias'
              ? '15 dias antes'
              : 'Data exata do vencimento'
          }</td>
        </tr>
      </table>

      <div class="cta-container">
        <a href="${appUrl}" class="btn-action" target="_blank">
          Acessar Plataforma Gestão SST
        </a>
      </div>
    </div>

    <div class="footer">
      <p>Mensagem gerada automaticamente pelo Serviço de Notificações do Gestão SST.</p>
      <p>Conformidade técnica segundo as Normas Regulamentadoras NR-01, NR-07 e NR-09.</p>
      <p>Para ajustar regras ou destinatários, acesse o módulo <strong>Notificações por E-mail</strong> no menu lateral.</p>
    </div>
  </div>
</body>
</html>
  `;
}
