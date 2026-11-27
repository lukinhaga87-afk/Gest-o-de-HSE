import crypto from 'node:crypto';
import type {
  AuditLog,
  Company,
  ConclusaoAptidao,
  DocumentCategory,
  DocumentSST,
  DocumentStatus,
  DocumentVersion,
  Employee,
  IntegrationOfficialCollection,
  OccupationalExam,
  PendingDocumentVersion,
  Training,
  UserProfile,
  UserRole,
} from '../src/types/sst';
import {
  serverAddDoc,
  serverGetDoc,
  serverListCollection,
  serverSetDoc,
  serverUpdateDoc,
} from './firestoreServer';
import {
  IntegrationFileStorage,
  buildSafeStorageKey,
  computeBufferSha256,
  createDefaultIntegrationFileStorage,
  validateBinaryMagicBytes,
} from './integrationFileStorage';
import { InAppNotificationService } from './inAppNotificationService';
import {
  detectRealMimeFromBuffer,
  normalizeDeclaredMime,
} from './multipartUpload';
import { formatCNPJ, formatCPF } from '../src/utils/trafficLight';

export const DIRECT_FILE_URL_PREFIX = 'ehs-direct://';
export const MAX_DIRECT_DOCUMENT_BYTES = 4 * 1024 * 1024; // 4 MB

export interface ThirdPartyActor {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  empresaId?: string;
  empresaIds?: string[];
}

export class ThirdPartyWorkflowError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, any>;

  constructor(
    message: string,
    statusCode = 400,
    code = 'THIRD_PARTY_ERROR',
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ThirdPartyWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface RegisterCompanyInput {
  razaoSocial: string;
  nomeFantasia?: string;
  cnpj: string;
  responsavelLegal?: string;
  responsavelSST?: string;
  telefone?: string;
  email?: string;
  endereco?: string;
  unidadeAtendimento?: string;
  atividadeContratada?: string;
  atividadesAutorizadasIds?: string[];
  dataInicioContrato?: string;
  dataTerminoContrato?: string;
  contrato_indeterminado?: boolean;
  situacao?: 'ativa' | 'inativa';
}

export interface RegisterEmployeeInput {
  empresaId: string;
  nomeCompleto: string;
  cpf: string;
  rg?: string;
  dataNascimento?: string;
  telefone?: string;
  email?: string;
  matricula?: string;
  cargo: string;
  setor?: string;
  atividadeExecutada?: string;
  atividadesHabilitadasIds?: string[];
  unidadeAlocacao?: string;
  dataAdmissao?: string;
  dataIntegracao?: string;
  responsavelEmpresa?: string;
  situacaoCadastral?: Employee['situacaoCadastral'];
  fotoUrl?: string;
}

export interface UploadDirectDocumentInput {
  kind?: 'documento' | 'exame' | 'treinamento';
  recordId?: string; // Optional existing ID when replacing/resubmitting a rejected document
  empresaId: string;
  colaboradorId?: string;
  nomeDocumento: string;
  tipoDocumentoCanonico?: string;
  categoria?: DocumentCategory | string;
  numeroDocumento?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  conclusao?: ConclusaoAptidao;
  medicoResponsavel?: string;
  crmMedico?: string;
  cargaHoraria?: string;
  instrutor?: string;
  observacoes?: string;
  arquivoNome: string;
  arquivoBase64?: string;
  arquivoBuffer?: Buffer;
  arquivoMimeType?: string;
}

export interface ReviewDirectDocumentInput {
  decisao: 'aprovado' | 'reprovado';
  motivo?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  conclusao?: ConclusaoAptidao;
}

export interface OfficialDocumentReviewedEvent {
  actor?: ThirdPartyActor;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  colecao: IntegrationOfficialCollection;
  registroId: string;
  empresaId: string;
  colaboradorId?: string;
  tipoDocumentoCanonico?: string;
  nomeDocumento: string;
  decisao: 'aprovado' | 'reprovado';
  motivo?: string;
  arquivoUrl?: string;
  arquivoNome?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  conclusaoAso?: ConclusaoAptidao;
  versao: number;
  analisadoEm?: string;
  dataAnalise?: string;
}

function isOfficialDateStillValid(dataValidade?: string, semValidade?: boolean): boolean {
  if (semValidade) return true;
  const trimmed = String(dataValidade || '').trim();
  if (!trimmed) return true;
  const isoDay = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  return isoDay >= todayIso;
}

export interface DirectDocumentFileRecord {
  id: string;
  empresaId: string;
  colaboradorId?: string;
  recordId: string;
  kind: 'documento' | 'exame' | 'treinamento';
  storageKey: string;
  arquivoNome: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  sha256: string;
  uploadedById: string;
  createdAt: string;
}

export interface ThirdPartyRepository {
  listCompanies(): Promise<Company[]>;
  getCompanyById(id: string): Promise<Company | null>;
  createCompany(data: Omit<Company, 'id'>): Promise<Company>;
  updateCompany(id: string, updates: Partial<Company>): Promise<void>;

  listUserProfiles(): Promise<UserProfile[]>;
  getUserProfileById(id: string): Promise<UserProfile | null>;
  updateUserProfile(id: string, updates: Partial<UserProfile>): Promise<void>;

  listEmployees(): Promise<Employee[]>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(data: Omit<Employee, 'id'>): Promise<Employee>;
  updateEmployee(id: string, updates: Partial<Employee>): Promise<void>;

  listDocuments(): Promise<DocumentSST[]>;
  getDocumentById(id: string): Promise<DocumentSST | null>;
  createDocument(data: Omit<DocumentSST, 'id'>): Promise<DocumentSST>;
  updateDocument(id: string, updates: Partial<DocumentSST>): Promise<void>;

  listExams(): Promise<OccupationalExam[]>;
  getExamById(id: string): Promise<OccupationalExam | null>;
  createExam(data: Omit<OccupationalExam, 'id'>): Promise<OccupationalExam>;
  updateExam(id: string, updates: Partial<OccupationalExam>): Promise<void>;

  listTrainings(): Promise<Training[]>;
  getTrainingById(id: string): Promise<Training | null>;
  createTraining(data: Omit<Training, 'id'>): Promise<Training>;
  updateTraining(id: string, updates: Partial<Training>): Promise<void>;

  addAuditLog(log: Omit<AuditLog, 'id'>): Promise<void>;
}

function digitsOnly(val?: string): string {
  return String(val || '').replace(/\D/g, '');
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

function decodeBase64Document(
  rawInput: string,
  fileName: string
): {
  buffer: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
} {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    throw new ThirdPartyWorkflowError('Arquivo obrigatório para envio.', 400, 'FILE_REQUIRED');
  }

  let declaredMime = '';
  let base64Body = raw;
  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    declaredMime = dataUrlMatch[1].toLowerCase().trim();
    base64Body = dataUrlMatch[2].trim();
  }

  const lowerName = fileName.toLowerCase();
  let mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | null = null;
  if (declaredMime === 'application/pdf' || (!declaredMime && lowerName.endsWith('.pdf'))) {
    mimeType = 'application/pdf';
  } else if (
    declaredMime === 'image/jpeg' ||
    declaredMime === 'image/jpg' ||
    (!declaredMime && (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')))
  ) {
    mimeType = 'image/jpeg';
  } else if (declaredMime === 'image/png' || (!declaredMime && lowerName.endsWith('.png'))) {
    mimeType = 'image/png';
  }

  if (!mimeType) {
    throw new ThirdPartyWorkflowError(
      'Formato não suportado. Envie apenas arquivos PDF, JPG ou PNG.',
      400,
      'UNSUPPORTED_FILE_FORMAT'
    );
  }

  const buffer = Buffer.from(base64Body, 'base64');
  if (buffer.length === 0) {
    throw new ThirdPartyWorkflowError('O arquivo selecionado está vazio.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_DIRECT_DOCUMENT_BYTES) {
    throw new ThirdPartyWorkflowError(
      'O arquivo excede o tamanho máximo permitido de 4 MB.',
      413,
      'FILE_TOO_LARGE'
    );
  }

  if (!validateBinaryMagicBytes(buffer, mimeType)) {
    throw new ThirdPartyWorkflowError(
      'O conteúdo binário do arquivo não corresponde ao formato informado (PDF, JPG ou PNG).',
      400,
      'INVALID_FILE_SIGNATURE'
    );
  }

  return { buffer, mimeType };
}

function validateBinaryBufferDocument(
  buffer: Buffer,
  fileName: string,
  declaredMime?: string
): {
  buffer: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
} {
  if (!buffer || buffer.length === 0) {
    throw new ThirdPartyWorkflowError('O arquivo selecionado está vazio.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_DIRECT_DOCUMENT_BYTES) {
    throw new ThirdPartyWorkflowError(
      'O arquivo excede o tamanho máximo permitido de 4 MB.',
      413,
      'FILE_TOO_LARGE'
    );
  }

  const realMime = detectRealMimeFromBuffer(buffer);
  if (!realMime) {
    throw new ThirdPartyWorkflowError(
      `O conteúdo binário do arquivo "${fileName}" não é um PDF, JPG ou PNG válido.`,
      400,
      'INVALID_FILE_SIGNATURE'
    );
  }

  const normalizedDeclared = normalizeDeclaredMime(declaredMime);
  if (normalizedDeclared && normalizedDeclared !== realMime) {
    throw new ThirdPartyWorkflowError(
      `O conteúdo binário do arquivo "${fileName}" não corresponde ao formato informado (${normalizedDeclared}).`,
      400,
      'INVALID_FILE_SIGNATURE'
    );
  }

  return { buffer, mimeType: realMime };
}

export function createFirestoreThirdPartyRepository(): ThirdPartyRepository {
  return {
    async listCompanies() {
      const docs = await serverListCollection<Omit<Company, 'id'>>('companies');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getCompanyById(id: string) {
      const snap = await serverGetDoc<Omit<Company, 'id'>>('companies', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async createCompany(data) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('companies', clean);
      return { id, ...clean };
    },
    async updateCompany(id, updates) {
      await serverUpdateDoc('companies', id, stripUndefined(updates));
    },

    async listUserProfiles() {
      const docs = await serverListCollection<Omit<UserProfile, 'id'>>('userProfiles');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getUserProfileById(id: string) {
      const snap = await serverGetDoc<Omit<UserProfile, 'id'>>('userProfiles', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async updateUserProfile(id, updates) {
      await serverSetDoc('userProfiles', id, stripUndefined(updates), { merge: true });
    },

    async listEmployees() {
      const docs = await serverListCollection<Omit<Employee, 'id'>>('employees');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getEmployeeById(id: string) {
      const snap = await serverGetDoc<Omit<Employee, 'id'>>('employees', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async createEmployee(data) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('employees', clean);
      return { id, ...clean };
    },
    async updateEmployee(id, updates) {
      await serverUpdateDoc('employees', id, stripUndefined(updates));
    },

    async listDocuments() {
      const docs = await serverListCollection<Omit<DocumentSST, 'id'>>('documents');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getDocumentById(id: string) {
      const snap = await serverGetDoc<Omit<DocumentSST, 'id'>>('documents', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async createDocument(data) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('documents', clean);
      return { id, ...clean };
    },
    async updateDocument(id, updates) {
      await serverUpdateDoc('documents', id, stripUndefined(updates));
    },

    async listExams() {
      const docs = await serverListCollection<Omit<OccupationalExam, 'id'>>('exams');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getExamById(id: string) {
      const snap = await serverGetDoc<Omit<OccupationalExam, 'id'>>('exams', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async createExam(data) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('exams', clean);
      return { id, ...clean };
    },
    async updateExam(id, updates) {
      await serverUpdateDoc('exams', id, stripUndefined(updates));
    },

    async listTrainings() {
      const docs = await serverListCollection<Omit<Training, 'id'>>('trainings');
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getTrainingById(id: string) {
      const snap = await serverGetDoc<Omit<Training, 'id'>>('trainings', id);
      return snap ? { id: snap.id, ...snap.data } : null;
    },
    async createTraining(data) {
      const clean = stripUndefined(data);
      const id = await serverAddDoc('trainings', clean);
      return { id, ...clean };
    },
    async updateTraining(id, updates) {
      await serverUpdateDoc('trainings', id, stripUndefined(updates));
    },

    async addAuditLog(log) {
      try {
        await serverAddDoc('auditLogs', stripUndefined(log));
      } catch (err) {
        console.warn('[ThirdPartyManagement] Falha não-bloqueante ao gravar auditLog:', err);
      }
    },
  };
}

export function createInMemoryThirdPartyRepository(seed?: {
  companies?: Company[];
  userProfiles?: UserProfile[];
  employees?: Employee[];
  documents?: DocumentSST[];
  exams?: OccupationalExam[];
  trainings?: Training[];
}): ThirdPartyRepository & {
  state: {
    companies: Company[];
    userProfiles: UserProfile[];
    employees: Employee[];
    documents: DocumentSST[];
    exams: OccupationalExam[];
    trainings: Training[];
    auditLogs: AuditLog[];
  };
} {
  let seq = 1;
  const state = {
    companies: [...(seed?.companies || [])],
    userProfiles: [...(seed?.userProfiles || [])],
    employees: [...(seed?.employees || [])],
    documents: [...(seed?.documents || [])],
    exams: [...(seed?.exams || [])],
    trainings: [...(seed?.trainings || [])],
    auditLogs: [] as AuditLog[],
  };

  return {
    state,
    async listCompanies() {
      return [...state.companies];
    },
    async getCompanyById(id) {
      return state.companies.find((c) => c.id === id) || null;
    },
    async createCompany(data) {
      const created: Company = { id: `comp-${seq++}`, ...stripUndefined(data) };
      state.companies.push(created);
      return created;
    },
    async updateCompany(id, updates) {
      const idx = state.companies.findIndex((c) => c.id === id);
      if (idx >= 0) {
        state.companies[idx] = { ...state.companies[idx], ...stripUndefined(updates) };
      }
    },

    async listUserProfiles() {
      return [...state.userProfiles];
    },
    async getUserProfileById(id) {
      return state.userProfiles.find((u) => u.id === id) || null;
    },
    async updateUserProfile(id, updates) {
      const idx = state.userProfiles.findIndex((u) => u.id === id);
      if (idx >= 0) {
        state.userProfiles[idx] = { ...state.userProfiles[idx], ...stripUndefined(updates) };
      }
    },

    async listEmployees() {
      return [...state.employees];
    },
    async getEmployeeById(id) {
      return state.employees.find((e) => e.id === id) || null;
    },
    async createEmployee(data) {
      const created: Employee = { id: `emp-${seq++}`, ...stripUndefined(data) };
      state.employees.push(created);
      return created;
    },
    async updateEmployee(id, updates) {
      const idx = state.employees.findIndex((e) => e.id === id);
      if (idx >= 0) {
        state.employees[idx] = { ...state.employees[idx], ...stripUndefined(updates) };
      }
    },

    async listDocuments() {
      return [...state.documents];
    },
    async getDocumentById(id) {
      return state.documents.find((d) => d.id === id) || null;
    },
    async createDocument(data) {
      const created: DocumentSST = { id: `doc-${seq++}`, ...stripUndefined(data) };
      state.documents.push(created);
      return created;
    },
    async updateDocument(id, updates) {
      const idx = state.documents.findIndex((d) => d.id === id);
      if (idx >= 0) {
        state.documents[idx] = { ...state.documents[idx], ...stripUndefined(updates) };
      }
    },

    async listExams() {
      return [...state.exams];
    },
    async getExamById(id) {
      return state.exams.find((e) => e.id === id) || null;
    },
    async createExam(data) {
      const created: OccupationalExam = { id: `exam-${seq++}`, ...stripUndefined(data) };
      state.exams.push(created);
      return created;
    },
    async updateExam(id, updates) {
      const idx = state.exams.findIndex((e) => e.id === id);
      if (idx >= 0) {
        state.exams[idx] = { ...state.exams[idx], ...stripUndefined(updates) };
      }
    },

    async listTrainings() {
      return [...state.trainings];
    },
    async getTrainingById(id) {
      return state.trainings.find((t) => t.id === id) || null;
    },
    async createTraining(data) {
      const created: Training = { id: `trn-${seq++}`, ...stripUndefined(data) };
      state.trainings.push(created);
      return created;
    },
    async updateTraining(id, updates) {
      const idx = state.trainings.findIndex((t) => t.id === id);
      if (idx >= 0) {
        state.trainings[idx] = { ...state.trainings[idx], ...stripUndefined(updates) };
      }
    },

    async addAuditLog(log) {
      state.auditLogs.push({ id: `audit-${seq++}`, ...log });
    },
  };
}

export class ThirdPartyManagementService {
  private readonly repo: ThirdPartyRepository;
  private readonly fileStorage: IntegrationFileStorage;
  private readonly notificationService?: InAppNotificationService;
  private onOfficialDocumentReviewed?: (
    event: OfficialDocumentReviewedEvent
  ) => Promise<{ updatedIntegrations: number; updatedItems: number } | void>;

  constructor(opts?: {
    repo?: ThirdPartyRepository;
    fileStorage?: IntegrationFileStorage;
    notificationService?: InAppNotificationService;
    onOfficialDocumentReviewed?: (
      event: OfficialDocumentReviewedEvent
    ) => Promise<{ updatedIntegrations: number; updatedItems: number } | void>;
  }) {
    this.repo = opts?.repo || createFirestoreThirdPartyRepository();
    this.fileStorage = opts?.fileStorage || createDefaultIntegrationFileStorage();
    this.notificationService = opts?.notificationService;
    this.onOfficialDocumentReviewed = opts?.onOfficialDocumentReviewed;
  }

  setOnOfficialDocumentReviewed(
    handler: (
      event: OfficialDocumentReviewedEvent
    ) => Promise<{ updatedIntegrations: number; updatedItems: number } | void>
  ): void {
    this.onOfficialDocumentReviewed = handler;
  }

  private assertCanWrite(actor: ThirdPartyActor, actionLabel: string): void {
    if (actor.role === 'auditor') {
      throw new ThirdPartyWorkflowError(
        `Perfil Auditor possui acesso exclusivo para consulta e não pode ${actionLabel}.`,
        403,
        'AUDITOR_READ_ONLY'
      );
    }
    if (actor.role !== 'admin' && actor.role !== 'solicitante') {
      throw new ThirdPartyWorkflowError('Perfil sem autorização para esta operação.', 403, 'FORBIDDEN');
    }
  }

  private async resolveAuthorizedCompanyIds(actor: ThirdPartyActor): Promise<Set<string>> {
    const ids = new Set<string>(
      [
        ...(Array.isArray(actor.empresaIds) ? actor.empresaIds : []),
        ...(actor.empresaId ? [actor.empresaId] : []),
      ]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    );

    // Also include authoritative DB profile links and company.solicitantesAutorizadosIds
    const dbProfile = await this.repo.getUserProfileById(actor.id);
    if (dbProfile) {
      if (dbProfile.empresaId) ids.add(dbProfile.empresaId);
      for (const eid of dbProfile.empresaIds || []) {
        if (eid) ids.add(eid);
      }
    }

    const allCompanies = await this.repo.listCompanies();
    for (const comp of allCompanies) {
      if (
        comp.criadoPorId === actor.id ||
        (Array.isArray(comp.solicitantesAutorizadosIds) &&
          comp.solicitantesAutorizadosIds.includes(actor.id))
      ) {
        ids.add(comp.id);
      }
    }

    return ids;
  }

  private async assertCompanyAccess(
    actor: ThirdPartyActor,
    empresaId: string,
    actionLabel: string
  ): Promise<Company> {
    const company = await this.repo.getCompanyById(empresaId);
    if (!company) {
      throw new ThirdPartyWorkflowError('Empresa contratada não encontrada.', 404, 'COMPANY_NOT_FOUND');
    }
    if (actor.role === 'solicitante') {
      const authorized = await this.resolveAuthorizedCompanyIds(actor);
      if (!authorized.has(company.id)) {
        throw new ThirdPartyWorkflowError(
          `Acesso negado: você não possui autorização para ${actionLabel} nesta empresa.`,
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
    }
    return company;
  }

  /**
   * Registers a new contractor company with duplicate CNPJ validation
   * and automatic persistent linking to the registering Solicitante.
   */
  async registerCompany(
    actor: ThirdPartyActor,
    input: RegisterCompanyInput
  ): Promise<{ company: Company; updatedUser?: UserProfile | null }> {
    this.assertCanWrite(actor, 'cadastrar empresas');

    const razaoSocial = (input.razaoSocial || '').trim();
    const rawCnpj = (input.cnpj || '').trim();
    const cnpjDigits = digitsOnly(rawCnpj);

    if (!razaoSocial || razaoSocial.length < 2) {
      throw new ThirdPartyWorkflowError('Razão Social obrigatória.', 400, 'INVALID_COMPANY_NAME');
    }
    if (cnpjDigits.length !== 14) {
      throw new ThirdPartyWorkflowError(
        'CNPJ inválido. Informe os 14 dígitos do CNPJ da empresa.',
        400,
        'INVALID_CNPJ'
      );
    }

    const allCompanies = await this.repo.listCompanies();
    const existingByCnpj = allCompanies.find((c) => digitsOnly(c.cnpj) === cnpjDigits);
    if (existingByCnpj) {
      if (actor.role === 'solicitante') {
        const authorized = await this.resolveAuthorizedCompanyIds(actor);
        if (authorized.has(existingByCnpj.id)) {
          throw new ThirdPartyWorkflowError(
            `A empresa "${existingByCnpj.razaoSocial}" (CNPJ ${formatCNPJ(cnpjDigits)}) já está cadastrada e vinculada ao seu perfil em Minhas Empresas.`,
            409,
            'COMPANY_ALREADY_LINKED',
            { companyId: existingByCnpj.id }
          );
        }
        throw new ThirdPartyWorkflowError(
          `O CNPJ ${formatCNPJ(cnpjDigits)} já está cadastrado no sistema (${existingByCnpj.razaoSocial}). Por segurança, solicite ao Administrador EHS a vinculação do seu usuário a esta empresa.`,
          409,
          'CNPJ_ALREADY_EXISTS',
          { existingCompanyId: existingByCnpj.id }
        );
      }
      throw new ThirdPartyWorkflowError(
        `Já existe uma empresa cadastrada com o CNPJ ${formatCNPJ(cnpjDigits)} (${existingByCnpj.razaoSocial}).`,
        409,
        'CNPJ_ALREADY_EXISTS',
        { existingCompanyId: existingByCnpj.id }
      );
    }

    const now = new Date().toISOString();
    const isIndeterminate = Boolean(input.contrato_indeterminado);
    const formattedCnpj = formatCNPJ(cnpjDigits);

    const company = await this.repo.createCompany({
      razaoSocial,
      nomeFantasia: (input.nomeFantasia || razaoSocial).trim(),
      cnpj: formattedCnpj,
      responsavelLegal: (input.responsavelLegal || '').trim(),
      responsavelSST: (input.responsavelSST || '').trim(),
      telefone: (input.telefone || '').trim(),
      email: (input.email || '').trim(),
      endereco: (input.endereco || '').trim(),
      unidadeAtendimento: (input.unidadeAtendimento || '').trim(),
      atividadeContratada: (input.atividadeContratada || '').trim(),
      atividadesAutorizadasIds: Array.isArray(input.atividadesAutorizadasIds)
        ? Array.from(new Set(input.atividadesAutorizadasIds.filter(Boolean)))
        : [],
      dataInicioContrato: (input.dataInicioContrato || '').trim(),
      dataTerminoContrato: isIndeterminate ? '' : (input.dataTerminoContrato || '').trim(),
      contrato_indeterminado: isIndeterminate,
      situacao: input.situacao === 'inativa' ? 'inativa' : 'ativa',
      solicitantesAutorizadosIds: actor.role === 'solicitante' ? [actor.id] : [],
      criadoPorId: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    let updatedUser: UserProfile | null = null;
    if (actor.role === 'solicitante') {
      const userDoc = await this.repo.getUserProfileById(actor.id);
      const currentIds = new Set<string>(
        [
          ...(Array.isArray(userDoc?.empresaIds) ? userDoc!.empresaIds : []),
          ...(userDoc?.empresaId ? [userDoc.empresaId] : []),
          ...(Array.isArray(actor.empresaIds) ? actor.empresaIds : []),
          ...(actor.empresaId ? [actor.empresaId] : []),
          company.id,
        ].filter(Boolean)
      );
      const nextEmpresaIds = Array.from(currentIds);
      const primaryEmpresaId = userDoc?.empresaId || company.id;
      const primaryEmpresaNome = userDoc?.empresaNome || company.razaoSocial;

      if (userDoc) {
        await this.repo.updateUserProfile(actor.id, {
          empresaId: primaryEmpresaId,
          empresaNome: primaryEmpresaNome,
          empresaIds: nextEmpresaIds,
          updatedAt: now,
        });
        updatedUser = {
          ...userDoc,
          empresaId: primaryEmpresaId,
          empresaNome: primaryEmpresaNome,
          empresaIds: nextEmpresaIds,
          updatedAt: now,
        };
      }
    }

    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Criação e Vínculo de Empresa',
      entidade: 'Empresa',
      entidadeId: company.id,
      detalhes: `Empresa ${company.razaoSocial} (CNPJ ${company.cnpj}) cadastrada por ${actor.nome} (${actor.role})${
        actor.role === 'solicitante' ? ' e vinculada automaticamente ao perfil Solicitante.' : '.'
      }`,
      dataHora: now,
    });

    if (this.notificationService) {
      await this.notificationService.createIdempotentNotification({
        recipientRole: 'admin',
        empresaId: company.id,
        empresaNome: company.nomeFantasia || company.razaoSocial,
        companyId: company.id,
        type: 'NOVA_CONTRATADA',
        severity: 'info',
        title: `Nova empresa cadastrada — ${company.nomeFantasia || company.razaoSocial}`,
        message: `A empresa ${company.razaoSocial} (CNPJ ${company.cnpj}) foi cadastrada por ${actor.nome} e está disponível para gestão documental.`,
        actionLabel: 'Ver empresa',
        actionTab: 'empresas',
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `nova-empresa:admin:${company.id}`,
      });

      if (actor.role === 'solicitante') {
        await this.notificationService.createIdempotentNotification({
          recipientRole: 'solicitante',
          recipientUserId: actor.id,
          empresaId: company.id,
          empresaNome: company.nomeFantasia || company.razaoSocial,
          companyId: company.id,
          type: 'NOVA_CONTRATADA',
          severity: 'success',
          title: `Empresa vinculada em Minhas Empresas — ${company.nomeFantasia || company.razaoSocial}`,
          message: `O cadastro de ${company.razaoSocial} foi salvo e vinculado automaticamente ao seu perfil. Você já pode anexar a documentação empresarial e cadastrar colaboradores.`,
          actionLabel: 'Abrir Minhas Empresas',
          actionTab: 'empresas',
          createdById: actor.id,
          createdByNome: actor.nome,
          createdByRole: actor.role,
          idempotencyKey: `nova-empresa:solicitante:${company.id}:${actor.id}`,
        });
      }
    }

    return { company, updatedUser };
  }

  /**
   * Admin EHS manages which Solicitante users are authorized for a company.
   * Supports multiple Solicitantes per company and multiple companies per Solicitante.
   */
  async updateCompanySolicitanteLinks(
    actor: ThirdPartyActor,
    companyId: string,
    solicitanteUserIds: string[]
  ): Promise<{ company: Company; linkedUserIds: string[] }> {
    if (actor.role !== 'admin') {
      throw new ThirdPartyWorkflowError(
        'Apenas o Administrador EHS pode gerenciar vínculos entre Solicitantes e empresas.',
        403,
        'ADMIN_REQUIRED'
      );
    }

    const company = await this.repo.getCompanyById(companyId);
    if (!company) {
      throw new ThirdPartyWorkflowError('Empresa contratada não encontrada.', 404, 'COMPANY_NOT_FOUND');
    }

    const allUsers = await this.repo.listUserProfiles();
    const validSolicitanteIds = Array.from(
      new Set(
        solicitanteUserIds
          .map((id) => String(id || '').trim())
          .filter((id) => allUsers.some((u) => u.id === id && u.role === 'solicitante'))
      )
    );

    const now = new Date().toISOString();
    await this.repo.updateCompany(company.id, {
      solicitantesAutorizadosIds: validSolicitanteIds,
      updatedAt: now,
    });

    // Synchronize empresaIds / empresaId on all Solicitante profiles
    for (const user of allUsers) {
      if (user.role !== 'solicitante') continue;
      const prevIds = new Set<string>(
        [...(user.empresaIds || []), ...(user.empresaId ? [user.empresaId] : [])].filter(Boolean)
      );
      const shouldHave = validSolicitanteIds.includes(user.id);
      const alreadyHas = prevIds.has(company.id);

      if (shouldHave && !alreadyHas) {
        prevIds.add(company.id);
        const nextIds = Array.from(prevIds);
        await this.repo.updateUserProfile(user.id, {
          empresaIds: nextIds,
          empresaId: user.empresaId || company.id,
          empresaNome: user.empresaNome || company.razaoSocial,
          updatedAt: now,
        });
      } else if (!shouldHave && alreadyHas) {
        prevIds.delete(company.id);
        const nextIds = Array.from(prevIds);
        const nextPrimaryId = nextIds[0] || '';
        const nextPrimaryComp = nextPrimaryId
          ? await this.repo.getCompanyById(nextPrimaryId)
          : null;
        await this.repo.updateUserProfile(user.id, {
          empresaIds: nextIds,
          empresaId: nextPrimaryId,
          empresaNome: nextPrimaryComp?.razaoSocial || '',
          updatedAt: now,
        });
      }
    }

    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Gestão de Vínculos Empresa-Solicitante',
      entidade: 'Empresa',
      entidadeId: company.id,
      detalhes: `Vínculos de "${company.razaoSocial}" atualizados para ${validSolicitanteIds.length} solicitante(s) autorizado(s).`,
      dataHora: now,
    });

    const refreshed = (await this.repo.getCompanyById(company.id)) || {
      ...company,
      solicitantesAutorizadosIds: validSolicitanteIds,
    };
    return { company: refreshed, linkedUserIds: validSolicitanteIds };
  }

  /**
   * Registers a third-party collaborator linked to an authorized company with strict CPF deduplication.
   */
  async registerEmployee(
    actor: ThirdPartyActor,
    input: RegisterEmployeeInput
  ): Promise<{ employee: Employee }> {
    this.assertCanWrite(actor, 'cadastrar colaboradores');

    const nomeCompleto = (input.nomeCompleto || '').trim();
    const cargo = (input.cargo || '').trim();
    const cpfDigits = digitsOnly(input.cpf);
    const empresaId = (input.empresaId || '').trim();

    if (!nomeCompleto || !cargo || !empresaId) {
      throw new ThirdPartyWorkflowError(
        'Nome completo, CPF, Empresa Contratada e Cargo/Função são obrigatórios.',
        400,
        'INVALID_EMPLOYEE_DATA'
      );
    }
    if (cpfDigits.length !== 11) {
      throw new ThirdPartyWorkflowError(
        'CPF inválido. Informe os 11 dígitos do CPF do colaborador.',
        400,
        'INVALID_CPF'
      );
    }

    const company = await this.assertCompanyAccess(actor, empresaId, 'cadastrar colaboradores');

    const allEmployees = await this.repo.listEmployees();
    const duplicate = allEmployees.find((e) => digitsOnly(e.cpf) === cpfDigits);
    if (duplicate) {
      if (duplicate.empresaId === company.id) {
        throw new ThirdPartyWorkflowError(
          `Colaborador com CPF ${formatCPF(cpfDigits)} (${duplicate.nomeCompleto}) já está cadastrado nesta empresa.`,
          409,
          'DUPLICATE_EMPLOYEE_CPF',
          { existingEmployeeId: duplicate.id }
        );
      }
      throw new ThirdPartyWorkflowError(
        `CPF ${formatCPF(cpfDigits)} já está vinculado a outra empresa contratada no sistema. Cadastro duplicado bloqueado.`,
        409,
        'DUPLICATE_EMPLOYEE_CPF_OTHER_COMPANY'
      );
    }

    const now = new Date().toISOString();
    const employee = await this.repo.createEmployee({
      empresaId: company.id,
      empresaNome: company.razaoSocial,
      nomeCompleto,
      cpf: formatCPF(cpfDigits),
      rg: (input.rg || '').trim(),
      dataNascimento: (input.dataNascimento || '').trim(),
      telefone: (input.telefone || '').trim(),
      email: (input.email || '').trim(),
      matricula: (input.matricula || '').trim(),
      cargo,
      setor: (input.setor || 'Operacional Terceirizado').trim(),
      atividadeExecutada: (input.atividadeExecutada || '').trim(),
      atividadesHabilitadasIds: Array.isArray(input.atividadesHabilitadasIds)
        ? Array.from(new Set(input.atividadesHabilitadasIds.filter(Boolean)))
        : [],
      unidadeAlocacao: (input.unidadeAlocacao || '').trim(),
      dataAdmissao: (input.dataAdmissao || '').trim(),
      dataIntegracao: (input.dataIntegracao || '').trim(),
      responsavelEmpresa: (input.responsavelEmpresa || company.responsavelLegal || '').trim(),
      situacaoCadastral: input.situacaoCadastral || 'ativo',
      fotoUrl: input.fotoUrl || '',
      createdAt: now,
      updatedAt: now,
    });

    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: 'Criação de Colaborador',
      entidade: 'Colaborador',
      entidadeId: employee.id,
      detalhes: `Colaborador ${employee.nomeCompleto} (CPF ${employee.cpf}) cadastrado na empresa ${company.razaoSocial}. Prontuário individual criado automaticamente.`,
      dataHora: now,
    });

    return { employee };
  }

  /**
   * Stores a direct company or collaborator document in verified private storage (up to 4 MB),
   * validates magic bytes + SHA-256 + storage persistence, enforces 'pendente' for Solicitantes,
   * and preserves version history on resubmissions.
   */
  async uploadDirectDocument(
    actor: ThirdPartyActor,
    input: UploadDirectDocumentInput
  ): Promise<{
    recordId: string;
    kind: 'documento' | 'exame' | 'treinamento';
    record: DocumentSST | OccupationalExam | Training;
    storageVerified: boolean;
    storageKey: string;
    sha256: string;
    sizeBytes: number;
    fileSizeBytes: number;
    versao: number;
    situacao: DocumentStatus;
    pendingVersionQueued: boolean;
  }> {
    this.assertCanWrite(actor, 'enviar documentos');

    const kind = input.kind || 'documento';
    const nomeDocumento = (input.nomeDocumento || '').trim();
    const arquivoNome = (input.arquivoNome || '').trim();
    const hasBinaryBuffer = Boolean(input.arquivoBuffer && input.arquivoBuffer.length > 0);
    const hasBase64 = Boolean(input.arquivoBase64 && String(input.arquivoBase64).trim());

    if (!nomeDocumento) {
      throw new ThirdPartyWorkflowError('Informe o nome do documento.', 400, 'DOCUMENT_NAME_REQUIRED');
    }
    if (!arquivoNome || (!hasBinaryBuffer && !hasBase64)) {
      throw new ThirdPartyWorkflowError(
        'Arquivo ausente. Selecione um arquivo PDF, JPG ou PNG válido para envio.',
        400,
        'FILE_REQUIRED'
      );
    }

    const company = await this.assertCompanyAccess(actor, input.empresaId, 'enviar documentos');
    let employee: Employee | null = null;
    if (input.colaboradorId) {
      employee = await this.repo.getEmployeeById(input.colaboradorId);
      if (!employee || employee.empresaId !== company.id) {
        throw new ThirdPartyWorkflowError(
          'Colaborador não encontrado ou não pertence à empresa selecionada.',
          403,
          'EMPLOYEE_SCOPE_VIOLATION'
        );
      }
    }

    const { buffer, mimeType } = hasBinaryBuffer
      ? validateBinaryBufferDocument(input.arquivoBuffer!, arquivoNome, input.arquivoMimeType)
      : decodeBase64Document(input.arquivoBase64!, arquivoNome);
    const sha256 = computeBufferSha256(buffer);
    const arquivoId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const now = new Date().toISOString();

    // Critical security rule: Solicitante uploads are ALWAYS 'pendente' (never auto-approved)
    const enforcedSituacao: DocumentStatus = actor.role === 'admin' ? 'aprovado' : 'pendente';

    if (kind === 'exame') {
      if (!employee) {
        throw new ThirdPartyWorkflowError(
          'Selecione um colaborador para anexar exame ocupacional / ASO.',
          400,
          'EMPLOYEE_REQUIRED'
        );
      }
      const existing = input.recordId ? await this.repo.getExamById(input.recordId) : null;
      if (existing && existing.empresaId !== company.id) {
        throw new ThirdPartyWorkflowError(
          'Exame não pertence à empresa autorizada.',
          403,
          'DOCUMENT_SCOPE_VIOLATION'
        );
      }
      const priorHistory: DocumentVersion[] = existing
        ? Array.isArray(existing.historicoVersoes) && existing.historicoVersoes.length > 0
          ? existing.historicoVersoes
          : [
              {
                versao: existing.versao || 1,
                arquivoUrl: existing.anexoUrl || '',
                arquivoNome: existing.anexoNome || 'versao-anterior',
                dataEnvio: existing.createdAt || now,
                responsavelEnvio: existing.analisadoPor || 'Sistema',
                situacao: existing.situacao,
                analisadoPor: existing.analisadoPor,
                dataAnalise: existing.dataAnalise,
              },
            ]
        : [];
      const version = existing
        ? Math.max(existing.versao || 1, existing.versaoPendente?.versao || 0, priorHistory.length) + 1
        : 1;
      const storageKey = buildSafeStorageKey({
        empresaId: company.id,
        integrationId: 'direct_exams',
        itemId: existing?.id || `exam_${arquivoId}`,
        version,
        arquivoId,
        mimeType,
      });

      await this.fileStorage.putObject({
        storageKey,
        buffer,
        mimeType,
        sha256,
        metadata: {
          empresaId: company.id,
          colaboradorId: employee.id,
          uploadedById: actor.id,
        },
      });
      const storageVerified = await this.fileStorage.exists(storageKey);
      if (!storageVerified) {
        throw new ThirdPartyWorkflowError(
          'Não foi possível confirmar a gravação do arquivo no armazenamento seguro.',
          503,
          'STORAGE_CONFIRMATION_FAILED'
        );
      }

      const filePointer = `${DIRECT_FILE_URL_PREFIX}${storageKey}`;
      const versionEntry: DocumentVersion = {
        versao: version,
        arquivoUrl: filePointer,
        arquivoNome,
        arquivoHashSha256: sha256,
        dataEnvio: now,
        responsavelEnvio: actor.nome,
        observacoes: (input.observacoes || '').trim() || (existing ? 'Nova versão enviada' : 'Envio inicial'),
        situacao: enforcedSituacao,
      };
      const keepActiveApproved = Boolean(
        existing &&
          actor.role !== 'admin' &&
          existing.situacao === 'aprovado' &&
          isOfficialDateStillValid(existing.dataValidade, existing.semValidade)
      );

      let savedExam: OccupationalExam;
      if (existing && keepActiveApproved) {
        const pendingVersion: PendingDocumentVersion = {
          versao: version,
          arquivoUrl: filePointer,
          arquivoNome,
          dataEmissao: input.dataEmissao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          conclusao: input.conclusao || existing.conclusao || 'apto',
          observacoes: (input.observacoes || '').trim(),
          responsavelEnvio: actor.nome,
          dataEnvio: now,
          situacao: 'pendente',
        };
        await this.repo.updateExam(existing.id, {
          versaoPendente: pendingVersion,
          historicoVersoes: [...priorHistory, versionEntry],
          updatedAt: now,
        });
        savedExam = (await this.repo.getExamById(existing.id))!;
      } else if (existing) {
        await this.repo.updateExam(existing.id, {
          tipoExame: nomeDocumento,
          tipoDocumentoCanonico: input.tipoDocumentoCanonico || existing.tipoDocumentoCanonico || 'ASO',
          dataRealizacao: input.dataEmissao || existing.dataRealizacao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          conclusao: input.conclusao || existing.conclusao || 'apto',
          medicoResponsavel: input.medicoResponsavel ?? existing.medicoResponsavel,
          crmMedico: input.crmMedico ?? existing.crmMedico,
          anexoNome: arquivoNome,
          anexoUrl: filePointer,
          observacoes: input.observacoes ?? existing.observacoes,
          situacao: enforcedSituacao,
          motivoReprovacao: '',
          versao: version,
          historicoVersoes: [...priorHistory, versionEntry],
          versaoPendente: null,
          updatedAt: now,
        });
        savedExam = (await this.repo.getExamById(existing.id))!;
      } else {
        savedExam = await this.repo.createExam({
          empresaId: company.id,
          empresaNome: company.razaoSocial,
          colaboradorId: employee.id,
          colaboradorNome: employee.nomeCompleto,
          tipoExame: nomeDocumento,
          tipoDocumentoCanonico: input.tipoDocumentoCanonico || 'ASO',
          dataRealizacao: input.dataEmissao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          conclusao: input.conclusao || 'apto',
          medicoResponsavel: input.medicoResponsavel || '',
          crmMedico: input.crmMedico || '',
          anexoNome: arquivoNome,
          anexoUrl: filePointer,
          observacoes: input.observacoes || '',
          situacao: enforcedSituacao,
          versao: 1,
          historicoVersoes: [versionEntry],
          createdAt: now,
          updatedAt: now,
        });
      }

      await this.emitDirectUploadNotifications(actor, company, employee, nomeDocumento, savedExam.id, Boolean(existing));
      return {
        recordId: savedExam.id,
        kind: 'exame',
        record: savedExam,
        storageVerified,
        storageKey,
        sha256,
        sizeBytes: buffer.length,
        fileSizeBytes: buffer.length,
        versao: version,
        situacao: enforcedSituacao,
        pendingVersionQueued: keepActiveApproved,
      };
    }

    if (kind === 'treinamento') {
      if (!employee) {
        throw new ThirdPartyWorkflowError(
          'Selecione um colaborador para anexar certificado de treinamento.',
          400,
          'EMPLOYEE_REQUIRED'
        );
      }
      const existing = input.recordId ? await this.repo.getTrainingById(input.recordId) : null;
      if (existing && existing.empresaId !== company.id) {
        throw new ThirdPartyWorkflowError(
          'Treinamento não pertence à empresa autorizada.',
          403,
          'DOCUMENT_SCOPE_VIOLATION'
        );
      }
      const priorHistory: DocumentVersion[] = existing
        ? Array.isArray(existing.historicoVersoes) && existing.historicoVersoes.length > 0
          ? existing.historicoVersoes
          : [
              {
                versao: existing.versao || 1,
                arquivoUrl: existing.certificadoUrl || '',
                arquivoNome: existing.certificadoNome || 'versao-anterior',
                dataEnvio: existing.createdAt || now,
                responsavelEnvio: existing.analisadoPor || 'Sistema',
                situacao: existing.situacao,
                analisadoPor: existing.analisadoPor,
                dataAnalise: existing.dataAnalise,
              },
            ]
        : [];
      const version = existing
        ? Math.max(existing.versao || 1, existing.versaoPendente?.versao || 0, priorHistory.length) + 1
        : 1;
      const storageKey = buildSafeStorageKey({
        empresaId: company.id,
        integrationId: 'direct_trainings',
        itemId: existing?.id || `trn_${arquivoId}`,
        version,
        arquivoId,
        mimeType,
      });

      await this.fileStorage.putObject({
        storageKey,
        buffer,
        mimeType,
        sha256,
        metadata: {
          empresaId: company.id,
          colaboradorId: employee.id,
          uploadedById: actor.id,
        },
      });
      const storageVerified = await this.fileStorage.exists(storageKey);
      if (!storageVerified) {
        throw new ThirdPartyWorkflowError(
          'Não foi possível confirmar a gravação do arquivo no armazenamento seguro.',
          503,
          'STORAGE_CONFIRMATION_FAILED'
        );
      }

      const filePointer = `${DIRECT_FILE_URL_PREFIX}${storageKey}`;
      const versionEntry: DocumentVersion = {
        versao: version,
        arquivoUrl: filePointer,
        arquivoNome,
        arquivoHashSha256: sha256,
        dataEnvio: now,
        responsavelEnvio: actor.nome,
        observacoes: (input.observacoes || '').trim() || (existing ? 'Nova versão enviada' : 'Envio inicial'),
        situacao: enforcedSituacao,
      };
      const keepActiveApproved = Boolean(
        existing &&
          actor.role !== 'admin' &&
          existing.situacao === 'aprovado' &&
          isOfficialDateStillValid(existing.dataValidade, existing.semValidade)
      );

      let savedTrn: Training;
      if (existing && keepActiveApproved) {
        const pendingVersion: PendingDocumentVersion = {
          versao: version,
          arquivoUrl: filePointer,
          arquivoNome,
          dataEmissao: input.dataEmissao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          observacoes: (input.observacoes || '').trim(),
          responsavelEnvio: actor.nome,
          dataEnvio: now,
          situacao: 'pendente',
        };
        await this.repo.updateTraining(existing.id, {
          versaoPendente: pendingVersion,
          historicoVersoes: [...priorHistory, versionEntry],
          updatedAt: now,
        });
        savedTrn = (await this.repo.getTrainingById(existing.id))!;
      } else if (existing) {
        await this.repo.updateTraining(existing.id, {
          nomeTreinamento: nomeDocumento,
          tipoDocumentoCanonico: input.tipoDocumentoCanonico || existing.tipoDocumentoCanonico,
          dataRealizacao: input.dataEmissao || existing.dataRealizacao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          cargaHoraria: input.cargaHoraria ?? existing.cargaHoraria,
          instrutor: input.instrutor ?? existing.instrutor,
          certificadoNome: arquivoNome,
          certificadoUrl: filePointer,
          observacoes: input.observacoes ?? existing.observacoes,
          situacao: enforcedSituacao,
          motivoReprovacao: '',
          versao: version,
          historicoVersoes: [...priorHistory, versionEntry],
          versaoPendente: null,
          updatedAt: now,
        });
        savedTrn = (await this.repo.getTrainingById(existing.id))!;
      } else {
        savedTrn = await this.repo.createTraining({
          empresaId: company.id,
          empresaNome: company.razaoSocial,
          colaboradorId: employee.id,
          colaboradorNome: employee.nomeCompleto,
          nomeTreinamento: nomeDocumento,
          tipoDocumentoCanonico: input.tipoDocumentoCanonico || '',
          dataRealizacao: input.dataEmissao || now.slice(0, 10),
          dataValidade: input.semValidade ? '' : input.dataValidade || '',
          semValidade: Boolean(input.semValidade),
          cargaHoraria: input.cargaHoraria || '',
          instrutor: input.instrutor || '',
          certificadoNome: arquivoNome,
          certificadoUrl: filePointer,
          observacoes: input.observacoes || '',
          situacao: enforcedSituacao,
          versao: 1,
          historicoVersoes: [versionEntry],
          createdAt: now,
          updatedAt: now,
        });
      }

      await this.emitDirectUploadNotifications(actor, company, employee, nomeDocumento, savedTrn.id, Boolean(existing));
      return {
        recordId: savedTrn.id,
        kind: 'treinamento',
        record: savedTrn,
        storageVerified,
        storageKey,
        sha256,
        sizeBytes: buffer.length,
        fileSizeBytes: buffer.length,
        versao: version,
        situacao: enforcedSituacao,
        pendingVersionQueued: keepActiveApproved,
      };
    }

    // Default: DocumentSST (Empresa or Colaborador)
    const existingDoc = input.recordId ? await this.repo.getDocumentById(input.recordId) : null;
    if (existingDoc && existingDoc.empresaId !== company.id) {
      throw new ThirdPartyWorkflowError(
        'Documento não pertence à empresa autorizada.',
        403,
        'DOCUMENT_SCOPE_VIOLATION'
      );
    }

    const priorDocHistory: DocumentVersion[] = existingDoc
      ? Array.isArray(existingDoc.historicoVersoes) && existingDoc.historicoVersoes.length > 0
        ? existingDoc.historicoVersoes
        : [
            {
              versao: existingDoc.versao || 1,
              arquivoUrl: existingDoc.arquivoUrl || '',
              arquivoNome: existingDoc.arquivoNome || 'versao-anterior',
              dataEnvio: existingDoc.createdAt || now,
              responsavelEnvio: existingDoc.responsavelEnvio || 'Sistema',
              situacao: existingDoc.situacao,
              analisadoPor: existingDoc.analisadoPor,
              dataAnalise: existingDoc.dataAnalise,
            },
          ]
      : [];

    const nextVersion = existingDoc
      ? Math.max(existingDoc.versao || 1, existingDoc.versaoPendente?.versao || 0, priorDocHistory.length) + 1
      : 1;
    const storageKey = buildSafeStorageKey({
      empresaId: company.id,
      integrationId: 'direct_docs',
      itemId: existingDoc?.id || `doc_${arquivoId}`,
      version: nextVersion,
      arquivoId,
      mimeType,
    });

    await this.fileStorage.putObject({
      storageKey,
      buffer,
      mimeType,
      sha256,
      metadata: {
        empresaId: company.id,
        colaboradorId: employee?.id || '',
        uploadedById: actor.id,
      },
    });
    const storageVerified = await this.fileStorage.exists(storageKey);
    if (!storageVerified) {
      throw new ThirdPartyWorkflowError(
        'Não foi possível confirmar a gravação do arquivo no armazenamento seguro.',
        503,
        'STORAGE_CONFIRMATION_FAILED'
      );
    }

    const filePointer = `${DIRECT_FILE_URL_PREFIX}${storageKey}`;
    const versionEntry: DocumentVersion = {
      versao: nextVersion,
      arquivoUrl: filePointer,
      arquivoNome,
      arquivoHashSha256: sha256,
      dataEnvio: now,
      responsavelEnvio: actor.nome,
      observacoes: (input.observacoes || '').trim() || (existingDoc ? 'Substituição / nova versão enviada' : 'Envio inicial'),
      situacao: enforcedSituacao,
    };

    // Rule 7: A pending new version must NOT invalidate an already-approved and still-valid version
    const keepActiveApproved = Boolean(
      existingDoc &&
        actor.role !== 'admin' &&
        existingDoc.situacao === 'aprovado' &&
        isOfficialDateStillValid(existingDoc.dataValidade, existingDoc.semValidade)
    );

    let savedDoc: DocumentSST;
    if (existingDoc && keepActiveApproved) {
      const pendingVersion: PendingDocumentVersion = {
        versao: nextVersion,
        arquivoUrl: filePointer,
        arquivoNome,
        dataEmissao: input.dataEmissao || now.slice(0, 10),
        dataValidade: input.semValidade ? '' : input.dataValidade || '',
        semValidade: Boolean(input.semValidade),
        numeroDocumento: input.numeroDocumento ?? existingDoc.numeroDocumento,
        observacoes: (input.observacoes || '').trim(),
        responsavelEnvio: actor.nome,
        dataEnvio: now,
        situacao: 'pendente',
      };
      await this.repo.updateDocument(existingDoc.id, {
        versaoPendente: pendingVersion,
        historicoVersoes: [...priorDocHistory, versionEntry],
        updatedAt: now,
      });
      savedDoc = (await this.repo.getDocumentById(existingDoc.id))!;
    } else if (existingDoc) {
      await this.repo.updateDocument(existingDoc.id, {
        nomeDocumento,
        tipoDocumentoCanonico: input.tipoDocumentoCanonico || existingDoc.tipoDocumentoCanonico,
        categoria: input.categoria || existingDoc.categoria,
        numeroDocumento: input.numeroDocumento ?? existingDoc.numeroDocumento,
        dataEmissao: input.dataEmissao || existingDoc.dataEmissao,
        dataValidade: input.semValidade ? '' : input.dataValidade || '',
        semValidade: Boolean(input.semValidade),
        observacoes: input.observacoes ?? existingDoc.observacoes,
        arquivoNome,
        arquivoUrl: filePointer,
        responsavelEnvio: actor.nome,
        situacao: enforcedSituacao,
        motivoReprovacao: '',
        versao: nextVersion,
        historicoVersoes: [...priorDocHistory, versionEntry],
        versaoPendente: null,
        updatedAt: now,
      });
      savedDoc = (await this.repo.getDocumentById(existingDoc.id))!;
    } else {
      savedDoc = await this.repo.createDocument({
        empresaId: company.id,
        empresaNome: company.razaoSocial,
        colaboradorId: employee?.id || '',
        colaboradorNome: employee?.nomeCompleto || '',
        nomeDocumento,
        tipoDocumentoCanonico: input.tipoDocumentoCanonico || '',
        categoria: input.categoria || (employee ? 'Documento Individual' : 'Documento Empresarial'),
        numeroDocumento: (input.numeroDocumento || '').trim(),
        dataEmissao: input.dataEmissao || now.slice(0, 10),
        dataValidade: input.semValidade ? '' : input.dataValidade || '',
        semValidade: Boolean(input.semValidade),
        responsavelEnvio: actor.nome,
        arquivoUrl: filePointer,
        arquivoNome,
        observacoes: (input.observacoes || '').trim(),
        situacao: enforcedSituacao,
        origemEnvio: actor.role === 'admin' ? 'admin' : employee ? 'colaborador' : 'empresa',
        versao: 1,
        historicoVersoes: [versionEntry],
        createdAt: now,
        updatedAt: now,
      });
    }

    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: existingDoc ? 'Substituição de Documento' : 'Envio de Documento',
      entidade: 'Documento',
      entidadeId: savedDoc.id,
      detalhes: `Documento "${nomeDocumento}" v${nextVersion} (${arquivoNome}, SHA-256 ${sha256.slice(0, 12)}) armazenado e verificado para ${company.razaoSocial}${
        employee ? ` / ${employee.nomeCompleto}` : ''
      }. Situação: ${enforcedSituacao}${keepActiveApproved ? ' (versão anterior aprovada preservada vigente)' : ''}.`,
      dataHora: now,
    });

    await this.emitDirectUploadNotifications(actor, company, employee, nomeDocumento, savedDoc.id, Boolean(existingDoc));

    return {
      recordId: savedDoc.id,
      kind: 'documento',
      record: savedDoc,
      storageVerified,
      storageKey,
      sha256,
      sizeBytes: buffer.length,
      fileSizeBytes: buffer.length,
      versao: nextVersion,
      situacao: enforcedSituacao,
      pendingVersionQueued: keepActiveApproved,
    };
  }

  /**
   * Admin-only review of a centralized official document, exam, or training.
   * Promotes pending renewal versions when approved, preserves version history,
   * enforces mandatory rejection justification, notifies the Solicitante,
   * and automatically propagates the decision to all applicable open integrations.
   */
  async reviewDirectDocument(
    actor: ThirdPartyActor,
    kind: 'documento' | 'exame' | 'treinamento',
    recordId: string,
    input: ReviewDirectDocumentInput
  ): Promise<{
    kind: 'documento' | 'exame' | 'treinamento';
    record: DocumentSST | OccupationalExam | Training;
    propagated: { updatedIntegrations: number; updatedItems: number };
  }> {
    if (actor.role !== 'admin') {
      throw new ThirdPartyWorkflowError(
        'Apenas o Administrador EHS pode aprovar ou recusar documentos.',
        403,
        'ADMIN_ONLY'
      );
    }
    const decisao = input.decisao;
    if (decisao !== 'aprovado' && decisao !== 'reprovado') {
      throw new ThirdPartyWorkflowError('Decisão inválida. Informe aprovado ou reprovado.', 400, 'INVALID_DECISION');
    }
    const motivo = (input.motivo || '').trim();
    if (decisao === 'reprovado' && !motivo) {
      throw new ThirdPartyWorkflowError(
        'Informe obrigatoriamente a justificativa ao recusar um documento.',
        400,
        'JUSTIFICATION_REQUIRED'
      );
    }

    const now = new Date().toISOString();
    let updatedRecord: DocumentSST | OccupationalExam | Training;
    let event: OfficialDocumentReviewedEvent;
    let companyName = '';
    let employeeName = '';

    const markHistoryVersion = (
      history: DocumentVersion[] | undefined,
      targetVersion: number,
      newStatus: DocumentStatus
    ): DocumentVersion[] => {
      const list = Array.isArray(history) ? [...history] : [];
      const idx = list.findIndex((v) => v.versao === targetVersion);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          situacao: newStatus,
          analisadoPor: actor.nome,
          dataAnalise: now,
          motivoReprovacao: newStatus === 'reprovado' ? motivo : '',
        };
      }
      return list;
    };

    if (kind === 'exame') {
      const existing = await this.repo.getExamById(recordId);
      if (!existing) {
        throw new ThirdPartyWorkflowError('Exame ocupacional não encontrado.', 404, 'RECORD_NOT_FOUND');
      }
      companyName = existing.empresaNome;
      employeeName = existing.colaboradorNome;
      const pending = existing.versaoPendente;

      if (decisao === 'aprovado') {
        const targetVersion = pending?.versao || existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'aprovado');
        const finalDataEmissao = input.dataEmissao || pending?.dataEmissao || existing.dataRealizacao;
        const finalSemValidade =
          input.semValidade !== undefined
            ? Boolean(input.semValidade)
            : pending?.semValidade !== undefined
            ? Boolean(pending.semValidade)
            : Boolean(existing.semValidade);
        const finalDataValidade = finalSemValidade
          ? ''
          : input.dataValidade ?? pending?.dataValidade ?? existing.dataValidade ?? '';
        const finalConclusao = input.conclusao || pending?.conclusao || existing.conclusao || 'apto';

        await this.repo.updateExam(existing.id, {
          anexoUrl: pending?.arquivoUrl || existing.anexoUrl,
          anexoNome: pending?.arquivoNome || existing.anexoNome,
          dataRealizacao: finalDataEmissao,
          dataValidade: finalDataValidade,
          semValidade: finalSemValidade,
          conclusao: finalConclusao,
          situacao: 'aprovado',
          motivoReprovacao: '',
          analisadoPor: actor.nome,
          dataAnalise: now,
          versao: targetVersion,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getExamById(existing.id))!;
      } else if (pending && existing.situacao === 'aprovado') {
        // Reject ONLY the pending renewal while preserving the valid approved version
        const nextHistory = markHistoryVersion(existing.historicoVersoes, pending.versao, 'reprovado');
        await this.repo.updateExam(existing.id, {
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getExamById(existing.id))!;
      } else {
        const targetVersion = existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'reprovado');
        await this.repo.updateExam(existing.id, {
          situacao: 'reprovado',
          motivoReprovacao: motivo,
          analisadoPor: actor.nome,
          dataAnalise: now,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getExamById(existing.id))!;
      }

      const ex = updatedRecord as OccupationalExam;
      event = {
        actor,
        colecao: 'exams',
        registroId: ex.id,
        empresaId: ex.empresaId,
        colaboradorId: ex.colaboradorId,
        tipoDocumentoCanonico: ex.tipoDocumentoCanonico || 'ASO',
        nomeDocumento: ex.tipoExame,
        decisao,
        motivo: decisao === 'reprovado' ? motivo : undefined,
        arquivoUrl: ex.anexoUrl,
        arquivoNome: ex.anexoNome,
        dataEmissao: ex.dataRealizacao,
        dataValidade: ex.dataValidade,
        semValidade: ex.semValidade,
        conclusaoAso: ex.conclusao,
        versao: ex.versao || 1,
        analisadoEm: now,
      };
    } else if (kind === 'treinamento') {
      const existing = await this.repo.getTrainingById(recordId);
      if (!existing) {
        throw new ThirdPartyWorkflowError('Treinamento não encontrado.', 404, 'RECORD_NOT_FOUND');
      }
      companyName = existing.empresaNome;
      employeeName = existing.colaboradorNome;
      const pending = existing.versaoPendente;

      if (decisao === 'aprovado') {
        const targetVersion = pending?.versao || existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'aprovado');
        const finalDataEmissao = input.dataEmissao || pending?.dataEmissao || existing.dataRealizacao;
        const finalSemValidade =
          input.semValidade !== undefined
            ? Boolean(input.semValidade)
            : pending?.semValidade !== undefined
            ? Boolean(pending.semValidade)
            : Boolean(existing.semValidade);
        const finalDataValidade = finalSemValidade
          ? ''
          : input.dataValidade ?? pending?.dataValidade ?? existing.dataValidade ?? '';

        await this.repo.updateTraining(existing.id, {
          certificadoUrl: pending?.arquivoUrl || existing.certificadoUrl,
          certificadoNome: pending?.arquivoNome || existing.certificadoNome,
          dataRealizacao: finalDataEmissao,
          dataValidade: finalDataValidade,
          semValidade: finalSemValidade,
          situacao: 'aprovado',
          motivoReprovacao: '',
          analisadoPor: actor.nome,
          dataAnalise: now,
          versao: targetVersion,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getTrainingById(existing.id))!;
      } else if (pending && existing.situacao === 'aprovado') {
        const nextHistory = markHistoryVersion(existing.historicoVersoes, pending.versao, 'reprovado');
        await this.repo.updateTraining(existing.id, {
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getTrainingById(existing.id))!;
      } else {
        const targetVersion = existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'reprovado');
        await this.repo.updateTraining(existing.id, {
          situacao: 'reprovado',
          motivoReprovacao: motivo,
          analisadoPor: actor.nome,
          dataAnalise: now,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getTrainingById(existing.id))!;
      }

      const tr = updatedRecord as Training;
      event = {
        actor,
        colecao: 'trainings',
        registroId: tr.id,
        empresaId: tr.empresaId,
        colaboradorId: tr.colaboradorId,
        tipoDocumentoCanonico: tr.tipoDocumentoCanonico || tr.nomeTreinamento,
        nomeDocumento: tr.nomeTreinamento,
        decisao,
        motivo: decisao === 'reprovado' ? motivo : undefined,
        arquivoUrl: tr.certificadoUrl,
        arquivoNome: tr.certificadoNome,
        dataEmissao: tr.dataRealizacao,
        dataValidade: tr.dataValidade,
        semValidade: tr.semValidade,
        versao: tr.versao || 1,
        analisadoEm: now,
      };
    } else {
      const existing = await this.repo.getDocumentById(recordId);
      if (!existing) {
        throw new ThirdPartyWorkflowError('Documento não encontrado.', 404, 'RECORD_NOT_FOUND');
      }
      companyName = existing.empresaNome;
      employeeName = existing.colaboradorNome || '';
      const pending = existing.versaoPendente;

      if (decisao === 'aprovado') {
        const targetVersion = pending?.versao || existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'aprovado');
        const finalDataEmissao = input.dataEmissao || pending?.dataEmissao || existing.dataEmissao;
        const finalSemValidade =
          input.semValidade !== undefined
            ? Boolean(input.semValidade)
            : pending?.semValidade !== undefined
            ? Boolean(pending.semValidade)
            : Boolean(existing.semValidade);
        const finalDataValidade = finalSemValidade
          ? ''
          : input.dataValidade ?? pending?.dataValidade ?? existing.dataValidade ?? '';

        await this.repo.updateDocument(existing.id, {
          arquivoUrl: pending?.arquivoUrl || existing.arquivoUrl,
          arquivoNome: pending?.arquivoNome || existing.arquivoNome,
          numeroDocumento: pending?.numeroDocumento ?? existing.numeroDocumento,
          dataEmissao: finalDataEmissao,
          dataValidade: finalDataValidade,
          semValidade: finalSemValidade,
          situacao: 'aprovado',
          motivoReprovacao: '',
          analisadoPor: actor.nome,
          dataAnalise: now,
          versao: targetVersion,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getDocumentById(existing.id))!;
      } else if (pending && existing.situacao === 'aprovado') {
        const nextHistory = markHistoryVersion(existing.historicoVersoes, pending.versao, 'reprovado');
        await this.repo.updateDocument(existing.id, {
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getDocumentById(existing.id))!;
      } else {
        const targetVersion = existing.versao || 1;
        const nextHistory = markHistoryVersion(existing.historicoVersoes, targetVersion, 'reprovado');
        await this.repo.updateDocument(existing.id, {
          situacao: 'reprovado',
          motivoReprovacao: motivo,
          analisadoPor: actor.nome,
          dataAnalise: now,
          historicoVersoes: nextHistory,
          versaoPendente: null,
          updatedAt: now,
        });
        updatedRecord = (await this.repo.getDocumentById(existing.id))!;
      }

      const doc = updatedRecord as DocumentSST;
      event = {
        actor,
        colecao: 'documents',
        registroId: doc.id,
        empresaId: doc.empresaId,
        colaboradorId: doc.colaboradorId || undefined,
        tipoDocumentoCanonico: doc.tipoDocumentoCanonico || doc.nomeDocumento,
        nomeDocumento: doc.nomeDocumento,
        decisao,
        motivo: decisao === 'reprovado' ? motivo : undefined,
        arquivoUrl: doc.arquivoUrl,
        arquivoNome: doc.arquivoNome,
        dataEmissao: doc.dataEmissao,
        dataValidade: doc.dataValidade,
        semValidade: doc.semValidade,
        versao: doc.versao || 1,
        analisadoEm: now,
      };
    }

    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao: decisao === 'aprovado' ? 'Aprovação de Documento Centralizado' : 'Recusa de Documento Centralizado',
      entidade: kind === 'exame' ? 'Exame/ASO' : kind === 'treinamento' ? 'Treinamento' : 'Documento',
      entidadeId: recordId,
      detalhes: `${event.nomeDocumento} (v${event.versao}) — ${companyName}${employeeName ? ` / ${employeeName}` : ''}: ${
        decisao === 'aprovado' ? 'APROVADO' : `RECUSADO (${motivo})`
      }.`,
      dataHora: now,
    });

    if (this.notificationService) {
      await this.notificationService.createIdempotentNotification({
        recipientRole: 'solicitante',
        empresaId: event.empresaId,
        empresaNome: companyName,
        companyId: event.empresaId,
        employeeId: event.colaboradorId,
        documentId: event.registroId,
        type: decisao === 'aprovado' ? 'DOCUMENTO_APROVADO' : 'DOCUMENTO_REJEITADO',
        severity: decisao === 'aprovado' ? 'success' : 'warning',
        title:
          decisao === 'aprovado'
            ? `Documento aprovado — ${event.nomeDocumento}`
            : `Documento recusado — ${event.nomeDocumento}`,
        message:
          decisao === 'aprovado'
            ? `O documento "${event.nomeDocumento}" (v${event.versao}) foi aprovado pelo Administrador EHS e está disponível para reaproveitamento automático nas integrações.`
            : `O documento "${event.nomeDocumento}" foi recusado pelo Administrador EHS. Motivo: ${motivo}`,
        actionLabel: event.colaboradorId ? 'Abrir Colaboradores' : 'Abrir Minhas Empresas',
        actionTab: event.colaboradorId ? 'colaboradores' : 'empresas',
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `direct-review:${kind}:${recordId}:v${event.versao}:${decisao}:${now.slice(0, 16)}`,
      });
    }

    let propagated = { updatedIntegrations: 0, updatedItems: 0 };
    if (this.onOfficialDocumentReviewed) {
      const res = await this.onOfficialDocumentReviewed(event);
      if (res && typeof res.updatedIntegrations === 'number') {
        propagated = res;
      }
    }

    return {
      kind,
      record: updatedRecord,
      propagated,
    };
  }

  /**
   * Retrieves a stored direct document binary after verifying multi-tenant RBAC.
   * Admin and Auditor can read any stored file; Solicitante ONLY for authorized companies.
   */
  async retrieveDirectDocumentFile(
    actor: ThirdPartyActor,
    storageKey: string
  ): Promise<{
    buffer: Buffer;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    fileName: string;
    sizeBytes: number;
    sha256: string;
  }> {
    const cleanKey = String(storageKey || '').replace(/^ehs-direct:\/\//i, '').trim();
    if (!cleanKey.startsWith('integrations/')) {
      throw new ThirdPartyWorkflowError('Referência de arquivo inválida.', 400, 'INVALID_FILE_KEY');
    }

    // Extract tenant (empresaId) from storage key: integrations/<empresaId>/direct_...
    const segments = cleanKey.split('/');
    const keyEmpresaId = segments[1];
    if (!keyEmpresaId) {
      throw new ThirdPartyWorkflowError('Chave de arquivo malformada.', 400, 'INVALID_FILE_KEY');
    }

    if (actor.role === 'solicitante') {
      const authorized = await this.resolveAuthorizedCompanyIds(actor);
      if (!authorized.has(keyEmpresaId)) {
        throw new ThirdPartyWorkflowError(
          'Acesso negado: este arquivo pertence a outra empresa contratada.',
          403,
          'FILE_SCOPE_VIOLATION'
        );
      }
    }

    const stored = await this.fileStorage.getObject(cleanKey);
    if (!stored) {
      throw new ThirdPartyWorkflowError(
        'Arquivo não localizado no armazenamento seguro.',
        404,
        'FILE_NOT_FOUND'
      );
    }

    const lower = cleanKey.toLowerCase();
    const mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'application/pdf';

    const fileName = segments[segments.length - 1] || 'documento.pdf';
    return {
      buffer: stored.buffer,
      mimeType,
      fileName,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
    };
  }

  private async emitDirectUploadNotifications(
    actor: ThirdPartyActor,
    company: Company,
    employee: Employee | null,
    docTitle: string,
    recordId: string,
    isResubmit: boolean
  ): Promise<void> {
    if (!this.notificationService || actor.role !== 'solicitante') return;
    const scopeText = employee ? `${company.razaoSocial} · ${employee.nomeCompleto}` : company.razaoSocial;
    const nowBucket = new Date().toISOString().slice(0, 16);

    await this.notificationService.createIdempotentNotification({
      recipientRole: 'admin',
      empresaId: company.id,
      empresaNome: company.nomeFantasia || company.razaoSocial,
      companyId: company.id,
      employeeId: employee?.id,
      documentId: recordId,
      type: isResubmit ? 'DOCUMENTO_CORRIGIDO' : 'INTEGRACAO_ENVIADA',
      severity: 'info',
      title: isResubmit
        ? `Documento corrigido aguardando análise — ${docTitle}`
        : `Novo documento enviado para análise — ${docTitle}`,
      message: `${actor.nome} enviou "${docTitle}" (${scopeText}). O arquivo foi verificado no armazenamento e aguarda avaliação EHS.`,
      actionLabel: 'Analisar documento',
      actionTab: 'analise_documental',
      createdById: actor.id,
      createdByNome: actor.nome,
      createdByRole: actor.role,
      idempotencyKey: `direct-doc:admin:${recordId}:${nowBucket}`,
    });

    await this.notificationService.createIdempotentNotification({
      recipientRole: 'solicitante',
      recipientUserId: actor.id,
      empresaId: company.id,
      empresaNome: company.nomeFantasia || company.razaoSocial,
      companyId: company.id,
      employeeId: employee?.id,
      documentId: recordId,
      type: isResubmit ? 'DOCUMENTO_CORRIGIDO' : 'INTEGRACAO_ENVIADA',
      severity: 'info',
      title: `Documento recebido — ${docTitle}`,
      message: `Seu envio de "${docTitle}" foi armazenado com sucesso e encaminhado para análise do Administrador EHS.`,
      actionLabel: employee ? 'Ver Meus Colaboradores' : 'Ver Minhas Empresas',
      actionTab: employee ? 'colaboradores' : 'empresas',
      createdById: actor.id,
      createdByNome: actor.nome,
      createdByRole: actor.role,
      idempotencyKey: `direct-doc:sol:${recordId}:${nowBucket}`,
    });
  }
}
