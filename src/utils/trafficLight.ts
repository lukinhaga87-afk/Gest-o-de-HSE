import { FarolStatus, DocumentStatus } from '../types/sst';

/**
 * Calculates days remaining until the expiration date.
 * Positive number: days in the future
 * 0: expires today
 * Negative number: already expired
 */
export function getDaysRemaining(expirationDateStr?: string): number | null {
  if (!expirationDateStr) return null;

  // Handles YYYY-MM-DD or DD/MM/YYYY
  let targetDate: Date;
  if (expirationDateStr.includes('/')) {
    const parts = expirationDateStr.split('/');
    if (parts.length === 3) {
      targetDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    } else {
      return null;
    }
  } else {
    targetDate = new Date(expirationDateStr + 'T00:00:00');
  }

  if (isNaN(targetDate.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Computes the Traffic Light status according to SST specifications:
 * - VERDE: Válido, com mais de 30 dias para vencer (> 30 dias) ou configurado expressamente como sem validade
 * - AMARELO: Vence nos próximos 30 dias (0 a 30 dias)
 * - VERMELHO: Vencido (< 0 dias) ou reprovado
 * - CINZA: Não cadastrado, pendente de envio ou pendente de aprovação
 */
export function getTrafficLightStatus(
  expirationDateStr?: string,
  semValidade?: boolean,
  situacao?: DocumentStatus | string
): {
  status: FarolStatus;
  label: string;
  daysRemaining: number | null;
  badgeClass: string;
  dotClass: string;
  borderClass: string;
  textClass: string;
} {
  if (situacao === 'reprovado') {
    return {
      status: 'vermelho',
      label: 'Reprovado',
      daysRemaining: null,
      badgeClass: 'bg-red-950/60 text-red-400 border border-red-800/80',
      dotClass: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]',
      borderClass: 'border-l-4 border-l-red-500',
      textClass: 'text-red-400',
    };
  }

  if (situacao === 'pendente') {
    return {
      status: 'cinza',
      label: 'Pendente de Análise',
      daysRemaining: null,
      badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700',
      dotClass: 'bg-slate-400',
      borderClass: 'border-l-4 border-l-slate-400',
      textClass: 'text-slate-300',
    };
  }

  if (semValidade) {
    return {
      status: 'verde',
      label: 'Sem Vencimento (Válido)',
      daysRemaining: null,
      badgeClass: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/80',
      dotClass: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
      borderClass: 'border-l-4 border-l-emerald-500',
      textClass: 'text-emerald-400',
    };
  }

  const days = getDaysRemaining(expirationDateStr);

  if (days === null) {
    return {
      status: 'cinza',
      label: 'Sem data de validade',
      daysRemaining: null,
      badgeClass: 'bg-slate-800 text-slate-400 border border-slate-700',
      dotClass: 'bg-slate-500',
      borderClass: 'border-l-4 border-l-slate-500',
      textClass: 'text-slate-400',
    };
  }

  if (days < 0) {
    return {
      status: 'vermelho',
      label: `Vencido há ${Math.abs(days)} dia(s)`,
      daysRemaining: days,
      badgeClass: 'bg-red-950/60 text-red-400 border border-red-800/80',
      dotClass: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]',
      borderClass: 'border-l-4 border-l-red-500',
      textClass: 'text-red-400',
    };
  }

  if (days === 0) {
    return {
      status: 'amarelo',
      label: '🚨 Vence Hoje (Data do Vencimento)',
      daysRemaining: 0,
      badgeClass: 'bg-red-950/80 text-red-300 border border-red-500 font-bold animate-pulse',
      dotClass: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)] animate-ping',
      borderClass: 'border-l-4 border-l-red-500',
      textClass: 'text-red-400 font-bold',
    };
  }

  if (days <= 15) {
    return {
      status: 'amarelo',
      label: `⚠️ Vence em ${days} dia(s) (Alerta 15 Dias)`,
      daysRemaining: days,
      badgeClass: 'bg-orange-950/80 text-orange-300 border border-orange-500/60 font-semibold',
      dotClass: 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]',
      borderClass: 'border-l-4 border-l-orange-500',
      textClass: 'text-orange-400 font-semibold',
    };
  }

  if (days <= 30) {
    return {
      status: 'amarelo',
      label: `⏳ Vence em ${days} dia(s) (Alerta 30 Dias)`,
      daysRemaining: days,
      badgeClass: 'bg-amber-950/60 text-amber-400 border border-amber-800/80',
      dotClass: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]',
      borderClass: 'border-l-4 border-l-amber-400',
      textClass: 'text-amber-400',
    };
  }

  return {
    status: 'verde',
    label: `Válido (${days} dias)`,
    daysRemaining: days,
    badgeClass: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/80',
    dotClass: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
    borderClass: 'border-l-4 border-l-emerald-500',
    textClass: 'text-emerald-400',
  };
}

export type ExpirationAlertTier = 'hoje' | '15_dias' | '30_dias' | 'vencido' | 'regular';

export interface ExpirationAlertDetails {
  tier: ExpirationAlertTier;
  label: string;
  badgeClass: string;
  borderClass: string;
  textClass: string;
  bgLightClass: string;
  isUrgent: boolean;
  daysRemaining: number | null;
}

export function getExpirationAlertDetails(
  expirationDateStr?: string,
  semValidade?: boolean,
  situacao?: string
): ExpirationAlertDetails {
  if (semValidade || situacao === 'reprovado' || situacao === 'pendente') {
    return {
      tier: 'regular',
      label: semValidade ? 'Sem Vencimento' : situacao === 'reprovado' ? 'Reprovado' : 'Pendente',
      badgeClass: 'bg-slate-800 text-slate-400 border border-slate-700',
      borderClass: 'border-slate-700',
      textClass: 'text-slate-400',
      bgLightClass: 'bg-slate-900',
      isUrgent: false,
      daysRemaining: null,
    };
  }

  const days = getDaysRemaining(expirationDateStr);
  if (days === null) {
    return {
      tier: 'regular',
      label: 'Indeterminado',
      badgeClass: 'bg-slate-800 text-slate-400 border border-slate-700',
      borderClass: 'border-slate-700',
      textClass: 'text-slate-400',
      bgLightClass: 'bg-slate-900',
      isUrgent: false,
      daysRemaining: null,
    };
  }

  if (days < 0) {
    return {
      tier: 'vencido',
      label: `Vencido há ${Math.abs(days)}d`,
      badgeClass: 'bg-red-950/80 text-red-300 border border-red-500/50 font-bold',
      borderClass: 'border-red-600',
      textClass: 'text-red-400',
      bgLightClass: 'bg-red-950/30',
      isUrgent: true,
      daysRemaining: days,
    };
  }

  if (days === 0) {
    return {
      tier: 'hoje',
      label: '🚨 VENCE HOJE (Data do Vencimento)',
      badgeClass: 'bg-red-600 text-white font-black animate-pulse border border-red-400 shadow-md shadow-red-600/40',
      borderClass: 'border-red-500',
      textClass: 'text-red-400 font-bold',
      bgLightClass: 'bg-red-950/40',
      isUrgent: true,
      daysRemaining: 0,
    };
  }

  if (days <= 15) {
    return {
      tier: '15_dias',
      label: `⚠️ Vence em ${days}d (Alerta 15 Dias)`,
      badgeClass: 'bg-orange-950/80 text-orange-300 border border-orange-500/60 font-bold',
      borderClass: 'border-orange-500',
      textClass: 'text-orange-400 font-semibold',
      bgLightClass: 'bg-orange-950/20',
      isUrgent: true,
      daysRemaining: days,
    };
  }

  if (days <= 30) {
    return {
      tier: '30_dias',
      label: `⏳ Vence em ${days}d (Alerta 30 Dias)`,
      badgeClass: 'bg-amber-950/70 text-amber-300 border border-amber-500/40 font-semibold',
      borderClass: 'border-amber-500',
      textClass: 'text-amber-400',
      bgLightClass: 'bg-amber-950/20',
      isUrgent: false,
      daysRemaining: days,
    };
  }

  return {
    tier: 'regular',
    label: `Válido (${days}d)`,
    badgeClass: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60',
    borderClass: 'border-emerald-600',
    textClass: 'text-emerald-400',
    bgLightClass: 'bg-emerald-950/10',
    isUrgent: false,
    daysRemaining: days,
  };
}

export function formatDateBR(dateStr?: string): string {
  if (!dateStr) return '-';
  if (dateStr.includes('/')) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function formatCPF(cpf?: string): string {
  if (!cpf) return '-';
  const clean = cpf.replace(/\D/g, '');
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

export function formatCNPJ(cnpj?: string): string {
  if (!cnpj) return '-';
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length === 14) {
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return cnpj;
}

export function maskCPFInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

