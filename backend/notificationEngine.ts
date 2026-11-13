import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  query,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  sendNotificationEmail,
  EmailNotificationPayload,
  isSmtpConfigured,
  SmtpOverrideConfig,
} from './emailService';
import { NotificationConfig, NotificationLog, NotificationMilestone } from '../src/types/sst';

// Initialize Firebase for Backend Node environment
const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export interface MonitoredItem {
  id: string;
  tipoItem: 'Documento' | 'Treinamento' | 'Exame/ASO' | 'Licença Ambiental';
  titulo: string;
  categoria: string;
  empresaId: string;
  empresaNome: string;
  colaboradorId?: string;
  colaboradorNome?: string;
  dataValidade?: string;
  semValidade?: boolean;
  situacao?: string;
}

/**
 * Parses Brazilian or ISO date strings into YYYY-MM-DD
 */
export function normalizeDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  if (clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 3) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Calculates remaining calendar days between today in America/Sao_Paulo (00:00:00) and expiration date
 */
export function calculateDaysRemaining(normalizedDateStr: string): number | null {
  const target = new Date(normalizedDateStr + 'T00:00:00');
  if (isNaN(target.getTime())) return null;

  const brTodayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const today = new Date(brTodayStr + 'T00:00:00');

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Checks which milestone matches the days remaining
 * Milestones requested: 30 days before, 15 days before, and 0 days (today)
 */
export function identifyMilestone(daysRemaining: number): NotificationMilestone | null {
  if (daysRemaining === 0) return 'hoje';
  if (daysRemaining === 15) return '15_dias';
  if (daysRemaining === 30) return '30_dias';
  return null;
}

/**
 * Checks against existing successful/simulated logs to prevent duplicate email dispatches
 * Failed attempts ('falha') are NOT considered dispatched so they can be retried once SMTP is fixed.
 */
export async function isAlreadyDispatched(idempotencyKey: string): Promise<boolean> {
  try {
    const colRef = collection(db, 'notificationLogs');
    const q = query(colRef, where('idempotencyKey', '==', idempotencyKey));
    const snap = await getDocs(q);
    return snap.docs.some((d) => {
      const status = d.data()?.status;
      return status === 'sucesso' || status === 'simulado';
    });
  } catch (err) {
    console.warn(`[Deduplicação] Falha na verificação de chave ${idempotencyKey}:`, err);
    return false;
  }
}

/**
 * Collects all candidate items across documents, trainings, exams, and environmental docs
 */
export async function collectAllCandidateItems(): Promise<MonitoredItem[]> {
  const items: MonitoredItem[] = [];

  try {
    // 1. Documents
    const docsSnap = await getDocs(collection(db, 'documents'));
    docsSnap.forEach((d) => {
      const data = d.data();
      if (!data.semValidade && data.dataValidade) {
        items.push({
          id: d.id,
          tipoItem: 'Documento',
          titulo: data.nomeDocumento || 'Documento SST',
          categoria: data.categoria || 'Documento Empresarial',
          empresaId: data.empresaId || '',
          empresaNome: data.empresaNome || 'Empresa',
          colaboradorId: data.colaboradorId,
          colaboradorNome: data.colaboradorNome,
          dataValidade: data.dataValidade,
          situacao: data.situacao,
        });
      }
    });

    // 2. Trainings
    const trnSnap = await getDocs(collection(db, 'trainings'));
    trnSnap.forEach((d) => {
      const data = d.data();
      if (!data.semValidade && data.dataValidade) {
        items.push({
          id: d.id,
          tipoItem: 'Treinamento',
          titulo: data.nomeTreinamento || 'Treinamento SST',
          categoria: 'Treinamento',
          empresaId: data.empresaId || '',
          empresaNome: data.empresaNome || 'Empresa',
          colaboradorId: data.colaboradorId,
          colaboradorNome: data.colaboradorNome,
          dataValidade: data.dataValidade,
          situacao: data.situacao,
        });
      }
    });

    // 3. Exams
    const examSnap = await getDocs(collection(db, 'exams'));
    examSnap.forEach((d) => {
      const data = d.data();
      if (!data.semValidade && data.dataValidade) {
        items.push({
          id: d.id,
          tipoItem: 'Exame/ASO',
          titulo: data.tipoExame || 'Exame Ocupacional',
          categoria: 'ASO',
          empresaId: data.empresaId || '',
          empresaNome: data.empresaNome || 'Empresa',
          colaboradorId: data.colaboradorId,
          colaboradorNome: data.colaboradorNome,
          dataValidade: data.dataValidade,
          situacao: data.situacao,
        });
      }
    });

    // 4. Environmental docs
    const envSnap = await getDocs(collection(db, 'environmentalDocs'));
    envSnap.forEach((d) => {
      const data = d.data();
      if (!data.semValidade && data.dataValidade) {
        items.push({
          id: d.id,
          tipoItem: 'Licença Ambiental',
          titulo: data.nome || 'Licença Ambiental',
          categoria: 'Documento Ambiental',
          empresaId: '',
          empresaNome: data.orgaoEmissor || 'Órgão Ambiental',
          dataValidade: data.dataValidade,
          situacao: data.situacao,
        });
      }
    });
  } catch (err) {
    console.error('[Coleta de Itens] Erro ao buscar coleções do Firestore:', err);
  }

  return items;
}

/**
 * Loads all active notification rules
 */
export async function getActiveNotificationConfigs(): Promise<NotificationConfig[]> {
  try {
    const snap = await getDocs(collection(db, 'notificationConfigs'));
    const configs: NotificationConfig[] = [];
    snap.forEach((d) => {
      const data = d.data() as Omit<NotificationConfig, 'id'>;
      if (data.ativo !== false) {
        configs.push({ id: d.id, ...data });
      }
    });
    return configs;
  } catch (err) {
    console.error('[Configurações] Erro ao carregar regras de notificação:', err);
    return [];
  }
}

/**
 * Checks if a rule applies to a specific monitored item and milestone
 */
export function ruleMatchesItem(
  config: NotificationConfig,
  item: MonitoredItem,
  milestone: NotificationMilestone
): boolean {
  // 1. Must include the specific milestone
  if (!config.marcos || !config.marcos.includes(milestone)) {
    return false;
  }

  // 2. Company filter: empty, 'todas' or exact match
  if (config.empresaId && config.empresaId !== 'todas' && config.empresaId !== item.empresaId) {
    return false;
  }

  // 3. Employee filter: empty, 'todos' or exact match
  if (
    config.colaboradorId &&
    config.colaboradorId !== 'todos' &&
    item.colaboradorId &&
    config.colaboradorId !== item.colaboradorId
  ) {
    return false;
  }

  // 4. Category filter: empty, 'todas' or exact match
  if (config.categoria && config.categoria !== 'todas') {
    const configCat = config.categoria.toLowerCase();
    const itemCat = item.categoria.toLowerCase();
    if (!itemCat.includes(configCat) && !configCat.includes(itemCat)) {
      return false;
    }
  }

  return true;
}

export interface RunCheckResult {
  dispatched: number;
  skippedDuplicates: number;
  unmatched: number;
  totalEvaluated: number;
  logs: NotificationLog[];
  smtpConfigured: boolean;
  timestamp: string;
}

/**
 * Central Daily Routine:
 * Scans all documents, identifies 30d, 15d, 0d milestones,
 * checks deduplication, dispatches emails to configured recipients,
 * and saves logs to Firestore.
 */
export async function executeDailyNotificationMonitoring(
  smtpOverride?: SmtpOverrideConfig | null
): Promise<RunCheckResult> {
  const timestamp = new Date().toISOString();
  console.log(`[Rotina de Notificação] Iniciando monitoramento diário: ${timestamp}`);

  const items = await collectAllCandidateItems();
  const configs = await getActiveNotificationConfigs();

  let dispatched = 0;
  let skippedDuplicates = 0;
  let unmatched = 0;
  const createdLogs: NotificationLog[] = [];

  for (const item of items) {
    const normalizedDate = normalizeDate(item.dataValidade);
    if (!normalizedDate) continue;

    const days = calculateDaysRemaining(normalizedDate);
    if (days === null) continue;

    // Check if item falls on one of the 3 milestones: 30, 15, or 0
    const milestone = identifyMilestone(days);
    if (!milestone) continue;

    // Build deduplication key (idempotency)
    const idempotencyKey = `${item.id}_${milestone}_${normalizedDate}`;

    // Verify deduplication (only successful/simulated dispatches skip)
    const alreadySent = await isAlreadyDispatched(idempotencyKey);
    if (alreadySent) {
      skippedDuplicates++;
      continue;
    }

    // Find all matching notification rules
    const matchingConfigs = configs.filter((cfg) => ruleMatchesItem(cfg, item, milestone));

    // Aggregate unique recipient emails
    const recipientsSet = new Set<string>();
    matchingConfigs.forEach((cfg) => {
      (cfg.destinatarios || []).forEach((email) => {
        const clean = email.trim().toLowerCase();
        if (clean.includes('@')) {
          recipientsSet.add(clean);
        }
      });
    });

    const recipients = Array.from(recipientsSet);
    if (recipients.length === 0) {
      unmatched++;
      continue;
    }

    // Prepare payload
    const payload: EmailNotificationPayload = {
      to: recipients,
      documentTitle: item.titulo,
      category: item.categoria,
      companyName: item.empresaNome,
      employeeName: item.colaboradorNome,
      expirationDate: normalizedDate,
      daysRemaining: days,
      milestone,
      appUrl: process.env.APP_URL || process.env.URL || 'https://gestao-sst.netlify.app',
    };

    const result = await sendNotificationEmail(payload, smtpOverride);

    // Save record to notificationLogs in Firestore
    const logData: Omit<NotificationLog, 'id'> = {
      dataHora: new Date().toISOString(),
      tipoEnvio: 'automatico',
      destinatarios: recipients,
      documentoId: item.id,
      documentoTitulo: item.titulo,
      categoria: item.categoria,
      empresaNome: item.empresaNome,
      colaboradorNome: item.colaboradorNome || '',
      marco: milestone,
      dataVencimento: normalizedDate,
      diasRestantes: days,
      status: result.status,
      mensagem: result.detalhes || `Disparo efetuado para o marco de ${milestone.replace('_', ' ')}.`,
      erro: result.error || '',
      idempotencyKey,
      recalculado: false,
      createdAt: new Date().toISOString(),
    };

    try {
      const docRef = await addDoc(collection(db, 'notificationLogs'), logData);
      createdLogs.push({ id: docRef.id, ...logData });
      if (result.success) {
        dispatched++;
      }
    } catch (saveErr) {
      console.error('[Log Firestore] Erro ao persistir log de notificação:', saveErr);
    }
  }

  console.log(
    `[Rotina de Notificação] Finalizada: ${dispatched} disparados, ${skippedDuplicates} duplicatas evitadas, ${unmatched} sem destinatários.`
  );

  return {
    dispatched,
    skippedDuplicates,
    unmatched,
    totalEvaluated: items.length,
    logs: createdLogs,
    smtpConfigured: isSmtpConfigured(smtpOverride),
    timestamp: new Date().toISOString(),
  };
}
