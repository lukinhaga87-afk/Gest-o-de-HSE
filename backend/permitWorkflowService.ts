import crypto from 'crypto';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Firestore,
} from 'firebase/firestore';
import { db } from './notificationEngine';
import { evaluateActivityCompliance } from '../src/utils/activityComplianceEngine';
import type {
  ActivityComplianceResult,
  ActivityComplianceSnapshot,
  ActivityDocumentRequirement,
  ActivityProfile,
  AuditLog,
  Company,
  DocumentSST,
  Employee,
  EPIDelivery,
  OccupationalExam,
  OperationalControlAttachmentType,
  SafetyPermit,
  SafetyPermitControlAttachment,
  SafetyPermitEmployeeSnapshot,
  SafetyPermitOperationalControls,
  SafetyPermitStatus,
  SafetyPermitType,
  SafetyPermitWorkflowHistoryEntry,
  SmartDocRecord,
  Training,
  UserRole,
} from '../src/types/sst';

export interface PermitWorkflowActor {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  empresaId?: string;
}

export interface PermitOfficialDataset {
  companies: Company[];
  employees: Employee[];
  activityProfiles: ActivityProfile[];
  activityDocumentRequirements: ActivityDocumentRequirement[];
  documents: DocumentSST[];
  trainings: Training[];
  exams: OccupationalExam[];
  epiDeliveries: EPIDelivery[];
  safetyPermits: SafetyPermit[];
  smartDocs: SmartDocRecord[];
}

export interface PermitWorkflowRepository {
  loadOfficialData(): Promise<PermitOfficialDataset>;
  getPermitById(id: string): Promise<SafetyPermit | null>;
  createPermit(data: Omit<SafetyPermit, 'id'>): Promise<SafetyPermit>;
  updatePermit(id: string, data: Partial<SafetyPermit>): Promise<SafetyPermit>;
  appendAuditLog(entry: Omit<AuditLog, 'id'>): Promise<void>;
}

export class PermitWorkflowError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PermitWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface PermitDraftPayload {
  tipo?: SafetyPermitType;
  titulo?: string;
  descricaoServico?: string;
  empresaId?: string;
  localTrabalho?: string;
  dataInicio?: string;
  dataFim?: string;
  responsavelEmissao?: string;
  responsavelAtividade?: string;
  riscosIdentificados?: string;
  medidasPreventivas?: string;
  observacoes?: string;
  anexoUrl?: string;
  anexosControles?: SafetyPermitControlAttachment[];
  atividadeIds?: string[];
  colaboradorIds?: string[];
  expectedVersion?: number;
  // Intentionally captured so tampering attempts are explicitly detected and rejected
  status?: unknown;
  aprovadoPorId?: unknown;
  aprovadoPorNome?: unknown;
  dataAprovacao?: unknown;
  liberadoPorId?: unknown;
  liberadoPorNome?: unknown;
  liberadoPorRole?: unknown;
  dataLiberacao?: unknown;
  validadoServerSide?: unknown;
  statusConformidade?: unknown;
  pendenciasObrigatoriasCount?: unknown;
  pendenciasAlertaCount?: unknown;
  snapshotValidacao?: unknown;
  complianceFingerprint?: unknown;
  historicoWorkflow?: unknown;
  versaoConcorrencia?: unknown;
  solicitadoPorId?: unknown;
  solicitadoPorNome?: unknown;
  solicitadoPorRole?: unknown;
}

export interface PermitActionOptions {
  justificativa?: string;
  expectedVersion?: number;
  expectedComplianceFingerprint?: string;
  referenceDate?: Date;
}

export interface PermitEvaluationResponse {
  permit: SafetyPermit;
  compliance: ActivityComplianceResult;
  complianceFingerprint: string;
  versaoConcorrencia: number;
  controlesOperacionais: SafetyPermitOperationalControls;
  structuralErrors: string[];
}

const VALID_PERMIT_TYPES = new Set<SafetyPermitType>(['APR', 'PT', 'LOTO']);
const VALID_CONTROL_ATTACHMENT_TYPES = new Set<OperationalControlAttachmentType>([
  'APR',
  'PT',
  'LOTO',
  'PET',
]);

const EDITABLE_STATUSES = new Set<SafetyPermitStatus>([
  'elaboracao',
  'pendente_documentacao',
  'pendente_correcao',
]);

const SOLICITANTE_CANCELABLE_STATUSES = new Set<SafetyPermitStatus>([
  'elaboracao',
  'pendente_liberacao',
  'pendente_documentacao',
  'pendente_correcao',
]);

const FORBIDDEN_CLIENT_FIELDS = [
  'aprovadoPorId',
  'aprovadoPorNome',
  'dataAprovacao',
  'liberadoPorId',
  'liberadoPorNome',
  'liberadoPorRole',
  'dataLiberacao',
  'validadoServerSide',
  'statusConformidade',
  'pendenciasObrigatoriasCount',
  'pendenciasAlertaCount',
  'snapshotValidacao',
  'complianceFingerprint',
  'historicoWorkflow',
  'versaoConcorrencia',
  'solicitadoPorId',
  'solicitadoPorNome',
  'solicitadoPorRole',
] as const;

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        cleaned[key] = stripUndefinedDeep(val);
      }
    }
    return cleaned as T;
  }
  return value;
}

function dedupeIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
  }
  return result;
}

function sanitizeControlAttachments(
  raw: unknown,
  actorNome: string,
  nowIso: string
): SafetyPermitControlAttachment[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new PermitWorkflowError(
      400,
      'INVALID_ATTACHMENTS',
      'Lista de anexos de controles operacionais inválida.'
    );
  }
  if (raw.length > 20) {
    throw new PermitWorkflowError(
      400,
      'TOO_MANY_ATTACHMENTS',
      'Limite máximo de 20 anexos de controles operacionais excedido.'
    );
  }

  return raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new PermitWorkflowError(400, 'INVALID_ATTACHMENT_ITEM', 'Item de anexo inválido.');
    }
    const candidate = item as Partial<SafetyPermitControlAttachment>;
    if (!candidate.tipo || !VALID_CONTROL_ATTACHMENT_TYPES.has(candidate.tipo)) {
      throw new PermitWorkflowError(
        400,
        'INVALID_ATTACHMENT_TYPE',
        'Tipo de anexo de controle operacional inválido. Use APR, PT, LOTO ou PET.'
      );
    }
    const nomeArquivo =
      typeof candidate.nomeArquivo === 'string' ? candidate.nomeArquivo.trim() : '';
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
    if (!nomeArquivo || !url) {
      throw new PermitWorkflowError(
        400,
        'INCOMPLETE_ATTACHMENT',
        'Cada anexo operacional deve conter nome do arquivo e URL ou conteúdo válido.'
      );
    }
    if (url.length > 1_200_000) {
      throw new PermitWorkflowError(
        400,
        'ATTACHMENT_TOO_LARGE',
        `O anexo "${nomeArquivo}" excede o limite de tamanho suportado.`
      );
    }
    return {
      tipo: candidate.tipo,
      nomeArquivo: nomeArquivo.slice(0, 200),
      url,
      enviadoEm: typeof candidate.enviadoEm === 'string' && candidate.enviadoEm ? candidate.enviadoEm : nowIso,
      enviadoPorNome:
        typeof candidate.enviadoPorNome === 'string' && candidate.enviadoPorNome
          ? candidate.enviadoPorNome
          : actorNome,
    };
  });
}

function isValidIsoDateString(val?: string): boolean {
  if (!val || typeof val !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(val.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function assertNoForbiddenTamperingFields(
  body: PermitDraftPayload,
  mode: 'create' | 'update'
): void {
  const rawBody = body as Record<string, unknown>;

  if (mode === 'create') {
    if (rawBody.status !== undefined && rawBody.status !== 'elaboracao') {
      throw new PermitWorkflowError(
        403,
        'TAMPERING_DIRECT_STATUS',
        'Não é permitido criar solicitação diretamente com status diferente de rascunho ("elaboracao"). Utilize o fluxo oficial de aprovação e liberação.'
      );
    }
  } else if (rawBody.status !== undefined) {
    throw new PermitWorkflowError(
      403,
      'TAMPERING_DIRECT_STATUS',
      'Não é permitido alterar o status diretamente na edição de rascunho. Utilize os endpoints oficiais de fluxo.'
    );
  }

  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (rawBody[field] !== undefined) {
      throw new PermitWorkflowError(
        403,
        'TAMPERING_FORBIDDEN_FIELDS',
        `Campo protegido "${field}" não pode ser enviado ou sobrescrito pelo cliente.`
      );
    }
  }
}

export function buildComplianceSnapshot(
  compliance: ActivityComplianceResult
): ActivityComplianceSnapshot {
  return {
    avaliadoEm: compliance.avaliadoEm,
    statusGeral: compliance.statusGeral,
    podeLiberar: compliance.podeLiberar,
    totalRequisitosAvaliados: compliance.resumo.totalRequisitosAvaliados,
    conformes: compliance.resumo.conformes,
    alertasAVencer: compliance.resumo.alertasAVencer,
    pendentesAprovacao: compliance.resumo.pendentesAprovacao,
    bloqueiosObrigatorios: compliance.resumo.bloqueiosObrigatorios,
    motivosBloqueio: compliance.motivosBloqueio,
  };
}

export function computeOperationalControls(
  selectedActivities: ActivityProfile[]
): SafetyPermitOperationalControls {
  return {
    exigeAPR: selectedActivities.some((a) => a.exigeAPR),
    exigePT: selectedActivities.some((a) => a.exigePT),
    exigeLOTO: selectedActivities.some((a) => a.exigeLOTO),
    exigePET: selectedActivities.some((a) => Boolean(a.exigePET)),
  };
}

/**
 * Generates a deterministic SHA-256 fingerprint over all authoritative server-side records
 * that influence a permit's compliance evaluation. Any concurrent change to the company,
 * selected activities, matrix requirements, employees, documents, trainings, ASOs, EPIs,
 * permits, or pending SmartDocs changes this fingerprint and triggers a concurrency conflict.
 */
export function computeComplianceFingerprint(params: {
  company: Company | null;
  selectedActivityIds: string[];
  selectedEmployeeIds: string[];
  dataInicio?: string;
  dataFim?: string;
  dataset: PermitOfficialDataset;
  excludePermitId?: string;
}): string {
  const { company, selectedActivityIds, selectedEmployeeIds, dataInicio, dataFim, dataset } = params;
  const activityIdSet = new Set(selectedActivityIds);
  const employeeIdSet = new Set(selectedEmployeeIds);
  const companyId = company?.id || '';

  const canonicalState = {
    dataInicio: dataInicio || '',
    dataFim: dataFim || '',
    company: company
      ? {
          id: company.id,
          situacao: company.situacao,
          contrato_indeterminado: Boolean(company.contrato_indeterminado),
          dataTerminoContrato: company.dataTerminoContrato || '',
          atividadesAutorizadasIds: [...(company.atividadesAutorizadasIds || [])].sort(),
        }
      : null,
    activities: dataset.activityProfiles
      .filter((a) => activityIdSet.has(a.id))
      .map((a) => ({
        id: a.id,
        codigo: a.codigo,
        ativo: a.ativo,
        exigeAPR: a.exigeAPR,
        exigePT: a.exigePT,
        exigeLOTO: a.exigeLOTO,
        exigePET: Boolean(a.exigePET),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    requirements: dataset.activityDocumentRequirements
      .filter((r) => activityIdSet.has(r.activityId) && r.ativo)
      .map((r) => ({
        id: r.id,
        activityId: r.activityId,
        codigo: r.documentoCodigoCanonico,
        escopo: r.escopo,
        origemColecao: r.origemColecao,
        obrigatorioParaLiberacao: r.obrigatorioParaLiberacao,
        exigeAptoASO: Boolean(r.exigeAptoASO),
        aptidaoEspecifica: r.aptidaoEspecifica || '',
        funcoesAplicaveis: [...(r.funcoesAplicaveis || [])].sort(),
        palavrasChaveMatch: [...(r.palavrasChaveMatch || [])].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    employees: dataset.employees
      .filter((e) => employeeIdSet.has(e.id))
      .map((e) => ({
        id: e.id,
        empresaId: e.empresaId,
        cargo: e.cargo,
        situacaoCadastral: e.situacaoCadastral,
        atividadesHabilitadasIds: [...(e.atividadesHabilitadasIds || [])].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    documents: dataset.documents
      .filter((d) => d.empresaId === companyId)
      .map((d) => ({
        id: d.id,
        colaboradorId: d.colaboradorId || '',
        nomeDocumento: d.nomeDocumento,
        tipoDocumentoCanonico: d.tipoDocumentoCanonico || '',
        situacao: d.situacao,
        dataEmissao: d.dataEmissao || '',
        dataValidade: d.dataValidade || '',
        semValidade: Boolean(d.semValidade),
        updatedAt: d.updatedAt || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    trainings: dataset.trainings
      .filter((t) => t.empresaId === companyId && employeeIdSet.has(t.colaboradorId))
      .map((t) => ({
        id: t.id,
        colaboradorId: t.colaboradorId,
        nomeTreinamento: t.nomeTreinamento,
        tipoDocumentoCanonico: t.tipoDocumentoCanonico || '',
        situacao: t.situacao,
        dataRealizacao: t.dataRealizacao,
        dataValidade: t.dataValidade || '',
        semValidade: Boolean(t.semValidade),
        updatedAt: t.updatedAt || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    exams: dataset.exams
      .filter((x) => x.empresaId === companyId && employeeIdSet.has(x.colaboradorId))
      .map((x) => ({
        id: x.id,
        colaboradorId: x.colaboradorId,
        tipoExame: x.tipoExame,
        tipoDocumentoCanonico: x.tipoDocumentoCanonico || '',
        conclusao: x.conclusao,
        aptidoesEspecificas: [...(x.aptidoesEspecificas || [])].sort(),
        situacao: x.situacao,
        dataRealizacao: x.dataRealizacao,
        dataValidade: x.dataValidade || '',
        semValidade: Boolean(x.semValidade),
        updatedAt: x.updatedAt || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    epiDeliveries: dataset.epiDeliveries
      .filter((epi) => epi.empresaId === companyId && employeeIdSet.has(epi.colaboradorId))
      .map((epi) => ({
        id: epi.id,
        colaboradorId: epi.colaboradorId,
        nomeEpi: epi.nomeEpi,
        caNumero: epi.caNumero,
        dataEntrega: epi.dataEntrega,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    safetyPermits: dataset.safetyPermits
      .filter((p) => p.empresaId === companyId && p.id !== params.excludePermitId)
      .map((p) => ({
        id: p.id,
        tipo: p.tipo,
        titulo: p.titulo,
        status: p.status,
        dataInicio: p.dataInicio,
        dataFim: p.dataFim,
        atividadeIds: [...(p.atividadeIds || [])].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    smartDocs: dataset.smartDocs
      .filter((sd) => sd.empresaId === companyId)
      .map((sd) => ({
        id: sd.id,
        colaboradorId: sd.colaboradorId || '',
        status: sd.status,
        tipoDocumento: sd.tipoDocumento,
        categoriaGrupo: sd.categoriaGrupo,
        updatedAt: sd.updatedAt || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalState))
    .digest('hex');
}

export function createFirestorePermitRepository(
  firestoreDb: Firestore = db
): PermitWorkflowRepository {
  return {
    async loadOfficialData(): Promise<PermitOfficialDataset> {
      const [
        companiesSnap,
        employeesSnap,
        activityProfilesSnap,
        activityReqsSnap,
        documentsSnap,
        trainingsSnap,
        examsSnap,
        epiSnap,
        permitsSnap,
        smartDocsSnap,
      ] = await Promise.all([
        getDocs(collection(firestoreDb, 'companies')),
        getDocs(collection(firestoreDb, 'employees')),
        getDocs(collection(firestoreDb, 'activityProfiles')),
        getDocs(collection(firestoreDb, 'activityDocumentRequirements')),
        getDocs(collection(firestoreDb, 'documents')),
        getDocs(collection(firestoreDb, 'trainings')),
        getDocs(collection(firestoreDb, 'exams')),
        getDocs(collection(firestoreDb, 'epiDeliveries')),
        getDocs(collection(firestoreDb, 'safetyPermits')),
        getDocs(collection(firestoreDb, 'smartDocs')),
      ]);

      return {
        companies: companiesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Company, 'id'>),
        })),
        employees: employeesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Employee, 'id'>),
        })),
        activityProfiles: activityProfilesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ActivityProfile, 'id'>),
        })),
        activityDocumentRequirements: activityReqsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ActivityDocumentRequirement, 'id'>),
        })),
        documents: documentsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DocumentSST, 'id'>),
        })),
        trainings: trainingsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Training, 'id'>),
        })),
        exams: examsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OccupationalExam, 'id'>),
        })),
        epiDeliveries: epiSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<EPIDelivery, 'id'>),
        })),
        safetyPermits: permitsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SafetyPermit, 'id'>),
        })),
        smartDocs: smartDocsSnap.docs.map((d) => {
          const data = d.data() as Omit<SmartDocRecord, 'id'>;
          // Never keep large base64 payload in memory during compliance evaluation
          const { arquivoUrl: _omitted, ...safe } = data;
          return { id: d.id, ...safe };
        }),
      };
    },

    async getPermitById(id: string): Promise<SafetyPermit | null> {
      const snap = await getDoc(doc(firestoreDb, 'safetyPermits', id));
      if (!snap.exists()) return null;
      return { id: snap.id, ...(snap.data() as Omit<SafetyPermit, 'id'>) };
    },

    async createPermit(data: Omit<SafetyPermit, 'id'>): Promise<SafetyPermit> {
      const clean = stripUndefinedDeep(data);
      const docRef = await addDoc(collection(firestoreDb, 'safetyPermits'), clean);
      return { id: docRef.id, ...clean };
    },

    async updatePermit(id: string, data: Partial<SafetyPermit>): Promise<SafetyPermit> {
      const clean = stripUndefinedDeep(data);
      await setDoc(doc(firestoreDb, 'safetyPermits', id), clean, { merge: true });
      const updated = await getDoc(doc(firestoreDb, 'safetyPermits', id));
      return {
        id,
        ...((updated.data() as Omit<SafetyPermit, 'id'>) || (clean as Omit<SafetyPermit, 'id'>)),
      };
    },

    async appendAuditLog(entry: Omit<AuditLog, 'id'>): Promise<void> {
      try {
        await addDoc(collection(firestoreDb, 'auditLogs'), stripUndefinedDeep(entry));
      } catch (err) {
        console.warn('[PermitWorkflow] Falha ao gravar auditLog:', err);
      }
    },
  };
}

export function createInMemoryPermitRepository(
  initial: Partial<PermitOfficialDataset> = {}
): PermitWorkflowRepository & {
  dataset: PermitOfficialDataset;
  auditLogs: AuditLog[];
} {
  const dataset: PermitOfficialDataset = {
    companies: [...(initial.companies || [])],
    employees: [...(initial.employees || [])],
    activityProfiles: [...(initial.activityProfiles || [])],
    activityDocumentRequirements: [...(initial.activityDocumentRequirements || [])],
    documents: [...(initial.documents || [])],
    trainings: [...(initial.trainings || [])],
    exams: [...(initial.exams || [])],
    epiDeliveries: [...(initial.epiDeliveries || [])],
    safetyPermits: [...(initial.safetyPermits || [])],
    smartDocs: [...(initial.smartDocs || [])],
  };
  const auditLogs: AuditLog[] = [];
  let seq = 1;

  return {
    dataset,
    auditLogs,
    async loadOfficialData(): Promise<PermitOfficialDataset> {
      return {
        companies: dataset.companies.map((c) => ({ ...c })),
        employees: dataset.employees.map((e) => ({ ...e })),
        activityProfiles: dataset.activityProfiles.map((a) => ({ ...a })),
        activityDocumentRequirements: dataset.activityDocumentRequirements.map((r) => ({ ...r })),
        documents: dataset.documents.map((d) => ({ ...d })),
        trainings: dataset.trainings.map((t) => ({ ...t })),
        exams: dataset.exams.map((x) => ({ ...x })),
        epiDeliveries: dataset.epiDeliveries.map((epi) => ({ ...epi })),
        safetyPermits: dataset.safetyPermits.map((p) => ({ ...p })),
        smartDocs: dataset.smartDocs.map((sd) => ({ ...sd })),
      };
    },
    async getPermitById(id: string): Promise<SafetyPermit | null> {
      const found = dataset.safetyPermits.find((p) => p.id === id);
      return found ? { ...found } : null;
    },
    async createPermit(data: Omit<SafetyPermit, 'id'>): Promise<SafetyPermit> {
      const id = `permit_mem_${seq++}`;
      const created: SafetyPermit = { id, ...stripUndefinedDeep(data) };
      dataset.safetyPermits.push(created);
      return { ...created };
    },
    async updatePermit(id: string, data: Partial<SafetyPermit>): Promise<SafetyPermit> {
      const idx = dataset.safetyPermits.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
      }
      const merged: SafetyPermit = {
        ...dataset.safetyPermits[idx],
        ...stripUndefinedDeep(data),
        id,
      };
      dataset.safetyPermits[idx] = merged;
      return { ...merged };
    },
    async appendAuditLog(entry: Omit<AuditLog, 'id'>): Promise<void> {
      auditLogs.push({ id: `audit_${auditLogs.length + 1}`, ...entry });
    },
  };
}

export class PermitWorkflowService {
  private readonly repo: PermitWorkflowRepository;

  constructor(repo: PermitWorkflowRepository = createFirestorePermitRepository()) {
    this.repo = repo;
  }

  private assertCanReadPermit(actor: PermitWorkflowActor, permit: SafetyPermit): void {
    if (actor.role === 'admin' || actor.role === 'auditor') return;
    if (actor.role === 'solicitante') {
      if (!actor.empresaId || permit.empresaId !== actor.empresaId) {
        throw new PermitWorkflowError(
          403,
          'COMPANY_SCOPE_FORBIDDEN',
          'Acesso negado: o solicitante só pode visualizar solicitações da própria empresa contratada.'
        );
      }
      return;
    }
    throw new PermitWorkflowError(403, 'FORBIDDEN', 'Perfil sem permissão para acessar solicitações.');
  }

  private assertAdmin(actor: PermitWorkflowActor, actionLabel: string): void {
    if (actor.role !== 'admin') {
      throw new PermitWorkflowError(
        403,
        'ADMIN_ONLY_ACTION',
        `Acesso negado: apenas o Administrador EHS pode executar "${actionLabel}".`
      );
    }
  }

  private assertEditor(actor: PermitWorkflowActor): void {
    if (actor.role !== 'admin' && actor.role !== 'solicitante') {
      throw new PermitWorkflowError(
        403,
        'EDITOR_ONLY_ACTION',
        'Acesso negado: o perfil Auditor possui acesso somente leitura.'
      );
    }
  }

  private assertExpectedVersion(
    permit: SafetyPermit,
    expectedVersion: number | undefined
  ): void {
    if (expectedVersion === undefined || expectedVersion === null) return;
    const currentVersion =
      typeof permit.versaoConcorrencia === 'number' ? permit.versaoConcorrencia : 1;
    if (expectedVersion !== currentVersion) {
      throw new PermitWorkflowError(
        409,
        'CONCURRENCY_VERSION_MISMATCH',
        `Conflito de concorrência: esta solicitação foi atualizada por outra operação (versão esperada ${expectedVersion}, versão atual ${currentVersion}). Atualize os dados e tente novamente.`,
        {
          expectedVersion,
          currentVersion,
        }
      );
    }
  }

  private validateEntitiesAndBuildEvaluation(params: {
    empresaId: string;
    atividadeIds: string[];
    colaboradorIds: string[];
    dataInicio?: string;
    dataFim?: string;
    dataset: PermitOfficialDataset;
    permitAtualId?: string;
    requireActivities?: boolean;
    referenceDate?: Date;
  }): {
    company: Company;
    selectedActivities: ActivityProfile[];
    selectedEmployees: Employee[];
    colaboradoresSnapshot: SafetyPermitEmployeeSnapshot[];
    controlesOperacionais: SafetyPermitOperationalControls;
    compliance: ActivityComplianceResult;
    complianceFingerprint: string;
    structuralErrors: string[];
  } {
    const {
      empresaId,
      atividadeIds,
      colaboradorIds,
      dataInicio,
      dataFim,
      dataset,
      permitAtualId,
      requireActivities = true,
      referenceDate,
    } = params;

    const structuralErrors: string[] = [];

    const company = dataset.companies.find((c) => c.id === empresaId) || null;
    if (!company) {
      throw new PermitWorkflowError(
        404,
        'COMPANY_NOT_FOUND',
        'Empresa contratada não encontrada no cadastro oficial.'
      );
    }

    if (company.situacao !== 'ativa') {
      structuralErrors.push(
        `A empresa contratada "${company.razaoSocial}" está INATIVA e não pode receber novas liberações.`
      );
    }

    if (requireActivities && atividadeIds.length === 0) {
      structuralErrors.push('Selecione ao menos uma atividade crítica cadastrada e ativa.');
    }

    const selectedActivities: ActivityProfile[] = [];
    for (const actId of atividadeIds) {
      const act = dataset.activityProfiles.find((a) => a.id === actId);
      if (!act) {
        structuralErrors.push(`Atividade "${actId}" não encontrada na Matriz de Atividades.`);
        continue;
      }
      if (!act.ativo) {
        structuralErrors.push(
          `A atividade "${act.nome}" (${act.codigo}) está inativa e não pode ser selecionada para liberação.`
        );
      }
      selectedActivities.push(act);
    }

    const selectedEmployees: Employee[] = [];
    for (const empId of colaboradorIds) {
      const emp = dataset.employees.find((e) => e.id === empId);
      if (!emp) {
        structuralErrors.push(`Colaborador "${empId}" não encontrado no cadastro oficial.`);
        continue;
      }
      if (emp.empresaId !== company.id) {
        structuralErrors.push(
          `O colaborador "${emp.nomeCompleto}" pertence a outra empresa contratada (${emp.empresaNome}) e não pode ser vinculado a "${company.razaoSocial}".`
        );
      }
      if (emp.situacaoCadastral !== 'ativo') {
        structuralErrors.push(
          `O colaborador "${emp.nomeCompleto}" está com situação "${emp.situacaoCadastral.toUpperCase()}" e não pode executar atividades.`
        );
      }
      selectedEmployees.push(emp);
    }

    const colaboradoresSnapshot: SafetyPermitEmployeeSnapshot[] = selectedEmployees.map((emp) => ({
      id: emp.id,
      nomeCompleto: emp.nomeCompleto,
      cargo: emp.cargo,
      cpf: emp.cpf,
    }));

    const controlesOperacionais = computeOperationalControls(selectedActivities);

    const refIsoDate = referenceDate ? referenceDate.toISOString().slice(0, 10) : undefined;
    const compliance = evaluateActivityCompliance({
      company,
      atividadeIds,
      colaboradorIds,
      dataReferenciaAtividade: dataInicio || refIsoDate,
      dataFimAtividade: dataFim || undefined,
      permitAtualId,
      activityProfiles: dataset.activityProfiles,
      requirements: dataset.activityDocumentRequirements,
      employees: dataset.employees,
      documents: dataset.documents,
      trainings: dataset.trainings,
      exams: dataset.exams,
      epiDeliveries: dataset.epiDeliveries,
      safetyPermits: dataset.safetyPermits,
      smartDocs: dataset.smartDocs,
    });

    const complianceFingerprint = computeComplianceFingerprint({
      company,
      selectedActivityIds: atividadeIds,
      selectedEmployeeIds: colaboradorIds,
      dataInicio,
      dataFim,
      dataset,
      excludePermitId: permitAtualId,
    });

    return {
      company,
      selectedActivities,
      selectedEmployees,
      colaboradoresSnapshot,
      controlesOperacionais,
      compliance,
      complianceFingerprint,
      structuralErrors,
    };
  }

  private buildHistoryEntry(params: {
    actor: PermitWorkflowActor;
    acao: string;
    statusAnterior: SafetyPermitStatus | null;
    statusNovo: SafetyPermitStatus;
    justificativa?: string;
    nowIso: string;
  }): SafetyPermitWorkflowHistoryEntry {
    return {
      dataHora: params.nowIso,
      usuarioId: params.actor.id,
      usuarioNome: params.actor.nome,
      usuarioRole: params.actor.role,
      acao: params.acao,
      statusAnterior: params.statusAnterior,
      statusNovo: params.statusNovo,
      ...(params.justificativa ? { justificativa: params.justificativa } : {}),
    };
  }

  async listPermits(actor: PermitWorkflowActor): Promise<SafetyPermit[]> {
    const dataset = await this.repo.loadOfficialData();
    let list = dataset.safetyPermits;
    if (actor.role === 'solicitante') {
      list = actor.empresaId
        ? list.filter((p) => p.empresaId === actor.empresaId)
        : [];
    }
    return [...list].sort((a, b) => {
      const aDate = a.updatedAt || a.createdAt || a.dataInicio || '';
      const bDate = b.updatedAt || b.createdAt || b.dataInicio || '';
      return bDate.localeCompare(aDate);
    });
  }

  async createPermitDraft(
    actor: PermitWorkflowActor,
    payload: PermitDraftPayload,
    referenceDate?: Date
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertEditor(actor);
    assertNoForbiddenTamperingFields(payload, 'create');

    const empresaId =
      actor.role === 'solicitante'
        ? actor.empresaId || ''
        : typeof payload.empresaId === 'string'
        ? payload.empresaId.trim()
        : '';

    if (!empresaId) {
      throw new PermitWorkflowError(
        400,
        'COMPANY_REQUIRED',
        actor.role === 'solicitante'
          ? 'Seu perfil de solicitante não está vinculado a nenhuma empresa contratada.'
          : 'Selecione uma empresa contratada ativa.'
      );
    }

    if (
      actor.role === 'solicitante' &&
      payload.empresaId &&
      payload.empresaId.trim() !== actor.empresaId
    ) {
      throw new PermitWorkflowError(
        403,
        'COMPANY_SCOPE_FORBIDDEN',
        'O solicitante só pode criar solicitações para a própria empresa contratada.'
      );
    }

    const tipo: SafetyPermitType =
      payload.tipo && VALID_PERMIT_TYPES.has(payload.tipo) ? payload.tipo : 'PT';
    const titulo = typeof payload.titulo === 'string' ? payload.titulo.trim() : '';
    const localTrabalho =
      typeof payload.localTrabalho === 'string' ? payload.localTrabalho.trim() : '';

    if (!titulo || titulo.length < 3 || titulo.length > 250) {
      throw new PermitWorkflowError(
        400,
        'INVALID_TITLE',
        'Informe um título claro para a solicitação (entre 3 e 250 caracteres).'
      );
    }

    if (!localTrabalho || localTrabalho.length < 2 || localTrabalho.length > 200) {
      throw new PermitWorkflowError(
        400,
        'INVALID_LOCATION',
        'Informe o local de execução da atividade.'
      );
    }

    const dataInicio = typeof payload.dataInicio === 'string' ? payload.dataInicio.trim() : '';
    const dataFim = typeof payload.dataFim === 'string' ? payload.dataFim.trim() : '';

    if (dataInicio && !isValidIsoDateString(dataInicio)) {
      throw new PermitWorkflowError(400, 'INVALID_START_DATE', 'Data de início inválida.');
    }
    if (dataFim && !isValidIsoDateString(dataFim)) {
      throw new PermitWorkflowError(400, 'INVALID_END_DATE', 'Data de término inválida.');
    }
    if (dataInicio && dataFim && dataFim < dataInicio) {
      throw new PermitWorkflowError(
        400,
        'INVALID_DATE_RANGE',
        'A data de término não pode ser anterior à data de início.'
      );
    }

    const atividadeIds = dedupeIds(payload.atividadeIds);
    const colaboradorIds = dedupeIds(payload.colaboradorIds);
    const nowIso = new Date().toISOString();
    const anexosControles = sanitizeControlAttachments(payload.anexosControles, actor.nome, nowIso);

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId,
      atividadeIds,
      colaboradorIds,
      dataInicio,
      dataFim,
      dataset,
      requireActivities: true,
      referenceDate,
    });

    if (evaluated.structuralErrors.length > 0) {
      throw new PermitWorkflowError(
        422,
        'STRUCTURAL_VALIDATION_FAILED',
        evaluated.structuralErrors[0],
        { errors: evaluated.structuralErrors }
      );
    }

    const snapshotValidacao = buildComplianceSnapshot(evaluated.compliance);
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Criação de Rascunho',
      statusAnterior: null,
      statusNovo: 'elaboracao',
      nowIso,
    });

    const newPermitData: Omit<SafetyPermit, 'id'> = {
      tipo,
      titulo,
      descricaoServico:
        typeof payload.descricaoServico === 'string' ? payload.descricaoServico.trim() : '',
      empresaId: evaluated.company.id,
      empresaNome: evaluated.company.razaoSocial,
      localTrabalho,
      dataInicio,
      dataFim,
      responsavelEmissao:
        typeof payload.responsavelEmissao === 'string' && payload.responsavelEmissao.trim()
          ? payload.responsavelEmissao.trim()
          : actor.nome,
      responsavelAtividade:
        typeof payload.responsavelAtividade === 'string'
          ? payload.responsavelAtividade.trim()
          : '',
      riscosIdentificados:
        typeof payload.riscosIdentificados === 'string'
          ? payload.riscosIdentificados.trim()
          : '',
      medidasPreventivas:
        typeof payload.medidasPreventivas === 'string'
          ? payload.medidasPreventivas.trim()
          : '',
      observacoes:
        typeof payload.observacoes === 'string' ? payload.observacoes.trim() : '',
      status: 'elaboracao',
      ...(typeof payload.anexoUrl === 'string' && payload.anexoUrl.trim()
        ? { anexoUrl: payload.anexoUrl.trim() }
        : {}),
      controlesOperacionais: evaluated.controlesOperacionais,
      ...(anexosControles ? { anexosControles } : {}),
      atividadeIds,
      atividadeNomes: evaluated.selectedActivities.map((a) => a.nome),
      colaboradorIds,
      colaboradoresSnapshot: evaluated.colaboradoresSnapshot,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao,
      solicitadoPorId: actor.id,
      solicitadoPorNome: actor.nome,
      solicitadoPorRole: actor.role,
      versaoConcorrencia: 1,
      complianceFingerprint: evaluated.complianceFingerprint,
      validadoServerSide: true,
      historicoWorkflow: [historyEntry],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const created = await this.repo.createPermit(newPermitData);

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Criação de Solicitação de Atividade',
      entidade: 'Liberação de Atividades',
      entidadeId: created.id,
      detalhes: `Rascunho "${created.titulo}" (${created.tipo}) criado para ${created.empresaNome} com ${atividadeIds.length} atividade(s) e ${colaboradorIds.length} executante(s).`,
      dataHora: nowIso,
    });

    return { permit: created, compliance: evaluated.compliance };
  }

  async updatePermitDraft(
    actor: PermitWorkflowActor,
    permitId: string,
    payload: PermitDraftPayload,
    referenceDate?: Date
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertEditor(actor);
    assertNoForbiddenTamperingFields(payload, 'update');

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }

    this.assertCanReadPermit(actor, existing);
    this.assertExpectedVersion(existing, payload.expectedVersion);

    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new PermitWorkflowError(
        409,
        'STATUS_NOT_EDITABLE',
        `Solicitações no status "${existing.status}" não podem ser editadas. Apenas rascunhos ou solicitações com pendência de documentação/correção podem ser alterados.`
      );
    }

    if (
      actor.role === 'solicitante' &&
      payload.empresaId &&
      payload.empresaId.trim() !== existing.empresaId
    ) {
      throw new PermitWorkflowError(
        403,
        'COMPANY_SCOPE_FORBIDDEN',
        'O solicitante não pode transferir a solicitação para outra empresa contratada.'
      );
    }

    const empresaId =
      typeof payload.empresaId === 'string' && payload.empresaId.trim()
        ? payload.empresaId.trim()
        : existing.empresaId;

    const tipo: SafetyPermitType =
      payload.tipo && VALID_PERMIT_TYPES.has(payload.tipo) ? payload.tipo : existing.tipo;
    const titulo =
      typeof payload.titulo === 'string' ? payload.titulo.trim() : existing.titulo;
    const localTrabalho =
      typeof payload.localTrabalho === 'string'
        ? payload.localTrabalho.trim()
        : existing.localTrabalho;
    const dataInicio =
      typeof payload.dataInicio === 'string' ? payload.dataInicio.trim() : existing.dataInicio;
    const dataFim =
      typeof payload.dataFim === 'string' ? payload.dataFim.trim() : existing.dataFim;

    if (!titulo || titulo.length < 3 || titulo.length > 250) {
      throw new PermitWorkflowError(400, 'INVALID_TITLE', 'Título da solicitação inválido.');
    }
    if (!localTrabalho || localTrabalho.length < 2 || localTrabalho.length > 200) {
      throw new PermitWorkflowError(400, 'INVALID_LOCATION', 'Local de trabalho inválido.');
    }
    if (dataInicio && !isValidIsoDateString(dataInicio)) {
      throw new PermitWorkflowError(400, 'INVALID_START_DATE', 'Data de início inválida.');
    }
    if (dataFim && !isValidIsoDateString(dataFim)) {
      throw new PermitWorkflowError(400, 'INVALID_END_DATE', 'Data de término inválida.');
    }
    if (dataInicio && dataFim && dataFim < dataInicio) {
      throw new PermitWorkflowError(
        400,
        'INVALID_DATE_RANGE',
        'A data de término não pode ser anterior à data de início.'
      );
    }

    const atividadeIds =
      payload.atividadeIds !== undefined
        ? dedupeIds(payload.atividadeIds)
        : existing.atividadeIds || [];
    const colaboradorIds =
      payload.colaboradorIds !== undefined
        ? dedupeIds(payload.colaboradorIds)
        : existing.colaboradorIds || [];

    const nowIso = new Date().toISOString();
    const anexosControles =
      payload.anexosControles !== undefined
        ? sanitizeControlAttachments(payload.anexosControles, actor.nome, nowIso)
        : existing.anexosControles;

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId,
      atividadeIds,
      colaboradorIds,
      dataInicio,
      dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: (existing.atividadeIds || []).length > 0 || payload.atividadeIds !== undefined,
      referenceDate,
    });

    if (evaluated.structuralErrors.length > 0) {
      throw new PermitWorkflowError(
        422,
        'STRUCTURAL_VALIDATION_FAILED',
        evaluated.structuralErrors[0],
        { errors: evaluated.structuralErrors }
      );
    }

    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Atualização da Solicitação',
      statusAnterior: existing.status,
      statusNovo: existing.status,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      tipo,
      titulo,
      descricaoServico:
        payload.descricaoServico !== undefined
          ? String(payload.descricaoServico || '').trim()
          : existing.descricaoServico,
      empresaId: evaluated.company.id,
      empresaNome: evaluated.company.razaoSocial,
      localTrabalho,
      dataInicio,
      dataFim,
      responsavelEmissao:
        payload.responsavelEmissao !== undefined
          ? String(payload.responsavelEmissao || '').trim() || existing.responsavelEmissao
          : existing.responsavelEmissao,
      responsavelAtividade:
        payload.responsavelAtividade !== undefined
          ? String(payload.responsavelAtividade || '').trim()
          : existing.responsavelAtividade,
      riscosIdentificados:
        payload.riscosIdentificados !== undefined
          ? String(payload.riscosIdentificados || '').trim()
          : existing.riscosIdentificados,
      medidasPreventivas:
        payload.medidasPreventivas !== undefined
          ? String(payload.medidasPreventivas || '').trim()
          : existing.medidasPreventivas,
      observacoes:
        payload.observacoes !== undefined
          ? String(payload.observacoes || '').trim()
          : existing.observacoes,
      anexoUrl:
        payload.anexoUrl !== undefined
          ? String(payload.anexoUrl || '').trim()
          : existing.anexoUrl,
      controlesOperacionais: evaluated.controlesOperacionais,
      anexosControles,
      atividadeIds,
      atividadeNomes: evaluated.selectedActivities.map((a) => a.nome),
      colaboradorIds,
      colaboradoresSnapshot: evaluated.colaboradoresSnapshot,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Atualização de Solicitação de Atividade',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Solicitação "${updated.titulo}" atualizada no status "${existing.status}" (v${nextVersion}).`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async evaluatePermit(
    actor: PermitWorkflowActor,
    permitId: string,
    referenceDate?: Date
  ): Promise<PermitEvaluationResponse> {
    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertCanReadPermit(actor, existing);

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: (existing.atividadeIds || []).length > 0,
      referenceDate,
    });

    return {
      permit: existing,
      compliance: evaluated.compliance,
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia:
        typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1,
      controlesOperacionais: evaluated.controlesOperacionais,
      structuralErrors: evaluated.structuralErrors,
    };
  }

  async submitPermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions = {}
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertEditor(actor);

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertCanReadPermit(actor, existing);
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `A solicitação no status "${existing.status}" não pode ser enviada para liberação.`
      );
    }

    if (!existing.titulo?.trim() || !existing.localTrabalho?.trim()) {
      throw new PermitWorkflowError(
        400,
        'INCOMPLETE_REQUEST',
        'Informe título e local da atividade antes de enviar a solicitação.'
      );
    }

    if (!isValidIsoDateString(existing.dataInicio) || !isValidIsoDateString(existing.dataFim)) {
      throw new PermitWorkflowError(
        400,
        'DATES_REQUIRED',
        'Informe data de início e data de término válidas antes de enviar a solicitação.'
      );
    }

    if (existing.dataFim < existing.dataInicio) {
      throw new PermitWorkflowError(
        400,
        'INVALID_DATE_RANGE',
        'A data de término não pode ser anterior à data de início.'
      );
    }

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: true,
      referenceDate: options.referenceDate,
    });

    if (evaluated.structuralErrors.length > 0) {
      throw new PermitWorkflowError(
        422,
        'STRUCTURAL_VALIDATION_FAILED',
        evaluated.structuralErrors[0],
        { errors: evaluated.structuralErrors }
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const justificativa = options.justificativa?.trim();
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Envio de Solicitação para Análise EHS',
      statusAnterior: existing.status,
      statusNovo: 'pendente_liberacao',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'pendente_liberacao',
      dataSolicitacao: nowIso,
      solicitadoPorId: existing.solicitadoPorId || actor.id,
      solicitadoPorNome: existing.solicitadoPorNome || actor.nome,
      solicitadoPorRole: existing.solicitadoPorRole || actor.role,
      controlesOperacionais: evaluated.controlesOperacionais,
      atividadeNomes: evaluated.selectedActivities.map((a) => a.nome),
      colaboradoresSnapshot: evaluated.colaboradoresSnapshot,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Envio de Solicitação',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Solicitação "${updated.titulo}" enviada para análise do Admin EHS (${evaluated.compliance.resumo.bloqueiosObrigatorios} bloqueio(s) identificado(s)).`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async startReview(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions = {}
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertAdmin(actor, 'Iniciar Análise Técnica');

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (existing.status !== 'pendente_liberacao') {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Somente solicitações enviadas ("pendente_liberacao") podem entrar em análise. Status atual: "${existing.status}".`
      );
    }

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: (existing.atividadeIds || []).length > 0,
      referenceDate: options.referenceDate,
    });

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const justificativa = options.justificativa?.trim();
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Início de Análise Técnica EHS',
      statusAnterior: existing.status,
      statusNovo: 'em_analise',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'em_analise',
      controlesOperacionais: evaluated.controlesOperacionais,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Início de Análise EHS',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Admin EHS iniciou análise da solicitação "${updated.titulo}". Status documental: ${evaluated.compliance.statusGeral.toUpperCase()}.`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async requestDocumentation(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    return this.transitionToPendingAdjustment(actor, permitId, 'pendente_documentacao', options);
  }

  async requestCorrection(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    return this.transitionToPendingAdjustment(actor, permitId, 'pendente_correcao', options);
  }

  private async transitionToPendingAdjustment(
    actor: PermitWorkflowActor,
    permitId: string,
    targetStatus: 'pendente_documentacao' | 'pendente_correcao',
    options: PermitActionOptions
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    const actionLabel =
      targetStatus === 'pendente_documentacao'
        ? 'Solicitar Documentação Complementar'
        : 'Solicitar Correção da Solicitação';
    this.assertAdmin(actor, actionLabel);

    const justificativa = options.justificativa?.trim() || '';
    if (!justificativa) {
      throw new PermitWorkflowError(
        400,
        'JUSTIFICATION_REQUIRED',
        'A justificativa técnica é obrigatória para devolver a solicitação por pendência.'
      );
    }

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    const allowedSources = new Set<SafetyPermitStatus>([
      'pendente_liberacao',
      'em_analise',
      'pendente_documentacao',
      'pendente_correcao',
    ]);
    if (!allowedSources.has(existing.status)) {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Não é possível marcar como "${targetStatus}" uma solicitação em "${existing.status}".`
      );
    }

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: (existing.atividadeIds || []).length > 0,
      referenceDate: options.referenceDate,
    });

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: actionLabel,
      statusAnterior: existing.status,
      statusNovo: targetStatus,
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: targetStatus,
      motivoCorrecao: justificativa,
      justificativaDecisao: justificativa,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: actionLabel,
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `${actionLabel} para "${updated.titulo}". Motivo: ${justificativa}`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async approvePermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions = {}
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertAdmin(actor, 'Aprovar Solicitação de Atividade');

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (
      existing.solicitadoPorRole === 'solicitante' &&
      existing.solicitadoPorId &&
      existing.solicitadoPorId === actor.id
    ) {
      throw new PermitWorkflowError(
        403,
        'SELF_APPROVAL_FORBIDDEN',
        'Autoaprovação proibida: o solicitante não pode aprovar a própria solicitação.'
      );
    }

    if (existing.status !== 'em_analise' && existing.status !== 'pendente_liberacao') {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Somente solicitações enviadas ("pendente_liberacao") ou em análise ("em_analise") podem ser aprovadas. Status atual: "${existing.status}".`
      );
    }

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: true,
      referenceDate: options.referenceDate,
    });

    if (
      options.expectedComplianceFingerprint &&
      options.expectedComplianceFingerprint !== evaluated.complianceFingerprint
    ) {
      throw new PermitWorkflowError(
        409,
        'COMPLIANCE_CONCURRENCY_CONFLICT',
        'Conflito de concorrência: os documentos, exames, treinamentos ou cadastros oficiais vinculados a esta solicitação foram alterados durante a análise. Reavalie o checklist antes de aprovar.',
        {
          expectedComplianceFingerprint: options.expectedComplianceFingerprint,
          currentComplianceFingerprint: evaluated.complianceFingerprint,
          compliance: evaluated.compliance,
        }
      );
    }

    if (evaluated.structuralErrors.length > 0) {
      throw new PermitWorkflowError(
        422,
        'STRUCTURAL_VALIDATION_FAILED',
        `Aprovação bloqueada: ${evaluated.structuralErrors[0]}`,
        {
          errors: evaluated.structuralErrors,
          compliance: evaluated.compliance,
        }
      );
    }

    if (!evaluated.compliance.podeLiberar) {
      throw new PermitWorkflowError(
        422,
        'COMPLIANCE_BLOCKED',
        `Aprovação bloqueada pelo motor de conformidade: ${evaluated.compliance.resumo.bloqueiosObrigatorios} pendência(s) obrigatória(s) em aberto.`,
        {
          motivosBloqueio: evaluated.compliance.motivosBloqueio,
          compliance: evaluated.compliance,
        }
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const justificativa = options.justificativa?.trim();
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Aprovação Técnica EHS',
      statusAnterior: existing.status,
      statusNovo: 'aprovado',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'aprovado',
      aprovadoPorId: actor.id,
      aprovadoPorNome: actor.nome,
      dataAprovacao: nowIso,
      motivoBloqueioOuRejeicao: '',
      ...(justificativa ? { justificativaDecisao: justificativa } : {}),
      controlesOperacionais: evaluated.controlesOperacionais,
      atividadeNomes: evaluated.selectedActivities.map((a) => a.nome),
      colaboradoresSnapshot: evaluated.colaboradoresSnapshot,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Aprovação de Solicitação de Atividade',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Solicitação "${updated.titulo}" aprovada por ${actor.nome} com validação server-side (${evaluated.compliance.resumo.conformes} conforme(s), ${evaluated.compliance.resumo.alertasAVencer} alerta(s) a vencer).${justificativa ? ` Observação: ${justificativa}` : ''}`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async releasePermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions = {}
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> {
    this.assertAdmin(actor, 'Liberar Execução da Atividade');

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (existing.status !== 'aprovado') {
      throw new PermitWorkflowError(
        409,
        'APPROVAL_REQUIRED_BEFORE_RELEASE',
        `A liberação definitiva exige que a solicitação esteja previamente APROVADA. Status atual: "${existing.status}".`
      );
    }

    const dataset = await this.repo.loadOfficialData();
    const evaluated = this.validateEntitiesAndBuildEvaluation({
      empresaId: existing.empresaId,
      atividadeIds: existing.atividadeIds || [],
      colaboradorIds: existing.colaboradorIds || [],
      dataInicio: existing.dataInicio,
      dataFim: existing.dataFim,
      dataset,
      permitAtualId: existing.id,
      requireActivities: true,
      referenceDate: options.referenceDate,
    });

    // Concurrency protection: detect any official document/ASO/training/company/employee
    // change between approval and release (or compared to client's expected fingerprint).
    const fingerprintChangedSinceApproval =
      Boolean(existing.complianceFingerprint) &&
      existing.complianceFingerprint !== evaluated.complianceFingerprint;
    const fingerprintMismatchWithClient =
      Boolean(options.expectedComplianceFingerprint) &&
      options.expectedComplianceFingerprint !== evaluated.complianceFingerprint;

    if (fingerprintChangedSinceApproval || fingerprintMismatchWithClient) {
      throw new PermitWorkflowError(
        409,
        'COMPLIANCE_CONCURRENCY_CONFLICT',
        'Liberação bloqueada por alteração concorrente: documentos, exames, treinamentos ou cadastros oficiais mudaram após a aprovação. Reavalie a conformidade antes de liberar.',
        {
          previousComplianceFingerprint: existing.complianceFingerprint,
          currentComplianceFingerprint: evaluated.complianceFingerprint,
          blockedByCompliance: !evaluated.compliance.podeLiberar || evaluated.structuralErrors.length > 0,
          compliance: evaluated.compliance,
        }
      );
    }

    if (evaluated.structuralErrors.length > 0) {
      throw new PermitWorkflowError(
        422,
        'STRUCTURAL_VALIDATION_FAILED',
        `Liberação bloqueada: ${evaluated.structuralErrors[0]}`,
        {
          errors: evaluated.structuralErrors,
          compliance: evaluated.compliance,
        }
      );
    }

    if (!evaluated.compliance.podeLiberar) {
      throw new PermitWorkflowError(
        422,
        'COMPLIANCE_BLOCKED',
        `Liberação bloqueada pelo servidor: ${evaluated.compliance.resumo.bloqueiosObrigatorios} pendência(s) obrigatória(s) impede(m) a execução da atividade.`,
        {
          motivosBloqueio: evaluated.compliance.motivosBloqueio,
          compliance: evaluated.compliance,
        }
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const justificativa = options.justificativa?.trim();
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Liberação Oficial de Atividade',
      statusAnterior: existing.status,
      statusNovo: 'liberado',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'liberado',
      liberadoPorId: actor.id,
      liberadoPorNome: actor.nome,
      liberadoPorRole: 'admin',
      dataLiberacao: nowIso,
      motivoBloqueioOuRejeicao: '',
      ...(justificativa ? { justificativaDecisao: justificativa } : {}),
      controlesOperacionais: evaluated.controlesOperacionais,
      atividadeNomes: evaluated.selectedActivities.map((a) => a.nome),
      colaboradoresSnapshot: evaluated.colaboradoresSnapshot,
      statusConformidade: evaluated.compliance.statusGeral,
      pendenciasObrigatoriasCount: evaluated.compliance.resumo.bloqueiosObrigatorios,
      pendenciasAlertaCount: evaluated.compliance.resumo.alertasAVencer,
      snapshotValidacao: buildComplianceSnapshot(evaluated.compliance),
      complianceFingerprint: evaluated.complianceFingerprint,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Liberação de Atividade',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Atividade "${updated.titulo}" LIBERADA oficialmente por ${actor.nome} para ${updated.empresaNome} (${(updated.colaboradorIds || []).length} executante(s)).${justificativa ? ` Observação: ${justificativa}` : ''}`,
      dataHora: nowIso,
    });

    return { permit: updated, compliance: evaluated.compliance };
  }

  async rejectPermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions
  ): Promise<SafetyPermit> {
    this.assertAdmin(actor, 'Reprovar Solicitação');

    const justificativa = options.justificativa?.trim() || '';
    if (!justificativa) {
      throw new PermitWorkflowError(
        400,
        'JUSTIFICATION_REQUIRED',
        'A justificativa técnica é obrigatória para reprovar uma solicitação.'
      );
    }

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    const rejectable = new Set<SafetyPermitStatus>([
      'pendente_liberacao',
      'em_analise',
      'pendente_documentacao',
      'pendente_correcao',
      'aprovado',
    ]);
    if (!rejectable.has(existing.status)) {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Solicitações no status "${existing.status}" não podem ser reprovadas.`
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Reprovação da Solicitação',
      statusAnterior: existing.status,
      statusNovo: 'reprovado',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'reprovado',
      motivoBloqueioOuRejeicao: justificativa,
      justificativaDecisao: justificativa,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Reprovação de Solicitação',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Solicitação "${updated.titulo}" reprovada por ${actor.nome}. Justificativa: ${justificativa}`,
      dataHora: nowIso,
    });

    return updated;
  }

  async cancelPermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions
  ): Promise<SafetyPermit> {
    this.assertEditor(actor);

    const justificativa = options.justificativa?.trim() || '';
    if (!justificativa) {
      throw new PermitWorkflowError(
        400,
        'JUSTIFICATION_REQUIRED',
        'A justificativa é obrigatória para cancelar a solicitação.'
      );
    }

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertCanReadPermit(actor, existing);
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (existing.status === 'cancelado' || existing.status === 'encerrado') {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Solicitações já "${existing.status}" não podem ser canceladas.`
      );
    }

    if (actor.role === 'solicitante' && !SOLICITANTE_CANCELABLE_STATUSES.has(existing.status)) {
      throw new PermitWorkflowError(
        403,
        'SOLICITANTE_CANCEL_FORBIDDEN',
        'O solicitante só pode cancelar rascunhos ou solicitações ainda não aprovadas/em análise definitiva.'
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Cancelamento da Solicitação',
      statusAnterior: existing.status,
      statusNovo: 'cancelado',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'cancelado',
      justificativaDecisao: justificativa,
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Cancelamento de Solicitação',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Solicitação "${updated.titulo}" cancelada por ${actor.nome} (${actor.role}). Justificativa: ${justificativa}`,
      dataHora: nowIso,
    });

    return updated;
  }

  async closePermit(
    actor: PermitWorkflowActor,
    permitId: string,
    options: PermitActionOptions = {}
  ): Promise<SafetyPermit> {
    this.assertAdmin(actor, 'Encerrar Atividade');

    const existing = await this.repo.getPermitById(permitId);
    if (!existing) {
      throw new PermitWorkflowError(404, 'PERMIT_NOT_FOUND', 'Solicitação de atividade não encontrada.');
    }
    this.assertExpectedVersion(existing, options.expectedVersion);

    if (
      existing.status !== 'liberado' &&
      existing.status !== 'em_execucao' &&
      existing.status !== 'aprovado'
    ) {
      throw new PermitWorkflowError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Somente atividades liberadas ou aprovadas podem ser encerradas. Status atual: "${existing.status}".`
      );
    }

    const nowIso = new Date().toISOString();
    const nextVersion =
      (typeof existing.versaoConcorrencia === 'number' ? existing.versaoConcorrencia : 1) + 1;
    const justificativa = options.justificativa?.trim();
    const historyEntry = this.buildHistoryEntry({
      actor,
      acao: 'Encerramento da Atividade',
      statusAnterior: existing.status,
      statusNovo: 'encerrado',
      justificativa,
      nowIso,
    });

    const updated = await this.repo.updatePermit(existing.id, {
      status: 'encerrado',
      ...(justificativa ? { justificativaDecisao: justificativa } : {}),
      versaoConcorrencia: nextVersion,
      validadoServerSide: true,
      historicoWorkflow: [...(existing.historicoWorkflow || []), historyEntry],
      updatedAt: nowIso,
    });

    await this.repo.appendAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Encerramento de Atividade',
      entidade: 'Liberação de Atividades',
      entidadeId: existing.id,
      detalhes: `Atividade "${updated.titulo}" encerrada por ${actor.nome}.${justificativa ? ` Observação: ${justificativa}` : ''}`,
      dataHora: nowIso,
    });

    return updated;
  }
}
