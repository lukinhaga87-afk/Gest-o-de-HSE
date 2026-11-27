import {
  serverAddDoc,
  serverGetDoc,
  serverListCollection,
  serverQueryEquals,
  serverUpdateDoc,
} from './firestoreServer';
import type {
  Company,
  ContractorIntegrationItem,
  DocumentSST,
  InAppNotification,
  InAppNotificationRecipientRole,
  InAppNotificationSeverity,
  InAppNotificationType,
  NotificationMilestone,
  OccupationalExam,
  Training,
  UserRole,
} from '../src/types/sst';

export interface NotificationActor {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  empresaId?: string;
  empresaIds?: string[];
}

export interface CreateInAppNotificationInput {
  recipientRole: InAppNotificationRecipientRole;
  recipientUserId?: string;
  empresaId?: string;
  empresaNome?: string;
  type: InAppNotificationType;
  severity: InAppNotificationSeverity;
  title: string;
  message: string;
  actionLabel?: string;
  actionTab?: string;
  integrationId?: string;
  companyId?: string;
  employeeId?: string;
  documentId?: string;
  createdById?: string;
  createdByNome?: string;
  createdByRole?: UserRole | 'sistema';
  idempotencyKey: string;
  isDemo?: boolean;
  createdAt?: string;
}

export interface AdminAnnouncementInput {
  targetScope: 'single_company' | 'company_group' | 'all_solicitantes';
  empresaIds?: string[];
  title: string;
  message: string;
  severity?: InAppNotificationSeverity;
}

export interface InAppNotificationRepository {
  listNotifications(): Promise<InAppNotification[]>;
  getNotificationById(id: string): Promise<InAppNotification | null>;
  findByIdempotencyKey(key: string): Promise<InAppNotification | null>;
  createNotification(data: Omit<InAppNotification, 'id'>): Promise<InAppNotification>;
  updateNotificationReadState(
    id: string,
    updates: Pick<InAppNotification, 'read' | 'readAt' | 'readByUserIds'>
  ): Promise<void>;
  listCompanies(): Promise<Company[]>;
  listDocuments(): Promise<DocumentSST[]>;
  listExams(): Promise<OccupationalExam[]>;
  listTrainings(): Promise<Training[]>;
  listIntegrationItems(): Promise<ContractorIntegrationItem[]>;
}

export class NotificationWorkflowError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = 'NOTIFICATION_ERROR') {
    super(message);
    this.name = 'NotificationWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function isNotificationVisibleToActor(
  notif: InAppNotification,
  actor: NotificationActor
): boolean {
  if (actor.role === 'admin' || actor.role === 'auditor') {
    if (notif.recipientRole === 'admin') {
      if (notif.recipientUserId && notif.recipientUserId !== actor.id) {
        return false;
      }
      return true;
    }
    return false;
  }

  // Solicitante: strict multi-tenant isolation across all authorized companies
  if (notif.recipientRole === 'all_solicitantes') {
    return true;
  }
  if (notif.recipientRole === 'solicitante') {
    if (notif.recipientUserId && notif.recipientUserId === actor.id) {
      return true;
    }
    const allowedCompanyIds = new Set(
      [
        ...(Array.isArray(actor.empresaIds) ? actor.empresaIds : []),
        ...(actor.empresaId ? [actor.empresaId] : []),
      ]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    );
    if (notif.empresaId && allowedCompanyIds.has(notif.empresaId)) {
      return true;
    }
    return false;
  }
  return false;
}

export function isNotificationReadByUser(notif: InAppNotification, userId: string): boolean {
  if (Array.isArray(notif.readByUserIds) && notif.readByUserIds.includes(userId)) {
    return true;
  }
  if (notif.recipientUserId && notif.recipientUserId === userId && notif.read) {
    return true;
  }
  return false;
}

export function identifyExtendedExpirationMilestone(
  daysRemaining: number
): NotificationMilestone | null {
  if (daysRemaining < 0) return 'vencido';
  if (daysRemaining === 0) return 'hoje';
  if (daysRemaining <= 7) return '7_dias';
  if (daysRemaining <= 15) return '15_dias';
  if (daysRemaining <= 30) return '30_dias';
  return null;
}

function parseDaysRemaining(dateStr?: string): number | null {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  let iso = '';
  if (clean.includes('/')) {
    const p = clean.split('/');
    if (p.length === 3) {
      iso = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    }
  } else if (clean.length >= 10 && clean.includes('-')) {
    iso = clean.slice(0, 10);
  }
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function createFirestoreInAppNotificationRepository(): InAppNotificationRepository {
  return {
    async listNotifications() {
      const docs = await serverListCollection<Omit<InAppNotification, 'id'>>('notifications');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getNotificationById(id: string) {
      const snap = await serverGetDoc<Omit<InAppNotification, 'id'>>('notifications', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async findByIdempotencyKey(key: string) {
      const matches = await serverQueryEquals<Omit<InAppNotification, 'id'>>(
        'notifications',
        'idempotencyKey',
        key
      );
      if (matches.length === 0) return null;
      return { id: matches[0].id, ...matches[0].data };
    },
    async createNotification(data: Omit<InAppNotification, 'id'>) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('notifications', clean);
      return { id, ...clean };
    },
    async updateNotificationReadState(id, updates) {
      await serverUpdateDoc('notifications', id, stripUndefined(updates));
    },
    async listCompanies() {
      const docs = await serverListCollection<Omit<Company, 'id'>>('companies');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listDocuments() {
      const docs = await serverListCollection<Omit<DocumentSST, 'id'>>('documents');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listExams() {
      const docs = await serverListCollection<Omit<OccupationalExam, 'id'>>('exams');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listTrainings() {
      const docs = await serverListCollection<Omit<Training, 'id'>>('trainings');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listIntegrationItems() {
      const docs = await serverListCollection<Omit<ContractorIntegrationItem, 'id'>>(
        'contractorIntegrationItems'
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
  };
}

export function createInMemoryInAppNotificationRepository(seed?: {
  notifications?: InAppNotification[];
  companies?: Company[];
  documents?: DocumentSST[];
  exams?: OccupationalExam[];
  trainings?: Training[];
  integrationItems?: ContractorIntegrationItem[];
}): InAppNotificationRepository & {
  state: {
    notifications: InAppNotification[];
    companies: Company[];
    documents: DocumentSST[];
    exams: OccupationalExam[];
    trainings: Training[];
    integrationItems: ContractorIntegrationItem[];
  };
} {
  let seq = 1;
  const state = {
    notifications: [...(seed?.notifications || [])],
    companies: [...(seed?.companies || [])],
    documents: [...(seed?.documents || [])],
    exams: [...(seed?.exams || [])],
    trainings: [...(seed?.trainings || [])],
    integrationItems: [...(seed?.integrationItems || [])],
  };

  return {
    state,
    async listNotifications() {
      return state.notifications.map((n) => ({ ...n }));
    },
    async getNotificationById(id: string) {
      const found = state.notifications.find((n) => n.id === id);
      return found ? { ...found } : null;
    },
    async findByIdempotencyKey(key: string) {
      const found = state.notifications.find((n) => n.idempotencyKey === key);
      return found ? { ...found } : null;
    },
    async createNotification(data: Omit<InAppNotification, 'id'>) {
      const item: InAppNotification = {
        id: `notif-${seq++}`,
        ...stripUndefined(data),
      };
      state.notifications.push(item);
      return { ...item };
    },
    async updateNotificationReadState(id, updates) {
      const idx = state.notifications.findIndex((n) => n.id === id);
      if (idx >= 0) {
        state.notifications[idx] = { ...state.notifications[idx], ...stripUndefined(updates) };
      }
    },
    async listCompanies() {
      return state.companies.map((c) => ({ ...c }));
    },
    async listDocuments() {
      return state.documents.map((d) => ({ ...d }));
    },
    async listExams() {
      return state.exams.map((e) => ({ ...e }));
    },
    async listTrainings() {
      return state.trainings.map((t) => ({ ...t }));
    },
    async listIntegrationItems() {
      return state.integrationItems.map((i) => ({ ...i }));
    },
  };
}

export class InAppNotificationService {
  private readonly repo: InAppNotificationRepository;

  constructor(repo?: InAppNotificationRepository) {
    this.repo = repo || createFirestoreInAppNotificationRepository();
  }

  async createIdempotentNotification(
    input: CreateInAppNotificationInput
  ): Promise<{ notification: InAppNotification; duplicated: boolean }> {
    const cleanKey = input.idempotencyKey.trim().slice(0, 200);
    const existing = await this.repo.findByIdempotencyKey(cleanKey);
    if (existing) {
      return { notification: existing, duplicated: true };
    }

    const now = input.createdAt || new Date().toISOString();
    const record: Omit<InAppNotification, 'id'> = stripUndefined({
      recipientRole: input.recipientRole,
      recipientUserId: input.recipientUserId,
      empresaId: input.empresaId,
      empresaNome: input.empresaNome,
      type: input.type,
      severity: input.severity,
      title: input.title.trim().slice(0, 200),
      message: input.message.trim().slice(0, 1500),
      actionLabel: input.actionLabel?.trim().slice(0, 80),
      actionTab: input.actionTab?.trim().slice(0, 60),
      integrationId: input.integrationId,
      companyId: input.companyId,
      employeeId: input.employeeId,
      documentId: input.documentId,
      read: false,
      readByUserIds: [],
      createdById: input.createdById,
      createdByNome: input.createdByNome,
      createdByRole: input.createdByRole || 'sistema',
      idempotencyKey: cleanKey,
      isDemo: input.isDemo,
      createdAt: now,
    });

    const created = await this.repo.createNotification(record);
    return { notification: created, duplicated: false };
  }

  async listForActor(actor: NotificationActor): Promise<{
    notifications: Array<InAppNotification & { readByCurrentUser: boolean }>;
    unreadCount: number;
  }> {
    const all = await this.repo.listNotifications();
    const filtered = all
      .filter((n) => isNotificationVisibleToActor(n, actor))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((n) => ({
        ...n,
        readByCurrentUser: isNotificationReadByUser(n, actor.id),
      }));

    const unreadCount = filtered.filter((n) => !n.readByCurrentUser).length;
    return { notifications: filtered, unreadCount };
  }

  async markAsRead(actor: NotificationActor, notificationId: string): Promise<void> {
    const notif = await this.repo.getNotificationById(notificationId);
    if (!notif) {
      throw new NotificationWorkflowError('Notificação não encontrada.', 404, 'NOTIFICATION_NOT_FOUND');
    }
    if (!isNotificationVisibleToActor(notif, actor)) {
      throw new NotificationWorkflowError(
        'Acesso negado a esta notificação.',
        403,
        'NOTIFICATION_FORBIDDEN'
      );
    }

    const existingReaders = Array.isArray(notif.readByUserIds) ? notif.readByUserIds : [];
    const nextReaders = existingReaders.includes(actor.id)
      ? existingReaders
      : [...existingReaders, actor.id].slice(-200);
    const now = new Date().toISOString();

    await this.repo.updateNotificationReadState(notificationId, {
      read: true,
      readAt: now,
      readByUserIds: nextReaders,
    });
  }

  async markAllAsRead(actor: NotificationActor): Promise<{ updatedCount: number }> {
    const { notifications } = await this.listForActor(actor);
    const unread = notifications.filter((n) => !n.readByCurrentUser);
    const now = new Date().toISOString();

    for (const notif of unread) {
      const existingReaders = Array.isArray(notif.readByUserIds) ? notif.readByUserIds : [];
      const nextReaders = existingReaders.includes(actor.id)
        ? existingReaders
        : [...existingReaders, actor.id].slice(-200);
      await this.repo.updateNotificationReadState(notif.id, {
        read: true,
        readAt: now,
        readByUserIds: nextReaders,
      });
    }

    return { updatedCount: unread.length };
  }

  async sendAdminAnnouncement(
    actor: NotificationActor,
    input: AdminAnnouncementInput
  ): Promise<{ created: InAppNotification[] }> {
    if (actor.role !== 'admin') {
      throw new NotificationWorkflowError(
        'Apenas o Administrador EHS pode enviar comunicados direcionados.',
        403,
        'ADMIN_REQUIRED'
      );
    }

    const title = (input.title || '').trim();
    const message = (input.message || '').trim();
    if (title.length < 3 || message.length < 5) {
      throw new NotificationWorkflowError(
        'Informe um título e uma mensagem válidos para enviar o comunicado.',
        400,
        'INVALID_ANNOUNCEMENT'
      );
    }

    const severity: InAppNotificationSeverity =
      input.severity && ['info', 'success', 'warning', 'critical'].includes(input.severity)
        ? input.severity
        : 'info';
    const batchTs = Date.now();
    const created: InAppNotification[] = [];

    if (input.targetScope === 'all_solicitantes') {
      const res = await this.createIdempotentNotification({
        recipientRole: 'all_solicitantes',
        type: 'COMUNICADO_ADM',
        severity,
        title,
        message,
        actionLabel: 'Abrir Painel',
        actionTab: 'painel_contratada',
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: 'admin',
        idempotencyKey: `broadcast-all-${actor.id}-${batchTs}`,
      });
      created.push(res.notification);
      return { created };
    }

    const targetIds = Array.from(
      new Set((input.empresaIds || []).map((id) => id.trim()).filter(Boolean))
    );
    if (targetIds.length === 0) {
      throw new NotificationWorkflowError(
        'Selecione ao menos uma empresa contratada destinatária.',
        400,
        'NO_TARGET_COMPANIES'
      );
    }

    const companies = await this.repo.listCompanies();
    const companyMap = new Map(companies.map((c) => [c.id, c]));

    for (const empresaId of targetIds) {
      const comp = companyMap.get(empresaId);
      const res = await this.createIdempotentNotification({
        recipientRole: 'solicitante',
        empresaId,
        empresaNome: comp?.razaoSocial || 'Empresa Contratada',
        companyId: empresaId,
        type: 'COMUNICADO_ADM',
        severity,
        title,
        message,
        actionLabel: 'Visualizar Minha Empresa',
        actionTab: 'empresas',
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: 'admin',
        idempotencyKey: `broadcast-comp-${empresaId}-${actor.id}-${batchTs}`,
      });
      created.push(res.notification);
    }

    return { created };
  }

  /**
   * Scans real documents, exams, trainings and approved integration items for expiration milestones
   * (30d, 15d, 7d, today, expired) and emits deduplicated in-app alerts for both Admin and Solicitante.
   */
  async syncExpirationNotifications(
    milestones: NotificationMilestone[] = ['30_dias', '15_dias', '7_dias', 'hoje', 'vencido']
  ): Promise<{ createdCount: number; scannedCount: number }> {
    const allowed = new Set(milestones);
    const todayIso = new Date().toISOString().slice(0, 10);
    const [docs, exams, trainings, integrationItems] = await Promise.all([
      this.repo.listDocuments(),
      this.repo.listExams(),
      this.repo.listTrainings(),
      this.repo.listIntegrationItems(),
    ]);

    type Candidate = {
      source: string;
      id: string;
      title: string;
      empresaId?: string;
      empresaNome: string;
      colaboradorId?: string;
      colaboradorNome?: string;
      integrationId?: string;
      dataValidade?: string;
      semValidade?: boolean;
    };

    const candidates: Candidate[] = [];

    for (const d of docs) {
      if (d.semValidade || !d.dataValidade) continue;
      if (d.situacao === 'reprovado') continue;
      candidates.push({
        source: 'doc',
        id: d.id,
        title: d.nomeDocumento,
        empresaId: d.empresaId,
        empresaNome: d.empresaNome || 'Contratada',
        colaboradorId: d.colaboradorId,
        colaboradorNome: d.colaboradorNome,
        dataValidade: d.dataValidade,
      });
    }

    for (const ex of exams) {
      if (ex.semValidade || !ex.dataValidade) continue;
      if (ex.situacao === 'reprovado') continue;
      candidates.push({
        source: 'exam',
        id: ex.id,
        title: ex.tipoExame || 'ASO',
        empresaId: ex.empresaId,
        empresaNome: ex.empresaNome || 'Contratada',
        colaboradorId: ex.colaboradorId,
        colaboradorNome: ex.colaboradorNome,
        dataValidade: ex.dataValidade,
      });
    }

    for (const tr of trainings) {
      if (tr.semValidade || !tr.dataValidade) continue;
      if (tr.situacao === 'reprovado') continue;
      candidates.push({
        source: 'training',
        id: tr.id,
        title: tr.nomeTreinamento,
        empresaId: tr.empresaId,
        empresaNome: tr.empresaNome || 'Contratada',
        colaboradorId: tr.colaboradorId,
        colaboradorNome: tr.colaboradorNome,
        dataValidade: tr.dataValidade,
      });
    }

    for (const item of integrationItems) {
      if (item.semValidade || !item.dataValidade) continue;
      if (item.status === 'PENDENTE_ENVIO' || item.status === 'SUBSTITUIDO' || item.officialRecordId) {
        continue;
      }
      candidates.push({
        source: 'integ-item',
        id: item.id,
        title: item.nomeExibicao,
        empresaId: item.empresaId,
        empresaNome: item.empresaNome || 'Contratada',
        colaboradorId: item.colaboradorId,
        colaboradorNome: item.colaboradorNome,
        integrationId: item.integrationId,
        dataValidade: item.dataValidade,
      });
    }

    let createdCount = 0;

    for (const cand of candidates) {
      const days = parseDaysRemaining(cand.dataValidade);
      if (days === null) continue;
      const milestone = identifyExtendedExpirationMilestone(days);
      if (!milestone || !allowed.has(milestone)) continue;

      const isExpired = milestone === 'vencido';
      const type: InAppNotificationType = isExpired
        ? 'DOCUMENTO_VENCIDO'
        : 'DOCUMENTO_PROXIMO_VENCIMENTO';
      const severity: InAppNotificationSeverity =
        isExpired || milestone === 'hoje' || milestone === '7_dias' ? 'critical' : 'warning';

      const ownerFragment = cand.colaboradorNome
        ? `do colaborador ${cand.colaboradorNome} (${cand.empresaNome})`
        : `da empresa ${cand.empresaNome}`;
      const timingText = isExpired
        ? `está vencido há ${Math.abs(days)} dia(s)`
        : days === 0
        ? 'vence hoje'
        : `vencerá em ${days} dia(s)`;

      const title = isExpired ? 'DOCUMENTO VENCIDO' : 'DOCUMENTO PRÓXIMO DO VENCIMENTO';
      const message = `${cand.title} ${ownerFragment} ${timingText} (validade: ${cand.dataValidade?.slice(0, 10)}). Providencie a atualização documental.`;

      // 1. Solicitante alert (strictly scoped to empresaId)
      if (cand.empresaId) {
        const solRes = await this.createIdempotentNotification({
          recipientRole: 'solicitante',
          empresaId: cand.empresaId,
          empresaNome: cand.empresaNome,
          type,
          severity,
          title,
          message,
          actionLabel: cand.colaboradorId ? 'Visualizar colaborador' : 'Visualizar vencimentos',
          actionTab: cand.colaboradorId ? 'colaboradores' : 'pendencias_vencimentos',
          employeeId: cand.colaboradorId,
          companyId: cand.empresaId,
          documentId: cand.id,
          integrationId: cand.integrationId,
          createdByRole: 'sistema',
          idempotencyKey: `exp-sol-${cand.source}-${cand.id}-${milestone}-${cand.dataValidade?.slice(0, 10)}`,
        });
        if (!solRes.duplicated) createdCount += 1;
      }

      // 2. Admin EHS alert
      const admRes = await this.createIdempotentNotification({
        recipientRole: 'admin',
        empresaId: cand.empresaId,
        empresaNome: cand.empresaNome,
        type,
        severity,
        title,
        message,
        actionLabel: cand.colaboradorId ? 'Visualizar colaborador' : 'Controle de Vencimentos',
        actionTab: cand.colaboradorId ? 'colaboradores' : 'controle_vencimentos',
        employeeId: cand.colaboradorId,
        companyId: cand.empresaId,
        documentId: cand.id,
        integrationId: cand.integrationId,
        createdByRole: 'sistema',
        idempotencyKey: `exp-adm-${cand.source}-${cand.id}-${milestone}-${cand.dataValidade?.slice(0, 10)}-${todayIso.slice(0, 7)}`,
      });
      if (!admRes.duplicated) createdCount += 1;
    }

    return { createdCount, scannedCount: candidates.length };
  }
}
