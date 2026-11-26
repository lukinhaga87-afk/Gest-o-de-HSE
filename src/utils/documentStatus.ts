import type {
  ContractorIntegrationItem,
  DocumentStatus,
  IntegrationItemStatus,
  IntegrationWorkflowStatus,
} from '../types/sst';

/**
 * Standardized document statuses mandated for mirrored EHS communication
 * between Solicitante / Contratada and Administrador EHS.
 */
export type StandardizedDocStatus =
  | 'NAO_ENVIADO'
  | 'PENDENTE_ENVIO'
  | 'AGUARDANDO_ANALISE'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REPROVADO'
  | 'VENCIDO'
  | 'PROXIMO_VENCIMENTO';

export interface StandardizedStatusMeta {
  code: StandardizedDocStatus;
  label: string;
  shortLabel: string;
  badgeClass: string;
  dotClass: string;
  isActionRequiredForContractor: boolean;
  isActionRequiredForAdmin: boolean;
}

export const STANDARDIZED_STATUS_META: Record<StandardizedDocStatus, StandardizedStatusMeta> = {
  NAO_ENVIADO: {
    code: 'NAO_ENVIADO',
    label: 'Não enviado',
    shortLabel: 'Não enviado',
    badgeClass: 'bg-slate-800/90 text-slate-300 border-slate-700',
    dotClass: 'bg-slate-400',
    isActionRequiredForContractor: true,
    isActionRequiredForAdmin: false,
  },
  PENDENTE_ENVIO: {
    code: 'PENDENTE_ENVIO',
    label: 'Pendente de envio',
    shortLabel: 'Pendente de envio',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    dotClass: 'bg-amber-400',
    isActionRequiredForContractor: true,
    isActionRequiredForAdmin: false,
  },
  AGUARDANDO_ANALISE: {
    code: 'AGUARDANDO_ANALISE',
    label: 'Aguardando análise',
    shortLabel: 'Aguardando análise',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    dotClass: 'bg-sky-400',
    isActionRequiredForContractor: false,
    isActionRequiredForAdmin: true,
  },
  EM_ANALISE: {
    code: 'EM_ANALISE',
    label: 'Em análise',
    shortLabel: 'Em análise',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35',
    dotClass: 'bg-indigo-400',
    isActionRequiredForContractor: false,
    isActionRequiredForAdmin: true,
  },
  APROVADO: {
    code: 'APROVADO',
    label: 'Aprovado',
    shortLabel: 'Aprovado',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    dotClass: 'bg-emerald-400',
    isActionRequiredForContractor: false,
    isActionRequiredForAdmin: false,
  },
  REPROVADO: {
    code: 'REPROVADO',
    label: 'Reprovado',
    shortLabel: 'Reprovado',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    dotClass: 'bg-rose-500',
    isActionRequiredForContractor: true,
    isActionRequiredForAdmin: false,
  },
  VENCIDO: {
    code: 'VENCIDO',
    label: 'Vencido',
    shortLabel: 'Vencido',
    badgeClass: 'bg-red-500/20 text-red-300 border-red-500/45',
    dotClass: 'bg-red-500',
    isActionRequiredForContractor: true,
    isActionRequiredForAdmin: true,
  },
  PROXIMO_VENCIMENTO: {
    code: 'PROXIMO_VENCIMENTO',
    label: 'Próximo do vencimento',
    shortLabel: 'Próx. vencimento',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
    dotClass: 'bg-orange-400',
    isActionRequiredForContractor: true,
    isActionRequiredForAdmin: true,
  },
};

export const ALL_STANDARDIZED_STATUSES: StandardizedDocStatus[] = [
  'NAO_ENVIADO',
  'PENDENTE_ENVIO',
  'AGUARDANDO_ANALISE',
  'EM_ANALISE',
  'APROVADO',
  'REPROVADO',
  'PROXIMO_VENCIMENTO',
  'VENCIDO',
];

export interface ExpirationInfo {
  state: 'none' | 'valid' | 'expiring' | 'expired';
  daysRemaining: number | null;
  label: string;
  formattedDate: string;
}

export function formatIsoDatePt(iso?: string | null): string {
  if (!iso) return '—';
  const normalized = iso.slice(0, 10);
  const parts = normalized.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('pt-BR');
}

export function formatDateTimePt(iso?: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getExpirationInfo(
  dataValidade?: string | null,
  semValidade?: boolean,
  referenceIso?: string,
  warningWindowDays = 30
): ExpirationInfo {
  if (semValidade) {
    return {
      state: 'none',
      daysRemaining: null,
      label: 'Sem validade definida',
      formattedDate: 'Sem validade',
    };
  }
  if (!dataValidade || !dataValidade.trim()) {
    return {
      state: 'none',
      daysRemaining: null,
      label: 'Validade não informada',
      formattedDate: '—',
    };
  }

  const refDateStr = (referenceIso || new Date().toISOString()).slice(0, 10);
  const targetDateStr = dataValidade.slice(0, 10);
  const refMs = new Date(`${refDateStr}T00:00:00Z`).getTime();
  const targetMs = new Date(`${targetDateStr}T00:00:00Z`).getTime();

  if (Number.isNaN(targetMs) || Number.isNaN(refMs)) {
    return {
      state: 'none',
      daysRemaining: null,
      label: dataValidade,
      formattedDate: dataValidade,
    };
  }

  const diffDays = Math.round((targetMs - refMs) / (1000 * 60 * 60 * 24));
  const formattedDate = formatIsoDatePt(targetDateStr);

  if (diffDays < 0) {
    return {
      state: 'expired',
      daysRemaining: diffDays,
      label: `Vencido há ${Math.abs(diffDays)} dia(s)`,
      formattedDate,
    };
  }
  if (diffDays <= warningWindowDays) {
    return {
      state: 'expiring',
      daysRemaining: diffDays,
      label: diffDays === 0 ? 'Vence hoje' : `Vence em ${diffDays} dia(s)`,
      formattedDate,
    };
  }
  return {
    state: 'valid',
    daysRemaining: diffDays,
    label: `Válido (${diffDays} dia(s))`,
    formattedDate,
  };
}

/**
 * Resolves a ContractorIntegrationItem into one of the 8 official standardized statuses.
 */
export function resolveIntegrationItemStandardizedStatus(
  item: Pick<
    ContractorIntegrationItem,
    'status' | 'versaoAtual' | 'arquivoNome' | 'hasStoredFile' | 'dataValidade' | 'semValidade' | 'obrigatorio'
  >,
  protocoloStatus?: IntegrationWorkflowStatus,
  referenceIso?: string
): StandardizedDocStatus {
  const rawStatus: IntegrationItemStatus = item.status;

  if (rawStatus === 'REPROVADO') {
    return 'REPROVADO';
  }

  if (rawStatus === 'PENDENTE_ENVIO') {
    const hasNoUpload = !item.versaoAtual || item.versaoAtual < 1 || !item.arquivoNome;
    if (
      protocoloStatus === 'PENDENTE_DOCUMENTACAO' ||
      protocoloStatus === 'PENDENTE_CORRECAO' ||
      (!hasNoUpload && item.hasStoredFile === false)
    ) {
      return 'PENDENTE_ENVIO';
    }
    return hasNoUpload ? 'NAO_ENVIADO' : 'PENDENTE_ENVIO';
  }

  if (rawStatus === 'ENVIADO') {
    if (protocoloStatus === 'EM_ANALISE') {
      return 'EM_ANALISE';
    }
    return 'AGUARDANDO_ANALISE';
  }

  if (rawStatus === 'EM_ANALISE') {
    return 'EM_ANALISE';
  }

  if (rawStatus === 'APROVADO') {
    const exp = getExpirationInfo(item.dataValidade, item.semValidade, referenceIso);
    if (exp.state === 'expired') return 'VENCIDO';
    if (exp.state === 'expiring') return 'PROXIMO_VENCIMENTO';
    return 'APROVADO';
  }

  // Fallback for SUBSTITUIDO or any legacy state
  return 'AGUARDANDO_ANALISE';
}

/**
 * Resolves an official SST record (DocumentSST, Training, OccupationalExam) into standardized status.
 */
export function resolveOfficialRecordStandardizedStatus(
  situacao?: DocumentStatus | 'pendente' | 'aprovado' | 'reprovado' | 'vencido' | 'a_vencer',
  dataValidade?: string | null,
  semValidade?: boolean,
  hasFile = true,
  referenceIso?: string
): StandardizedDocStatus {
  if (situacao === 'reprovado') return 'REPROVADO';
  if (!hasFile && (!situacao || situacao === 'pendente')) return 'NAO_ENVIADO';
  if (situacao === 'pendente') return 'AGUARDANDO_ANALISE';

  const exp = getExpirationInfo(dataValidade, semValidade, referenceIso);
  if (situacao === 'vencido' || exp.state === 'expired') return 'VENCIDO';
  if (situacao === 'a_vencer' || exp.state === 'expiring') return 'PROXIMO_VENCIMENTO';
  return 'APROVADO';
}
