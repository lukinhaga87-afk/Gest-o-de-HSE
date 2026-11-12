import React, { useMemo, useState } from 'react';
import {
  Building2,
  Users,
  FileCheck,
  AlertTriangle,
  Clock,
  XCircle,
  FileText,
  HeartPulse,
  GraduationCap,
  Percent,
  TrendingUp,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Mail,
  Send,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import {
  getTrafficLightStatus,
  formatDateBR,
  getExpirationAlertDetails,
  ExpirationAlertDetails,
  ExpirationAlertTier,
} from '../../utils/trafficLight';
import { NavItemKey } from '../layout/Sidebar';

interface DashboardViewProps {
  onNavigate: (tab: NavItemKey) => void;
  onSelectEmployee?: (employeeId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    companies,
    employees,
    documents,
    trainings,
    exams,
    notificationConfigs,
    notificationLogs,
    triggerNotificationCheck,
  } = useSST();
  const { activeRole, activeEmpresaId, isSolicitante } = useAuth();

  const [runningQuickCheck, setRunningQuickCheck] = useState(false);
  const [quickFeedback, setQuickFeedback] = useState<string | null>(null);

  const handleQuickCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRunningQuickCheck(true);
    setQuickFeedback(null);
    try {
      const res = await triggerNotificationCheck();
      setQuickFeedback(`${res.dispatched} disparados, ${res.skippedDuplicates} duplicatas prevenidas.`);
      setTimeout(() => setQuickFeedback(null), 6000);
    } catch (err: any) {
      setQuickFeedback(`Falha: ${err.message || 'Erro ao conectar ao backend'}`);
      setTimeout(() => setQuickFeedback(null), 6000);
    } finally {
      setRunningQuickCheck(false);
    }
  };

  // Scope data if user is a contractor (solicitante)
  const scopedCompanies = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return companies.filter((c) => c.id === activeEmpresaId);
    }
    return companies;
  }, [companies, isSolicitante, activeEmpresaId]);

  const scopedEmployees = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return employees.filter((e) => e.empresaId === activeEmpresaId);
    }
    return employees;
  }, [employees, isSolicitante, activeEmpresaId]);

  const scopedDocuments = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return documents.filter((d) => d.empresaId === activeEmpresaId);
    }
    return documents;
  }, [documents, isSolicitante, activeEmpresaId]);

  const scopedTrainings = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return trainings.filter((t) => t.empresaId === activeEmpresaId);
    }
    return trainings;
  }, [trainings, isSolicitante, activeEmpresaId]);

  const scopedExams = useMemo(() => {
    if (isSolicitante && activeEmpresaId) {
      return exams.filter((e) => e.empresaId === activeEmpresaId);
    }
    return exams;
  }, [exams, isSolicitante, activeEmpresaId]);

  // Calculations
  const totalEmpresas = scopedCompanies.length;
  const colaboradoresAtivos = scopedEmployees.filter((e) => e.situacaoCadastral === 'ativo').length;
  const totalDocumentos = scopedDocuments.length;

  // Farol counts for documents
  let docValidos = 0;
  let docVencendo30d = 0;
  let docVencidos = 0;
  let docPendentes = 0;

  scopedDocuments.forEach((doc) => {
    const f = getTrafficLightStatus(doc.dataValidade, doc.semValidade, doc.situacao);
    if (f.status === 'verde') docValidos++;
    else if (f.status === 'amarelo') docVencendo30d++;
    else if (f.status === 'vermelho') docVencidos++;
    else if (f.status === 'cinza') docPendentes++;
  });

  // Treinamentos vencidos
  const treinamentosVencidos = scopedTrainings.filter((t) => {
    const f = getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao);
    return f.status === 'vermelho';
  }).length;

  const treinamentosVencendo = scopedTrainings.filter((t) => {
    const f = getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao);
    return f.status === 'amarelo';
  }).length;

  // ASOs vencidos
  const asosVencidos = scopedExams.filter((e) => {
    const f = getTrafficLightStatus(e.dataValidade, e.semValidade, e.situacao);
    return f.status === 'vermelho';
  }).length;

  // Conformidade Documental (%)
  const totalAvaliados = totalDocumentos + scopedTrainings.length + scopedExams.length;
  const totalConformes =
    docValidos +
    scopedTrainings.filter((t) => getTrafficLightStatus(t.dataValidade, t.semValidade, t.situacao).status === 'verde').length +
    scopedExams.filter((e) => getTrafficLightStatus(e.dataValidade, e.semValidade, e.situacao).status === 'verde').length;

  const percentConformidade = totalAvaliados > 0 ? Math.round((totalConformes / totalAvaliados) * 100) : 100;

  const [alertTierFilter, setAlertTierFilter] = useState<'todos' | 'hoje' | '15_dias' | '30_dias' | 'vencido'>('todos');

  // Alertas categorizados: 30 dias, 15 dias, Data do Vencimento (Hoje) e Vencidos
  const allAlerts = useMemo(() => {
    const list: {
      id: string;
      tipo: 'Documento' | 'Treinamento' | 'ASO';
      targetTab: NavItemKey;
      titulo: string;
      empresa: string;
      colaborador?: string;
      dataValidade: string;
      daysRemaining: number;
      tier: ExpirationAlertTier;
      details: ExpirationAlertDetails;
    }[] = [];

    scopedDocuments.forEach((d) => {
      const details = getExpirationAlertDetails(d.dataValidade, d.semValidade, d.situacao);
      if (details.tier !== 'regular' && details.daysRemaining !== null) {
        list.push({
          id: d.id,
          tipo: 'Documento',
          targetTab: 'documentos',
          titulo: d.nomeDocumento,
          empresa: d.empresaNome,
          colaborador: d.colaboradorNome,
          dataValidade: d.dataValidade || '',
          daysRemaining: details.daysRemaining,
          tier: details.tier,
          details,
        });
      }
    });

    scopedTrainings.forEach((t) => {
      const details = getExpirationAlertDetails(t.dataValidade, t.semValidade, t.situacao);
      if (details.tier !== 'regular' && details.daysRemaining !== null) {
        list.push({
          id: t.id,
          tipo: 'Treinamento',
          targetTab: 'treinamentos',
          titulo: t.nomeTreinamento,
          empresa: t.empresaNome,
          colaborador: t.colaboradorNome,
          dataValidade: t.dataValidade || '',
          daysRemaining: details.daysRemaining,
          tier: details.tier,
          details,
        });
      }
    });

    scopedExams.forEach((e) => {
      const details = getExpirationAlertDetails(e.dataValidade, e.semValidade, e.situacao);
      if (details.tier !== 'regular' && details.daysRemaining !== null) {
        list.push({
          id: e.id,
          tipo: 'ASO',
          targetTab: 'exames',
          titulo: e.tipoExame,
          empresa: e.empresaNome,
          colaborador: e.colaboradorNome,
          dataValidade: e.dataValidade || '',
          daysRemaining: details.daysRemaining,
          tier: details.tier,
          details,
        });
      }
    });

    return list.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [scopedDocuments, scopedTrainings, scopedExams]);

  // Counts by tier
  const countHoje = allAlerts.filter((a) => a.tier === 'hoje').length;
  const count15Dias = allAlerts.filter((a) => a.tier === '15_dias').length;
  const count30Dias = allAlerts.filter((a) => a.tier === '30_dias').length;
  const countVencidos = allAlerts.filter((a) => a.tier === 'vencido').length;

  const filteredAlerts = useMemo(() => {
    if (alertTierFilter === 'todos') return allAlerts;
    return allAlerts.filter((a) => a.tier === alertTierFilter);
  }, [allAlerts, alertTierFilter]);

  // Conformidade por empresa calculation
  const companyCompliance = useMemo(() => {
    return scopedCompanies.map((comp) => {
      const cDocs = scopedDocuments.filter((d) => d.empresaId === comp.id);
      const cTrainings = scopedTrainings.filter((t) => t.empresaId === comp.id);
      const cExams = scopedExams.filter((e) => e.empresaId === comp.id);

      const allItems = [...cDocs, ...cTrainings, ...cExams];
      if (allItems.length === 0) return { company: comp.nomeFantasia || comp.razaoSocial, pct: 100, vencidos: 0 };

      const validos = allItems.filter(
        (it) => getTrafficLightStatus(it.dataValidade, (it as any).semValidade, it.situacao).status === 'verde'
      ).length;

      const vencidos = allItems.filter(
        (it) => getTrafficLightStatus(it.dataValidade, (it as any).semValidade, it.situacao).status === 'vermelho'
      ).length;

      const pct = Math.round((validos / allItems.length) * 100);
      return {
        company: comp.nomeFantasia || comp.razaoSocial,
        pct,
        vencidos,
      };
    });
  }, [scopedCompanies, scopedDocuments, scopedTrainings, scopedExams]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 p-6 border border-slate-700/60 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-2">
              <ShieldCheck size={14} />
              Gestão Ativa de Segurança do Trabalho
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Painel de Indicadores e Faróis SST
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Monitoramento automático em tempo real da conformidade de contratadas, colaboradores, exames periódicos e documentação legal.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div className="h-12 w-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Percent size={24} />
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-slate-400">Índice Geral de Conformidade</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-extrabold ${percentConformidade >= 85 ? 'text-emerald-400' : percentConformidade >= 65 ? 'text-amber-400' : 'text-red-400'}`}>
                  {percentConformidade}%
                </span>
                <span className="text-xs text-slate-400">meta: &gt;95%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Módulo de Notificações Automáticas por E-mail - Integração Dashboard */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition-all">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Mail size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Notificações Automáticas de Vencimento</h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Backend 24/7 Ativo
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Marcos monitorados: <strong className="text-amber-400">30 dias</strong>,{' '}
                <strong className="text-orange-400">15 dias</strong> e{' '}
                <strong className="text-red-400">na data do vencimento</strong> com controle anti-duplicidade.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {quickFeedback && (
              <span className="text-[11px] font-medium text-blue-300 bg-blue-950/60 px-2.5 py-1 rounded-lg border border-blue-500/30">
                {quickFeedback}
              </span>
            )}

            <button
              onClick={handleQuickCheck}
              disabled={runningQuickCheck}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Executar verificação diária agora no backend"
            >
              <RefreshCw size={13} className={runningQuickCheck ? 'animate-spin' : ''} />
              <span>{runningQuickCheck ? 'Verificando...' : 'Verificar Agora'}</span>
            </button>

            <button
              onClick={() => onNavigate('notificacoes')}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <span>Gerenciar Notificações</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Quick summary badges */}
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-3 text-slate-400 text-[11px] flex-wrap">
            <span>
              Regras Ativas: <strong className="text-white font-mono">{notificationConfigs.filter((c) => c.ativo).length}</strong>
            </span>
            <span>•</span>
            <span>
              E-mails Enviados: <strong className="text-emerald-400 font-mono">{notificationLogs.length}</strong>
            </span>
            <span>•</span>
            <span>
              Alertas nos Marcos: <strong className="text-amber-400 font-mono">{countHoje + count15Dias + count30Dias}</strong>
            </span>
          </div>

          <button
            onClick={() => onNavigate('notificacoes')}
            className="text-[11px] text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1"
          >
            <span>Ver Histórico e Destinatários</span>
            <ExternalLink size={11} />
          </button>
        </div>
      </div>

      {/* KPI Cards Grid - Section 4 Requirement */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Empresas */}
        <div
          onClick={() => onNavigate('empresas')}
          className="group cursor-pointer rounded-xl bg-slate-900/90 p-4 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Empresas Contratadas</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
              <Building2 size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-white mt-2">{totalEmpresas}</p>
          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            Visualizar cadastros <ChevronRight size={12} />
          </p>
        </div>

        {/* Colaboradores Ativos */}
        <div
          onClick={() => onNavigate('colaboradores')}
          className="group cursor-pointer rounded-xl bg-slate-900/90 p-4 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 transition-all shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Colaboradores Ativos</span>
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20">
              <Users size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-white mt-2">{colaboradoresAtivos}</p>
          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            Acessar fichas <ChevronRight size={12} />
          </p>
        </div>

        {/* Documentos Válidos (Verde) */}
        <div
          onClick={() => onNavigate('documentos')}
          className="group cursor-pointer rounded-xl bg-slate-900/90 p-4 border border-slate-800 hover:border-emerald-900/50 hover:bg-slate-850 transition-all shadow-sm border-l-4 border-l-emerald-500"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Documentos Válidos</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <FileCheck size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-2">{docValidos}</p>
          <p className="text-[11px] text-emerald-400/80 mt-1">Farol Verde (&gt; 30 dias)</p>
        </div>

        {/* Vencendo em 30d (Amarelo) */}
        <div
          onClick={() => onNavigate('documentos')}
          className="group cursor-pointer rounded-xl bg-slate-900/90 p-4 border border-slate-800 hover:border-amber-900/50 hover:bg-slate-850 transition-all shadow-sm border-l-4 border-l-amber-400"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Próximos a Vencer</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Clock size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-400 mt-2">{docVencendo30d}</p>
          <p className="text-[11px] text-amber-400/80 mt-1">Farol Amarelo (≤ 30 dias)</p>
        </div>

        {/* Vencidos (Vermelho) */}
        <div
          onClick={() => onNavigate('documentos')}
          className="group cursor-pointer rounded-xl bg-slate-900/90 p-4 border border-slate-800 hover:border-red-900/50 hover:bg-slate-850 transition-all shadow-sm border-l-4 border-l-red-500"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Documentos Vencidos</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
              <XCircle size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-red-400 mt-2">{docVencidos}</p>
          <p className="text-[11px] text-red-400/80 mt-1">Farol Vermelho (Ação Imediata)</p>
        </div>
      </div>

      {/* Second Row of KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Treinamentos Vencidos */}
        <div
          onClick={() => onNavigate('treinamentos')}
          className="cursor-pointer rounded-xl bg-slate-900/80 p-4 border border-slate-800 flex items-center justify-between hover:border-slate-700"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
              <GraduationCap size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Treinamentos Vencidos</p>
              <p className="text-xl font-bold text-white mt-0.5">{treinamentosVencidos}</p>
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
            {treinamentosVencendo} vencendo em 30d
          </span>
        </div>

        {/* ASOs Vencidos */}
        <div
          onClick={() => onNavigate('exames')}
          className="cursor-pointer rounded-xl bg-slate-900/80 p-4 border border-slate-800 flex items-center justify-between hover:border-slate-700"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400">
              <HeartPulse size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-400">ASOs Ocupacionais Vencidos</p>
              <p className="text-xl font-bold text-white mt-0.5">{asosVencidos}</p>
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
            NR-07 Exigido
          </span>
        </div>

        {/* Pendentes de Aprovação */}
        <div
          onClick={() => onNavigate('documentos')}
          className="cursor-pointer rounded-xl bg-slate-900/80 p-4 border border-slate-800 flex items-center justify-between hover:border-slate-700"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-800 text-slate-300">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-xs text-slate-400">Pendentes de Aprovação</p>
              <p className="text-xl font-bold text-white mt-0.5">{docPendentes}</p>
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Farol Cinza
          </span>
        </div>
      </div>

      {/* Main Grid: Compliance by Company & Expiration Alert Board (30 days) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Compliance by Company (Section 4 Chart/Table) */}
        <div className="lg:col-span-7 rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp size={18} className="text-blue-400" />
                Conformidade por Empresa Contratada
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Percentual de regularidade documental e técnica
              </p>
            </div>
            <button
              onClick={() => onNavigate('empresas')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
            >
              Ver todas <ChevronRight size={14} />
            </button>
          </div>

          <div className="space-y-4">
            {companyCompliance.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                Nenhuma empresa cadastrada no momento.
              </p>
            ) : (
              companyCompliance.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200 truncate max-w-[280px]">
                      {item.company}
                    </span>
                    <div className="flex items-center gap-3">
                      {item.vencidos > 0 && (
                        <span className="text-[11px] text-red-400 font-semibold">
                          {item.vencidos} vencido(s)
                        </span>
                      )}
                      <span className="font-bold text-slate-200">{item.pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        item.pct >= 85
                          ? 'bg-emerald-500'
                          : item.pct >= 60
                          ? 'bg-amber-400'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick Monthly Evolution Indicator */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            <p className="text-xs font-semibold text-slate-400 mb-2">Evolução Mensal da Conformidade</p>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <p className="text-slate-400 text-[10px]">Agosto</p>
                <p className="font-bold text-slate-300">78%</p>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <p className="text-slate-400 text-[10px]">Setembro</p>
                <p className="font-bold text-slate-300">82%</p>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
                <p className="text-slate-400 text-[10px]">Outubro</p>
                <p className="font-bold text-amber-400">86%</p>
              </div>
              <div className="p-2 rounded bg-blue-950/40 border border-blue-500/30">
                <p className="text-blue-300 text-[10px]">Novembro (Atual)</p>
                <p className="font-bold text-emerald-400">{percentConformidade}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quadro de Alertas - 30 Dias, 15 Dias e Data do Vencimento (Hoje) */}
        <div className="lg:col-span-5 rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                Quadro de Alertas de Vencimento
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Monitoramento crítico: 30 dias, 15 dias e data do vencimento
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onNavigate('notificacoes')}
                className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 flex items-center gap-1 transition-colors"
                title="Configurar Notificações Automáticas por E-mail"
              >
                <Mail size={12} />
                <span>Notificações</span>
              </button>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {allAlerts.length}
              </span>
            </div>
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap pb-3 mb-3 border-b border-slate-800 text-[11px]">
            <button
              onClick={() => setAlertTierFilter('todos')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                alertTierFilter === 'todos'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Todos ({allAlerts.length})
            </button>
            <button
              onClick={() => setAlertTierFilter('hoje')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                alertTierFilter === 'hoje'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-950/40 text-red-300 border border-red-500/30 hover:bg-red-900/50'
              }`}
            >
              <span>🚨 Vence Hoje</span>
              <span className="font-bold">({countHoje})</span>
            </button>
            <button
              onClick={() => setAlertTierFilter('15_dias')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                alertTierFilter === '15_dias'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-950/40 text-orange-300 border border-orange-500/30 hover:bg-orange-900/50'
              }`}
            >
              <span>⚠️ 15 Dias</span>
              <span className="font-bold">({count15Dias})</span>
            </button>
            <button
              onClick={() => setAlertTierFilter('30_dias')}
              className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                alertTierFilter === '30_dias'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-950/40 text-amber-300 border border-amber-500/30 hover:bg-amber-900/50'
              }`}
            >
              <span>⏳ 30 Dias</span>
              <span className="font-bold">({count30Dias})</span>
            </button>
            {countVencidos > 0 && (
              <button
                onClick={() => setAlertTierFilter('vencido')}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  alertTierFilter === 'vencido'
                    ? 'bg-red-700 text-white'
                    : 'bg-slate-800 text-red-400 hover:bg-red-950/50'
                }`}
              >
                <span>❌ Vencidos</span>
                <span className="font-bold">({countVencidos})</span>
              </button>
            )}
          </div>

          {/* Alerts List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[350px] pr-1 custom-scrollbar">
            {filteredAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400">
                <ShieldCheck size={36} className="text-emerald-500 mb-2" />
                <p className="text-xs font-semibold text-slate-300">
                  {alertTierFilter === 'todos'
                    ? 'Nenhum alerta de vencimento registrado!'
                    : 'Nenhum registro nesta categoria de alerta.'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Conformidade em dia conforme parâmetros de EHS.
                </p>
              </div>
            ) : (
              filteredAlerts.map((alerta) => (
                <div
                  key={`${alerta.tipo}-${alerta.id}`}
                  onClick={() => onNavigate(alerta.targetTab)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer hover:scale-[1.01] ${
                    alerta.tier === 'hoje'
                      ? 'bg-red-950/30 border-red-500/70 shadow-lg shadow-red-950/40'
                      : alerta.tier === '15_dias'
                      ? 'bg-orange-950/25 border-orange-500/50 hover:border-orange-400'
                      : alerta.tier === '30_dias'
                      ? 'bg-amber-950/20 border-amber-500/40 hover:border-amber-400'
                      : 'bg-slate-950/70 border-red-800/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {alerta.tipo}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${alerta.details.badgeClass}`}>
                          {alerta.details.label}
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-white truncate max-w-[220px]">
                        {alerta.titulo}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                        Empresa: <span className="text-slate-300">{alerta.empresa}</span>
                      </p>
                      {alerta.colaborador && (
                        <p className="text-[11px] text-slate-400">
                          Colaborador: <span className="text-slate-300">{alerta.colaborador}</span>
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs font-extrabold block ${alerta.details.textClass}`}>
                        {alerta.daysRemaining === 0
                          ? 'VENCE HOJE'
                          : alerta.daysRemaining < 0
                          ? `${Math.abs(alerta.daysRemaining)}d vencido`
                          : `${alerta.daysRemaining} dias`}
                      </span>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {formatDateBR(alerta.dataValidade)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">Clique em um alerta para abrir o módulo</span>
            <button
              onClick={() => onNavigate('relatorios')}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1"
            >
              Relatório Completo <ExternalLink size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
