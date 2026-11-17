import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './notificationEngine';
import type {
  Company,
  Employee,
  SmartDocCategoryGroup,
  SmartDocExtractedData,
  SmartDocHistoryEntry,
  SmartDocInconsistency,
  SmartDocProcessingState,
  SmartDocRecord,
  SmartDocValidityRule,
  SmartDocValidityStatus,
  UserRole,
} from '../src/types/sst';

export const SMARTDOC_MODEL = 'gemini-4-hydrogen';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB for OCR/IA processing
export const MAX_FIRESTORE_INLINE_DATAURL_CHARS = 700_000; // Safe below Firestore 1 MiB document cap

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
  readonly code = 'GEMINI_API_KEY_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'SmartDocsAiConfigError';
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
  const dataUrlMatch = rawDataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!dataUrlMatch) {
    throw new SmartDocsValidationError(
      'Conteúdo do arquivo inválido. Envie um arquivo codificado corretamente.',
      400,
      'INVALID_FILE_PAYLOAD'
    );
  }

  const detectedMime = dataUrlMatch[1].toLowerCase();
  const base64Data = dataUrlMatch[2];
  const declaredMime = (params.mimeType || detectedMime).toLowerCase();

  const effectiveMime = (
    detectedMime === 'image/jpg' ? 'image/jpeg' : detectedMime
  ) as SmartDocRecord['arquivoMimeType'];

  if (
    !ALLOWED_MIME_TYPES.has(effectiveMime) ||
    (declaredMime !== detectedMime && !(declaredMime === 'image/jpg' && detectedMime === 'image/jpeg'))
  ) {
    throw new SmartDocsValidationError(
      'Tipo MIME incompatível ou não permitido. Aceitos exclusivamente PDF, JPG, JPEG e PNG.',
      400,
      'INVALID_MIME_TYPE'
    );
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) {
    throw new SmartDocsValidationError('O arquivo enviado está vazio.', 400, 'EMPTY_FILE');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new SmartDocsValidationError(
      'Arquivo excede o limite máximo de 5 MB para processamento.',
      413,
      'FILE_TOO_LARGE'
    );
  }

  // Magic-byte verification to block disguised executables/scripts
  const isPdfMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46; // %PDF
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

  if (
    (effectiveMime === 'application/pdf' && !isPdfMagic) ||
    (effectiveMime === 'image/jpeg' && !isJpegMagic) ||
    (effectiveMime === 'image/png' && !isPngMagic)
  ) {
    throw new SmartDocsValidationError(
      'Assinatura binária do arquivo não corresponde ao formato declarado (arquivo corrompido ou adulterado).',
      400,
      'MAGIC_BYTE_MISMATCH'
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

export async function runGeminiDocumentExtraction(params: {
  base64Data: string;
  mimeType: SmartDocRecord['arquivoMimeType'];
  fileName: string;
  manualClassification?: {
    categoriaGrupo?: SmartDocCategoryGroup;
    tipoDocumento?: string;
  };
}): Promise<{
  categoriaGrupo: SmartDocCategoryGroup;
  tipoDocumento: string;
  classificacaoConfianca: number;
  dadosExtraidos: SmartDocExtractedData;
}> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'CONFIGURE_YOUR_GEMINI_API_KEY') {
    throw new SmartDocsAiConfigError(
      'Serviço de leitura inteligente (Gemini AI) indisponível: variável de ambiente GEMINI_API_KEY não configurada no servidor.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const systemInstruction = `Você é um motor de OCR e interpretação documental especialista em Segurança, Saúde e Meio Ambiente (SSMA/EHS) brasileiro.
Analise integralmente o documento enviado (PDF digital, digitalização escaneada ou foto de celular) e extraia EXCLUSIVAMENTE os dados realmente presentes e legíveis no documento.

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
7. Para resultadoAptidao (em ASO/saúde): use apenas "apto", "inapto", "apto_com_restricoes" ou "" se não explícito.`;

  const manualHint =
    params.manualClassification?.tipoDocumento
      ? `Observação do usuário: classificação sugerida manualmente como "${params.manualClassification.tipoDocumento}" (${params.manualClassification.categoriaGrupo || 'não informada'}). Ainda assim extraia os campos reais presentes no arquivo.`
      : '';

  const response = await ai.models.generateContent({
    model: SMARTDOC_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          {
            text: `Realize OCR completo e extração estruturada do arquivo "${params.fileName}". ${manualHint}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction,
      temperature: 0.1,
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

  const rawText = (response.text || '').trim();
  if (!rawText) {
    throw new Error('O motor de IA não retornou conteúdo interpretável para o documento.');
  }

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Resposta estruturada inválida retornada pela leitura inteligente.');
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
  };
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

export type { SmartDocHistoryEntry, SmartDocRecord };
