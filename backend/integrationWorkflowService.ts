import crypto from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Firestore as ClientFirestore } from 'firebase/firestore';
import { getAdminFirestore, isAdminSdkRequired } from './firebaseAdmin';
import {
  serverAddDoc,
  serverGetDoc,
  serverListCollection,
  serverQueryEquals,
  serverSetDoc,
  serverUpdateDoc,
} from './firestoreServer';
import {
  CreateInAppNotificationInput,
  InAppNotificationService,
} from './inAppNotificationService';
import {
  getGeminiIntegrationStatus,
  normalizeIsoDate,
  removeUndefinedDeep,
  runGeminiDocumentExtraction,
  validateUploadedFile,
} from './smartDocsService';
import {
  evaluateActivityCompliance,
  normalizeCanonicalCode,
  normalizeMatchText,
} from '../src/utils/activityComplianceEngine';
import { classifyIntegrationDocumentGroup } from '../src/utils/integrationDocumentCatalog';
import {
  buildSafeStorageKey,
  computeBufferSha256,
  createDefaultIntegrationFileStorage,
  InMemoryIntegrationFileStorage,
  IntegrationFileIntegrityError,
  IntegrationFileStorage,
  IntegrationStorageUnavailableError,
  isEphemeralServerlessRuntime,
  validateBinaryMagicBytes,
} from './integrationFileStorage';
import {
  MAX_UPLOAD_FILE_BYTES,
  detectRealMimeFromBuffer,
  normalizeDeclaredMime,
} from './multipartUpload';
import type { OfficialDocumentReviewedEvent } from './thirdPartyManagementService';
import type {
  ActivityComplianceResult,
  ActivityDocumentRequirement,
  ActivityProfile,
  AuditLog,
  Company,
  ConclusaoAptidao,
  ContractorIntegration,
  ContractorIntegrationItem,
  ContractorIntegrationSummaryCounts,
  DocumentReuseResolutionState,
  DocumentSST,
  DocumentVersion,
  Employee,
  EPIDelivery,
  IntegrationCompanyRequest,
  IntegrationDocumentGroupId,
  IntegrationDocumentReuseSource,
  IntegrationDocumentVersion,
  IntegrationEmployeeCandidate,
  IntegrationItemCategory,
  IntegrationItemStatus,
  IntegrationOfficialCollection,
  IntegrationPendingDocumentInfo,
  IntegrationCollaboratorReadiness,
  IntegrationReusePreviewItem,
  IntegrationReusePreviewResult,
  IntegrationSmartDocsSuggestion,
  IntegrationSubmissionReadiness,
  IntegrationType,
  IntegrationWorkflowHistoryEntry,
  IntegrationWorkflowStatus,
  MirroredIntegrationDocumentItem,
  OccupationalExam,
  SafetyPermit,
  SimpleActivityDocumentInput,
  SimpleActivityEntry,
  SimpleActivityHistoryEntry,
  SimpleActivityStatus,
  SmartDocRecord,
  Training,
  UserRole,
} from '../src/types/sst';

export interface IntegrationWorkflowActor {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  empresaId?: string;
  empresaIds?: string[];
}

export class IntegrationWorkflowError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'IntegrationWorkflowError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface SmartDocsSuggestionRunnerInput {
  arquivoNome: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  base64Data: string;
  expectedCode?: string;
  expectedLabel?: string;
}

export type SmartDocsSuggestionRunner = (
  input: SmartDocsSuggestionRunnerInput
) => Promise<IntegrationSmartDocsSuggestion | null>;

export interface IntegrationWorkflowRepository {
  getIntegrationById(id: string): Promise<ContractorIntegration | null>;
  listIntegrations(): Promise<ContractorIntegration[]>;
  createIntegration(data: Omit<ContractorIntegration, 'id'>): Promise<ContractorIntegration>;
  updateIntegration(id: string, updates: Partial<ContractorIntegration>): Promise<ContractorIntegration>;

  getItemById(id: string): Promise<ContractorIntegrationItem | null>;
  listAllItems(): Promise<ContractorIntegrationItem[]>;
  listItemsByIntegration(integrationId: string): Promise<ContractorIntegrationItem[]>;
  createItem(data: Omit<ContractorIntegrationItem, 'id'>): Promise<ContractorIntegrationItem>;
  updateItem(id: string, updates: Partial<ContractorIntegrationItem>): Promise<ContractorIntegrationItem>;

  listCompanies(): Promise<Company[]>;
  getCompanyById(id: string): Promise<Company | null>;
  createCompany(data: Omit<Company, 'id'>): Promise<Company>;
  updateCompany(id: string, updates: Partial<Company>): Promise<Company>;

  listEmployees(): Promise<Employee[]>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(data: Omit<Employee, 'id'>): Promise<Employee>;
  updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee>;

  listActivityProfiles(): Promise<ActivityProfile[]>;
  listActivityDocumentRequirements(): Promise<ActivityDocumentRequirement[]>;

  listDocuments(): Promise<DocumentSST[]>;
  createDocument(data: Omit<DocumentSST, 'id'>): Promise<DocumentSST>;
  updateDocument(id: string, updates: Partial<DocumentSST>): Promise<DocumentSST>;

  listTrainings(): Promise<Training[]>;
  createTraining(data: Omit<Training, 'id'>): Promise<Training>;
  updateTraining?(id: string, updates: Partial<Training>): Promise<Training>;

  listExams(): Promise<OccupationalExam[]>;
  createExam(data: Omit<OccupationalExam, 'id'>): Promise<OccupationalExam>;
  updateExam?(id: string, updates: Partial<OccupationalExam>): Promise<OccupationalExam>;

  listEpiDeliveries(): Promise<EPIDelivery[]>;
  createEpiDelivery(data: Omit<EPIDelivery, 'id'>): Promise<EPIDelivery>;

  listSafetyPermits(): Promise<SafetyPermit[]>;
  listSmartDocs(): Promise<SmartDocRecord[]>;

  addAuditLog(entry: Omit<AuditLog, 'id'>): Promise<void>;
}

export interface CreateIntegrationCustomItemInput {
  categoria: IntegrationItemCategory;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  documentoCodigoCanonico: string;
  nomeExibicao: string;
  origemColecao?: IntegrationOfficialCollection;
  obrigatorio?: boolean;
  exigeAptoASO?: boolean;
  aptidaoEspecifica?: string;
  baseLegal?: string;
  officialRecordId?: string;
}

export interface CreateIntegrationEmployeeInput {
  colaboradorId?: string;
  nomeCompleto?: string;
  cpf?: string;
  cargo?: string;
  setor?: string;
  telefone?: string;
  email?: string;
  atividadeExecutada?: string;
  atividadesHabilitadasIds?: string[];
}

export interface CreateSimpleActivityInput {
  nome: string;
  descricaoServico: string;
  observacoes?: string;
  documentos?: SimpleActivityDocumentInput[];
}

export interface UpdateSimpleActivityInput {
  nome?: string;
  descricaoServico?: string;
  observacoes?: string;
  expectedVersion?: number;
}

export interface ReviewSimpleActivityInput {
  decisao: 'APROVAR' | 'RECUSAR' | 'SOLICITAR_COMPLEMENTACAO';
  justificativa?: string;
  expectedVersion?: number;
}

export interface CreateIntegrationInput {
  tipo?: IntegrationType;
  empresaId?: string;
  solicitacaoNovaEmpresa?: Omit<IntegrationCompanyRequest, 'aprovadoCompanyId'>;
  atividadeIds?: string[];
  atividadesSimples?: CreateSimpleActivityInput[];
  colaboradorIds?: string[];
  novosColaboradores?: CreateIntegrationEmployeeInput[];
  customItems?: CreateIntegrationCustomItemInput[];
  observacoes?: string;
  isDemo?: boolean;
}

export interface UpdateIntegrationDraftInput {
  atividadeIds?: string[];
  colaboradorIds?: string[];
  novosColaboradores?: CreateIntegrationEmployeeInput[];
  observacoes?: string;
  expectedVersion?: number;
}

export interface BatchDocumentFileInput {
  itemId?: string;
  categoria?: IntegrationItemCategory;
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  documentoCodigoCanonico?: string;
  nomeExibicao?: string;
  origemColecao?: IntegrationOfficialCollection;
  obrigatorio?: boolean;
  arquivoNome: string;
  arquivoBase64?: string;
  arquivoBuffer?: Buffer;
  arquivoMimeType?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusaoAso?: ConclusaoAptidao;
  aptidoesEspecificas?: string[];
  observacoes?: string;
  runSmartDocsAi?: boolean;
}

export interface UploadBatchDocumentsInput {
  files: BatchDocumentFileInput[];
  autoSubmit?: boolean;
  expectedVersion?: number;
}

export interface UploadSingleDocumentResult extends IntegrationDetailResult {
  item: ContractorIntegrationItem;
  uploadedFile: {
    arquivoId: string;
    arquivoNome: string;
    arquivoMimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
    arquivoTamanhoBytes: number;
    arquivoHashSha256: string;
    versao: number;
  };
}

export interface RetrievedIntegrationDocumentFile {
  buffer: Buffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileName: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  arquivoId?: string;
}

export interface ReviewItemInput {
  decisao: 'APROVADO' | 'REPROVADO';
  motivo?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusaoAso?: ConclusaoAptidao;
  aptidoesEspecificas?: string[];
  observacoes?: string;
  expectedVersion?: number;
}

export interface UpdateItemValidityInput {
  dataValidade?: string;
  semValidade?: boolean;
  observacoes?: string;
  expectedVersion?: number;
}

export interface IntegrationActionInput {
  justificativa?: string;
  expectedVersion?: number;
  approveWholePackage?: boolean;
  rejectedItemIds?: string[];
  itemReasons?: Record<string, string>;
}

export interface DuplicateCheckInput {
  cnpj?: string;
  cpf?: string;
}

export interface DuplicateCheckResult {
  cnpjDuplicado: boolean;
  empresaExistente?: {
    id: string;
    razaoSocial: string;
    nomeFantasia: string;
    cnpj: string;
    situacao: 'ativa' | 'inativa';
  };
  cpfDuplicado: boolean;
  colaboradorExistente?: {
    id: string;
    nomeCompleto: string;
    cpf: string;
    cargo: string;
    empresaId: string;
    empresaNome: string;
    mesmaEmpresa: boolean;
    situacaoCadastral: Employee['situacaoCadastral'];
  };
}

export interface IntegrationDetailResult {
  integration: ContractorIntegration;
  items: ContractorIntegrationItem[];
  compliancePreview: ActivityComplianceResult | null;
  submissionReadiness: IntegrationSubmissionReadiness;
}

const UNSUBMITTED_INTEGRATION_STATUSES: ReadonlySet<IntegrationWorkflowStatus> = new Set([
  'RASCUNHO',
  'PENDENTE_DOCUMENTACAO',
  'EM_ENVIO',
]);

const EDITABLE_UPLOAD_STATUSES: IntegrationWorkflowStatus[] = [
  'RASCUNHO',
  'PENDENTE_DOCUMENTACAO',
  'EM_ENVIO',
  'PENDENTE_CORRECAO',
  'REPROVADA',
];

function digitsOnly(value?: string | null): string {
  return String(value || '').replace(/\D+/g, '');
}

function generateProtocolCode(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INT-${yyyy}${mm}${dd}-${rand}`;
}

function isIsoDateExpired(dateStr?: string | null, referenceIso?: string): boolean {
  if (!dateStr) return false;
  const normalized = normalizeIsoDate(dateStr);
  if (!normalized) return false;
  const ref = (referenceIso || new Date().toISOString()).slice(0, 10);
  return normalized < ref;
}

function computeSummaryCounts(items: ContractorIntegrationItem[]): ContractorIntegrationSummaryCounts {
  const summary: ContractorIntegrationSummaryCounts = {
    total: items.length,
    obrigatorios: 0,
    pendentesEnvio: 0,
    enviados: 0,
    emAnalise: 0,
    aprovados: 0,
    reprovados: 0,
    substituidos: 0,
  };
  for (const item of items) {
    if (item.obrigatorio) summary.obrigatorios += 1;
    switch (item.status) {
      case 'PENDENTE_ENVIO':
        summary.pendentesEnvio += 1;
        break;
      case 'ENVIADO':
        summary.enviados += 1;
        break;
      case 'EM_ANALISE':
        summary.emAnalise += 1;
        break;
      case 'APROVADO':
        summary.aprovados += 1;
        break;
      case 'REPROVADO':
        summary.reprovados += 1;
        break;
      case 'SUBSTITUIDO':
        summary.substituidos += 1;
        break;
    }
  }
  return summary;
}

function mapRequirementScopeToCategory(
  escopo: ActivityDocumentRequirement['escopo']
): IntegrationItemCategory {
  if (escopo === 'empresa') return 'empresa';
  if (escopo === 'colaborador') return 'colaborador';
  return 'atividade_critica';
}

function matchesEmployeeRole(cargo: string, funcoesAplicaveis: string[]): boolean {
  if (!funcoesAplicaveis || funcoesAplicaveis.length === 0) return true;
  const cargoNorm = normalizeMatchText(cargo);
  if (!cargoNorm) return false;
  return funcoesAplicaveis.some((fn) => {
    const fnNorm = normalizeMatchText(fn);
    if (!fnNorm) return false;
    return cargoNorm.includes(fnNorm) || fnNorm.includes(cargoNorm);
  });
}

function stripLargeFileUrlFromItem(item: ContractorIntegrationItem): ContractorIntegrationItem {
  // Never return inline Base64 data URLs or internal storageKey paths in list/detail queries
  const sanitizedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) => {
    const hasFile = Boolean(
      v.hasStoredFile ||
        v.storageKey ||
        (typeof v.arquivoUrl === 'string' && v.arquivoUrl.startsWith('data:'))
    );
    const { storageKey: _hiddenKey, ...restVersion } = v;
    return {
      ...restVersion,
      hasStoredFile: hasFile,
      arquivoUrl:
        typeof v.arquivoUrl === 'string' && v.arquivoUrl.startsWith('data:') ? '' : v.arquivoUrl || '',
    };
  });

  const itemHasFile = Boolean(
    item.hasStoredFile ||
      item.storageKey ||
      sanitizedVersions.some((v) => v.hasStoredFile) ||
      (typeof item.arquivoUrl === 'string' && item.arquivoUrl.startsWith('data:'))
  );

  const { storageKey: _hiddenItemKey, ...restItem } = item;

  return {
    ...restItem,
    categoriaOrganizacional:
      item.categoriaOrganizacional ||
      (item.categoria === 'colaborador' ? classifyIntegrationDocumentGroup(item) : undefined),
    hasStoredFile: itemHasFile,
    arquivoUrl:
      typeof item.arquivoUrl === 'string' && item.arquivoUrl.startsWith('data:')
        ? ''
        : item.arquivoUrl || '',
    versoes: sanitizedVersions,
  };
}

function inferMimeTypeFromFile(fileName: string, dataUrl: string): string {
  const match = (dataUrl || '').trim().match(/^data:([^;,]+)/i);
  if (match && match[1]) return match[1].toLowerCase();
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function defaultSmartDocsSuggestionRunner(): SmartDocsSuggestionRunner {
  return async (input) => {
    const status = getGeminiIntegrationStatus();
    if (!status.configured) {
      return {
        processadoEm: new Date().toISOString(),
        alertas: ['Sugestão automática SmartDocs não executada (chave Gemini indisponível). Revisão manual ativa.'],
      };
    }

    try {
      const result = await runGeminiDocumentExtraction({
        mimeType: input.mimeType,
        base64Data: input.base64Data,
        fileName: input.arquivoNome,
      });

      const alertas: string[] = [];
      if (result.dadosExtraidos.documentoIlegivel || result.dadosExtraidos.qualidadeLeitura === 'ilegivel') {
        alertas.push('SmartDocs sinalizou possível documento ilegível — conferir manualmente.');
      }
      if (result.dadosExtraidos.documentoIncompleto) {
        alertas.push('SmartDocs sinalizou documento possivelmente incompleto.');
      }
      if (Array.isArray(result.dadosExtraidos.observacoesIA)) {
        alertas.push(...result.dadosExtraidos.observacoesIA.slice(0, 3));
      }

      return removeUndefinedDeep({
        processadoEm: new Date().toISOString(),
        tipoDocumentoSugerido: result.tipoDocumento,
        categoriaGrupoSugerida: result.categoriaGrupo,
        nomeDocumentoSugerido: result.dadosExtraidos.nomeDocumento || result.dadosExtraidos.nomeTreinamento || result.tipoDocumento,
        nomeColaboradorSugerido: result.dadosExtraidos.nomeColaborador,
        cpfSugerido: result.dadosExtraidos.cpf,
        empresaSugerida: result.dadosExtraidos.empresa || result.dadosExtraidos.razaoSocial,
        cnpjSugerido: result.dadosExtraidos.cnpj,
        dataEmissaoSugerida: result.dadosExtraidos.dataEmissao || result.dadosExtraidos.dataRealizacao,
        dataValidadeSugerida: result.dadosExtraidos.dataValidade,
        semValidadeSugerida: result.dadosExtraidos.semValidade,
        resultadoAptidaoSugerido: result.dadosExtraidos.resultadoAptidao,
        confianca: result.classificacaoConfianca,
        qualidadeLeitura: result.dadosExtraidos.qualidadeLeitura,
        documentoIlegivel: result.dadosExtraidos.documentoIlegivel,
        documentoIncompleto: result.dadosExtraidos.documentoIncompleto,
        alertas,
        modeloUtilizado: result.modelUsed,
      });
    } catch (err: any) {
      return {
        processadoEm: new Date().toISOString(),
        erroLeitura: err?.message || 'Falha temporária na sugestão SmartDocs IA.',
        alertas: ['Não foi possível extrair sugestões automáticas; prossiga com preenchimento/conferência manual.'],
      };
    }
  };
}

// ============================================================================
// FIRESTORE REPOSITORY (WITH PRIVATE LOCAL DEV STORE FOR LOCKED COLLECTIONS)
// ============================================================================

interface LocalPrivateIntegrationDbState {
  integrations: ContractorIntegration[];
  items: ContractorIntegrationItem[];
}

function shouldUseLocalPrivateIntegrationStore(): boolean {
  return !getAdminFirestore() && !isAdminSdkRequired() && !isEphemeralServerlessRuntime();
}

function getLocalPrivateIntegrationStorePath(): string {
  const baseDir = path.resolve(
    process.env.INTEGRATION_PRIVATE_STORAGE_DIR || path.join(process.cwd(), '.private-storage')
  );
  return path.join(baseDir, 'integrations-store.json');
}

let localStoreMutex: Promise<void> = Promise.resolve();

async function withLocalStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = localStoreMutex;
  let release!: () => void;
  localStoreMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function readLocalPrivateIntegrationStore(): Promise<LocalPrivateIntegrationDbState> {
  const filePath = getLocalPrivateIntegrationStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalPrivateIntegrationDbState>;
    return {
      integrations: Array.isArray(parsed.integrations) ? parsed.integrations : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { integrations: [], items: [] };
    }
    throw err;
  }
}

async function writeLocalPrivateIntegrationStore(state: LocalPrivateIntegrationDbState): Promise<void> {
  const filePath = getLocalPrivateIntegrationStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export function createFirestoreIntegrationRepository(
  firestoreDb?: ClientFirestore
): IntegrationWorkflowRepository {
  return {
    async getIntegrationById(id) {
      if (shouldUseLocalPrivateIntegrationStore()) {
        const state = await readLocalPrivateIntegrationStore();
        const found = state.integrations.find((x) => x.id === id);
        return found ? structuredClone(found) : null;
      }
      const snap = await serverGetDoc<Omit<ContractorIntegration, 'id'>>(
        'contractorIntegrations',
        id,
        firestoreDb
      );
      if (!snap) return null;
      return { id: snap.id, ...snap.data };
    },
    async listIntegrations() {
      if (shouldUseLocalPrivateIntegrationStore()) {
        const state = await readLocalPrivateIntegrationStore();
        return state.integrations
          .map((d) => structuredClone(d))
          .sort((a, b) => (b.dataUltimaAtualizacao || '').localeCompare(a.dataUltimaAtualizacao || ''));
      }
      const docs = await serverListCollection<Omit<ContractorIntegration, 'id'>>(
        'contractorIntegrations',
        firestoreDb
      );
      return docs
        .map((d) => ({ id: d.id, ...d.data }))
        .sort((a, b) => (b.dataUltimaAtualizacao || '').localeCompare(a.dataUltimaAtualizacao || ''));
    },
    async createIntegration(data) {
      const clean = removeUndefinedDeep(data) as Omit<ContractorIntegration, 'id'>;
      if (shouldUseLocalPrivateIntegrationStore()) {
        return withLocalStoreLock(async () => {
          const state = await readLocalPrivateIntegrationStore();
          const created: ContractorIntegration = structuredClone({
            id: `int-${crypto.randomUUID()}`,
            ...clean,
          });
          state.integrations.push(created);
          await writeLocalPrivateIntegrationStore(state);
          return structuredClone(created);
        });
      }
      const id = await serverAddDoc('contractorIntegrations', clean, firestoreDb);
      return { id, ...clean };
    },
    async updateIntegration(id, updates) {
      const clean = removeUndefinedDeep(updates) as Partial<ContractorIntegration>;
      if (shouldUseLocalPrivateIntegrationStore()) {
        return withLocalStoreLock(async () => {
          const state = await readLocalPrivateIntegrationStore();
          const idx = state.integrations.findIndex((x) => x.id === id);
          if (idx < 0) {
            throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'NOT_FOUND');
          }
          state.integrations[idx] = structuredClone({ ...state.integrations[idx], ...clean, id });
          await writeLocalPrivateIntegrationStore(state);
          return structuredClone(state.integrations[idx]);
        });
      }
      await serverUpdateDoc('contractorIntegrations', id, clean, firestoreDb);
      const snap = await serverGetDoc<Omit<ContractorIntegration, 'id'>>(
        'contractorIntegrations',
        id,
        firestoreDb
      );
      return { id: snap?.id || id, ...(snap?.data as Omit<ContractorIntegration, 'id'>) };
    },

    async getItemById(id) {
      if (shouldUseLocalPrivateIntegrationStore()) {
        const state = await readLocalPrivateIntegrationStore();
        const found = state.items.find((x) => x.id === id);
        return found ? structuredClone(found) : null;
      }
      const snap = await serverGetDoc<Omit<ContractorIntegrationItem, 'id'>>(
        'contractorIntegrationItems',
        id,
        firestoreDb
      );
      if (!snap) return null;
      return { id: snap.id, ...snap.data };
    },
    async listAllItems() {
      if (shouldUseLocalPrivateIntegrationStore()) {
        const state = await readLocalPrivateIntegrationStore();
        return state.items
          .map((d) => structuredClone(d))
          .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
      }
      const docs = await serverListCollection<Omit<ContractorIntegrationItem, 'id'>>(
        'contractorIntegrationItems',
        firestoreDb
      );
      return docs
        .map((d) => ({ id: d.id, ...d.data }))
        .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    },
    async listItemsByIntegration(integrationId) {
      if (shouldUseLocalPrivateIntegrationStore()) {
        const state = await readLocalPrivateIntegrationStore();
        return state.items
          .filter((x) => x.integrationId === integrationId)
          .map((d) => structuredClone(d))
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      }
      const docs = await serverQueryEquals<Omit<ContractorIntegrationItem, 'id'>>(
        'contractorIntegrationItems',
        'integrationId',
        integrationId,
        firestoreDb
      );
      return docs
        .map((d) => ({ id: d.id, ...d.data }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    },
    async createItem(data) {
      const clean = removeUndefinedDeep(data) as Omit<ContractorIntegrationItem, 'id'>;
      if (shouldUseLocalPrivateIntegrationStore()) {
        return withLocalStoreLock(async () => {
          const state = await readLocalPrivateIntegrationStore();
          const created: ContractorIntegrationItem = structuredClone({
            id: `item-${crypto.randomUUID()}`,
            ...clean,
          });
          state.items.push(created);
          await writeLocalPrivateIntegrationStore(state);
          return structuredClone(created);
        });
      }
      const id = await serverAddDoc('contractorIntegrationItems', clean, firestoreDb);
      return { id, ...clean };
    },
    async updateItem(id, updates) {
      const clean = removeUndefinedDeep(updates) as Partial<ContractorIntegrationItem>;
      if (shouldUseLocalPrivateIntegrationStore()) {
        return withLocalStoreLock(async () => {
          const state = await readLocalPrivateIntegrationStore();
          const idx = state.items.findIndex((x) => x.id === id);
          if (idx < 0) {
            throw new IntegrationWorkflowError('Item documental não encontrado.', 404, 'ITEM_NOT_FOUND');
          }
          state.items[idx] = structuredClone({ ...state.items[idx], ...clean, id });
          await writeLocalPrivateIntegrationStore(state);
          return structuredClone(state.items[idx]);
        });
      }
      await serverUpdateDoc('contractorIntegrationItems', id, clean, firestoreDb);
      const snap = await serverGetDoc<Omit<ContractorIntegrationItem, 'id'>>(
        'contractorIntegrationItems',
        id,
        firestoreDb
      );
      return { id: snap?.id || id, ...(snap?.data as Omit<ContractorIntegrationItem, 'id'>) };
    },

    async listCompanies() {
      const docs = await serverListCollection<Omit<Company, 'id'>>('companies', firestoreDb);
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getCompanyById(id) {
      const snap = await serverGetDoc<Omit<Company, 'id'>>('companies', id, firestoreDb);
      if (!snap) return null;
      return { id: snap.id, ...snap.data };
    },
    async createCompany(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('companies', clean, firestoreDb);
      return { id, ...(clean as Omit<Company, 'id'>) };
    },
    async updateCompany(id, updates) {
      const clean = removeUndefinedDeep(updates);
      await serverSetDoc('companies', id, clean, { merge: true }, firestoreDb);
      const snap = await serverGetDoc<Omit<Company, 'id'>>('companies', id, firestoreDb);
      return { id: snap?.id || id, ...(snap?.data as Omit<Company, 'id'>) };
    },

    async listEmployees() {
      const docs = await serverListCollection<Omit<Employee, 'id'>>('employees', firestoreDb);
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async getEmployeeById(id) {
      const snap = await serverGetDoc<Omit<Employee, 'id'>>('employees', id, firestoreDb);
      if (!snap) return null;
      return { id: snap.id, ...snap.data };
    },
    async createEmployee(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('employees', clean, firestoreDb);
      return { id, ...(clean as Omit<Employee, 'id'>) };
    },
    async updateEmployee(id, updates) {
      const clean = removeUndefinedDeep(updates);
      await serverSetDoc('employees', id, clean, { merge: true }, firestoreDb);
      const snap = await serverGetDoc<Omit<Employee, 'id'>>('employees', id, firestoreDb);
      return { id: snap?.id || id, ...(snap?.data as Omit<Employee, 'id'>) };
    },

    async listActivityProfiles() {
      const docs = await serverListCollection<Omit<ActivityProfile, 'id'>>(
        'activityProfiles',
        firestoreDb
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listActivityDocumentRequirements() {
      const docs = await serverListCollection<Omit<ActivityDocumentRequirement, 'id'>>(
        'activityDocumentRequirements',
        firestoreDb
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },

    async listDocuments() {
      const docs = await serverListCollection<Omit<DocumentSST, 'id'>>('documents', firestoreDb);
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async createDocument(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('documents', clean, firestoreDb);
      return { id, ...(clean as Omit<DocumentSST, 'id'>) };
    },
    async updateDocument(id, updates) {
      const clean = removeUndefinedDeep(updates);
      await serverSetDoc('documents', id, clean, { merge: true }, firestoreDb);
      const snap = await serverGetDoc<Omit<DocumentSST, 'id'>>('documents', id, firestoreDb);
      return { id: snap?.id || id, ...(snap?.data as Omit<DocumentSST, 'id'>) };
    },

    async listTrainings() {
      const docs = await serverListCollection<Omit<Training, 'id'>>('trainings', firestoreDb);
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async createTraining(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('trainings', clean, firestoreDb);
      return { id, ...(clean as Omit<Training, 'id'>) };
    },
    async updateTraining(id, updates) {
      const clean = removeUndefinedDeep(updates);
      await serverSetDoc('trainings', id, clean, { merge: true }, firestoreDb);
      const snap = await serverGetDoc<Omit<Training, 'id'>>('trainings', id, firestoreDb);
      return { id: snap?.id || id, ...(snap?.data as Omit<Training, 'id'>) };
    },

    async listExams() {
      const docs = await serverListCollection<Omit<OccupationalExam, 'id'>>('exams', firestoreDb);
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async createExam(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('exams', clean, firestoreDb);
      return { id, ...(clean as Omit<OccupationalExam, 'id'>) };
    },
    async updateExam(id, updates) {
      const clean = removeUndefinedDeep(updates);
      await serverSetDoc('exams', id, clean, { merge: true }, firestoreDb);
      const snap = await serverGetDoc<Omit<OccupationalExam, 'id'>>('exams', id, firestoreDb);
      return { id: snap?.id || id, ...(snap?.data as Omit<OccupationalExam, 'id'>) };
    },

    async listEpiDeliveries() {
      const docs = await serverListCollection<Omit<EPIDelivery, 'id'>>(
        'epiDeliveries',
        firestoreDb
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async createEpiDelivery(data) {
      const clean = removeUndefinedDeep(data);
      const id = await serverAddDoc('epiDeliveries', clean, firestoreDb);
      return { id, ...(clean as Omit<EPIDelivery, 'id'>) };
    },

    async listSafetyPermits() {
      const docs = await serverListCollection<Omit<SafetyPermit, 'id'>>(
        'safetyPermits',
        firestoreDb
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },
    async listSmartDocs() {
      const docs = await serverListCollection<Omit<SmartDocRecord, 'id'>>(
        'smartDocs',
        firestoreDb
      );
      return docs.map((d) => ({ id: d.id, ...d.data }));
    },

    async addAuditLog(entry) {
      await serverAddDoc('auditLogs', removeUndefinedDeep(entry), firestoreDb);
    },
  };
}

// ============================================================================
// IN-MEMORY REPOSITORY (FOR DETERMINISTIC AUTOMATED TESTS)
// ============================================================================

export interface InMemoryIntegrationRepoState {
  integrations: ContractorIntegration[];
  items: ContractorIntegrationItem[];
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
  auditLogs: AuditLog[];
}

export function createInMemoryIntegrationRepository(
  initial: Partial<InMemoryIntegrationRepoState> = {}
): IntegrationWorkflowRepository & { state: InMemoryIntegrationRepoState } {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const state: InMemoryIntegrationRepoState = {
    integrations: [...(initial.integrations || [])],
    items: [...(initial.items || [])],
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
    auditLogs: [...(initial.auditLogs || [])],
  };

  return {
    state,
    async getIntegrationById(id) {
      const found = state.integrations.find((x) => x.id === id);
      return found ? structuredClone(found) : null;
    },
    async listIntegrations() {
      return state.integrations
        .map((x) => structuredClone(x))
        .sort((a, b) => (b.dataUltimaAtualizacao || '').localeCompare(a.dataUltimaAtualizacao || ''));
    },
    async createIntegration(data) {
      const created: ContractorIntegration = structuredClone({
        id: nextId('int'),
        ...data,
      });
      state.integrations.push(created);
      return structuredClone(created);
    },
    async updateIntegration(id, updates) {
      const idx = state.integrations.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'NOT_FOUND');
      state.integrations[idx] = structuredClone({ ...state.integrations[idx], ...updates });
      return structuredClone(state.integrations[idx]);
    },

    async getItemById(id) {
      const found = state.items.find((x) => x.id === id);
      return found ? structuredClone(found) : null;
    },
    async listAllItems() {
      return state.items
        .map((x) => structuredClone(x))
        .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    },
    async listItemsByIntegration(integrationId) {
      return state.items
        .filter((x) => x.integrationId === integrationId)
        .map((x) => structuredClone(x));
    },
    async createItem(data) {
      const created: ContractorIntegrationItem = structuredClone({
        id: nextId('item'),
        ...data,
      });
      state.items.push(created);
      return structuredClone(created);
    },
    async updateItem(id, updates) {
      const idx = state.items.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Item documental não encontrado.', 404, 'ITEM_NOT_FOUND');
      state.items[idx] = structuredClone({ ...state.items[idx], ...updates });
      return structuredClone(state.items[idx]);
    },

    async listCompanies() {
      return state.companies.map((x) => structuredClone(x));
    },
    async getCompanyById(id) {
      const found = state.companies.find((x) => x.id === id);
      return found ? structuredClone(found) : null;
    },
    async createCompany(data) {
      const created: Company = structuredClone({ id: nextId('comp'), ...data });
      state.companies.push(created);
      return structuredClone(created);
    },
    async updateCompany(id, updates) {
      const idx = state.companies.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Empresa não encontrada.', 404, 'COMPANY_NOT_FOUND');
      state.companies[idx] = structuredClone({ ...state.companies[idx], ...updates });
      return structuredClone(state.companies[idx]);
    },

    async listEmployees() {
      return state.employees.map((x) => structuredClone(x));
    },
    async getEmployeeById(id) {
      const found = state.employees.find((x) => x.id === id);
      return found ? structuredClone(found) : null;
    },
    async createEmployee(data) {
      const created: Employee = structuredClone({ id: nextId('emp'), ...data });
      state.employees.push(created);
      return structuredClone(created);
    },
    async updateEmployee(id, updates) {
      const idx = state.employees.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Colaborador não encontrado.', 404, 'EMPLOYEE_NOT_FOUND');
      state.employees[idx] = structuredClone({ ...state.employees[idx], ...updates });
      return structuredClone(state.employees[idx]);
    },

    async listActivityProfiles() {
      return state.activityProfiles.map((x) => structuredClone(x));
    },
    async listActivityDocumentRequirements() {
      return state.activityDocumentRequirements.map((x) => structuredClone(x));
    },

    async listDocuments() {
      return state.documents.map((x) => structuredClone(x));
    },
    async createDocument(data) {
      const created: DocumentSST = structuredClone({ id: nextId('doc'), ...data });
      state.documents.push(created);
      return structuredClone(created);
    },
    async updateDocument(id, updates) {
      const idx = state.documents.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Documento oficial não encontrado.', 404, 'DOC_NOT_FOUND');
      state.documents[idx] = structuredClone({ ...state.documents[idx], ...updates });
      return structuredClone(state.documents[idx]);
    },

    async listTrainings() {
      return state.trainings.map((x) => structuredClone(x));
    },
    async createTraining(data) {
      const created: Training = structuredClone({ id: nextId('trn'), ...data });
      state.trainings.push(created);
      return structuredClone(created);
    },
    async updateTraining(id, updates) {
      const idx = state.trainings.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Treinamento oficial não encontrado.', 404, 'TRAINING_NOT_FOUND');
      state.trainings[idx] = structuredClone({ ...state.trainings[idx], ...updates });
      return structuredClone(state.trainings[idx]);
    },

    async listExams() {
      return state.exams.map((x) => structuredClone(x));
    },
    async createExam(data) {
      const created: OccupationalExam = structuredClone({ id: nextId('exam'), ...data });
      state.exams.push(created);
      return structuredClone(created);
    },
    async updateExam(id, updates) {
      const idx = state.exams.findIndex((x) => x.id === id);
      if (idx < 0) throw new IntegrationWorkflowError('Exame oficial não encontrado.', 404, 'EXAM_NOT_FOUND');
      state.exams[idx] = structuredClone({ ...state.exams[idx], ...updates });
      return structuredClone(state.exams[idx]);
    },

    async listEpiDeliveries() {
      return state.epiDeliveries.map((x) => structuredClone(x));
    },
    async createEpiDelivery(data) {
      const created: EPIDelivery = structuredClone({ id: nextId('epi'), ...data });
      state.epiDeliveries.push(created);
      return structuredClone(created);
    },

    async listSafetyPermits() {
      return state.safetyPermits.map((x) => structuredClone(x));
    },
    async listSmartDocs() {
      return state.smartDocs.map((x) => structuredClone(x));
    },

    async addAuditLog(entry) {
      state.auditLogs.push(structuredClone({ id: nextId('audit'), ...entry }));
    },
  };
}

// ============================================================================
// INTEGRATION WORKFLOW SERVICE (SERVER-AUTHORITATIVE)
// ============================================================================

export class IntegrationWorkflowService {
  private readonly repo: IntegrationWorkflowRepository;
  private readonly fileStorage: IntegrationFileStorage;
  private readonly nowProvider: () => Date;
  private readonly smartDocsSuggestionRunner: SmartDocsSuggestionRunner;
  private readonly notificationService?: InAppNotificationService;
  private readonly integrationLocks = new Map<string, Promise<void>>();

  constructor(options?: {
    repo?: IntegrationWorkflowRepository;
    fileStorage?: IntegrationFileStorage;
    nowProvider?: () => Date;
    smartDocsSuggestionRunner?: SmartDocsSuggestionRunner;
    notificationService?: InAppNotificationService;
  }) {
    this.repo = options?.repo ?? createFirestoreIntegrationRepository();
    this.fileStorage =
      options?.fileStorage ??
      (options?.repo
        ? new InMemoryIntegrationFileStorage()
        : createDefaultIntegrationFileStorage());
    this.nowProvider = options?.nowProvider ?? (() => new Date());
    this.smartDocsSuggestionRunner =
      options?.smartDocsSuggestionRunner ?? defaultSmartDocsSuggestionRunner();
    this.notificationService =
      options?.notificationService ?? (options?.repo ? undefined : new InAppNotificationService());
  }

  private async emitNotification(input: CreateInAppNotificationInput): Promise<void> {
    if (!this.notificationService) return;
    try {
      await this.notificationService.createIdempotentNotification(input);
    } catch (err) {
      console.warn('[IntegrationWorkflow] Aviso ao gravar notificação interna:', err);
    }
  }

  private async withIntegrationLock<T>(integrationId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.integrationLocks.get(integrationId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const chained = previous.then(() => current);
    this.integrationLocks.set(integrationId, chained);

    await previous;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (this.integrationLocks.get(integrationId) === chained) {
        this.integrationLocks.delete(integrationId);
      }
    }
  }

  private nowIso(): string {
    return this.nowProvider().toISOString();
  }

  private assertNotAuditor(actor: IntegrationWorkflowActor, actionLabel: string): void {
    if (actor.role === 'auditor') {
      throw new IntegrationWorkflowError(
        `Perfil Auditor possui acesso somente leitura e não pode ${actionLabel}.`,
        403,
        'AUDITOR_READ_ONLY'
      );
    }
  }

  private assertAdmin(actor: IntegrationWorkflowActor, actionLabel: string): void {
    if (actor.role !== 'admin') {
      throw new IntegrationWorkflowError(
        `Apenas o Administrador EHS pode ${actionLabel}.`,
        403,
        'ADMIN_REQUIRED'
      );
    }
  }

  private getActorAuthorizedCompanyIds(actor: IntegrationWorkflowActor): string[] {
    return Array.from(
      new Set(
        [
          ...(Array.isArray(actor.empresaIds) ? actor.empresaIds : []),
          ...(actor.empresaId ? [actor.empresaId] : []),
        ]
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      )
    );
  }

  private assertCompanyScopeAccess(
    actor: IntegrationWorkflowActor,
    integration: ContractorIntegration
  ): void {
    if (actor.role !== 'solicitante') return;
    const allowedCompanyIds = this.getActorAuthorizedCompanyIds(actor);
    if (allowedCompanyIds.length > 0) {
      if (integration.empresaId && !allowedCompanyIds.includes(integration.empresaId)) {
        throw new IntegrationWorkflowError(
          'Acesso negado: Solicitante só pode visualizar ou operar integrações das empresas contratadas às quais possui autorização.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
      if (!integration.empresaId && integration.solicitadoPorId !== actor.id) {
        throw new IntegrationWorkflowError(
          'Acesso negado: esta integração pertence a outro solicitante.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
    } else if (integration.solicitadoPorId !== actor.id) {
      throw new IntegrationWorkflowError(
        'Acesso negado: Solicitante sem empresa vinculada só pode acessar suas próprias solicitações.',
        403,
        'COMPANY_SCOPE_VIOLATION'
      );
    }
  }

  private assertConcurrencyVersion(
    integration: ContractorIntegration,
    expectedVersion?: number
  ): void {
    if (
      typeof expectedVersion === 'number' &&
      expectedVersion !== integration.versaoConcorrencia
    ) {
      throw new IntegrationWorkflowError(
        'Conflito de concorrência: esta integração foi atualizada por outro usuário. Recarregue os dados antes de continuar.',
        409,
        'CONCURRENCY_CONFLICT',
        { currentVersion: integration.versaoConcorrencia }
      );
    }
  }

  private async logAudit(
    actor: IntegrationWorkflowActor,
    acao: string,
    entidadeId: string,
    detalhes: string
  ): Promise<void> {
    await this.repo.addAuditLog({
      usuario: actor.nome,
      usuarioEmail: actor.email,
      acao,
      entidade: 'Central de Integração',
      entidadeId,
      detalhes,
      dataHora: this.nowIso(),
    });
  }

  // --------------------------------------------------------------------------
  // DUPLICATE DETECTION (CNPJ / CPF)
  // --------------------------------------------------------------------------

  async checkDuplicates(
    actor: IntegrationWorkflowActor,
    input: DuplicateCheckInput
  ): Promise<DuplicateCheckResult> {
    const result: DuplicateCheckResult = {
      cnpjDuplicado: false,
      cpfDuplicado: false,
    };

    const cnpjDigits = digitsOnly(input.cnpj);
    if (cnpjDigits.length >= 11) {
      const companies = await this.repo.listCompanies();
      const match = companies.find((c) => digitsOnly(c.cnpj) === cnpjDigits);
      if (match) {
        result.cnpjDuplicado = true;
        if (actor.role !== 'solicitante' || !actor.empresaId || actor.empresaId === match.id) {
          result.empresaExistente = {
            id: match.id,
            razaoSocial: match.razaoSocial,
            nomeFantasia: match.nomeFantasia,
            cnpj: match.cnpj,
            situacao: match.situacao,
          };
        }
      }
    }

    const cpfDigits = digitsOnly(input.cpf);
    if (cpfDigits.length >= 11) {
      const employees = await this.repo.listEmployees();
      const match = employees.find((e) => digitsOnly(e.cpf) === cpfDigits);
      if (match) {
        result.cpfDuplicado = true;
        const mesmaEmpresa = !actor.empresaId || match.empresaId === actor.empresaId;
        if (actor.role !== 'solicitante' || mesmaEmpresa) {
          result.colaboradorExistente = {
            id: match.id,
            nomeCompleto: match.nomeCompleto,
            cpf: match.cpf,
            cargo: match.cargo,
            empresaId: match.empresaId,
            empresaNome: match.empresaNome,
            mesmaEmpresa,
            situacaoCadastral: match.situacaoCadastral,
          };
        } else {
          result.colaboradorExistente = {
            id: '',
            nomeCompleto: 'Colaborador já cadastrado em outra contratada',
            cpf: match.cpf,
            cargo: '',
            empresaId: '',
            empresaNome: 'Outra empresa contratada',
            mesmaEmpresa: false,
            situacaoCadastral: match.situacaoCadastral,
          };
        }
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // SUBMISSION READINESS & STORAGE CONFIRMATION (SERVER-SIDE SOURCE OF TRUTH)
  // --------------------------------------------------------------------------

  private assertSubmittedForAdmin(
    integration: ContractorIntegration,
    actionLabel: string
  ): void {
    if (UNSUBMITTED_INTEGRATION_STATUSES.has(integration.status)) {
      throw new IntegrationWorkflowError(
        `Ação bloqueada (${actionLabel}): o cadastro "${integration.codigoProtocolo}" ainda está em "${integration.status}" (pendente de conclusão documental pelo solicitante) e só ficará disponível para análise do Admin EHS após a submissão completa.`,
        409,
        'INTEGRATION_NOT_SUBMITTED'
      );
    }
  }

  private async isItemFileConfirmedInStorage(
    item: ContractorIntegrationItem
  ): Promise<{ confirmed: boolean; reason?: string }> {
    if (item.versaoAtual < 1 || !item.arquivoNome || !item.arquivoNome.trim()) {
      return {
        confirmed: false,
        reason: 'Nenhum arquivo anexado para este documento obrigatório.',
      };
    }

    if (item.hasStoredFile === false) {
      return {
        confirmed: false,
        reason: 'Arquivo sem confirmação no armazenamento privado (possível falha de upload). Reenvie o documento.',
      };
    }

    const versions = item.versoes || [];
    const activeVersion =
      versions.find((v) => v.versao === item.versaoAtual) || versions[versions.length - 1];
    const storageKey = activeVersion?.storageKey || item.storageKey;
    const expectedSha256 = activeVersion?.arquivoHashSha256 || item.arquivoHashSha256;
    const expectedSize = activeVersion?.arquivoTamanhoBytes || item.arquivoTamanhoBytes;

    if (storageKey) {
      try {
        const storedObj = await this.fileStorage.getObject(storageKey);
        if (!storedObj || !storedObj.buffer || storedObj.buffer.length <= 0) {
          return {
            confirmed: false,
            reason:
              'Arquivo não encontrado ou vazio no armazenamento privado. Reenvie o documento para confirmar o upload.',
          };
        }
        if (typeof expectedSize === 'number' && expectedSize > 0 && storedObj.buffer.length !== expectedSize) {
          return {
            confirmed: false,
            reason:
              'Tamanho do arquivo armazenado diverge do upload original (possível upload incompleto). Reenvie o documento.',
          };
        }
        if (expectedSha256) {
          const actualSha256 = crypto
            .createHash('sha256')
            .update(storedObj.buffer)
            .digest('hex');
          if (actualSha256 !== expectedSha256) {
            return {
              confirmed: false,
              reason:
                'Integridade SHA-256 do arquivo no armazenamento privado não pôde ser confirmada. Reenvie o documento.',
            };
          }
        }
        return { confirmed: true };
      } catch {
        return {
          confirmed: false,
          reason:
            'Falha ao confirmar o arquivo no armazenamento privado. Reenvie o documento antes de finalizar o cadastro.',
        };
      }
    }

    return {
      confirmed: false,
      reason: 'Arquivo sem referência confirmada no armazenamento privado (metadados isolados não são aceitos). Anexe novamente o documento.',
    };
  }

  private resolveCollaboratorKeyForItem(
    integration: ContractorIntegration,
    item: ContractorIntegrationItem
  ): { valid: boolean; key: string; nome: string; colaboradorId?: string; colaboradorCandidateId?: string } {
    const candidates = integration.colaboradoresCandidatos || [];
    const matched = candidates.find(
      (c) =>
        (item.colaboradorId &&
          (c.colaboradorId === item.colaboradorId || c.aprovadoEmployeeId === item.colaboradorId)) ||
        (item.colaboradorCandidateId && c.candidateId === item.colaboradorCandidateId)
    );
    if (matched) {
      const key =
        matched.aprovadoEmployeeId ||
        matched.colaboradorId ||
        matched.candidateId ||
        matched.nomeCompleto;
      return {
        valid: true,
        key,
        nome: matched.nomeCompleto,
        colaboradorId: matched.aprovadoEmployeeId || matched.colaboradorId,
        colaboradorCandidateId: matched.candidateId,
      };
    }

    if (
      item.colaboradorId &&
      (integration.colaboradorIds || []).includes(item.colaboradorId)
    ) {
      return {
        valid: true,
        key: item.colaboradorId,
        nome: item.colaboradorNome || 'Colaborador Terceirizado',
        colaboradorId: item.colaboradorId,
      };
    }

    return {
      valid: false,
      key: item.colaboradorId || item.colaboradorCandidateId || `orphan-${item.id}`,
      nome: item.colaboradorNome || 'Colaborador não vinculado',
      colaboradorId: item.colaboradorId,
      colaboradorCandidateId: item.colaboradorCandidateId,
    };
  }

  private async evaluateSubmissionReadiness(
    integration: ContractorIntegration,
    rawItems: ContractorIntegrationItem[]
  ): Promise<IntegrationSubmissionReadiness> {
    const mandatoryItems = rawItems.filter((i) => i.obrigatorio);
    const optionalItems = rawItems.filter((i) => !i.obrigatorio);
    const pendenciasObrigatorias: IntegrationPendingDocumentInfo[] = [];

    // Seed individual per-collaborator readiness map from integration.colaboradoresCandidatos
    const collaboratorMap = new Map<string, IntegrationCollaboratorReadiness>();
    for (const cand of integration.colaboradoresCandidatos || []) {
      const key = cand.aprovadoEmployeeId || cand.colaboradorId || cand.candidateId || cand.nomeCompleto;
      collaboratorMap.set(key, {
        colaboradorKey: key,
        colaboradorId: cand.aprovadoEmployeeId || cand.colaboradorId,
        colaboradorCandidateId: cand.candidateId,
        colaboradorNome: cand.nomeCompleto,
        completo: true,
        totalObrigatorios: 0,
        obrigatoriosConfirmados: 0,
        obrigatoriosPendentes: 0,
        totalOpcionais: 0,
        opcionaisEnviados: 0,
        pendencias: [],
      });
    }

    const ensureCollaboratorEntry = (item: ContractorIntegrationItem) => {
      const resolved = this.resolveCollaboratorKeyForItem(integration, item);
      if (!collaboratorMap.has(resolved.key)) {
        collaboratorMap.set(resolved.key, {
          colaboradorKey: resolved.key,
          colaboradorId: resolved.colaboradorId,
          colaboradorCandidateId: resolved.colaboradorCandidateId,
          colaboradorNome: resolved.nome,
          completo: true,
          totalObrigatorios: 0,
          obrigatoriosConfirmados: 0,
          obrigatoriosPendentes: 0,
          totalOpcionais: 0,
          opcionaisEnviados: 0,
          pendencias: [],
        });
      }
      return { resolved, entry: collaboratorMap.get(resolved.key)! };
    };

    let obrigatoriosConfirmados = 0;
    for (const item of mandatoryItems) {
      const baseInfo = {
        itemId: item.id,
        documentoCodigoCanonico: item.documentoCodigoCanonico,
        nomeExibicao: item.nomeExibicao,
        categoria: item.categoria,
        categoriaOrganizacional:
          item.categoria === 'colaborador'
            ? item.categoriaOrganizacional || classifyIntegrationDocumentGroup(item)
            : item.categoriaOrganizacional,
        colaboradorId: item.colaboradorId,
        colaboradorCandidateId: item.colaboradorCandidateId,
        colaboradorNome: item.colaboradorNome,
        status: item.status,
      };

      const colabCtx =
        item.categoria === 'colaborador' ? ensureCollaboratorEntry(item) : undefined;
      if (colabCtx) {
        colabCtx.entry.totalObrigatorios += 1;
      }

      const pushPending = (motivo: string, motivoReprovacao?: string) => {
        const info: IntegrationPendingDocumentInfo = {
          ...baseInfo,
          motivo,
          motivoReprovacao,
        };
        pendenciasObrigatorias.push(info);
        if (colabCtx) {
          colabCtx.entry.obrigatoriosPendentes += 1;
          colabCtx.entry.completo = false;
          colabCtx.entry.pendencias.push(info);
        }
      };

      // Ownership & linkage integrity validation
      if (item.integrationId !== integration.id) {
        pushPending('Inconsistência de propriedade: documento não pertence a este protocolo.');
        continue;
      }
      if (integration.empresaId && item.empresaId && item.empresaId !== integration.empresaId) {
        pushPending('Inconsistência de propriedade: documento vinculado a outra empresa contratada.');
        continue;
      }
      if (colabCtx && !colabCtx.resolved.valid) {
        pushPending(
          'Inconsistência de vinculação: documento não está associado a um colaborador válido desta integração.'
        );
        continue;
      }

      if (item.status === 'PENDENTE_ENVIO') {
        pushPending('Documento obrigatório ausente (ainda não anexado).');
        continue;
      }

      if (item.status === 'REPROVADO') {
        pushPending(
          item.motivoReprovacao
            ? `Reprovado pelo Admin EHS: ${item.motivoReprovacao}`
            : 'Documento obrigatório reprovado — exige substituição.',
          item.motivoReprovacao
        );
        continue;
      }

      if (item.status === 'SUBSTITUIDO') {
        pushPending('Documento substituído — anexe a versão válida atual.');
        continue;
      }

      const storageCheck = await this.isItemFileConfirmedInStorage(item);
      if (!storageCheck.confirmed) {
        pushPending(
          storageCheck.reason ||
            'Upload não confirmado no armazenamento privado. Reenvie o documento.'
        );
        continue;
      }

      if (
        item.reaproveitado &&
        !item.semValidade &&
        item.dataValidade &&
        isIsoDateExpired(item.dataValidade, this.nowIso())
      ) {
        pushPending(
          `Documento reaproveitado venceu em ${item.dataValidade} — anexe uma versão atualizada dentro da validade.`
        );
        continue;
      }

      obrigatoriosConfirmados += 1;
      if (colabCtx) {
        colabCtx.entry.obrigatoriosConfirmados += 1;
      }
    }

    let opcionaisEnviados = 0;
    for (const optItem of optionalItems) {
      const colabCtx =
        optItem.categoria === 'colaborador' ? ensureCollaboratorEntry(optItem) : undefined;
      if (colabCtx) {
        colabCtx.entry.totalOpcionais += 1;
      }
      if (optItem.versaoAtual >= 1 && optItem.arquivoNome && optItem.hasStoredFile !== false) {
        const storageCheck = await this.isItemFileConfirmedInStorage(optItem);
        if (storageCheck.confirmed) {
          opcionaisEnviados += 1;
          if (colabCtx) {
            colabCtx.entry.opcionaisEnviados += 1;
          }
        }
      }
    }

    const porColaborador = Array.from(collaboratorMap.values());
    const anyCollaboratorIncomplete = porColaborador.some((c) => !c.completo);

    const blockingSimpleActivities = (integration.atividadesSimples || []).filter(
      (sa) => sa.status === 'RECUSADA' || sa.status === 'COMPLEMENTACAO_SOLICITADA'
    );

    let podeSubmeter =
      pendenciasObrigatorias.length === 0 &&
      !anyCollaboratorIncomplete &&
      blockingSimpleActivities.length === 0;
    let resumoBloqueio: string | undefined;

    if (blockingSimpleActivities.length > 0) {
      podeSubmeter = false;
      resumoBloqueio = `Submissão bloqueada: existem ${blockingSimpleActivities.length} Atividade(s) Simples aguardando ajuste ou complementação pelo Solicitante (${blockingSimpleActivities
        .map((sa) => `${sa.nome} — ${sa.status === 'RECUSADA' ? 'Recusada' : 'Complementação solicitada'}`)
        .join(', ')}). Atualize a atividade ou anexe a documentação complementar antes de reenviar.`;
    } else if (rawItems.length === 0) {
      podeSubmeter = false;
      resumoBloqueio =
        'Nenhum item documental encontrado no checklist. Anexe ao menos um documento da atividade antes de enviar para análise.';
    } else if (mandatoryItems.length === 0 && opcionaisEnviados === 0) {
      podeSubmeter = false;
      resumoBloqueio =
        'Anexe ao menos um documento confirmado antes de enviar a integração para conferência do Admin EHS.';
    } else if (pendenciasObrigatorias.length > 0) {
      const previewNames = pendenciasObrigatorias
        .slice(0, 5)
        .map((p) =>
          p.colaboradorNome
            ? `${p.nomeExibicao} (${p.colaboradorNome})`
            : p.nomeExibicao
        )
        .join(', ');
      const extraCount = pendenciasObrigatorias.length > 5 ? ` e mais ${pendenciasObrigatorias.length - 5}` : '';
      resumoBloqueio = `Submissão bloqueada: existem ${pendenciasObrigatorias.length} documento(s) obrigatório(s) pendente(s), reprovado(s) ou sem confirmação no armazenamento: ${previewNames}${extraCount}.`;
    }

    // Etapa 4 consolidated summary counters
    let reaproveitadosAprovados = 0;
    let novosEnviados = 0;
    let pendentesAprovacaoExistentes = 0;
    let recusados = 0;
    let atualizacaoNecessaria = 0;
    const nowRef = this.nowIso();

    for (const item of rawItems) {
      const expiredReused =
        Boolean(item.reaproveitado) &&
        !item.semValidade &&
        Boolean(item.dataValidade) &&
        isIsoDateExpired(item.dataValidade, nowRef);

      if (item.status === 'APROVADO' && item.reaproveitado && !expiredReused) {
        reaproveitadosAprovados += 1;
      } else if (
        item.situacaoDocumentoExistente === 'PENDENTE_APROVACAO' &&
        (item.status === 'ENVIADO' || item.status === 'EM_ANALISE')
      ) {
        pendentesAprovacaoExistentes += 1;
      } else if (item.status === 'REPROVADO') {
        recusados += 1;
        atualizacaoNecessaria += 1;
      } else if (item.status === 'PENDENTE_ENVIO' || item.status === 'SUBSTITUIDO' || expiredReused) {
        if (item.situacaoDocumentoExistente === 'RECUSADO') {
          recusados += 1;
        }
        atualizacaoNecessaria += 1;
      } else if (item.versaoAtual >= 1 && item.arquivoNome) {
        novosEnviados += 1;
      }
    }

    return {
      podeSubmeter,
      totalItens: rawItems.length,
      totalObrigatorios: mandatoryItems.length,
      obrigatoriosConfirmados,
      obrigatoriosPendentes: pendenciasObrigatorias.length,
      totalOpcionais: optionalItems.length,
      opcionaisEnviados,
      pendenciasObrigatorias,
      porColaborador,
      resumoBloqueio,
      reaproveitadosAprovados,
      novosEnviados,
      pendentesAprovacaoExistentes,
      recusados,
      atualizacaoNecessaria,
    };
  }

  private buildPendingCorrectionItems(
    items: ContractorIntegrationItem[]
  ): IntegrationPendingDocumentInfo[] {
    return items
      .filter((i) => i.status === 'REPROVADO' || (i.obrigatorio && i.status === 'PENDENTE_ENVIO'))
      .map((item) => ({
        itemId: item.id,
        documentoCodigoCanonico: item.documentoCodigoCanonico,
        nomeExibicao: item.nomeExibicao,
        categoria: item.categoria,
        categoriaOrganizacional:
          item.categoria === 'colaborador'
            ? item.categoriaOrganizacional || classifyIntegrationDocumentGroup(item)
            : item.categoriaOrganizacional,
        colaboradorId: item.colaboradorId,
        colaboradorCandidateId: item.colaboradorCandidateId,
        colaboradorNome: item.colaboradorNome,
        status: item.status,
        motivo:
          item.status === 'REPROVADO'
            ? item.motivoReprovacao || 'Documento reprovado — exige correção ou substituição.'
            : 'Documento obrigatório ausente — anexar arquivo válido.',
        motivoReprovacao: item.motivoReprovacao,
      }));
  }

  // --------------------------------------------------------------------------
  // LIST & DETAIL
  // --------------------------------------------------------------------------

  async listIntegrations(actor: IntegrationWorkflowActor): Promise<ContractorIntegration[]> {
    const all = await this.repo.listIntegrations();
    if (actor.role === 'solicitante') {
      const allowedCompanyIds = this.getActorAuthorizedCompanyIds(actor);
      return all.filter((item) => {
        if (allowedCompanyIds.length > 0) {
          return (
            (Boolean(item.empresaId) && allowedCompanyIds.includes(item.empresaId!)) ||
            (!item.empresaId && item.solicitadoPorId === actor.id)
          );
        }
        return item.solicitadoPorId === actor.id;
      });
    }
    if (actor.role === 'admin') {
      // Regra obrigatória #7: somente cadastros já submetidos ficam disponíveis para análise do Admin EHS
      return all.filter((item) => !UNSUBMITTED_INTEGRATION_STATUSES.has(item.status));
    }
    return all;
  }

  async listAccessibleDocumentItems(
    actor: IntegrationWorkflowActor
  ): Promise<MirroredIntegrationDocumentItem[]> {
    const accessibleIntegrations = await this.listIntegrations(actor);
    const integrationMap = new Map<string, ContractorIntegration>();
    for (const integ of accessibleIntegrations) {
      // Admin and Auditor only see submitted protocols in Central de Análise Documental / Controle de Vencimentos
      if (actor.role !== 'solicitante' && UNSUBMITTED_INTEGRATION_STATUSES.has(integ.status)) {
        continue;
      }
      integrationMap.set(integ.id, integ);
    }

    if (integrationMap.size === 0) {
      return [];
    }

    const allItems = await this.repo.listAllItems();
    const mirrored: MirroredIntegrationDocumentItem[] = [];
    const allowedCompanyIds = this.getActorAuthorizedCompanyIds(actor);

    for (const rawItem of allItems) {
      const parent = integrationMap.get(rawItem.integrationId);
      if (!parent) continue;
      // Extra defense-in-depth company scope check for Solicitante
      if (
        actor.role === 'solicitante' &&
        allowedCompanyIds.length > 0 &&
        parent.empresaId &&
        !allowedCompanyIds.includes(parent.empresaId)
      ) {
        continue;
      }
      const sanitized = stripLargeFileUrlFromItem(rawItem);
      mirrored.push({
        ...sanitized,
        codigoProtocolo: parent.codigoProtocolo,
        protocoloStatus: parent.status,
        protocoloTipo: parent.tipo,
        empresaCnpj: parent.empresaCnpj,
        solicitadoPorNome: parent.solicitadoPorNome,
        protocoloDataEnvio: parent.dataEnvio,
        protocoloDataUltimaAtualizacao: parent.dataUltimaAtualizacao,
      });
    }

    return mirrored.sort((a, b) =>
      (b.updatedAt || b.dataEnvio || b.createdAt || '').localeCompare(
        a.updatedAt || a.dataEnvio || a.createdAt || ''
      )
    );
  }

  async getIntegrationDetail(
    actor: IntegrationWorkflowActor,
    integrationId: string
  ): Promise<IntegrationDetailResult> {
    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Processo de integração não encontrado.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertCompanyScopeAccess(actor, integration);
    if (actor.role === 'admin') {
      this.assertSubmittedForAdmin(integration, 'visualizar cadastro não submetido');
    }

    const rawItems = await this.repo.listItemsByIntegration(integrationId);
    const submissionReadiness = await this.evaluateSubmissionReadiness(integration, rawItems);
    const items = rawItems.map(stripLargeFileUrlFromItem);

    let compliancePreview: ActivityComplianceResult | null = null;
    if (integration.empresaId && integration.atividadeIds.length > 0) {
      const company = await this.repo.getCompanyById(integration.empresaId);
      if (company) {
        const [
          activityProfiles,
          requirements,
          employees,
          documents,
          trainings,
          exams,
          epiDeliveries,
          safetyPermits,
          smartDocs,
        ] = await Promise.all([
          this.repo.listActivityProfiles(),
          this.repo.listActivityDocumentRequirements(),
          this.repo.listEmployees(),
          this.repo.listDocuments(),
          this.repo.listTrainings(),
          this.repo.listExams(),
          this.repo.listEpiDeliveries(),
          this.repo.listSafetyPermits(),
          this.repo.listSmartDocs(),
        ]);

        const resolvedEmployeeIds = Array.from(
          new Set([
            ...integration.colaboradorIds,
            ...integration.colaboradoresCandidatos
              .map((c) => c.aprovadoEmployeeId || c.colaboradorId)
              .filter((x): x is string => Boolean(x)),
          ])
        );

        compliancePreview = evaluateActivityCompliance({
          company,
          atividadeIds: integration.atividadeIds,
          colaboradorIds: resolvedEmployeeIds,
          activityProfiles,
          requirements,
          employees,
          documents,
          trainings,
          exams,
          epiDeliveries,
          safetyPermits,
          smartDocs,
          dataReferenciaAtividade: this.nowIso().slice(0, 10),
        });
      }
    }

    return { integration, items, compliancePreview, submissionReadiness };
  }

  // --------------------------------------------------------------------------
  // CENTRALIZED DOCUMENT REUSE ENGINE (5-GATE VALIDATION, ZERO RE-UPLOAD)
  // --------------------------------------------------------------------------

  private resolveStorageKeyFromOfficialUrl(
    url: string | undefined,
    allIntegrationItems: ContractorIntegrationItem[]
  ): { storageKey?: string; reuseOrigin?: 'BASE_OFICIAL' | 'INTEGRACAO_ANTERIOR' } {
    if (!url || typeof url !== 'string') return {};
    const trimmed = url.trim();
    if (trimmed.startsWith('ehs-direct://')) {
      const key = trimmed.slice('ehs-direct://'.length).trim();
      return key ? { storageKey: key, reuseOrigin: 'BASE_OFICIAL' } : {};
    }
    const match = trimmed.match(/\/api\/integrations\/([^/]+)\/items\/([^/?#]+)\/file(?:\?[^#]*version=(\d+))?/i);
    if (match) {
      const sourceItemId = decodeURIComponent(match[2]);
      const requestedVersion = match[3] ? Number(match[3]) : undefined;
      const sourceItem = allIntegrationItems.find((it) => it.id === sourceItemId);
      if (sourceItem) {
        const matchedVersion =
          requestedVersion && Array.isArray(sourceItem.versoes)
            ? sourceItem.versoes.find((v) => v.versao === requestedVersion)
            : (sourceItem.versoes || []).find((v) => v.versao === sourceItem.versaoAtual);
        const key = matchedVersion?.storageKey || sourceItem.storageKey;
        if (key) {
          return { storageKey: key, reuseOrigin: 'INTEGRACAO_ANTERIOR' };
        }
      }
    }
    return {};
  }

  private doesCanonicalOrTitleMatchRequirement(params: {
    recordCanonical?: string;
    recordTitle?: string;
    reqCanonical: string;
    reqKeywords?: string[];
  }): boolean {
    const recCanon = normalizeCanonicalCode(params.recordCanonical);
    const reqCanon = normalizeCanonicalCode(params.reqCanonical);

    if (recCanon && reqCanon) {
      if (recCanon === reqCanon) return true;
      if (reqCanon === 'ASO' && recCanon.includes('ASO')) return true;
      return false;
    }

    const titleNorm = normalizeMatchText(params.recordTitle || '');
    if (!titleNorm) return false;
    if (reqCanon && titleNorm.includes(normalizeMatchText(reqCanon))) return true;
    for (const kw of params.reqKeywords || []) {
      const kwNorm = normalizeMatchText(kw);
      if (kwNorm && titleNorm.includes(kwNorm)) return true;
    }
    return false;
  }

  private async resolveReusableDocumentForRequirement(params: {
    empresaId?: string;
    categoria: IntegrationItemCategory;
    origemColecao: IntegrationOfficialCollection;
    documentoCodigoCanonico: string;
    palavrasChaveMatch?: string[];
    exigeAptoASO?: boolean;
    colaboradorId?: string;
    colaboradorCpf?: string;
    allEmployees: Employee[];
    allDocuments: DocumentSST[];
    allExams: OccupationalExam[];
    allTrainings: Training[];
    allEpiDeliveries: EPIDelivery[];
    allIntegrationItems: ContractorIntegrationItem[];
    now: string;
  }): Promise<{
    resolution: DocumentReuseResolutionState;
    aviso?: string;
    officialCollection?: IntegrationOfficialCollection;
    officialRecordId?: string;
    reaproveitadoDe?: IntegrationDocumentReuseSource;
    storageKey?: string;
    arquivoNome?: string;
    arquivoMimeType?: 'application/pdf' | 'image/jpeg' | 'image/png';
    arquivoTamanhoBytes?: number;
    arquivoHashSha256?: string;
    dataEmissao?: string;
    dataValidade?: string;
    semValidade?: boolean;
    numeroDocumento?: string;
    conclusaoAso?: ConclusaoAptidao;
    aptidoesEspecificas?: string[];
    analisadoPorNome?: string;
    dataAnalise?: string;
    motivoReprovacao?: string;
    versaoAtual?: number;
  }> {
    const { empresaId, categoria, origemColecao, now } = params;
    if (!empresaId) {
      return { resolution: 'AUSENTE' };
    }

    // Strict identity matching for collaborator documents: ONLY by exact employeeId or normalized 11-digit CPF within the exact company (NEVER by name similarity)
    let matchedEmployeeId: string | undefined;
    if (categoria === 'colaborador') {
      if (params.colaboradorId) {
        const emp = params.allEmployees.find(
          (e) => e.id === params.colaboradorId && e.empresaId === empresaId
        );
        matchedEmployeeId = emp?.id || params.colaboradorId;
      } else {
        const cpfDigits = digitsOnly(params.colaboradorCpf);
        if (cpfDigits.length === 11) {
          const emp = params.allEmployees.find(
            (e) => e.empresaId === empresaId && digitsOnly(e.cpf) === cpfDigits
          );
          matchedEmployeeId = emp?.id;
        }
      }
      if (!matchedEmployeeId) {
        return { resolution: 'AUSENTE' };
      }
    }

    interface NormalizedOfficialCandidate {
      id: string;
      colecao: IntegrationOfficialCollection;
      situacao: 'pendente' | 'aprovado' | 'reprovado' | 'vencido';
      url: string;
      arquivoNome: string;
      dataEmissao?: string;
      dataValidade?: string;
      semValidade?: boolean;
      numeroDocumento?: string;
      conclusaoAso?: ConclusaoAptidao;
      aptidoesEspecificas?: string[];
      analisadoPor?: string;
      dataAnalise?: string;
      motivoReprovacao?: string;
      versao?: number;
      sortKey: string;
    }

    const candidates: NormalizedOfficialCandidate[] = [];

    if (origemColecao === 'documents') {
      for (const doc of params.allDocuments) {
        if (doc.empresaId !== empresaId) continue;
        const docColabId = (doc.colaboradorId || '').trim();
        if (categoria === 'empresa' && docColabId !== '') continue;
        if (categoria === 'colaborador' && docColabId !== matchedEmployeeId) continue;

        if (
          !this.doesCanonicalOrTitleMatchRequirement({
            recordCanonical: doc.tipoDocumentoCanonico,
            recordTitle: doc.nomeDocumento,
            reqCanonical: params.documentoCodigoCanonico,
            reqKeywords: params.palavrasChaveMatch,
          })
        ) {
          continue;
        }

        candidates.push({
          id: doc.id,
          colecao: 'documents',
          situacao: doc.situacao || 'pendente',
          url: doc.arquivoUrl || '',
          arquivoNome: doc.arquivoNome || `${doc.nomeDocumento}.pdf`,
          dataEmissao: doc.dataEmissao,
          dataValidade: doc.dataValidade,
          semValidade: Boolean(doc.semValidade),
          numeroDocumento: doc.numeroDocumento,
          analisadoPor: doc.analisadoPor,
          dataAnalise: doc.dataAnalise,
          motivoReprovacao: doc.motivoReprovacao,
          versao: doc.versao || 1,
          sortKey: doc.updatedAt || doc.dataAnalise || doc.createdAt || '',
        });
      }
    } else if (origemColecao === 'exams') {
      if (categoria === 'colaborador') {
        for (const exam of params.allExams) {
          if (exam.empresaId !== empresaId) continue;
          if ((exam.colaboradorId || '').trim() !== matchedEmployeeId) continue;
          if (
            !this.doesCanonicalOrTitleMatchRequirement({
              recordCanonical: exam.tipoDocumentoCanonico || 'ASO',
              recordTitle: exam.tipoExame,
              reqCanonical: params.documentoCodigoCanonico,
              reqKeywords: params.palavrasChaveMatch,
            })
          ) {
            continue;
          }
          candidates.push({
            id: exam.id,
            colecao: 'exams',
            situacao: exam.situacao || 'pendente',
            url: exam.anexoUrl || '',
            arquivoNome: exam.anexoNome || `${exam.tipoExame}.pdf`,
            dataEmissao: exam.dataRealizacao,
            dataValidade: exam.dataValidade,
            semValidade: Boolean(exam.semValidade),
            conclusaoAso: exam.conclusao,
            aptidoesEspecificas: exam.aptidoesEspecificas,
            analisadoPor: exam.analisadoPor,
            dataAnalise: exam.dataAnalise,
            motivoReprovacao: exam.motivoReprovacao,
            versao: exam.versao || 1,
            sortKey: exam.updatedAt || exam.dataAnalise || exam.createdAt || '',
          });
        }
      }
    } else if (origemColecao === 'trainings') {
      if (categoria === 'colaborador') {
        for (const trn of params.allTrainings) {
          if (trn.empresaId !== empresaId) continue;
          if ((trn.colaboradorId || '').trim() !== matchedEmployeeId) continue;
          if (
            !this.doesCanonicalOrTitleMatchRequirement({
              recordCanonical: trn.tipoDocumentoCanonico,
              recordTitle: trn.nomeTreinamento,
              reqCanonical: params.documentoCodigoCanonico,
              reqKeywords: params.palavrasChaveMatch,
            })
          ) {
            continue;
          }
          candidates.push({
            id: trn.id,
            colecao: 'trainings',
            situacao: trn.situacao || 'pendente',
            url: trn.certificadoUrl || '',
            arquivoNome: trn.certificadoNome || `${trn.nomeTreinamento}.pdf`,
            dataEmissao: trn.dataRealizacao,
            dataValidade: trn.dataValidade,
            semValidade: Boolean(trn.semValidade),
            analisadoPor: trn.analisadoPor,
            dataAnalise: trn.dataAnalise,
            motivoReprovacao: trn.motivoReprovacao,
            versao: trn.versao || 1,
            sortKey: trn.updatedAt || trn.dataAnalise || trn.createdAt || '',
          });
        }
      }
    } else if (origemColecao === 'epiDeliveries') {
      if (categoria === 'colaborador') {
        for (const epi of params.allEpiDeliveries) {
          if (epi.empresaId !== empresaId) continue;
          if ((epi.colaboradorId || '').trim() !== matchedEmployeeId) continue;
          candidates.push({
            id: epi.id,
            colecao: 'epiDeliveries',
            situacao: 'aprovado',
            url: epi.assinaturaUrl || '',
            arquivoNome: epi.comprovanteNome || `${epi.nomeEpi}.pdf`,
            dataEmissao: epi.dataEntrega,
            semValidade: true,
            versao: 1,
            sortKey: epi.createdAt || '',
          });
        }
      }
    }

    if (candidates.length === 0) {
      return { resolution: 'AUSENTE' };
    }

    // Sort newest first
    candidates.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

    const verifyCandidateBinary = async (cand: NormalizedOfficialCandidate) => {
      const resolved = this.resolveStorageKeyFromOfficialUrl(cand.url, params.allIntegrationItems);
      if (!resolved.storageKey) return null;
      try {
        const stored = await this.fileStorage.getObject(resolved.storageKey);
        if (!stored || !stored.buffer || stored.buffer.length <= 0) return null;
        const detectedMime =
          detectRealMimeFromBuffer(stored.buffer) || 'application/pdf';
        const sha256 = computeBufferSha256(stored.buffer);
        const reuseSource: IntegrationDocumentReuseSource = {
          colecao: cand.colecao,
          registroId: cand.id,
          versao: cand.versao || 1,
          aprovadoPor: cand.analisadoPor,
          dataAprovacao: cand.dataAnalise,
          dataValidade: cand.dataValidade,
          semValidade: cand.semValidade,
          storageKey: resolved.storageKey,
          arquivoNome: cand.arquivoNome,
        };
        return {
          storageKey: resolved.storageKey,
          reuseSource,
          arquivoMimeType: detectedMime,
          arquivoTamanhoBytes: stored.buffer.length,
          arquivoHashSha256: sha256,
        };
      } catch {
        return null;
      }
    };

    // Pass 1: Approved + valid + readable in private storage -> REAPROVEITADO_VALIDO
    let approvedButExpired: NormalizedOfficialCandidate | null = null;
    let approvedButMissingFile: NormalizedOfficialCandidate | null = null;

    for (const cand of candidates) {
      if (cand.situacao !== 'aprovado') continue;
      const expired = !cand.semValidade && Boolean(cand.dataValidade) && isIsoDateExpired(cand.dataValidade, now);
      const asoNotApto =
        cand.colecao === 'exams' &&
        Boolean(params.exigeAptoASO) &&
        cand.conclusaoAso &&
        cand.conclusaoAso !== 'apto';

      if (expired || asoNotApto) {
        if (!approvedButExpired) approvedButExpired = cand;
        continue;
      }

      const verified = await verifyCandidateBinary(cand);
      if (!verified) {
        if (!approvedButMissingFile) approvedButMissingFile = cand;
        continue;
      }

      return {
        resolution: 'REAPROVEITADO_VALIDO',
        aviso: cand.semValidade
          ? 'Documento aprovado e válido na base oficial — reaproveitado automaticamente.'
          : cand.dataValidade
          ? `Documento aprovado e válido até ${cand.dataValidade} — reaproveitado automaticamente.`
          : 'Documento aprovado na base oficial — reaproveitado automaticamente.',
        officialCollection: cand.colecao,
        officialRecordId: cand.id,
        reaproveitadoDe: verified.reuseSource,
        storageKey: verified.storageKey,
        arquivoNome: cand.arquivoNome,
        arquivoMimeType: verified.arquivoMimeType,
        arquivoTamanhoBytes: verified.arquivoTamanhoBytes,
        arquivoHashSha256: verified.arquivoHashSha256,
        dataEmissao: cand.dataEmissao,
        dataValidade: cand.dataValidade,
        semValidade: cand.semValidade,
        numeroDocumento: cand.numeroDocumento,
        conclusaoAso: cand.conclusaoAso,
        aptidoesEspecificas: cand.aptidoesEspecificas,
        analisadoPorNome: cand.analisadoPor,
        dataAnalise: cand.dataAnalise,
        versaoAtual: cand.versao || 1,
      };
    }

    // Pass 2: Pending official document with verified binary -> link WITHOUT marking approved (prevents duplicate upload AND enforces Admin approval)
    for (const cand of candidates) {
      if (cand.situacao !== 'pendente') continue;
      const verified = await verifyCandidateBinary(cand);
      if (!verified) continue;
      return {
        resolution: 'PENDENTE_APROVACAO',
        aviso:
          'Documento já enviado na base e aguardando aprovação do Administrador EHS. Não é necessário reenviar; a aprovação atualizará esta integração automaticamente.',
        officialCollection: cand.colecao,
        officialRecordId: cand.id,
        reaproveitadoDe: verified.reuseSource,
        storageKey: verified.storageKey,
        arquivoNome: cand.arquivoNome,
        arquivoMimeType: verified.arquivoMimeType,
        arquivoTamanhoBytes: verified.arquivoTamanhoBytes,
        arquivoHashSha256: verified.arquivoHashSha256,
        dataEmissao: cand.dataEmissao,
        dataValidade: cand.dataValidade,
        semValidade: cand.semValidade,
        numeroDocumento: cand.numeroDocumento,
        conclusaoAso: cand.conclusaoAso,
        aptidoesEspecificas: cand.aptidoesEspecificas,
        versaoAtual: cand.versao || 1,
      };
    }

    // Pass 3: Rejected official document -> require corrected upload with clear reason
    const rejected = candidates.find((c) => c.situacao === 'reprovado');
    if (rejected) {
      return {
        resolution: 'RECUSADO',
        aviso: rejected.motivoReprovacao
          ? `Documento existente foi recusado pelo Admin EHS (${rejected.motivoReprovacao}). Anexe uma versão corrigida.`
          : 'Documento existente foi recusado pelo Admin EHS. Anexe uma versão corrigida.',
        officialCollection: rejected.colecao,
        officialRecordId: rejected.id,
        dataValidade: rejected.dataValidade,
        motivoReprovacao: rejected.motivoReprovacao,
      };
    }

    // Pass 4: Approved but expired (or ASO not apto) -> NEVER reuse, clearly ask for updated upload
    if (approvedButExpired) {
      const isAsoIssue =
        approvedButExpired.colecao === 'exams' &&
        Boolean(params.exigeAptoASO) &&
        approvedButExpired.conclusaoAso &&
        approvedButExpired.conclusaoAso !== 'apto';
      return {
        resolution: 'VENCIDO',
        aviso: isAsoIssue
          ? `ASO existente consta como "${approvedButExpired.conclusaoAso}" — anexe um ASO APTO dentro da validade.`
          : `Documento existente venceu em ${approvedButExpired.dataValidade} e não pode ser reaproveitado. Anexe uma versão atualizada.`,
        officialCollection: approvedButExpired.colecao,
        officialRecordId: approvedButExpired.id,
        dataValidade: approvedButExpired.dataValidade,
      };
    }

    // Pass 5: Approved in metadata but binary missing from private storage -> request re-upload
    if (approvedButMissingFile) {
      return {
        resolution: 'ARQUIVO_INDISPONIVEL',
        aviso:
          'Documento localizado no cadastro, porém o arquivo não está legível/disponível no armazenamento privado. Anexe novamente.',
        officialCollection: approvedButMissingFile.colecao,
        officialRecordId: approvedButMissingFile.id,
      };
    }

    return { resolution: 'AUSENTE' };
  }

  private applyReuseResolutionToDraft(
    baseDraft: Omit<ContractorIntegrationItem, 'id' | 'integrationId'>,
    reuse: Awaited<ReturnType<IntegrationWorkflowService['resolveReusableDocumentForRequirement']>>,
    now: string
  ): Omit<ContractorIntegrationItem, 'id' | 'integrationId'> {
    if (reuse.resolution === 'REAPROVEITADO_VALIDO' && reuse.storageKey && reuse.arquivoNome) {
      const versionNum = Math.max(1, reuse.versaoAtual || 1);
      const reuseSource: IntegrationDocumentReuseSource | undefined =
        reuse.reaproveitadoDe ||
        (reuse.officialCollection && reuse.officialRecordId
          ? {
              colecao: reuse.officialCollection,
              registroId: reuse.officialRecordId,
              versao: versionNum,
              aprovadoPor: reuse.analisadoPorNome,
              dataAprovacao: reuse.dataAnalise,
              dataValidade: reuse.dataValidade,
              semValidade: reuse.semValidade,
              storageKey: reuse.storageKey,
              arquivoNome: reuse.arquivoNome,
            }
          : undefined);
      return {
        ...baseDraft,
        status: 'APROVADO',
        reaproveitado: true,
        reaproveitadoDe: reuseSource,
        situacaoDocumentoExistente: 'REAPROVEITADO_VALIDO',
        documentoExistenteAviso: reuse.aviso,
        documentoExistenteId: reuse.officialRecordId,
        documentoExistenteColecao: reuse.officialCollection,
        officialCollection: reuse.officialCollection,
        officialRecordId: reuse.officialRecordId,
        storageKey: reuse.storageKey,
        hasStoredFile: true,
        arquivoNome: reuse.arquivoNome,
        arquivoMimeType: reuse.arquivoMimeType,
        arquivoTamanhoBytes: reuse.arquivoTamanhoBytes,
        arquivoHashSha256: reuse.arquivoHashSha256,
        dataEmissao: reuse.dataEmissao,
        dataValidade: reuse.dataValidade,
        semValidade: reuse.semValidade,
        numeroDocumento: reuse.numeroDocumento,
        conclusaoAso: reuse.conclusaoAso,
        aptidoesEspecificas: reuse.aptidoesEspecificas,
        analisadoPorNome: reuse.analisadoPorNome,
        dataAnalise: reuse.dataAnalise || now,
        versaoAtual: versionNum,
        versoes: [
          {
            versao: versionNum,
            arquivoNome: reuse.arquivoNome,
            arquivoMimeType: reuse.arquivoMimeType || 'application/pdf',
            arquivoTamanhoBytes: reuse.arquivoTamanhoBytes || 0,
            arquivoHashSha256: reuse.arquivoHashSha256 || '',
            storageKey: reuse.storageKey,
            hasStoredFile: true,
            enviadoPorId: 'system-reuse',
            enviadoPorNome: 'Base Oficial EHS (Reaproveitado)',
            enviadoEm: reuse.dataAnalise || now,
            dataEmissao: reuse.dataEmissao,
            dataValidade: reuse.dataValidade,
            semValidade: reuse.semValidade,
            numeroDocumento: reuse.numeroDocumento,
            conclusaoAso: reuse.conclusaoAso,
            aptidoesEspecificas: reuse.aptidoesEspecificas,
            status: 'APROVADO',
            analisadoPorNome: reuse.analisadoPorNome,
            analisadoEm: reuse.dataAnalise || now,
          },
        ],
      };
    }

    if (reuse.resolution === 'PENDENTE_APROVACAO' && reuse.storageKey && reuse.arquivoNome) {
      const versionNum = Math.max(1, reuse.versaoAtual || 1);
      const reuseSource: IntegrationDocumentReuseSource | undefined =
        reuse.reaproveitadoDe ||
        (reuse.officialCollection && reuse.officialRecordId
          ? {
              colecao: reuse.officialCollection,
              registroId: reuse.officialRecordId,
              versao: versionNum,
              dataValidade: reuse.dataValidade,
              semValidade: reuse.semValidade,
              storageKey: reuse.storageKey,
              arquivoNome: reuse.arquivoNome,
            }
          : undefined);
      return {
        ...baseDraft,
        status: 'ENVIADO',
        reaproveitado: false,
        reaproveitadoDe: reuseSource,
        situacaoDocumentoExistente: 'PENDENTE_APROVACAO',
        documentoExistenteAviso: reuse.aviso,
        documentoExistenteId: reuse.officialRecordId,
        documentoExistenteColecao: reuse.officialCollection,
        officialCollection: reuse.officialCollection,
        officialRecordId: reuse.officialRecordId,
        storageKey: reuse.storageKey,
        hasStoredFile: true,
        arquivoNome: reuse.arquivoNome,
        arquivoMimeType: reuse.arquivoMimeType,
        arquivoTamanhoBytes: reuse.arquivoTamanhoBytes,
        arquivoHashSha256: reuse.arquivoHashSha256,
        dataEmissao: reuse.dataEmissao,
        dataValidade: reuse.dataValidade,
        semValidade: reuse.semValidade,
        numeroDocumento: reuse.numeroDocumento,
        conclusaoAso: reuse.conclusaoAso,
        aptidoesEspecificas: reuse.aptidoesEspecificas,
        versaoAtual: versionNum,
        versoes: [
          {
            versao: versionNum,
            arquivoNome: reuse.arquivoNome,
            arquivoMimeType: reuse.arquivoMimeType || 'application/pdf',
            arquivoTamanhoBytes: reuse.arquivoTamanhoBytes || 0,
            arquivoHashSha256: reuse.arquivoHashSha256 || '',
            storageKey: reuse.storageKey,
            hasStoredFile: true,
            enviadoPorId: 'base-pendente',
            enviadoPorNome: 'Enviado na Base (Aguardando EHS)',
            enviadoEm: now,
            dataEmissao: reuse.dataEmissao,
            dataValidade: reuse.dataValidade,
            semValidade: reuse.semValidade,
            numeroDocumento: reuse.numeroDocumento,
            conclusaoAso: reuse.conclusaoAso,
            aptidoesEspecificas: reuse.aptidoesEspecificas,
            status: 'ENVIADO',
          },
        ],
      };
    }

    if (reuse.resolution !== 'AUSENTE') {
      return {
        ...baseDraft,
        status: 'PENDENTE_ENVIO',
        reaproveitado: false,
        situacaoDocumentoExistente: reuse.resolution,
        documentoExistenteAviso: reuse.aviso,
        documentoExistenteId: reuse.officialRecordId,
        documentoExistenteColecao: reuse.officialCollection,
        motivoReprovacao: reuse.resolution === 'RECUSADO' ? reuse.motivoReprovacao : undefined,
      };
    }

    return {
      ...baseDraft,
      situacaoDocumentoExistente: 'AUSENTE',
    };
  }

  // --------------------------------------------------------------------------
  // DYNAMIC CHECKLIST GENERATION FROM EXISTING ACTIVITY MATRIX
  // --------------------------------------------------------------------------

  private inferSimpleActivityDocumentMeta(doc: SimpleActivityDocumentInput): {
    canonical: string;
    origem: IntegrationOfficialCollection;
    palavrasChave: string[];
    exigeAptoASO: boolean;
  } {
    const rawName = String(doc.nomeDocumento || '').trim();
    const explicit = String(doc.documentoCodigoCanonico || '').trim();
    const normName = normalizeMatchText(rawName);
    const slug = normName
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 48);

    let canonical = explicit ? normalizeCanonicalCode(explicit) || explicit.toUpperCase() : '';
    let origem: IntegrationOfficialCollection = 'documents';
    let exigeAptoASO = false;
    const palavrasChave: string[] = [rawName];

    if (!canonical) {
      if (/\bpgr\b|gerenciamento de riscos/.test(normName)) {
        canonical = 'PGR';
        origem = 'documents';
        palavrasChave.push('PGR', 'Programa de Gerenciamento de Riscos');
      } else if (/\bpcmso\b|controle medico/.test(normName)) {
        canonical = 'PCMSO';
        origem = 'documents';
        palavrasChave.push('PCMSO', 'Controle Médico');
      } else if (/\baso\b|atestado de saude/.test(normName)) {
        canonical = 'ASO';
        origem = 'exams';
        exigeAptoASO = true;
        palavrasChave.push('ASO', 'Atestado de Saúde Ocupacional');
      } else if (/\bepi\b|ficha de epi/.test(normName)) {
        canonical = 'FICHA_EPI';
        origem = 'epiDeliveries';
        palavrasChave.push('EPI', 'Ficha de EPI');
      } else if (/ordem de servico|\bos\b/.test(normName)) {
        canonical = 'ORDEM_SERVICO';
        origem = 'documents';
        palavrasChave.push('Ordem de Serviço', 'OS');
      } else if (/contrato social/.test(normName)) {
        canonical = 'CONTRATO_SOCIAL';
        origem = 'documents';
        palavrasChave.push('Contrato Social');
      } else if (/cartao cnpj|\bcnpj\b/.test(normName)) {
        canonical = 'CNPJ';
        origem = 'documents';
        palavrasChave.push('CNPJ', 'Cartão CNPJ');
      } else if (/\bart\b|anotacao de responsabilidade/.test(normName)) {
        canonical = 'ART';
        origem = 'documents';
        palavrasChave.push('ART', 'Anotação de Responsabilidade Técnica');
      } else if (/\bpgrs\b/.test(normName)) {
        canonical = 'PGRS';
        origem = 'documents';
        palavrasChave.push('PGRS');
      } else {
        const nrMatch = normName.match(/\bnr[\s-]*(\d{1,2})\b/);
        if (nrMatch) {
          canonical = `NR-${nrMatch[1]}`;
          origem = 'trainings';
          palavrasChave.push(`NR-${nrMatch[1]}`, `NR ${nrMatch[1]}`);
        } else if (/treinamento|certificado|capacitacao/.test(normName)) {
          canonical = `SIMPLES_${slug || 'DOC'}`;
          origem = 'trainings';
        } else {
          canonical = `SIMPLES_${slug || 'DOC'}`;
          origem = 'documents';
        }
      }
    } else {
      const upper = canonical.toUpperCase();
      if (upper.includes('ASO')) {
        origem = 'exams';
        exigeAptoASO = true;
      } else if (/^NR[-_]?\d+/.test(upper)) {
        origem = 'trainings';
      } else if (upper.includes('EPI')) {
        origem = 'epiDeliveries';
      }
      palavrasChave.push(canonical);
    }

    return {
      canonical,
      origem,
      palavrasChave: Array.from(new Set(palavrasChave.filter(Boolean))),
      exigeAptoASO,
    };
  }

  private sanitizeSimpleActivitiesInput(
    actor: IntegrationWorkflowActor,
    rawList: CreateSimpleActivityInput[] | undefined,
    empresaId: string | undefined,
    now: string
  ): Array<{ entry: SimpleActivityEntry; documentos: SimpleActivityDocumentInput[] }> {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];
    const result: Array<{ entry: SimpleActivityEntry; documentos: SimpleActivityDocumentInput[] }> = [];

    for (let idx = 0; idx < rawList.length; idx += 1) {
      const raw = rawList[idx];
      const nome = String(raw?.nome || '').trim();
      const descricaoServico = String(raw?.descricaoServico || '').trim();
      const observacoes = String(raw?.observacoes || '').trim();

      if (nome.length < 2 || nome.length > 160) {
        throw new IntegrationWorkflowError(
          `Atividade Simples #${idx + 1}: informe um nome válido para a atividade (entre 2 e 160 caracteres).`,
          400,
          'INVALID_SIMPLE_ACTIVITY'
        );
      }
      if (descricaoServico.length < 5 || descricaoServico.length > 2000) {
        throw new IntegrationWorkflowError(
          `Atividade Simples "${nome}": descreva o serviço que será executado (mínimo de 5 caracteres).`,
          400,
          'INVALID_SIMPLE_ACTIVITY'
        );
      }

      const sanitizedDocs: SimpleActivityDocumentInput[] = [];
      for (const rawDoc of Array.isArray(raw?.documentos) ? raw.documentos : []) {
        const docName = String(rawDoc?.nomeDocumento || '').trim();
        if (!docName) continue;
        sanitizedDocs.push({
          nomeDocumento: docName.slice(0, 180),
          documentoCodigoCanonico: rawDoc?.documentoCodigoCanonico
            ? String(rawDoc.documentoCodigoCanonico).trim().slice(0, 80)
            : undefined,
          escopo: rawDoc?.escopo === 'colaborador' ? 'colaborador' : 'empresa',
          colaboradorId: rawDoc?.colaboradorId ? String(rawDoc.colaboradorId).trim() : undefined,
          colaboradorCandidateId: rawDoc?.colaboradorCandidateId
            ? String(rawDoc.colaboradorCandidateId).trim()
            : undefined,
          obrigatorio: rawDoc?.obrigatorio !== undefined ? Boolean(rawDoc.obrigatorio) : true,
          observacoes: rawDoc?.observacoes ? String(rawDoc.observacoes).trim().slice(0, 500) : undefined,
        });
      }

      const id = `sa-${Date.now()}-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`;
      // Anti-tampering: status is ALWAYS forced to PENDENTE_ANALISE on creation
      const entry: SimpleActivityEntry = {
        id,
        empresaId,
        nome,
        descricaoServico,
        observacoes: observacoes || undefined,
        status: 'PENDENTE_ANALISE',
        criadoPorId: actor.id,
        criadoPorNome: actor.nome,
        criadoPorRole: actor.role,
        criadoEm: now,
        atualizadoEm: now,
        historico: [
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'CRIACAO_ATIVIDADE_SIMPLES',
            statusAnterior: null,
            statusNovo: 'PENDENTE_ANALISE',
            detalhes: `Atividade Simples "${nome}" cadastrada por ${actor.nome} (${sanitizedDocs.length} documento(s) vinculado(s)). Aguardando análise do Administrador EHS.`,
          },
        ],
      };

      result.push({ entry, documentos: sanitizedDocs });
    }

    return result;
  }

  private async buildDynamicChecklistDrafts(params: {
    tipo: IntegrationType;
    empresaId?: string;
    empresaNome: string;
    atividadeIds: string[];
    atividadesSimples?: Array<{ entry: SimpleActivityEntry; documentos: SimpleActivityDocumentInput[] }>;
    colaboradoresCandidatos: IntegrationEmployeeCandidate[];
    customItems?: CreateIntegrationCustomItemInput[];
  }): Promise<Omit<ContractorIntegrationItem, 'id' | 'integrationId'>[]> {
    const now = this.nowIso();
    const [
      profiles,
      allRequirements,
      allEmployees,
      allDocuments,
      allExams,
      allTrainings,
      allEpiDeliveries,
      allIntegrationItems,
    ] = await Promise.all([
      this.repo.listActivityProfiles(),
      this.repo.listActivityDocumentRequirements(),
      params.empresaId ? this.repo.listEmployees() : Promise.resolve([] as Employee[]),
      params.empresaId ? this.repo.listDocuments() : Promise.resolve([] as DocumentSST[]),
      params.empresaId ? this.repo.listExams() : Promise.resolve([] as OccupationalExam[]),
      params.empresaId ? this.repo.listTrainings() : Promise.resolve([] as Training[]),
      params.empresaId ? this.repo.listEpiDeliveries() : Promise.resolve([] as EPIDelivery[]),
      params.empresaId ? this.repo.listAllItems() : Promise.resolve([] as ContractorIntegrationItem[]),
    ]);

    const activeProfileMap = new Map<string, ActivityProfile>();
    for (const p of profiles) {
      if (p.ativo) activeProfileMap.set(p.id, p);
    }

    const validActivityIds = params.atividadeIds.filter((id) => activeProfileMap.has(id));
    const items: Omit<ContractorIntegrationItem, 'id' | 'integrationId'>[] = [];
    const dedupMap = new Map<string, number>();

    const pushOrMergeItem = (
      key: string,
      draft: Omit<ContractorIntegrationItem, 'id' | 'integrationId'>
    ) => {
      const existingIdx = dedupMap.get(key);
      if (existingIdx !== undefined) {
        const existing = items[existingIdx];
        existing.obrigatorio = existing.obrigatorio || draft.obrigatorio;
        existing.exigeAptoASO = Boolean(existing.exigeAptoASO || draft.exigeAptoASO);
        if (draft.aptidaoEspecifica && !existing.aptidaoEspecifica) {
          existing.aptidaoEspecifica = draft.aptidaoEspecifica;
        }
        return;
      }
      dedupMap.set(key, items.length);
      items.push(draft);
    };

    // For INTEGRACAO_INICIAL (or ATUALIZACAO_DOCUMENTAL without explicit customItems), derive dynamically from Matrix
    const shouldGenerateFromMatrix =
      params.tipo === 'INTEGRACAO_INICIAL' || !params.customItems || params.customItems.length === 0;

    if (shouldGenerateFromMatrix) {
      const relevantReqs = allRequirements
        .filter(
          (r) =>
            r.ativo &&
            validActivityIds.includes(r.activityId) &&
            r.origemColecao !== 'safetyPermits' // APR/PT/PET/LOTO continuam no fluxo de Permissão de Trabalho
        )
        .sort((a, b) => (a.ordemExibicao ?? 999) - (b.ordemExibicao ?? 999));

      for (const req of relevantReqs) {
        const actProfile = activeProfileMap.get(req.activityId);
        const canonical = normalizeCanonicalCode(req.documentoCodigoCanonico) || req.documentoCodigoCanonico;
        const origem = req.origemColecao as IntegrationOfficialCollection;

        if (req.escopo === 'empresa') {
          const dedupKey = `empresa|${canonical}|${origem}`;
          if (dedupMap.has(dedupKey)) {
            pushOrMergeItem(dedupKey, {
              empresaId: params.empresaId,
              empresaNome: params.empresaNome,
              categoria: 'empresa',
              requirementId: req.id,
              activityId: req.activityId,
              activityNome: actProfile?.nome,
              documentoCodigoCanonico: req.documentoCodigoCanonico,
              nomeExibicao: req.nomeExibicao,
              origemColecao: origem,
              obrigatorio: Boolean(req.obrigatorioParaLiberacao),
              baseLegal: req.baseLegal,
              status: 'PENDENTE_ENVIO',
              versaoAtual: 0,
              versoes: [],
              createdAt: now,
              updatedAt: now,
            });
            continue;
          }

          const reuse = await this.resolveReusableDocumentForRequirement({
            empresaId: params.empresaId,
            categoria: 'empresa',
            origemColecao: origem,
            documentoCodigoCanonico: req.documentoCodigoCanonico,
            palavrasChaveMatch: req.palavrasChaveMatch,
            allEmployees,
            allDocuments,
            allExams,
            allTrainings,
            allEpiDeliveries,
            allIntegrationItems,
            now,
          });

          pushOrMergeItem(
            dedupKey,
            this.applyReuseResolutionToDraft(
              {
                empresaId: params.empresaId,
                empresaNome: params.empresaNome,
                categoria: 'empresa',
                requirementId: req.id,
                activityId: req.activityId,
                activityNome: actProfile?.nome,
                documentoCodigoCanonico: req.documentoCodigoCanonico,
                nomeExibicao: req.nomeExibicao,
                origemColecao: origem,
                obrigatorio: Boolean(req.obrigatorioParaLiberacao),
                baseLegal: req.baseLegal,
                status: 'PENDENTE_ENVIO',
                versaoAtual: 0,
                versoes: [],
                createdAt: now,
                updatedAt: now,
              },
              reuse,
              now
            )
          );
        } else if (req.escopo === 'colaborador') {
          for (const cand of params.colaboradoresCandidatos) {
            const empActivities =
              cand.atividadesHabilitadasIds && cand.atividadesHabilitadasIds.length > 0
                ? cand.atividadesHabilitadasIds
                : validActivityIds;
            if (!empActivities.includes(req.activityId)) continue;
            if (!matchesEmployeeRole(cand.cargo, req.funcoesAplicaveis)) continue;

            const dedupKey = `colaborador|${cand.candidateId}|${canonical}|${origem}|${req.aptidaoEspecifica || ''}`;
            const baseDraft: Omit<ContractorIntegrationItem, 'id' | 'integrationId'> = {
              empresaId: params.empresaId,
              empresaNome: params.empresaNome,
              colaboradorId: cand.colaboradorId,
              colaboradorCandidateId: cand.candidateId,
              colaboradorNome: cand.nomeCompleto,
              colaboradorCpf: cand.cpf,
              colaboradorCargo: cand.cargo,
              categoria: 'colaborador',
              categoriaOrganizacional: classifyIntegrationDocumentGroup({
                documentoCodigoCanonico: req.documentoCodigoCanonico,
                nomeExibicao: req.nomeExibicao,
                origemColecao: origem,
              }),
              requirementId: req.id,
              activityId: req.activityId,
              activityNome: actProfile?.nome,
              documentoCodigoCanonico: req.documentoCodigoCanonico,
              nomeExibicao: req.nomeExibicao,
              origemColecao: origem,
              obrigatorio: Boolean(req.obrigatorioParaLiberacao),
              exigeAptoASO: Boolean(req.exigeAptoASO),
              aptidaoEspecifica: req.aptidaoEspecifica,
              baseLegal: req.baseLegal,
              status: 'PENDENTE_ENVIO',
              versaoAtual: 0,
              versoes: [],
              createdAt: now,
              updatedAt: now,
            };

            if (dedupMap.has(dedupKey)) {
              pushOrMergeItem(dedupKey, baseDraft);
              continue;
            }

            const reuse = await this.resolveReusableDocumentForRequirement({
              empresaId: params.empresaId,
              categoria: 'colaborador',
              origemColecao: origem,
              documentoCodigoCanonico: req.documentoCodigoCanonico,
              palavrasChaveMatch: req.palavrasChaveMatch,
              exigeAptoASO: Boolean(req.exigeAptoASO),
              colaboradorId: cand.colaboradorId,
              colaboradorCpf: cand.cpf,
              allEmployees,
              allDocuments,
              allExams,
              allTrainings,
              allEpiDeliveries,
              allIntegrationItems,
              now,
            });

            pushOrMergeItem(dedupKey, this.applyReuseResolutionToDraft(baseDraft, reuse, now));
          }
        }
      }
    }

    // Add explicit custom / targeted renewal items
    if (params.customItems && params.customItems.length > 0) {
      for (const custom of params.customItems) {
        const canonical = (custom.documentoCodigoCanonico || 'OUTRO').trim();
        const nomeExibicao = (custom.nomeExibicao || canonical).trim();
        const cand = params.colaboradoresCandidatos.find(
          (c) =>
            (custom.colaboradorId && c.colaboradorId === custom.colaboradorId) ||
            (custom.colaboradorCandidateId && c.candidateId === custom.colaboradorCandidateId)
        );
        const origem: IntegrationOfficialCollection =
          custom.origemColecao ||
          (canonical.toUpperCase().includes('ASO')
            ? 'exams'
            : canonical.toUpperCase().startsWith('NR-')
            ? 'trainings'
            : 'documents');

        const key = `custom|${custom.categoria}|${cand?.candidateId || 'emp'}|${canonical}|${nomeExibicao}`;
        pushOrMergeItem(key, {
          empresaId: params.empresaId,
          empresaNome: params.empresaNome,
          colaboradorId: cand?.colaboradorId || custom.colaboradorId,
          colaboradorCandidateId: cand?.candidateId || custom.colaboradorCandidateId,
          colaboradorNome: cand?.nomeCompleto,
          colaboradorCpf: cand?.cpf,
          colaboradorCargo: cand?.cargo,
          categoria: custom.categoria || mapRequirementScopeToCategory(cand ? 'colaborador' : 'empresa'),
          documentoCodigoCanonico: canonical,
          nomeExibicao,
          origemColecao: origem,
          obrigatorio: custom.obrigatorio !== undefined ? Boolean(custom.obrigatorio) : true,
          exigeAptoASO: custom.exigeAptoASO,
          aptidaoEspecifica: custom.aptidaoEspecifica,
          baseLegal: custom.baseLegal,
          officialRecordId: custom.officialRecordId,
          status: 'PENDENTE_ENVIO',
          versaoAtual: 0,
          versoes: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Add documents linked to ATIVIDADE SIMPLES (with full 5-gate automatic document reuse!)
    if (params.atividadesSimples && params.atividadesSimples.length > 0) {
      for (const { entry, documentos } of params.atividadesSimples) {
        for (const doc of documentos) {
          const meta = this.inferSimpleActivityDocumentMeta(doc);
          const canonicalNorm = normalizeCanonicalCode(meta.canonical) || meta.canonical;
          const isCollaboratorScope =
            doc.escopo === 'colaborador' && params.colaboradoresCandidatos.length > 0;

          if (!isCollaboratorScope) {
            const dedupKey = `empresa|${canonicalNorm}|${meta.origem}`;
            const baseDraft: Omit<ContractorIntegrationItem, 'id' | 'integrationId'> = {
              empresaId: params.empresaId,
              empresaNome: params.empresaNome,
              categoria: 'empresa',
              categoriaOrganizacional: 'atividade_simples',
              simpleActivityId: entry.id,
              simpleActivityNome: entry.nome,
              activityNome: `Atividade Simples: ${entry.nome}`,
              documentoCodigoCanonico: meta.canonical,
              nomeExibicao: doc.nomeDocumento,
              origemColecao: meta.origem,
              obrigatorio: doc.obrigatorio !== undefined ? Boolean(doc.obrigatorio) : true,
              exigeAptoASO: meta.exigeAptoASO || undefined,
              observacoes: doc.observacoes,
              status: 'PENDENTE_ENVIO',
              versaoAtual: 0,
              versoes: [],
              createdAt: now,
              updatedAt: now,
            };

            if (dedupMap.has(dedupKey)) {
              const existingIdx = dedupMap.get(dedupKey)!;
              if (!items[existingIdx].simpleActivityId) {
                items[existingIdx].simpleActivityId = entry.id;
                items[existingIdx].simpleActivityNome = entry.nome;
              }
              pushOrMergeItem(dedupKey, baseDraft);
              continue;
            }

            const reuse = await this.resolveReusableDocumentForRequirement({
              empresaId: params.empresaId,
              categoria: 'empresa',
              origemColecao: meta.origem,
              documentoCodigoCanonico: meta.canonical,
              palavrasChaveMatch: meta.palavrasChave,
              allEmployees,
              allDocuments,
              allExams,
              allTrainings,
              allEpiDeliveries,
              allIntegrationItems,
              now,
            });

            pushOrMergeItem(dedupKey, this.applyReuseResolutionToDraft(baseDraft, reuse, now));
          } else {
            const targetCandidates =
              doc.colaboradorId || doc.colaboradorCandidateId
                ? params.colaboradoresCandidatos.filter(
                    (c) =>
                      (doc.colaboradorId && c.colaboradorId === doc.colaboradorId) ||
                      (doc.colaboradorCandidateId && c.candidateId === doc.colaboradorCandidateId)
                  )
                : params.colaboradoresCandidatos;

            for (const cand of targetCandidates) {
              const dedupKey = `colaborador|${cand.candidateId}|${canonicalNorm}|${meta.origem}|`;
              const baseDraft: Omit<ContractorIntegrationItem, 'id' | 'integrationId'> = {
                empresaId: params.empresaId,
                empresaNome: params.empresaNome,
                colaboradorId: cand.colaboradorId,
                colaboradorCandidateId: cand.candidateId,
                colaboradorNome: cand.nomeCompleto,
                colaboradorCpf: cand.cpf,
                colaboradorCargo: cand.cargo,
                categoria: 'colaborador',
                categoriaOrganizacional: 'atividade_simples',
                simpleActivityId: entry.id,
                simpleActivityNome: entry.nome,
                activityNome: `Atividade Simples: ${entry.nome}`,
                documentoCodigoCanonico: meta.canonical,
                nomeExibicao: doc.nomeDocumento,
                origemColecao: meta.origem,
                obrigatorio: doc.obrigatorio !== undefined ? Boolean(doc.obrigatorio) : true,
                exigeAptoASO: meta.exigeAptoASO || undefined,
                observacoes: doc.observacoes,
                status: 'PENDENTE_ENVIO',
                versaoAtual: 0,
                versoes: [],
                createdAt: now,
                updatedAt: now,
              };

              if (dedupMap.has(dedupKey)) {
                const existingIdx = dedupMap.get(dedupKey)!;
                if (!items[existingIdx].simpleActivityId) {
                  items[existingIdx].simpleActivityId = entry.id;
                  items[existingIdx].simpleActivityNome = entry.nome;
                }
                pushOrMergeItem(dedupKey, baseDraft);
                continue;
              }

              const reuse = await this.resolveReusableDocumentForRequirement({
                empresaId: params.empresaId,
                categoria: 'colaborador',
                origemColecao: meta.origem,
                documentoCodigoCanonico: meta.canonical,
                palavrasChaveMatch: meta.palavrasChave,
                exigeAptoASO: meta.exigeAptoASO,
                colaboradorId: cand.colaboradorId,
                colaboradorCpf: cand.cpf,
                allEmployees,
                allDocuments,
                allExams,
                allTrainings,
                allEpiDeliveries,
                allIntegrationItems,
                now,
              });

              pushOrMergeItem(dedupKey, this.applyReuseResolutionToDraft(baseDraft, reuse, now));
            }
          }
        }
      }
    }

    return items;
  }

  // --------------------------------------------------------------------------
  // PREVIEW AUTOMATIC DOCUMENT REUSE BEFORE CREATING INTEGRATION
  // --------------------------------------------------------------------------

  async previewDocumentReuse(
    actor: IntegrationWorkflowActor,
    input: {
      empresaId: string;
      atividadeIds: string[];
      atividadesSimples?: CreateSimpleActivityInput[];
      colaboradorIds?: string[];
    }
  ): Promise<IntegrationReusePreviewResult> {
    const empresaId = String(input.empresaId || '').trim();
    if (!empresaId) {
      throw new IntegrationWorkflowError('Selecione a empresa contratada para consultar reaproveitamento.', 400, 'COMPANY_REQUIRED');
    }

    const company = await this.repo.getCompanyById(empresaId);
    if (!company) {
      throw new IntegrationWorkflowError('Empresa contratada não encontrada.', 404, 'COMPANY_NOT_FOUND');
    }

    if (actor.role === 'solicitante') {
      const allowedCompanyIds = this.getActorAuthorizedCompanyIds(actor);
      const isAuthorized =
        allowedCompanyIds.includes(empresaId) ||
        (company.solicitantesAutorizadosIds || []).includes(actor.id) ||
        company.criadoPorId === actor.id;
      if (!isAuthorized) {
        throw new IntegrationWorkflowError(
          'Acesso negado: solicitante não possui autorização para consultar documentos desta empresa.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
    }

    const allEmployees = await this.repo.listEmployees();
    const requestedIds = Array.from(new Set((input.colaboradorIds || []).filter(Boolean)));
    const candidatos: IntegrationEmployeeCandidate[] = [];

    for (const empId of requestedIds) {
      const emp = allEmployees.find((e) => e.id === empId);
      if (!emp) continue;
      if (emp.empresaId !== empresaId) {
        throw new IntegrationWorkflowError(
          `Colaborador "${emp.nomeCompleto}" pertence a outra empresa contratada.`,
          403,
          'EMPLOYEE_COMPANY_MISMATCH'
        );
      }
      candidatos.push({
        candidateId: `emp-existing-${emp.id}`,
        colaboradorId: emp.id,
        nomeCompleto: emp.nomeCompleto,
        cpf: emp.cpf,
        cargo: emp.cargo,
        setor: emp.setor || '',
        atividadesHabilitadasIds: input.atividadeIds || [],
        jaExistiaNaBase: true,
        aprovadoEmployeeId: emp.id,
      });
    }

    const now = this.nowIso();
    const previewSimpleActivities: Array<{
      entry: SimpleActivityEntry;
      documentos: SimpleActivityDocumentInput[];
    }> = [];
    for (let idx = 0; idx < (input.atividadesSimples || []).length; idx += 1) {
      const raw = input.atividadesSimples![idx];
      const nome = String(raw?.nome || '').trim() || `Atividade Simples ${idx + 1}`;
      const docs = (Array.isArray(raw?.documentos) ? raw.documentos : []).filter(
        (d) => String(d?.nomeDocumento || '').trim().length > 0
      );
      if (docs.length === 0) continue;
      previewSimpleActivities.push({
        entry: {
          id: `preview-sa-${idx + 1}`,
          empresaId: company.id,
          nome,
          descricaoServico: String(raw?.descricaoServico || '').trim(),
          observacoes: raw?.observacoes ? String(raw.observacoes).trim() : undefined,
          status: 'PENDENTE_ANALISE',
          criadoPorId: actor.id,
          criadoPorNome: actor.nome,
          criadoPorRole: actor.role,
          criadoEm: now,
          atualizadoEm: now,
          historico: [],
        },
        documentos: docs,
      });
    }

    const drafts = await this.buildDynamicChecklistDrafts({
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: company.id,
      empresaNome: company.razaoSocial,
      atividadeIds: Array.from(new Set(input.atividadeIds || [])),
      atividadesSimples: previewSimpleActivities,
      colaboradoresCandidatos: candidatos,
    });

    const previewItems: IntegrationReusePreviewItem[] = drafts.map((d) => {
      const situacao: DocumentReuseResolutionState = d.situacaoDocumentoExistente || 'AUSENTE';
      return {
        categoria: d.categoria,
        colaboradorId: d.colaboradorId,
        colaboradorNome: d.colaboradorNome,
        documentoCodigoCanonico: d.documentoCodigoCanonico,
        nomeExibicao: d.nomeExibicao,
        origemColecao: d.origemColecao,
        obrigatorio: d.obrigatorio,
        situacao,
        reaproveitado: situacao === 'REAPROVEITADO_VALIDO',
        aviso: d.documentoExistenteAviso,
        officialRecordId: d.documentoExistenteId || d.officialRecordId,
        arquivoNome: d.arquivoNome,
        dataValidade: d.dataValidade,
        semValidade: d.semValidade,
        motivoReprovacao: d.motivoReprovacao,
        simpleActivityId: d.simpleActivityId,
        simpleActivityNome: d.simpleActivityNome,
      };
    });

    return {
      empresaId: company.id,
      empresaNome: company.razaoSocial,
      totalRequisitos: previewItems.length,
      reaproveitadosAprovados: previewItems.filter((i) => i.situacao === 'REAPROVEITADO_VALIDO').length,
      pendentesAprovacao: previewItems.filter((i) => i.situacao === 'PENDENTE_APROVACAO').length,
      recusados: previewItems.filter((i) => i.situacao === 'RECUSADO').length,
      vencidos: previewItems.filter((i) => i.situacao === 'VENCIDO').length,
      ausentes: previewItems.filter(
        (i) => i.situacao === 'AUSENTE' || i.situacao === 'ARQUIVO_INDISPONIVEL'
      ).length,
      itens: previewItems,
    };
  }

  // --------------------------------------------------------------------------
  // CREATE INTEGRATION (INTEGRACAO_INICIAL / ATUALIZACAO_DOCUMENTAL)
  // --------------------------------------------------------------------------

  async createIntegration(
    actor: IntegrationWorkflowActor,
    input: CreateIntegrationInput
  ): Promise<IntegrationDetailResult> {
    this.assertNotAuditor(actor, 'criar integrações de terceiros');

    const tipo: IntegrationType =
      input.tipo === 'ATUALIZACAO_DOCUMENTAL' ? 'ATUALIZACAO_DOCUMENTAL' : 'INTEGRACAO_INICIAL';

    const allCompanies = await this.repo.listCompanies();
    const allEmployees = await this.repo.listEmployees();
    const allProfiles = await this.repo.listActivityProfiles();

    let empresaId = input.empresaId?.trim() || undefined;
    let empresaNome = '';
    let empresaCnpj = '';
    let solicitacaoNovaEmpresa: IntegrationCompanyRequest | undefined;
    let empresaPendenteCadastro = false;

    const allowedCompanyIds = this.getActorAuthorizedCompanyIds(actor);

    if (empresaId) {
      if (actor.role === 'solicitante' && allowedCompanyIds.length > 0 && !allowedCompanyIds.includes(empresaId)) {
        throw new IntegrationWorkflowError(
          'Solicitante só pode iniciar integrações para empresas contratadas às quais possui autorização.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
      const company = allCompanies.find((c) => c.id === empresaId);
      if (!company) {
        throw new IntegrationWorkflowError('Empresa contratada não encontrada.', 404, 'COMPANY_NOT_FOUND');
      }
      if (
        actor.role === 'solicitante' &&
        allowedCompanyIds.length === 0 &&
        !(company.solicitantesAutorizadosIds || []).includes(actor.id) &&
        company.criadoPorId !== actor.id
      ) {
        throw new IntegrationWorkflowError(
          'Solicitante não possui autorização vinculada para esta empresa contratada.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
      empresaNome = company.razaoSocial;
      empresaCnpj = company.cnpj;
    } else if (input.solicitacaoNovaEmpresa) {
      if (actor.role === 'solicitante' && allowedCompanyIds.length > 0) {
        throw new IntegrationWorkflowError(
          'Seu perfil já está vinculado a uma empresa contratada. Selecione a empresa vinculada para iniciar a integração.',
          403,
          'COMPANY_SCOPE_VIOLATION'
        );
      }
      const reqComp = input.solicitacaoNovaEmpresa;
      if (!reqComp.razaoSocial?.trim() || digitsOnly(reqComp.cnpj).length < 14) {
        throw new IntegrationWorkflowError(
          'Informe Razão Social e CNPJ válido (14 dígitos) para solicitar cadastro de nova empresa contratada.',
          400,
          'INVALID_COMPANY_DATA'
        );
      }
      const duplicateCompany = allCompanies.find(
        (c) => digitsOnly(c.cnpj) === digitsOnly(reqComp.cnpj)
      );
      if (duplicateCompany) {
        throw new IntegrationWorkflowError(
          `CNPJ ${reqComp.cnpj} já está cadastrado na base oficial (${duplicateCompany.razaoSocial}). Selecione a empresa existente para evitar duplicidade.`,
          409,
          'DUPLICATE_COMPANY_CNPJ',
          { existingCompanyId: duplicateCompany.id, existingCompanyName: duplicateCompany.razaoSocial }
        );
      }
      solicitacaoNovaEmpresa = { ...reqComp };
      empresaNome = reqComp.razaoSocial.trim();
      empresaCnpj = reqComp.cnpj.trim();
      empresaPendenteCadastro = true;
    } else if (actor.role === 'solicitante' && allowedCompanyIds.length > 0) {
      const company = allCompanies.find((c) => c.id === allowedCompanyIds[0]);
      if (!company) {
        throw new IntegrationWorkflowError('Empresa vinculada ao perfil não localizada.', 404, 'COMPANY_NOT_FOUND');
      }
      empresaId = company.id;
      empresaNome = company.razaoSocial;
      empresaCnpj = company.cnpj;
    } else {
      throw new IntegrationWorkflowError(
        'Selecione uma empresa contratada existente ou preencha a solicitação de cadastro de nova empresa.',
        400,
        'COMPANY_REQUIRED'
      );
    }

    // Validate activities against Matrix
    const requestedActivityIds = Array.from(new Set(input.atividadeIds || []));
    const activeProfiles = allProfiles.filter((p) => p.ativo);
    const activeProfileMap = new Map(activeProfiles.map((p) => [p.id, p]));

    for (const actId of requestedActivityIds) {
      if (!activeProfileMap.has(actId)) {
        throw new IntegrationWorkflowError(
          `Atividade "${actId}" não existe ou está inativa na Matriz de Atividades.`,
          400,
          'INVALID_ACTIVITY'
        );
      }
    }

    const nowCreation = this.nowIso();
    const sanitizedSimpleActivities = this.sanitizeSimpleActivitiesInput(
      actor,
      input.atividadesSimples,
      empresaId,
      nowCreation
    );

    if (
      tipo === 'INTEGRACAO_INICIAL' &&
      requestedActivityIds.length === 0 &&
      sanitizedSimpleActivities.length === 0 &&
      (!input.customItems || input.customItems.length === 0)
    ) {
      throw new IntegrationWorkflowError(
        'Selecione ao menos uma atividade da Matriz de Atividades ou cadastre uma Atividade Simples para montar o checklist obrigatório da integração.',
        400,
        'ACTIVITY_REQUIRED'
      );
    }

    const atividadeNomes = requestedActivityIds.map((id) => activeProfileMap.get(id)!.nome);

    // Resolve existing + new third-party employees with strict CPF deduplication
    const candidatos: IntegrationEmployeeCandidate[] = [];
    const seenCpfs = new Set<string>();
    const resolvedEmployeeIds: string[] = [];

    for (const empId of Array.from(new Set(input.colaboradorIds || []))) {
      const emp = allEmployees.find((e) => e.id === empId);
      if (!emp) {
        throw new IntegrationWorkflowError(`Colaborador "${empId}" não encontrado.`, 404, 'EMPLOYEE_NOT_FOUND');
      }
      if (empresaId && emp.empresaId !== empresaId) {
        throw new IntegrationWorkflowError(
          `Colaborador "${emp.nomeCompleto}" pertence a outra empresa contratada.`,
          403,
          'EMPLOYEE_COMPANY_MISMATCH'
        );
      }
      const cpfDigits = digitsOnly(emp.cpf);
      if (cpfDigits) seenCpfs.add(cpfDigits);
      resolvedEmployeeIds.push(emp.id);
      candidatos.push({
        candidateId: `emp-existing-${emp.id}`,
        colaboradorId: emp.id,
        nomeCompleto: emp.nomeCompleto,
        cpf: emp.cpf,
        cargo: emp.cargo,
        setor: emp.setor || '',
        telefone: emp.telefone,
        email: emp.email,
        atividadeExecutada: emp.atividadeExecutada,
        atividadesHabilitadasIds:
          requestedActivityIds.length > 0
            ? requestedActivityIds
            : emp.atividadesHabilitadasIds || [],
        jaExistiaNaBase: true,
        aprovadoEmployeeId: emp.id,
      });
    }

    let newCandIndex = 1;
    for (const rawEmp of input.novosColaboradores || []) {
      if (rawEmp.colaboradorId) {
        // Already linked by ID
        if (!resolvedEmployeeIds.includes(rawEmp.colaboradorId)) {
          const emp = allEmployees.find((e) => e.id === rawEmp.colaboradorId);
          if (!emp) {
            throw new IntegrationWorkflowError(
              `Colaborador "${rawEmp.colaboradorId}" não encontrado.`,
              404,
              'EMPLOYEE_NOT_FOUND'
            );
          }
          if (empresaId && emp.empresaId !== empresaId) {
            throw new IntegrationWorkflowError(
              `Colaborador "${emp.nomeCompleto}" pertence a outra empresa contratada.`,
              403,
              'EMPLOYEE_COMPANY_MISMATCH'
            );
          }
          resolvedEmployeeIds.push(emp.id);
          candidatos.push({
            candidateId: `emp-existing-${emp.id}`,
            colaboradorId: emp.id,
            nomeCompleto: emp.nomeCompleto,
            cpf: emp.cpf,
            cargo: emp.cargo,
            setor: emp.setor || '',
            telefone: emp.telefone,
            email: emp.email,
            atividadeExecutada: emp.atividadeExecutada,
            atividadesHabilitadasIds:
              rawEmp.atividadesHabilitadasIds && rawEmp.atividadesHabilitadasIds.length > 0
                ? rawEmp.atividadesHabilitadasIds
                : requestedActivityIds,
            jaExistiaNaBase: true,
            aprovadoEmployeeId: emp.id,
          });
        }
        continue;
      }

      const nome = (rawEmp.nomeCompleto || '').trim();
      const cpf = (rawEmp.cpf || '').trim();
      const cargo = (rawEmp.cargo || '').trim();
      const cpfDigits = digitsOnly(cpf);

      if (!nome || cpfDigits.length !== 11 || !cargo) {
        throw new IntegrationWorkflowError(
          'Para cadastrar um colaborador terceirizado informe Nome Completo, CPF válido (11 dígitos) e Cargo/Função.',
          400,
          'INVALID_EMPLOYEE_DATA'
        );
      }

      if (seenCpfs.has(cpfDigits)) {
        throw new IntegrationWorkflowError(
          `CPF ${cpf} duplicado na mesma solicitação de integração.`,
          409,
          'DUPLICATE_EMPLOYEE_CPF_IN_REQUEST'
        );
      }

      const existingEmployeeByCpf = allEmployees.find((e) => digitsOnly(e.cpf) === cpfDigits);
      if (existingEmployeeByCpf) {
        if (empresaId && existingEmployeeByCpf.empresaId !== empresaId) {
          throw new IntegrationWorkflowError(
            `CPF ${cpf} já está vinculado a outra empresa contratada na base oficial. Cadastro duplicado bloqueado.`,
            409,
            'DUPLICATE_EMPLOYEE_CPF_OTHER_COMPANY'
          );
        }
        throw new IntegrationWorkflowError(
          `Colaborador com CPF ${cpf} (${existingEmployeeByCpf.nomeCompleto}) já existe na base. Selecione o colaborador existente em vez de criar um novo registro.`,
          409,
          'DUPLICATE_EMPLOYEE_CPF',
          {
            existingEmployeeId: existingEmployeeByCpf.id,
            existingEmployeeName: existingEmployeeByCpf.nomeCompleto,
          }
        );
      }

      seenCpfs.add(cpfDigits);
      candidatos.push({
        candidateId: `emp-new-${Date.now()}-${newCandIndex++}`,
        nomeCompleto: nome,
        cpf,
        cargo,
        setor: (rawEmp.setor || 'Operacional Terceirizado').trim(),
        telefone: rawEmp.telefone?.trim(),
        email: rawEmp.email?.trim(),
        atividadeExecutada: rawEmp.atividadeExecutada?.trim(),
        atividadesHabilitadasIds:
          rawEmp.atividadesHabilitadasIds && rawEmp.atividadesHabilitadasIds.length > 0
            ? rawEmp.atividadesHabilitadasIds
            : requestedActivityIds,
        jaExistiaNaBase: false,
      });
    }

    const checklistDrafts = await this.buildDynamicChecklistDrafts({
      tipo,
      empresaId,
      empresaNome,
      atividadeIds: requestedActivityIds,
      atividadesSimples: sanitizedSimpleActivities,
      colaboradoresCandidatos: candidatos,
      customItems: input.customItems,
    });

    const now = nowCreation;
    const codigoProtocolo = generateProtocolCode(this.nowProvider());

    const simpleSummarySuffix =
      sanitizedSimpleActivities.length > 0
        ? ` e ${sanitizedSimpleActivities.length} Atividade(s) Simples (${sanitizedSimpleActivities
            .map((s) => s.entry.nome)
            .join(', ')})`
        : '';

    const initialHistory: IntegrationWorkflowHistoryEntry = {
      dataHora: now,
      usuarioId: actor.id,
      usuarioNome: actor.nome,
      usuarioRole: actor.role,
      acao: tipo === 'ATUALIZACAO_DOCUMENTAL' ? 'CRIACAO_ATUALIZACAO_DOCUMENTAL' : 'CRIACAO_INTEGRACAO',
      statusAnterior: null,
      statusNovo: 'RASCUNHO',
      detalhes: `Protocolo ${codigoProtocolo} criado para ${empresaNome} com ${candidatos.length} colaborador(es)${simpleSummarySuffix} e ${checklistDrafts.length} item(ns) no checklist dinâmico.`,
    };

    const integration = await this.repo.createIntegration({
      codigoProtocolo,
      tipo,
      status: 'RASCUNHO',
      empresaId,
      empresaNome,
      empresaCnpj,
      solicitacaoNovaEmpresa,
      empresaPendenteCadastro,
      atividadeIds: requestedActivityIds,
      atividadeNomes,
      ...(sanitizedSimpleActivities.length > 0
        ? { atividadesSimples: sanitizedSimpleActivities.map((s) => s.entry) }
        : {}),
      colaboradorIds: resolvedEmployeeIds,
      colaboradoresCandidatos: candidatos,
      observacoes: input.observacoes?.trim() || '',
      solicitadoPorId: actor.id,
      solicitadoPorNome: actor.nome,
      solicitadoPorEmail: actor.email,
      solicitadoPorRole: actor.role,
      dataCriacao: now,
      dataUltimaAtualizacao: now,
      resumoItens: computeSummaryCounts(
        checklistDrafts.map((d, idx) => ({ ...d, id: `draft-${idx}`, integrationId: '' }))
      ),
      versaoConcorrencia: 1,
      historicoWorkflow: [initialHistory],
      ...(input.isDemo ? { isDemo: true } : {}),
      createdAt: now,
      updatedAt: now,
    });

    // Stamp integrationId onto each created SimpleActivityEntry for full traceability
    if (sanitizedSimpleActivities.length > 0) {
      const linkedSimpleActivities: SimpleActivityEntry[] = sanitizedSimpleActivities.map((s) => ({
        ...s.entry,
        integrationId: integration.id,
      }));
      await this.repo.updateIntegration(integration.id, {
        atividadesSimples: linkedSimpleActivities,
      });
    }

    const createdItems: ContractorIntegrationItem[] = [];
    for (const draft of checklistDrafts) {
      const created = await this.repo.createItem({
        ...draft,
        integrationId: integration.id,
      });
      createdItems.push(created);
    }

    await this.logAudit(
      actor,
      tipo === 'ATUALIZACAO_DOCUMENTAL'
        ? 'Criação de Atualização Documental'
        : 'Criação de Integração de Terceiros',
      integration.id,
      `Protocolo ${codigoProtocolo} criado para ${empresaNome} (${empresaCnpj}) com ${createdItems.length} itens documentais${simpleSummarySuffix}.`
    );

    return this.getIntegrationDetail(actor, integration.id);
  }

  // --------------------------------------------------------------------------
  // UPDATE DRAFT (RASCUNHO / EM_ENVIO / PENDENTE_CORRECAO)
  // --------------------------------------------------------------------------

  async updateIntegrationDraft(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    input: UpdateIntegrationDraftInput
  ): Promise<IntegrationDetailResult> {
    this.assertNotAuditor(actor, 'editar integrações');

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertCompanyScopeAccess(actor, integration);
    this.assertConcurrencyVersion(integration, input.expectedVersion);

    if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
      throw new IntegrationWorkflowError(
        `A integração no status "${integration.status}" não pode ser editada diretamente.`,
        409,
        'INTEGRATION_NOT_EDITABLE'
      );
    }

    const now = this.nowIso();
    const updated = await this.repo.updateIntegration(integration.id, {
      observacoes:
        input.observacoes !== undefined ? input.observacoes.trim() : integration.observacoes,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      versaoConcorrencia: integration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...integration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'ATUALIZACAO_RASCUNHO',
          statusAnterior: integration.status,
          statusNovo: integration.status,
          detalhes: 'Metadados da integração atualizados.',
        },
      ],
    });

    await this.logAudit(
      actor,
      'Atualização de Integração',
      updated.id,
      `Integração ${updated.codigoProtocolo} atualizada por ${actor.nome}.`
    );

    return this.getIntegrationDetail(actor, updated.id);
  }

  // --------------------------------------------------------------------------
  // ATIVIDADE SIMPLES (SECTION 9.1): ADD / UPDATE / ATTACH DOCS / ADMIN REVIEW
  // --------------------------------------------------------------------------

  async addSimpleActivity(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    input: CreateSimpleActivityInput & { expectedVersion?: number }
  ): Promise<
    IntegrationDetailResult & {
      simpleActivity: SimpleActivityEntry;
      createdItems: ContractorIntegrationItem[];
    }
  > {
    this.assertNotAuditor(actor, 'cadastrar atividade simples na integração');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Não é possível adicionar Atividade Simples no status "${integration.status}".`,
          409,
          'INTEGRATION_NOT_EDITABLE'
        );
      }

      const now = this.nowIso();
      const [sanitized] = this.sanitizeSimpleActivitiesInput(
        actor,
        [input],
        integration.empresaId,
        now
      );
      const entry: SimpleActivityEntry = {
        ...sanitized.entry,
        integrationId: integration.id,
      };

      const existingItems = await this.repo.listItemsByIntegration(integration.id);
      const createdItems: ContractorIntegrationItem[] = [];

      if (sanitized.documentos.length > 0) {
        const drafts = await this.buildDynamicChecklistDrafts({
          tipo: 'ATUALIZACAO_DOCUMENTAL',
          empresaId: integration.empresaId,
          empresaNome: integration.empresaNome,
          atividadeIds: [],
          atividadesSimples: [{ entry, documentos: sanitized.documentos }],
          colaboradoresCandidatos: integration.colaboradoresCandidatos || [],
        });

        for (const draft of drafts) {
          const alreadyExists = existingItems.find(
            (ex) =>
              ex.categoria === draft.categoria &&
              (ex.colaboradorId || '') === (draft.colaboradorId || '') &&
              (ex.colaboradorCandidateId || '') === (draft.colaboradorCandidateId || '') &&
              normalizeCanonicalCode(ex.documentoCodigoCanonico) ===
                normalizeCanonicalCode(draft.documentoCodigoCanonico) &&
              ex.origemColecao === draft.origemColecao
          );
          if (alreadyExists) {
            if (!alreadyExists.simpleActivityId) {
              await this.repo.updateItem(alreadyExists.id, {
                simpleActivityId: entry.id,
                simpleActivityNome: entry.nome,
                updatedAt: now,
              });
            }
            continue;
          }
          const created = await this.repo.createItem({
            ...draft,
            integrationId: integration.id,
          });
          createdItems.push(created);
          existingItems.push(created);
        }
      }

      const updatedSimpleList = [...(integration.atividadesSimples || []), entry];
      const summary = computeSummaryCounts(existingItems);

      await this.repo.updateIntegration(integration.id, {
        atividadesSimples: updatedSimpleList,
        resumoItens: summary,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'ADICAO_ATIVIDADE_SIMPLES',
            statusAnterior: integration.status,
            statusNovo: integration.status,
            detalhes: `Atividade Simples "${entry.nome}" vinculada ao protocolo ${integration.codigoProtocolo} com ${createdItems.length} novo(s) requisito(s) documental(is).`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Cadastro de Atividade Simples',
        integration.id,
        `Atividade Simples "${entry.nome}" adicionada ao protocolo ${integration.codigoProtocolo} (${integration.empresaNome}) por ${actor.nome}.`
      );

      const detail = await this.getIntegrationDetail(actor, integration.id);
      return { ...detail, simpleActivity: entry, createdItems };
    });
  }

  async updateSimpleActivity(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    simpleActivityId: string,
    input: UpdateSimpleActivityInput
  ): Promise<IntegrationDetailResult & { simpleActivity: SimpleActivityEntry }> {
    this.assertNotAuditor(actor, 'editar atividade simples na integração');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Não é possível editar Atividade Simples no status "${integration.status}".`,
          409,
          'INTEGRATION_NOT_EDITABLE'
        );
      }

      const currentList = integration.atividadesSimples || [];
      const targetIdx = currentList.findIndex((sa) => sa.id === simpleActivityId);
      if (targetIdx === -1) {
        throw new IntegrationWorkflowError(
          'Atividade Simples não encontrada nesta integração.',
          404,
          'SIMPLE_ACTIVITY_NOT_FOUND'
        );
      }

      const existing = currentList[targetIdx];
      const nextNome =
        input.nome !== undefined ? String(input.nome).trim() : existing.nome;
      const nextDescricao =
        input.descricaoServico !== undefined
          ? String(input.descricaoServico).trim()
          : existing.descricaoServico;
      const nextObservacoes =
        input.observacoes !== undefined
          ? String(input.observacoes).trim() || undefined
          : existing.observacoes;

      if (nextNome.length < 2 || nextNome.length > 160) {
        throw new IntegrationWorkflowError(
          'Informe um nome válido para a Atividade Simples (entre 2 e 160 caracteres).',
          400,
          'INVALID_SIMPLE_ACTIVITY'
        );
      }
      if (nextDescricao.length < 5 || nextDescricao.length > 2000) {
        throw new IntegrationWorkflowError(
          'Descreva o serviço que será executado na Atividade Simples (mínimo de 5 caracteres).',
          400,
          'INVALID_SIMPLE_ACTIVITY'
        );
      }

      const now = this.nowIso();
      // Anti-tampering: Solicitante/edit NEVER self-approves; returns to PENDENTE_ANALISE for Admin EHS review
      const nextStatus: SimpleActivityStatus = 'PENDENTE_ANALISE';
      const updatedEntry: SimpleActivityEntry = {
        ...existing,
        nome: nextNome,
        descricaoServico: nextDescricao,
        observacoes: nextObservacoes,
        status: nextStatus,
        atualizadoEm: now,
        historico: [
          ...(existing.historico || []),
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'ATUALIZACAO_ATIVIDADE_SIMPLES',
            statusAnterior: existing.status,
            statusNovo: nextStatus,
            detalhes: `Atividade Simples "${nextNome}" atualizada por ${actor.nome} e encaminhada para nova conferência do Administrador EHS.`,
          },
        ],
      };

      const nextList = [...currentList];
      nextList[targetIdx] = updatedEntry;

      if (nextNome !== existing.nome) {
        const items = await this.repo.listItemsByIntegration(integration.id);
        for (const it of items) {
          if (it.simpleActivityId === simpleActivityId) {
            await this.repo.updateItem(it.id, {
              simpleActivityNome: nextNome,
              activityNome: `Atividade Simples: ${nextNome}`,
              updatedAt: now,
            });
          }
        }
      }

      await this.repo.updateIntegration(integration.id, {
        atividadesSimples: nextList,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'ATUALIZACAO_ATIVIDADE_SIMPLES',
            statusAnterior: integration.status,
            statusNovo: integration.status,
            detalhes: `Atividade Simples "${nextNome}" atualizada por ${actor.nome}.`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Atualização de Atividade Simples',
        integration.id,
        `Atividade Simples "${nextNome}" atualizada no protocolo ${integration.codigoProtocolo} por ${actor.nome}.`
      );

      const detail = await this.getIntegrationDetail(actor, integration.id);
      return { ...detail, simpleActivity: updatedEntry };
    });
  }

  async addSimpleActivityDocuments(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    simpleActivityId: string,
    input: { documentos: SimpleActivityDocumentInput[]; expectedVersion?: number }
  ): Promise<IntegrationDetailResult & { createdItems: ContractorIntegrationItem[] }> {
    this.assertNotAuditor(actor, 'vincular documentos à atividade simples');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Não é possível adicionar documentos à Atividade Simples no status "${integration.status}".`,
          409,
          'INTEGRATION_NOT_EDITABLE'
        );
      }

      const currentList = integration.atividadesSimples || [];
      const targetIdx = currentList.findIndex((sa) => sa.id === simpleActivityId);
      if (targetIdx === -1) {
        throw new IntegrationWorkflowError(
          'Atividade Simples não encontrada nesta integração.',
          404,
          'SIMPLE_ACTIVITY_NOT_FOUND'
        );
      }

      const rawDocs = Array.isArray(input.documentos) ? input.documentos : [];
      const validDocs = rawDocs
        .filter((d) => String(d?.nomeDocumento || '').trim().length > 0)
        .map((d) => ({
          nomeDocumento: String(d.nomeDocumento).trim().slice(0, 180),
          documentoCodigoCanonico: d.documentoCodigoCanonico
            ? String(d.documentoCodigoCanonico).trim().slice(0, 80)
            : undefined,
          escopo: d.escopo === 'colaborador' ? ('colaborador' as const) : ('empresa' as const),
          colaboradorId: d.colaboradorId ? String(d.colaboradorId).trim() : undefined,
          colaboradorCandidateId: d.colaboradorCandidateId
            ? String(d.colaboradorCandidateId).trim()
            : undefined,
          obrigatorio: d.obrigatorio !== undefined ? Boolean(d.obrigatorio) : true,
          observacoes: d.observacoes ? String(d.observacoes).trim().slice(0, 500) : undefined,
        }));

      if (validDocs.length === 0) {
        throw new IntegrationWorkflowError(
          'Informe ao menos um documento válido para vincular à Atividade Simples.',
          400,
          'INVALID_SIMPLE_ACTIVITY_DOCUMENTS'
        );
      }

      const targetActivity = currentList[targetIdx];
      const now = this.nowIso();
      const existingItems = await this.repo.listItemsByIntegration(integration.id);

      const drafts = await this.buildDynamicChecklistDrafts({
        tipo: 'ATUALIZACAO_DOCUMENTAL',
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        atividadeIds: [],
        atividadesSimples: [{ entry: targetActivity, documentos: validDocs }],
        colaboradoresCandidatos: integration.colaboradoresCandidatos || [],
      });

      const createdItems: ContractorIntegrationItem[] = [];
      for (const draft of drafts) {
        const alreadyExists = existingItems.find(
          (ex) =>
            ex.categoria === draft.categoria &&
            (ex.colaboradorId || '') === (draft.colaboradorId || '') &&
            (ex.colaboradorCandidateId || '') === (draft.colaboradorCandidateId || '') &&
            normalizeCanonicalCode(ex.documentoCodigoCanonico) ===
              normalizeCanonicalCode(draft.documentoCodigoCanonico) &&
            ex.origemColecao === draft.origemColecao
        );
        if (alreadyExists) {
          if (!alreadyExists.simpleActivityId) {
            await this.repo.updateItem(alreadyExists.id, {
              simpleActivityId: targetActivity.id,
              simpleActivityNome: targetActivity.nome,
              updatedAt: now,
            });
          }
          continue;
        }
        const created = await this.repo.createItem({
          ...draft,
          integrationId: integration.id,
        });
        createdItems.push(created);
        existingItems.push(created);
      }

      const nextStatus: SimpleActivityStatus =
        targetActivity.status === 'RECUSADA' ||
        targetActivity.status === 'COMPLEMENTACAO_SOLICITADA'
          ? 'PENDENTE_ANALISE'
          : targetActivity.status;

      const updatedEntry: SimpleActivityEntry = {
        ...targetActivity,
        status: nextStatus,
        atualizadoEm: now,
        historico: [
          ...(targetActivity.historico || []),
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'DOCUMENTO_ADICIONADO',
            statusAnterior: targetActivity.status,
            statusNovo: nextStatus,
            detalhes: `${validDocs.length} documento(s) vinculado(s) à Atividade Simples "${targetActivity.nome}": ${validDocs
              .map((d) => d.nomeDocumento)
              .join(', ')}.`,
          },
        ],
      };

      const nextList = [...currentList];
      nextList[targetIdx] = updatedEntry;

      await this.repo.updateIntegration(integration.id, {
        atividadesSimples: nextList,
        resumoItens: computeSummaryCounts(existingItems),
        dataUltimaAtualizacao: now,
        updatedAt: now,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'DOCUMENTOS_ATIVIDADE_SIMPLES',
            statusAnterior: integration.status,
            statusNovo: integration.status,
            detalhes: `${createdItems.length} novo(s) item(ns) documental(is) vinculado(s) à Atividade Simples "${targetActivity.nome}".`,
          },
        ],
      });

      const detail = await this.getIntegrationDetail(actor, integration.id);
      return { ...detail, createdItems };
    });
  }

  async reviewSimpleActivity(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    simpleActivityId: string,
    input: ReviewSimpleActivityInput
  ): Promise<IntegrationDetailResult & { simpleActivity: SimpleActivityEntry }> {
    // STRICT RBAC: Solicitante and Auditor can NEVER approve, reject, or request complementation on simple activities
    this.assertAdmin(
      actor,
      'analisar, aprovar, recusar ou solicitar complementação em Atividades Simples'
    );

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertSubmittedForAdmin(integration, 'analisar atividade simples');
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      const currentList = integration.atividadesSimples || [];
      const targetIdx = currentList.findIndex((sa) => sa.id === simpleActivityId);
      if (targetIdx === -1) {
        throw new IntegrationWorkflowError(
          'Atividade Simples não encontrada nesta integração.',
          404,
          'SIMPLE_ACTIVITY_NOT_FOUND'
        );
      }

      const decisao = input.decisao;
      if (
        decisao !== 'APROVAR' &&
        decisao !== 'RECUSAR' &&
        decisao !== 'SOLICITAR_COMPLEMENTACAO'
      ) {
        throw new IntegrationWorkflowError(
          'Decisão inválida. Informe APROVAR, RECUSAR ou SOLICITAR_COMPLEMENTACAO.',
          400,
          'INVALID_DECISION'
        );
      }

      const justificativa = String(input.justificativa || '').trim();
      if ((decisao === 'RECUSAR' || decisao === 'SOLICITAR_COMPLEMENTACAO') && justificativa.length < 3) {
        throw new IntegrationWorkflowError(
          decisao === 'RECUSAR'
            ? 'Informe uma justificativa obrigatória para recusar a Atividade Simples.'
            : 'Informe uma justificativa obrigatória descrevendo a complementação solicitada.',
          400,
          'JUSTIFICATION_REQUIRED'
        );
      }

      const existing = currentList[targetIdx];
      const now = this.nowIso();
      const nextStatus: SimpleActivityStatus =
        decisao === 'APROVAR'
          ? 'APROVADA'
          : decisao === 'RECUSAR'
          ? 'RECUSADA'
          : 'COMPLEMENTACAO_SOLICITADA';

      const historyAction: SimpleActivityHistoryEntry['acao'] =
        decisao === 'APROVAR'
          ? 'APROVACAO_ATIVIDADE_SIMPLES'
          : decisao === 'RECUSAR'
          ? 'RECUSA_ATIVIDADE_SIMPLES'
          : 'SOLICITACAO_COMPLEMENTACAO';

      const updatedEntry: SimpleActivityEntry = {
        ...existing,
        status: nextStatus,
        analisadoPorId: actor.id,
        analisadoPorNome: actor.nome,
        dataAnalise: now,
        justificativaAnalise: justificativa || undefined,
        atualizadoEm: now,
        historico: [
          ...(existing.historico || []),
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: historyAction,
            statusAnterior: existing.status,
            statusNovo: nextStatus,
            detalhes:
              decisao === 'APROVAR'
                ? `Atividade Simples "${existing.nome}" APROVADA pelo Administrador EHS ${actor.nome}.`
                : decisao === 'RECUSAR'
                ? `Atividade Simples "${existing.nome}" RECUSADA pelo Administrador EHS ${actor.nome}: ${justificativa}`
                : `Complementação solicitada para Atividade Simples "${existing.nome}" pelo Administrador EHS ${actor.nome}: ${justificativa}`,
            justificativa: justificativa || undefined,
          },
        ],
      };

      const nextList = [...currentList];
      nextList[targetIdx] = updatedEntry;

      let nextIntegrationStatus: IntegrationWorkflowStatus = integration.status;
      if (
        decisao === 'SOLICITAR_COMPLEMENTACAO' &&
        ['ENVIADA', 'AGUARDANDO_ANALISE', 'EM_ANALISE', 'REENVIADA'].includes(integration.status)
      ) {
        nextIntegrationStatus = 'PENDENTE_CORRECAO';
      } else if (
        (decisao === 'APROVAR' || decisao === 'RECUSAR') &&
        ['ENVIADA', 'AGUARDANDO_ANALISE', 'REENVIADA'].includes(integration.status)
      ) {
        nextIntegrationStatus = 'EM_ANALISE';
      }

      await this.repo.updateIntegration(integration.id, {
        status: nextIntegrationStatus,
        atividadesSimples: nextList,
        analisadoPorId: actor.id,
        analisadoPorNome: actor.nome,
        dataAnalise: now,
        ...(decisao === 'SOLICITAR_COMPLEMENTACAO'
          ? {
              motivoReprovacaoOuDevolucao: `Complementação solicitada na Atividade Simples "${existing.nome}": ${justificativa}`,
            }
          : {}),
        dataUltimaAtualizacao: now,
        updatedAt: now,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: historyAction,
            statusAnterior: integration.status,
            statusNovo: nextIntegrationStatus,
            detalhes:
              decisao === 'APROVAR'
                ? `Atividade Simples "${existing.nome}" aprovada por ${actor.nome}.`
                : decisao === 'RECUSAR'
                ? `Atividade Simples "${existing.nome}" recusada por ${actor.nome}.`
                : `Complementação solicitada na Atividade Simples "${existing.nome}" por ${actor.nome} (protocolo devolvido para ajustes).`,
            justificativa: justificativa || undefined,
          },
        ],
      });

      await this.logAudit(
        actor,
        decisao === 'APROVAR'
          ? 'Aprovação de Atividade Simples'
          : decisao === 'RECUSAR'
          ? 'Recusa de Atividade Simples'
          : 'Solicitação de Complementação — Atividade Simples',
        integration.id,
        `Protocolo ${integration.codigoProtocolo} — Atividade Simples "${existing.nome}": ${nextStatus}${justificativa ? ` (${justificativa})` : ''}.`
      );

      await this.emitNotification({
        recipientRole: 'solicitante',
        recipientUserId:
          integration.solicitadoPorRole === 'solicitante'
            ? integration.solicitadoPorId
            : undefined,
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        type:
          decisao === 'APROVAR'
            ? 'INTEGRACAO_APROVADA'
            : decisao === 'RECUSAR'
            ? 'DOCUMENTO_REPROVADO'
            : 'INTEGRACAO_DEVOLVIDA',
        severity: decisao === 'APROVAR' ? 'success' : decisao === 'RECUSAR' ? 'error' : 'warning',
        title:
          decisao === 'APROVAR'
            ? `Atividade Simples aprovada — ${integration.codigoProtocolo}`
            : decisao === 'RECUSAR'
            ? `Atividade Simples recusada — ${integration.codigoProtocolo}`
            : `Complementação solicitada — ${integration.codigoProtocolo}`,
        message:
          decisao === 'APROVAR'
            ? `A Atividade Simples "${existing.nome}" (${integration.empresaNome}) foi aprovada pelo Administrador EHS ${actor.nome}.`
            : decisao === 'RECUSAR'
            ? `A Atividade Simples "${existing.nome}" (${integration.empresaNome}) foi recusada por ${actor.nome}. Motivo: ${justificativa}`
            : `O Administrador EHS ${actor.nome} solicitou complementação para a Atividade Simples "${existing.nome}" (${integration.empresaNome}): ${justificativa}`,
        actionLabel: 'Abrir integração',
        actionTab: 'gestao_integracao',
        integrationId: integration.id,
        companyId: integration.empresaId,
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `sa-review:${integration.id}:${existing.id}:${nextStatus}:${integration.versaoConcorrencia + 1}`,
      });

      const detail = await this.getIntegrationDetail(actor, integration.id);
      return { ...detail, simpleActivity: updatedEntry };
    });
  }

  // --------------------------------------------------------------------------
  // BATCH MULTI-DOCUMENT UPLOAD (PRESERVING APPROVED ITEMS & SMARTDOCS REUSE)
  // --------------------------------------------------------------------------

  private autoMatchBatchFileToItem(
    file: BatchDocumentFileInput,
    items: ContractorIntegrationItem[]
  ): ContractorIntegrationItem | undefined {
    const fileNorm = normalizeMatchText(file.arquivoNome);
    const codeNorm = normalizeCanonicalCode(file.documentoCodigoCanonico);

    // Only auto-match non-approved items strictly within the requested scope & collaborator
    const hasExplicitCollaborator = Boolean(file.colaboradorId || file.colaboradorCandidateId);
    const eligible = items.filter((it) => {
      if (it.status === 'APROVADO') return false;
      if (file.categoria === 'empresa') {
        return it.categoria !== 'colaborador';
      }
      if (file.categoria === 'colaborador' || hasExplicitCollaborator) {
        if (it.categoria !== 'colaborador') return false;
        if (hasExplicitCollaborator) {
          const matchesId = Boolean(file.colaboradorId && it.colaboradorId === file.colaboradorId);
          const matchesCand = Boolean(
            file.colaboradorCandidateId &&
              it.colaboradorCandidateId === file.colaboradorCandidateId
          );
          return matchesId || matchesCand;
        }
      }
      return true;
    });
    if (eligible.length === 0) return undefined;

    // 1. Match by explicit canonical code within the scoped eligible list
    if (codeNorm) {
      const exact = eligible.find(
        (it) => normalizeCanonicalCode(it.documentoCodigoCanonico) === codeNorm
      );
      if (exact) return exact;
    }

    // 2. Match by filename containing canonical code (still strictly scoped to the same collaborator/company)
    for (const it of eligible) {
      const itemCodeNorm = normalizeMatchText(it.documentoCodigoCanonico);
      const itemCompact = itemCodeNorm.replace(/\s+/g, '');
      const fileCompact = fileNorm.replace(/\s+/g, '');
      const codeHit =
        (itemCodeNorm.length >= 2 && fileNorm.includes(itemCodeNorm)) ||
        (itemCompact.length >= 2 && fileCompact.includes(itemCompact));
      if (!codeHit) continue;

      if (it.categoria === 'colaborador' && it.colaboradorNome) {
        // When collaborator was explicitly specified, eligible is already restricted to that collaborator
        if (hasExplicitCollaborator) {
          return it;
        }
        const firstToken = normalizeMatchText(it.colaboradorNome).split(' ')[0];
        if (firstToken && firstToken.length >= 3 && fileNorm.includes(firstToken)) {
          return it;
        }
        const cpfDigits = digitsOnly(it.colaboradorCpf);
        if (cpfDigits && digitsOnly(file.arquivoNome).includes(cpfDigits)) {
          return it;
        }
        // Fallback only when no explicit collaborator was sent and only one employee item matches this code
        const allSameCode = eligible.filter(
          (x) =>
            normalizeCanonicalCode(x.documentoCodigoCanonico) ===
            normalizeCanonicalCode(it.documentoCodigoCanonico)
        );
        if (allSameCode.length === 1) return it;
      } else {
        return it;
      }
    }

    return undefined;
  }

  private async validateAndStoreBinaryFile(params: {
    fileInput: BatchDocumentFileInput;
    integration: ContractorIntegration;
    itemIdHint: string;
    version: number;
  }): Promise<{
    safeFileName: string;
    validated: ReturnType<typeof validateUploadedFile>;
    arquivoId: string;
    storageProvider: NonNullable<IntegrationDocumentVersion['storageProvider']>;
    storageKey: string;
  }> {
    const safeFileName = (params.fileInput.arquivoNome || '').trim();
    const hasBinaryBuffer = Boolean(
      params.fileInput.arquivoBuffer && params.fileInput.arquivoBuffer.length > 0
    );

    let validated: ReturnType<typeof validateUploadedFile>;
    let binaryBuffer: Buffer;

    if (hasBinaryBuffer) {
      binaryBuffer = params.fileInput.arquivoBuffer!;
      if (binaryBuffer.length <= 0) {
        throw new IntegrationWorkflowError(
          `O arquivo "${safeFileName}" está vazio (0 bytes).`,
          400,
          'EMPTY_FILE'
        );
      }
      if (binaryBuffer.length > MAX_UPLOAD_FILE_BYTES) {
        throw new IntegrationWorkflowError(
          `O arquivo "${safeFileName}" excede o tamanho máximo permitido de 4 MB.`,
          413,
          'FILE_TOO_LARGE'
        );
      }
      const realMime = detectRealMimeFromBuffer(binaryBuffer);
      if (!realMime) {
        throw new IntegrationWorkflowError(
          `O conteúdo binário do arquivo "${safeFileName}" não é um PDF, JPG ou PNG íntegro.`,
          400,
          'INVALID_FILE_SIGNATURE'
        );
      }
      const declaredMime = normalizeDeclaredMime(params.fileInput.arquivoMimeType);
      if (declaredMime && declaredMime !== realMime) {
        throw new IntegrationWorkflowError(
          `O conteúdo binário do arquivo "${safeFileName}" não corresponde ao formato declarado (${declaredMime}). Envie um PDF, JPG ou PNG íntegro.`,
          400,
          'INVALID_FILE_SIGNATURE'
        );
      }
      const sha256 = computeBufferSha256(binaryBuffer);
      const base64Data = params.fileInput.runSmartDocsAi ? binaryBuffer.toString('base64') : '';
      validated = {
        mimeType: realMime,
        sizeBytes: binaryBuffer.length,
        sha256,
        base64Data,
        buffer: binaryBuffer,
        cleanDataUrl: '',
      };
    } else {
      try {
        validated = validateUploadedFile({
          fileName: safeFileName,
          mimeType: inferMimeTypeFromFile(safeFileName, params.fileInput.arquivoBase64 || ''),
          dataUrl: params.fileInput.arquivoBase64 || '',
        });
      } catch (err: any) {
        throw new IntegrationWorkflowError(
          err?.message || `Arquivo inválido: ${params.fileInput.arquivoNome}`,
          err?.statusCode || 400,
          err?.code || 'INVALID_FILE'
        );
      }

      binaryBuffer = Buffer.from(validated.base64Data, 'base64');
      if (!validateBinaryMagicBytes(binaryBuffer, validated.mimeType)) {
        throw new IntegrationWorkflowError(
          `O conteúdo binário do arquivo "${safeFileName}" não corresponde ao formato declarado (${validated.mimeType}). Envie um PDF, JPG ou PNG íntegro.`,
          400,
          'INVALID_FILE_SIGNATURE'
        );
      }
    }

    const arquivoId = crypto.randomUUID();
    const storageKey = buildSafeStorageKey({
      empresaId: params.integration.empresaId || params.integration.empresaCnpj,
      integrationId: params.integration.id,
      itemId: params.itemIdHint,
      version: params.version,
      arquivoId,
      mimeType: validated.mimeType,
    });

    try {
      const stored = await this.fileStorage.putObject({
        storageKey,
        buffer: binaryBuffer,
        mimeType: validated.mimeType,
        sha256: validated.sha256,
      });
      return {
        safeFileName,
        validated,
        arquivoId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
      };
    } catch (err: any) {
      if (err instanceof IntegrationStorageUnavailableError) {
        throw new IntegrationWorkflowError(err.message, err.status, err.code);
      }
      throw new IntegrationWorkflowError(
        err?.message || 'Falha ao persistir o arquivo no armazenamento privado.',
        500,
        'FILE_STORAGE_WRITE_FAILED'
      );
    }
  }

  private async upsertUploadedFileOnItems(params: {
    actor: IntegrationWorkflowActor;
    integration: ContractorIntegration;
    existingItems: ContractorIntegrationItem[];
    fileInput: BatchDocumentFileInput;
    now: string;
  }): Promise<{
    savedItem: ContractorIntegrationItem;
    arquivoId: string;
    safeFileName: string;
    validated: ReturnType<typeof validateUploadedFile>;
    versao: number;
  }> {
    const { actor, integration, existingItems, fileInput, now } = params;

    let targetItem: ContractorIntegrationItem | undefined;
    if (fileInput.itemId) {
      targetItem = existingItems.find((i) => i.id === fileInput.itemId);
      if (!targetItem) {
        throw new IntegrationWorkflowError(
          `Item documental "${fileInput.itemId}" não pertence a esta integração.`,
          404,
          'ITEM_NOT_FOUND'
        );
      }
      if (
        targetItem.categoria === 'colaborador' &&
        (fileInput.colaboradorId || fileInput.colaboradorCandidateId)
      ) {
        const matchesId = Boolean(
          fileInput.colaboradorId && targetItem.colaboradorId === fileInput.colaboradorId
        );
        const matchesCand = Boolean(
          fileInput.colaboradorCandidateId &&
            targetItem.colaboradorCandidateId === fileInput.colaboradorCandidateId
        );
        if (!matchesId && !matchesCand) {
          throw new IntegrationWorkflowError(
            `O item documental "${targetItem.nomeExibicao}" pertence a outro colaborador e não pode receber arquivo cruzado.`,
            409,
            'ITEM_COLLABORATOR_MISMATCH'
          );
        }
      }
      if (targetItem.status === 'APROVADO') {
        throw new IntegrationWorkflowError(
          `O documento "${targetItem.nomeExibicao}" já está APROVADO e não pode ser sobrescrito diretamente. Utilize a função de Atualização/Renovação Documental para enviar nova versão.`,
          409,
          'ITEM_ALREADY_APPROVED_USE_RENEWAL'
        );
      }
    } else {
      // Strictly validate that any explicitly supplied collaborator belongs to this integration
      if (fileInput.colaboradorId || fileInput.colaboradorCandidateId) {
        const belongsToIntegration =
          (integration.colaboradoresCandidatos || []).some(
            (c) =>
              (fileInput.colaboradorId &&
                (c.colaboradorId === fileInput.colaboradorId ||
                  c.aprovadoEmployeeId === fileInput.colaboradorId)) ||
              (fileInput.colaboradorCandidateId && c.candidateId === fileInput.colaboradorCandidateId)
          ) ||
          Boolean(
            fileInput.colaboradorId &&
              (integration.colaboradorIds || []).includes(fileInput.colaboradorId)
          );
        if (!belongsToIntegration) {
          throw new IntegrationWorkflowError(
            'O colaborador informado não pertence a este processo de integração. Vinculação cruzada bloqueada.',
            403,
            'COLLABORATOR_NOT_IN_INTEGRATION'
          );
        }
      }
      targetItem = this.autoMatchBatchFileToItem(fileInput, existingItems);
    }

    const nextVersionNum = targetItem ? (targetItem.versaoAtual || 0) + 1 : 1;
    const itemIdHint = targetItem?.id || `new_${crypto.randomBytes(4).toString('hex')}`;

    const stored = await this.validateAndStoreBinaryFile({
      fileInput,
      integration,
      itemIdHint,
      version: nextVersionNum,
    });

    let smartDocsSugestao: IntegrationSmartDocsSuggestion | undefined;
    if (fileInput.runSmartDocsAi) {
      const suggestion = await this.smartDocsSuggestionRunner({
        arquivoNome: stored.safeFileName,
        mimeType: stored.validated.mimeType,
        base64Data: stored.validated.base64Data,
        expectedCode: targetItem?.documentoCodigoCanonico || fileInput.documentoCodigoCanonico,
        expectedLabel: targetItem?.nomeExibicao || fileInput.nomeExibicao,
      });
      if (suggestion) {
        smartDocsSugestao = suggestion;
      }
    }

    const resolvedEmissao =
      normalizeIsoDate(fileInput.dataEmissao) ||
      normalizeIsoDate(smartDocsSugestao?.dataEmissaoSugerida) ||
      '';
    const resolvedValidade = fileInput.semValidade
      ? ''
      : normalizeIsoDate(fileInput.dataValidade) ||
        normalizeIsoDate(smartDocsSugestao?.dataValidadeSugerida) ||
        '';
    const resolvedConclusaoAso: ConclusaoAptidao | undefined =
      fileInput.conclusaoAso ||
      (smartDocsSugestao?.resultadoAptidaoSugerido
        ? (smartDocsSugestao.resultadoAptidaoSugerido as ConclusaoAptidao)
        : undefined);

    if (!targetItem) {
      const cand = integration.colaboradoresCandidatos.find(
        (c) =>
          (fileInput.colaboradorId &&
            (c.colaboradorId === fileInput.colaboradorId ||
              c.aprovadoEmployeeId === fileInput.colaboradorId)) ||
          (fileInput.colaboradorCandidateId && c.candidateId === fileInput.colaboradorCandidateId)
      );
      const inferredCode =
        fileInput.documentoCodigoCanonico ||
        smartDocsSugestao?.tipoDocumentoSugerido ||
        'OUTROS_DOC_LEGAIS';
      const inferredName =
        fileInput.nomeExibicao ||
        smartDocsSugestao?.nomeDocumentoSugerido ||
        stored.safeFileName;
      const inferredOrigin: IntegrationOfficialCollection =
        fileInput.origemColecao ||
        (inferredCode.toUpperCase().includes('ASO') ||
        inferredCode.toUpperCase().includes('APTIDAO')
          ? 'exams'
          : inferredCode.toUpperCase().includes('EPI')
          ? 'epiDeliveries'
          : inferredCode.toUpperCase().startsWith('NR-') ||
            inferredCode.toUpperCase().includes('TREINAMENTO')
          ? 'trainings'
          : 'documents');
      const resolvedCategoria: IntegrationItemCategory =
        fileInput.categoria || (cand ? 'colaborador' : 'empresa');
      const resolvedGroup =
        resolvedCategoria === 'colaborador'
          ? classifyIntegrationDocumentGroup({
              categoriaOrganizacional: fileInput.categoriaOrganizacional,
              documentoCodigoCanonico: inferredCode,
              nomeExibicao: inferredName,
              origemColecao: inferredOrigin,
            })
          : undefined;

      const version1: IntegrationDocumentVersion = {
        versao: 1,
        arquivoId: stored.arquivoId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        hasStoredFile: true,
        arquivoNome: stored.safeFileName,
        arquivoMimeType: stored.validated.mimeType,
        arquivoTamanhoBytes: stored.validated.sizeBytes,
        arquivoHashSha256: stored.validated.sha256,
        arquivoUrl: '',
        dataEmissao: resolvedEmissao || undefined,
        dataValidade: resolvedValidade || undefined,
        semValidade: Boolean(fileInput.semValidade),
        numeroDocumento: fileInput.numeroDocumento?.trim() || undefined,
        conclusaoAso: resolvedConclusaoAso,
        aptidoesEspecificas: fileInput.aptidoesEspecificas,
        observacoes: fileInput.observacoes?.trim() || undefined,
        enviadoPorId: actor.id,
        enviadoPorNome: actor.nome,
        enviadoEm: now,
        status: 'ENVIADO',
        smartDocsSugestao,
      };

      const createdItem = await this.repo.createItem({
        integrationId: integration.id,
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        colaboradorId: cand?.colaboradorId || fileInput.colaboradorId,
        colaboradorCandidateId: cand?.candidateId || fileInput.colaboradorCandidateId,
        colaboradorNome: cand?.nomeCompleto,
        colaboradorCpf: cand?.cpf,
        colaboradorCargo: cand?.cargo,
        categoria: resolvedCategoria,
        categoriaOrganizacional: resolvedGroup,
        documentoCodigoCanonico: inferredCode,
        nomeExibicao: inferredName,
        origemColecao: inferredOrigin,
        obrigatorio: Boolean(fileInput.obrigatorio),
        status: 'ENVIADO',
        versaoAtual: 1,
        versoes: [version1],
        arquivoId: stored.arquivoId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        hasStoredFile: true,
        arquivoNome: stored.safeFileName,
        arquivoMimeType: stored.validated.mimeType,
        arquivoTamanhoBytes: stored.validated.sizeBytes,
        arquivoHashSha256: stored.validated.sha256,
        arquivoUrl: '',
        dataEmissao: resolvedEmissao || undefined,
        dataValidade: resolvedValidade || undefined,
        semValidade: Boolean(fileInput.semValidade),
        numeroDocumento: fileInput.numeroDocumento?.trim() || undefined,
        conclusaoAso: resolvedConclusaoAso,
        aptidoesEspecificas: fileInput.aptidoesEspecificas,
        observacoes: fileInput.observacoes?.trim() || undefined,
        smartDocsSugestao,
        enviadoPorId: actor.id,
        enviadoPorNome: actor.nome,
        dataEnvio: now,
        createdAt: now,
        updatedAt: now,
      });
      existingItems.push(createdItem);
      return {
        savedItem: createdItem,
        arquivoId: stored.arquivoId,
        safeFileName: stored.safeFileName,
        validated: stored.validated,
        versao: 1,
      };
    }

    const updatedPreviousVersions: IntegrationDocumentVersion[] = (targetItem.versoes || []).map((v) =>
      v.status === 'ENVIADO' || v.status === 'EM_ANALISE'
        ? { ...v, status: 'SUBSTITUIDO' }
        : v
    );

    const newVersion: IntegrationDocumentVersion = {
      versao: nextVersionNum,
      arquivoId: stored.arquivoId,
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      hasStoredFile: true,
      arquivoNome: stored.safeFileName,
      arquivoMimeType: stored.validated.mimeType,
      arquivoTamanhoBytes: stored.validated.sizeBytes,
      arquivoHashSha256: stored.validated.sha256,
      arquivoUrl: '',
      dataEmissao: resolvedEmissao || targetItem.dataEmissao,
      dataValidade: fileInput.semValidade ? '' : resolvedValidade || targetItem.dataValidade,
      semValidade: fileInput.semValidade ?? targetItem.semValidade,
      numeroDocumento: fileInput.numeroDocumento?.trim() || targetItem.numeroDocumento,
      conclusaoAso: resolvedConclusaoAso || targetItem.conclusaoAso,
      aptidoesEspecificas: fileInput.aptidoesEspecificas || targetItem.aptidoesEspecificas,
      observacoes: fileInput.observacoes?.trim() || targetItem.observacoes,
      enviadoPorId: actor.id,
      enviadoPorNome: actor.nome,
      enviadoEm: now,
      status: 'ENVIADO',
      smartDocsSugestao,
    };

    const resolvedGroup =
      targetItem.categoria === 'colaborador'
        ? classifyIntegrationDocumentGroup({
            categoriaOrganizacional:
              fileInput.categoriaOrganizacional || targetItem.categoriaOrganizacional,
            documentoCodigoCanonico: targetItem.documentoCodigoCanonico,
            nomeExibicao: targetItem.nomeExibicao,
            origemColecao: targetItem.origemColecao,
          })
        : targetItem.categoriaOrganizacional;

    const savedItem = await this.repo.updateItem(targetItem.id, {
      status: 'ENVIADO',
      reaproveitado: false,
      situacaoDocumentoExistente: undefined,
      documentoExistenteAviso: undefined,
      categoriaOrganizacional: resolvedGroup,
      versaoAtual: nextVersionNum,
      versoes: [...updatedPreviousVersions, newVersion],
      arquivoId: stored.arquivoId,
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      hasStoredFile: true,
      arquivoNome: stored.safeFileName,
      arquivoMimeType: stored.validated.mimeType,
      arquivoTamanhoBytes: stored.validated.sizeBytes,
      arquivoHashSha256: stored.validated.sha256,
      arquivoUrl: '',
      dataEmissao: newVersion.dataEmissao,
      dataValidade: newVersion.dataValidade,
      semValidade: newVersion.semValidade,
      numeroDocumento: newVersion.numeroDocumento,
      conclusaoAso: newVersion.conclusaoAso,
      aptidoesEspecificas: newVersion.aptidoesEspecificas,
      observacoes: newVersion.observacoes,
      smartDocsSugestao,
      motivoReprovacao: '',
      enviadoPorId: actor.id,
      enviadoPorNome: actor.nome,
      dataEnvio: now,
      updatedAt: now,
    });

    const idx = existingItems.findIndex((x) => x.id === savedItem.id);
    if (idx >= 0) existingItems[idx] = savedItem;

    return {
      savedItem,
      arquivoId: stored.arquivoId,
      safeFileName: stored.safeFileName,
      validated: stored.validated,
      versao: nextVersionNum,
    };
  }

  // --------------------------------------------------------------------------
  // QUEUED SINGLE-FILE UPLOAD (1 FILE PER HTTP REQUEST — SAFE FOR LARGE BATCHES)
  // --------------------------------------------------------------------------

  async uploadSingleDocument(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    fileInput: BatchDocumentFileInput
  ): Promise<UploadSingleDocumentResult> {
    this.assertNotAuditor(actor, 'enviar documentos na Central de Integração');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Não é possível enviar novos arquivos no status "${integration.status}". Utilize a renovação documental ou aguarde análise do Admin EHS.`,
          409,
          'UPLOAD_NOT_ALLOWED_IN_STATUS'
        );
      }

      const hasBinary = Boolean(fileInput?.arquivoBuffer && fileInput.arquivoBuffer.length > 0);
      const hasBase64 = Boolean(fileInput?.arquivoBase64 && String(fileInput.arquivoBase64).trim());
      if (!fileInput || !fileInput.arquivoNome || (!hasBinary && !hasBase64)) {
        throw new IntegrationWorkflowError(
          'Arquivo ausente. Envie um arquivo binário (PDF, JPG ou PNG) válido para anexar ao documento.',
          400,
          'MISSING_FILE_PAYLOAD'
        );
      }

      const existingItems = await this.repo.listItemsByIntegration(integration.id);
      const now = this.nowIso();

      const uploaded = await this.upsertUploadedFileOnItems({
        actor,
        integration,
        existingItems,
        fileInput,
        now,
      });

      const summary = computeSummaryCounts(existingItems);
      const readiness = await this.evaluateSubmissionReadiness(integration, existingItems);
      let nextStatus: IntegrationWorkflowStatus = integration.status;
      const isCorrectionCycle =
        integration.status === 'PENDENTE_CORRECAO' || integration.status === 'REPROVADA';
      if (!isCorrectionCycle) {
        nextStatus = readiness.podeSubmeter ? 'EM_ENVIO' : 'PENDENTE_DOCUMENTACAO';
      }

      const updatedPendingCorrections = isCorrectionCycle
        ? this.buildPendingCorrectionItems(existingItems)
        : integration.itensPendentesCorrecao;

      // If this uploaded document belongs to a Simple Activity that was RECUSADA or COMPLEMENTACAO_SOLICITADA,
      // automatically move that Simple Activity back to PENDENTE_ANALISE for Admin EHS re-review.
      let updatedSimpleActivities: SimpleActivityEntry[] | undefined;
      if (uploaded.savedItem.simpleActivityId && Array.isArray(integration.atividadesSimples)) {
        let changed = false;
        updatedSimpleActivities = integration.atividadesSimples.map((sa) => {
          if (
            sa.id === uploaded.savedItem.simpleActivityId &&
            (sa.status === 'RECUSADA' || sa.status === 'COMPLEMENTACAO_SOLICITADA')
          ) {
            changed = true;
            return {
              ...sa,
              status: 'PENDENTE_ANALISE' as SimpleActivityStatus,
              atualizadoEm: now,
              historico: [
                ...(sa.historico || []),
                {
                  dataHora: now,
                  usuarioId: actor.id,
                  usuarioNome: actor.nome,
                  usuarioRole: actor.role,
                  acao: 'DOCUMENTO_ADICIONADO' as const,
                  statusAnterior: sa.status,
                  statusNovo: 'PENDENTE_ANALISE' as SimpleActivityStatus,
                  detalhes: `Documento "${uploaded.savedItem.nomeExibicao}" (v${uploaded.versao}) enviado por ${actor.nome}; Atividade Simples encaminhada para nova análise.`,
                },
              ],
            };
          }
          return sa;
        });
        if (!changed) updatedSimpleActivities = undefined;
      }

      const updatedIntegration = await this.repo.updateIntegration(integration.id, {
        status: nextStatus,
        ...(updatedSimpleActivities ? { atividadesSimples: updatedSimpleActivities } : {}),
        itensPendentesCorrecao: updatedPendingCorrections,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        resumoItens: summary,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'ENVIO_DOCUMENTO_ITEM',
            statusAnterior: integration.status,
            statusNovo: nextStatus,
            itemId: uploaded.savedItem.id,
            detalhes: `Documento "${uploaded.savedItem.nomeExibicao}" (${uploaded.safeFileName}, v${uploaded.versao}) anexado por ${actor.nome}.`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Envio de Documento — Central de Integração',
        updatedIntegration.id,
        `Documento "${uploaded.savedItem.nomeExibicao}" (${uploaded.safeFileName}, v${uploaded.versao}) enviado no protocolo ${updatedIntegration.codigoProtocolo}.`
      );

      if (isCorrectionCycle) {
        await this.emitNotification({
          recipientRole: 'admin',
          empresaId: updatedIntegration.empresaId,
          empresaNome: updatedIntegration.empresaNome,
          type: 'DOCUMENTO_CORRIGIDO',
          severity: 'info',
          title: `Documento corrigido — ${updatedIntegration.codigoProtocolo}`,
          message: `${actor.nome} enviou a versão v${uploaded.versao} do documento "${uploaded.savedItem.nomeExibicao}" (${updatedIntegration.empresaNome}) para nova verificação.`,
          actionTab: 'gestao_integracoes',
          actionLabel: 'Verificar correção',
          integrationId: updatedIntegration.id,
          documentId: uploaded.savedItem.id,
          createdById: actor.id,
          createdByNome: actor.nome,
          createdByRole: actor.role,
          idempotencyKey: `doc-corrigido:${updatedIntegration.id}:${uploaded.savedItem.id}:v${uploaded.versao}`,
        });
      }

      const detail = await this.getIntegrationDetail(actor, updatedIntegration.id);
      const sanitizedItem =
        detail.items.find((i) => i.id === uploaded.savedItem.id) ||
        stripLargeFileUrlFromItem(uploaded.savedItem);

      return {
        ...detail,
        item: sanitizedItem,
        uploadedFile: {
          arquivoId: uploaded.arquivoId,
          arquivoNome: uploaded.safeFileName,
          arquivoMimeType: uploaded.validated.mimeType,
          arquivoTamanhoBytes: uploaded.validated.sizeBytes,
          arquivoHashSha256: uploaded.validated.sha256,
          versao: uploaded.versao,
        },
      };
    });
  }

  async uploadBatchDocuments(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    input: UploadBatchDocumentsInput
  ): Promise<IntegrationDetailResult & { uploadedCount: number }> {
    this.assertNotAuditor(actor, 'enviar documentos na Central de Integração');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Não é possível enviar novos arquivos no status "${integration.status}". Utilize a renovação documental ou aguarde análise do Admin EHS.`,
          409,
          'UPLOAD_NOT_ALLOWED_IN_STATUS'
        );
      }

      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new IntegrationWorkflowError(
          'Selecione ao menos um arquivo (PDF, JPG ou PNG) para envio em lote.',
          400,
          'EMPTY_BATCH_UPLOAD'
        );
      }

      const existingItems = await this.repo.listItemsByIntegration(integration.id);
      const now = this.nowIso();
      let uploadedCount = 0;

      for (const fileInput of input.files) {
        await this.upsertUploadedFileOnItems({
          actor,
          integration,
          existingItems,
          fileInput,
          now,
        });
        uploadedCount += 1;
      }

      const summary = computeSummaryCounts(existingItems);
      const readiness = await this.evaluateSubmissionReadiness(integration, existingItems);

      // Regra obrigatória #3, #5 e #6: autoSubmit em lote jamais pode burlar completude obrigatória
      if (input.autoSubmit && !readiness.podeSubmeter) {
        const holdStatus: IntegrationWorkflowStatus =
          integration.status === 'PENDENTE_CORRECAO'
            ? 'PENDENTE_CORRECAO'
            : 'PENDENTE_DOCUMENTACAO';
        const remainingCorrections =
          holdStatus === 'PENDENTE_CORRECAO'
            ? this.buildPendingCorrectionItems(existingItems)
            : integration.itensPendentesCorrecao;

        await this.repo.updateIntegration(integration.id, {
          status: holdStatus,
          itensPendentesCorrecao: remainingCorrections,
          dataUltimaAtualizacao: now,
          updatedAt: now,
          resumoItens: summary,
          versaoConcorrencia: integration.versaoConcorrencia + 1,
          historicoWorkflow: [
            ...integration.historicoWorkflow,
            {
              dataHora: now,
              usuarioId: actor.id,
              usuarioNome: actor.nome,
              usuarioRole: actor.role,
              acao: 'ENVIO_DOCUMENTOS_LOTE_PARCIAL',
              statusAnterior: integration.status,
              statusNovo: holdStatus,
              detalhes: `${uploadedCount} documento(s) anexado(s) e preservado(s), mas a submissão foi bloqueada pois ainda existem ${readiness.obrigatoriosPendentes} documento(s) obrigatório(s) pendente(s).`,
            },
          ],
        });

        throw new IntegrationWorkflowError(
          readiness.resumoBloqueio ||
            'Submissão bloqueada: anexe todos os documentos obrigatórios antes de enviar para aprovação do Admin EHS.',
          422,
          'MANDATORY_DOCUMENTS_INCOMPLETE',
          {
            submissionReadiness: readiness,
            pendenciasObrigatorias: readiness.pendenciasObrigatorias,
            uploadedCount,
          }
        );
      }

      let nextStatus: IntegrationWorkflowStatus = integration.status;
      const isCorrectionCycle =
        integration.status === 'PENDENTE_CORRECAO' || integration.status === 'REPROVADA';
      if (input.autoSubmit) {
        nextStatus = isCorrectionCycle ? 'REENVIADA' : 'AGUARDANDO_ANALISE';
      } else if (!isCorrectionCycle) {
        nextStatus = readiness.podeSubmeter ? 'EM_ENVIO' : 'PENDENTE_DOCUMENTACAO';
      }

      const updatedIntegration = await this.repo.updateIntegration(integration.id, {
        status: nextStatus,
        dataEnvio: input.autoSubmit ? now : integration.dataEnvio,
        itensPendentesCorrecao: input.autoSubmit
          ? []
          : isCorrectionCycle
          ? this.buildPendingCorrectionItems(existingItems)
          : integration.itensPendentesCorrecao,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        resumoItens: summary,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: input.autoSubmit ? 'ENVIO_LOTE_E_SUBMISSAO' : 'ENVIO_DOCUMENTOS_LOTE',
            statusAnterior: integration.status,
            statusNovo: nextStatus,
            detalhes: `${uploadedCount} documento(s) anexado(s) em lote por ${actor.nome}.`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Envio em Lote — Central de Integração',
        updatedIntegration.id,
        `${uploadedCount} documento(s) anexado(s) no protocolo ${updatedIntegration.codigoProtocolo} (status: ${nextStatus}).`
      );

      const detail = await this.getIntegrationDetail(actor, updatedIntegration.id);
      return { ...detail, uploadedCount };
    });
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATED FILE RETRIEVAL (CURRENT OR HISTORICAL VERSION)
  // --------------------------------------------------------------------------

  async getDocumentFile(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    itemId: string,
    requestedVersion?: number
  ): Promise<RetrievedIntegrationDocumentFile> {
    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertCompanyScopeAccess(actor, integration);
    if (actor.role === 'admin') {
      this.assertSubmittedForAdmin(integration, 'acessar arquivo de cadastro não submetido');
    }

    const item = await this.repo.getItemById(itemId);
    if (!item || item.integrationId !== integration.id) {
      throw new IntegrationWorkflowError(
        'Item documental não encontrado nesta integração.',
        404,
        'ITEM_NOT_FOUND'
      );
    }

    const versions = item.versoes || [];
    let targetVersion: IntegrationDocumentVersion | undefined;
    if (typeof requestedVersion === 'number' && Number.isFinite(requestedVersion)) {
      targetVersion = versions.find((v) => v.versao === requestedVersion);
      if (!targetVersion) {
        throw new IntegrationWorkflowError(
          `Versão v${requestedVersion} não encontrada para o documento "${item.nomeExibicao}".`,
          404,
          'DOCUMENT_VERSION_NOT_FOUND'
        );
      }
    } else if (versions.length > 0) {
      targetVersion =
        versions.find((v) => v.versao === item.versaoAtual) || versions[versions.length - 1];
    }

    const storageKey = targetVersion?.storageKey || item.storageKey;
    const legacyInlineUrl = targetVersion?.arquivoUrl || item.arquivoUrl;
    const fileName = targetVersion?.arquivoNome || item.arquivoNome || 'documento.pdf';
    const mimeType = targetVersion?.arquivoMimeType || item.arquivoMimeType || 'application/pdf';
    const sha256 = targetVersion?.arquivoHashSha256 || item.arquivoHashSha256 || '';
    const versionNum = targetVersion?.versao || item.versaoAtual || 1;
    const arquivoId = targetVersion?.arquivoId || item.arquivoId;

    if (storageKey) {
      try {
        const stored = await this.fileStorage.getObject(storageKey, {
          expectedSha256: sha256 || undefined,
        });
        if (!stored) {
          throw new IntegrationWorkflowError(
            `Arquivo "${fileName}" (v${versionNum}) não localizado no armazenamento privado.`,
            404,
            'STORED_FILE_NOT_FOUND'
          );
        }
        const computedSha256 = computeBufferSha256(stored.buffer);
        if (sha256 && computedSha256 !== sha256) {
          throw new IntegrationWorkflowError(
            `Falha de integridade SHA-256 ao recuperar o documento "${fileName}" (v${versionNum}). O arquivo armazenado não corresponde ao hash original.`,
            500,
            'FILE_INTEGRITY_MISMATCH'
          );
        }
        return {
          buffer: stored.buffer,
          mimeType,
          fileName,
          sizeBytes: stored.sizeBytes,
          sha256: sha256 || computedSha256,
          version: versionNum,
          arquivoId,
        };
      } catch (err: any) {
        if (err instanceof IntegrationWorkflowError) throw err;
        if (err instanceof IntegrationFileIntegrityError) {
          throw new IntegrationWorkflowError(err.message, 500, err.code);
        }
        if (err instanceof IntegrationStorageUnavailableError) {
          throw new IntegrationWorkflowError(err.message, err.status, err.code);
        }
        throw new IntegrationWorkflowError(
          err?.message || 'Erro ao ler o arquivo no armazenamento privado.',
          500,
          'FILE_STORAGE_READ_FAILED'
        );
      }
    }

    // Graceful read-only fallback for legacy records created before external private storage
    if (typeof legacyInlineUrl === 'string' && legacyInlineUrl.startsWith('data:')) {
      const commaIdx = legacyInlineUrl.indexOf(',');
      if (commaIdx > 0) {
        const base64 = legacyInlineUrl.slice(commaIdx + 1);
        const buffer = Buffer.from(base64, 'base64');
        return {
          buffer,
          mimeType,
          fileName,
          sizeBytes: buffer.length,
          sha256,
          version: versionNum,
          arquivoId,
        };
      }
    }

    throw new IntegrationWorkflowError(
      `O arquivo "${fileName}" (v${versionNum}) não possui binário armazenado para visualização ou download.`,
      404,
      'STORED_FILE_NOT_FOUND'
    );
  }

  // --------------------------------------------------------------------------
  // DOCUMENT UPDATE / RENEWAL ON AN EXISTING ITEM (PRESERVES OLD VERSION & OFFICIAL RECORD UNTIL ADMIN APPROVAL)
  // --------------------------------------------------------------------------

  async renewIntegrationItem(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    itemId: string,
    fileInput: BatchDocumentFileInput
  ): Promise<IntegrationDetailResult> {
    this.assertNotAuditor(actor, 'enviar atualização documental');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);

      if (integration.status === 'ENCERRADA') {
        throw new IntegrationWorkflowError(
          'Integrações encerradas não aceitam envio de novas versões. Abra uma nova Atualização Documental.',
          409,
          'INTEGRATION_CLOSED'
        );
      }

      if (UNSUBMITTED_INTEGRATION_STATUSES.has(integration.status)) {
        throw new IntegrationWorkflowError(
          'Este cadastro ainda não foi submetido. Utilize o envio normal de documentos e finalize o cadastro completo antes de renovar itens.',
          409,
          'INTEGRATION_NOT_SUBMITTED'
        );
      }

      const item = await this.repo.getItemById(itemId);
      if (!item || item.integrationId !== integration.id) {
        throw new IntegrationWorkflowError('Item documental não encontrado nesta integração.', 404, 'ITEM_NOT_FOUND');
      }

      const now = this.nowIso();
      const nextVersionNum = (item.versaoAtual || 0) + 1;

      const stored = await this.validateAndStoreBinaryFile({
        fileInput,
        integration,
        itemIdHint: item.id,
        version: nextVersionNum,
      });

      let smartDocsSugestao: IntegrationSmartDocsSuggestion | undefined;
      if (fileInput.runSmartDocsAi) {
        const suggestion = await this.smartDocsSuggestionRunner({
          arquivoNome: stored.safeFileName,
          mimeType: stored.validated.mimeType,
          base64Data: stored.validated.base64Data,
          expectedCode: item.documentoCodigoCanonico,
          expectedLabel: item.nomeExibicao,
        });
        if (suggestion) smartDocsSugestao = suggestion;
      }

      const resolvedEmissao =
        normalizeIsoDate(fileInput.dataEmissao) ||
        normalizeIsoDate(smartDocsSugestao?.dataEmissaoSugerida) ||
        '';
      const resolvedValidade = fileInput.semValidade
        ? ''
        : normalizeIsoDate(fileInput.dataValidade) ||
          normalizeIsoDate(smartDocsSugestao?.dataValidadeSugerida) ||
          '';

      // CRITICAL: Keep prior approved version intact in versoes[] and DO NOT touch official collections yet!
      const newVersion: IntegrationDocumentVersion = {
        versao: nextVersionNum,
        arquivoId: stored.arquivoId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        hasStoredFile: true,
        arquivoNome: stored.safeFileName,
        arquivoMimeType: stored.validated.mimeType,
        arquivoTamanhoBytes: stored.validated.sizeBytes,
        arquivoHashSha256: stored.validated.sha256,
        arquivoUrl: '',
        dataEmissao: resolvedEmissao || undefined,
        dataValidade: resolvedValidade || undefined,
        semValidade: Boolean(fileInput.semValidade),
        numeroDocumento: fileInput.numeroDocumento?.trim() || undefined,
        conclusaoAso: fileInput.conclusaoAso || item.conclusaoAso,
        aptidoesEspecificas: fileInput.aptidoesEspecificas || item.aptidoesEspecificas,
        observacoes: fileInput.observacoes?.trim() || 'Nova versão enviada para renovação/atualização documental.',
        enviadoPorId: actor.id,
        enviadoPorNome: actor.nome,
        enviadoEm: now,
        status: 'ENVIADO',
        smartDocsSugestao,
      };

      await this.repo.updateItem(item.id, {
        status: 'ENVIADO',
        versaoAtual: nextVersionNum,
        versoes: [...(item.versoes || []), newVersion],
        arquivoId: stored.arquivoId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        hasStoredFile: true,
        arquivoNome: stored.safeFileName,
        arquivoMimeType: stored.validated.mimeType,
        arquivoTamanhoBytes: stored.validated.sizeBytes,
        arquivoHashSha256: stored.validated.sha256,
        arquivoUrl: '',
        dataEmissao: newVersion.dataEmissao,
        dataValidade: newVersion.dataValidade,
        semValidade: newVersion.semValidade,
        numeroDocumento: newVersion.numeroDocumento,
        conclusaoAso: newVersion.conclusaoAso,
        aptidoesEspecificas: newVersion.aptidoesEspecificas,
        observacoes: newVersion.observacoes,
        smartDocsSugestao,
        motivoReprovacao: '',
        enviadoPorId: actor.id,
        enviadoPorNome: actor.nome,
        dataEnvio: now,
        updatedAt: now,
      });

      const allItems = await this.repo.listItemsByIntegration(integration.id);
      const summary = computeSummaryCounts(allItems);
      const nextStatus: IntegrationWorkflowStatus = 'REENVIADA';

      await this.repo.updateIntegration(integration.id, {
        status: nextStatus,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        resumoItens: summary,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'RENOVACAO_DOCUMENTAL_NOVA_VERSAO',
            statusAnterior: integration.status,
            statusNovo: nextStatus,
            itemId: item.id,
            detalhes: `Nova versão v${nextVersionNum} enviada para "${item.nomeExibicao}" (${stored.safeFileName}). Versão anterior preservada no histórico até aprovação humana do Admin EHS.`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Renovação Documental — Nova Versão',
        integration.id,
        `Nova versão v${nextVersionNum} do documento "${item.nomeExibicao}" enviada no protocolo ${integration.codigoProtocolo}.`
      );

      return this.getIntegrationDetail(actor, integration.id);
    });
  }

  // --------------------------------------------------------------------------
  // SUBMIT INTEGRATION FOR ADMIN EHS REVIEW
  // --------------------------------------------------------------------------

  async submitIntegration(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts?: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertNotAuditor(actor, 'submeter integração para análise');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertCompanyScopeAccess(actor, integration);
      this.assertConcurrencyVersion(integration, opts?.expectedVersion);

      if (
        ['ENVIADA', 'AGUARDANDO_ANALISE', 'EM_ANALISE', 'REENVIADA', 'APROVADA'].includes(
          integration.status
        )
      ) {
        throw new IntegrationWorkflowError(
          `Submissão duplicada bloqueada: o protocolo "${integration.codigoProtocolo}" já se encontra no status "${integration.status}".`,
          409,
          'ALREADY_SUBMITTED'
        );
      }

      if (!EDITABLE_UPLOAD_STATUSES.includes(integration.status)) {
        throw new IntegrationWorkflowError(
          `Integração no status "${integration.status}" não pode ser enviada neste momento.`,
          409,
          'INVALID_TRANSITION'
        );
      }

      const items = await this.repo.listItemsByIntegration(integration.id);
      const readiness = await this.evaluateSubmissionReadiness(integration, items);

      // Regras obrigatórias #2, #3, #5, #6, #7 e #8: validação completa no backend
      if (!readiness.podeSubmeter) {
        const hasAnyUploaded = items.some((it) => it.versaoAtual > 0);
        if (integration.status === 'RASCUNHO' && hasAnyUploaded) {
          const nowHold = this.nowIso();
          await this.repo.updateIntegration(integration.id, {
            status: 'PENDENTE_DOCUMENTACAO',
            dataUltimaAtualizacao: nowHold,
            updatedAt: nowHold,
            resumoItens: computeSummaryCounts(items),
          });
        }

        throw new IntegrationWorkflowError(
          readiness.resumoBloqueio ||
            'Submissão bloqueada: anexe todos os documentos obrigatórios confirmados no armazenamento antes de enviar para aprovação do Admin EHS.',
          422,
          'MANDATORY_DOCUMENTS_INCOMPLETE',
          {
            submissionReadiness: readiness,
            pendenciasObrigatorias: readiness.pendenciasObrigatorias,
          }
        );
      }

      const now = this.nowIso();
      const nextStatus: IntegrationWorkflowStatus =
        integration.status === 'PENDENTE_CORRECAO' || integration.status === 'REPROVADA'
          ? 'REENVIADA'
          : 'AGUARDANDO_ANALISE';
      const summary = computeSummaryCounts(items);

      await this.repo.updateIntegration(integration.id, {
        status: nextStatus,
        dataEnvio: now,
        itensPendentesCorrecao: [],
        dataUltimaAtualizacao: now,
        updatedAt: now,
        resumoItens: summary,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: nextStatus === 'REENVIADA' ? 'REENVIO_CORRECAO' : 'ENVIO_PARA_ANALISE',
            statusAnterior: integration.status,
            statusNovo: nextStatus,
            detalhes:
              nextStatus === 'REENVIADA'
                ? `Pendências corrigidas reenviadas por ${actor.nome} com documentação obrigatória completa (${readiness.obrigatoriosConfirmados}/${readiness.totalObrigatorios}).`
                : `Cadastro completo submetido por ${actor.nome} para conferência humana do Admin EHS (${readiness.obrigatoriosConfirmados}/${readiness.totalObrigatorios} documento(s) obrigatório(s) confirmado(s)).`,
            justificativa: opts?.justificativa?.trim() || undefined,
          },
        ],
      });

      await this.logAudit(
        actor,
        nextStatus === 'REENVIADA' ? 'Reenvio de Integração Corrigida' : 'Envio de Integração para Análise',
        integration.id,
        `Protocolo ${integration.codigoProtocolo} enviado (${nextStatus}) por ${actor.nome} com ${readiness.obrigatoriosConfirmados}/${readiness.totalObrigatorios} documento(s) obrigatório(s) confirmado(s).`
      );

      // In-app notifications for Admin EHS and Solicitante
      const submitVersion = integration.versaoConcorrencia + 1;
      await this.emitNotification({
        recipientRole: 'admin',
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        type: nextStatus === 'REENVIADA' ? 'INTEGRACAO_REENVIADA' : 'INTEGRACAO_ENVIADA',
        severity: nextStatus === 'REENVIADA' ? 'warning' : 'info',
        title:
          nextStatus === 'REENVIADA'
            ? `PACOTE REENVIADO PARA ANÁLISE (${integration.codigoProtocolo})`
            : `NOVA INTEGRAÇÃO RECEBIDA (${integration.codigoProtocolo})`,
        message:
          nextStatus === 'REENVIADA'
            ? `A contratada ${integration.empresaNome} corrigiu e reenviou o pacote documental (${readiness.obrigatoriosConfirmados} obrigatórios confirmados) para nova análise.`
            : `A contratada ${integration.empresaNome} enviou um novo pacote de integração completo com ${readiness.obrigatoriosConfirmados} documento(s) obrigatório(s) aguardando decisão.`,
        actionLabel: 'Analisar integração',
        actionTab: 'gestao_integracoes',
        integrationId: integration.id,
        companyId: integration.empresaId,
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `integ-submit-adm-${integration.id}-v${submitVersion}`,
        isDemo: integration.isDemo,
        createdAt: now,
      });

      await this.emitNotification({
        recipientRole: 'solicitante',
        recipientUserId: integration.solicitadoPorRole === 'solicitante' ? integration.solicitadoPorId : undefined,
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        type: 'INTEGRACAO_ENVIADA',
        severity: 'info',
        title:
          nextStatus === 'REENVIADA'
            ? `INTEGRAÇÃO REENVIADA PARA ANÁLISE (${integration.codigoProtocolo})`
            : `INTEGRAÇÃO RECEBIDA PARA ANÁLISE (${integration.codigoProtocolo})`,
        message:
          'Seu pacote documental completo foi enviado e recebido pela equipe de Administração EHS. Você será notificado assim que a análise for concluída.',
        actionLabel: 'Visualizar integração',
        actionTab: 'gestao_integracao',
        integrationId: integration.id,
        companyId: integration.empresaId,
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `integ-submit-sol-${integration.id}-v${submitVersion}`,
        isDemo: integration.isDemo,
        createdAt: now,
      });

      return this.getIntegrationDetail(actor, integration.id);
    });
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: START REVIEW
  // --------------------------------------------------------------------------

  async startReview(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts?: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'iniciar análise técnica de integrações');

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertSubmittedForAdmin(integration, 'iniciar análise técnica');
    this.assertConcurrencyVersion(integration, opts?.expectedVersion);

    const allowedFrom: IntegrationWorkflowStatus[] = [
      'ENVIADA',
      'AGUARDANDO_ANALISE',
      'REENVIADA',
      'EM_ANALISE',
    ];
    if (!allowedFrom.includes(integration.status)) {
      throw new IntegrationWorkflowError(
        `Não é possível iniciar análise de integração no status "${integration.status}".`,
        409,
        'INVALID_TRANSITION'
      );
    }

    const now = this.nowIso();
    const items = await this.repo.listItemsByIntegration(integration.id);
    for (const item of items) {
      if (item.status === 'ENVIADO') {
        const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
          v.versao === item.versaoAtual ? { ...v, status: 'EM_ANALISE' } : v
        );
        await this.repo.updateItem(item.id, {
          status: 'EM_ANALISE',
          versoes: updatedVersions,
          updatedAt: now,
        });
      }
    }

    const refreshedItems = await this.repo.listItemsByIntegration(integration.id);
    const summary = computeSummaryCounts(refreshedItems);

    await this.repo.updateIntegration(integration.id, {
      status: 'EM_ANALISE',
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      resumoItens: summary,
      versaoConcorrencia: integration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...integration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'INICIO_ANALISE_EHS',
          statusAnterior: integration.status,
          statusNovo: 'EM_ANALISE',
          detalhes: `Análise técnica iniciada pelo Admin EHS ${actor.nome}.`,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Início de Análise de Integração',
      integration.id,
      `Admin EHS ${actor.nome} iniciou conferência do protocolo ${integration.codigoProtocolo}.`
    );

    return this.getIntegrationDetail(actor, integration.id);
  }

  // --------------------------------------------------------------------------
  // OFFICIAL REGISTRY SYNC (ONLY CALLED ON EXPLICIT ADMIN EHS HUMAN APPROVAL)
  // --------------------------------------------------------------------------

  private async ensureOfficialCompanyAndEmployee(
    actor: IntegrationWorkflowActor,
    integration: ContractorIntegration,
    item: ContractorIntegrationItem,
    now: string
  ): Promise<{ empresaId: string; empresaNome: string; colaboradorId?: string; colaboradorNome?: string }> {
    let empresaId = integration.empresaId;
    let empresaNome = integration.empresaNome;

    if (!empresaId && integration.solicitacaoNovaEmpresa) {
      const companies = await this.repo.listCompanies();
      const existingByCnpj = companies.find(
        (c) => digitsOnly(c.cnpj) === digitsOnly(integration.solicitacaoNovaEmpresa!.cnpj)
      );

      if (existingByCnpj) {
        empresaId = existingByCnpj.id;
        empresaNome = existingByCnpj.razaoSocial;
      } else {
        const reqComp = integration.solicitacaoNovaEmpresa;
        const createdCompany = await this.repo.createCompany({
          razaoSocial: reqComp.razaoSocial,
          nomeFantasia: reqComp.nomeFantasia || reqComp.razaoSocial,
          cnpj: reqComp.cnpj,
          responsavelLegal: reqComp.responsavelLegal || '',
          responsavelSST: reqComp.responsavelSST || '',
          telefone: reqComp.telefone || '',
          email: reqComp.email || '',
          endereco: reqComp.endereco || '',
          unidadeAtendimento: reqComp.unidadeAtendimento || '',
          atividadeContratada: reqComp.atividadeContratada || integration.atividadeNomes.join(', '),
          atividadesAutorizadasIds: integration.atividadeIds,
          dataInicioContrato: reqComp.dataInicioContrato || now.slice(0, 10),
          dataTerminoContrato: reqComp.contrato_indeterminado ? '' : reqComp.dataTerminoContrato || '',
          contrato_indeterminado: Boolean(reqComp.contrato_indeterminado),
          situacao: 'ativa',
          createdAt: now,
          updatedAt: now,
        });
        empresaId = createdCompany.id;
        empresaNome = createdCompany.razaoSocial;

        await this.logAudit(
          actor,
          'Aprovação de Cadastro de Empresa',
          createdCompany.id,
          `Empresa "${createdCompany.razaoSocial}" (CNPJ: ${createdCompany.cnpj}) oficializada na base via integração ${integration.codigoProtocolo}.`
        );
      }

      // Bind official companyId back to integration & its items
      await this.repo.updateIntegration(integration.id, {
        empresaId,
        empresaNome,
        empresaPendenteCadastro: false,
        solicitacaoNovaEmpresa: {
          ...integration.solicitacaoNovaEmpresa,
          aprovadoCompanyId: empresaId,
        },
        updatedAt: now,
      });

      const allItems = await this.repo.listItemsByIntegration(integration.id);
      for (const it of allItems) {
        if (!it.empresaId) {
          await this.repo.updateItem(it.id, { empresaId, empresaNome, updatedAt: now });
        }
      }
    }

    if (!empresaId) {
      throw new IntegrationWorkflowError(
        'Não foi possível vincular a empresa contratada oficial para este documento.',
        400,
        'MISSING_OFFICIAL_COMPANY'
      );
    }

    // Ensure official Employee if item is employee-scoped
    let colaboradorId = item.colaboradorId;
    let colaboradorNome = item.colaboradorNome;

    if (item.categoria === 'colaborador' && !colaboradorId && item.colaboradorCandidateId) {
      const candidate = integration.colaboradoresCandidatos.find(
        (c) => c.candidateId === item.colaboradorCandidateId
      );
      if (candidate) {
        if (candidate.aprovadoEmployeeId) {
          colaboradorId = candidate.aprovadoEmployeeId;
          colaboradorNome = candidate.nomeCompleto;
        } else {
          const allEmployees = await this.repo.listEmployees();
          const existingByCpf = allEmployees.find(
            (e) => digitsOnly(e.cpf) === digitsOnly(candidate.cpf)
          );
          if (existingByCpf) {
            if (existingByCpf.empresaId !== empresaId) {
              throw new IntegrationWorkflowError(
                `CPF ${candidate.cpf} já pertence a outra contratada (${existingByCpf.empresaNome}). Não é possível aprovar cadastro duplicado.`,
                409,
                'DUPLICATE_EMPLOYEE_CPF_OTHER_COMPANY'
              );
            }
            colaboradorId = existingByCpf.id;
            colaboradorNome = existingByCpf.nomeCompleto;
          } else {
            const createdEmp = await this.repo.createEmployee({
              empresaId,
              empresaNome,
              nomeCompleto: candidate.nomeCompleto,
              cpf: candidate.cpf,
              cargo: candidate.cargo,
              setor: candidate.setor || 'Terceirizado',
              telefone: candidate.telefone,
              email: candidate.email,
              atividadeExecutada: candidate.atividadeExecutada || integration.atividadeNomes.join(', '),
              atividadesHabilitadasIds:
                candidate.atividadesHabilitadasIds.length > 0
                  ? candidate.atividadesHabilitadasIds
                  : integration.atividadeIds,
              dataIntegracao: now.slice(0, 10),
              situacaoCadastral: 'ativo',
              createdAt: now,
              updatedAt: now,
            });
            colaboradorId = createdEmp.id;
            colaboradorNome = createdEmp.nomeCompleto;

            await this.logAudit(
              actor,
              'Aprovação de Cadastro de Colaborador Terceirizado',
              createdEmp.id,
              `Colaborador "${createdEmp.nomeCompleto}" (CPF: ${createdEmp.cpf}) oficializado na base via integração ${integration.codigoProtocolo}.`
            );
          }

          // Update candidate and sibling items in integration
          const updatedCandidatos = integration.colaboradoresCandidatos.map((c) =>
            c.candidateId === candidate.candidateId
              ? { ...c, colaboradorId, aprovadoEmployeeId: colaboradorId }
              : c
          );
          const updatedColabIds = Array.from(
            new Set([...integration.colaboradorIds, colaboradorId])
          );
          await this.repo.updateIntegration(integration.id, {
            colaboradorIds: updatedColabIds,
            colaboradoresCandidatos: updatedCandidatos,
            updatedAt: now,
          });

          const allItems = await this.repo.listItemsByIntegration(integration.id);
          for (const it of allItems) {
            if (it.colaboradorCandidateId === candidate.candidateId && !it.colaboradorId) {
              await this.repo.updateItem(it.id, {
                colaboradorId,
                colaboradorNome,
                updatedAt: now,
              });
            }
          }
        }
      }
    }

    return { empresaId, empresaNome, colaboradorId, colaboradorNome };
  }

  private async integrateApprovedItemIntoOfficialCollection(params: {
    actor: IntegrationWorkflowActor;
    integration: ContractorIntegration;
    item: ContractorIntegrationItem;
    empresaId: string;
    empresaNome: string;
    colaboradorId?: string;
    colaboradorNome?: string;
    dataEmissao: string;
    dataValidade: string;
    semValidade: boolean;
    numeroDocumento: string;
    conclusaoAso: ConclusaoAptidao;
    aptidoesEspecificas: string[];
    observacoes: string;
    now: string;
  }): Promise<{ officialCollection: IntegrationOfficialCollection; officialRecordId: string }> {
    const {
      actor,
      integration,
      item,
      empresaId,
      empresaNome,
      colaboradorId,
      colaboradorNome,
      dataEmissao,
      dataValidade,
      semValidade,
      numeroDocumento,
      conclusaoAso,
      aptidoesEspecificas,
      observacoes,
      now,
    } = params;

    const protectedFileRef =
      item.storageKey || item.hasStoredFile
        ? `/api/integrations/${encodeURIComponent(integration.id)}/items/${encodeURIComponent(item.id)}/file?version=${item.versaoAtual || 1}`
        : '';

    if (item.origemColecao === 'exams') {
      if (!colaboradorId || !colaboradorNome) {
        throw new IntegrationWorkflowError(
          'Exame/ASO exige colaborador terceirizado vinculado para aprovação oficial.',
          400,
          'EMPLOYEE_REQUIRED_FOR_EXAM'
        );
      }

      if (item.officialRecordId && this.repo.updateExam) {
        const allExams = await this.repo.listExams();
        const existingExam = allExams.find((e) => e.id === item.officialRecordId);
        if (existingExam) {
          const nextVersao = (existingExam.versao || 1) + (existingExam.situacao === 'aprovado' ? 1 : 0);
          const preservedHistory: DocumentVersion[] = [
            ...(existingExam.historicoVersoes || [
              {
                versao: existingExam.versao || 1,
                arquivoUrl: existingExam.anexoUrl || '',
                arquivoNome: existingExam.anexoNome || 'versao-anterior',
                dataEnvio: existingExam.createdAt || now,
                responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
                situacao: existingExam.situacao,
                analisadoPor: existingExam.analisadoPor,
                dataAnalise: existingExam.dataAnalise,
              },
            ]),
          ];
          const lastIdx = preservedHistory.length - 1;
          if (existingExam.situacao === 'pendente' && lastIdx >= 0) {
            preservedHistory[lastIdx] = {
              ...preservedHistory[lastIdx],
              situacao: 'aprovado',
              analisadoPor: actor.nome,
              dataAnalise: now,
            };
          } else {
            preservedHistory.push({
              versao: nextVersao,
              arquivoUrl: protectedFileRef || existingExam.anexoUrl || '',
              arquivoNome: item.arquivoNome || existingExam.anexoNome || 'aso',
              dataEnvio: item.dataEnvio || now,
              responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
              situacao: 'aprovado',
              analisadoPor: actor.nome,
              dataAnalise: now,
            });
          }

          await this.repo.updateExam(existingExam.id, {
            tipoExame: item.nomeExibicao || existingExam.tipoExame,
            tipoDocumentoCanonico: item.documentoCodigoCanonico || existingExam.tipoDocumentoCanonico || 'ASO',
            aptidoesEspecificas:
              aptidoesEspecificas.length > 0 ? aptidoesEspecificas : existingExam.aptidoesEspecificas || [],
            dataRealizacao: dataEmissao || existingExam.dataRealizacao,
            dataValidade: semValidade ? '' : dataValidade || existingExam.dataValidade,
            semValidade,
            conclusao: conclusaoAso,
            anexoUrl: protectedFileRef || existingExam.anexoUrl,
            anexoNome: item.arquivoNome || existingExam.anexoNome,
            observacoes:
              observacoes ||
              existingExam.observacoes ||
              `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
            situacao: 'aprovado',
            motivoReprovacao: '',
            analisadoPor: actor.nome,
            dataAnalise: now,
            versao: nextVersao,
            historicoVersoes: preservedHistory,
            versaoPendente: null,
            updatedAt: now,
          });
          return { officialCollection: 'exams', officialRecordId: existingExam.id };
        }
      }

      // Preserve prior ASO records in `exams` collection; create new approved record for this version
      const createdExam = await this.repo.createExam({
        tipoExame: item.nomeExibicao || 'ASO Periódico',
        tipoDocumentoCanonico: item.documentoCodigoCanonico || 'ASO',
        aptidoesEspecificas:
          aptidoesEspecificas.length > 0
            ? aptidoesEspecificas
            : item.aptidaoEspecifica
            ? [item.aptidaoEspecifica]
            : [],
        colaboradorId,
        colaboradorNome,
        empresaId,
        empresaNome,
        dataRealizacao: dataEmissao || now.slice(0, 10),
        dataValidade: semValidade ? '' : dataValidade,
        semValidade,
        conclusao: conclusaoAso,
        anexoUrl: protectedFileRef,
        anexoNome: item.arquivoNome || '',
        observacoes:
          observacoes ||
          `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
        situacao: 'aprovado',
        analisadoPor: actor.nome,
        dataAnalise: now,
        versao: 1,
        historicoVersoes: [
          {
            versao: 1,
            arquivoUrl: protectedFileRef,
            arquivoNome: item.arquivoNome || '',
            dataEnvio: item.dataEnvio || now,
            responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
            situacao: 'aprovado',
            analisadoPor: actor.nome,
            dataAnalise: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });

      return { officialCollection: 'exams', officialRecordId: createdExam.id };
    }

    if (item.origemColecao === 'trainings') {
      if (!colaboradorId || !colaboradorNome) {
        throw new IntegrationWorkflowError(
          'Treinamento exige colaborador terceirizado vinculado para aprovação oficial.',
          400,
          'EMPLOYEE_REQUIRED_FOR_TRAINING'
        );
      }

      if (item.officialRecordId && this.repo.updateTraining) {
        const allTrainings = await this.repo.listTrainings();
        const existingTraining = allTrainings.find((t) => t.id === item.officialRecordId);
        if (existingTraining) {
          const nextVersao =
            (existingTraining.versao || 1) + (existingTraining.situacao === 'aprovado' ? 1 : 0);
          const preservedHistory: DocumentVersion[] = [
            ...(existingTraining.historicoVersoes || [
              {
                versao: existingTraining.versao || 1,
                arquivoUrl: existingTraining.certificadoUrl || '',
                arquivoNome: existingTraining.certificadoNome || 'versao-anterior',
                dataEnvio: existingTraining.createdAt || now,
                responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
                situacao: existingTraining.situacao,
                analisadoPor: existingTraining.analisadoPor,
                dataAnalise: existingTraining.dataAnalise,
              },
            ]),
          ];
          const lastIdx = preservedHistory.length - 1;
          if (existingTraining.situacao === 'pendente' && lastIdx >= 0) {
            preservedHistory[lastIdx] = {
              ...preservedHistory[lastIdx],
              situacao: 'aprovado',
              analisadoPor: actor.nome,
              dataAnalise: now,
            };
          } else {
            preservedHistory.push({
              versao: nextVersao,
              arquivoUrl: protectedFileRef || existingTraining.certificadoUrl || '',
              arquivoNome: item.arquivoNome || existingTraining.certificadoNome || 'certificado',
              dataEnvio: item.dataEnvio || now,
              responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
              situacao: 'aprovado',
              analisadoPor: actor.nome,
              dataAnalise: now,
            });
          }

          await this.repo.updateTraining(existingTraining.id, {
            nomeTreinamento: item.nomeExibicao || existingTraining.nomeTreinamento,
            tipoDocumentoCanonico: item.documentoCodigoCanonico || existingTraining.tipoDocumentoCanonico,
            dataRealizacao: dataEmissao || existingTraining.dataRealizacao,
            dataValidade: semValidade ? '' : dataValidade || existingTraining.dataValidade,
            semValidade,
            certificadoUrl: protectedFileRef || existingTraining.certificadoUrl,
            certificadoNome: item.arquivoNome || existingTraining.certificadoNome,
            observacoes:
              observacoes ||
              existingTraining.observacoes ||
              `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
            situacao: 'aprovado',
            motivoReprovacao: '',
            analisadoPor: actor.nome,
            dataAnalise: now,
            versao: nextVersao,
            historicoVersoes: preservedHistory,
            versaoPendente: null,
            updatedAt: now,
          });
          return { officialCollection: 'trainings', officialRecordId: existingTraining.id };
        }
      }

      // Preserve prior Training records; create new approved record for this version
      const createdTraining = await this.repo.createTraining({
        nomeTreinamento: item.nomeExibicao || item.documentoCodigoCanonico,
        tipoDocumentoCanonico: item.documentoCodigoCanonico,
        colaboradorId,
        colaboradorNome,
        empresaId,
        empresaNome,
        dataRealizacao: dataEmissao || now.slice(0, 10),
        dataValidade: semValidade ? '' : dataValidade,
        semValidade,
        certificadoUrl: protectedFileRef,
        certificadoNome: item.arquivoNome || '',
        observacoes:
          observacoes ||
          `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
        situacao: 'aprovado',
        analisadoPor: actor.nome,
        dataAnalise: now,
        versao: 1,
        historicoVersoes: [
          {
            versao: 1,
            arquivoUrl: protectedFileRef,
            arquivoNome: item.arquivoNome || '',
            dataEnvio: item.dataEnvio || now,
            responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
            situacao: 'aprovado',
            analisadoPor: actor.nome,
            dataAnalise: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });

      return { officialCollection: 'trainings', officialRecordId: createdTraining.id };
    }

    if (item.origemColecao === 'epiDeliveries') {
      if (!colaboradorId || !colaboradorNome) {
        throw new IntegrationWorkflowError(
          'Ficha de EPI exige colaborador terceirizado vinculado para aprovação oficial.',
          400,
          'EMPLOYEE_REQUIRED_FOR_EPI'
        );
      }

      const createdEpi = await this.repo.createEpiDelivery({
        colaboradorId,
        colaboradorNome,
        empresaId,
        empresaNome,
        nomeEpi: item.nomeExibicao || 'Ficha de EPI',
        caNumero: numeroDocumento || 'N/A',
        dataEntrega: dataEmissao || now.slice(0, 10),
        quantidade: 1,
        responsavelEntrega: actor.nome,
        assinaturaUrl: protectedFileRef,
        comprovanteNome: item.arquivoNome || '',
        observacoes:
          observacoes ||
          `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
        createdAt: now,
      });

      return { officialCollection: 'epiDeliveries', officialRecordId: createdEpi.id };
    }

    // Default: `documents` collection with full version history preservation (`historicoVersoes[]`)
    const allDocs = await this.repo.listDocuments();
    const existingOfficialDoc = item.officialRecordId
      ? allDocs.find((d) => d.id === item.officialRecordId)
      : allDocs.find(
          (d) =>
            d.empresaId === empresaId &&
            (d.colaboradorId || '') === (colaboradorId || '') &&
            normalizeCanonicalCode(d.tipoDocumentoCanonico) ===
              normalizeCanonicalCode(item.documentoCodigoCanonico) &&
            Boolean(normalizeCanonicalCode(item.documentoCodigoCanonico))
        );

    if (existingOfficialDoc) {
      const nextDocVersion = (existingOfficialDoc.versao || 1) + 1;
      const newDocVersionEntry: DocumentVersion = {
        versao: nextDocVersion,
        arquivoUrl: protectedFileRef,
        arquivoNome: item.arquivoNome || 'arquivo',
        dataEnvio: item.dataEnvio || now,
        responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
        observacoes:
          observacoes ||
          `Renovação aprovada via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
        situacao: 'aprovado',
        analisadoPor: actor.nome,
        dataAnalise: now,
      };

      const preservedHistory: DocumentVersion[] = [
        ...(existingOfficialDoc.historicoVersoes || [
          {
            versao: existingOfficialDoc.versao || 1,
            arquivoUrl: existingOfficialDoc.arquivoUrl || '',
            arquivoNome: existingOfficialDoc.arquivoNome || 'versao-anterior',
            dataEnvio: existingOfficialDoc.createdAt || now,
            responsavelEnvio: existingOfficialDoc.responsavelEnvio || 'Sistema',
            situacao: existingOfficialDoc.situacao,
            analisadoPor: existingOfficialDoc.analisadoPor,
            dataAnalise: existingOfficialDoc.dataAnalise,
          },
        ]),
        newDocVersionEntry,
      ];

      await this.repo.updateDocument(existingOfficialDoc.id, {
        nomeDocumento: item.nomeExibicao || existingOfficialDoc.nomeDocumento,
        tipoDocumentoCanonico: item.documentoCodigoCanonico,
        numeroDocumento: numeroDocumento || existingOfficialDoc.numeroDocumento,
        dataEmissao: dataEmissao || existingOfficialDoc.dataEmissao,
        dataValidade: semValidade ? '' : dataValidade,
        semValidade,
        arquivoUrl: protectedFileRef || existingOfficialDoc.arquivoUrl,
        arquivoNome: item.arquivoNome || existingOfficialDoc.arquivoNome,
        situacao: 'aprovado',
        motivoReprovacao: '',
        analisadoPor: actor.nome,
        dataAnalise: now,
        versao: nextDocVersion,
        historicoVersoes: preservedHistory,
        updatedAt: now,
      });

      return { officialCollection: 'documents', officialRecordId: existingOfficialDoc.id };
    }

    const createdDoc = await this.repo.createDocument({
      nomeDocumento: item.nomeExibicao || item.documentoCodigoCanonico,
      tipoDocumentoCanonico: item.documentoCodigoCanonico,
      categoria:
        item.categoria === 'colaborador' ? 'Documento Individual' : 'Documento Empresarial',
      empresaId,
      empresaNome,
      colaboradorId: colaboradorId || '',
      colaboradorNome: colaboradorNome || '',
      numeroDocumento: numeroDocumento || '',
      dataEmissao: dataEmissao || now.slice(0, 10),
      dataValidade: semValidade ? '' : dataValidade,
      semValidade,
      responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
      arquivoUrl: protectedFileRef,
      arquivoNome: item.arquivoNome || '',
      observacoes:
        observacoes ||
        `Aprovado via Central de Integração (${integration.codigoProtocolo}, v${item.versaoAtual}).`,
      situacao: 'aprovado',
      analisadoPor: actor.nome,
      dataAnalise: now,
      versao: 1,
      historicoVersoes: [
        {
          versao: 1,
          arquivoUrl: protectedFileRef,
          arquivoNome: item.arquivoNome || '',
          dataEnvio: item.dataEnvio || now,
          responsavelEnvio: item.enviadoPorNome || integration.solicitadoPorNome,
          observacoes: `Aprovado via Central de Integração (${integration.codigoProtocolo}).`,
          situacao: 'aprovado',
          analisadoPor: actor.nome,
          dataAnalise: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    return { officialCollection: 'documents', officialRecordId: createdDoc.id };
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: INDIVIDUAL DOCUMENT REVIEW (APPROVE / REJECT ONE ITEM AT A TIME)
  // --------------------------------------------------------------------------

  async reviewDocumentItem(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    itemId: string,
    input: ReviewItemInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'aprovar ou reprovar documentos da integração');

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertSubmittedForAdmin(integration, 'revisar item documental');
    this.assertConcurrencyVersion(integration, input.expectedVersion);

    if (integration.status === 'ENCERRADA') {
      throw new IntegrationWorkflowError(
        'Não é possível revisar itens de uma integração encerrada.',
        409,
        'INTEGRATION_CLOSED'
      );
    }

    const item = await this.repo.getItemById(itemId);
    if (!item || item.integrationId !== integration.id) {
      throw new IntegrationWorkflowError('Item documental não encontrado nesta integração.', 404, 'ITEM_NOT_FOUND');
    }

    const now = this.nowIso();

    if (input.decisao === 'REPROVADO') {
      const motivo = (input.motivo || '').trim();
      if (!motivo) {
        throw new IntegrationWorkflowError(
          'Informe obrigatoriamente o motivo/justificativa para reprovar este documento.',
          400,
          'JUSTIFICATION_REQUIRED'
        );
      }

      if (item.status === 'APROVADO') {
        throw new IntegrationWorkflowError(
          'Documento já aprovado não pode ser reprovado retroativamente. Solicite uma nova atualização documental caso necessário.',
          409,
          'ALREADY_APPROVED_ITEM'
        );
      }

      const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
        v.versao === item.versaoAtual
          ? {
              ...v,
              status: 'REPROVADO',
              analisadoPorId: actor.id,
              analisadoPorNome: actor.nome,
              analisadoEm: now,
              motivoReprovacao: motivo,
            }
          : v
      );

      await this.repo.updateItem(item.id, {
        status: 'REPROVADO',
        versoes: updatedVersions,
        analisadoPorId: actor.id,
        analisadoPorNome: actor.nome,
        dataAnalise: now,
        motivoReprovacao: motivo,
        updatedAt: now,
      });

      const refreshedItems = await this.repo.listItemsByIntegration(integration.id);
      const summary = computeSummaryCounts(refreshedItems);
      const nextStatus: IntegrationWorkflowStatus =
        integration.status === 'ENVIADA' ||
        integration.status === 'AGUARDANDO_ANALISE' ||
        integration.status === 'REENVIADA'
          ? 'EM_ANALISE'
          : integration.status;

      await this.repo.updateIntegration(integration.id, {
        status: nextStatus,
        analisadoPorId: actor.id,
        analisadoPorNome: actor.nome,
        dataAnalise: now,
        dataUltimaAtualizacao: now,
        updatedAt: now,
        resumoItens: summary,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'REPROVACAO_ITEM_DOCUMENTAL',
            statusAnterior: item.status,
            statusNovo: 'REPROVADO',
            itemId: item.id,
            detalhes: `Documento "${item.nomeExibicao}" (v${item.versaoAtual}) reprovado por ${actor.nome}.`,
            justificativa: motivo,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Reprovação de Documento na Integração',
        item.id,
        `Documento "${item.nomeExibicao}" do protocolo ${integration.codigoProtocolo} reprovado. Motivo: ${motivo}`
      );

      await this.emitNotification({
        recipientRole: 'solicitante',
        recipientUserId: integration.solicitadoPorId,
        empresaId: integration.empresaId,
        empresaNome: integration.empresaNome,
        type: 'DOCUMENTO_REJEITADO',
        severity: 'warning',
        title: `Documento rejeitado — ${item.nomeExibicao}`,
        message: `O documento "${item.nomeExibicao}"${item.colaboradorNome ? ` (${item.colaboradorNome})` : ''} no protocolo ${integration.codigoProtocolo} foi reprovado pelo EHS. Motivo: ${motivo}`,
        actionTab: 'gestao_integracao',
        actionLabel: 'Corrigir documento',
        integrationId: integration.id,
        employeeId: item.colaboradorId,
        documentId: item.id,
        createdById: actor.id,
        createdByNome: actor.nome,
        createdByRole: actor.role,
        idempotencyKey: `doc-rejeitado:${integration.id}:${item.id}:v${item.versaoAtual}:${integration.versaoConcorrencia + 1}`,
      });

      return this.getIntegrationDetail(actor, integration.id);
    }

    // APPROVE ITEM
    const storageConfirm = await this.isItemFileConfirmedInStorage(item);
    if (!storageConfirm.confirmed) {
      throw new IntegrationWorkflowError(
        storageConfirm.reason ||
          'Não é possível aprovar um item documental sem arquivo confirmado no armazenamento privado.',
        400,
        'FILE_REQUIRED_FOR_APPROVAL'
      );
    }

    const finalDataEmissao =
      normalizeIsoDate(input.dataEmissao) || item.dataEmissao || now.slice(0, 10);
    const finalSemValidade =
      input.semValidade !== undefined ? Boolean(input.semValidade) : Boolean(item.semValidade);
    const finalDataValidade = finalSemValidade
      ? ''
      : normalizeIsoDate(input.dataValidade) || item.dataValidade || '';
    const finalNumeroDoc =
      input.numeroDocumento !== undefined
        ? input.numeroDocumento.trim()
        : item.numeroDocumento || '';
    const finalConclusaoAso: ConclusaoAptidao =
      input.conclusaoAso || item.conclusaoAso || 'apto';
    const finalAptidoes =
      input.aptidoesEspecificas !== undefined
        ? input.aptidoesEspecificas
        : item.aptidoesEspecificas || (item.aptidaoEspecifica ? [item.aptidaoEspecifica] : []);
    const finalObservacoes =
      input.observacoes !== undefined ? input.observacoes.trim() : item.observacoes || '';

    // Regra crítica: NÃO permitir aprovação parcial do cadastramento inicial do colaborador!
    // Em INTEGRACAO_INICIAL, a aprovação do item marca o documento como APROVADO (preservado em eventuais
    // devoluções para correção), mas a oficialização do colaborador/empresa e gravação nas coleções SST
    // ocorre exclusivamente na aprovação final completa (approveIntegration) com 100% dos obrigatórios aprovados.
    // Em ATUALIZACAO_DOCUMENTAL (renovação de cadastro já oficializado), integra imediatamente.
    let resolvedEmpresaId = item.empresaId;
    let resolvedEmpresaNome = item.empresaNome;
    let resolvedColaboradorId = item.colaboradorId;
    let resolvedColaboradorNome = item.colaboradorNome;
    let officialCollection = item.officialCollection;
    let officialRecordId = item.officialRecordId;

    const shouldOfficializeImmediately =
      integration.tipo === 'ATUALIZACAO_DOCUMENTAL' || Boolean(item.officialRecordId);

    if (shouldOfficializeImmediately) {
      const resolvedEntities = await this.ensureOfficialCompanyAndEmployee(
        actor,
        integration,
        item,
        now
      );
      const officialIntegration = await this.integrateApprovedItemIntoOfficialCollection({
        actor,
        integration,
        item,
        empresaId: resolvedEntities.empresaId,
        empresaNome: resolvedEntities.empresaNome,
        colaboradorId: resolvedEntities.colaboradorId,
        colaboradorNome: resolvedEntities.colaboradorNome,
        dataEmissao: finalDataEmissao,
        dataValidade: finalDataValidade,
        semValidade: finalSemValidade,
        numeroDocumento: finalNumeroDoc,
        conclusaoAso: finalConclusaoAso,
        aptidoesEspecificas: finalAptidoes,
        observacoes: finalObservacoes,
        now,
      });
      resolvedEmpresaId = resolvedEntities.empresaId;
      resolvedEmpresaNome = resolvedEntities.empresaNome;
      resolvedColaboradorId = resolvedEntities.colaboradorId;
      resolvedColaboradorNome = resolvedEntities.colaboradorNome;
      officialCollection = officialIntegration.officialCollection;
      officialRecordId = officialIntegration.officialRecordId;
    }

    const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
      v.versao === item.versaoAtual
        ? {
            ...v,
            dataEmissao: finalDataEmissao,
            dataValidade: finalDataValidade,
            semValidade: finalSemValidade,
            numeroDocumento: finalNumeroDoc,
            conclusaoAso: finalConclusaoAso,
            aptidoesEspecificas: finalAptidoes,
            observacoes: finalObservacoes,
            status: 'APROVADO',
            analisadoPorId: actor.id,
            analisadoPorNome: actor.nome,
            analisadoEm: now,
            motivoReprovacao: '',
          }
        : v
    );

    await this.repo.updateItem(item.id, {
      empresaId: resolvedEmpresaId,
      empresaNome: resolvedEmpresaNome,
      colaboradorId: resolvedColaboradorId,
      colaboradorNome: resolvedColaboradorNome,
      status: 'APROVADO',
      versoes: updatedVersions,
      dataEmissao: finalDataEmissao,
      dataValidade: finalDataValidade,
      semValidade: finalSemValidade,
      numeroDocumento: finalNumeroDoc,
      conclusaoAso: finalConclusaoAso,
      aptidoesEspecificas: finalAptidoes,
      observacoes: finalObservacoes,
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      motivoReprovacao: '',
      officialCollection,
      officialRecordId,
      updatedAt: now,
    });

    const latestIntegration = (await this.repo.getIntegrationById(integration.id))!;
    const refreshedItems = await this.repo.listItemsByIntegration(integration.id);
    const summary = computeSummaryCounts(refreshedItems);
    const nextStatus: IntegrationWorkflowStatus =
      latestIntegration.status === 'ENVIADA' ||
      latestIntegration.status === 'AGUARDANDO_ANALISE' ||
      latestIntegration.status === 'REENVIADA'
        ? 'EM_ANALISE'
        : latestIntegration.status;

    const approvalDetailMsg =
      officialCollection && officialRecordId
        ? `Documento "${item.nomeExibicao}" (v${item.versaoAtual}) aprovado por ${actor.nome} e integrado em ${officialCollection}/${officialRecordId}.`
        : `Documento "${item.nomeExibicao}" (v${item.versaoAtual}) conferido e aprovado por ${actor.nome}. Será oficializado na base SST somente após a aprovação final completa da integração.`;

    await this.repo.updateIntegration(integration.id, {
      status: nextStatus,
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      resumoItens: summary,
      versaoConcorrencia: latestIntegration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...latestIntegration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'APROVACAO_ITEM_DOCUMENTAL',
          statusAnterior: item.status,
          statusNovo: 'APROVADO',
          itemId: item.id,
          detalhes: approvalDetailMsg,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Aprovação de Documento na Integração',
      item.id,
      approvalDetailMsg
    );

    if (officialCollection && officialRecordId && resolvedEmpresaId) {
      await this.syncOfficialDocumentDecision({
        colecao: officialCollection as 'documents' | 'exams' | 'trainings',
        registroId: officialRecordId,
        empresaId: resolvedEmpresaId,
        colaboradorId: resolvedColaboradorId,
        tipoDocumentoCanonico: item.documentoCodigoCanonico,
        nomeDocumento: item.nomeExibicao,
        decisao: 'aprovado',
        arquivoUrl: item.storageKey ? `ehs-direct://${item.storageKey}` : undefined,
        arquivoNome: item.arquivoNome,
        dataEmissao: finalDataEmissao,
        dataValidade: finalDataValidade,
        semValidade: finalSemValidade,
        conclusaoAso: finalConclusaoAso,
        versao: item.versaoAtual,
        analisadoPorId: actor.id,
        analisadoPorNome: actor.nome,
        dataAnalise: now,
      });
    }

    return this.getIntegrationDetail(actor, integration.id);
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: UPDATE DOCUMENT VALIDITY / EXPIRATION DATE (MIRRORED)
  // --------------------------------------------------------------------------

  async updateItemValidity(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    itemId: string,
    input: UpdateItemValidityInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'gerenciar datas de validade dos documentos');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertSubmittedForAdmin(integration, 'atualizar data de validade documental');
      this.assertConcurrencyVersion(integration, input.expectedVersion);

      const item = await this.repo.getItemById(itemId);
      if (!item || item.integrationId !== integration.id) {
        throw new IntegrationWorkflowError(
          'Item documental não encontrado nesta integração.',
          404,
          'ITEM_NOT_FOUND'
        );
      }

      const finalSemValidade = Boolean(input.semValidade);
      let finalDataValidade = '';
      if (!finalSemValidade) {
        const rawDate = (input.dataValidade || '').trim();
        if (!rawDate) {
          throw new IntegrationWorkflowError(
            'Informe uma data de validade válida (AAAA-MM-DD) ou marque o documento como sem validade.',
            400,
            'INVALID_VALIDITY_DATE'
          );
        }
        const normalized = normalizeIsoDate(rawDate);
        if (!normalized) {
          throw new IntegrationWorkflowError(
            `Data de validade inválida: "${rawDate}". Utilize o formato AAAA-MM-DD.`,
            400,
            'INVALID_VALIDITY_DATE'
          );
        }
        finalDataValidade = normalized;
      }

      const now = this.nowIso();
      const prevValidityLabel = item.semValidade
        ? 'Sem validade'
        : item.dataValidade || 'Não informada';
      const nextValidityLabel = finalSemValidade ? 'Sem validade' : finalDataValidade;
      const finalObservacoes =
        input.observacoes !== undefined ? input.observacoes.trim() : item.observacoes || '';

      const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
        v.versao === item.versaoAtual
          ? {
              ...v,
              dataValidade: finalDataValidade,
              semValidade: finalSemValidade,
              observacoes: finalObservacoes,
            }
          : v
      );

      await this.repo.updateItem(item.id, {
        dataValidade: finalDataValidade,
        semValidade: finalSemValidade,
        observacoes: finalObservacoes,
        versoes: updatedVersions,
        updatedAt: now,
      });

      // Mirror expiration change to official DocumentSST collection if already officialized
      if (item.officialRecordId && item.officialCollection === 'documents') {
        try {
          await this.repo.updateDocument(item.officialRecordId, {
            dataValidade: finalDataValidade,
            semValidade: finalSemValidade,
            updatedAt: now,
          });
        } catch {
          // Non-blocking if official record was already archived
        }
      }

      await this.repo.updateIntegration(integration.id, {
        dataUltimaAtualizacao: now,
        updatedAt: now,
        versaoConcorrencia: integration.versaoConcorrencia + 1,
        historicoWorkflow: [
          ...integration.historicoWorkflow,
          {
            dataHora: now,
            usuarioId: actor.id,
            usuarioNome: actor.nome,
            usuarioRole: actor.role,
            acao: 'ATUALIZACAO_VALIDADE_DOCUMENTO',
            statusAnterior: item.status,
            statusNovo: item.status,
            itemId: item.id,
            detalhes: `Validade do documento "${item.nomeExibicao}" atualizada por ${actor.nome}: ${prevValidityLabel} -> ${nextValidityLabel}.`,
          },
        ],
      });

      await this.logAudit(
        actor,
        'Atualização de Validade Documental',
        item.id,
        `Documento "${item.nomeExibicao}" (${integration.codigoProtocolo}): validade alterada de "${prevValidityLabel}" para "${nextValidityLabel}" por ${actor.nome}.`
      );

      return this.getIntegrationDetail(actor, integration.id);
    });
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: RETURN ONLY PENDING/REJECTED ITEMS FOR CORRECTION
  // --------------------------------------------------------------------------

  async returnForCorrection(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'devolver integração para correção parcial');

    const justificativa = (opts?.justificativa || '').trim();
    if (!justificativa) {
      throw new IntegrationWorkflowError(
        'Informe a justificativa/orientação ao devolver a integração para correção.',
        400,
        'JUSTIFICATION_REQUIRED'
      );
    }

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertSubmittedForAdmin(integration, 'devolver integração para correção');
    this.assertConcurrencyVersion(integration, opts?.expectedVersion);

    const items = await this.repo.listItemsByIntegration(integration.id);
    const pendingCorrectionItems = this.buildPendingCorrectionItems(items);
    if (pendingCorrectionItems.length === 0) {
      throw new IntegrationWorkflowError(
        'Reprove ao menos um item pendente antes de devolver a integração para correção.',
        400,
        'NO_ITEMS_TO_CORRECT'
      );
    }

    const approvedCount = items.filter((i) => i.status === 'APROVADO').length;
    const now = this.nowIso();
    const summary = computeSummaryCounts(items);
    const exactDocsSummary = pendingCorrectionItems
      .map((p) =>
        `${p.documentoCodigoCanonico} — ${p.nomeExibicao}${
          p.colaboradorNome ? ` (${p.colaboradorNome})` : ''
        }: ${p.motivo}`
      )
      .join(' | ');

    await this.repo.updateIntegration(integration.id, {
      status: 'PENDENTE_CORRECAO',
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      motivoReprovacaoOuDevolucao: justificativa,
      itensPendentesCorrecao: pendingCorrectionItems,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      resumoItens: summary,
      versaoConcorrencia: integration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...integration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'DEVOLUCAO_PARCIAL_CORRECAO',
          statusAnterior: integration.status,
          statusNovo: 'PENDENTE_CORRECAO',
          detalhes: `Devolvido(s) ${pendingCorrectionItems.length} documento(s) para correção/substituição [${exactDocsSummary}]. ${approvedCount} documento(s) já aprovado(s) foram preservados integralmente.`,
          justificativa,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Devolução Parcial de Integração',
      integration.id,
      `Protocolo ${integration.codigoProtocolo} devolvido para correção (${pendingCorrectionItems.length} pendência(s): ${exactDocsSummary}; ${approvedCount} aprovado(s) preservado(s)). Justificativa: ${justificativa}`
    );

    await this.emitNotification({
      recipientRole: 'solicitante',
      recipientUserId: integration.solicitadoPorId,
      empresaId: integration.empresaId,
      empresaNome: integration.empresaNome,
      type: 'INTEGRACAO_AGUARDANDO_COMPLEMENTACAO',
      severity: 'warning',
      title: `Integração aguardando complementação — ${integration.codigoProtocolo}`,
      message: `${pendingCorrectionItems.length} documento(s) precisam de correção na integração ${integration.codigoProtocolo}. Orientação EHS: ${justificativa}`,
      actionTab: 'gestao_integracao',
      actionLabel: 'Complementar documentos',
      integrationId: integration.id,
      createdById: actor.id,
      createdByNome: actor.nome,
      createdByRole: actor.role,
      idempotencyKey: `int-complementacao:${integration.id}:v${integration.versaoConcorrencia + 1}`,
    });

    return this.getIntegrationDetail(actor, integration.id);
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: FINAL INTEGRATION APPROVAL (STRICT COMPLETE APPROVAL — NO PARTIAL)
  // --------------------------------------------------------------------------

  async approveIntegration(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts?: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'aprovar e concluir integrações de terceiros');

    return this.withIntegrationLock(integrationId, async () => {
      const integration = await this.repo.getIntegrationById(integrationId);
      if (!integration) {
        throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
      }
      this.assertSubmittedForAdmin(integration, 'aprovar integração');
      this.assertConcurrencyVersion(integration, opts?.expectedVersion);

      if (integration.status === 'APROVADA') {
        throw new IntegrationWorkflowError(
          `Esta integração ("${integration.codigoProtocolo}") já foi aprovada anteriormente.`,
          409,
          'ALREADY_APPROVED'
        );
      }

      if (integration.status === 'ENCERRADA' || integration.status === 'REPROVADA') {
        throw new IntegrationWorkflowError(
          `Integração no status "${integration.status}" não pode ser aprovada.`,
          409,
          'INVALID_TRANSITION'
        );
      }

      if (integration.status === 'PENDENTE_CORRECAO') {
        throw new IntegrationWorkflowError(
          'Não é possível aprovar a integração enquanto há correções pendentes de reenvio pelo solicitante.',
          409,
          'INTEGRATION_PENDING_CORRECTION'
        );
      }

    const items = await this.repo.listItemsByIntegration(integration.id);
    if (items.length === 0) {
      throw new IntegrationWorkflowError(
        'Não é possível aprovar uma integração sem itens documentais.',
        422,
        'NO_ITEMS_TO_APPROVE'
      );
    }

    const mandatoryItems = items.filter((i) => i.obrigatorio);
    const now = this.nowIso();

    // Gate for ATIVIDADE SIMPLES: rejected or complementation-requested activities ALWAYS block final approval
    const currentSimpleActivities = integration.atividadesSimples || [];
    const rejectedOrPendingCompSimple = currentSimpleActivities.filter(
      (sa) => sa.status === 'RECUSADA' || sa.status === 'COMPLEMENTACAO_SOLICITADA'
    );
    if (rejectedOrPendingCompSimple.length > 0) {
      throw new IntegrationWorkflowError(
        `Aprovação final bloqueada: existem ${rejectedOrPendingCompSimple.length} Atividade(s) Simples recusada(s) ou aguardando complementação: ${rejectedOrPendingCompSimple
          .map((sa) => `${sa.nome} (${sa.status})`)
          .join(', ')}.`,
        422,
        'SIMPLE_ACTIVITY_NOT_APPROVED',
        {
          blockingSimpleActivityIds: rejectedOrPendingCompSimple.map((sa) => sa.id),
        }
      );
    }

    let approvedSimpleActivitiesForSave: SimpleActivityEntry[] | undefined;

    if (opts?.approveWholePackage) {
      // Whole-package Admin approval: ensure every mandatory item has a valid uploaded file and is not rejected/expired
      const blockingMissingOrRejected = mandatoryItems.filter(
        (i) => i.status === 'PENDENTE_ENVIO' || i.status === 'REPROVADO' || i.versaoAtual < 1
      );
      if (blockingMissingOrRejected.length > 0) {
        throw new IntegrationWorkflowError(
          `Aprovação do pacote bloqueada: existem ${blockingMissingOrRejected.length} documento(s) obrigatório(s) ausente(s) ou reprovado(s): ${blockingMissingOrRejected
            .map((i) => `${i.nomeExibicao} (${i.status})`)
            .join(', ')}.`,
          422,
          'MANDATORY_ITEMS_INCOMPLETE',
          {
            pendingMandatoryItemIds: blockingMissingOrRejected.map((i) => i.id),
            pendingMandatoryNames: blockingMissingOrRejected.map((i) => i.nomeExibicao),
          }
        );
      }

      const expiredMandatory = mandatoryItems.filter(
        (i) => !i.semValidade && i.dataValidade && isIsoDateExpired(i.dataValidade, now)
      );
      if (expiredMandatory.length > 0) {
        throw new IntegrationWorkflowError(
          `Aprovação final bloqueada: documento(s) obrigatório(s) com validade expirada: ${expiredMandatory
            .map((i) => `${i.nomeExibicao} (venceu em ${i.dataValidade})`)
            .join(', ')}.`,
          422,
          'MANDATORY_ITEM_EXPIRED',
          { expiredMandatoryItemIds: expiredMandatory.map((i) => i.id) }
        );
      }

      // Atomically approve any pending Simple Activities when Admin approves the whole package
      if (currentSimpleActivities.some((sa) => sa.status === 'PENDENTE_ANALISE')) {
        approvedSimpleActivitiesForSave = currentSimpleActivities.map((sa) =>
          sa.status === 'PENDENTE_ANALISE'
            ? {
                ...sa,
                status: 'APROVADA' as SimpleActivityStatus,
                analisadoPorId: actor.id,
                analisadoPorNome: actor.nome,
                dataAnalise: now,
                atualizadoEm: now,
                historico: [
                  ...(sa.historico || []),
                  {
                    dataHora: now,
                    usuarioId: actor.id,
                    usuarioNome: actor.nome,
                    usuarioRole: actor.role,
                    acao: 'APROVACAO_ATIVIDADE_SIMPLES' as const,
                    statusAnterior: sa.status,
                    statusNovo: 'APROVADA' as SimpleActivityStatus,
                    detalhes: `Atividade Simples "${sa.nome}" aprovada em conjunto pelo Administrador EHS ${actor.nome} na aprovação final da integração.`,
                  },
                ],
              }
            : sa
        );
      }

      // Atomically mark all uploaded items (ENVIADO / EM_ANALISE) as APROVADO as part of whole-package approval
      for (const item of items) {
        if ((item.status === 'ENVIADO' || item.status === 'EM_ANALISE') && item.versaoAtual > 0) {
          const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
            v.versao === item.versaoAtual
              ? {
                  ...v,
                  status: 'APROVADO',
                  analisadoPorId: actor.id,
                  analisadoPorNome: actor.nome,
                  dataAnalise: now,
                  motivoReprovacao: '',
                }
              : v
          );
          await this.repo.updateItem(item.id, {
            status: 'APROVADO',
            analisadoPorId: actor.id,
            analisadoPorNome: actor.nome,
            dataAnalise: now,
            motivoReprovacao: '',
            versoes: updatedVersions,
            updatedAt: now,
          });
          item.status = 'APROVADO';
          item.analisadoPorId = actor.id;
          item.analisadoPorNome = actor.nome;
          item.dataAnalise = now;
        }
      }
    } else {
      const pendingSimpleActivities = currentSimpleActivities.filter(
        (sa) => sa.status !== 'APROVADA'
      );
      if (pendingSimpleActivities.length > 0) {
        throw new IntegrationWorkflowError(
          `Aprovação final bloqueada: existem ${pendingSimpleActivities.length} Atividade(s) Simples aguardando aprovação explícita do Administrador EHS: ${pendingSimpleActivities
            .map((sa) => `${sa.nome} (${sa.status})`)
            .join(', ')}.`,
          422,
          'SIMPLE_ACTIVITY_PENDING_APPROVAL',
          {
            pendingSimpleActivityIds: pendingSimpleActivities.map((sa) => sa.id),
          }
        );
      }

      const incompleteMandatory = mandatoryItems.filter((i) => i.status !== 'APROVADO');
      if (incompleteMandatory.length > 0) {
        throw new IntegrationWorkflowError(
          `Aprovação final bloqueada (aprovação parcial não permitida): existem ${incompleteMandatory.length} documento(s) obrigatório(s) ainda não aprovado(s): ${incompleteMandatory
            .map((i) => `${i.nomeExibicao} (${i.status})`)
            .join(', ')}.`,
          422,
          'MANDATORY_ITEMS_INCOMPLETE',
          {
            pendingMandatoryItemIds: incompleteMandatory.map((i) => i.id),
            pendingMandatoryNames: incompleteMandatory.map((i) => i.nomeExibicao),
          }
        );
      }

      // Also block if any approved mandatory item is already expired
      const expiredMandatory = mandatoryItems.filter(
        (i) => !i.semValidade && i.dataValidade && isIsoDateExpired(i.dataValidade, now)
      );
      if (expiredMandatory.length > 0) {
        throw new IntegrationWorkflowError(
          `Aprovação final bloqueada: documento(s) obrigatório(s) com validade expirada: ${expiredMandatory
            .map((i) => `${i.nomeExibicao} (venceu em ${i.dataValidade})`)
            .join(', ')}.`,
          422,
          'MANDATORY_ITEM_EXPIRED',
          { expiredMandatoryItemIds: expiredMandatory.map((i) => i.id) }
        );
      }
    }

    // Complete Officialization: only now that 100% of mandatory docs are approved & valid,
    // officialize new company/collaborators and publish all approved items into official SST collections.
    const approvedItemsToOfficialize = items.filter(
      (i) =>
        i.status === 'APROVADO' &&
        (!i.officialRecordId || i.situacaoDocumentoExistente === 'PENDENTE_APROVACAO')
    );
    const newlyOfficializedEvents: OfficialDocumentReviewedEvent[] = [];

    for (const approvedItem of approvedItemsToOfficialize) {
      const currentInteg = (await this.repo.getIntegrationById(integration.id))!;
      const currentItem = (await this.repo.getItemById(approvedItem.id)) || approvedItem;
      const resolvedEntities = await this.ensureOfficialCompanyAndEmployee(
        actor,
        currentInteg,
        currentItem,
        now
      );

      const officialIntegration = await this.integrateApprovedItemIntoOfficialCollection({
        actor,
        integration: currentInteg,
        item: currentItem,
        empresaId: resolvedEntities.empresaId,
        empresaNome: resolvedEntities.empresaNome,
        colaboradorId: resolvedEntities.colaboradorId,
        colaboradorNome: resolvedEntities.colaboradorNome,
        dataEmissao: currentItem.dataEmissao || now.slice(0, 10),
        dataValidade: currentItem.semValidade ? '' : currentItem.dataValidade || '',
        semValidade: Boolean(currentItem.semValidade),
        numeroDocumento: currentItem.numeroDocumento || '',
        conclusaoAso: currentItem.conclusaoAso || 'apto',
        aptidoesEspecificas:
          currentItem.aptidoesEspecificas ||
          (currentItem.aptidaoEspecifica ? [currentItem.aptidaoEspecifica] : []),
        observacoes: currentItem.observacoes || '',
        now,
      });

      await this.repo.updateItem(currentItem.id, {
        empresaId: resolvedEntities.empresaId,
        empresaNome: resolvedEntities.empresaNome,
        colaboradorId: resolvedEntities.colaboradorId,
        colaboradorNome: resolvedEntities.colaboradorNome,
        officialCollection: officialIntegration.officialCollection,
        officialRecordId: officialIntegration.officialRecordId,
        situacaoDocumentoExistente: 'REAPROVEITADO_VALIDO',
        updatedAt: now,
      });

      if (
        officialIntegration.officialCollection === 'documents' ||
        officialIntegration.officialCollection === 'exams' ||
        officialIntegration.officialCollection === 'trainings'
      ) {
        newlyOfficializedEvents.push({
          colecao: officialIntegration.officialCollection,
          registroId: officialIntegration.officialRecordId,
          empresaId: resolvedEntities.empresaId,
          colaboradorId: resolvedEntities.colaboradorId,
          tipoDocumentoCanonico: currentItem.documentoCodigoCanonico,
          nomeDocumento: currentItem.nomeExibicao,
          decisao: 'aprovado',
          arquivoUrl: currentItem.storageKey ? `ehs-direct://${currentItem.storageKey}` : undefined,
          arquivoNome: currentItem.arquivoNome,
          dataEmissao: currentItem.dataEmissao || now.slice(0, 10),
          dataValidade: currentItem.semValidade ? '' : currentItem.dataValidade || '',
          semValidade: Boolean(currentItem.semValidade),
          conclusaoAso: currentItem.conclusaoAso || 'apto',
          versao: currentItem.versaoAtual || 1,
          analisadoPorId: actor.id,
          analisadoPorNome: actor.nome,
          dataAnalise: now,
        });
      }
    }

    for (const ev of newlyOfficializedEvents) {
      await this.syncOfficialDocumentDecision(ev);
    }

    // Ensure any candidate collaborator not yet linked via an approved employee item is also officialized on complete approval
    const postItemsIntegration = (await this.repo.getIntegrationById(integration.id))!;
    for (const cand of postItemsIntegration.colaboradoresCandidatos || []) {
      if (!cand.colaboradorId && !cand.aprovadoEmployeeId) {
        const latestInteg = (await this.repo.getIntegrationById(integration.id))!;
        const syntheticItem: ContractorIntegrationItem = {
          id: `cand-sync-${cand.candidateId}`,
          integrationId: latestInteg.id,
          empresaId: latestInteg.empresaId,
          empresaNome: latestInteg.empresaNome,
          colaboradorCandidateId: cand.candidateId,
          colaboradorNome: cand.nomeCompleto,
          colaboradorCpf: cand.cpf,
          colaboradorCargo: cand.cargo,
          categoria: 'colaborador',
          documentoCodigoCanonico: 'CADASTRO_COLABORADOR',
          nomeExibicao: 'Cadastro do Colaborador',
          origemColecao: 'documents',
          obrigatorio: true,
          status: 'APROVADO',
          versaoAtual: 1,
          versoes: [],
          createdAt: now,
          updatedAt: now,
        };
        await this.ensureOfficialCompanyAndEmployee(actor, latestInteg, syntheticItem, now);
      }
    }

    const finalIntegrationState = (await this.repo.getIntegrationById(integration.id))!;
    const finalItems = await this.repo.listItemsByIntegration(integration.id);
    const summary = computeSummaryCounts(finalItems);

    await this.repo.updateIntegration(integration.id, {
      status: 'APROVADA',
      ...(approvedSimpleActivitiesForSave ? { atividadesSimples: approvedSimpleActivitiesForSave } : {}),
      aprovadoPorId: actor.id,
      aprovadoPorNome: actor.nome,
      dataAprovacao: now,
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      motivoReprovacaoOuDevolucao: '',
      itensPendentesCorrecao: [],
      dataUltimaAtualizacao: now,
      updatedAt: now,
      resumoItens: summary,
      versaoConcorrencia: finalIntegrationState.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...finalIntegrationState.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'APROVACAO_FINAL_INTEGRACAO',
          statusAnterior: finalIntegrationState.status,
          statusNovo: 'APROVADA',
          detalhes: `Integração concluída e APROVADA pelo Admin EHS ${actor.nome}. Todos os ${mandatoryItems.length} item(ns) obrigatório(s) estão conformes e oficializados na base SST. A execução de atividades críticas continua exigindo emissão e liberação formal de PT/APR.`,
          justificativa: opts?.justificativa?.trim() || undefined,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Aprovação Final de Integração',
      integration.id,
      `Protocolo ${integration.codigoProtocolo} (${finalIntegrationState.empresaNome}) APROVADO por ${actor.nome} com oficialização completa de ${approvedItemsToOfficialize.length} documento(s).`
    );

    await this.emitNotification({
      recipientRole: 'solicitante',
      recipientUserId:
        finalIntegrationState.solicitadoPorRole === 'solicitante'
          ? finalIntegrationState.solicitadoPorId
          : undefined,
      empresaId: finalIntegrationState.empresaId,
      empresaNome: finalIntegrationState.empresaNome,
      type: 'INTEGRACAO_APROVADA',
      severity: 'success',
      title: `INTEGRAÇÃO APROVADA (${integration.codigoProtocolo})`,
      message: `Sua integração da empresa ${finalIntegrationState.empresaNome} foi aprovada integralmente pelo Administrador EHS ${actor.nome}. Os cadastros e documentos foram oficializados com histórico preservado.`,
      actionLabel: 'Visualizar integração',
      actionTab: 'gestao_integracao',
      integrationId: integration.id,
      companyId: finalIntegrationState.empresaId,
      createdById: actor.id,
      createdByNome: actor.nome,
      createdByRole: actor.role,
      idempotencyKey: `integ-approved-${integration.id}-v${finalIntegrationState.versaoConcorrencia + 1}`,
      isDemo: finalIntegrationState.isDemo,
      createdAt: now,
    });

      return this.getIntegrationDetail(actor, integration.id);
    });
  }

  // --------------------------------------------------------------------------
  // ADMIN EHS: REJECT / CLOSE INTEGRATION
  // --------------------------------------------------------------------------

  async rejectIntegration(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'reprovar integrações');

    const justificativa = (opts?.justificativa || '').trim();
    if (!justificativa) {
      throw new IntegrationWorkflowError(
        'A justificativa técnica é obrigatória para reprovar o processo de integração.',
        400,
        'JUSTIFICATION_REQUIRED'
      );
    }

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertSubmittedForAdmin(integration, 'reprovar integração');
    this.assertConcurrencyVersion(integration, opts?.expectedVersion);

    const items = await this.repo.listItemsByIntegration(integration.id);
    const now = this.nowIso();

    // Optional targeted documents flagged by Admin for correction (preserves previous versions)
    const targetedIds = new Set(
      Array.isArray(opts?.rejectedItemIds)
        ? opts.rejectedItemIds.map((id) => String(id).trim()).filter(Boolean)
        : []
    );
    if (targetedIds.size > 0) {
      for (const item of items) {
        if (targetedIds.has(item.id)) {
          const itemReason = (opts?.itemReasons?.[item.id] || '').trim() || justificativa;
          const updatedVersions: IntegrationDocumentVersion[] = (item.versoes || []).map((v) =>
            v.versao === item.versaoAtual
              ? {
                  ...v,
                  status: 'REPROVADO',
                  analisadoPorId: actor.id,
                  analisadoPorNome: actor.nome,
                  dataAnalise: now,
                  motivoReprovacao: itemReason,
                }
              : v
          );
          await this.repo.updateItem(item.id, {
            status: 'REPROVADO',
            analisadoPorId: actor.id,
            analisadoPorNome: actor.nome,
            dataAnalise: now,
            motivoReprovacao: itemReason,
            versoes: updatedVersions,
            updatedAt: now,
          });
          item.status = 'REPROVADO';
          item.motivoReprovacao = itemReason;
          item.analisadoPorId = actor.id;
          item.analisadoPorNome = actor.nome;
          item.dataAnalise = now;
        }
      }
    }

    const pendingCorrectionItems = this.buildPendingCorrectionItems(items);
    const summary = computeSummaryCounts(items);

    await this.repo.updateIntegration(integration.id, {
      status: 'REPROVADA',
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      motivoReprovacaoOuDevolucao: justificativa,
      itensPendentesCorrecao: pendingCorrectionItems,
      resumoItens: summary,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      versaoConcorrencia: integration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...integration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'REPROVACAO_INTEGRACAO',
          statusAnterior: integration.status,
          statusNovo: 'REPROVADA',
          detalhes:
            pendingCorrectionItems.length > 0
              ? `Integração reprovada pelo Admin EHS ${actor.nome}. Documentos apontados para correção: ${pendingCorrectionItems
                  .map((p) => `${p.documentoCodigoCanonico} (${p.nomeExibicao})`)
                  .join(', ')}.`
              : `Integração reprovada pelo Admin EHS ${actor.nome}.`,
          justificativa,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Reprovação de Integração',
      integration.id,
      `Protocolo ${integration.codigoProtocolo} reprovado por ${actor.nome}. Justificativa: ${justificativa}`
    );

    const flaggedListText =
      pendingCorrectionItems.length > 0
        ? ` Documentos apontados para correção: ${pendingCorrectionItems
            .map((p) => p.nomeExibicao)
            .slice(0, 6)
            .join(', ')}.`
        : '';

    await this.emitNotification({
      recipientRole: 'solicitante',
      recipientUserId:
        integration.solicitadoPorRole === 'solicitante' ? integration.solicitadoPorId : undefined,
      empresaId: integration.empresaId,
      empresaNome: integration.empresaNome,
      type: 'INTEGRACAO_REPROVADA',
      severity: 'critical',
      title: `INTEGRAÇÃO REPROVADA (${integration.codigoProtocolo})`,
      message: `A documentação enviada precisa de correções. Justificativa do Administrador EHS (${actor.nome}): ${justificativa}.${flaggedListText}`,
      actionLabel: 'Visualizar integração',
      actionTab: 'gestao_integracao',
      integrationId: integration.id,
      companyId: integration.empresaId,
      createdById: actor.id,
      createdByNome: actor.nome,
      createdByRole: actor.role,
      idempotencyKey: `integ-rejected-${integration.id}-v${integration.versaoConcorrencia + 1}`,
      isDemo: integration.isDemo,
      createdAt: now,
    });

    return this.getIntegrationDetail(actor, integration.id);
  }

  async closeIntegration(
    actor: IntegrationWorkflowActor,
    integrationId: string,
    opts?: IntegrationActionInput
  ): Promise<IntegrationDetailResult> {
    this.assertAdmin(actor, 'encerrar integrações');

    const integration = await this.repo.getIntegrationById(integrationId);
    if (!integration) {
      throw new IntegrationWorkflowError('Integração não encontrada.', 404, 'INTEGRATION_NOT_FOUND');
    }
    this.assertSubmittedForAdmin(integration, 'encerrar cadastro ainda não submetido');
    this.assertConcurrencyVersion(integration, opts?.expectedVersion);

    const now = this.nowIso();
    await this.repo.updateIntegration(integration.id, {
      status: 'ENCERRADA',
      analisadoPorId: actor.id,
      analisadoPorNome: actor.nome,
      dataAnalise: now,
      dataUltimaAtualizacao: now,
      updatedAt: now,
      versaoConcorrencia: integration.versaoConcorrencia + 1,
      historicoWorkflow: [
        ...integration.historicoWorkflow,
        {
          dataHora: now,
          usuarioId: actor.id,
          usuarioNome: actor.nome,
          usuarioRole: actor.role,
          acao: 'ENCERRAMENTO_INTEGRACAO',
          statusAnterior: integration.status,
          statusNovo: 'ENCERRADA',
          detalhes: `Integração encerrada por ${actor.nome}.`,
          justificativa: opts?.justificativa?.trim() || undefined,
        },
      ],
    });

    await this.logAudit(
      actor,
      'Encerramento de Integração',
      integration.id,
      `Protocolo ${integration.codigoProtocolo} encerrado por ${actor.nome}.`
    );

    return this.getIntegrationDetail(actor, integration.id);
  }

  // --------------------------------------------------------------------------
  // PROPAGATE OFFICIAL DOCUMENT APPROVAL / REJECTION TO ALL OPEN INTEGRATIONS
  // --------------------------------------------------------------------------

  async syncOfficialDocumentDecision(
    event: OfficialDocumentReviewedEvent
  ): Promise<{ updatedIntegrationIds: string[]; updatedItemIds: string[] }> {
    const now = event.dataAnalise || event.analisadoEm || this.nowIso();
    const reviewerId = event.analisadoPorId || event.actor?.id || 'admin-ehs';
    const reviewerNome = event.analisadoPorNome || event.actor?.nome || 'Administrador EHS';
    const closedStatuses = new Set<IntegrationWorkflowStatus>(['APROVADA', 'REPROVADA', 'ENCERRADA']);
    const [allIntegrations, allItems, allEmployees] = await Promise.all([
      this.repo.listIntegrations(),
      this.repo.listAllItems(),
      this.repo.listEmployees(),
    ]);

    const openIntegrations = allIntegrations.filter(
      (integ) => integ.empresaId === event.empresaId && !closedStatuses.has(integ.status)
    );
    if (openIntegrations.length === 0) {
      return { updatedIntegrationIds: [], updatedItemIds: [] };
    }

    const eventColabId = (event.colaboradorId || '').trim();
    const eventEmp = eventColabId
      ? allEmployees.find((e) => e.id === eventColabId && e.empresaId === event.empresaId)
      : undefined;
    const eventEmpCpfDigits = eventEmp ? digitsOnly(eventEmp.cpf) : '';

    // Verify stored binary when approving
    let verifiedStorage: {
      storageKey: string;
      arquivoMimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
      arquivoTamanhoBytes: number;
      arquivoHashSha256: string;
    } | null = null;

    if (event.decisao === 'aprovado') {
      const expired =
        !event.semValidade && Boolean(event.dataValidade) && isIsoDateExpired(event.dataValidade, now);
      if (expired) {
        return { updatedIntegrationIds: [], updatedItemIds: [] };
      }
      const resolvedKey = this.resolveStorageKeyFromOfficialUrl(event.arquivoUrl, allItems).storageKey;
      if (resolvedKey) {
        try {
          const stored = await this.fileStorage.getObject(resolvedKey);
          if (stored && stored.buffer && stored.buffer.length > 0) {
            verifiedStorage = {
              storageKey: resolvedKey,
              arquivoMimeType:
                detectRealMimeFromBuffer(stored.buffer) || 'application/pdf',
              arquivoTamanhoBytes: stored.buffer.length,
              arquivoHashSha256: computeBufferSha256(stored.buffer),
            };
          }
        } catch {
          verifiedStorage = null;
        }
      }
    }

    const updatedIntegrationIds: string[] = [];
    const updatedItemIds: string[] = [];

    for (const integ of openIntegrations) {
      const integItems = allItems.filter((it) => it.integrationId === integ.id);
      let integChanged = false;

      for (const item of integItems) {
        const directLinkMatch =
          item.officialRecordId === event.registroId ||
          item.documentoExistenteId === event.registroId;

        let scopeAndTypeMatch = false;
        if (!directLinkMatch && item.origemColecao === event.colecao) {
          const isCompanyEvent = eventColabId === '';
          if (isCompanyEvent && item.categoria === 'empresa') {
            scopeAndTypeMatch = this.doesCanonicalOrTitleMatchRequirement({
              recordCanonical: event.tipoDocumentoCanonico,
              recordTitle: event.nomeDocumento,
              reqCanonical: item.documentoCodigoCanonico,
              reqKeywords: [item.nomeExibicao],
            });
          } else if (!isCompanyEvent && item.categoria === 'colaborador') {
            const itemCpfDigits = digitsOnly(item.colaboradorCpf);
            const exactEmployeeMatch =
              item.colaboradorId === eventColabId ||
              (eventEmpCpfDigits.length === 11 && itemCpfDigits === eventEmpCpfDigits);
            if (exactEmployeeMatch) {
              scopeAndTypeMatch = this.doesCanonicalOrTitleMatchRequirement({
                recordCanonical: event.tipoDocumentoCanonico,
                recordTitle: event.nomeDocumento,
                reqCanonical: item.documentoCodigoCanonico,
                reqKeywords: [item.nomeExibicao],
              });
            }
          }
        }

        if (!directLinkMatch && !scopeAndTypeMatch) continue;

        if (event.decisao === 'aprovado') {
          if (!verifiedStorage) continue;
          if (
            event.colecao === 'exams' &&
            item.exigeAptoASO &&
            event.conclusaoAso &&
            event.conclusaoAso !== 'apto'
          ) {
            continue;
          }
          // Skip if already identically approved & pointing to same version + storageKey
          if (
            item.status === 'APROVADO' &&
            item.officialRecordId === event.registroId &&
            item.storageKey === verifiedStorage.storageKey &&
            item.dataValidade === (event.semValidade ? '' : event.dataValidade || '')
          ) {
            continue;
          }

          const nextVersion = Math.max(item.versaoAtual || 0, event.versao || 1, 1);
          const nextVersions: IntegrationDocumentVersion[] = [
            ...(item.versoes || []).filter((v) => v.versao !== nextVersion),
            {
              versao: nextVersion,
              arquivoNome: event.arquivoNome || item.arquivoNome || `${item.nomeExibicao}.pdf`,
              arquivoMimeType: verifiedStorage.arquivoMimeType,
              arquivoTamanhoBytes: verifiedStorage.arquivoTamanhoBytes,
              arquivoHashSha256: verifiedStorage.arquivoHashSha256,
              storageKey: verifiedStorage.storageKey,
              hasStoredFile: true,
              enviadoPorId: reviewerId,
              enviadoPorNome: 'Base Oficial EHS (Sincronizado)',
              enviadoEm: now,
              dataEmissao: event.dataEmissao || item.dataEmissao,
              dataValidade: event.semValidade ? '' : event.dataValidade || '',
              semValidade: Boolean(event.semValidade),
              conclusaoAso: event.conclusaoAso || item.conclusaoAso,
              status: 'APROVADO',
              analisadoPorId: reviewerId,
              analisadoPorNome: reviewerNome,
              analisadoEm: now,
            },
          ];

          const reuseSource: IntegrationDocumentReuseSource = {
            colecao: event.colecao,
            registroId: event.registroId,
            versao: nextVersion,
            aprovadoPor: reviewerNome,
            dataAprovacao: now,
            dataValidade: event.semValidade ? '' : event.dataValidade || '',
            semValidade: Boolean(event.semValidade),
            storageKey: verifiedStorage.storageKey,
            arquivoNome: event.arquivoNome || item.arquivoNome,
          };

          await this.repo.updateItem(item.id, {
            status: 'APROVADO',
            reaproveitado: true,
            reaproveitadoDe: reuseSource,
            situacaoDocumentoExistente: 'REAPROVEITADO_VALIDO',
            documentoExistenteAviso: `Documento aprovado pelo Admin EHS ${reviewerNome} e atualizado automaticamente nesta integração.`,
            documentoExistenteId: event.registroId,
            documentoExistenteColecao: event.colecao,
            officialCollection: event.colecao,
            officialRecordId: event.registroId,
            storageKey: verifiedStorage.storageKey,
            hasStoredFile: true,
            arquivoNome: event.arquivoNome || item.arquivoNome,
            arquivoMimeType: verifiedStorage.arquivoMimeType,
            arquivoTamanhoBytes: verifiedStorage.arquivoTamanhoBytes,
            arquivoHashSha256: verifiedStorage.arquivoHashSha256,
            dataEmissao: event.dataEmissao || item.dataEmissao,
            dataValidade: event.semValidade ? '' : event.dataValidade || '',
            semValidade: Boolean(event.semValidade),
            conclusaoAso: event.conclusaoAso || item.conclusaoAso,
            versaoAtual: nextVersion,
            versoes: nextVersions,
            analisadoPorId: reviewerId,
            analisadoPorNome: reviewerNome,
            dataAnalise: now,
            motivoReprovacao: '',
            updatedAt: now,
          });
          updatedItemIds.push(item.id);
          integChanged = true;
        } else if (event.decisao === 'reprovado') {
          if (item.status === 'APROVADO') continue;
          const motivo = event.motivo || 'Documento recusado pelo Administrador EHS.';
          await this.repo.updateItem(item.id, {
            status: 'REPROVADO',
            reaproveitado: false,
            situacaoDocumentoExistente: 'RECUSADO',
            documentoExistenteAviso: `Documento recusado pelo Admin EHS (${motivo}). Anexe uma versão corrigida.`,
            documentoExistenteId: event.registroId,
            documentoExistenteColecao: event.colecao,
            analisadoPorId: reviewerId,
            analisadoPorNome: reviewerNome,
            dataAnalise: now,
            motivoReprovacao: motivo,
            updatedAt: now,
          });
          updatedItemIds.push(item.id);
          integChanged = true;
        }
      }

      if (integChanged) {
        const refreshedItems = await this.repo.listItemsByIntegration(integ.id);
        const summary = computeSummaryCounts(refreshedItems);
        await this.repo.updateIntegration(integ.id, {
          resumoItens: summary,
          dataUltimaAtualizacao: now,
          updatedAt: now,
        });
        updatedIntegrationIds.push(integ.id);
      }
    }

    return { updatedIntegrationIds, updatedItemIds };
  }
}
