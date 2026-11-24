import type {
  ActivityComplianceItemResult,
  ActivityComplianceOverallStatus,
  ActivityComplianceResult,
  ActivityComplianceSnapshot,
  ActivityDocumentRequirement,
  ActivityProfile,
  ActivityRequirementComplianceStatus,
  Company,
  DocumentSST,
  Employee,
  EmployeeActivityComplianceSummary,
  EPIDelivery,
  OccupationalExam,
  SafetyPermit,
  SmartDocRecord,
  Training,
} from '../types/sst';

/**
 * MOTOR UNIFICADO DE CONFORMIDADE POR ATIVIDADE — GESTÃO DE TERCEIROS (EHS MORE)
 *
 * NOTA ARQUITETURAL E DE SEGURANÇA:
 * Este motor é uma função pura compartilhável para avaliação determinística em tempo real
 * no frontend (experiência do usuário e visualização de pendências).
 * O frontend NÃO constitui autoridade definitiva para liberação de atividades em produção:
 * antes da liberação real em produção, esta mesma validação deverá ser executada de forma
 * autoritativa no backend com verificação de token JWT próprio (Etapa 5).
 */

export interface EvaluateActivityComplianceInput {
  company: Company | null | undefined;
  atividadeIds: string[];
  colaboradorIds: string[];
  activityProfiles: ActivityProfile[];
  requirements: ActivityDocumentRequirement[];
  employees: Employee[];
  documents: DocumentSST[];
  trainings: Training[];
  exams: OccupationalExam[];
  epiDeliveries: EPIDelivery[];
  safetyPermits: SafetyPermit[];
  smartDocs?: SmartDocRecord[];
  /**
   * Data efetiva da atividade (YYYY-MM-DD ou DD/MM/YYYY).
   * Quando omitida, assume a data local atual.
   * Quando informada em formato inválido, bloqueia a liberação (fail-closed).
   */
  dataReferenciaAtividade?: string;
  /**
   * Data final prevista da atividade (opcional). Se posterior à data inicial,
   * a validade documental deve cobrir até o término previsto da execução.
   */
  dataFimAtividade?: string;
  /**
   * ID de um SafetyPermit específico em avaliação/edição (opcional).
   */
  permitAtualId?: string;
}

interface UnifiedRequirement {
  requirementId: string;
  activityIds: string[];
  activityNomes: string[];
  nomeExibicao: string;
  documentoCodigoCanonico: string;
  palavrasChaveMatch: string[];
  escopo: ActivityDocumentRequirement['escopo'];
  origemColecao: ActivityDocumentRequirement['origemColecao'];
  funcoesAplicaveis: string[];
  exigeAptoASO: boolean;
  aptidaoEspecifica?: string;
  obrigatorioParaLiberacao: boolean;
  baseLegal?: string;
  ordemExibicao: number;
}

interface CandidateEvaluation {
  status: ActivityRequirementComplianceStatus;
  motivo: string;
  matchedRecordId?: string;
  matchedCollection?: ActivityDocumentRequirement['origemColecao'] | 'smartDocs';
  matchedTitulo?: string;
  dataEmissao?: string;
  dataValidade?: string;
  diasRestantes?: number | null;
  pendenteSmartDocId?: string;
}

const WARNING_DAYS_THRESHOLD = 30;

// Termos excessivamente genéricos ignorados no matching por palavras-chave para evitar falsos positivos
const GENERIC_LEGACY_STOPWORDS = new Set([
  'epi',
  'ar',
  'documento',
  'documentos',
  'certificado',
  'treinamento',
  'exame',
  'exame ocupacional',
  'outros',
  'altura',
  'eletricidade',
  'obras',
]);

// Palavras-chave que comprovam aptidões específicas em ASOs legados (sem aptidoesEspecificas estruturado)
const APTITUDE_POSITIVE_KEYWORDS: Record<string, string[]> = {
  trabalho_altura: ['trabalho em altura', 'trabalho altura', 'nr-35', 'nr 35', 'nr35', 'apto altura', 'apto para altura'],
  espaco_confinado: ['espaco confinado', 'espacos confinados', 'nr-33', 'nr 33', 'nr33'],
  eletricidade: ['eletricidade', 'servicos eletricos', 'instalacoes eletricas', 'nr-10', 'nr 10', 'nr10', 'sep'],
  trabalho_quente: ['trabalho a quente', 'solda', 'soldagem'],
  escavacao: ['escavacao', 'escavacoes', 'nr-18', 'nr 18', 'nr18'],
};

const NEGATIVE_APTITUDE_PHRASES = [
  'inapto',
  'nao apto',
  'contra indicado',
  'contraindicado',
  'proibido',
  'vedado',
  'restricao para',
  'com restricao para',
];

const STATUS_PRECEDENCE: Record<ActivityRequirementComplianceStatus, number> = {
  CONFORME: 7,
  A_VENCER: 6,
  PENDENTE_APROVACAO: 5,
  ASO_INAPTO: 4,
  VENCIDO: 3,
  REPROVADO: 2,
  AUSENTE: 1,
};

const PENDING_SMARTDOC_STATES = new Set<SmartDocRecord['status']>([
  'AGUARDANDO_PROCESSAMENTO',
  'PROCESSANDO',
  'PROCESSADO',
  'PENDENTE_APROVACAO',
]);

export function normalizeMatchText(value?: string | null): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCanonicalCode(code?: string | null): string {
  if (!code) return '';
  const cleaned = code
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');

  // Normaliza NR35 -> NR-35, NR10-SEP -> NR-10-SEP, NR33-SUPERVISOR -> NR-33-SUPERVISOR
  return cleaned.replace(/^NR(\d{1,2})(?=-|$)/, 'NR-$1');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(normalizedHaystack: string, normalizedNeedle: string): boolean {
  if (!normalizedHaystack || !normalizedNeedle) return false;
  const regex = new RegExp(`(?:^| )${escapeRegExp(normalizedNeedle)}(?: |$)`);
  return regex.test(normalizedHaystack);
}

function extractNrNumbers(normalizedText: string): string[] {
  const matches = new Set<string>();
  const regex = /(?:^| )nr ?0?(\d{1,2})(?: |$)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(normalizedText)) !== null) {
    matches.add(m[1].padStart(2, '0'));
  }
  return Array.from(matches);
}

function extractCanonicalNr(canonicalCode: string): string | null {
  const match = canonicalCode.match(/^NR-0?(\d{1,2})(?:-|$)/);
  return match ? match[1].padStart(2, '0') : null;
}

/**
 * Faz parsing seguro de datas de calendário (YYYY-MM-DD, ISO ou DD/MM/YYYY) sem rollover silencioso.
 */
export function parseCalendarDate(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  let year: number;
  let month: number;
  let day: number;

  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    day = Number(brMatch[1]);
    month = Number(brMatch[2]);
    year = Number(brMatch[3]);
  } else {
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!isoMatch) return null;
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) {
    return null;
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }
  return utcDate;
}

function getTodayUtcCalendarDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function diffCalendarDays(targetDate: Date, referenceDate: Date): number {
  return Math.round((targetDate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
}

function formatUtcDateIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Verifica se um requisito com filtro de funções se aplica ao cargo do colaborador terceirizado.
 * Se funcoesAplicaveis estiver vazio, aplica-se a todos os terceirizados executantes.
 */
export function doesRequirementApplyToRole(
  funcoesAplicaveis: string[] | undefined,
  cargoColaborador?: string
): boolean {
  if (!funcoesAplicaveis || funcoesAplicaveis.length === 0) {
    return true;
  }

  const normalizedCargo = normalizeMatchText(cargoColaborador);
  if (!normalizedCargo) {
    return false;
  }

  const cargoTokens = new Set(normalizedCargo.split(' ').filter(Boolean));

  return funcoesAplicaveis.some((rolePattern) => {
    const normalizedPattern = normalizeMatchText(rolePattern);
    if (!normalizedPattern) return false;
    if (normalizedCargo === normalizedPattern) return true;
    if (containsWholePhrase(normalizedCargo, normalizedPattern)) return true;

    // Exige que TODOS os tokens relevantes do padrão estejam presentes como palavras inteiras no cargo
    const patternTokens = normalizedPattern.split(' ').filter((t) => t.length >= 2);
    if (patternTokens.length === 0) return false;
    return patternTokens.every((token) => cargoTokens.has(token));
  });
}

/**
 * Avalia se um texto legado (sem tipoDocumentoCanonico) corresponde ao requisito de forma não ambígua.
 */
function matchesLegacyTextUnambiguously(
  rawText: string,
  canonicalCode: string,
  palavrasChaveMatch: string[]
): boolean {
  const normalizedText = normalizeMatchText(rawText);
  if (!normalizedText) return false;

  const normCanonical = normalizeCanonicalCode(canonicalCode);

  // Regras estritas para ASO (evita que ASO Demissional ou Exame Complementar satisfaça ASO ocupacional)
  if (normCanonical === 'ASO') {
    if (containsWholePhrase(normalizedText, 'demissional')) return false;
    if (containsWholePhrase(normalizedText, 'exame complementar')) return false;
    return (
      containsWholePhrase(normalizedText, 'aso') ||
      containsWholePhrase(normalizedText, 'atestado de saude ocupacional')
    );
  }

  // Isolamento por número de NR: não permite que NR-12 satisfaça NR-35, nem que NR-10 Básico satisfaça NR-10-SEP
  const reqNr = extractCanonicalNr(normCanonical);
  if (reqNr) {
    const foundNrs = extractNrNumbers(normalizedText);
    if (foundNrs.length > 0 && !foundNrs.includes(reqNr)) {
      return false;
    }

    if (normCanonical === 'NR-10-SEP') {
      const hasSepMarker =
        containsWholePhrase(normalizedText, 'sep') ||
        containsWholePhrase(normalizedText, 'sistema eletrico de potencia') ||
        containsWholePhrase(normalizedText, 'alta tensao');
      if (!hasSepMarker) return false;
    }

    if (normCanonical === 'NR-33-SUPERVISOR') {
      const hasSupervisorMarker =
        containsWholePhrase(normalizedText, 'supervisor') ||
        containsWholePhrase(normalizedText, 'supervisor de entrada') ||
        containsWholePhrase(normalizedText, '40h') ||
        containsWholePhrase(normalizedText, '40 horas');
      if (!hasSupervisorMarker) return false;
    }

    // Se o requisito é NR-10 básico e o texto menciona explicitamente outro NR sem NR-10, já foi filtrado acima.
    // Match direto pelo código da NR normalizado (ex.: "nr 35", "nr35")
    if (foundNrs.includes(reqNr)) {
      return true;
    }
  }

  // Regras estritas para documentos corporativos e permissões de sigla curta
  if (normCanonical === 'PGR') {
    if (containsWholePhrase(normalizedText, 'pcmso') && !containsWholePhrase(normalizedText, 'pgr')) {
      return false;
    }
  }
  if (normCanonical === 'PCMSO') {
    if (containsWholePhrase(normalizedText, 'pgr') && !containsWholePhrase(normalizedText, 'pcmso')) {
      return false;
    }
  }
  if (normCanonical === 'PET') {
    return (
      containsWholePhrase(normalizedText, 'pet') ||
      containsWholePhrase(normalizedText, 'permissao de entrada e trabalho')
    );
  }

  const candidateKeywords = new Set<string>();
  const normalizedCanonicalPhrase = normalizeMatchText(normCanonical);
  if (normalizedCanonicalPhrase && !GENERIC_LEGACY_STOPWORDS.has(normalizedCanonicalPhrase)) {
    candidateKeywords.add(normalizedCanonicalPhrase);
  }

  for (const kw of palavrasChaveMatch || []) {
    const normKw = normalizeMatchText(kw);
    if (!normKw || normKw.length < 2) continue;
    if (GENERIC_LEGACY_STOPWORDS.has(normKw)) continue;
    candidateKeywords.add(normKw);
  }

  for (const kw of candidateKeywords) {
    if (containsWholePhrase(normalizedText, kw)) {
      return true;
    }
  }

  return false;
}

/**
 * Matching com prioridade para tipoDocumentoCanonico e fallback seguro para documentos legados.
 * Se o registro já possui tipoDocumentoCanonico diferente do requisito, rejeita sem cair em texto livre.
 */
function matchesRecordToRequirement(params: {
  recordCanonicalCode?: string;
  legacySearchTexts: (string | undefined | null)[];
  requirement: UnifiedRequirement;
}): boolean {
  const reqCanonical = normalizeCanonicalCode(params.requirement.documentoCodigoCanonico);
  const recCanonical = normalizeCanonicalCode(params.recordCanonicalCode);

  if (recCanonical) {
    return recCanonical === reqCanonical;
  }

  const combinedLegacyText = params.legacySearchTexts.filter(Boolean).join(' | ');
  if (!combinedLegacyText.trim()) return false;

  return matchesLegacyTextUnambiguously(
    combinedLegacyText,
    reqCanonical,
    params.requirement.palavrasChaveMatch
  );
}

/**
 * Avalia se o ASO comprova a aptidão específica exigida pela atividade (sem presumir aptidão ausente).
 */
function hasConfirmedAsoAptitude(exam: OccupationalExam, aptidaoEspecifica?: string): boolean {
  if (!aptidaoEspecifica) return true;

  const targetNorm = normalizeMatchText(aptidaoEspecifica);
  if (!targetNorm) return true;

  const targetKey = targetNorm.replace(/\s+/g, '_');

  // 1. Verifica campo estruturado aptidoesEspecificas
  if (Array.isArray(exam.aptidoesEspecificas) && exam.aptidoesEspecificas.length > 0) {
    const structuredMatch = exam.aptidoesEspecificas.some((apt) => {
      const n = normalizeMatchText(apt);
      return n === targetNorm || n.replace(/\s+/g, '_') === targetKey;
    });
    if (structuredMatch) return true;
  }

  // 2. Fallback controlado para ASOs legados: exige menção positiva explícita em observacoes/tipoExame e ausência de restrição/negação
  const legacyText = normalizeMatchText(`${exam.tipoExame || ''} ${exam.observacoes || ''}`);
  if (!legacyText) return false;

  const keywords = APTITUDE_POSITIVE_KEYWORDS[targetKey] || [targetNorm];
  const mentionsAptitude = keywords.some((kw) => containsWholePhrase(legacyText, normalizeMatchText(kw)));
  if (!mentionsAptitude) return false;

  const hasNegativeContext = NEGATIVE_APTITUDE_PHRASES.some((neg) => containsWholePhrase(legacyText, neg));
  return !hasNegativeContext;
}

function evaluateDateValidityAgainstReference(params: {
  dataValidade?: string;
  semValidade?: boolean;
  evaluationDate: Date;
  label: string;
}): {
  status: 'CONFORME' | 'A_VENCER' | 'VENCIDO' | 'PENDENTE_APROVACAO';
  motivo: string;
  diasRestantes: number | null;
} {
  if (params.semValidade === true) {
    return {
      status: 'CONFORME',
      motivo: `${params.label} aprovado (sem vencimento).`,
      diasRestantes: null,
    };
  }

  const parsedValidity = parseCalendarDate(params.dataValidade);
  if (!parsedValidity) {
    return {
      status: 'PENDENTE_APROVACAO',
      motivo: `${params.label} sem data de validade válida e não marcado como sem validade (não é possível confirmar vigência).`,
      diasRestantes: null,
    };
  }

  const days = diffCalendarDays(parsedValidity, params.evaluationDate);

  if (days < 0) {
    return {
      status: 'VENCIDO',
      motivo: `${params.label} vencido há ${Math.abs(days)} dia(s) em relação à data efetiva da atividade (${formatUtcDateIso(params.evaluationDate)}).`,
      diasRestantes: days,
    };
  }

  if (days <= WARNING_DAYS_THRESHOLD) {
    return {
      status: 'A_VENCER',
      motivo: `${params.label} aprovado e vigente, com vencimento em ${days} dia(s) a partir da data da atividade.`,
      diasRestantes: days,
    };
  }

  return {
    status: 'CONFORME',
    motivo: `${params.label} aprovado e vigente (${days} dias restantes na data da atividade).`,
    diasRestantes: days,
  };
}

function pickBestCandidate(candidates: CandidateEvaluation[]): CandidateEvaluation | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, current) => {
    const bestScore = STATUS_PRECEDENCE[best.status];
    const currScore = STATUS_PRECEDENCE[current.status];
    if (currScore > bestScore) return current;
    if (currScore < bestScore) return best;

    // Em empate de status, prefere maior diasRestantes (mais tempo de validade)
    const bestDays = best.diasRestantes ?? -999999;
    const currDays = current.diasRestantes ?? -999999;
    return currDays > bestDays ? current : best;
  });
}

function evaluateSmartDocCandidates(params: {
  smartDocs: SmartDocRecord[];
  companyId: string;
  colaboradorId?: string;
  requirement: UnifiedRequirement;
}): CandidateEvaluation[] {
  const results: CandidateEvaluation[] = [];

  for (const sd of params.smartDocs) {
    if (sd.empresaId !== params.companyId) continue;

    if (params.requirement.escopo === 'colaborador') {
      if (!params.colaboradorId || sd.colaboradorId !== params.colaboradorId) continue;
    }

    // SmartDoc já aprovado precisa existir na coleção oficial; não concede CONFORME isoladamente
    if (sd.status === 'APROVADO') continue;

    const sdCanonical =
      sd.dadosExtraidos?.nrCorrespondente ||
      (sd.categoriaGrupo === 'saude_ocupacional' ? 'ASO' : sd.tipoDocumento);

    const matched = matchesRecordToRequirement({
      recordCanonicalCode: undefined,
      legacySearchTexts: [
        sdCanonical,
        sd.tipoDocumento,
        sd.dadosExtraidos?.nomeDocumento,
        sd.dadosExtraidos?.nomeTreinamento,
        sd.dadosExtraidos?.tipoExame,
        sd.arquivoNome,
      ],
      requirement: params.requirement,
    });

    if (!matched) continue;

    if (PENDING_SMARTDOC_STATES.has(sd.status)) {
      results.push({
        status: 'PENDENTE_APROVACAO',
        motivo: `Documento "${sd.arquivoNome}" enviado via EHS SmartDocs (${sd.status}), aguardando aprovação humana obrigatória.`,
        matchedRecordId: sd.id,
        matchedCollection: 'smartDocs',
        matchedTitulo: sd.dadosExtraidos?.nomeDocumento || sd.tipoDocumento || sd.arquivoNome,
        dataEmissao: sd.dadosExtraidos?.dataEmissao || sd.dadosExtraidos?.dataRealizacao,
        dataValidade: sd.dadosExtraidos?.dataValidade,
        diasRestantes: null,
        pendenteSmartDocId: sd.id,
      });
    } else if (sd.status === 'REJEITADO') {
      results.push({
        status: 'REPROVADO',
        motivo: `Documento "${sd.arquivoNome}" rejeitado no EHS SmartDocs${sd.motivoRejeicao ? `: ${sd.motivoRejeicao}` : '.'}`,
        matchedRecordId: sd.id,
        matchedCollection: 'smartDocs',
        matchedTitulo: sd.tipoDocumento || sd.arquivoNome,
        dataEmissao: sd.dadosExtraidos?.dataEmissao || sd.dadosExtraidos?.dataRealizacao,
        diasRestantes: null,
      });
    }
  }

  return results;
}

function evaluateSingleRequirement(params: {
  requirement: UnifiedRequirement;
  companyId: string;
  employee?: Employee;
  documents: DocumentSST[];
  trainings: Training[];
  exams: OccupationalExam[];
  epiDeliveries: EPIDelivery[];
  safetyPermits: SafetyPermit[];
  smartDocs: SmartDocRecord[];
  startDate: Date;
  evaluationDate: Date;
  permitAtualId?: string;
}): ActivityComplianceItemResult {
  const { requirement, companyId, employee, evaluationDate, startDate } = params;
  const candidates: CandidateEvaluation[] = [];

  // 1. Avalia registros na coleção oficial correspondente
  if (requirement.origemColecao === 'documents') {
    for (const docItem of params.documents) {
      if (docItem.empresaId !== companyId) continue;
      if (requirement.escopo === 'colaborador') {
        if (!employee || docItem.colaboradorId !== employee.id) continue;
      } else if (requirement.escopo === 'empresa') {
        // Documento empresarial não deve ser confundido com documento exclusivo de um colaborador
        if (docItem.colaboradorId && docItem.colaboradorId.trim() !== '') continue;
      }

      const matched = matchesRecordToRequirement({
        recordCanonicalCode: docItem.tipoDocumentoCanonico,
        legacySearchTexts: [docItem.nomeDocumento, docItem.numeroDocumento, docItem.observacoes],
        requirement,
      });
      if (!matched) continue;

      if (docItem.situacao === 'pendente') {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `Documento "${docItem.nomeDocumento}" enviado e aguardando aprovação técnica.`,
          matchedRecordId: docItem.id,
          matchedCollection: 'documents',
          matchedTitulo: docItem.nomeDocumento,
          dataEmissao: docItem.dataEmissao,
          dataValidade: docItem.dataValidade,
          diasRestantes: null,
        });
      } else if (docItem.situacao === 'reprovado') {
        candidates.push({
          status: 'REPROVADO',
          motivo: `Documento "${docItem.nomeDocumento}" reprovado${docItem.motivoReprovacao ? `: ${docItem.motivoReprovacao}` : '.'}`,
          matchedRecordId: docItem.id,
          matchedCollection: 'documents',
          matchedTitulo: docItem.nomeDocumento,
          dataEmissao: docItem.dataEmissao,
          dataValidade: docItem.dataValidade,
          diasRestantes: null,
        });
      } else if (docItem.situacao === 'vencido') {
        candidates.push({
          status: 'VENCIDO',
          motivo: `Documento "${docItem.nomeDocumento}" encontra-se vencido.`,
          matchedRecordId: docItem.id,
          matchedCollection: 'documents',
          matchedTitulo: docItem.nomeDocumento,
          dataEmissao: docItem.dataEmissao,
          dataValidade: docItem.dataValidade,
          diasRestantes: docItem.dataValidade
            ? (() => {
                const parsed = parseCalendarDate(docItem.dataValidade);
                return parsed ? diffCalendarDays(parsed, evaluationDate) : null;
              })()
            : null,
        });
      } else if (docItem.situacao === 'aprovado') {
        const validity = evaluateDateValidityAgainstReference({
          dataValidade: docItem.dataValidade,
          semValidade: docItem.semValidade,
          evaluationDate,
          label: `Documento "${docItem.nomeDocumento}"`,
        });
        candidates.push({
          status: validity.status,
          motivo: validity.motivo,
          matchedRecordId: docItem.id,
          matchedCollection: 'documents',
          matchedTitulo: docItem.nomeDocumento,
          dataEmissao: docItem.dataEmissao,
          dataValidade: docItem.dataValidade,
          diasRestantes: validity.diasRestantes,
        });
      }
    }
  } else if (requirement.origemColecao === 'trainings') {
    for (const trn of params.trainings) {
      if (trn.empresaId !== companyId) continue;
      if (requirement.escopo === 'colaborador') {
        if (!employee || trn.colaboradorId !== employee.id) continue;
      }

      const matched = matchesRecordToRequirement({
        recordCanonicalCode: trn.tipoDocumentoCanonico,
        legacySearchTexts: [trn.nomeTreinamento, trn.observacoes],
        requirement,
      });
      if (!matched) continue;

      if (trn.situacao === 'pendente') {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `Treinamento "${trn.nomeTreinamento}" aguardando aprovação técnica.`,
          matchedRecordId: trn.id,
          matchedCollection: 'trainings',
          matchedTitulo: trn.nomeTreinamento,
          dataEmissao: trn.dataRealizacao,
          dataValidade: trn.dataValidade,
          diasRestantes: null,
        });
      } else if (trn.situacao === 'reprovado') {
        candidates.push({
          status: 'REPROVADO',
          motivo: `Treinamento "${trn.nomeTreinamento}" reprovado${trn.motivoReprovacao ? `: ${trn.motivoReprovacao}` : '.'}`,
          matchedRecordId: trn.id,
          matchedCollection: 'trainings',
          matchedTitulo: trn.nomeTreinamento,
          dataEmissao: trn.dataRealizacao,
          dataValidade: trn.dataValidade,
          diasRestantes: null,
        });
      } else if (trn.situacao === 'vencido') {
        candidates.push({
          status: 'VENCIDO',
          motivo: `Treinamento "${trn.nomeTreinamento}" vencido.`,
          matchedRecordId: trn.id,
          matchedCollection: 'trainings',
          matchedTitulo: trn.nomeTreinamento,
          dataEmissao: trn.dataRealizacao,
          dataValidade: trn.dataValidade,
          diasRestantes: trn.dataValidade
            ? (() => {
                const parsed = parseCalendarDate(trn.dataValidade);
                return parsed ? diffCalendarDays(parsed, evaluationDate) : null;
              })()
            : null,
        });
      } else if (trn.situacao === 'aprovado') {
        const validity = evaluateDateValidityAgainstReference({
          dataValidade: trn.dataValidade,
          semValidade: trn.semValidade,
          evaluationDate,
          label: `Treinamento "${trn.nomeTreinamento}"`,
        });
        candidates.push({
          status: validity.status,
          motivo: validity.motivo,
          matchedRecordId: trn.id,
          matchedCollection: 'trainings',
          matchedTitulo: trn.nomeTreinamento,
          dataEmissao: trn.dataRealizacao,
          dataValidade: trn.dataValidade,
          diasRestantes: validity.diasRestantes,
        });
      }
    }
  } else if (requirement.origemColecao === 'exams') {
    for (const exam of params.exams) {
      if (exam.empresaId !== companyId) continue;
      if (requirement.escopo === 'colaborador') {
        if (!employee || exam.colaboradorId !== employee.id) continue;
      }

      const matched = matchesRecordToRequirement({
        recordCanonicalCode: exam.tipoDocumentoCanonico,
        legacySearchTexts: [exam.tipoExame],
        requirement,
      });
      if (!matched) continue;

      if (exam.situacao === 'pendente') {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `Exame "${exam.tipoExame}" aguardando aprovação técnica.`,
          matchedRecordId: exam.id,
          matchedCollection: 'exams',
          matchedTitulo: exam.tipoExame,
          dataEmissao: exam.dataRealizacao,
          dataValidade: exam.dataValidade,
          diasRestantes: null,
        });
        continue;
      }

      if (exam.situacao === 'reprovado') {
        candidates.push({
          status: 'REPROVADO',
          motivo: `Exame "${exam.tipoExame}" reprovado${exam.motivoReprovacao ? `: ${exam.motivoReprovacao}` : '.'}`,
          matchedRecordId: exam.id,
          matchedCollection: 'exams',
          matchedTitulo: exam.tipoExame,
          dataEmissao: exam.dataRealizacao,
          dataValidade: exam.dataValidade,
          diasRestantes: null,
        });
        continue;
      }

      if (exam.situacao === 'vencido') {
        candidates.push({
          status: 'VENCIDO',
          motivo: `Exame "${exam.tipoExame}" vencido.`,
          matchedRecordId: exam.id,
          matchedCollection: 'exams',
          matchedTitulo: exam.tipoExame,
          dataEmissao: exam.dataRealizacao,
          dataValidade: exam.dataValidade,
          diasRestantes: exam.dataValidade
            ? (() => {
                const parsed = parseCalendarDate(exam.dataValidade);
                return parsed ? diffCalendarDays(parsed, evaluationDate) : null;
              })()
            : null,
        });
        continue;
      }

      if (exam.situacao === 'aprovado') {
        // 1. Verifica conclusão médica
        if (requirement.exigeAptoASO) {
          if (exam.conclusao === 'inapto') {
            candidates.push({
              status: 'ASO_INAPTO',
              motivo: `ASO "${exam.tipoExame}" possui conclusão INAPTO.`,
              matchedRecordId: exam.id,
              matchedCollection: 'exams',
              matchedTitulo: exam.tipoExame,
              dataEmissao: exam.dataRealizacao,
              dataValidade: exam.dataValidade,
              diasRestantes: null,
            });
            continue;
          }

          if (exam.conclusao === 'apto_com_restricoes') {
            candidates.push({
              status: 'ASO_INAPTO',
              motivo: `ASO "${exam.tipoExame}" indica "Apto com restrições" — incompatível com exigência de aptidão plena para atividade crítica.`,
              matchedRecordId: exam.id,
              matchedCollection: 'exams',
              matchedTitulo: exam.tipoExame,
              dataEmissao: exam.dataRealizacao,
              dataValidade: exam.dataValidade,
              diasRestantes: null,
            });
            continue;
          }

          if (exam.conclusao !== 'apto') {
            candidates.push({
              status: 'ASO_INAPTO',
              motivo: `ASO "${exam.tipoExame}" sem conclusão de aptidão válida.`,
              matchedRecordId: exam.id,
              matchedCollection: 'exams',
              matchedTitulo: exam.tipoExame,
              dataEmissao: exam.dataRealizacao,
              dataValidade: exam.dataValidade,
              diasRestantes: null,
            });
            continue;
          }
        }

        // 2. Verifica aptidão específica exigida pela atividade (ex.: trabalho_altura, espaco_confinado, eletricidade)
        if (requirement.aptidaoEspecifica && !hasConfirmedAsoAptitude(exam, requirement.aptidaoEspecifica)) {
          candidates.push({
            status: 'ASO_INAPTO',
            motivo: `ASO "${exam.tipoExame}" não comprova a aptidão específica exigida (${requirement.aptidaoEspecifica}).`,
            matchedRecordId: exam.id,
            matchedCollection: 'exams',
            matchedTitulo: exam.tipoExame,
            dataEmissao: exam.dataRealizacao,
            dataValidade: exam.dataValidade,
            diasRestantes: null,
          });
          continue;
        }

        // 3. Verifica validade do exame na data efetiva da atividade
        const validity = evaluateDateValidityAgainstReference({
          dataValidade: exam.dataValidade,
          semValidade: exam.semValidade,
          evaluationDate,
          label: `ASO "${exam.tipoExame}"`,
        });
        candidates.push({
          status: validity.status,
          motivo: validity.motivo,
          matchedRecordId: exam.id,
          matchedCollection: 'exams',
          matchedTitulo: exam.tipoExame,
          dataEmissao: exam.dataRealizacao,
          dataValidade: exam.dataValidade,
          diasRestantes: validity.diasRestantes,
        });
      }
    }
  } else if (requirement.origemColecao === 'epiDeliveries') {
    for (const epi of params.epiDeliveries) {
      if (epi.empresaId !== companyId) continue;
      if (requirement.escopo === 'colaborador') {
        if (!employee || epi.colaboradorId !== employee.id) continue;
      }

      const matched = matchesRecordToRequirement({
        recordCanonicalCode: undefined,
        legacySearchTexts: [epi.nomeEpi, epi.observacoes],
        requirement,
      });
      if (!matched) continue;

      const deliveryDate = parseCalendarDate(epi.dataEntrega);
      if (!epi.caNumero || !epi.caNumero.trim() || !deliveryDate) {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `Registro de EPI "${epi.nomeEpi}" sem número de CA ou data de entrega válida.`,
          matchedRecordId: epi.id,
          matchedCollection: 'epiDeliveries',
          matchedTitulo: `${epi.nomeEpi} (CA ${epi.caNumero || '-'})`,
          diasRestantes: null,
        });
        continue;
      }

      if (diffCalendarDays(evaluationDate, deliveryDate) < 0) {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `Entrega de EPI "${epi.nomeEpi}" registrada com data posterior à atividade.`,
          matchedRecordId: epi.id,
          matchedCollection: 'epiDeliveries',
          matchedTitulo: `${epi.nomeEpi} (CA ${epi.caNumero})`,
          diasRestantes: null,
        });
        continue;
      }

      candidates.push({
        status: 'CONFORME',
        motivo: `EPI "${epi.nomeEpi}" entregue com CA ${epi.caNumero}.`,
        matchedRecordId: epi.id,
        matchedCollection: 'epiDeliveries',
        matchedTitulo: `${epi.nomeEpi} (CA ${epi.caNumero})`,
        dataEmissao: epi.dataEntrega,
        diasRestantes: null,
      });
    }
  } else if (requirement.origemColecao === 'safetyPermits') {
    const reqCanonical = normalizeCanonicalCode(requirement.documentoCodigoCanonico);
    for (const permit of params.safetyPermits) {
      if (permit.empresaId !== companyId) continue;

      // Se a permissão tem atividades vinculadas e nenhuma coincide com o requisito, ignora
      if (
        permit.atividadeIds &&
        permit.atividadeIds.length > 0 &&
        !permit.atividadeIds.some((id) => requirement.activityIds.includes(id))
      ) {
        continue;
      }

      const permitMatchesType =
        normalizeCanonicalCode(permit.tipo) === reqCanonical ||
        matchesLegacyTextUnambiguously(
          `${permit.tipo} ${permit.titulo}`,
          reqCanonical,
          requirement.palavrasChaveMatch
        );

      if (!permitMatchesType) continue;

      if (
        permit.status === 'elaboracao' ||
        permit.status === 'pendente_liberacao' ||
        permit.status === 'em_analise' ||
        permit.status === 'pendente_documentacao' ||
        permit.status === 'pendente_correcao'
      ) {
        candidates.push({
          status: 'PENDENTE_APROVACAO',
          motivo: `${permit.tipo} "${permit.titulo}" em ${permit.status === 'elaboracao' ? 'rascunho/elaboração' : 'análise/pendência'}, aguardando aprovação técnica.`,
          matchedRecordId: permit.id,
          matchedCollection: 'safetyPermits',
          matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
          dataEmissao: permit.dataInicio,
          dataValidade: permit.dataFim,
          diasRestantes: null,
        });
        continue;
      }

      if (permit.status === 'cancelado' || permit.status === 'reprovado') {
        candidates.push({
          status: 'REPROVADO',
          motivo: `${permit.tipo} "${permit.titulo}" ${permit.status === 'reprovado' ? 'reprovada' : 'cancelada'}.`,
          matchedRecordId: permit.id,
          matchedCollection: 'safetyPermits',
          matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
          dataEmissao: permit.dataInicio,
          dataValidade: permit.dataFim,
          diasRestantes: null,
        });
        continue;
      }

      if (permit.status === 'encerrado') {
        candidates.push({
          status: 'VENCIDO',
          motivo: `${permit.tipo} "${permit.titulo}" já encerrada.`,
          matchedRecordId: permit.id,
          matchedCollection: 'safetyPermits',
          matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
          dataEmissao: permit.dataInicio,
          dataValidade: permit.dataFim,
          diasRestantes: null,
        });
        continue;
      }

      if (
        permit.status === 'aprovado' ||
        permit.status === 'liberado' ||
        permit.status === 'em_execucao'
      ) {
        const permitStart = parseCalendarDate(permit.dataInicio);
        const permitEnd = parseCalendarDate(permit.dataFim);

        if (!permitStart || !permitEnd) {
          candidates.push({
            status: 'PENDENTE_APROVACAO',
            motivo: `${permit.tipo} "${permit.titulo}" sem período de vigência completo.`,
            matchedRecordId: permit.id,
            matchedCollection: 'safetyPermits',
            matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
            dataEmissao: permit.dataInicio,
            diasRestantes: null,
          });
          continue;
        }

        const daysUntilEnd = diffCalendarDays(permitEnd, evaluationDate);
        const startsAfterActivity = diffCalendarDays(permitStart, startDate) > 0;

        if (daysUntilEnd < 0) {
          candidates.push({
            status: 'VENCIDO',
            motivo: `${permit.tipo} "${permit.titulo}" vencida antes do término da atividade (${permit.dataFim}).`,
            matchedRecordId: permit.id,
            matchedCollection: 'safetyPermits',
            matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
            dataEmissao: permit.dataInicio,
            dataValidade: permit.dataFim,
            diasRestantes: daysUntilEnd,
          });
        } else if (startsAfterActivity) {
          candidates.push({
            status: 'PENDENTE_APROVACAO',
            motivo: `${permit.tipo} "${permit.titulo}" só inicia vigência em ${permit.dataInicio} (posterior à data da atividade).`,
            matchedRecordId: permit.id,
            matchedCollection: 'safetyPermits',
            matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
            dataEmissao: permit.dataInicio,
            dataValidade: permit.dataFim,
            diasRestantes: daysUntilEnd,
          });
        } else {
          candidates.push({
            status: 'CONFORME',
            motivo: `${permit.tipo} "${permit.titulo}" aprovada e vigente para o período da atividade.`,
            matchedRecordId: permit.id,
            matchedCollection: 'safetyPermits',
            matchedTitulo: `${permit.tipo} — ${permit.titulo}`,
            dataEmissao: permit.dataInicio,
            dataValidade: permit.dataFim,
            diasRestantes: daysUntilEnd,
          });
        }
      }
    }
  }

  // 2. Incorpora pendências/rejeições do EHS SmartDocs (nunca substitui aprovação oficial)
  const smartDocCandidates = evaluateSmartDocCandidates({
    smartDocs: params.smartDocs,
    companyId,
    colaboradorId: employee?.id,
    requirement,
  });
  candidates.push(...smartDocCandidates);

  const best = pickBestCandidate(candidates);
  const finalStatus: ActivityRequirementComplianceStatus = best ? best.status : 'AUSENTE';
  const isCompliant = finalStatus === 'CONFORME' || finalStatus === 'A_VENCER';
  const bloqueante = requirement.obrigatorioParaLiberacao && !isCompliant;

  return {
    requirementId: requirement.requirementId,
    activityId: requirement.activityIds[0],
    activityIds: [...requirement.activityIds],
    activityNome: requirement.activityNomes.join(' + '),
    nomeExibicao: requirement.nomeExibicao,
    documentoCodigoCanonico: requirement.documentoCodigoCanonico,
    escopo: requirement.escopo,
    origemColecao: requirement.origemColecao,
    obrigatorioParaLiberacao: requirement.obrigatorioParaLiberacao,
    baseLegal: requirement.baseLegal,
    ...(employee
      ? {
          colaboradorId: employee.id,
          colaboradorNome: employee.nomeCompleto,
          colaboradorCargo: employee.cargo,
        }
      : {}),
    status: finalStatus,
    bloqueante,
    motivo: best
      ? best.motivo
      : `Documento obrigatório "${requirement.nomeExibicao}" não localizado.`,
    matchedRecordId: best?.matchedRecordId,
    matchedCollection: best?.matchedCollection,
    matchedTitulo: best?.matchedTitulo,
    dataEmissao: best?.dataEmissao,
    dataValidade: best?.dataValidade,
    diasRestantes: best?.diasRestantes,
    pendenteSmartDocId: best?.pendenteSmartDocId,
  };
}

/**
 * Unifica requisitos ativos das atividades selecionadas sem duplicidade.
 * Quando há atividades combinadas (ex.: Altura + Trabalho a Quente), requisitos equivalentes
 * (PGR, PCMSO, APR, PT) são consolidados em um único item.
 * Se uma atividade exigir ASO com aptidão específica e outra exigir ASO genérico para as mesmas
 * funções, o ASO genérico redundante é absorvido pelo requisito mais restritivo.
 */
function unifyActivityRequirements(
  selectedProfiles: ActivityProfile[],
  allRequirements: ActivityDocumentRequirement[]
): UnifiedRequirement[] {
  const profileMap = new Map(selectedProfiles.map((p) => [p.id, p]));
  const activeReqs = allRequirements
    .filter((req) => req.ativo && profileMap.has(req.activityId))
    .sort((a, b) => (a.ordemExibicao ?? 999) - (b.ordemExibicao ?? 999));

  const dedupMap = new Map<string, UnifiedRequirement>();

  for (const req of activeReqs) {
    const profile = profileMap.get(req.activityId)!;
    const normCode = normalizeCanonicalCode(req.documentoCodigoCanonico);
    const normAptitude = normalizeMatchText(req.aptidaoEspecifica || '').replace(/\s+/g, '_');
    const normRolesKey = [...(req.funcoesAplicaveis || [])]
      .map((r) => normalizeMatchText(r))
      .filter(Boolean)
      .sort()
      .join('|');

    const key = `${req.escopo}::${req.origemColecao}::${normCode}::${normAptitude}::${normRolesKey}`;

    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, {
        requirementId: req.id,
        activityIds: [profile.id],
        activityNomes: [profile.nome],
        nomeExibicao: req.nomeExibicao,
        documentoCodigoCanonico: req.documentoCodigoCanonico,
        palavrasChaveMatch: Array.from(new Set(req.palavrasChaveMatch || [])),
        escopo: req.escopo,
        origemColecao: req.origemColecao,
        funcoesAplicaveis: [...(req.funcoesAplicaveis || [])],
        exigeAptoASO: Boolean(req.exigeAptoASO),
        aptidaoEspecifica: req.aptidaoEspecifica,
        obrigatorioParaLiberacao: req.obrigatorioParaLiberacao,
        baseLegal: req.baseLegal,
        ordemExibicao: req.ordemExibicao ?? 999,
      });
    } else {
      if (!existing.activityIds.includes(profile.id)) {
        existing.activityIds.push(profile.id);
        existing.activityNomes.push(profile.nome);
      }
      existing.palavrasChaveMatch = Array.from(
        new Set([...existing.palavrasChaveMatch, ...(req.palavrasChaveMatch || [])])
      );
      existing.exigeAptoASO = existing.exigeAptoASO || Boolean(req.exigeAptoASO);
      existing.obrigatorioParaLiberacao =
        existing.obrigatorioParaLiberacao || req.obrigatorioParaLiberacao;
      if (req.baseLegal && (!existing.baseLegal || !existing.baseLegal.includes(req.baseLegal))) {
        existing.baseLegal = existing.baseLegal
          ? `${existing.baseLegal} | ${req.baseLegal}`
          : req.baseLegal;
      }
      existing.ordemExibicao = Math.min(existing.ordemExibicao, req.ordemExibicao ?? 999);
    }
  }

  const unifiedList = Array.from(dedupMap.values());

  // Absorve ASO genérico redundante quando já existe ASO com aptidão específica para o mesmo escopo/funções
  const specificAsoKeys = new Set(
    unifiedList
      .filter(
        (u) =>
          normalizeCanonicalCode(u.documentoCodigoCanonico) === 'ASO' &&
          Boolean(u.aptidaoEspecifica)
      )
      .map(
        (u) =>
          `${u.escopo}::${[...u.funcoesAplicaveis].map(normalizeMatchText).sort().join('|')}`
      )
  );

  return unifiedList.filter((u) => {
    const isGenericAso =
      normalizeCanonicalCode(u.documentoCodigoCanonico) === 'ASO' && !u.aptidaoEspecifica;
    if (!isGenericAso) return true;
    const scopeRoleKey = `${u.escopo}::${[...u.funcoesAplicaveis].map(normalizeMatchText).sort().join('|')}`;
    return !specificAsoKeys.has(scopeRoleKey);
  });
}

/**
 * Executa a avaliação completa e determinística de conformidade documental de uma
 * empresa contratada e seus colaboradores terceirizados para uma ou mais atividades.
 */
export function evaluateActivityCompliance(
  input: EvaluateActivityComplianceInput
): ActivityComplianceResult {
  const evaluatedAtIso = new Date().toISOString();
  const motivosBloqueio: string[] = [];

  // 1. Validação fail-closed das datas efetivas da atividade
  let startDate: Date;
  let dateInputInvalid = false;

  if (input.dataReferenciaAtividade !== undefined && input.dataReferenciaAtividade.trim() !== '') {
    const parsedStart = parseCalendarDate(input.dataReferenciaAtividade);
    if (!parsedStart) {
      dateInputInvalid = true;
      startDate = getTodayUtcCalendarDate();
      motivosBloqueio.push(
        `Data efetiva da atividade inválida ("${input.dataReferenciaAtividade}").`
      );
    } else {
      startDate = parsedStart;
    }
  } else {
    startDate = getTodayUtcCalendarDate();
  }

  let evaluationDate = startDate;
  if (input.dataFimAtividade !== undefined && input.dataFimAtividade.trim() !== '') {
    const parsedEnd = parseCalendarDate(input.dataFimAtividade);
    if (!parsedEnd) {
      dateInputInvalid = true;
      motivosBloqueio.push(`Data final prevista da atividade inválida ("${input.dataFimAtividade}").`);
    } else if (diffCalendarDays(parsedEnd, startDate) < 0) {
      dateInputInvalid = true;
      motivosBloqueio.push('Data final da atividade é anterior à data inicial.');
    } else if (diffCalendarDays(parsedEnd, startDate) > 0) {
      evaluationDate = parsedEnd;
    }
  }

  // 2. Validação da empresa contratada e vigência contratual (respeitando contrato_indeterminado)
  const company = input.company;
  let contratoVigente = false;
  let contratoIndeterminado = false;
  let contratoExpiringSoon = false;
  let contratoMensagem = 'Empresa contratada não localizada.';

  if (!company) {
    motivosBloqueio.push('Empresa contratada não localizada.');
  } else if (company.situacao !== 'ativa') {
    contratoMensagem = `Empresa contratada "${company.razaoSocial}" está com situação "${company.situacao}".`;
    motivosBloqueio.push(contratoMensagem);
  } else if (company.contrato_indeterminado === true) {
    contratoIndeterminado = true;
    contratoVigente = true;
    contratoMensagem = 'Contrato vigente (Prazo indeterminado).';
  } else {
    const contractEnd = parseCalendarDate(company.dataTerminoContrato);
    if (!contractEnd) {
      contratoVigente = false;
      contratoMensagem =
        'Data de término do contrato não informada ou inválida (contrato não marcado como indeterminado).';
      motivosBloqueio.push(contratoMensagem);
    } else {
      const daysToContractEnd = diffCalendarDays(contractEnd, evaluationDate);
      if (daysToContractEnd < 0) {
        contratoVigente = false;
        contratoMensagem = `Contrato da empresa vencido há ${Math.abs(daysToContractEnd)} dia(s) na data da atividade.`;
        motivosBloqueio.push(contratoMensagem);
      } else if (daysToContractEnd <= WARNING_DAYS_THRESHOLD) {
        contratoVigente = true;
        contratoExpiringSoon = true;
        contratoMensagem = `Contrato vigente, porém vence em ${daysToContractEnd} dia(s) a partir da data da atividade.`;
      } else {
        contratoVigente = true;
        contratoMensagem = `Contrato vigente (${daysToContractEnd} dias restantes na data da atividade).`;
      }
    }
  }

  // 3. Resolução das atividades selecionadas e unificação dos requisitos obrigatórios
  const uniqueActivityIds = Array.from(new Set((input.atividadeIds || []).filter(Boolean)));
  const selectedProfiles = uniqueActivityIds
    .map((id) => input.activityProfiles.find((p) => p.id === id && p.ativo))
    .filter((p): p is ActivityProfile => Boolean(p));

  if (selectedProfiles.length === 0) {
    motivosBloqueio.push('Nenhuma atividade ativa selecionada para verificação de conformidade.');
  } else if (selectedProfiles.length < uniqueActivityIds.length) {
    motivosBloqueio.push(
      'Uma ou mais atividades informadas estão inativas ou não foram encontradas no catálogo.'
    );
  }

  const unifiedRequirements = unifyActivityRequirements(selectedProfiles, input.requirements || []);
  const companyRequirements = unifiedRequirements.filter((r) => r.escopo === 'empresa');
  const activityPtRequirements = unifiedRequirements.filter((r) => r.escopo === 'atividade_pt');
  const employeeRequirements = unifiedRequirements.filter((r) => r.escopo === 'colaborador');

  const smartDocs = input.smartDocs || [];
  const companyId = company?.id || '';

  // 4. Avaliação de requisitos da empresa e da atividade/PT
  const itensEmpresa: ActivityComplianceItemResult[] = company
    ? companyRequirements.map((req) =>
        evaluateSingleRequirement({
          requirement: req,
          companyId,
          documents: input.documents || [],
          trainings: input.trainings || [],
          exams: input.exams || [],
          epiDeliveries: input.epiDeliveries || [],
          safetyPermits: input.safetyPermits || [],
          smartDocs,
          startDate,
          evaluationDate,
          permitAtualId: input.permitAtualId,
        })
      )
    : [];

  const itensAtividade: ActivityComplianceItemResult[] = company
    ? activityPtRequirements.map((req) =>
        evaluateSingleRequirement({
          requirement: req,
          companyId,
          documents: input.documents || [],
          trainings: input.trainings || [],
          exams: input.exams || [],
          epiDeliveries: input.epiDeliveries || [],
          safetyPermits: input.safetyPermits || [],
          smartDocs,
          startDate,
          evaluationDate,
          permitAtualId: input.permitAtualId,
        })
      )
    : [];

  // 5. Avaliação por colaborador terceirizado (com filtro de cargo/função e validação de vínculo à contratada)
  const uniqueCollaboratorIds = Array.from(new Set((input.colaboradorIds || []).filter(Boolean)));
  const hasMandatoryEmployeeReqs = employeeRequirements.some((r) => r.obrigatorioParaLiberacao);

  if (uniqueCollaboratorIds.length === 0 && hasMandatoryEmployeeReqs) {
    motivosBloqueio.push(
      'Nenhum colaborador terceirizado vinculado para executar a atividade selecionada.'
    );
  }

  const colaboradores: EmployeeActivityComplianceSummary[] = [];

  for (const empId of uniqueCollaboratorIds) {
    const emp = (input.employees || []).find((e) => e.id === empId);
    if (!emp) {
      motivosBloqueio.push(`Colaborador terceirizado "${empId}" não localizado no cadastro.`);
      continue;
    }

    if (company && emp.empresaId !== company.id) {
      motivosBloqueio.push(
        `Colaborador "${emp.nomeCompleto}" não pertence à empresa contratada "${company.razaoSocial}".`
      );
      colaboradores.push({
        colaboradorId: emp.id,
        colaboradorNome: emp.nomeCompleto,
        cargo: emp.cargo,
        situacaoCadastral: emp.situacaoCadastral,
        statusGeral: 'bloqueado',
        aptoParaExecucao: false,
        itens: [],
        totalObrigatorios: 0,
        conformesCount: 0,
        alertasCount: 0,
        bloqueiosCount: 1,
        pendentesAprovacaoCount: 0,
      });
      continue;
    }

    const applicableEmployeeReqs = employeeRequirements.filter((req) =>
      doesRequirementApplyToRole(req.funcoesAplicaveis, emp.cargo)
    );

    const empItens: ActivityComplianceItemResult[] = company
      ? applicableEmployeeReqs.map((req) =>
          evaluateSingleRequirement({
            requirement: req,
            companyId,
            employee: emp,
            documents: input.documents || [],
            trainings: input.trainings || [],
            exams: input.exams || [],
            epiDeliveries: input.epiDeliveries || [],
            safetyPermits: input.safetyPermits || [],
            smartDocs,
            startDate,
            evaluationDate,
            permitAtualId: input.permitAtualId,
          })
        )
      : [];

    const isCadastralActive = emp.situacaoCadastral === 'ativo';
    if (!isCadastralActive) {
      motivosBloqueio.push(
        `Colaborador "${emp.nomeCompleto}" está com situação cadastral "${emp.situacaoCadastral}" (somente ativos podem ser liberados).`
      );
    }

    const totalObrigatorios = empItens.filter((i) => i.obrigatorioParaLiberacao).length;
    const conformesCount = empItens.filter((i) => i.status === 'CONFORME').length;
    const alertasCount = empItens.filter((i) => i.status === 'A_VENCER').length;
    const bloqueiosItensCount = empItens.filter((i) => i.bloqueante).length;
    const pendentesAprovacaoCount = empItens.filter((i) => i.status === 'PENDENTE_APROVACAO').length;

    const totalBloqueiosEmp = bloqueiosItensCount + (isCadastralActive ? 0 : 1);
    const empStatusGeral: ActivityComplianceOverallStatus =
      totalBloqueiosEmp > 0
        ? 'bloqueado'
        : alertasCount > 0 || empItens.some((i) => i.status !== 'CONFORME')
          ? 'atencao'
          : 'conforme';

    colaboradores.push({
      colaboradorId: emp.id,
      colaboradorNome: emp.nomeCompleto,
      cargo: emp.cargo,
      situacaoCadastral: emp.situacaoCadastral,
      statusGeral: empStatusGeral,
      aptoParaExecucao: totalBloqueiosEmp === 0,
      itens: empItens,
      totalObrigatorios,
      conformesCount,
      alertasCount,
      bloqueiosCount: totalBloqueiosEmp,
      pendentesAprovacaoCount,
    });
  }

  // 6. Consolidação final do resumo e motivos de bloqueio
  const allItems: ActivityComplianceItemResult[] = [
    ...itensEmpresa,
    ...itensAtividade,
    ...colaboradores.flatMap((c) => c.itens),
  ];

  for (const item of allItems) {
    if (item.bloqueante) {
      const targetPrefix = item.colaboradorNome
        ? `[${item.colaboradorNome}] `
        : item.escopo === 'empresa'
          ? '[Empresa] '
          : '[Atividade/PT] ';
      motivosBloqueio.push(`${targetPrefix}${item.nomeExibicao}: ${item.motivo}`);
    }
  }

  const conformes = allItems.filter((i) => i.status === 'CONFORME').length;
  const alertasAVencer = allItems.filter((i) => i.status === 'A_VENCER').length;
  const pendentesAprovacao = allItems.filter((i) => i.status === 'PENDENTE_APROVACAO').length;
  const bloqueiosObrigatorios = allItems.filter((i) => i.bloqueante).length;
  const ausentes = allItems.filter((i) => i.status === 'AUSENTE').length;
  const vencidosOuReprovados = allItems.filter(
    (i) => i.status === 'VENCIDO' || i.status === 'REPROVADO' || i.status === 'ASO_INAPTO'
  ).length;

  const podeLiberar =
    !dateInputInvalid &&
    contratoVigente &&
    selectedProfiles.length > 0 &&
    motivosBloqueio.length === 0 &&
    bloqueiosObrigatorios === 0;

  const hasOptionalNonCompliant = allItems.some(
    (i) => !i.obrigatorioParaLiberacao && i.status !== 'CONFORME'
  );

  const statusGeral: ActivityComplianceOverallStatus = !podeLiberar
    ? 'bloqueado'
    : alertasAVencer > 0 || contratoExpiringSoon || hasOptionalNonCompliant
      ? 'atencao'
      : 'conforme';

  return {
    empresaId: company?.id || '',
    empresaNome: company?.razaoSocial || 'Empresa não localizada',
    contratoVigente,
    contratoIndeterminado,
    contratoMensagem,
    atividadeIds: selectedProfiles.map((p) => p.id),
    atividadeNomes: selectedProfiles.map((p) => p.nome),
    statusGeral,
    podeLiberar,
    avaliadoEm: evaluatedAtIso,
    itensEmpresa,
    itensAtividade,
    colaboradores,
    resumo: {
      totalRequisitosAvaliados: allItems.length,
      conformes,
      alertasAVencer,
      pendentesAprovacao,
      bloqueiosObrigatorios,
      ausentes,
      vencidosOuReprovados,
    },
    motivosBloqueio,
  };
}

/**
 * Converte o resultado completo em snapshot leve para registro de auditoria no SafetyPermit.
 */
export function buildComplianceSnapshot(
  result: ActivityComplianceResult
): ActivityComplianceSnapshot {
  return {
    avaliadoEm: result.avaliadoEm,
    statusGeral: result.statusGeral,
    podeLiberar: result.podeLiberar,
    totalRequisitosAvaliados: result.resumo.totalRequisitosAvaliados,
    conformes: result.resumo.conformes,
    alertasAVencer: result.resumo.alertasAVencer,
    pendentesAprovacao: result.resumo.pendentesAprovacao,
    bloqueiosObrigatorios: result.resumo.bloqueiosObrigatorios,
    motivosBloqueio: result.motivosBloqueio.slice(0, 30),
  };
}
