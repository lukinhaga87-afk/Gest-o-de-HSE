import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './notificationEngine';
import type {
  Company,
  Employee,
  SmartDocCategoryGroup,
  SmartDocExtractedData,
  SmartDocHistoryEntry,
  SmartDocInconsistency,
  SmartDocProcessingAttempt,
  SmartDocProcessingState,
  SmartDocRecord,
  SmartDocValidityRule,
  SmartDocValidityStatus,
  UserRole,
} from '../src/types/sst';

export const PRIMARY_SMARTDOC_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_SMARTDOC_MODEL = 'gemini-3.1-flash-lite';
export const SMARTDOC_MODEL = PRIMARY_SMARTDOC_MODEL;
export const PROGRESSIVE_RETRY_DELAYS_MS = [5000, 15000, 30000] as const;
// Bounded server-side exponential backoff for primary model before triggering fallback model
export const PRIMARY_EXPONENTIAL_BACKOFF_MS = [1000, 2000] as const;
export const SERVERLESS_PRIMARY_BACKOFF_MS = [600, 1200] as const;
export const FALLBACK_RETRY_BACKOFF_MS = [1500] as const;
export const SERVERLESS_FALLBACK_BACKOFF_MS = [800] as const;
export const DEFAULT_PRIMARY_MAX_RETRIES = 2; // Local Node: 1 initial + up to 2 exponential backoff retries (max 3 attempts)
export const SERVERLESS_PRIMARY_MAX_RETRIES = 1; // Netlify Functions: 1 initial + 1 fast retry before immediate fallback
export const DEFAULT_FALLBACK_MAX_RETRIES = 1; // 1 initial + up to 1 retry (max 2 attempts)
export const MAX_TOTAL_ATTEMPTS_PER_RUN = 5;
// 4 MB binary (~5.33 MB base64 JSON) stays safely within Netlify Functions' 6 MB synchronous request limit
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_FIRESTORE_INLINE_DATAURL_CHARS = 700_000; // Safe below Firestore 1 MiB document cap
export const MAX_FILE_CHUNK_CHARS = 500_000; // Chunk size for files > 500 KB up to 4 MB

export function isNetlifyServerlessRuntime(): boolean {
  return Boolean(
    process.env.NETLIFY === 'true' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT ||
      process.env.SITE_ID ||
      process.env.DEPLOY_ID ||
      process.env.NETLIFY_LOCAL === 'true'
  );
}

export function getSmartDocTimeoutMs(): number {
  const configured = Number(process.env.SMARTDOC_AI_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 3000) {
    return Math.round(configured);
  }
  return isNetlifyServerlessRuntime() ? 9000 : 25000;
}

export function getSmartDocTotalBudgetMs(): number {
  const configured = Number(process.env.SMARTDOC_AI_TOTAL_BUDGET_MS);
  if (Number.isFinite(configured) && configured >= 8000) {
    return Math.round(configured);
  }
  return isNetlifyServerlessRuntime() ? 20000 : 60000;
}

export const DEFAULT_SMARTDOC_TIMEOUT_MS = getSmartDocTimeoutMs();
export const DEFAULT_SMARTDOC_TOTAL_BUDGET_MS = getSmartDocTotalBudgetMs();

const PROHIBITED_DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
  'gemini-pro',
  'gemini-pro-vision',
  'gemini-4-argon',
  'gemini-4-carbon',
]);

function cleanEnvValue(raw?: string): string {
  let v = (raw || '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getConfiguredPrimaryModel(): string {
  const configured = cleanEnvValue(process.env.GEMINI_MODEL);
  if (configured && !PROHIBITED_DEPRECATED_MODELS.has(configured.toLowerCase())) {
    return configured;
  }
  return PRIMARY_SMARTDOC_MODEL;
}

export type SmartDocAiErrorCode =
  | 'AI_UNAVAILABLE_503'
  | 'AI_INTERNAL_500'
  | 'AI_RATE_LIMIT_429'
  | 'AI_TIMEOUT'
  | 'AI_BAD_REQUEST_400'
  | 'MODEL_UNAVAILABLE_404'
  | 'INVALID_PDF'
  | 'INCOMPATIBLE_FILE'
  | 'GEMINI_AUTH_401'
  | 'GEMINI_PERMISSION_403'
  | 'GEMINI_API_KEY_MISSING'
  | 'GEMINI_API_KEY_INVALID'
  | 'AI_PROCESSING_FAILED';

const GEMINI_PLACEHOLDER_VALUES = new Set([
  'MY_GEMINI_API_KEY',
  'CONFIGURE_YOUR_GEMINI_API_KEY',
  'YOUR_API_KEY',
  'YOUR_GEMINI_API_KEY',
  'REPLACE_ME',
  'undefined',
  'null',
]);

export function sanitizeGeminiErrorText(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/AQ\.[0-9A-Za-z._-]{10,}/g, '[REDACTED_KEY]')
    .replace(/ya29\.[0-9A-Za-z._-]+/g, '[REDACTED_TOKEN]')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED_KEY]')
    .replace(/(x-goog-api-key[:\s=]+)[^\s"',}]+/gi, '$1[REDACTED_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_TOKEN]');
}

function getRawSanitizedGeminiApiKey(): string {
  let raw = (process.env.GEMINI_API_KEY || '').trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

export type GeminiKeyReason =
  | 'ok'
  | 'missing'
  | 'placeholder'
  | 'malformed'
  | 'oauth_token_not_supported';

export function getGeminiIntegrationStatus(): {
  configured: boolean;
  reason: GeminiKeyReason;
  diagnosticMessage: string;
} {
  const key = getRawSanitizedGeminiApiKey();
  if (!key) {
    return {
      configured: false,
      reason: 'missing',
      diagnosticMessage:
        'Serviço de leitura inteligente (Gemini AI) indisponível: variável de ambiente GEMINI_API_KEY não configurada no servidor/Netlify.',
    };
  }
  if (GEMINI_PLACEHOLDER_VALUES.has(key)) {
    return {
      configured: false,
      reason: 'placeholder',
      diagnosticMessage:
        'Serviço de leitura inteligente (Gemini AI) indisponível: GEMINI_API_KEY contém valor de exemplo/placeholder no servidor.',
    };
  }
  if (/^bearer\s+/i.test(key) || key.startsWith('ya29.')) {
    return {
      configured: false,
      reason: 'oauth_token_not_supported',
      diagnosticMessage:
        'A variável GEMINI_API_KEY contém um token OAuth/Bearer, que não é aceito (ACCESS_TOKEN_TYPE_UNSUPPORTED). Configure uma chave de API Gemini gerada no Google AI Studio.',
    };
  }
  if (key.startsWith('GEMINI_API_KEY=') || /\s/.test(key) || key.length < 20) {
    return {
      configured: false,
      reason: 'malformed',
      diagnosticMessage:
        'Serviço de leitura inteligente (Gemini AI) indisponível: GEMINI_API_KEY possui formato inválido no ambiente do servidor (verifique espaços, prefixos ou truncamento).',
    };
  }
  return {
    configured: true,
    reason: 'ok',
    diagnosticMessage: '',
  };
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  // Explicitly force vertexai: false so @google/genai ALWAYS targets the Gemini Developer API
  // (https://generativelanguage.googleapis.com/) authenticated exclusively via x-goog-api-key,
  // never falling back to Vertex AI (aiplatform.googleapis.com) or OAuth Bearer tokens.
  return new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class SmartDocsValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(message: string, statusCode = 400, code = 'SMARTDOC_VALIDATION_ERROR') {
    super(message);
    this.name = 'SmartDocsValidationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class SmartDocsAiConfigError extends Error {
  readonly statusCode: number;
  readonly code: SmartDocAiErrorCode;
  readonly retryable = false;
  constructor(
    message: string,
    code: SmartDocAiErrorCode = 'GEMINI_API_KEY_MISSING',
    statusCode = 503
  ) {
    super(message);
    this.name = 'SmartDocsAiConfigError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SmartDocsAiProcessingError extends Error {
  readonly statusCode: number;
  readonly code: SmartDocAiErrorCode;
  readonly retryable: boolean;
  readonly modelUsed: string;
  readonly fallbackUsed: boolean;
  readonly attemptsLog: SmartDocProcessingAttempt[];
  readonly attemptsSummary: string;

  constructor(params: {
    message: string;
    statusCode: number;
    code: SmartDocAiErrorCode;
    retryable: boolean;
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsLog: SmartDocProcessingAttempt[];
    attemptsSummary?: string;
  }) {
    super(params.message);
    this.name = 'SmartDocsAiProcessingError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.retryable = params.retryable;
    this.modelUsed = params.modelUsed;
    this.fallbackUsed = params.fallbackUsed;
    this.attemptsLog = params.attemptsLog;
    this.attemptsSummary = params.attemptsSummary ?? formatAttemptsAuditSummary(params.attemptsLog);
  }
}

export const ALLOWED_MIME_TYPES = new Set<SmartDocRecord['arquivoMimeType']>([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

export const DOCUMENT_TAXONOMY: Record<SmartDocCategoryGroup, string[]> = {
  saude_ocupacional: [
    'ASO',
    'Exames ocupacionais',
    'Atestados de saúde ocupacional',
  ],
  treinamentos: [
    'NR-01',
    'NR-05',
    'NR-06',
    'NR-10',
    'NR-11',
    'NR-12',
    'NR-13',
    'NR-18',
    'NR-20',
    'NR-23',
    'NR-26',
    'NR-33',
    'NR-35',
    'Operador de empilhadeira',
    'Operador de plataforma elevatória',
    'Operador de guindaste',
    'Outros treinamentos',
  ],
  documentos_empresariais: [
    'PGR',
    'PCMSO',
    'LTCAT',
    'APR',
    'Procedimentos de segurança',
    'Documentação de terceiros',
  ],
  outros: ['Classificação manual', 'Documento não listado'],
};

function getTodayBrazilIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function normalizeDigits(value?: string): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function normalizeText(value?: string): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIsoDate(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (year >= 1950 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
  }

  const brMatch = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (year >= 1950 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
  }

  return '';
}

function addMonthsIso(dateIso: string, months: number): string {
  const norm = normalizeIsoDate(dateIso);
  if (!norm || !Number.isFinite(months) || months <= 0) return '';
  const [y, m, d] = norm.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + Math.round(months));
  return dt.toISOString().split('T')[0];
}

function computeDaysDiff(targetIso: string, baseIso: string): number | null {
  const t = normalizeIsoDate(targetIso);
  const b = normalizeIsoDate(baseIso);
  if (!t || !b) return null;
  const targetMs = new Date(`${t}T00:00:00Z`).getTime();
  const baseMs = new Date(`${b}T00:00:00Z`).getTime();
  return Math.ceil((targetMs - baseMs) / (1000 * 60 * 60 * 24));
}

export function validateUploadedFile(params: {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}): {
  mimeType: SmartDocRecord['arquivoMimeType'];
  base64Data: string;
  buffer: Buffer;
  cleanDataUrl: string;
  sha256: string;
  sizeBytes: number;
} {
  const fileName = (params.fileName || '').trim();
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const allowedExts = new Set(['pdf', 'jpg', 'jpeg', 'png']);

  if (!fileName || !allowedExts.has(ext)) {
    throw new SmartDocsValidationError(
      'Formato de arquivo não permitido. Aceitos exclusivamente: PDF, JPG, JPEG e PNG.',
      400,
      'INVALID_FILE_EXTENSION'
    );
  }

  const rawDataUrl = (params.dataUrl || '').trim();
  const dataUrlMatch = rawDataUrl.match(/^data:([^,]*);base64,([\s\S]+)$/);
  if (!dataUrlMatch) {
    throw new SmartDocsValidationError(
      'Conteúdo do arquivo inválido. Envie um arquivo codificado corretamente.',
      400,
      'INVALID_FILE_PAYLOAD'
    );
  }

  const rawHeaderMeta = (dataUrlMatch[1] || '').trim().toLowerCase();
  const detectedMimeRaw = rawHeaderMeta.split(';')[0].trim();
  const base64Data = dataUrlMatch[2].replace(/\s+/g, '');

  if (!base64Data || !/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw new SmartDocsValidationError(
      'Conteúdo binário (base64) do arquivo está corrompido ou incompleto.',
      400,
      'INVALID_FILE_PAYLOAD'
    );
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) {
    throw new SmartDocsValidationError('O arquivo enviado está vazio.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new SmartDocsValidationError(
      'Arquivo excede o limite máximo de 4 MB para processamento seguro.',
      413,
      'FILE_TOO_LARGE'
    );
  }

  // Magic-byte verification to block disguised executables/scripts and infer real format
  // Allow %PDF- within first 1024 bytes per PDF specification (handles leading BOM/whitespace)
  const pdfHeadSlice = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  const isPdfMagic = pdfHeadSlice.includes('%PDF-');
  const isJpegMagic =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const isPngMagic =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  const expectedMimeByExt: SmartDocRecord['arquivoMimeType'] =
    ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';

  const normalizeMime = (raw: string): string => {
    const cleaned = (raw || '').trim().toLowerCase();
    if (cleaned === 'image/jpg') return 'image/jpeg';
    if (cleaned === 'application/x-pdf' || cleaned === 'application/acrobat') return 'application/pdf';
    if (!cleaned || cleaned === 'application/octet-stream') return expectedMimeByExt;
    return cleaned;
  };

  const detectedMime = normalizeMime(detectedMimeRaw);
  const declaredMime = normalizeMime(params.mimeType || detectedMime);

  if (
    !ALLOWED_MIME_TYPES.has(detectedMime as SmartDocRecord['arquivoMimeType']) ||
    detectedMime !== expectedMimeByExt ||
    declaredMime !== expectedMimeByExt
  ) {
    throw new SmartDocsValidationError(
      'Arquivo incompatível ou formato divergente da extensão. Aceitos exclusivamente PDF, JPG, JPEG e PNG.',
      400,
      'INCOMPATIBLE_FILE'
    );
  }

  const effectiveMime = expectedMimeByExt;

  if (effectiveMime === 'application/pdf') {
    if (!isPdfMagic || buffer.length < 32) {
      throw new SmartDocsValidationError(
        'PDF inválido ou corrompido: o arquivo não possui cabeçalho PDF válido (%PDF-). Envie um PDF legível.',
        400,
        'INVALID_PDF'
      );
    }
    const pdfLatin1 = buffer.toString('latin1');
    if (/\/Encrypt\b/.test(pdfLatin1)) {
      throw new SmartDocsValidationError(
        'PDF protegido por senha ou criptografado. Remova a proteção do documento e envie novamente.',
        400,
        'INVALID_PDF'
      );
    }
  } else if (
    (effectiveMime === 'image/jpeg' && !isJpegMagic) ||
    (effectiveMime === 'image/png' && !isPngMagic)
  ) {
    throw new SmartDocsValidationError(
      'Assinatura binária da imagem não corresponde ao formato declarado (arquivo corrompido ou incompatível).',
      400,
      'INCOMPATIBLE_FILE'
    );
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    mimeType: effectiveMime,
    base64Data,
    buffer,
    cleanDataUrl: `data:${effectiveMime};base64,${base64Data}`,
    sha256,
    sizeBytes: buffer.length,
  };
}

export function isMedicalCategory(categoriaGrupo: SmartDocCategoryGroup, tipoDocumento: string): boolean {
  if (categoriaGrupo === 'saude_ocupacional') return true;
  const norm = normalizeText(tipoDocumento);
  return /\b(aso|atestado de saude|exames? ocupaciona|pcmso medico|saude ocupacional)\b/.test(norm);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCompatibleFallbackModel(primaryModel: string): string | null {
  const configured = cleanEnvValue(process.env.GEMINI_FALLBACK_MODEL);
  if (configured && !PROHIBITED_DEPRECATED_MODELS.has(configured.toLowerCase())) {
    return configured !== primaryModel ? configured : null;
  }
  if (FALLBACK_SMARTDOC_MODEL !== primaryModel) {
    return FALLBACK_SMARTDOC_MODEL;
  }
  // If GEMINI_MODEL was explicitly configured to gemini-3.1-flash-lite without custom fallback,
  // keep automatic contingency available using PRIMARY_SMARTDOC_MODEL.
  return PRIMARY_SMARTDOC_MODEL;
}

export function formatAttemptsAuditSummary(attempts: SmartDocProcessingAttempt[]): string {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'nenhuma tentativa registrada';
  return attempts
    .map((a) => {
      const roleTag = a.fallbackModelo ? 'alternativo' : 'principal';
      const outcome = a.sucesso
        ? `OK HTTP ${a.codigoHttp || 200}`
        : `FALHA ${a.codigoErro || 'ERRO'} HTTP ${a.codigoHttp || 500}`;
      return `#${a.tentativa} ${a.modelo} (${roleTag}): ${outcome} [${a.duracaoMs}ms]`;
    })
    .join(' -> ');
}

export function buildConsolidatedSmartDocErrorMessage(params: {
  baseMessage: string;
  primaryModel: string;
  fallbackModel: string | null;
  bothModelsFailed: boolean;
  httpStatus: number;
  attemptsLog: SmartDocProcessingAttempt[];
}): string {
  const attemptsSummary = formatAttemptsAuditSummary(params.attemptsLog);
  const attemptsCount = params.attemptsLog.length;
  const header = params.bothModelsFailed && params.fallbackModel
    ? `Serviço Gemini temporariamente indisponível nos modelos principal (${params.primaryModel}) e alternativo (${params.fallbackModel}) após ${attemptsCount} tentativa(s) (HTTP ${params.httpStatus}). O arquivo original, os dados e o histórico foram preservados — reprocessar posteriormente sem duplicar o documento.`
    : sanitizeGeminiErrorText(params.baseMessage || 'Falha durante processamento OCR/IA do documento.');

  if (header.includes('Resumo das tentativas (')) {
    return sanitizeGeminiErrorText(header);
  }

  return sanitizeGeminiErrorText(
    `${header} Resumo das tentativas (${attemptsCount}): ${attemptsSummary}.`
  );
}

export function classifyGeminiError(
  err: any,
  model: string
): {
  httpStatus: number;
  errorCode: SmartDocAiErrorCode;
  retryable: boolean;
  allowFallback: boolean;
  message: string;
} {
  const numericStatus = Number(
    err?.status || err?.statusCode || err?.error?.code || err?.cause?.status || 0
  );
  const rawParts = [
    typeof err?.message === 'string' ? err.message : '',
    typeof err?.code === 'string' ? err.code : '',
    typeof err?.statusText === 'string' ? err.statusText : '',
    typeof err?.error?.status === 'string' ? err.error.status : '',
    typeof err?.error?.message === 'string' ? err.error.message : '',
    typeof err?.name === 'string' ? err.name : '',
  ]
    .filter(Boolean)
    .join(' | ');
  const sanitizedParts = sanitizeGeminiErrorText(rawParts);
  const lower = sanitizedParts.toLowerCase();

  // 1. Timeout
  if (
    numericStatus === 504 ||
    err?.name === 'AbortError' ||
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'AI_TIMEOUT' ||
    /timeout|timed out|deadline_exceeded|deadline exceeded|tempo limite/.test(lower)
  ) {
    return {
      httpStatus: 504,
      errorCode: 'AI_TIMEOUT',
      retryable: true,
      allowFallback: true,
      message:
        'Tempo limite excedido (Timeout) durante a leitura do documento pela IA. O arquivo original foi mantido armazenado e a leitura permanece pendente.',
    };
  }

  // 2. ACCESS_TOKEN_TYPE_UNSUPPORTED (HTTP 401 UNAUTHENTICATED — OAuth token misused, Vertex routing, or GCP "Gemini API" restriction instead of "Generative Language API")
  if (/access_token_type_unsupported/.test(lower)) {
    return {
      httpStatus: 401,
      errorCode: 'GEMINI_AUTH_401',
      retryable: false,
      allowFallback: false,
      message:
        'Erro 401 (UNAUTHENTICATED – ACCESS_TOKEN_TYPE_UNSUPPORTED): A chave GEMINI_API_KEY configurada no servidor/Netlify foi rejeitada pela API Gemini. Verifique se a chave foi gerada no Google AI Studio e, se gerenciada no Google Cloud, habilite a restrição "Generative Language API" (e não "Gemini API").',
    };
  }

  // 3. Permanent API key invalid (400/401 API_KEY_INVALID / explicit key error) — NO RETRIES
  if (
    /api_key_invalid|api key not valid|invalid api key|expired.*key|api_key_service_blocked/.test(
      lower
    )
  ) {
    return {
      httpStatus: numericStatus === 401 ? 401 : 400,
      errorCode: 'GEMINI_API_KEY_INVALID',
      retryable: false,
      allowFallback: false,
      message:
        'Chave GEMINI_API_KEY inválida no servidor/Netlify. Verifique se o valor salvo em GEMINI_API_KEY corresponde a uma chave ativa da Generative Language API (sem aspas ou espaços) e tente reprocessar.',
    };
  }

  // 4. Permanent Authentication failure (401 UNAUTHENTICATED) — NO RETRIES
  if (numericStatus === 401 || /\b401\b|unauthenticated/.test(lower)) {
    return {
      httpStatus: 401,
      errorCode: 'GEMINI_AUTH_401',
      retryable: false,
      allowFallback: false,
      message:
        'Falha de autenticação com a API Google Gemini (HTTP 401). Verifique a variável GEMINI_API_KEY configurada no servidor/Netlify.',
    };
  }

  // 5. Permanent Authorization failure (403 PERMISSION_DENIED) — NO RETRIES
  if (numericStatus === 403 || /\b403\b|permission_denied|forbidden/.test(lower)) {
    return {
      httpStatus: 403,
      errorCode: 'GEMINI_PERMISSION_403',
      retryable: false,
      allowFallback: false,
      message:
        'Autorização negada na API Google Gemini (HTTP 403). Confirme no Google Cloud se a "Generative Language API" está ativa e permitida para a chave configurada.',
    };
  }

  // 6. Invalid / Corrupted / Password-Protected PDF reported by Gemini (400) — NO RETRIES
  if (
    /document has no pages|unable to process input|password.*protected|encrypted pdf|corrupt.*pdf|invalid.*pdf|unsupported mime/.test(
      lower
    )
  ) {
    return {
      httpStatus: 400,
      errorCode: 'INVALID_PDF',
      retryable: false,
      allowFallback: false,
      message:
        'O arquivo PDF não pôde ser lido (documento vazio, corrompido ou protegido por senha). Envie uma versão legível e desprotegida.',
    };
  }

  // 7. Permanent Bad Request (400 INVALID_ARGUMENT / malformed payload) — NO RETRIES
  if (numericStatus === 400 || /\b400\b|invalid_argument|bad request/.test(lower)) {
    return {
      httpStatus: 400,
      errorCode: 'AI_BAD_REQUEST_400',
      retryable: false,
      allowFallback: false,
      message:
        'A API Gemini não conseguiu processar o documento enviado (HTTP 400). Verifique a integridade do arquivo PDF/imagem ou envie uma nova versão.',
    };
  }

  // 8. Model Not Found (404) — allows immediate compatible fallback model without multi-cycle retry loop
  if (
    numericStatus === 404 ||
    /not_found|model.*not found|is not found for api version|unsupported model/.test(lower)
  ) {
    return {
      httpStatus: 503,
      errorCode: 'MODEL_UNAVAILABLE_404',
      retryable: false,
      allowFallback: true,
      message: `O modelo de IA configurado (${model}) não está disponível para esta chave ou versão da API. Verifique a configuração do modelo (GEMINI_MODEL) no servidor.`,
    };
  }

  // 9. Temporary Rate Limit (429 RESOURCE_EXHAUSTED) — RETRYABLE
  if (
    numericStatus === 429 ||
    /\b429\b|resource_exhausted|rate limit|too many requests|quota/.test(lower)
  ) {
    return {
      httpStatus: 429,
      errorCode: 'AI_RATE_LIMIT_429',
      retryable: true,
      allowFallback: true,
      message:
        'Limite de requisições da API Gemini temporariamente atingido (HTTP 429). O arquivo original foi mantido salvo para reprocessamento.',
    };
  }

  // 10. Temporary Internal Server Error (500 INTERNAL) — RETRYABLE
  if (
    numericStatus === 500 ||
    /\b500\b|\binternal\b|internal server error/.test(lower)
  ) {
    return {
      httpStatus: 500,
      errorCode: 'AI_INTERNAL_500',
      retryable: true,
      allowFallback: true,
      message:
        'Instabilidade temporária no serviço Google Gemini (HTTP 500). O arquivo original está preservado para reprocessamento.',
    };
  }

  // 11. Temporary Service Unavailable (503 UNAVAILABLE) — RETRYABLE
  if (
    numericStatus === 503 ||
    /\b503\b|unavailable|overload|high demand|service unavailable|temporarily unavailable/.test(lower)
  ) {
    return {
      httpStatus: 503,
      errorCode: 'AI_UNAVAILABLE_503',
      retryable: true,
      allowFallback: true,
      message:
        'Serviço de IA temporariamente indisponível devido à alta demanda (HTTP 503). O arquivo original está preservado para reprocessamento.',
    };
  }

  return {
    httpStatus: 502,
    errorCode: 'AI_PROCESSING_FAILED',
    retryable: false,
    allowFallback: false,
    message:
      'Não foi possível concluir a leitura do documento no serviço de IA. O arquivo original foi preservado para nova tentativa.',
  };
}

export type SmartDocAiInvoker = (args: {
  model: string;
  mimeType: SmartDocRecord['arquivoMimeType'];
  base64Data: string;
  fileName: string;
  systemInstruction: string;
  promptText: string;
}) => Promise<string>;

async function callWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr: any = new Error(
            `Tempo limite de ${Math.round(timeoutMs / 1000)}s excedido ao aguardar resposta da IA.`
          );
          timeoutErr.code = 'AI_TIMEOUT';
          timeoutErr.status = 504;
          reject(timeoutErr);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runGeminiDocumentExtraction(params: {
  base64Data: string;
  mimeType: SmartDocRecord['arquivoMimeType'];
  fileName: string;
  manualClassification?: {
    categoriaGrupo?: SmartDocCategoryGroup;
    tipoDocumento?: string;
  };
  origem?: SmartDocProcessingAttempt['origem'];
  attemptOffset?: number;
  maxAutoRetries?: number;
  maxPrimaryRetries?: number;
  maxFallbackRetries?: number;
  retryDelaysMs?: readonly number[];
  fallbackRetryDelaysMs?: readonly number[];
  timeoutMs?: number;
  totalBudgetMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  aiInvoker?: SmartDocAiInvoker;
}): Promise<{
  categoriaGrupo: SmartDocCategoryGroup;
  tipoDocumento: string;
  classificacaoConfianca: number;
  dadosExtraidos: SmartDocExtractedData;
  modelUsed: string;
  primaryModel: string;
  fallbackModel: string | null;
  fallbackUsed: boolean;
  attemptsLog: SmartDocProcessingAttempt[];
}> {
  const keyStatus = getGeminiIntegrationStatus();
  const apiKey = getRawSanitizedGeminiApiKey();
  if (!params.aiInvoker && !keyStatus.configured) {
    const errCode: SmartDocAiErrorCode =
      keyStatus.reason === 'oauth_token_not_supported'
        ? 'GEMINI_AUTH_401'
        : keyStatus.reason === 'malformed'
        ? 'GEMINI_API_KEY_INVALID'
        : 'GEMINI_API_KEY_MISSING';
    const httpStatus =
      keyStatus.reason === 'oauth_token_not_supported'
        ? 401
        : keyStatus.reason === 'malformed'
        ? 400
        : 503;
    throw new SmartDocsAiConfigError(keyStatus.diagnosticMessage, errCode, httpStatus);
  }

  const ai = !params.aiInvoker ? createGeminiClient(apiKey) : null;

  const systemInstruction = `Você é um motor de OCR e interpretação documental especialista em Segurança, Saúde e Meio Ambiente (SSMA/EHS) brasileiro.
Analise integralmente o documento enviado (PDF nativo, PDF escaneado/imagem com OCR visual ou foto de celular), incluindo textos corridos, cabeçalhos, rodapés, assinaturas, carimbos e tabelas, e extraia EXCLUSIVAMENTE os dados realmente presentes e legíveis no documento.

REGRAS CRÍTICAS ANTI-ALUCINAÇÃO:
1. NUNCA invente, chute, deduza ou presuma qualquer dado ausente ou ilegível.
2. Se um campo não estiver explicitamente escrito no documento, retorne string vazia "" (e validadeExplicitaNoDocumento = false).
3. NUNCA calcule ou invente data de vencimento/validade se o documento não informar expressamente uma data de validade/vencimento!
4. Normalize todas as datas encontradas para o formato ISO YYYY-MM-DD (ex: 15/03/2026 -> 2026-03-15).
5. Para CPF e CNPJ, preserve os dígitos encontrados com precisão.
6. Classifique o documento na taxonomia oficial:
   - categoriaGrupo "saude_ocupacional": tipoDocumento entre ["ASO", "Exames ocupacionais", "Atestados de saúde ocupacional"]
   - categoriaGrupo "treinamentos": tipoDocumento entre ["NR-01", "NR-05", "NR-06", "NR-10", "NR-11", "NR-12", "NR-13", "NR-18", "NR-20", "NR-23", "NR-26", "NR-33", "NR-35", "Operador de empilhadeira", "Operador de plataforma elevatória", "Operador de guindaste", "Outros treinamentos"]
   - categoriaGrupo "documentos_empresariais": tipoDocumento entre ["PGR", "PCMSO", "LTCAT", "APR", "Procedimentos de segurança", "Documentação de terceiros"]
   - categoriaGrupo "outros": tipoDocumento = "Documento não listado" (caso não se enquadre nas anteriores).
7. Para resultadoAptidao (em ASO/saúde): use apenas "apto", "inapto", "apto_com_restricoes" ou "" se não explícito.
8. Avalie a qualidade do OCR/leitura:
   - qualidadeLeitura: "alta", "media", "baixa" ou "ilegivel"
   - documentoIlegivel: true somente se a maior parte do documento estiver borrada, cortada, escura ou ilegível
   - documentoIncompleto: true se faltarem páginas, assinaturas obrigatórias, datas essenciais ou identificação básica
   - ocrAplicado: true se houve leitura visual/OCR de texto em imagem ou PDF escaneado
   - tabelasExtraidasResumo: resumo objetivo de tabelas relevantes (ex.: exames complementares do ASO, grade horária de NR, lista de riscos), ou "" se não houver tabelas.`;

  const manualHint =
    params.manualClassification?.tipoDocumento
      ? `Observação do usuário: classificação sugerida manualmente como "${params.manualClassification.tipoDocumento}" (${params.manualClassification.categoriaGrupo || 'não informada'}). Ainda assim extraia os campos reais presentes no arquivo.`
      : '';
  const promptText = `Realize leitura integral (com OCR quando necessário) e extração estruturada de textos, tabelas, datas, nomes, CPFs, CNPJs e responsáveis técnicos do arquivo "${params.fileName}". ${manualHint}`;

  const invokeModel: SmartDocAiInvoker =
    params.aiInvoker ||
    (async ({ model, mimeType, base64Data, systemInstruction: sysInst, promptText: prompt }) => {
      const response = await ai!.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          systemInstruction: sysInst,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              categoriaGrupo: {
                type: Type.STRING,
                enum: ['saude_ocupacional', 'treinamentos', 'documentos_empresariais', 'outros'],
              },
              tipoDocumento: { type: Type.STRING },
              classificacaoConfianca: { type: Type.NUMBER },
              qualidadeLeitura: {
                type: Type.STRING,
                enum: ['alta', 'media', 'baixa', 'ilegivel'],
              },
              documentoIlegivel: { type: Type.BOOLEAN },
              documentoIncompleto: { type: Type.BOOLEAN },
              ocrAplicado: { type: Type.BOOLEAN },
              tabelasExtraidasResumo: { type: Type.STRING },
              resumoConteudo: { type: Type.STRING },
              nomeDocumento: { type: Type.STRING },
              nomeColaborador: { type: Type.STRING },
              cpf: { type: Type.STRING },
              empresa: { type: Type.STRING },
              cnpj: { type: Type.STRING },
              razaoSocial: { type: Type.STRING },
              unidade: { type: Type.STRING },
              numeroDocumento: { type: Type.STRING },
              funcao: { type: Type.STRING },
              tipoExame: { type: Type.STRING },
              resultadoAptidao: { type: Type.STRING },
              medicoResponsavel: { type: Type.STRING },
              crm: { type: Type.STRING },
              nomeTreinamento: { type: Type.STRING },
              nrCorrespondente: { type: Type.STRING },
              cargaHoraria: { type: Type.STRING },
              nomeInstrutor: { type: Type.STRING },
              registroProfissionalInstrutor: { type: Type.STRING },
              instituicaoEmissora: { type: Type.STRING },
              responsavelTecnico: { type: Type.STRING },
              registroProfissionalRT: { type: Type.STRING },
              dataRealizacao: { type: Type.STRING },
              dataEmissao: { type: Type.STRING },
              dataRevisao: { type: Type.STRING },
              dataValidade: { type: Type.STRING },
              validadeExplicitaNoDocumento: { type: Type.BOOLEAN },
              observacoesIA: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'categoriaGrupo',
              'tipoDocumento',
              'classificacaoConfianca',
              'validadeExplicitaNoDocumento',
            ],
          },
        },
      });
      return (response.text || '').trim();
    });

  const serverlessRuntime = isNetlifyServerlessRuntime();
  const runtimeLabel = serverlessRuntime ? 'netlify_functions' : 'node_server';
  const primaryModel = getConfiguredPrimaryModel();
  const fallbackModel = getCompatibleFallbackModel(primaryModel);
  const timeoutMs = Math.max(3000, params.timeoutMs ?? getSmartDocTimeoutMs());
  const totalBudgetMs = Math.max(timeoutMs, params.totalBudgetMs ?? getSmartDocTotalBudgetMs());
  const deadlineAt = Date.now() + totalBudgetMs;

  // Bounded retries:
  // - Local Node: primary runs initial + up to 2 exponential backoff retries (1s, 2s), then fallback (up to 2 attempts).
  // - Netlify Functions / Lambda: primary runs initial + 1 fast retry (0.6s) to stay strictly inside serverless timeout,
  //   then immediately triggers fallback model (default gemini-3.1-flash-lite, up to 2 attempts with 0.8s backoff).
  const defaultPrimaryRetries = serverlessRuntime
    ? SERVERLESS_PRIMARY_MAX_RETRIES
    : DEFAULT_PRIMARY_MAX_RETRIES;
  const requestedPrimaryRetries =
    params.maxPrimaryRetries ?? params.maxAutoRetries ?? defaultPrimaryRetries;
  const maxPrimaryRetries = Math.max(0, Math.min(3, requestedPrimaryRetries));
  const maxFallbackRetries = Math.max(
    0,
    Math.min(2, params.maxFallbackRetries ?? DEFAULT_FALLBACK_MAX_RETRIES)
  );
  const primaryBackoffMs =
    params.retryDelaysMs ??
    (serverlessRuntime ? SERVERLESS_PRIMARY_BACKOFF_MS : PRIMARY_EXPONENTIAL_BACKOFF_MS);
  const fallbackBackoffMs =
    params.fallbackRetryDelaysMs ??
    (serverlessRuntime ? SERVERLESS_FALLBACK_BACKOFF_MS : FALLBACK_RETRY_BACKOFF_MS);
  const sleep = params.sleepFn ?? defaultSleep;
  const origem = params.origem ?? 'inicial';
  const attemptOffset = params.attemptOffset ?? 0;

  const attemptsLog: SmartDocProcessingAttempt[] = [];
  let primaryFinalError: ReturnType<typeof classifyGeminiError> | null = null;
  let fallbackFinalError: ReturnType<typeof classifyGeminiError> | null = null;
  let lastErrorMeta: {
    httpStatus: number;
    errorCode: SmartDocAiErrorCode;
    retryable: boolean;
    message: string;
    modelUsed: string;
    fallbackUsed: boolean;
  } | null = null;

  const trySingleModel = async (
    model: string,
    isFallback: boolean,
    cycleOrigem: SmartDocProcessingAttempt['origem'],
    attemptTimeoutMs: number
  ): Promise<{ rawText: string } | { error: ReturnType<typeof classifyGeminiError> }> => {
    const startedAt = Date.now();
    const attemptNumber = attemptOffset + attemptsLog.length + 1;
    const roleLabel = isFallback ? 'alternativo' : 'principal';
    try {
      const rawText = await callWithTimeout(
        invokeModel({
          model,
          mimeType: params.mimeType,
          base64Data: params.base64Data,
          fileName: params.fileName,
          systemInstruction,
          promptText,
        }),
        Math.max(2000, attemptTimeoutMs)
      );
      if (!rawText || !rawText.trim()) {
        throw new Error('O motor de IA não retornou conteúdo interpretável para o documento.');
      }
      const duracaoMs = Date.now() - startedAt;
      attemptsLog.push({
        tentativa: attemptNumber,
        dataHora: new Date().toISOString(),
        modelo: model,
        fallbackModelo: isFallback,
        origem: cycleOrigem,
        sucesso: true,
        codigoHttp: 200,
        duracaoMs,
        mensagem: isFallback
          ? `Leitura concluída com sucesso usando modelo alternativo (${model}).`
          : `Leitura concluída com sucesso usando modelo principal (${model}).`,
      });
      console.info(
        '[SmartDocs AI Attempt]',
        JSON.stringify({
          event: 'smartdocs_ai_attempt',
          runtime: runtimeLabel,
          tentativa: attemptNumber,
          modelo: model,
          papel: roleLabel,
          origem: cycleOrigem,
          sucesso: true,
          httpStatus: 200,
          codigoErro: null,
          duracaoMs,
        })
      );
      return { rawText: rawText.trim() };
    } catch (err: any) {
      const duracaoMs = Date.now() - startedAt;
      const classified = classifyGeminiError(err, model);
      attemptsLog.push({
        tentativa: attemptNumber,
        dataHora: new Date().toISOString(),
        modelo: model,
        fallbackModelo: isFallback,
        origem: cycleOrigem,
        sucesso: false,
        codigoHttp: classified.httpStatus,
        codigoErro: classified.errorCode,
        retryable: classified.retryable,
        duracaoMs,
        mensagem: sanitizeGeminiErrorText(classified.message),
      });
      console.warn(
        '[SmartDocs AI Attempt]',
        JSON.stringify({
          event: 'smartdocs_ai_attempt',
          runtime: runtimeLabel,
          tentativa: attemptNumber,
          modelo: model,
          papel: roleLabel,
          origem: cycleOrigem,
          sucesso: false,
          httpStatus: classified.httpStatus,
          codigoErro: classified.errorCode,
          retryable: classified.retryable,
          allowFallback: classified.allowFallback,
          duracaoMs,
        })
      );
      return { error: classified };
    }
  };

  let rawResultText = '';
  let finalModelUsed = primaryModel;
  let finalFallbackUsed = false;

  // PHASE 1: Primary model (GEMINI_MODEL) with bounded exponential backoff on 503/429/500/timeout
  for (let retry = 0; retry <= maxPrimaryRetries; retry++) {
    if (attemptsLog.length >= MAX_TOTAL_ATTEMPTS_PER_RUN) break;
    const cycleOrigem: SmartDocProcessingAttempt['origem'] =
      retry === 0 ? origem : 'automatica_503';
    const remainingBudget = deadlineAt - Date.now();
    // Reserve minimum window for fallback model so serverless execution always has budget to switch models
    const minFallbackReserveMs = fallbackModel
      ? Math.min(serverlessRuntime ? 7000 : 8000, Math.floor(totalBudgetMs * 0.4))
      : 0;
    if (retry > 0 && remainingBudget <= minFallbackReserveMs) {
      break;
    }
    const perAttemptTimeout =
      retry === 0
        ? Math.min(timeoutMs, Math.max(3000, remainingBudget - (fallbackModel ? Math.floor(minFallbackReserveMs * 0.5) : 0)))
        : Math.min(timeoutMs, Math.max(3000, remainingBudget - minFallbackReserveMs));

    const primaryRes = await trySingleModel(primaryModel, false, cycleOrigem, perAttemptTimeout);
    if ('rawText' in primaryRes) {
      rawResultText = primaryRes.rawText;
      finalModelUsed = primaryModel;
      finalFallbackUsed = false;
      break;
    }

    primaryFinalError = primaryRes.error;
    lastErrorMeta = {
      ...primaryRes.error,
      modelUsed: primaryModel,
      fallbackUsed: false,
    };

    // Permanent errors (400, 401, 403, INVALID_PDF) or 404 model unavailable: stop primary retries immediately
    if (!primaryRes.error.retryable) {
      break;
    }

    if (retry < maxPrimaryRetries) {
      const backoffDelay =
        primaryBackoffMs[Math.min(retry, primaryBackoffMs.length - 1)] ??
        Math.min(4000, 1000 * Math.pow(2, retry));
      const budgetAfterSleep = deadlineAt - Date.now() - backoffDelay;
      if (budgetAfterSleep <= minFallbackReserveMs) {
        // Not enough time for another primary retry without starving fallback -> move directly to fallback
        break;
      }
      await sleep(backoffDelay);
    }
  }

  // PHASE 2: Automatic contingency fallback to GEMINI_FALLBACK_MODEL (default gemini-3.1-flash-lite)
  // Triggered when primary failed with temporary unavailability (503, 429, 500, timeout) or 404 model error.
  if (!rawResultText && fallbackModel && primaryFinalError?.allowFallback) {
    console.warn(
      '[SmartDocs AI Fallback]',
      JSON.stringify({
        event: 'smartdocs_ai_fallback_triggered',
        runtime: runtimeLabel,
        primaryModel,
        fallbackModel,
        primaryErrorCode: primaryFinalError.errorCode,
        primaryHttpStatus: primaryFinalError.httpStatus,
        remainingBudgetMs: Math.max(0, deadlineAt - Date.now()),
      })
    );

    for (let fbRetry = 0; fbRetry <= maxFallbackRetries; fbRetry++) {
      if (attemptsLog.length >= MAX_TOTAL_ATTEMPTS_PER_RUN) break;
      const remainingBudget = deadlineAt - Date.now();
      if (fbRetry > 0 && remainingBudget <= 2500) break;

      const fbOrigem: SmartDocProcessingAttempt['origem'] =
        fbRetry === 0 ? (origem === 'inicial' ? 'inicial' : origem) : 'automatica_503';
      const fbTimeout = Math.min(timeoutMs, Math.max(3500, remainingBudget));

      const fbRes = await trySingleModel(fallbackModel, true, fbOrigem, fbTimeout);
      if ('rawText' in fbRes) {
        rawResultText = fbRes.rawText;
        finalModelUsed = fallbackModel;
        finalFallbackUsed = true;
        break;
      }

      fallbackFinalError = fbRes.error;
      lastErrorMeta = {
        ...fbRes.error,
        modelUsed: fallbackModel,
        fallbackUsed: true,
      };

      if (!fbRes.error.retryable) {
        break;
      }

      if (fbRetry < maxFallbackRetries) {
        const fbDelay =
          fallbackBackoffMs[Math.min(fbRetry, fallbackBackoffMs.length - 1)] ??
          (serverlessRuntime ? 800 : 1500);
        if (deadlineAt - Date.now() - fbDelay <= 2500) {
          break;
        }
        await sleep(fbDelay);
      }
    }
  }

  if (!rawResultText) {
    const bothModelsFailed = Boolean(primaryFinalError && fallbackFinalError && fallbackModel);
    const httpStatus = lastErrorMeta?.httpStatus ?? 502;
    const attemptsSummary = formatAttemptsAuditSummary(attemptsLog);
    const finalMessage = buildConsolidatedSmartDocErrorMessage({
      baseMessage: lastErrorMeta?.message || 'Falha durante processamento OCR/IA do documento.',
      primaryModel,
      fallbackModel,
      bothModelsFailed,
      httpStatus,
      attemptsLog,
    });

    throw new SmartDocsAiProcessingError({
      message: finalMessage,
      statusCode: httpStatus,
      code: lastErrorMeta?.errorCode ?? 'AI_PROCESSING_FAILED',
      retryable: Boolean(primaryFinalError?.retryable || fallbackFinalError?.retryable),
      modelUsed: lastErrorMeta?.modelUsed ?? primaryModel,
      fallbackUsed: Boolean(lastErrorMeta?.fallbackUsed),
      attemptsLog,
      attemptsSummary,
    });
  }

  let parsed: Record<string, any>;
  try {
    const cleanedJson = rawResultText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleanedJson);
  } catch {
    throw new SmartDocsAiProcessingError({
      message: 'Resposta estruturada inválida retornada pela leitura inteligente.',
      statusCode: 502,
      code: 'AI_PROCESSING_FAILED',
      retryable: false,
      modelUsed: finalModelUsed,
      fallbackUsed: finalFallbackUsed,
      attemptsLog,
    });
  }

  const validGroups: SmartDocCategoryGroup[] = [
    'saude_ocupacional',
    'treinamentos',
    'documentos_empresariais',
    'outros',
  ];
  const categoriaGrupo: SmartDocCategoryGroup = validGroups.includes(parsed.categoriaGrupo)
    ? parsed.categoriaGrupo
    : 'outros';

  const tipoDocumento =
    typeof parsed.tipoDocumento === 'string' && parsed.tipoDocumento.trim()
      ? parsed.tipoDocumento.trim()
      : 'Documento não listado';

  const rawApt = normalizeText(parsed.resultadoAptidao);
  let resultadoAptidao: SmartDocExtractedData['resultadoAptidao'] = '';
  if (rawApt === 'apto') resultadoAptidao = 'apto';
  else if (rawApt === 'inapto') resultadoAptidao = 'inapto';
  else if (rawApt.includes('restric')) resultadoAptidao = 'apto_com_restricoes';

  const explicitDataValidade = normalizeIsoDate(parsed.dataValidade);
  const validadeExplicita = Boolean(parsed.validadeExplicitaNoDocumento && explicitDataValidade);

  const str = (v: any) => (typeof v === 'string' ? v.trim() : '');
  const rawQuality = str(parsed.qualidadeLeitura).toLowerCase();
  const qualidadeLeitura: SmartDocExtractedData['qualidadeLeitura'] =
    rawQuality === 'alta' ||
    rawQuality === 'media' ||
    rawQuality === 'baixa' ||
    rawQuality === 'ilegivel'
      ? rawQuality
      : undefined;

  const dadosExtraidos: SmartDocExtractedData = {
    nomeDocumento: str(parsed.nomeDocumento) || tipoDocumento,
    nomeColaborador: str(parsed.nomeColaborador),
    cpf: str(parsed.cpf),
    empresa: str(parsed.empresa) || str(parsed.razaoSocial),
    razaoSocial: str(parsed.razaoSocial) || str(parsed.empresa),
    cnpj: str(parsed.cnpj),
    unidade: str(parsed.unidade),
    numeroDocumento: str(parsed.numeroDocumento),
    funcao: str(parsed.funcao),
    tipoExame: str(parsed.tipoExame),
    resultadoAptidao,
    medicoResponsavel: str(parsed.medicoResponsavel),
    crm: str(parsed.crm),
    nomeTreinamento: str(parsed.nomeTreinamento),
    nrCorrespondente: str(parsed.nrCorrespondente),
    cargaHoraria: str(parsed.cargaHoraria),
    nomeInstrutor: str(parsed.nomeInstrutor),
    registroProfissionalInstrutor: str(parsed.registroProfissionalInstrutor),
    instituicaoEmissora: str(parsed.instituicaoEmissora),
    responsavelTecnico: str(parsed.responsavelTecnico),
    registroProfissionalRT: str(parsed.registroProfissionalRT),
    dataRealizacao: normalizeIsoDate(parsed.dataRealizacao),
    dataEmissao: normalizeIsoDate(parsed.dataEmissao),
    dataRevisao: normalizeIsoDate(parsed.dataRevisao),
    dataValidade: validadeExplicita ? explicitDataValidade : '',
    validadeExplicitaNoDocumento: validadeExplicita,
    validadeOrigem: validadeExplicita ? 'documento' : 'nao_identificada',
    semValidade: false,
    resumoConteudo: str(parsed.resumoConteudo),
    observacoes: '',
    observacoesIA: Array.isArray(parsed.observacoesIA)
      ? parsed.observacoesIA.filter((item: any) => typeof item === 'string' && item.trim())
      : [],
    qualidadeLeitura,
    documentoIlegivel: Boolean(parsed.documentoIlegivel || qualidadeLeitura === 'ilegivel'),
    documentoIncompleto: Boolean(parsed.documentoIncompleto),
    ocrAplicado: Boolean(parsed.ocrAplicado),
    tabelasExtraidasResumo: str(parsed.tabelasExtraidasResumo),
  };

  const confidence = Number(parsed.classificacaoConfianca);
  const classificacaoConfianca = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : 0;

  return {
    categoriaGrupo,
    tipoDocumento,
    classificacaoConfianca,
    dadosExtraidos,
    modelUsed: finalModelUsed,
    primaryModel,
    fallbackModel,
    fallbackUsed: finalFallbackUsed,
    attemptsLog,
  };
}

interface GeminiDiagnosticCache {
  connectionStatus: 'connected' | 'error' | 'not_tested';
  lastTestedAt: string | null;
  lastModelTested: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
}

const geminiDiagnosticCache: GeminiDiagnosticCache = {
  connectionStatus: 'not_tested',
  lastTestedAt: null,
  lastModelTested: null,
  lastLatencyMs: null,
  lastError: null,
  lastErrorCode: null,
};

export function getSmartDocsDiagnosticsSnapshot(authSecretConfigured: boolean) {
  const keyStatus = getGeminiIntegrationStatus();
  const primaryModel = getConfiguredPrimaryModel();
  const fallbackModel = getCompatibleFallbackModel(primaryModel);

  return {
    geminiKeyConfigured: keyStatus.configured,
    geminiKeyStatus: keyStatus.reason,
    authSecretConfigured,
    primaryModel,
    fallbackModel,
    authMode: 'api_key_x_goog_api_key' as const,
    endpoint: 'https://generativelanguage.googleapis.com/' as const,
    runtime: (isNetlifyServerlessRuntime() ? 'netlify_functions' : 'node_server') as
      | 'netlify_functions'
      | 'node_server',
    backendStatus: 'online' as const,
    connectionStatus: keyStatus.configured
      ? geminiDiagnosticCache.connectionStatus
      : ('key_missing' as const),
    lastTestedAt: geminiDiagnosticCache.lastTestedAt,
    lastModelTested: geminiDiagnosticCache.lastModelTested,
    lastLatencyMs: geminiDiagnosticCache.lastLatencyMs,
    lastError: keyStatus.configured ? geminiDiagnosticCache.lastError : keyStatus.diagnosticMessage,
    lastErrorCode: keyStatus.configured
      ? geminiDiagnosticCache.lastErrorCode
      : keyStatus.reason === 'oauth_token_not_supported'
      ? 'GEMINI_AUTH_401'
      : keyStatus.reason === 'malformed'
      ? 'GEMINI_API_KEY_INVALID'
      : 'GEMINI_API_KEY_MISSING',
  };
}

export async function testGeminiConnection(authSecretConfigured: boolean): Promise<{
  success: boolean;
  httpStatus: number;
  message: string;
  modelUsed: string;
  latencyMs: number;
  diagnostics: ReturnType<typeof getSmartDocsDiagnosticsSnapshot>;
}> {
  const testedAt = new Date().toISOString();
  const primaryModel = getConfiguredPrimaryModel();
  const fallbackModel = getCompatibleFallbackModel(primaryModel);
  const keyStatus = getGeminiIntegrationStatus();
  const apiKey = getRawSanitizedGeminiApiKey();

  if (!keyStatus.configured) {
    const errCode =
      keyStatus.reason === 'oauth_token_not_supported'
        ? 'GEMINI_AUTH_401'
        : keyStatus.reason === 'malformed'
        ? 'GEMINI_API_KEY_INVALID'
        : 'GEMINI_API_KEY_MISSING';
    const httpStatus =
      keyStatus.reason === 'oauth_token_not_supported'
        ? 401
        : keyStatus.reason === 'malformed'
        ? 400
        : 503;

    geminiDiagnosticCache.connectionStatus = 'error';
    geminiDiagnosticCache.lastTestedAt = testedAt;
    geminiDiagnosticCache.lastModelTested = primaryModel;
    geminiDiagnosticCache.lastLatencyMs = 0;
    geminiDiagnosticCache.lastError = keyStatus.diagnosticMessage;
    geminiDiagnosticCache.lastErrorCode = errCode;

    return {
      success: false,
      httpStatus,
      message: keyStatus.diagnosticMessage,
      modelUsed: primaryModel,
      latencyMs: 0,
      diagnostics: getSmartDocsDiagnosticsSnapshot(authSecretConfigured),
    };
  }

  const ai = createGeminiClient(apiKey);
  const candidates = fallbackModel ? [primaryModel, fallbackModel] : [primaryModel];
  let lastClassified: ReturnType<typeof classifyGeminiError> | null = null;
  let lastModel = primaryModel;
  let lastLatency = 0;

  for (const model of candidates) {
    lastModel = model;
    const startedAt = Date.now();
    try {
      const response = await callWithTimeout(
        ai.models.generateContent({
          model,
          contents: 'Responda apenas OK.',
        }),
        Math.min(getSmartDocTimeoutMs(), 15000)
      );
      lastLatency = Date.now() - startedAt;
      const text = (response.text || '').trim();
      if (!text) {
        throw new Error('Resposta vazia retornada pela API Gemini.');
      }

      geminiDiagnosticCache.connectionStatus = 'connected';
      geminiDiagnosticCache.lastTestedAt = testedAt;
      geminiDiagnosticCache.lastModelTested = model;
      geminiDiagnosticCache.lastLatencyMs = lastLatency;
      geminiDiagnosticCache.lastError = null;
      geminiDiagnosticCache.lastErrorCode = null;

      return {
        success: true,
        httpStatus: 200,
        message: `Conexão real com a API Google Gemini validada com sucesso (modelo ${model}, ${lastLatency} ms).`,
        modelUsed: model,
        latencyMs: lastLatency,
        diagnostics: getSmartDocsDiagnosticsSnapshot(authSecretConfigured),
      };
    } catch (err: any) {
      lastLatency = Date.now() - startedAt;
      lastClassified = classifyGeminiError(err, model);
      if (!lastClassified.allowFallback) {
        break;
      }
    }
  }

  const finalError = lastClassified?.message || 'Falha ao validar conexão com a API Gemini.';
  const finalCode = lastClassified?.errorCode || 'AI_PROCESSING_FAILED';
  const finalStatus = lastClassified?.httpStatus || 502;

  geminiDiagnosticCache.connectionStatus = 'error';
  geminiDiagnosticCache.lastTestedAt = testedAt;
  geminiDiagnosticCache.lastModelTested = lastModel;
  geminiDiagnosticCache.lastLatencyMs = lastLatency;
  geminiDiagnosticCache.lastError = finalError;
  geminiDiagnosticCache.lastErrorCode = finalCode;

  return {
    success: false,
    httpStatus: finalStatus,
    message: finalError,
    modelUsed: lastModel,
    latencyMs: lastLatency,
    diagnostics: getSmartDocsDiagnosticsSnapshot(authSecretConfigured),
  };
}

export function mergeSmartDocExtractedData(
  previous: SmartDocExtractedData | undefined,
  incoming: SmartDocExtractedData,
  options?: { isReplacement?: boolean }
): SmartDocExtractedData {
  if (!previous) return incoming;
  const merged: SmartDocExtractedData = { ...incoming };

  const stringKeys: (keyof SmartDocExtractedData)[] = [
    'nomeDocumento',
    'nomeColaborador',
    'cpf',
    'empresa',
    'cnpj',
    'dataRealizacao',
    'dataEmissao',
    'dataRevisao',
    'dataValidade',
    'funcao',
    'tipoExame',
    'resultadoAptidao',
    'medicoResponsavel',
    'crm',
    'nomeTreinamento',
    'nrCorrespondente',
    'cargaHoraria',
    'nomeInstrutor',
    'registroProfissionalInstrutor',
    'instituicaoEmissora',
    'razaoSocial',
    'unidade',
    'numeroDocumento',
    'responsavelTecnico',
    'registroProfissionalRT',
    'resumoConteudo',
    'observacoes',
  ];

  for (const key of stringKeys) {
    const nextVal = merged[key];
    const prevVal = previous[key];
    const hasNext = typeof nextVal === 'string' && nextVal.trim().length > 0;
    const hasPrev = typeof prevVal === 'string' && prevVal.trim().length > 0;

    if (!hasNext && hasPrev) {
      (merged as any)[key] = prevVal;
    } else if (!options?.isReplacement && key === 'observacoes' && hasPrev) {
      (merged as any)[key] = prevVal;
    }
  }

  // Preserve manual validity choices if not overridden explicitly
  if (!options?.isReplacement && previous.semValidade) {
    merged.semValidade = true;
    merged.dataValidade = '';
  } else if (!options?.isReplacement && previous.validadeOrigem === 'manual' && previous.dataValidade) {
    merged.dataValidade = previous.dataValidade;
    merged.validadeOrigem = 'manual';
  } else if (!merged.dataValidade && previous.dataValidade) {
    merged.dataValidade = previous.dataValidade;
    merged.validadeOrigem = previous.validadeOrigem || merged.validadeOrigem;
    merged.validadeExplicitaNoDocumento =
      previous.validadeExplicitaNoDocumento ?? merged.validadeExplicitaNoDocumento;
  }

  const combinedNotes = [
    ...(Array.isArray(previous.observacoesIA) ? previous.observacoesIA : []),
    ...(Array.isArray(incoming.observacoesIA) ? incoming.observacoesIA : []),
  ].filter((v, idx, arr) => typeof v === 'string' && v.trim() && arr.indexOf(v) === idx);
  merged.observacoesIA = combinedNotes;

  return merged;
}

export async function applyConfiguredValidityRule(
  dados: SmartDocExtractedData,
  tipoDocumento: string
): Promise<SmartDocExtractedData> {
  if (dados.dataValidade || dados.semValidade) {
    return dados;
  }

  try {
    const snap = await getDocs(collection(db, 'smartDocValidityRules'));
    const rules: SmartDocValidityRule[] = [];
    snap.forEach((d) => {
      const r = d.data() as Omit<SmartDocValidityRule, 'id'>;
      if (r.ativo && Number(r.mesesValidade) > 0) {
        rules.push({ id: d.id, ...r });
      }
    });

    const normTipo = normalizeText(tipoDocumento);
    const normSub = normalizeText(dados.tipoExame || dados.nrCorrespondente || dados.nomeTreinamento);
    const matchedRule = rules.find((r) => {
      const ruleType = normalizeText(r.tipoDocumento);
      return ruleType && (ruleType === normTipo || (normSub && ruleType === normSub));
    });

    const baseDate = dados.dataRealizacao || dados.dataEmissao;
    if (matchedRule && baseDate) {
      const calculated = addMonthsIso(baseDate, matchedRule.mesesValidade);
      if (calculated) {
        return {
          ...dados,
          dataValidade: calculated,
          validadeOrigem: 'regra_configurada',
          observacoesIA: [
            ...(dados.observacoesIA || []),
            `Validade calculada por regra configurada (${matchedRule.tipoDocumento}: +${matchedRule.mesesValidade} meses).`,
          ],
        };
      }
    }
  } catch (err) {
    console.warn('[SmartDocs] Falha ao consultar regras configuradas de validade:', err);
  }

  return {
    ...dados,
    dataValidade: '',
    validadeOrigem: 'nao_identificada',
  };
}

export async function linkToContractorsRegistry(params: {
  dados: SmartDocExtractedData;
  forcedEmpresaId?: string; // Used when Solicitante is scoped to own company
  manualEmpresaId?: string;
  manualColaboradorId?: string;
}): Promise<{
  empresaId: string;
  empresaNome: string;
  empresaMatchMetodo: SmartDocRecord['empresaMatchMetodo'];
  colaboradorId: string;
  colaboradorNome: string;
  colaboradorMatchMetodo: SmartDocRecord['colaboradorMatchMetodo'];
  matchedCompany?: Company;
  matchedEmployee?: Employee;
  extraInconsistencies: SmartDocInconsistency[];
}> {
  const extraInconsistencies: SmartDocInconsistency[] = [];

  const [companiesSnap, employeesSnap] = await Promise.all([
    getDocs(collection(db, 'companies')),
    getDocs(collection(db, 'employees')),
  ]);

  const companies: Company[] = companiesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Company, 'id'>),
  }));
  const employees: Employee[] = employeesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Employee, 'id'>),
  }));

  let matchedCompany: Company | undefined;
  let empresaMatchMetodo: SmartDocRecord['empresaMatchMetodo'] = 'nao_vinculada';

  if (params.manualEmpresaId) {
    matchedCompany = companies.find((c) => c.id === params.manualEmpresaId);
    if (matchedCompany) empresaMatchMetodo = 'manual';
  }

  if (!matchedCompany && params.forcedEmpresaId) {
    matchedCompany = companies.find((c) => c.id === params.forcedEmpresaId);
    if (matchedCompany) empresaMatchMetodo = 'manual';
  }

  const extractedCnpjDigits = normalizeDigits(params.dados.cnpj);
  if (!matchedCompany && extractedCnpjDigits.length === 14) {
    const cnpjMatches = companies.filter((c) => normalizeDigits(c.cnpj) === extractedCnpjDigits);
    if (cnpjMatches.length === 1) {
      matchedCompany = cnpjMatches[0];
      empresaMatchMetodo = 'cnpj';
    } else if (cnpjMatches.length > 1) {
      empresaMatchMetodo = 'ambiguo';
      extraInconsistencies.push({
        codigo: 'EMPRESA_CNPJ_DUPLICADO',
        severidade: 'alta',
        campo: 'cnpj',
        mensagem: `Múltiplas empresas cadastradas possuem o CNPJ ${params.dados.cnpj}. Selecione manualmente.`,
      });
    }
  }

  const extractedCompanyName = normalizeText(params.dados.razaoSocial || params.dados.empresa);
  if (!matchedCompany && empresaMatchMetodo !== 'ambiguo' && extractedCompanyName.length >= 4) {
    const exactNameMatches = companies.filter(
      (c) =>
        normalizeText(c.razaoSocial) === extractedCompanyName ||
        (c.nomeFantasia && normalizeText(c.nomeFantasia) === extractedCompanyName)
    );
    if (exactNameMatches.length === 1) {
      matchedCompany = exactNameMatches[0];
      empresaMatchMetodo = 'nome';
    } else if (exactNameMatches.length > 1) {
      empresaMatchMetodo = 'ambiguo';
      extraInconsistencies.push({
        codigo: 'EMPRESA_NOME_AMBIGUO',
        severidade: 'media',
        campo: 'empresa',
        mensagem: 'Mais de uma empresa possui razão social semelhante. Confirme o vínculo manualmente.',
      });
    }
  }

  // Detect CNPJ divergence when Solicitante company differs from extracted CNPJ
  if (
    matchedCompany &&
    extractedCnpjDigits.length === 14 &&
    normalizeDigits(matchedCompany.cnpj) !== extractedCnpjDigits
  ) {
    extraInconsistencies.push({
      codigo: 'DIVERGENCIA_CNPJ',
      severidade: 'alta',
      campo: 'cnpj',
      mensagem: `CNPJ extraído (${params.dados.cnpj}) diverge do CNPJ cadastrado da empresa vinculada (${matchedCompany.cnpj}).`,
    });
  }

  let matchedEmployee: Employee | undefined;
  let colaboradorMatchMetodo: SmartDocRecord['colaboradorMatchMetodo'] = 'nao_vinculado';

  if (params.manualColaboradorId) {
    matchedEmployee = employees.find((e) => e.id === params.manualColaboradorId);
    if (matchedEmployee) colaboradorMatchMetodo = 'manual';
  }

  const extractedCpfDigits = normalizeDigits(params.dados.cpf);
  if (!matchedEmployee && extractedCpfDigits.length === 11) {
    const cpfMatches = employees.filter((e) => normalizeDigits(e.cpf) === extractedCpfDigits);
    if (cpfMatches.length === 1) {
      matchedEmployee = cpfMatches[0];
      colaboradorMatchMetodo = 'cpf';
    } else if (cpfMatches.length > 1) {
      colaboradorMatchMetodo = 'ambiguo';
      extraInconsistencies.push({
        codigo: 'COLABORADOR_CPF_DUPLICADO',
        severidade: 'alta',
        campo: 'cpf',
        mensagem: `Múltiplos colaboradores cadastrados possuem o CPF ${params.dados.cpf}. Selecione manualmente.`,
      });
    }
  }

  const extractedEmpName = normalizeText(params.dados.nomeColaborador);
  if (!matchedEmployee && colaboradorMatchMetodo !== 'ambiguo' && extractedEmpName.length >= 4) {
    const pool = matchedCompany
      ? employees.filter((e) => e.empresaId === matchedCompany!.id)
      : employees;
    const exactMatches = pool.filter((e) => normalizeText(e.nomeCompleto) === extractedEmpName);
    if (exactMatches.length === 1) {
      matchedEmployee = exactMatches[0];
      colaboradorMatchMetodo = 'nome';
    } else if (exactMatches.length > 1) {
      colaboradorMatchMetodo = 'ambiguo';
      extraInconsistencies.push({
        codigo: 'COLABORADOR_NOME_AMBIGUO',
        severidade: 'media',
        campo: 'nomeColaborador',
        mensagem: 'Nome de colaborador ambíguo no cadastro. Vincule manualmente usando o CPF.',
      });
    }
  }

  // Validate CPF & Name consistency against matched employee
  if (matchedEmployee) {
    if (
      extractedCpfDigits.length === 11 &&
      normalizeDigits(matchedEmployee.cpf) !== extractedCpfDigits
    ) {
      extraInconsistencies.push({
        codigo: 'DIVERGENCIA_CPF',
        severidade: 'alta',
        campo: 'cpf',
        mensagem: `CPF extraído (${params.dados.cpf}) diverge do CPF do colaborador vinculado (${matchedEmployee.cpf}).`,
      });
    }

    if (extractedEmpName) {
      const docTokens = extractedEmpName.split(' ').filter((t) => t.length >= 3);
      const regTokens = new Set(normalizeText(matchedEmployee.nomeCompleto).split(' '));
      const common = docTokens.filter((t) => regTokens.has(t));
      if (docTokens.length > 0 && common.length === 0) {
        extraInconsistencies.push({
          codigo: 'DIVERGENCIA_NOME_COLABORADOR',
          severidade: 'alta',
          campo: 'nomeColaborador',
          mensagem: `Nome no documento ("${params.dados.nomeColaborador}") não confere com o colaborador vinculado ("${matchedEmployee.nomeCompleto}").`,
        });
      }
    }

    if (matchedCompany && matchedEmployee.empresaId !== matchedCompany.id) {
      extraInconsistencies.push({
        codigo: 'COLABORADOR_EMPRESA_DIVERGENTE',
        severidade: 'alta',
        campo: 'empresa',
        mensagem: `O colaborador "${matchedEmployee.nomeCompleto}" está alocado em "${matchedEmployee.empresaNome}", diferente da empresa vinculada.`,
      });
    }
  }

  return {
    empresaId: matchedCompany?.id || '',
    empresaNome: matchedCompany?.razaoSocial || '',
    empresaMatchMetodo,
    colaboradorId: matchedEmployee?.id || '',
    colaboradorNome: matchedEmployee?.nomeCompleto || '',
    colaboradorMatchMetodo,
    matchedCompany,
    matchedEmployee,
    extraInconsistencies,
  };
}

export function computeUnidentifiedFields(
  categoriaGrupo: SmartDocCategoryGroup,
  dados: SmartDocExtractedData
): string[] {
  const missing: string[] = [];
  const check = (val: string | undefined, label: string) => {
    if (!val || !val.trim()) missing.push(label);
  };

  if (categoriaGrupo === 'saude_ocupacional') {
    check(dados.nomeColaborador, 'Nome do colaborador');
    check(dados.cpf, 'CPF');
    check(dados.empresa, 'Empresa');
    check(dados.cnpj, 'CNPJ');
    check(dados.funcao, 'Função');
    check(dados.tipoExame, 'Tipo de exame');
    check(dados.dataRealizacao, 'Data de realização');
    check(dados.resultadoAptidao, 'Resultado de aptidão');
    check(dados.medicoResponsavel, 'Médico responsável');
    check(dados.crm, 'CRM');
    if (!dados.semValidade) check(dados.dataValidade, 'Data de vencimento');
  } else if (categoriaGrupo === 'treinamentos') {
    check(dados.nomeColaborador, 'Nome do colaborador');
    check(dados.cpf, 'CPF');
    check(dados.empresa, 'Empresa');
    check(dados.nomeTreinamento, 'Nome do treinamento');
    check(dados.nrCorrespondente, 'NR correspondente');
    check(dados.cargaHoraria, 'Carga horária');
    check(dados.dataRealizacao, 'Data de realização');
    if (!dados.semValidade) check(dados.dataValidade, 'Data de vencimento');
    check(dados.nomeInstrutor, 'Nome do instrutor');
    check(dados.registroProfissionalInstrutor, 'Registro profissional do RT/Instrutor');
    check(dados.instituicaoEmissora, 'Instituição emissora');
  } else {
    check(dados.razaoSocial || dados.empresa, 'Razão social');
    check(dados.cnpj, 'CNPJ');
    check(dados.unidade, 'Unidade');
    check(dados.dataEmissao, 'Data de emissão');
    check(dados.dataRevisao, 'Data de revisão');
    if (!dados.semValidade) check(dados.dataValidade, 'Data de validade');
    check(dados.responsavelTecnico, 'Responsável técnico');
    check(dados.registroProfissionalRT, 'Registro profissional');
  }

  return missing;
}

export function computeSmartDocInconsistencies(params: {
  categoriaGrupo: SmartDocCategoryGroup;
  dados: SmartDocExtractedData;
  empresaId?: string;
  colaboradorId?: string;
  linkInconsistencies?: SmartDocInconsistency[];
}): SmartDocInconsistency[] {
  const list: SmartDocInconsistency[] = [...(params.linkInconsistencies || [])];
  const today = getTodayBrazilIso();
  const { dados, categoriaGrupo } = params;

  if (dados.documentoIlegivel || dados.qualidadeLeitura === 'ilegivel') {
    list.push({
      codigo: 'DOCUMENTO_ILEGIVEL',
      severidade: 'alta',
      mensagem:
        'Documento identificado pelo OCR como ilegível ou com baixa qualidade visual. Revise manualmente ou solicite nova digitalização.',
    });
  } else if (dados.qualidadeLeitura === 'baixa') {
    list.push({
      codigo: 'QUALIDADE_OCR_BAIXA',
      severidade: 'media',
      mensagem:
        'Qualidade de leitura OCR baixa. Confira cuidadosamente datas, CPF/CNPJ e nomes extraídos antes de aprovar.',
    });
  }

  if (dados.documentoIncompleto) {
    list.push({
      codigo: 'DOCUMENTO_INCOMPLETO',
      severidade: 'alta',
      mensagem:
        'Documento aparenta estar incompleto (páginas, assinaturas ou informações obrigatórias ausentes).',
    });
  }

  if (!params.empresaId) {
    list.push({
      codigo: 'EMPRESA_NAO_VINCULADA',
      severidade: 'alta',
      campo: 'empresaId',
      mensagem: 'Empresa não vinculada automaticamente ao cadastro de contratadas. Selecione manualmente antes de aprovar.',
    });
  }

  if (
    (categoriaGrupo === 'saude_ocupacional' || categoriaGrupo === 'treinamentos') &&
    !params.colaboradorId
  ) {
    list.push({
      codigo: 'COLABORADOR_NAO_VINCULADO',
      severidade: 'alta',
      campo: 'colaboradorId',
      mensagem: 'Colaborador não vinculado automaticamente ao cadastro. Selecione manualmente antes de aprovar.',
    });
  }

  if (dados.dataValidade && !dados.semValidade) {
    const days = computeDaysDiff(dados.dataValidade, today);
    if (days !== null && days < 0) {
      list.push({
        codigo: 'DOCUMENTO_VENCIDO',
        severidade: 'alta',
        campo: 'dataValidade',
        mensagem: `Documento vencido há ${Math.abs(days)} dia(s) (${dados.dataValidade}).`,
      });
    } else if (days !== null && days <= 30) {
      list.push({
        codigo: 'DOCUMENTO_A_VENCER',
        severidade: 'media',
        campo: 'dataValidade',
        mensagem: `Documento vence em ${days} dia(s) (${dados.dataValidade}).`,
      });
    }
  } else if (!dados.semValidade) {
    list.push({
      codigo: 'SEM_VALIDADE_DEFINIDA',
      severidade: 'media',
      campo: 'dataValidade',
      mensagem: 'Data de vencimento não identificada no documento e sem regra automática aplicável.',
    });
  }

  if (dados.dataRealizacao) {
    const diffReal = computeDaysDiff(dados.dataRealizacao, today);
    if (diffReal !== null && diffReal > 0) {
      list.push({
        codigo: 'DATA_REALIZACAO_FUTURA',
        severidade: 'alta',
        campo: 'dataRealizacao',
        mensagem: `Data de realização (${dados.dataRealizacao}) está no futuro.`,
      });
    }
  }

  if (dados.dataEmissao) {
    const diffEmiss = computeDaysDiff(dados.dataEmissao, today);
    if (diffEmiss !== null && diffEmiss > 0) {
      list.push({
        codigo: 'DATA_EMISSAO_FUTURA',
        severidade: 'alta',
        campo: 'dataEmissao',
        mensagem: `Data de emissão (${dados.dataEmissao}) está no futuro.`,
      });
    }
  }

  if (categoriaGrupo === 'saude_ocupacional') {
    if (dados.resultadoAptidao === 'inapto') {
      list.push({
        codigo: 'COLABORADOR_INAPTO',
        severidade: 'alta',
        campo: 'resultadoAptidao',
        mensagem: 'ATENÇÃO: ASO indica resultado INAPTO para o trabalho.',
      });
    }
    if (!dados.resultadoAptidao) {
      list.push({
        codigo: 'APTIDAO_NAO_IDENTIFICADA',
        severidade: 'alta',
        campo: 'resultadoAptidao',
        mensagem: 'Conclusão de aptidão (Apto/Inapto) não identificada automaticamente.',
      });
    }
    if (!dados.dataRealizacao) {
      list.push({
        codigo: 'DATA_REALIZACAO_AUSENTE',
        severidade: 'alta',
        campo: 'dataRealizacao',
        mensagem: 'Data de realização do exame não identificada.',
      });
    }
  } else if (categoriaGrupo === 'treinamentos') {
    if (!dados.nomeTreinamento) {
      list.push({
        codigo: 'TREINAMENTO_NOME_AUSENTE',
        severidade: 'alta',
        campo: 'nomeTreinamento',
        mensagem: 'Nome do treinamento não identificado automaticamente.',
      });
    }
    if (!dados.dataRealizacao) {
      list.push({
        codigo: 'DATA_REALIZACAO_AUSENTE',
        severidade: 'alta',
        campo: 'dataRealizacao',
        mensagem: 'Data de realização do treinamento não identificada.',
      });
    }
  } else if (categoriaGrupo === 'documentos_empresariais') {
    if (!dados.dataEmissao) {
      list.push({
        codigo: 'DATA_EMISSAO_AUSENTE',
        severidade: 'media',
        campo: 'dataEmissao',
        mensagem: 'Data de emissão do documento empresarial não identificada.',
      });
    }
  }

  // Deduplicate by codigo
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.codigo)) return false;
    seen.add(item.codigo);
    return true;
  });
}

export function computeSmartDocValidityStatus(
  status: SmartDocProcessingState,
  dados: SmartDocExtractedData
): SmartDocValidityStatus {
  if (status === 'REJEITADO') return 'REJEITADO';
  if (status !== 'APROVADO') return 'PENDENTE_APROVACAO';
  if (dados.semValidade) return 'REGULAR';
  if (!dados.dataValidade) return 'SEM_VALIDADE_DEFINIDA';

  const days = computeDaysDiff(dados.dataValidade, getTodayBrazilIso());
  if (days === null) return 'SEM_VALIDADE_DEFINIDA';
  if (days < 0) return 'VENCIDO';
  if (days <= 30) return 'A_VENCER';
  return 'REGULAR';
}

export function applyLgpdProjection(
  record: SmartDocRecord,
  viewerRole: UserRole,
  options: { includeFileUrl: boolean }
): SmartDocRecord {
  const isMedical = record.isSensitiveMedical || isMedicalCategory(record.categoriaGrupo, record.tipoDocumento);
  const canViewMedicalDetails = viewerRole === 'admin';

  const projected: SmartDocRecord = {
    ...record,
    isSensitiveMedical: isMedical,
    lgpdRedacted: isMedical && !canViewMedicalDetails,
  };

  if (!options.includeFileUrl) {
    delete projected.arquivoUrl;
  }

  if (isMedical && !canViewMedicalDetails) {
    delete projected.arquivoUrl;
    projected.previewIndisponivelMotivo =
      'Documento clínico protegido por sigilo médico (LGPD). Visualização restrita ao SESMT / Administrador EHS.';
    projected.dadosExtraidos = {
      ...projected.dadosExtraidos,
      resultadoAptidao: '',
      medicoResponsavel: projected.dadosExtraidos.medicoResponsavel ? '[Sigilo Médico - LGPD]' : '',
      crm: projected.dadosExtraidos.crm ? '[Restrito]' : '',
      resumoConteudo: '[Resumo clínico ocultado conforme LGPD]',
      observacoes: '[Observações médicas restritas ao SESMT]',
    };
  }

  return projected;
}

export async function logSmartDocAudit(params: {
  usuarioNome: string;
  usuarioEmail: string;
  acao: string;
  entidadeId: string;
  detalhes: string;
}) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      usuario: params.usuarioNome,
      usuarioEmail: params.usuarioEmail,
      acao: params.acao,
      entidade: 'EHS SmartDocs',
      entidadeId: params.entidadeId,
      detalhes: params.detalhes,
      dataHora: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[SmartDocs AuditLog] Falha ao gravar trilha de auditoria:', err);
  }
}

export function removeUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        clean[k] = removeUndefinedDeep(v);
      }
    }
    return clean as T;
  }
  return obj;
}

export async function findDuplicateBySha256(sha256: string, excludeId?: string): Promise<SmartDocRecord | null> {
  const snap = await getDocs(collection(db, 'smartDocs'));
  for (const d of snap.docs) {
    if (excludeId && d.id === excludeId) continue;
    const data = d.data() as Omit<SmartDocRecord, 'id'>;
    if (data.arquivoHashSha256 === sha256 && data.status !== 'REJEITADO') {
      return { id: d.id, ...data };
    }
  }
  return null;
}

export async function deletePreservedFileChunks(smartDocId: string): Promise<void> {
  try {
    const q = query(collection(db, 'smartDocFileChunks'), where('smartDocId', '==', smartDocId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (err) {
    console.warn('[SmartDocs] Falha ao limpar fragmentos antigos de arquivo:', err);
  }
}

export async function savePreservedSmartDocFile(params: {
  smartDocId: string;
  mimeType: SmartDocRecord['arquivoMimeType'];
  base64Data: string;
  cleanDataUrl: string;
}): Promise<{
  arquivoUrl: string;
  fileStorageMode: 'inline' | 'chunked';
  chunkCount: number;
  hasPreservedFile: boolean;
  previewTruncated: boolean;
  previewIndisponivelMotivo: string;
}> {
  if (params.cleanDataUrl.length <= MAX_FIRESTORE_INLINE_DATAURL_CHARS) {
    await deletePreservedFileChunks(params.smartDocId);
    return {
      arquivoUrl: params.cleanDataUrl,
      fileStorageMode: 'inline',
      chunkCount: 0,
      hasPreservedFile: true,
      previewTruncated: false,
      previewIndisponivelMotivo: '',
    };
  }

  await deletePreservedFileChunks(params.smartDocId);
  const chunks: string[] = [];
  for (let i = 0; i < params.base64Data.length; i += MAX_FILE_CHUNK_CHARS) {
    chunks.push(params.base64Data.slice(i, i + MAX_FILE_CHUNK_CHARS));
  }

  const nowIso = new Date().toISOString();
  await Promise.all(
    chunks.map((chunkData, idx) =>
      setDoc(doc(db, 'smartDocFileChunks', `${params.smartDocId}_chunk_${idx}`), {
        smartDocId: params.smartDocId,
        chunkIndex: idx,
        totalChunks: chunks.length,
        mimeType: params.mimeType,
        data: chunkData,
        updatedAt: nowIso,
      })
    )
  );

  return {
    arquivoUrl: '',
    fileStorageMode: 'chunked',
    chunkCount: chunks.length,
    hasPreservedFile: true,
    previewTruncated: false,
    previewIndisponivelMotivo: '',
  };
}

export async function loadPreservedSmartDocFile(record: SmartDocRecord): Promise<{
  mimeType: SmartDocRecord['arquivoMimeType'];
  base64Data: string;
  cleanDataUrl: string;
} | null> {
  if (record.arquivoUrl) {
    const match = record.arquivoUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if (match) {
      return {
        mimeType: record.arquivoMimeType,
        base64Data: match[2],
        cleanDataUrl: record.arquivoUrl,
      };
    }
  }

  if (record.fileStorageMode === 'chunked' || (record.chunkCount && record.chunkCount > 0)) {
    const q = query(collection(db, 'smartDocFileChunks'), where('smartDocId', '==', record.id));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const sorted = snap.docs
        .map((d) => d.data() as { chunkIndex: number; data: string; mimeType?: SmartDocRecord['arquivoMimeType'] })
        .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
      const base64Data = sorted.map((c) => c.data || '').join('');
      if (base64Data) {
        const mimeType = sorted[0]?.mimeType || record.arquivoMimeType;
        return {
          mimeType,
          base64Data,
          cleanDataUrl: `data:${mimeType};base64,${base64Data}`,
        };
      }
    }
  }

  return null;
}

export async function getSmartDocByIdRaw(id: string): Promise<SmartDocRecord | null> {
  const snap = await getDoc(doc(db, 'smartDocs', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<SmartDocRecord, 'id'>) };
}

export async function saveSmartDocRecord(record: SmartDocRecord): Promise<void> {
  const { id, ...payload } = record;
  await setDoc(doc(db, 'smartDocs', id), removeUndefinedDeep(payload));
}

export async function updateSmartDocFields(id: string, updates: Partial<SmartDocRecord>): Promise<void> {
  await updateDoc(doc(db, 'smartDocs', id), removeUndefinedDeep(updates));
}

export async function deleteRejectedSmartDocTransactional(params: {
  id: string;
  usuarioNome: string;
  usuarioEmail: string;
}): Promise<{
  deletedId: string;
  arquivoNome: string;
  deletedChunksCount: number;
}> {
  const smartDocRef = doc(db, 'smartDocs', params.id);
  const chunksQuery = query(
    collection(db, 'smartDocFileChunks'),
    where('smartDocId', '==', params.id)
  );
  const queriedChunksSnap = await getDocs(chunksQuery);

  return await runTransaction(db, async (tx) => {
    // 1. All reads MUST happen before any writes in Firestore transactions
    const docSnap = await tx.get(smartDocRef);
    if (!docSnap.exists()) {
      throw new SmartDocsValidationError(
        'Documento SmartDocs não encontrado.',
        404,
        'SMARTDOC_NOT_FOUND'
      );
    }

    const data = docSnap.data() as Omit<SmartDocRecord, 'id'>;
    if (data.status !== 'REJEITADO') {
      throw new SmartDocsValidationError(
        `Exclusão não permitida: apenas documentos com status REJEITADO podem ser excluídos definitivamente (status atual: ${data.status}).`,
        409,
        'DELETE_ONLY_REJECTED_ALLOWED'
      );
    }

    if (data.integratedDocId) {
      throw new SmartDocsValidationError(
        'Exclusão bloqueada: documento possui vínculo com registro oficial integrado.',
        409,
        'DELETE_INTEGRATED_BLOCKED'
      );
    }

    // Build deduplicated list of preserved chunk references to delete atomically
    const chunkRefsMap = new Map<string, ReturnType<typeof doc>>();
    queriedChunksSnap.docs.forEach((d) => {
      chunkRefsMap.set(d.ref.path, d.ref);
    });
    const declaredChunkCount = Number(data.chunkCount || 0);
    for (let i = 0; i < declaredChunkCount; i++) {
      const ref = doc(db, 'smartDocFileChunks', `${params.id}_chunk_${i}`);
      chunkRefsMap.set(ref.path, ref);
    }

    // 2. Atomic writes: delete preserved file chunks, delete smartDocs record, write audit log
    for (const chunkRef of chunkRefsMap.values()) {
      tx.delete(chunkRef);
    }
    tx.delete(smartDocRef);

    const auditRef = doc(collection(db, 'auditLogs'));
    tx.set(auditRef, {
      usuario: params.usuarioNome,
      usuarioEmail: params.usuarioEmail || '',
      acao: 'Exclusão de Documento Recusado',
      entidade: 'EHS SmartDocs',
      entidadeId: params.id,
      detalhes: `Documento recusado "${data.arquivoNome}" (Tipo: ${data.tipoDocumento}, Empresa: ${data.empresaNome || 'Não vinculada'}) excluído definitivamente por ${params.usuarioNome}.`,
      dataHora: new Date().toISOString(),
    });

    return {
      deletedId: params.id,
      arquivoNome: data.arquivoNome,
      deletedChunksCount: chunkRefsMap.size,
    };
  });
}

export type { SmartDocHistoryEntry, SmartDocProcessingAttempt, SmartDocRecord };
