import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from './AuthContext';
import {
  Company,
  CompanyChangeRequest,
  CompanyEditableFields,
  Employee,
  DocumentSST,
  Training,
  OccupationalExam,
  EPIDelivery,
  SafetyPermit,
  Inspection,
  ActionPlan,
  EnvironmentalDoc,
  AuditLog,
  DocumentStatus,
  NotificationConfig,
  NotificationLog,
  UserProfile,
  SmtpSessionConfig,
  ActivityProfile,
  ActivityDocumentRequirement,
  ActivityComplianceResult,
  SafetyPermitControlAttachment,
  SafetyPermitOperationalControls,
  SafetyPermitType,
  SmartDocRecord,
  ContractorIntegration,
  ContractorIntegrationItem,
  MirroredIntegrationDocumentItem,
  IntegrationType,
  IntegrationItemCategory,
  IntegrationDocumentGroupId,
  IntegrationOfficialCollection,
  IntegrationCompanyRequest,
  IntegrationSubmissionReadiness,
  ConclusaoAptidao,
} from '../types/sst';
import { INITIAL_COMPANIES, INITIAL_EMPLOYEES } from '../utils/initialData';
import {
  INITIAL_ACTIVITY_TEMPLATES,
  buildActivityProfilePayloadFromTemplate,
  buildRequirementsPayloadFromTemplate,
} from '../utils/activityTemplates';

export interface PermitServerDraftInput {
  tipo?: SafetyPermitType;
  titulo: string;
  descricaoServico?: string;
  empresaId: string;
  localTrabalho: string;
  dataInicio: string;
  dataFim: string;
  responsavelEmissao?: string;
  responsavelAtividade?: string;
  riscosIdentificados?: string;
  medidasPreventivas?: string;
  observacoes?: string;
  anexoUrl?: string;
  anexosControles?: SafetyPermitControlAttachment[];
  atividadeIds: string[];
  colaboradorIds: string[];
  expectedVersion?: number;
}

export interface PermitServerActionInput {
  justificativa?: string;
  expectedVersion?: number;
  expectedComplianceFingerprint?: string;
}

export interface PermitServerEvaluationResult {
  permit: SafetyPermit;
  compliance: ActivityComplianceResult;
  complianceFingerprint: string;
  versaoConcorrencia: number;
  controlesOperacionais: SafetyPermitOperationalControls;
  structuralErrors: string[];
}

export class PermitApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly compliance?: ActivityComplianceResult;
  readonly motivosBloqueio?: string[];
  readonly errors?: string[];

  constructor(
    message: string,
    status: number,
    details?: {
      code?: string;
      compliance?: ActivityComplianceResult;
      motivosBloqueio?: string[];
      errors?: string[];
    }
  ) {
    super(message);
    this.name = 'PermitApiClientError';
    this.status = status;
    this.code = details?.code;
    this.compliance = details?.compliance;
    this.motivosBloqueio = details?.motivosBloqueio;
    this.errors = details?.errors;
  }
}

export interface IntegrationServerDetailResult {
  integration: ContractorIntegration;
  items: ContractorIntegrationItem[];
  compliancePreview: ActivityComplianceResult | null;
  submissionReadiness?: IntegrationSubmissionReadiness;
}

export interface IntegrationDuplicateCheckResult {
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

export interface IntegrationServerCreateInput {
  tipo?: IntegrationType;
  empresaId?: string;
  solicitacaoNovaEmpresa?: Omit<IntegrationCompanyRequest, 'aprovadoCompanyId'>;
  atividadeIds?: string[];
  colaboradorIds?: string[];
  novosColaboradores?: Array<{
    colaboradorId?: string;
    nomeCompleto?: string;
    cpf?: string;
    cargo?: string;
    setor?: string;
    telefone?: string;
    email?: string;
    atividadeExecutada?: string;
    atividadesHabilitadasIds?: string[];
  }>;
  customItems?: Array<{
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
  }>;
  observacoes?: string;
}

export interface IntegrationBatchFilePayload {
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
  arquivoBase64: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusaoAso?: ConclusaoAptidao;
  aptidoesEspecificas?: string[];
  observacoes?: string;
  runSmartDocsAi?: boolean;
}

export interface IntegrationSingleUploadResult extends IntegrationServerDetailResult {
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

export interface IntegrationFileBlobResult {
  blob: Blob;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileName: string;
}

export interface IntegrationReviewItemPayload {
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

export class IntegrationApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, any>;

  constructor(message: string, status: number, code?: string, details?: Record<string, any>) {
    super(message);
    this.name = 'IntegrationApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface SSTContextType {
  companies: Company[];
  employees: Employee[];
  documents: DocumentSST[];
  trainings: Training[];
  exams: OccupationalExam[];
  epiDeliveries: EPIDelivery[];
  safetyPermits: SafetyPermit[];
  inspections: Inspection[];
  actionPlans: ActionPlan[];
  environmentalDocs: EnvironmentalDoc[];
  auditLogs: AuditLog[];
  userProfiles: UserProfile[];
  activityProfiles: ActivityProfile[];
  activityDocumentRequirements: ActivityDocumentRequirement[];
  smartDocs: SmartDocRecord[];
  contractorIntegrations: ContractorIntegration[];
  contractorIntegrationItems: MirroredIntegrationDocumentItem[];
  activityMatrixFirestoreError: string | null;
  integrationFirestoreError: string | null;
  loading: boolean;
  // CRUD actions
  addCompany: (comp: Omit<Company, 'id'>) => Promise<string>;
  updateCompany: (id: string, comp: Partial<Company>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  requestCompanyChange: (
    companyId: string,
    proposedChanges: Partial<CompanyEditableFields>,
    justificativaSolicitante: string
  ) => Promise<string>;
  approveCompanyChange: (companyId: string, requestId: string, observacao?: string) => Promise<void>;
  rejectCompanyChange: (companyId: string, requestId: string, justificativa: string) => Promise<void>;

  addEmployee: (emp: Omit<Employee, 'id'>) => Promise<string>;
  updateEmployee: (id: string, emp: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;

  addDocument: (docData: Omit<DocumentSST, 'id'>) => Promise<string>;
  updateDocument: (id: string, docData: Partial<DocumentSST>) => Promise<void>;
  approveDocument: (id: string) => Promise<void>;
  rejectDocument: (id: string, motivo: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;

  addTraining: (trn: Omit<Training, 'id'>) => Promise<string>;
  updateTraining: (id: string, trn: Partial<Training>) => Promise<void>;
  approveTraining: (id: string) => Promise<void>;
  rejectTraining: (id: string, motivo: string) => Promise<void>;
  deleteTraining: (id: string) => Promise<void>;

  addExam: (exam: Omit<OccupationalExam, 'id'>) => Promise<string>;
  updateExam: (id: string, exam: Partial<OccupationalExam>) => Promise<void>;
  approveExam: (id: string) => Promise<void>;
  rejectExam: (id: string, motivo: string) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;

  addEPIDelivery: (epi: Omit<EPIDelivery, 'id'>) => Promise<string>;
  deleteEPIDelivery: (id: string) => Promise<void>;

  addSafetyPermit: (permit: Omit<SafetyPermit, 'id'>) => Promise<string>;
  updateSafetyPermit: (id: string, permit: Partial<SafetyPermit>) => Promise<void>;
  deleteSafetyPermit: (id: string) => Promise<void>;

  addInspection: (insp: Omit<Inspection, 'id'>) => Promise<string>;
  updateInspection: (id: string, insp: Partial<Inspection>) => Promise<void>;

  addActionPlan: (plan: Omit<ActionPlan, 'id'>) => Promise<string>;
  updateActionPlan: (id: string, plan: Partial<ActionPlan>) => Promise<void>;
  deleteActionPlan: (id: string) => Promise<void>;

  addEnvironmentalDoc: (env: Omit<EnvironmentalDoc, 'id'>) => Promise<string>;
  updateEnvironmentalDoc: (id: string, env: Partial<EnvironmentalDoc>) => Promise<void>;

  // Notifications Module
  notificationConfigs: NotificationConfig[];
  notificationLogs: NotificationLog[];
  addNotificationConfig: (cfg: Omit<NotificationConfig, 'id'>) => Promise<string>;
  updateNotificationConfig: (id: string, cfg: Partial<NotificationConfig>) => Promise<void>;
  deleteNotificationConfig: (id: string) => Promise<void>;
  triggerNotificationCheck: (smtpConfig?: SmtpSessionConfig) => Promise<{ success: boolean; dispatched: number; skippedDuplicates: number; totalEvaluated: number; message: string }>;
  sendTestNotificationEmail: (recipient: string, subject?: string, message?: string, senderName?: string, smtpConfig?: SmtpSessionConfig) => Promise<{ success: boolean; status: string; message: string; messageId?: string; error?: string; detalhes?: string }>;
  sendCustomNotificationEmail: (data: {
    to: string[];
    recipientsDetails?: any[];
    companyId?: string;
    companyName?: string;
    subject: string;
    message: string;
    attachmentName?: string;
    attachmentDataUrl?: string;
    senderName?: string;
    senderEmail?: string;
    smtpConfig?: SmtpSessionConfig;
  }) => Promise<{ success: boolean; message: string; error?: string; detalhes?: string }>;
  recalculateAlerts: (docId: string, docTitle: string, newExpirationDate: string, entityType: string) => Promise<void>;

  // Activity Matrix & Mandatory Documents (Admin EHS write-protected)
  addActivityProfile: (
    activity: Omit<ActivityProfile, 'id' | 'criadoPorId' | 'criadoPorNome' | 'atualizadoPorId' | 'atualizadoPorNome' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  updateActivityProfile: (id: string, updates: Partial<ActivityProfile>) => Promise<void>;
  deactivateActivityProfile: (id: string) => Promise<void>;
  addActivityDocumentRequirement: (
    req: Omit<ActivityDocumentRequirement, 'id' | 'criadoPorId' | 'criadoPorNome' | 'atualizadoPorId' | 'atualizadoPorNome' | 'createdAt' | 'updatedAt'>
  ) => Promise<string>;
  updateActivityDocumentRequirement: (id: string, updates: Partial<ActivityDocumentRequirement>) => Promise<void>;
  deactivateActivityDocumentRequirement: (id: string) => Promise<void>;
  seedInitialActivityTemplates: () => Promise<{
    createdActivities: number;
    skippedActivities: number;
    createdRequirements: number;
    skippedRequirements: number;
  }>;

  // Server-backed Activity Request & Release Workflow (Fail-Closed /api/permits/*)
  createPermitDraftOnServer: (
    payload: PermitServerDraftInput
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  updatePermitDraftOnServer: (
    id: string,
    payload: Partial<PermitServerDraftInput>
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  evaluatePermitOnServer: (id: string) => Promise<PermitServerEvaluationResult>;
  submitPermitOnServer: (
    id: string,
    opts?: PermitServerActionInput
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  startPermitReviewOnServer: (
    id: string,
    opts?: PermitServerActionInput
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  requestPermitDocsOnServer: (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  requestPermitCorrectionOnServer: (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  approvePermitOnServer: (
    id: string,
    opts?: PermitServerActionInput
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  releasePermitOnServer: (
    id: string,
    opts?: PermitServerActionInput
  ) => Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }>;
  rejectPermitOnServer: (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ) => Promise<SafetyPermit>;
  cancelPermitOnServer: (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ) => Promise<SafetyPermit>;
  closePermitOnServer: (
    id: string,
    opts?: PermitServerActionInput
  ) => Promise<SafetyPermit>;

  // Server-backed Central de Integração de Terceiros (/api/integrations/*)
  listIntegrationsOnServer: () => Promise<ContractorIntegration[]>;
  listIntegrationItemsOnServer: () => Promise<MirroredIntegrationDocumentItem[]>;
  getIntegrationDetailOnServer: (id: string) => Promise<IntegrationServerDetailResult>;
  checkIntegrationDuplicatesOnServer: (input: {
    cnpj?: string;
    cpf?: string;
  }) => Promise<IntegrationDuplicateCheckResult>;
  createIntegrationOnServer: (
    payload: IntegrationServerCreateInput
  ) => Promise<IntegrationServerDetailResult>;
  uploadIntegrationBatchOnServer: (
    id: string,
    payload: {
      files: IntegrationBatchFilePayload[];
      autoSubmit?: boolean;
      expectedVersion?: number;
    }
  ) => Promise<IntegrationServerDetailResult & { uploadedCount: number }>;
  uploadIntegrationDocumentOnServer: (
    id: string,
    payload: IntegrationBatchFilePayload,
    onProgress?: (percent: number) => void
  ) => Promise<IntegrationSingleUploadResult>;
  fetchIntegrationItemFileBlobOnServer: (
    integrationId: string,
    itemId: string,
    opts?: { version?: number; download?: boolean }
  ) => Promise<IntegrationFileBlobResult>;
  renewIntegrationItemOnServer: (
    integrationId: string,
    itemId: string,
    payload: IntegrationBatchFilePayload
  ) => Promise<IntegrationServerDetailResult>;
  submitIntegrationOnServer: (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;
  startIntegrationReviewOnServer: (
    id: string,
    opts?: { expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;
  reviewIntegrationItemOnServer: (
    integrationId: string,
    itemId: string,
    payload: IntegrationReviewItemPayload
  ) => Promise<IntegrationServerDetailResult>;
  updateIntegrationItemValidityOnServer: (
    integrationId: string,
    itemId: string,
    payload: {
      dataValidade?: string;
      semValidade?: boolean;
      observacoes?: string;
      expectedVersion?: number;
    }
  ) => Promise<IntegrationServerDetailResult>;
  requestIntegrationCorrectionOnServer: (
    id: string,
    opts: { justificativa: string; expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;
  approveIntegrationOnServer: (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;
  rejectIntegrationOnServer: (
    id: string,
    opts: { justificativa: string; expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;
  closeIntegrationOnServer: (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ) => Promise<IntegrationServerDetailResult>;

  seedInitialBenchmarkData: () => Promise<void>;
}

const SSTContext = createContext<SSTContextType | undefined>(undefined);

export const SSTProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, activeRole, activeEmpresaId, isAdmin, authorizedFetch, getAuthHeaders } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documents, setDocuments] = useState<DocumentSST[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [exams, setExams] = useState<OccupationalExam[]>([]);
  const [epiDeliveries, setEpiDeliveries] = useState<EPIDelivery[]>([]);
  const [safetyPermits, setSafetyPermits] = useState<SafetyPermit[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [environmentalDocs, setEnvironmentalDocs] = useState<EnvironmentalDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [notificationConfigs, setNotificationConfigs] = useState<NotificationConfig[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<ActivityProfile[]>([]);
  const [activityDocumentRequirements, setActivityDocumentRequirements] = useState<ActivityDocumentRequirement[]>([]);
  const [smartDocs, setSmartDocs] = useState<SmartDocRecord[]>([]);
  const [contractorIntegrations, setContractorIntegrations] = useState<ContractorIntegration[]>([]);
  const [contractorIntegrationItems, setContractorIntegrationItems] = useState<
    MirroredIntegrationDocumentItem[]
  >([]);
  const [activityMatrixFirestoreError, setActivityMatrixFirestoreError] = useState<string | null>(null);
  const [integrationFirestoreError, setIntegrationFirestoreError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const upsertIntegrationInState = (
    integration: ContractorIntegration | undefined | null,
    items?: ContractorIntegrationItem[]
  ) => {
    if (integration && Array.isArray(items)) {
      const mirroredForProtocol: MirroredIntegrationDocumentItem[] = items.map((it) => ({
        ...it,
        codigoProtocolo: integration.codigoProtocolo,
        protocoloStatus: integration.status,
        protocoloTipo: integration.tipo,
        empresaCnpj: integration.empresaCnpj,
        solicitadoPorNome: integration.solicitadoPorNome,
        protocoloDataEnvio: integration.dataEnvio,
        protocoloDataUltimaAtualizacao: integration.dataUltimaAtualizacao,
      }));
      setContractorIntegrationItems((prev) => {
        const others = prev.filter((it) => it.integrationId !== integration.id);
        return [...mirroredForProtocol, ...others].sort((a, b) =>
          (b.updatedAt || b.dataEnvio || b.createdAt || '').localeCompare(
            a.updatedAt || a.dataEnvio || a.createdAt || ''
          )
        );
      });
    }
    if (!integration || !integration.id) return;
    setContractorIntegrations((prev) => {
      const next = prev.some((item) => item.id === integration.id)
        ? prev.map((item) => (item.id === integration.id ? integration : item))
        : [integration, ...prev];
      return [...next].sort((a, b) =>
        (b.dataUltimaAtualizacao || '').localeCompare(a.dataUltimaAtualizacao || '')
      );
    });
  };

  // Real-time synchronization with Firestore
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    try {
      // 1. Companies
      const unsubCompanies = onSnapshot(
        collection(db, 'companies'),
        (snap) => {
          const list: Company[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Company, 'id'>) }));
          setCompanies(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'companies')
      );
      unsubs.push(unsubCompanies);

      // 2. Employees
      const unsubEmployees = onSnapshot(
        collection(db, 'employees'),
        (snap) => {
          const list: Employee[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Employee, 'id'>) }));
          setEmployees(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'employees')
      );
      unsubs.push(unsubEmployees);

      // 3. Documents
      const unsubDocs = onSnapshot(
        collection(db, 'documents'),
        (snap) => {
          const list: DocumentSST[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<DocumentSST, 'id'>) }));
          setDocuments(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'documents')
      );
      unsubs.push(unsubDocs);

      // 4. Trainings
      const unsubTrainings = onSnapshot(
        collection(db, 'trainings'),
        (snap) => {
          const list: Training[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Training, 'id'>) }));
          setTrainings(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'trainings')
      );
      unsubs.push(unsubTrainings);

      // 5. Exams
      const unsubExams = onSnapshot(
        collection(db, 'exams'),
        (snap) => {
          const list: OccupationalExam[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<OccupationalExam, 'id'>) }));
          setExams(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'exams')
      );
      unsubs.push(unsubExams);

      // 6. EPI Deliveries
      const unsubEpi = onSnapshot(
        collection(db, 'epiDeliveries'),
        (snap) => {
          const list: EPIDelivery[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<EPIDelivery, 'id'>) }));
          setEpiDeliveries(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'epiDeliveries')
      );
      unsubs.push(unsubEpi);

      // 7. Safety Permits
      const unsubPermits = onSnapshot(
        collection(db, 'safetyPermits'),
        (snap) => {
          const list: SafetyPermit[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<SafetyPermit, 'id'>) }));
          setSafetyPermits(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'safetyPermits')
      );
      unsubs.push(unsubPermits);

      // 8. Inspections
      const unsubInspections = onSnapshot(
        collection(db, 'inspections'),
        (snap) => {
          const list: Inspection[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Inspection, 'id'>) }));
          setInspections(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'inspections')
      );
      unsubs.push(unsubInspections);

      // 9. Action Plans
      const unsubPlans = onSnapshot(
        collection(db, 'actionPlans'),
        (snap) => {
          const list: ActionPlan[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<ActionPlan, 'id'>) }));
          setActionPlans(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'actionPlans')
      );
      unsubs.push(unsubPlans);

      // 10. Environmental Docs
      const unsubEnv = onSnapshot(
        collection(db, 'environmentalDocs'),
        (snap) => {
          const list: EnvironmentalDoc[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<EnvironmentalDoc, 'id'>) }));
          setEnvironmentalDocs(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'environmentalDocs')
      );
      unsubs.push(unsubEnv);

      // 11. Audit Logs
      const unsubLogs = onSnapshot(
        collection(db, 'auditLogs'),
        (snap) => {
          const list: AuditLog[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) }));
          list.sort((a, b) => (b.dataHora > a.dataHora ? 1 : -1));
          setAuditLogs(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'auditLogs')
      );
      unsubs.push(unsubLogs);

      // 12. Notification Configs
      const unsubConfigs = onSnapshot(
        collection(db, 'notificationConfigs'),
        (snap) => {
          const list: NotificationConfig[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<NotificationConfig, 'id'>) }));
          setNotificationConfigs(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'notificationConfigs')
      );
      unsubs.push(unsubConfigs);

      // 13. Notification Logs
      const unsubNotifLogs = onSnapshot(
        collection(db, 'notificationLogs'),
        (snap) => {
          const list: NotificationLog[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<NotificationLog, 'id'>) }));
          list.sort((a, b) => (b.dataHora > a.dataHora ? 1 : -1));
          setNotificationLogs(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'notificationLogs')
      );
      unsubs.push(unsubNotifLogs);

      // 14. User Profiles (for searchable recipient lists)
      const unsubUsers = onSnapshot(
        collection(db, 'userProfiles'),
        (snap) => {
          const list: UserProfile[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<UserProfile, 'id'>) }));
          setUserProfiles(list);
        },
        (error) => handleFirestoreError(error, OperationType.GET, 'userProfiles')
      );
      unsubs.push(unsubUsers);

      // 15. Activity Profiles (Catálogo Configurável de Atividades de Terceiros)
      const unsubActivityProfiles = onSnapshot(
        collection(db, 'activityProfiles'),
        (snap) => {
          const list: ActivityProfile[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<ActivityProfile, 'id'>) }));
          list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
          setActivityProfiles(list);
          setActivityMatrixFirestoreError(null);
        },
        (error: any) => {
          const code = String(error?.code || '').toLowerCase();
          if (code === 'permission-denied' || String(error?.message || '').toLowerCase().includes('insufficient permissions')) {
            setActivityMatrixFirestoreError(
              'Acesso negado pelo Firestore (permission-denied) na coleção activityProfiles. Publique as regras atualizadas em firestore.rules no Firebase e conclua a migração para o Firebase Admin SDK.'
            );
          }
          handleFirestoreError(error, OperationType.GET, 'activityProfiles');
        }
      );
      unsubs.push(unsubActivityProfiles);

      // 16. Activity Document Requirements (Matriz de Documentos Obrigatórios por Atividade)
      const unsubActivityReqs = onSnapshot(
        collection(db, 'activityDocumentRequirements'),
        (snap) => {
          const list: ActivityDocumentRequirement[] = [];
          snap.forEach((d) =>
            list.push({ id: d.id, ...(d.data() as Omit<ActivityDocumentRequirement, 'id'>) })
          );
          list.sort(
            (a, b) =>
              (a.ordemExibicao ?? 999) - (b.ordemExibicao ?? 999) ||
              a.nomeExibicao.localeCompare(b.nomeExibicao, 'pt-BR')
          );
          setActivityDocumentRequirements(list);
        },
        (error: any) => {
          const code = String(error?.code || '').toLowerCase();
          if (code === 'permission-denied' || String(error?.message || '').toLowerCase().includes('insufficient permissions')) {
            setActivityMatrixFirestoreError(
              'Acesso negado pelo Firestore (permission-denied) na coleção activityDocumentRequirements. Publique as regras atualizadas em firestore.rules no Firebase e conclua a migração para o Firebase Admin SDK.'
            );
          }
          handleFirestoreError(error, OperationType.GET, 'activityDocumentRequirements');
        }
      );
      unsubs.push(unsubActivityReqs);

      // 17. SmartDocs (metadados leves sem arquivoUrl para visibilidade de pendências no motor de conformidade)
      const unsubSmartDocs = onSnapshot(
        collection(db, 'smartDocs'),
        (snap) => {
          const list: SmartDocRecord[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Omit<SmartDocRecord, 'id'>;
            const { arquivoUrl: _omitted, ...safe } = raw;
            list.push({ id: d.id, ...safe });
          });
          setSmartDocs(list);
        },
        (error) => {
          console.warn('Não foi possível sincronizar metadados de SmartDocs:', error);
        }
      );
      unsubs.push(unsubSmartDocs);

      // 18. Contractor Integrations (Central de Integração de Terceiros):
      // NÃO utilizar onSnapshot direto no Firestore para preservar RBAC, isolamento por empresa
      // e ocultação de rascunhos/PENDENTE_DOCUMENTACAO para o Admin EHS.
      // Os dados são hidratados exclusivamente via GET /api/integrations autenticado.

      setLoading(false);
    } catch (e) {
      console.error('Erro na subscrição de coleções:', e);
      setLoading(false);
    }

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, []);

  // Helper to log audit actions
  const logAudit = async (acao: string, entidade: string, entidadeId: string, detalhes: string) => {
    try {
      const logData: Omit<AuditLog, 'id'> = {
        usuario: profile?.nome || 'Usuário SST',
        usuarioEmail: profile?.email || 'sistema@sst.com',
        acao,
        entidade,
        entidadeId,
        detalhes,
        dataHora: new Date().toISOString(),
      };
      await addDoc(collection(db, 'auditLogs'), logData);
    } catch (err) {
      console.warn('Erro ao registrar log de auditoria:', err);
    }
  };

  // CRUD Implementations
  const addCompany = async (comp: Omit<Company, 'id'>) => {
    const colRef = collection(db, 'companies');
    const isIndeterminate = Boolean(comp.contrato_indeterminado);
    const docRef = await addDoc(colRef, {
      ...comp,
      contrato_indeterminado: isIndeterminate,
      dataTerminoContrato: isIndeterminate ? '' : comp.dataTerminoContrato || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Criação', 'Empresa', docRef.id, `Cadastrada empresa ${comp.razaoSocial} (CNPJ: ${comp.cnpj})`);
    return docRef.id;
  };

  const updateCompany = async (id: string, comp: Partial<Company>) => {
    const docRef = doc(db, 'companies', id);
    const payload: Partial<Company> & { updatedAt: string } = {
      ...comp,
      updatedAt: new Date().toISOString(),
    };
    if ('contrato_indeterminado' in comp) {
      const isIndeterminate = Boolean(comp.contrato_indeterminado);
      payload.contrato_indeterminado = isIndeterminate;
      if (isIndeterminate) {
        payload.dataTerminoContrato = '';
      }
    }
    await updateDoc(docRef, payload);
    await logAudit('Atualização', 'Empresa', id, `Atualizados dados da empresa ${comp.razaoSocial || id}`);
  };

  const deleteCompany = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode excluir empresas.');
    }
    const comp = companies.find((c) => c.id === id);
    await deleteDoc(doc(db, 'companies', id));
    await logAudit('Exclusão', 'Empresa', id, `Excluída empresa ${comp?.razaoSocial || id}`);
  };

  const requestCompanyChange = async (
    companyId: string,
    proposedChanges: Partial<CompanyEditableFields>,
    justificativaSolicitante: string
  ): Promise<string> => {
    const company = companies.find((c) => c.id === companyId);
    if (!company) {
      throw new Error('Empresa não encontrada para solicitação de alteração cadastral.');
    }
    if (activeRole === 'solicitante' && activeEmpresaId && companyId !== activeEmpresaId) {
      throw new Error('Permissão negada: você só pode solicitar alteração para sua própria empresa.');
    }
    const cleanReason = (justificativaSolicitante || '').trim();
    if (!cleanReason) {
      throw new Error('Informe a justificativa para solicitar a alteração cadastral.');
    }

    const editableKeys: (keyof CompanyEditableFields)[] = [
      'razaoSocial',
      'nomeFantasia',
      'cnpj',
      'responsavelLegal',
      'responsavelSST',
      'telefone',
      'email',
      'endereco',
      'unidadeAtendimento',
      'atividadeContratada',
      'dataInicioContrato',
      'dataTerminoContrato',
      'contrato_indeterminado',
    ];

    const dadosAnteriores: Partial<CompanyEditableFields> = {};
    const dadosSolicitados: Partial<CompanyEditableFields> = {};

    for (const key of editableKeys) {
      if (key in proposedChanges && proposedChanges[key] !== undefined) {
        const oldVal = company[key];
        const newVal = proposedChanges[key];
        if (oldVal !== newVal) {
          (dadosAnteriores as any)[key] = oldVal ?? '';
          (dadosSolicitados as any)[key] = newVal;
        }
      }
    }

    if (Object.keys(dadosSolicitados).length === 0) {
      throw new Error('Nenhuma alteração foi detectada em relação ao cadastro atual da empresa.');
    }

    const nowIso = new Date().toISOString();
    const requestId = `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newReq: CompanyChangeRequest = {
      id: requestId,
      empresaId: companyId,
      solicitadoPorId: profile?.id || 'solicitante',
      solicitadoPorNome: profile?.nome || 'Solicitante',
      solicitadoPorEmail: profile?.email || '',
      dataSolicitacao: nowIso,
      justificativaSolicitante: cleanReason,
      dadosAnteriores,
      dadosSolicitados,
      status: 'pendente',
    };

    const existingList = company.solicitacoesAlteracao || [];
    const docRef = doc(db, 'companies', companyId);
    await updateDoc(docRef, {
      solicitacoesAlteracao: [newReq, ...existingList],
      updatedAt: nowIso,
    });

    await logAudit(
      'Solicitação de Alteração Cadastral',
      'Empresa',
      companyId,
      `Solicitação ${requestId} enviada por ${newReq.solicitadoPorNome} para "${company.razaoSocial}" (${Object.keys(dadosSolicitados).join(', ')}). Justificativa: ${cleanReason}`
    );

    return requestId;
  };

  const approveCompanyChange = async (
    companyId: string,
    requestId: string,
    observacao?: string
  ): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode aprovar alterações cadastrais.');
    }
    const company = companies.find((c) => c.id === companyId);
    if (!company) {
      throw new Error('Empresa não encontrada.');
    }
    const existingList = company.solicitacoesAlteracao || [];
    const targetReq = existingList.find((r) => r.id === requestId);
    if (!targetReq) {
      throw new Error('Solicitação de alteração cadastral não encontrada.');
    }
    if (targetReq.status !== 'pendente') {
      throw new Error('Esta solicitação já foi analisada anteriormente.');
    }

    const nowIso = new Date().toISOString();
    const adminName = profile?.nome || 'Administrador EHS';
    const updatedRequests: CompanyChangeRequest[] = existingList.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'aprovada',
            analisadoPorId: profile?.id || 'admin',
            analisadoPorNome: adminName,
            dataAnalise: nowIso,
            justificativaAnalise: (observacao || '').trim() || 'Alteração cadastral aprovada pelo Administrador EHS.',
          }
        : r
    );

    const appliedFields: Partial<CompanyEditableFields> = { ...targetReq.dadosSolicitados };
    if (appliedFields.contrato_indeterminado) {
      appliedFields.dataTerminoContrato = '';
    }

    const docRef = doc(db, 'companies', companyId);
    await updateDoc(docRef, {
      ...appliedFields,
      solicitacoesAlteracao: updatedRequests,
      updatedAt: nowIso,
    });

    await logAudit(
      'Aprovação de Alteração Cadastral',
      'Empresa',
      companyId,
      `Solicitação ${requestId} aprovada por ${adminName} para "${company.razaoSocial}". Campos atualizados: ${Object.keys(appliedFields).join(', ')}.`
    );
  };

  const rejectCompanyChange = async (
    companyId: string,
    requestId: string,
    justificativa: string
  ): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode recusar alterações cadastrais.');
    }
    const cleanReason = (justificativa || '').trim();
    if (!cleanReason) {
      throw new Error('A justificativa é obrigatória para recusar uma solicitação de alteração cadastral.');
    }
    const company = companies.find((c) => c.id === companyId);
    if (!company) {
      throw new Error('Empresa não encontrada.');
    }
    const existingList = company.solicitacoesAlteracao || [];
    const targetReq = existingList.find((r) => r.id === requestId);
    if (!targetReq) {
      throw new Error('Solicitação de alteração cadastral não encontrada.');
    }
    if (targetReq.status !== 'pendente') {
      throw new Error('Esta solicitação já foi analisada anteriormente.');
    }

    const nowIso = new Date().toISOString();
    const adminName = profile?.nome || 'Administrador EHS';
    const updatedRequests: CompanyChangeRequest[] = existingList.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: 'recusada',
            analisadoPorId: profile?.id || 'admin',
            analisadoPorNome: adminName,
            dataAnalise: nowIso,
            justificativaAnalise: cleanReason,
          }
        : r
    );

    const docRef = doc(db, 'companies', companyId);
    await updateDoc(docRef, {
      solicitacoesAlteracao: updatedRequests,
      updatedAt: nowIso,
    });

    await logAudit(
      'Recusa de Alteração Cadastral',
      'Empresa',
      companyId,
      `Solicitação ${requestId} recusada por ${adminName} para "${company.razaoSocial}". Justificativa: ${cleanReason}`
    );
  };

  const addEmployee = async (emp: Omit<Employee, 'id'>) => {
    const colRef = collection(db, 'employees');
    const docRef = await addDoc(colRef, {
      ...emp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Criação', 'Colaborador', docRef.id, `Cadastrado colaborador ${emp.nomeCompleto} (CPF: ${emp.cpf}) na empresa ${emp.empresaNome}`);
    return docRef.id;
  };

  const updateEmployee = async (id: string, emp: Partial<Employee>) => {
    const docRef = doc(db, 'employees', id);
    await updateDoc(docRef, {
      ...emp,
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Atualização', 'Colaborador', id, `Atualizada ficha do colaborador ${emp.nomeCompleto || id}`);
  };

  const deleteEmployee = async (id: string) => {
    const emp = employees.find((e) => e.id === id);
    await deleteDoc(doc(db, 'employees', id));
    await logAudit('Exclusão', 'Colaborador', id, `Excluído colaborador ${emp?.nomeCompleto || id}`);
  };

  const addDocument = async (docData: Omit<DocumentSST, 'id'>) => {
    const colRef = collection(db, 'documents');
    const initialVersion = {
      versao: 1,
      arquivoUrl: docData.arquivoUrl,
      arquivoNome: docData.arquivoNome,
      dataEnvio: new Date().toISOString(),
      responsavelEnvio: docData.responsavelEnvio || profile?.nome || 'Responsável',
      observacoes: docData.observacoes || '',
      situacao: docData.situacao || 'pendente',
    };

    const docRef = await addDoc(colRef, {
      ...docData,
      versao: 1,
      historicoVersoes: [initialVersion],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit(
      'Envio de Documento',
      'Documento',
      docRef.id,
      `Enviado documento "${docData.nomeDocumento}" categoria ${docData.categoria} para ${docData.empresaNome}`
    );
    return docRef.id;
  };

  const updateDocument = async (id: string, docData: Partial<DocumentSST>) => {
    const current = documents.find((d) => d.id === id);
    const docRef = doc(db, 'documents', id);

    let updatedVersions = current?.historicoVersoes || [];
    let newVersion = (current?.versao || 1);

    // If new file attached or resubmitted after rejection
    if (docData.arquivoUrl && docData.arquivoUrl !== current?.arquivoUrl) {
      newVersion += 1;
      updatedVersions = [
        ...updatedVersions,
        {
          versao: newVersion,
          arquivoUrl: docData.arquivoUrl,
          arquivoNome: docData.arquivoNome || 'Arquivo',
          dataEnvio: new Date().toISOString(),
          responsavelEnvio: profile?.nome || 'Responsável',
          observacoes: docData.observacoes || 'Reenvio de documento',
          situacao: 'pendente',
        },
      ];
    }

    await updateDoc(docRef, {
      ...docData,
      versao: newVersion,
      historicoVersoes: updatedVersions,
      updatedAt: new Date().toISOString(),
    });

    // Recalculate alerts if expiration date changed, preserving previous logs
    if (docData.dataValidade && docData.dataValidade !== current?.dataValidade) {
      await recalculateAlerts(
        id,
        docData.nomeDocumento || current?.nomeDocumento || 'Documento',
        docData.dataValidade,
        'Documento SST'
      );
    }

    await logAudit('Atualização', 'Documento', id, `Atualizado documento "${current?.nomeDocumento}"`);
  };

  const approveDocument = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode aprovar documentos.');
    }
    const current = documents.find((d) => d.id === id);
    const docRef = doc(db, 'documents', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';

    const updatedVersions = (current?.historicoVersoes || []).map((v) =>
      v.versao === current?.versao
        ? { ...v, situacao: 'aprovado' as DocumentStatus, analisadoPor, dataAnalise }
        : v
    );

    await updateDoc(docRef, {
      situacao: 'aprovado',
      analisadoPor,
      dataAnalise,
      motivoReprovacao: '',
      historicoVersoes: updatedVersions,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Aprovação',
      'Documento',
      id,
      `Documento "${current?.nomeDocumento}" aprovado por ${analisadoPor}`
    );
  };

  const rejectDocument = async (id: string, motivo: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode recusar documentos.');
    }
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('O motivo da reprovação é obrigatório.');
    }
    const current = documents.find((d) => d.id === id);
    const docRef = doc(db, 'documents', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';

    const updatedVersions = (current?.historicoVersoes || []).map((v) =>
      v.versao === current?.versao
        ? { ...v, situacao: 'reprovado' as DocumentStatus, motivoReprovacao: motivo.trim(), analisadoPor, dataAnalise }
        : v
    );

    await updateDoc(docRef, {
      situacao: 'reprovado',
      motivoReprovacao: motivo.trim(),
      analisadoPor,
      dataAnalise,
      historicoVersoes: updatedVersions,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Reprovação',
      'Documento',
      id,
      `Documento "${current?.nomeDocumento}" reprovado por ${analisadoPor}. Justificativa: ${motivo.trim()}`
    );
  };

  const deleteDocument = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode excluir documentos.');
    }
    const current = documents.find((d) => d.id === id);
    await deleteDoc(doc(db, 'documents', id));
    await logAudit('Exclusão', 'Documento', id, `Excluído documento "${current?.nomeDocumento}"`);
  };

  // Trainings
  const addTraining = async (trn: Omit<Training, 'id'>) => {
    const colRef = collection(db, 'trainings');
    const docRef = await addDoc(colRef, {
      ...trn,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit(
      'Criação',
      'Treinamento',
      docRef.id,
      `Cadastrado treinamento "${trn.nomeTreinamento}" para o colaborador ${trn.colaboradorNome}`
    );
    return docRef.id;
  };

  const updateTraining = async (id: string, trn: Partial<Training>) => {
    const current = trainings.find((t) => t.id === id);
    const docRef = doc(db, 'trainings', id);
    await updateDoc(docRef, {
      ...trn,
      updatedAt: new Date().toISOString(),
    });
    if (trn.dataValidade && trn.dataValidade !== current?.dataValidade) {
      await recalculateAlerts(
        id,
        trn.nomeTreinamento || current?.nomeTreinamento || 'Treinamento',
        trn.dataValidade,
        'Treinamento'
      );
    }
    await logAudit('Atualização', 'Treinamento', id, `Atualizado treinamento ${trn.nomeTreinamento || id}`);
  };

  const approveTraining = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode aprovar treinamentos.');
    }
    const trn = trainings.find((t) => t.id === id);
    const docRef = doc(db, 'trainings', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';
    await updateDoc(docRef, {
      situacao: 'aprovado',
      analisadoPor,
      dataAnalise,
      motivoReprovacao: '',
      updatedAt: dataAnalise,
    });
    await logAudit('Aprovação', 'Treinamento', id, `Treinamento "${trn?.nomeTreinamento}" aprovado por ${analisadoPor}`);
  };

  const rejectTraining = async (id: string, motivo: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode recusar treinamentos.');
    }
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('O motivo da reprovação é obrigatório.');
    }
    const trn = trainings.find((t) => t.id === id);
    const docRef = doc(db, 'trainings', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';
    await updateDoc(docRef, {
      situacao: 'reprovado',
      motivoReprovacao: motivo.trim(),
      analisadoPor,
      dataAnalise,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Reprovação',
      'Treinamento',
      id,
      `Treinamento "${trn?.nomeTreinamento}" reprovado por ${analisadoPor}. Justificativa: ${motivo.trim()}`
    );
  };

  const deleteTraining = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode excluir treinamentos.');
    }
    const trn = trainings.find((t) => t.id === id);
    await deleteDoc(doc(db, 'trainings', id));
    await logAudit('Exclusão', 'Treinamento', id, `Excluído treinamento "${trn?.nomeTreinamento}"`);
  };

  // Exams / ASO
  const addExam = async (exam: Omit<OccupationalExam, 'id'>) => {
    const colRef = collection(db, 'exams');
    const docRef = await addDoc(colRef, {
      ...exam,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit(
      'Criação',
      'Exame/ASO',
      docRef.id,
      `Cadastrado ${exam.tipoExame} (${exam.conclusao.toUpperCase()}) para ${exam.colaboradorNome}`
    );
    return docRef.id;
  };

  const updateExam = async (id: string, exam: Partial<OccupationalExam>) => {
    const current = exams.find((e) => e.id === id);
    const docRef = doc(db, 'exams', id);
    await updateDoc(docRef, {
      ...exam,
      updatedAt: new Date().toISOString(),
    });
    if (exam.dataValidade && exam.dataValidade !== current?.dataValidade) {
      await recalculateAlerts(
        id,
        exam.tipoExame || current?.tipoExame || 'Exame/ASO',
        exam.dataValidade,
        'Exame/ASO'
      );
    }
    await logAudit('Atualização', 'Exame/ASO', id, `Atualizado registro médico de ${exam.colaboradorNome || id}`);
  };

  const approveExam = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode aprovar exames e ASOs.');
    }
    const exam = exams.find((e) => e.id === id);
    const docRef = doc(db, 'exams', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';
    await updateDoc(docRef, {
      situacao: 'aprovado',
      analisadoPor,
      dataAnalise,
      motivoReprovacao: '',
      updatedAt: dataAnalise,
    });
    await logAudit('Aprovação', 'Exame/ASO', id, `${exam?.tipoExame || 'ASO'} de ${exam?.colaboradorNome || id} aprovado por ${analisadoPor}`);
  };

  const rejectExam = async (id: string, motivo: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode recusar exames e ASOs.');
    }
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('O motivo da reprovação é obrigatório.');
    }
    const exam = exams.find((e) => e.id === id);
    const docRef = doc(db, 'exams', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';
    await updateDoc(docRef, {
      situacao: 'reprovado',
      motivoReprovacao: motivo.trim(),
      analisadoPor,
      dataAnalise,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Reprovação',
      'Exame/ASO',
      id,
      `${exam?.tipoExame || 'ASO'} de ${exam?.colaboradorNome || id} reprovado por ${analisadoPor}. Justificativa: ${motivo.trim()}`
    );
  };

  const deleteExam = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Permissão negada: apenas o Administrador EHS pode excluir exames e ASOs.');
    }
    const exam = exams.find((e) => e.id === id);
    await deleteDoc(doc(db, 'exams', id));
    await logAudit('Exclusão', 'Exame/ASO', id, `Excluído ${exam?.tipoExame} de ${exam?.colaboradorNome}`);
  };

  // EPI
  const addEPIDelivery = async (epi: Omit<EPIDelivery, 'id'>) => {
    const colRef = collection(db, 'epiDeliveries');
    const docRef = await addDoc(colRef, {
      ...epi,
      createdAt: new Date().toISOString(),
    });
    await logAudit(
      'Entrega de EPI',
      'EPI',
      docRef.id,
      `Entregue ${epi.quantidade}x ${epi.nomeEpi} (CA: ${epi.caNumero}) para ${epi.colaboradorNome}`
    );
    return docRef.id;
  };

  const deleteEPIDelivery = async (id: string) => {
    await deleteDoc(doc(db, 'epiDeliveries', id));
    await logAudit('Exclusão', 'EPI', id, `Excluído registro de entrega de EPI`);
  };

  // Safety Permits (APR, PT, LOTO)
  const addSafetyPermit = async (permit: Omit<SafetyPermit, 'id'>) => {
    const colRef = collection(db, 'safetyPermits');
    const docRef = await addDoc(colRef, {
      ...permit,
      createdAt: new Date().toISOString(),
    });
    await logAudit('Emissão', 'Permissão SST', docRef.id, `Emitida ${permit.tipo}: ${permit.titulo} para ${permit.empresaNome}`);
    return docRef.id;
  };

  const updateSafetyPermit = async (id: string, permit: Partial<SafetyPermit>) => {
    const docRef = doc(db, 'safetyPermits', id);
    await updateDoc(docRef, permit);
    await logAudit('Atualização', 'Permissão SST', id, `Atualizada permissão de segurança`);
  };

  const deleteSafetyPermit = async (id: string) => {
    await deleteDoc(doc(db, 'safetyPermits', id));
    await logAudit('Exclusão', 'Permissão SST', id, `Excluída permissão de segurança`);
  };

  // Inspections
  const addInspection = async (insp: Omit<Inspection, 'id'>) => {
    const colRef = collection(db, 'inspections');
    const docRef = await addDoc(colRef, {
      ...insp,
      createdAt: new Date().toISOString(),
    });
    await logAudit('Registro', 'Inspeção', docRef.id, `Registrada ${insp.tipo}: ${insp.titulo}`);
    return docRef.id;
  };

  const updateInspection = async (id: string, insp: Partial<Inspection>) => {
    const docRef = doc(db, 'inspections', id);
    await updateDoc(docRef, insp);
  };

  // Action Plans
  const addActionPlan = async (plan: Omit<ActionPlan, 'id'>) => {
    const colRef = collection(db, 'actionPlans');
    const docRef = await addDoc(colRef, {
      ...plan,
      createdAt: new Date().toISOString(),
    });
    await logAudit('Criação', 'Plano de Ação', docRef.id, `Criado plano de ação: ${plan.descricaoAcao}`);
    return docRef.id;
  };

  const updateActionPlan = async (id: string, plan: Partial<ActionPlan>) => {
    const docRef = doc(db, 'actionPlans', id);
    await updateDoc(docRef, {
      ...plan,
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Atualização', 'Plano de Ação', id, `Plano de ação atualizado`);
  };

  const deleteActionPlan = async (id: string) => {
    await deleteDoc(doc(db, 'actionPlans', id));
    await logAudit('Exclusão', 'Plano de Ação', id, `Plano de ação excluído`);
  };

  // Environmental Docs
  const addEnvironmentalDoc = async (env: Omit<EnvironmentalDoc, 'id'>) => {
    const colRef = collection(db, 'environmentalDocs');
    const docRef = await addDoc(colRef, {
      ...env,
      createdAt: new Date().toISOString(),
    });
    await logAudit('Registro', 'Gestão Ambiental', docRef.id, `Registrada licença: ${env.nome}`);
    return docRef.id;
  };

  const updateEnvironmentalDoc = async (id: string, env: Partial<EnvironmentalDoc>) => {
    const current = environmentalDocs.find((e) => e.id === id);
    const docRef = doc(db, 'environmentalDocs', id);
    await updateDoc(docRef, env);
    if (env.dataValidade && env.dataValidade !== current?.dataValidade) {
      await recalculateAlerts(
        id,
        env.nome || current?.nome || 'Licença Ambiental',
        env.dataValidade,
        'Licença Ambiental'
      );
    }
  };

  // Notification Methods
  const addNotificationConfig = async (cfg: Omit<NotificationConfig, 'id'>) => {
    const colRef = collection(db, 'notificationConfigs');
    const docRef = await addDoc(colRef, {
      ...cfg,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Criação', 'Regra de Notificação', docRef.id, `Criada regra de notificação: ${cfg.nomeRegra}`);
    return docRef.id;
  };

  const updateNotificationConfig = async (id: string, cfg: Partial<NotificationConfig>) => {
    const docRef = doc(db, 'notificationConfigs', id);
    await updateDoc(docRef, {
      ...cfg,
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Atualização', 'Regra de Notificação', id, `Atualizada regra de notificação: ${cfg.nomeRegra || id}`);
  };

  const deleteNotificationConfig = async (id: string) => {
    const current = notificationConfigs.find((c) => c.id === id);
    await deleteDoc(doc(db, 'notificationConfigs', id));
    await logAudit('Exclusão', 'Regra de Notificação', id, `Excluída regra de notificação: ${current?.nomeRegra || id}`);
  };

  const parseApiResponse = async (resp: Response) => {
    const rawText = await resp.text();
    try {
      return JSON.parse(rawText);
    } catch {
      return {
        success: false,
        status: 'falha',
        message: `Erro HTTP ${resp.status} na comunicação com o servidor de e-mail.`,
        error: rawText ? rawText.slice(0, 300) : `HTTP ${resp.status} ${resp.statusText}`,
      };
    }
  };

  const getSessionSmtpOverride = (explicit?: SmtpSessionConfig): SmtpSessionConfig | undefined => {
    if (explicit && explicit.host && explicit.user && explicit.pass) return explicit;
    try {
      const raw = sessionStorage.getItem('gestao_sst_smtp_session');
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as SmtpSessionConfig;
      if (parsed && parsed.host && parsed.user && parsed.pass) return parsed;
    } catch {
      // Ignore invalid session storage
    }
    return undefined;
  };

  const triggerNotificationCheck = async (smtpConfig?: SmtpSessionConfig) => {
    try {
      const resolvedSmtp = getSessionSmtpOverride(smtpConfig);
      const resp = await authorizedFetch('/api/notifications/run-check', {
        method: 'POST',
        body: resolvedSmtp ? JSON.stringify({ smtpConfig: resolvedSmtp }) : undefined,
      });
      const data = await parseApiResponse(resp);
      if (!resp.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || 'Falha ao executar verificação no servidor.');
      }
      return data;
    } catch (err: any) {
      console.error('Erro ao acionar verificação no backend:', err);
      throw err;
    }
  };

  const sendTestNotificationEmail = async (
    recipient: string,
    subject?: string,
    message?: string,
    senderName?: string,
    smtpConfig?: SmtpSessionConfig
  ) => {
    try {
      const resolvedSmtp = getSessionSmtpOverride(smtpConfig);
      const resp = await authorizedFetch('/api/notifications/test-email', {
        method: 'POST',
        body: JSON.stringify({
          recipient,
          subject,
          message,
          senderName: senderName || profile?.nome || 'Administrador',
          ...(resolvedSmtp ? { smtpConfig: resolvedSmtp } : {}),
        }),
      });
      return await parseApiResponse(resp);
    } catch (err: any) {
      console.error('Erro ao enviar e-mail de teste:', err);
      throw err;
    }
  };

  const sendCustomNotificationEmail = async (data: {
    to: string[];
    recipientsDetails?: any[];
    companyId?: string;
    companyName?: string;
    subject: string;
    message: string;
    attachmentName?: string;
    attachmentDataUrl?: string;
    senderName?: string;
    senderEmail?: string;
    smtpConfig?: SmtpSessionConfig;
  }) => {
    try {
      const resolvedSmtp = getSessionSmtpOverride(data.smtpConfig);
      const resp = await authorizedFetch('/api/notifications/custom-send', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          ...(resolvedSmtp ? { smtpConfig: resolvedSmtp } : {}),
        }),
      });
      return await parseApiResponse(resp);
    } catch (err: any) {
      console.error('Erro ao enviar e-mail avulso:', err);
      throw err;
    }
  };

  const recalculateAlerts = async (docId: string, docTitle: string, newExpirationDate: string, entityType: string) => {
    try {
      await authorizedFetch('/api/notifications/recalculate', {
        method: 'POST',
        body: JSON.stringify({
          documentoId: docId,
          documentoTitulo: docTitle,
          novaDataValidade: newExpirationDate,
          entidade: entityType,
        }),
      });
    } catch (err) {
      console.warn('Erro ao notificar backend de recálculo de alertas:', err);
    }
  };

  // Seed benchmark 6 companies and 9 employees as required in Section 15
  const seedInitialBenchmarkData = async () => {
    try {
      const existingCompaniesSnap = await getDocs(collection(db, 'companies'));
      const companyMapByCnpj: Record<string, { id: string; razaoSocial: string }> = {};

      if (existingCompaniesSnap.empty) {
        // Create 6 companies
        for (const c of INITIAL_COMPANIES) {
          const docRef = await addDoc(collection(db, 'companies'), {
            ...c,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          companyMapByCnpj[c.cnpj] = { id: docRef.id, razaoSocial: c.razaoSocial };
        }
      } else {
        existingCompaniesSnap.forEach((d) => {
          const cData = d.data() as Company;
          companyMapByCnpj[cData.cnpj] = { id: d.id, razaoSocial: cData.razaoSocial };
        });
      }

      const existingEmployeesSnap = await getDocs(collection(db, 'employees'));
      if (existingEmployeesSnap.empty) {
        // Create 9 employees with preserved relations
        for (const item of INITIAL_EMPLOYEES) {
          const comp = companyMapByCnpj[item.empresaCnpj] || Object.values(companyMapByCnpj)[0];
          if (comp) {
            await addDoc(collection(db, 'employees'), {
              ...item.data,
              empresaId: comp.id,
              empresaNome: comp.razaoSocial,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Add sample initial legal documents and sample permits if empty
      const existingDocsSnap = await getDocs(collection(db, 'documents'));
      if (existingDocsSnap.empty) {
        const alvorada = Object.values(companyMapByCnpj)[0];
        if (alvorada) {
          // Documento regular (verde)
          await addDoc(collection(db, 'documents'), {
            nomeDocumento: 'PGR - Programa de Gerenciamento de Riscos 2026/2027',
            categoria: 'Documento Empresarial',
            empresaId: alvorada.id,
            empresaNome: alvorada.razaoSocial,
            numeroDocumento: 'PGR-2026-001',
            dataEmissao: '2026-01-10',
            dataValidade: '2027-01-10',
            semValidade: false,
            responsavelEnvio: 'Eng. Camila Toledo',
            arquivoUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            arquivoNome: 'PGR_Alvorada_2026.pdf',
            situacao: 'aprovado',
            versao: 1,
            analisadoPor: 'Administrador SST',
            dataAnalise: '2026-01-15T10:00:00Z',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Documento amarelo (vencendo em 20 dias)
          const in20Days = new Date();
          in20Days.setDate(in20Days.getDate() + 20);
          const in20DaysStr = in20Days.toISOString().split('T')[0];

          await addDoc(collection(db, 'documents'), {
            nomeDocumento: 'PCMSO - Programa de Controle Médico de Saúde Ocupacional',
            categoria: 'Documento Empresarial',
            empresaId: alvorada.id,
            empresaNome: alvorada.razaoSocial,
            numeroDocumento: 'PCMSO-REV-04',
            dataEmissao: '2025-11-20',
            dataValidade: in20DaysStr,
            semValidade: false,
            responsavelEnvio: 'Marcos Vinicius',
            arquivoUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            arquivoNome: 'PCMSO_Alvorada_Rev04.pdf',
            situacao: 'aprovado',
            versao: 1,
            analisadoPor: 'Administrador SST',
            dataAnalise: '2025-11-25T14:30:00Z',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Documento vencido (vermelho)
          const past30Days = new Date();
          past30Days.setDate(past30Days.getDate() - 25);
          const past30DaysStr = past30Days.toISOString().split('T')[0];

          await addDoc(collection(db, 'documents'), {
            nomeDocumento: 'LTCAT - Laudo Técnico das Condições Ambientais de Trabalho',
            categoria: 'Documento Empresarial',
            empresaId: alvorada.id,
            empresaNome: alvorada.razaoSocial,
            numeroDocumento: 'LTCAT-2024-EXP',
            dataEmissao: '2024-10-15',
            dataValidade: past30DaysStr,
            semValidade: false,
            responsavelEnvio: 'Marcos Vinicius',
            arquivoUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            arquivoNome: 'LTCAT_Alvorada_Vencido.pdf',
            situacao: 'aprovado',
            versao: 1,
            analisadoPor: 'Administrador SST',
            dataAnalise: '2024-10-20T09:00:00Z',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Documento pendente de análise (cinza/laranja)
          await addDoc(collection(db, 'documents'), {
            nomeDocumento: 'Ordem de Serviço de Segurança por Função (NR-01)',
            categoria: 'Documento Individual',
            empresaId: alvorada.id,
            empresaNome: alvorada.razaoSocial,
            numeroDocumento: 'OS-NR01-2026',
            dataEmissao: '2026-11-01',
            dataValidade: '2027-11-01',
            semValidade: false,
            responsavelEnvio: 'Marcos Vinicius',
            arquivoUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
            arquivoNome: 'OS_NR01_Alvorada.pdf',
            situacao: 'pendente',
            versao: 1,
            observacoes: 'Submissão para aprovação técnica da contratante',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      await logAudit('Carga Inicial', 'Sistema', 'benchmark', 'Base inicial de 6 empresas e 9 colaboradores carregada com sucesso.');
    } catch (err) {
      console.error('Erro ao semear dados de benchmark:', err);
    }
  };

  // ============================================================================
  // MATRIZ DE ATIVIDADES E DOCUMENTOS OBRIGATÓRIOS (GESTÃO DE TERCEIROS)
  // ============================================================================

  const stripUndefinedFields = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> => {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  };

  const assertAdminActor = (): { id: string; nome: string } => {
    if (!isAdmin || !profile?.id) {
      throw new Error(
        'Permissão negada: apenas o Administrador EHS pode cadastrar ou alterar a Matriz de Atividades e Documentos Obrigatórios.'
      );
    }
    return {
      id: profile.id,
      nome: profile.nome || 'Administrador EHS',
    };
  };

  const addActivityProfile = async (
    activity: Omit<
      ActivityProfile,
      'id' | 'criadoPorId' | 'criadoPorNome' | 'atualizadoPorId' | 'atualizadoPorNome' | 'createdAt' | 'updatedAt'
    >
  ): Promise<string> => {
    const adminActor = assertAdminActor();
    const nowIso = new Date().toISOString();
    const payload = stripUndefinedFields({
      ...activity,
      codigo: activity.codigo.trim().toUpperCase(),
      nome: activity.nome.trim(),
      criadoPorId: adminActor.id,
      criadoPorNome: adminActor.nome,
      atualizadoPorId: adminActor.id,
      atualizadoPorNome: adminActor.nome,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    try {
      const docRef = await addDoc(collection(db, 'activityProfiles'), payload);
      await logAudit(
        'Criação',
        'Atividade Crítica',
        docRef.id,
        `Cadastrada atividade "${activity.nome}" (${activity.codigo.trim().toUpperCase()}).`
      );
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'activityProfiles');
      throw error;
    }
  };

  const updateActivityProfile = async (id: string, updates: Partial<ActivityProfile>): Promise<void> => {
    const adminActor = assertAdminActor();
    const {
      id: _ignoredId,
      criadoPorId: _ignoredCreatorId,
      criadoPorNome: _ignoredCreatorName,
      createdAt: _ignoredCreatedAt,
      ...allowedUpdates
    } = updates;

    const payload = stripUndefinedFields({
      ...allowedUpdates,
      ...(allowedUpdates.codigo ? { codigo: allowedUpdates.codigo.trim().toUpperCase() } : {}),
      ...(allowedUpdates.nome ? { nome: allowedUpdates.nome.trim() } : {}),
      atualizadoPorId: adminActor.id,
      atualizadoPorNome: adminActor.nome,
      updatedAt: new Date().toISOString(),
    });

    try {
      await updateDoc(doc(db, 'activityProfiles', id), payload);
      await logAudit('Atualização', 'Atividade Crítica', id, `Atualizada atividade crítica (${id}).`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `activityProfiles/${id}`);
      throw error;
    }
  };

  const deactivateActivityProfile = async (id: string): Promise<void> => {
    await updateActivityProfile(id, { ativo: false });
  };

  const addActivityDocumentRequirement = async (
    reqData: Omit<
      ActivityDocumentRequirement,
      'id' | 'criadoPorId' | 'criadoPorNome' | 'atualizadoPorId' | 'atualizadoPorNome' | 'createdAt' | 'updatedAt'
    >
  ): Promise<string> => {
    const adminActor = assertAdminActor();
    const nowIso = new Date().toISOString();
    const payload = stripUndefinedFields({
      ...reqData,
      nomeExibicao: reqData.nomeExibicao.trim(),
      documentoCodigoCanonico: reqData.documentoCodigoCanonico.trim().toUpperCase(),
      criadoPorId: adminActor.id,
      criadoPorNome: adminActor.nome,
      atualizadoPorId: adminActor.id,
      atualizadoPorNome: adminActor.nome,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    try {
      const docRef = await addDoc(collection(db, 'activityDocumentRequirements'), payload);
      await logAudit(
        'Criação',
        'Requisito Documental',
        docRef.id,
        `Vinculado requisito "${reqData.nomeExibicao}" (${reqData.documentoCodigoCanonico}) à atividade ${reqData.activityId}.`
      );
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'activityDocumentRequirements');
      throw error;
    }
  };

  const updateActivityDocumentRequirement = async (
    id: string,
    updates: Partial<ActivityDocumentRequirement>
  ): Promise<void> => {
    const adminActor = assertAdminActor();
    const {
      id: _ignoredId,
      criadoPorId: _ignoredCreatorId,
      criadoPorNome: _ignoredCreatorName,
      createdAt: _ignoredCreatedAt,
      ...allowedUpdates
    } = updates;

    const payload = stripUndefinedFields({
      ...allowedUpdates,
      ...(allowedUpdates.nomeExibicao ? { nomeExibicao: allowedUpdates.nomeExibicao.trim() } : {}),
      ...(allowedUpdates.documentoCodigoCanonico
        ? { documentoCodigoCanonico: allowedUpdates.documentoCodigoCanonico.trim().toUpperCase() }
        : {}),
      atualizadoPorId: adminActor.id,
      atualizadoPorNome: adminActor.nome,
      updatedAt: new Date().toISOString(),
    });

    try {
      await updateDoc(doc(db, 'activityDocumentRequirements', id), payload);
      await logAudit(
        'Atualização',
        'Requisito Documental',
        id,
        `Atualizado requisito documental obrigatório (${id}).`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `activityDocumentRequirements/${id}`);
      throw error;
    }
  };

  const deactivateActivityDocumentRequirement = async (id: string): Promise<void> => {
    await updateActivityDocumentRequirement(id, { ativo: false });
  };

  /**
   * Carrega de forma estritamente idempotente os 5 templates iniciais de atividades críticas
   * e seus requisitos documentais obrigatórios, sem duplicar registros já existentes.
   */
  const seedInitialActivityTemplates = async (): Promise<{
    createdActivities: number;
    skippedActivities: number;
    createdRequirements: number;
    skippedRequirements: number;
  }> => {
    const adminActor = assertAdminActor();
    const nowIso = new Date().toISOString();

    let createdActivities = 0;
    let skippedActivities = 0;
    let createdRequirements = 0;
    let skippedRequirements = 0;

    try {
      const [existingActivitiesSnap, existingReqsSnap] = await Promise.all([
        getDocs(collection(db, 'activityProfiles')),
        getDocs(collection(db, 'activityDocumentRequirements')),
      ]);

      const existingActivities: ActivityProfile[] = existingActivitiesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ActivityProfile, 'id'>),
      }));

      const existingReqs: ActivityDocumentRequirement[] = existingReqsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ActivityDocumentRequirement, 'id'>),
      }));

      const buildRequirementSignature = (
        activityId: string,
        req: Pick<
          ActivityDocumentRequirement,
          'escopo' | 'origemColecao' | 'documentoCodigoCanonico' | 'aptidaoEspecifica' | 'funcoesAplicaveis'
        >
      ) => {
        const rolesKey = [...(req.funcoesAplicaveis || [])]
          .map((r) => r.trim().toLowerCase())
          .sort()
          .join('|');
        return `${activityId}::${req.escopo}::${req.origemColecao}::${req.documentoCodigoCanonico.trim().toUpperCase()}::${(req.aptidaoEspecifica || '').trim().toLowerCase()}::${rolesKey}`;
      };

      const existingReqTemplateKeys = new Set(
        existingReqs
          .filter((r) => Boolean(r.templateOrigem))
          .map((r) => `${r.activityId}::${r.templateOrigem}`)
      );
      const existingReqSignatures = new Set(
        existingReqs.map((r) => buildRequirementSignature(r.activityId, r))
      );

      for (const template of INITIAL_ACTIVITY_TEMPLATES) {
        const existingActivity = existingActivities.find(
          (a) =>
            a.codigo.trim().toUpperCase() === template.codigo.trim().toUpperCase() ||
            (a.templateOrigem && a.templateOrigem === template.templateKey)
        );

        let activityId: string;
        if (existingActivity) {
          activityId = existingActivity.id;
          skippedActivities += 1;
        } else {
          const activityPayload = stripUndefinedFields(
            buildActivityProfilePayloadFromTemplate(template, adminActor, nowIso)
          );
          const createdRef = await addDoc(collection(db, 'activityProfiles'), activityPayload);
          activityId = createdRef.id;
          existingActivities.push({
            id: activityId,
            ...(activityPayload as Omit<ActivityProfile, 'id'>),
          });
          createdActivities += 1;
        }

        const reqPayloads = buildRequirementsPayloadFromTemplate(
          template,
          activityId,
          adminActor,
          nowIso
        );

        for (const reqPayload of reqPayloads) {
          const tplKey = reqPayload.templateOrigem
            ? `${activityId}::${reqPayload.templateOrigem}`
            : '';
          const signature = buildRequirementSignature(activityId, reqPayload);

          if ((tplKey && existingReqTemplateKeys.has(tplKey)) || existingReqSignatures.has(signature)) {
            skippedRequirements += 1;
            continue;
          }

          await addDoc(
            collection(db, 'activityDocumentRequirements'),
            stripUndefinedFields(reqPayload)
          );
          if (tplKey) existingReqTemplateKeys.add(tplKey);
          existingReqSignatures.add(signature);
          createdRequirements += 1;
        }
      }

      await logAudit(
        'Carga Inicial',
        'Matriz de Atividades',
        'templates_padrao',
        `Templates iniciais processados (idempotente): ${createdActivities} atividades criadas (${skippedActivities} já existentes), ${createdRequirements} requisitos criados (${skippedRequirements} já existentes).`
      );

      return {
        createdActivities,
        skippedActivities,
        createdRequirements,
        skippedRequirements,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'activityProfiles');
      throw error;
    }
  };

  // ============================================================================
  // FLUXO SERVER-SIDE DE SOLICITAÇÃO, APROVAÇÃO E LIBERAÇÃO DE ATIVIDADES
  // (FAIL-CLOSED: NUNCA APROVA OU LIBERA DIRETAMENTE PELO CLIENTE)
  // ============================================================================
  const invokePermitApi = async <T,>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> => {
    const resp = await authorizedFetch(path, init);
    const data = await parseApiResponse(resp);
    if (!resp.ok || data?.success === false) {
      throw new PermitApiClientError(
        data?.message || data?.error || `Falha HTTP ${resp.status} ao processar operação no servidor.`,
        resp.status,
        {
          code: data?.code,
          compliance: data?.compliance,
          motivosBloqueio: data?.motivosBloqueio,
          errors: data?.errors,
        }
      );
    }
    return data as T;
  };

  const createPermitDraftOnServer = async (
    payload: PermitServerDraftInput
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>('/api/permits', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const updatePermitDraftOnServer = async (
    id: string,
    payload: Partial<PermitServerDraftInput>
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const evaluatePermitOnServer = async (
    id: string
  ): Promise<PermitServerEvaluationResult> => {
    const res = await invokePermitApi<PermitServerEvaluationResult & { success: boolean }>(
      `/api/permits/${encodeURIComponent(id)}/compliance`,
      { method: 'GET' }
    );
    return {
      permit: res.permit,
      compliance: res.compliance,
      complianceFingerprint: res.complianceFingerprint,
      versaoConcorrencia: res.versaoConcorrencia,
      controlesOperacionais: res.controlesOperacionais,
      structuralErrors: res.structuralErrors || [],
    };
  };

  const submitPermitOnServer = async (
    id: string,
    opts?: PermitServerActionInput
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const startPermitReviewOnServer = async (
    id: string,
    opts?: PermitServerActionInput
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/start-review`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const requestPermitDocsOnServer = async (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/request-docs`, {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const requestPermitCorrectionOnServer = async (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/request-correction`, {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const approvePermitOnServer = async (
    id: string,
    opts?: PermitServerActionInput
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const releasePermitOnServer = async (
    id: string,
    opts?: PermitServerActionInput
  ): Promise<{ permit: SafetyPermit; compliance: ActivityComplianceResult }> => {
    const res = await invokePermitApi<{
      permit: SafetyPermit;
      compliance: ActivityComplianceResult;
    }>(`/api/permits/${encodeURIComponent(id)}/release`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
    return { permit: res.permit, compliance: res.compliance };
  };

  const rejectPermitOnServer = async (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ): Promise<SafetyPermit> => {
    const res = await invokePermitApi<{ permit: SafetyPermit }>(
      `/api/permits/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      }
    );
    return res.permit;
  };

  const cancelPermitOnServer = async (
    id: string,
    opts: PermitServerActionInput & { justificativa: string }
  ): Promise<SafetyPermit> => {
    const res = await invokePermitApi<{ permit: SafetyPermit }>(
      `/api/permits/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      }
    );
    return res.permit;
  };

  const closePermitOnServer = async (
    id: string,
    opts?: PermitServerActionInput
  ): Promise<SafetyPermit> => {
    const res = await invokePermitApi<{ permit: SafetyPermit }>(
      `/api/permits/${encodeURIComponent(id)}/close`,
      {
        method: 'POST',
        body: JSON.stringify(opts || {}),
      }
    );
    return res.permit;
  };

  // ============================================================================
  // CENTRAL DE INTEGRAÇÃO DE TERCEIROS (SERVER-SIDE WORKFLOW /api/integrations/*)
  // ============================================================================
  const invokeIntegrationApi = async <T,>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> => {
    const resp = await authorizedFetch(path, init);
    const data = await parseApiResponse(resp);
    if (!resp.ok || data?.success === false) {
      throw new IntegrationApiClientError(
        data?.message || data?.error || `Erro HTTP ${resp.status} ao comunicar com a Central de Integração.`,
        resp.status,
        data?.code,
        data
      );
    }
    return data as T;
  };

  const listIntegrationsOnServer = async (): Promise<ContractorIntegration[]> => {
    const res = await invokeIntegrationApi<{ integrations: ContractorIntegration[] }>(
      '/api/integrations',
      { method: 'GET' }
    );
    const list = (res.integrations || []).slice().sort((a, b) =>
      (b.dataUltimaAtualizacao || '').localeCompare(a.dataUltimaAtualizacao || '')
    );
    setContractorIntegrations(list);
    setIntegrationFirestoreError(null);
    return list;
  };

  const listIntegrationItemsOnServer = async (): Promise<MirroredIntegrationDocumentItem[]> => {
    const res = await invokeIntegrationApi<{ items: MirroredIntegrationDocumentItem[] }>(
      '/api/integrations/items',
      { method: 'GET' }
    );
    const list = (res.items || []).slice().sort((a, b) =>
      (b.updatedAt || b.dataEnvio || b.createdAt || '').localeCompare(
        a.updatedAt || a.dataEnvio || a.createdAt || ''
      )
    );
    setContractorIntegrationItems(list);
    setIntegrationFirestoreError(null);
    return list;
  };

  const getIntegrationDetailOnServer = async (
    id: string
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}`,
      { method: 'GET' }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const checkIntegrationDuplicatesOnServer = async (input: {
    cnpj?: string;
    cpf?: string;
  }): Promise<IntegrationDuplicateCheckResult> => {
    const res = await invokeIntegrationApi<IntegrationDuplicateCheckResult & { success: boolean }>(
      '/api/integrations/check-duplicates',
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    return {
      cnpjDuplicado: Boolean(res.cnpjDuplicado),
      empresaExistente: res.empresaExistente,
      cpfDuplicado: Boolean(res.cpfDuplicado),
      colaboradorExistente: res.colaboradorExistente,
    };
  };

  const createIntegrationOnServer = async (
    payload: IntegrationServerCreateInput
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      '/api/integrations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const uploadIntegrationBatchOnServer = async (
    id: string,
    payload: {
      files: IntegrationBatchFilePayload[];
      autoSubmit?: boolean;
      expectedVersion?: number;
    }
  ): Promise<IntegrationServerDetailResult & { uploadedCount: number }> => {
    const res = await invokeIntegrationApi<
      IntegrationServerDetailResult & { uploadedCount: number; success: boolean }
    >(`/api/integrations/${encodeURIComponent(id)}/documents/batch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
      uploadedCount: res.uploadedCount ?? payload.files.length,
    };
  };

  const uploadIntegrationDocumentOnServer = async (
    id: string,
    payload: IntegrationBatchFilePayload,
    onProgress?: (percent: number) => void
  ): Promise<IntegrationSingleUploadResult> => {
    const url = `/api/integrations/${encodeURIComponent(id)}/documents/upload`;
    const authHeaders = getAuthHeaders();

    if (typeof XMLHttpRequest === 'undefined') {
      const res = await invokeIntegrationApi<IntegrationSingleUploadResult & { success: boolean }>(
        url,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      onProgress?.(100);
      upsertIntegrationInState(res.integration);
      return {
        integration: res.integration,
        items: res.items || [],
        item: res.item,
        compliancePreview: res.compliancePreview ?? null,
        submissionReadiness: res.submissionReadiness,
        uploadedFile: res.uploadedFile,
      };
    }

    return new Promise<IntegrationSingleUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(authHeaders)) {
        if (v) xhr.setRequestHeader(k, v);
      }

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          // Reserve 90-100% for server validation & storage commit
          const pct = Math.min(92, Math.max(5, Math.round((evt.loaded / evt.total) * 92)));
          onProgress?.(pct);
        }
      };

      xhr.onerror = () => {
        reject(
          new IntegrationApiClientError(
            'Falha de conexão durante o envio do arquivo. Verifique a rede e tente reenviar.',
            0,
            'NETWORK_ERROR'
          )
        );
      };

      xhr.ontimeout = () => {
        reject(
          new IntegrationApiClientError(
            'Tempo limite excedido ao enviar o arquivo. Tente reenviar este item.',
            408,
            'UPLOAD_TIMEOUT'
          )
        );
      };

      xhr.onload = () => {
        let parsed: any = {};
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          parsed = {};
        }

        if (xhr.status >= 200 && xhr.status < 300 && parsed?.success) {
          onProgress?.(100);
          upsertIntegrationInState(parsed.integration, parsed.items || []);
          resolve({
            integration: parsed.integration,
            items: parsed.items || [],
            item: parsed.item,
            compliancePreview: parsed.compliancePreview ?? null,
            submissionReadiness: parsed.submissionReadiness,
            uploadedFile: parsed.uploadedFile,
          });
          return;
        }

        reject(
          new IntegrationApiClientError(
            parsed?.message || `Falha ao enviar "${payload.arquivoNome}" (HTTP ${xhr.status}).`,
            xhr.status,
            parsed?.code,
            parsed
          )
        );
      };

      xhr.timeout = 90_000;
      onProgress?.(5);
      xhr.send(JSON.stringify(payload));
    });
  };

  const fetchIntegrationItemFileBlobOnServer = async (
    integrationId: string,
    itemId: string,
    opts?: { version?: number; download?: boolean }
  ): Promise<IntegrationFileBlobResult> => {
    const query = new URLSearchParams();
    if (opts?.version && opts.version > 0) {
      query.set('version', String(opts.version));
    }
    if (opts?.download) {
      query.set('download', '1');
    }
    const qs = query.toString();
    const url = `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(
      itemId
    )}/file${qs ? `?${qs}` : ''}`;

    const resp = await authorizedFetch(url, { method: 'GET' });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new IntegrationApiClientError(
        errData?.message || `Não foi possível carregar o arquivo (HTTP ${resp.status}).`,
        resp.status,
        errData?.code,
        errData
      );
    }

    const blob = await resp.blob();
    const contentType = (resp.headers.get('Content-Type') || blob.type || 'application/pdf').split(';')[0].trim();
    const mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' =
      contentType === 'image/jpeg' || contentType === 'image/png' ? contentType : 'application/pdf';

    const disp = resp.headers.get('Content-Disposition') || '';
    const match = disp.match(/filename="([^"]+)"/i);
    const fileName = match?.[1] || 'documento';

    return { blob, mimeType, fileName };
  };

  const renewIntegrationItemOnServer = async (
    integrationId: string,
    itemId: string,
    payload: IntegrationBatchFilePayload
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(itemId)}/renew`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const submitIntegrationOnServer = async (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/submit`,
      {
        method: 'POST',
        body: JSON.stringify(opts || {}),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const startIntegrationReviewOnServer = async (
    id: string,
    opts?: { expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/start-review`,
      {
        method: 'POST',
        body: JSON.stringify(opts || {}),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const reviewIntegrationItemOnServer = async (
    integrationId: string,
    itemId: string,
    payload: IntegrationReviewItemPayload
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(itemId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const updateIntegrationItemValidityOnServer = async (
    integrationId: string,
    itemId: string,
    payload: {
      dataValidade?: string;
      semValidade?: boolean;
      observacoes?: string;
      expectedVersion?: number;
    }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(integrationId)}/items/${encodeURIComponent(itemId)}/validity`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const requestIntegrationCorrectionOnServer = async (
    id: string,
    opts: { justificativa: string; expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/request-correction`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const approveIntegrationOnServer = async (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(opts || {}),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const rejectIntegrationOnServer = async (
    id: string,
    opts: { justificativa: string; expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(opts),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  const closeIntegrationOnServer = async (
    id: string,
    opts?: { justificativa?: string; expectedVersion?: number }
  ): Promise<IntegrationServerDetailResult> => {
    const res = await invokeIntegrationApi<IntegrationServerDetailResult & { success: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}/close`,
      {
        method: 'POST',
        body: JSON.stringify(opts || {}),
      }
    );
    upsertIntegrationInState(res.integration, res.items || []);
    return {
      integration: res.integration,
      items: res.items || [],
      compliancePreview: res.compliancePreview ?? null,
      submissionReadiness: res.submissionReadiness,
    };
  };

  // Hydrate contractorIntegrations + mirrored contractorIntegrationItems strictly via authenticated backend API
  useEffect(() => {
    if (!profile?.id) {
      setContractorIntegrations([]);
      setContractorIntegrationItems([]);
      setIntegrationFirestoreError(null);
      return;
    }
    let cancelled = false;
    const syncMirrored = async () => {
      try {
        const [list, items] = await Promise.all([
          listIntegrationsOnServer(),
          listIntegrationItemsOnServer(),
        ]);
        if (!cancelled) {
          setContractorIntegrations(list);
          setContractorIntegrationItems(items);
          setIntegrationFirestoreError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          if (
            err?.code === 'FIRESTORE_RULES_NOT_PUBLISHED' ||
            err?.code === 'FIREBASE_ADMIN_NOT_CONFIGURED'
          ) {
            setIntegrationFirestoreError(err.message);
          }
        }
      }
    };
    syncMirrored();

    const handleFocus = () => {
      void syncMirrored();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [profile?.id, activeRole, activeEmpresaId]);

  // Run benchmark seed on start if database is empty
  useEffect(() => {
    const checkAndSeed = async () => {
      try {
        const snap = await getDocs(collection(db, 'companies'));
        if (snap.empty) {
          await seedInitialBenchmarkData();
        }

        // Seed default notification configuration rule if none exists
        const notifSnap = await getDocs(collection(db, 'notificationConfigs'));
        if (notifSnap.empty) {
          await addDoc(collection(db, 'notificationConfigs'), {
            nomeRegra: 'Alerta Geral SESMT - 30d, 15d e Vencimento',
            destinatarios: ['sesmt@gestao-ehs.com.br', 'seguranca.trabalho@empresa.com.br'],
            empresaId: 'todas',
            empresaNome: 'Todas as Empresas',
            colaboradorId: 'todos',
            colaboradorNome: 'Todos os Colaboradores',
            categoria: 'todas',
            marcos: ['30_dias', '15_dias', 'hoje'],
            ativo: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          await logAudit(
            'Carga Inicial',
            'Configuração de Notificação',
            'default',
            'Regra padrão de notificação por e-mail inicializada com sucesso.'
          );
        }
      } catch (e) {
        console.warn('Verificando inicialização:', e);
      }
    };
    checkAndSeed();
  }, []);

  return (
    <SSTContext.Provider
      value={{
        companies,
        employees,
        documents,
        trainings,
        exams,
        epiDeliveries,
        safetyPermits,
        inspections,
        actionPlans,
        environmentalDocs,
        auditLogs,
        userProfiles,
        activityProfiles,
        activityDocumentRequirements,
        smartDocs,
        contractorIntegrations,
        contractorIntegrationItems,
        activityMatrixFirestoreError,
        integrationFirestoreError,
        notificationConfigs,
        notificationLogs,
        loading,
        addCompany,
        updateCompany,
        deleteCompany,
        requestCompanyChange,
        approveCompanyChange,
        rejectCompanyChange,
        addEmployee,
        updateEmployee,
        deleteEmployee,
        addDocument,
        updateDocument,
        approveDocument,
        rejectDocument,
        deleteDocument,
        addTraining,
        updateTraining,
        approveTraining,
        rejectTraining,
        deleteTraining,
        addExam,
        updateExam,
        approveExam,
        rejectExam,
        deleteExam,
        addEPIDelivery,
        deleteEPIDelivery,
        addSafetyPermit,
        updateSafetyPermit,
        deleteSafetyPermit,
        addInspection,
        updateInspection,
        addActionPlan,
        updateActionPlan,
        deleteActionPlan,
        addEnvironmentalDoc,
        updateEnvironmentalDoc,
        addNotificationConfig,
        updateNotificationConfig,
        deleteNotificationConfig,
        triggerNotificationCheck,
        sendTestNotificationEmail,
        sendCustomNotificationEmail,
        recalculateAlerts,
        addActivityProfile,
        updateActivityProfile,
        deactivateActivityProfile,
        addActivityDocumentRequirement,
        updateActivityDocumentRequirement,
        deactivateActivityDocumentRequirement,
        seedInitialActivityTemplates,
        createPermitDraftOnServer,
        updatePermitDraftOnServer,
        evaluatePermitOnServer,
        submitPermitOnServer,
        startPermitReviewOnServer,
        requestPermitDocsOnServer,
        requestPermitCorrectionOnServer,
        approvePermitOnServer,
        releasePermitOnServer,
        rejectPermitOnServer,
        cancelPermitOnServer,
        closePermitOnServer,
        listIntegrationsOnServer,
        listIntegrationItemsOnServer,
        getIntegrationDetailOnServer,
        checkIntegrationDuplicatesOnServer,
        createIntegrationOnServer,
        uploadIntegrationBatchOnServer,
        uploadIntegrationDocumentOnServer,
        fetchIntegrationItemFileBlobOnServer,
        renewIntegrationItemOnServer,
        submitIntegrationOnServer,
        startIntegrationReviewOnServer,
        reviewIntegrationItemOnServer,
        updateIntegrationItemValidityOnServer,
        requestIntegrationCorrectionOnServer,
        approveIntegrationOnServer,
        rejectIntegrationOnServer,
        closeIntegrationOnServer,
        seedInitialBenchmarkData,
      }}
    >
      {children}
    </SSTContext.Provider>
  );
};

export const useSST = () => {
  const context = useContext(SSTContext);
  if (!context) {
    throw new Error('useSST must be used within an SSTProvider');
  }
  return context;
};
