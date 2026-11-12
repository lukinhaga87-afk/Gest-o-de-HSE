import React, { useState, useMemo } from 'react';
import {
  Bell,
  Mail,
  Send,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  Building2,
  Users,
  FileText,
  Sliders,
  ShieldCheck,
  Eye,
  Info,
  Calendar,
  Sparkles,
  Server,
  Layers,
  ArrowRight,
  X,
  Paperclip,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import {
  NotificationConfig,
  NotificationLog,
  NotificationMilestone,
  UpcomingExpirationAlert,
} from '../../types/sst';
import { formatDateBR, getDaysRemaining } from '../../utils/trafficLight';
import { buildNotificationHtml } from '../../utils/notificationTemplate';

export const NotificationsView: React.FC = () => {
  const {
    notificationConfigs,
    notificationLogs,
    companies,
    employees,
    documents,
    trainings,
    exams,
    environmentalDocs,
    addNotificationConfig,
    updateNotificationConfig,
    deleteNotificationConfig,
    triggerNotificationCheck,
    sendTestNotificationEmail,
  } = useSST();

  const { isAdmin, isAuditor, profile } = useAuth();

  // Active Tab: 'config' | 'history' | 'upcoming' | 'smtp'
  const [activeSubTab, setActiveSubTab] = useState<'config' | 'history' | 'upcoming' | 'smtp'>('config');

  // Search & Filter in Logs
  const [logSearch, setLogSearch] = useState('');
  const [logMilestoneFilter, setLogMilestoneFilter] = useState<'todos' | NotificationMilestone | 'teste' | 'recalculo'>('todos');
  const [logStatusFilter, setLogStatusFilter] = useState<'todos' | 'sucesso' | 'falha' | 'simulado'>('todos');

  // Trigger State
  const [runningCheck, setRunningCheck] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    dispatched: number;
    skippedDuplicates: number;
    totalEvaluated: number;
    message: string;
  } | null>(null);

  // Modal: Create / Edit Rule
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleEmailInput, setRuleEmailInput] = useState('');
  const [ruleEmails, setRuleEmails] = useState<string[]>([]);
  const [ruleCompanyId, setRuleCompanyId] = useState('todas');
  const [ruleEmployeeId, setRuleEmployeeId] = useState('todos');
  const [ruleCategory, setRuleCategory] = useState('todas');
  const [ruleMilestones, setRuleMilestones] = useState<NotificationMilestone[]>(['30_dias', '15_dias', 'hoje']);
  const [ruleActive, setRuleActive] = useState(true);

  // Modal: Test Email
  const [isTestEmailModalOpen, setIsTestEmailModalOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailNote, setTestEmailNote] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; status?: string } | null>(null);

  // Modal: Disparar E-mail (Manual Custom Dispatch - Administrator Exclusive)
  const [isCustomEmailModalOpen, setIsCustomEmailModalOpen] = useState(false);
  const [customToInput, setCustomToInput] = useState('');
  const [customToEmails, setCustomToEmails] = useState<string[]>([]);
  const [customCompanyId, setCustomCompanyId] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [customAttachment, setCustomAttachment] = useState<{ name: string; dataUrl: string; size: string } | null>(null);
  const [isSubmittingCustomEmail, setIsSubmittingCustomEmail] = useState(false);
  const [customEmailResult, setCustomEmailResult] = useState<{ success: boolean; message: string } | null>(null);

  // Tab 4: SMTP Configuration & Diagnostics State
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('Gestão SST <notificacoes.sst@gmail.com>');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpStatusInfo, setSmtpStatusInfo] = useState<{
    configured: boolean;
    host: string;
    port: string;
    user: string;
    from: string;
    mode: string;
  } | null>(null);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpFeedback, setSmtpFeedback] = useState<{ text: string; success: boolean } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ connected: boolean; message: string } | null>(null);

  // Fetch SMTP Health
  const fetchSmtpHealth = async () => {
    try {
      const res = await fetch('/api/notifications/health');
      if (res.ok) {
        const data = await res.json();
        if (data.smtp) {
          setSmtpStatusInfo(data.smtp);
          if (data.smtp.host && data.smtp.host !== 'Não configurado') setSmtpHost(data.smtp.host);
          if (data.smtp.port) setSmtpPort(data.smtp.port);
          if (data.smtp.user && data.smtp.user !== 'Não configurado') setSmtpUser(data.smtp.user);
          if (data.smtp.from) setSmtpFrom(data.smtp.from);
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar status SMTP:', e);
    }
  };

  React.useEffect(() => {
    fetchSmtpHealth();
  }, []);

  // Modal: Email Preview
  const [previewLog, setPreviewLog] = useState<NotificationLog | null>(null);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return notificationLogs.filter((log) => {
      // Search
      const searchLower = logSearch.toLowerCase();
      const matchesSearch =
        !logSearch ||
        log.documentoTitulo.toLowerCase().includes(searchLower) ||
        log.empresaNome.toLowerCase().includes(searchLower) ||
        (log.colaboradorNome && log.colaboradorNome.toLowerCase().includes(searchLower)) ||
        log.destinatarios.some((e) => e.toLowerCase().includes(searchLower)) ||
        log.idempotencyKey.toLowerCase().includes(searchLower);

      // Milestone
      const matchesMilestone = logMilestoneFilter === 'todos' || log.marco === logMilestoneFilter;

      // Status
      const matchesStatus = logStatusFilter === 'todos' || log.status === logStatusFilter;

      return matchesSearch && matchesMilestone && matchesStatus;
    });
  }, [notificationLogs, logSearch, logMilestoneFilter, logStatusFilter]);

  // Compute Upcoming Alerts (Forecast of alerts that match 30d, 15d, 0d or upcoming)
  const upcomingAlerts = useMemo<UpcomingExpirationAlert[]>(() => {
    const list: UpcomingExpirationAlert[] = [];

    // Helper to evaluate an item
    const checkItem = (
      id: string,
      titulo: string,
      tipoItem: 'Documento' | 'Treinamento' | 'Exame/ASO' | 'Licença Ambiental',
      categoria: string,
      empresaId: string,
      empresaNome: string,
      colaboradorId?: string,
      colaboradorNome?: string,
      dataValidade?: string,
      semValidade?: boolean
    ) => {
      if (semValidade || !dataValidade) return;

      const days = getDaysRemaining(dataValidade);
      if (days === null) return;

      // Determine candidate milestones for this item
      const candidateMilestones: { milestone: NotificationMilestone; label: string; daysTarget: number }[] = [
        { milestone: '30_dias', label: '30 dias antes', daysTarget: 30 },
        { milestone: '15_dias', label: '15 dias antes', daysTarget: 15 },
        { milestone: 'hoje', label: 'Na própria data do vencimento', daysTarget: 0 },
      ];

      candidateMilestones.forEach(({ milestone, label, daysTarget }) => {
        // Find matching active rules
        const matchingRules = notificationConfigs.filter((cfg) => {
          if (!cfg.ativo) return false;
          if (!cfg.marcos.includes(milestone)) return false;
          if (cfg.empresaId && cfg.empresaId !== 'todas' && cfg.empresaId !== empresaId) return false;
          if (cfg.colaboradorId && cfg.colaboradorId !== 'todos' && colaboradorId && cfg.colaboradorId !== colaboradorId) return false;
          if (cfg.categoria && cfg.categoria !== 'todas') {
            const cCat = cfg.categoria.toLowerCase();
            const iCat = categoria.toLowerCase();
            if (!iCat.includes(cCat) && !cCat.includes(iCat)) return false;
          }
          return true;
        });

        if (matchingRules.length > 0) {
          const recipients = Array.from(
            new Set(matchingRules.flatMap((r) => r.destinatarios || []))
          );

          // Check if already dispatched for this date
          const idempotencyKey = `${id}_${milestone}_${dataValidade}`;
          const existingLog = notificationLogs.find(
            (l) => l.idempotencyKey === idempotencyKey && (l.status === 'sucesso' || l.status === 'simulado')
          );

          // Only include if item is within or near the milestone scope (e.g. within 35 days)
          if (days <= 35 && days >= -5) {
            list.push({
              documentoId: id,
              documentoTitulo: titulo,
              tipoItem,
              categoria,
              empresaNome,
              empresaId,
              colaboradorNome,
              colaboradorId,
              dataVencimento: dataValidade,
              diasRestantes: days,
              marco: milestone,
              marcoDescricao: label,
              destinatariosPrevistos: recipients,
              regrasAplicaveis: matchingRules.map((r) => r.nomeRegra),
              jaDisparado: Boolean(existingLog),
              ultimaNotificacao: existingLog?.dataHora,
            });
          }
        }
      });
    };

    // 1. Documents
    documents.forEach((d) =>
      checkItem(
        d.id,
        d.nomeDocumento,
        'Documento',
        d.categoria,
        d.empresaId,
        d.empresaNome,
        d.colaboradorId,
        d.colaboradorNome,
        d.dataValidade,
        d.semValidade
      )
    );

    // 2. Trainings
    trainings.forEach((t) =>
      checkItem(
        t.id,
        t.nomeTreinamento,
        'Treinamento',
        'Treinamento',
        t.empresaId,
        t.empresaNome,
        t.colaboradorId,
        t.colaboradorNome,
        t.dataValidade,
        t.semValidade
      )
    );

    // 3. Exams
    exams.forEach((e) =>
      checkItem(
        e.id,
        e.tipoExame,
        'Exame/ASO',
        'ASO',
        e.empresaId,
        e.empresaNome,
        e.colaboradorId,
        e.colaboradorNome,
        e.dataValidade,
        e.semValidade
      )
    );

    // 4. Environmental Docs
    environmentalDocs.forEach((env) =>
      checkItem(
        env.id,
        env.nome,
        'Licença Ambiental',
        'Documento Ambiental',
        '',
        env.orgaoEmissor,
        undefined,
        undefined,
        env.dataValidade,
        env.semValidade
      )
    );

    return list.sort((a, b) => a.diasRestantes - b.diasRestantes);
  }, [documents, trainings, exams, environmentalDocs, notificationConfigs, notificationLogs]);

  // Handle Run Check Now
  const handleRunCheckNow = async () => {
    setRunningCheck(true);
    setCheckResult(null);
    try {
      const res = await triggerNotificationCheck();
      setCheckResult({
        dispatched: res.dispatched,
        skippedDuplicates: res.skippedDuplicates,
        totalEvaluated: res.totalEvaluated,
        message: res.message || 'Verificação concluída no backend com sucesso.',
      });
    } catch (err: any) {
      setCheckResult({
        dispatched: 0,
        skippedDuplicates: 0,
        totalEvaluated: 0,
        message: `Falha na verificação: ${err.message || String(err)}`,
      });
    } finally {
      setRunningCheck(false);
    }
  };

  // Open Modal for New Rule
  const handleOpenNewRuleModal = () => {
    setEditingRuleId(null);
    setRuleName('');
    setRuleEmails(['sesmt@empresa.com.br']);
    setRuleEmailInput('');
    setRuleCompanyId('todas');
    setRuleEmployeeId('todos');
    setRuleCategory('todas');
    setRuleMilestones(['30_dias', '15_dias', 'hoje']);
    setRuleActive(true);
    setIsRuleModalOpen(true);
  };

  // Open Modal for Edit Rule
  const handleOpenEditRuleModal = (rule: NotificationConfig) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.nomeRegra);
    setRuleEmails(rule.destinatarios || []);
    setRuleEmailInput('');
    setRuleCompanyId(rule.empresaId || 'todas');
    setRuleEmployeeId(rule.colaboradorId || 'todos');
    setRuleCategory(rule.categoria || 'todas');
    setRuleMilestones(rule.marcos || ['30_dias', '15_dias', 'hoje']);
    setRuleActive(rule.ativo);
    setIsRuleModalOpen(true);
  };

  // Add email chip
  const handleAddEmail = () => {
    const clean = ruleEmailInput.trim().toLowerCase();
    if (clean && clean.includes('@') && !ruleEmails.includes(clean)) {
      setRuleEmails([...ruleEmails, clean]);
      setRuleEmailInput('');
    }
  };

  // Remove email chip
  const handleRemoveEmail = (emailToRemove: string) => {
    setRuleEmails(ruleEmails.filter((e) => e !== emailToRemove));
  };

  // Save Rule
  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) {
      alert('Informe o nome da regra de notificação.');
      return;
    }
    if (ruleEmails.length === 0) {
      alert('Cadastre ao menos um e-mail destinatário.');
      return;
    }
    if (ruleMilestones.length === 0) {
      alert('Selecione ao menos um marco de vencimento (30d, 15d ou Hoje).');
      return;
    }

    const selectedCompany = companies.find((c) => c.id === ruleCompanyId);
    const selectedEmployee = employees.find((emp) => emp.id === ruleEmployeeId);

    const ruleData: Omit<NotificationConfig, 'id'> = {
      nomeRegra: ruleName.trim(),
      destinatarios: ruleEmails,
      empresaId: ruleCompanyId,
      empresaNome: selectedCompany?.razaoSocial || 'Todas as Empresas',
      colaboradorId: ruleEmployeeId,
      colaboradorNome: selectedEmployee?.nomeCompleto || 'Todos os Colaboradores',
      categoria: ruleCategory,
      marcos: ruleMilestones,
      ativo: ruleActive,
    };

    if (editingRuleId) {
      await updateNotificationConfig(editingRuleId, ruleData);
    } else {
      await addNotificationConfig(ruleData);
    }

    setIsRuleModalOpen(false);
  };

  // Custom Email Handlers
  const handleAddCustomEmail = () => {
    const trimmed = customToInput.trim().toLowerCase();
    if (trimmed && trimmed.includes('@') && !customToEmails.includes(trimmed)) {
      setCustomToEmails([...customToEmails, trimmed]);
      setCustomToInput('');
    }
  };

  const handleRemoveCustomEmail = (emailToRemove: string) => {
    setCustomToEmails(customToEmails.filter((e) => e !== emailToRemove));
  };

  const handleCustomAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('O arquivo selecionado excede o limite máximo permitido de 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCustomAttachment({
        name: file.name,
        dataUrl: reader.result as string,
        size: (file.size / 1024).toFixed(1) + ' KB',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSendCustomEmail = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalRecipients = [...customToEmails];
    if (customToInput.trim() && customToInput.includes('@') && !finalRecipients.includes(customToInput.trim().toLowerCase())) {
      finalRecipients.push(customToInput.trim().toLowerCase());
      setCustomToEmails(finalRecipients);
      setCustomToInput('');
    }

    if (finalRecipients.length === 0) {
      alert('Informe pelo menos um e-mail de destinatário válido.');
      return;
    }

    if (!customSubject.trim()) {
      alert('O campo Assunto é obrigatório.');
      return;
    }

    if (!customMessage.trim()) {
      alert('O campo Mensagem é obrigatório.');
      return;
    }

    setIsSubmittingCustomEmail(true);
    setCustomEmailResult(null);

    const selectedCompany = companies.find((c) => c.id === customCompanyId);

    try {
      const res = await fetch('/api/notifications/custom-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: finalRecipients,
          companyId: customCompanyId || undefined,
          companyName: selectedCompany?.razaoSocial || 'Geral / Todas as Empresas',
          subject: customSubject.trim(),
          message: customMessage.trim(),
          attachmentName: customAttachment?.name,
          attachmentDataUrl: customAttachment?.dataUrl,
          senderName: profile?.nome || 'Administrador EHS',
          senderEmail: profile?.email || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCustomEmailResult({
          success: true,
          message: 'E-mail enviado com sucesso!',
        });
        setTimeout(() => {
          setCustomToEmails([]);
          setCustomToInput('');
          setCustomSubject('');
          setCustomMessage('');
          setCustomAttachment(null);
        }, 1500);
      } else {
        setCustomEmailResult({
          success: false,
          message: 'Não foi possível realizar o envio. Verifique as configurações SMTP e tente novamente.',
        });
      }
    } catch (err: any) {
      setCustomEmailResult({
        success: false,
        message: 'Não foi possível realizar o envio. Verifique as configurações SMTP e tente novamente.',
      });
    } finally {
      setIsSubmittingCustomEmail(false);
    }
  };

  // SMTP Settings Handlers
  const handleSaveSmtpConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSmtp(true);
    setSmtpFeedback(null);
    setConnTestResult(null);

    try {
      const res = await fetch('/api/notifications/save-smtp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom,
          secure: smtpSecure,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSmtpFeedback({ text: data.message, success: true });
        if (data.verification) {
          setConnTestResult(data.verification);
        }
        await fetchSmtpHealth();
      } else {
        setSmtpFeedback({ text: data.message || 'Erro ao salvar configurações.', success: false });
      }
    } catch (err: any) {
      setSmtpFeedback({ text: `Falha na requisição: ${err.message || String(err)}`, success: false });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestConnectionOnly = async () => {
    setTestingConnection(true);
    setConnTestResult(null);
    try {
      const res = await fetch('/api/notifications/verify-smtp', { method: 'POST' });
      const data = await res.json();
      setConnTestResult({
        connected: data.connected,
        message: data.message,
      });
    } catch (e: any) {
      setConnTestResult({
        connected: false,
        message: `Falha na comunicação com o backend: ${e.message || String(e)}`,
      });
    } finally {
      setTestingConnection(false);
    }
  };

  // Handle Test Email
  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailAddress || !testEmailAddress.includes('@')) {
      alert('Informe um e-mail válido para o teste.');
      return;
    }

    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await sendTestNotificationEmail(testEmailAddress, testEmailNote);
      setTestResult({
        success: res.success,
        message: res.detalhes || res.error || 'Disparo de teste concluído.',
        status: res.status,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Falha: ${err.message || String(err)}`,
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Header */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 p-6 border border-slate-700/60 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-2">
              <Mail size={14} />
              Módulo de Notificações Automáticas
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Controle Inteligente de Vencimentos por E-mail
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Serviço diário no backend para monitoramento contínuo com disparos nos marcos críticos:{' '}
              <strong className="text-amber-400">30 dias</strong>,{' '}
              <strong className="text-orange-400">15 dias</strong> e{' '}
              <strong className="text-red-400">na data do vencimento</strong>.
            </p>
          </div>

          {/* Quick Actions Bar */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {isAdmin && (
              <button
                onClick={() => {
                  setCustomEmailResult(null);
                  setCustomToEmails([]);
                  setCustomToInput('');
                  setCustomCompanyId('');
                  setCustomSubject('');
                  setCustomMessage('');
                  setCustomAttachment(null);
                  setIsCustomEmailModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all border border-blue-400/30 cursor-pointer"
                title="Disparar e-mail avulso com anexos para destinatários e empresas"
              >
                <Mail size={15} className="text-white" />
                <span>DISPARAR E-MAIL</span>
              </button>
            )}

            <button
              onClick={handleRunCheckNow}
              disabled={runningCheck}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
              title="Executa a rotina de monitoramento diário no backend agora"
            >
              <RefreshCw size={15} className={runningCheck ? 'animate-spin' : ''} />
              <span>{runningCheck ? 'Verificando no Backend...' : 'Executar Verificação Agora'}</span>
            </button>

            <button
              onClick={() => {
                setTestResult(null);
                setTestEmailAddress('destinatario@empresa.com.br');
                setIsTestEmailModalOpen(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              title="Testar envio real de e-mail e conexão SMTP"
            >
              <Send size={14} className="text-blue-400" />
              <span>TESTAR ENVIO DE E-MAIL</span>
            </button>

            {isAdmin && (
              <button
                onClick={handleOpenNewRuleModal}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors cursor-pointer"
              >
                <Plus size={15} />
                <span>Nova Regra</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Feedback Toast if check ran */}
        {checkResult && (
          <div className="mt-4 p-3.5 rounded-xl bg-blue-950/60 border border-blue-500/40 text-xs text-blue-200 flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
              <div>
                <span className="font-bold text-white">Resultado do Monitoramento: </span>
                <span>
                  {checkResult.dispatched} e-mail(s) disparado(s) • {checkResult.skippedDuplicates} duplicata(s) evitada(s) •{' '}
                  {checkResult.totalEvaluated} documentos avaliados.
                </span>
              </div>
            </div>
            <button
              onClick={() => setCheckResult(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Regras Ativas</span>
            <Sliders size={16} className="text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white mt-1.5">
            {notificationConfigs.filter((c) => c.ativo).length}
            <span className="text-xs text-slate-400 font-normal ml-1">/ {notificationConfigs.length} total</span>
          </p>
          <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Configuração flexível multi-destinatário
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Alertas Previstos</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-400 mt-1.5">{upcomingAlerts.length}</p>
          <p className="text-[11px] text-slate-400 mt-1">Marcos de 30d, 15d e data hoje</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>E-mails Enviados (Histórico)</span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-1.5">
            {notificationLogs.filter((l) => l.status === 'sucesso' || l.status === 'simulado').length}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Persistidos em banco com auditoria</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Controle Anti-Duplicidade</span>
            <ShieldCheck size={16} className="text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-purple-400 mt-1.5">100%</p>
          <p className="text-[11px] text-slate-400 mt-1">Chave idempotente única por marco</p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveSubTab('config')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeSubTab === 'config'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Sliders size={14} />
          <span>Regras de Notificação ({notificationConfigs.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeSubTab === 'history'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Clock size={14} />
          <span>Histórico de Disparos ({notificationLogs.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('upcoming')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeSubTab === 'upcoming'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Calendar size={14} />
          <span>Previsão de Próximos Alertas ({upcomingAlerts.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('smtp')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeSubTab === 'smtp'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Server size={14} />
          <span>Serviço SMTP & Backend</span>
        </button>
      </div>

      {/* TAB 1: Configuração de Regras de Notificação */}
      {activeSubTab === 'config' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Regras e Destinatários Configurados</h3>
              <p className="text-xs text-slate-400">
                Cadastre múltiplos e-mails por empresa contratada, colaborador ou categoria documental.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={handleOpenNewRuleModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <Plus size={14} />
                <span>Nova Regra</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notificationConfigs.map((rule) => (
              <div
                key={rule.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                  rule.ativo
                    ? 'bg-slate-900 border-slate-700/80 shadow-md shadow-slate-950/40'
                    : 'bg-slate-900/40 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  {/* Top: Title & Toggle */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="text-sm font-bold text-white line-clamp-1">{rule.nomeRegra}</h4>
                    <button
                      onClick={() => updateNotificationConfig(rule.id, { ativo: !rule.ativo })}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                        rule.ativo
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {rule.ativo ? '● Ativa' : '○ Inativa'}
                    </button>
                  </div>

                  {/* Badges of Milestones */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {rule.marcos.includes('30_dias') && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        ⏳ 30 Dias Antes
                      </span>
                    )}
                    {rule.marcos.includes('15_dias') && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20">
                        ⚠️ 15 Dias Antes
                      </span>
                    )}
                    {rule.marcos.includes('hoje') && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 font-bold">
                        🚨 Data Vencimento (0d)
                      </span>
                    )}
                  </div>

                  {/* Filters Info */}
                  <div className="space-y-1 text-xs text-slate-300 mb-3 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Building2 size={12} className="shrink-0 text-slate-400" />
                      <span>Empresa:</span>
                      <strong className="text-slate-200 truncate">{rule.empresaNome || 'Todas as Empresas'}</strong>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Users size={12} className="shrink-0 text-slate-400" />
                      <span>Colaborador:</span>
                      <strong className="text-slate-200 truncate">{rule.colaboradorNome || 'Todos os Colaboradores'}</strong>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-400">
                      <FileText size={12} className="shrink-0 text-slate-400" />
                      <span>Categoria:</span>
                      <strong className="text-slate-200 capitalize">{rule.categoria || 'Todas as Categorias'}</strong>
                    </div>
                  </div>

                  {/* Recipients List */}
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                      <Mail size={12} /> Destinatários Cadastrados ({rule.destinatarios?.length || 0}):
                    </p>
                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1 custom-scrollbar">
                      {(rule.destinatarios || []).map((email, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono truncate max-w-[200px]"
                        >
                          {email}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                {isAdmin && (
                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleOpenEditRuleModal(rule)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Editar Regra"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Deseja realmente excluir a regra "${rule.nomeRegra}"?`)) {
                          deleteNotificationConfig(rule.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                      title="Excluir Regra"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Histórico de Envios & Trilha com Controle contra Duplicidade */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {/* Header & Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 p-4 rounded-xl border border-slate-800">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Buscar por documento, empresa, destinatário ou chave..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={logMilestoneFilter}
                onChange={(e) => setLogMilestoneFilter(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
              >
                <option value="todos">Todos os Marcos</option>
                <option value="30_dias">⏳ 30 Dias Antes</option>
                <option value="15_dias">⚠️ 15 Dias Antes</option>
                <option value="hoje">🚨 Data Vencimento (Hoje)</option>
                <option value="recalculo">🔄 Recálculo</option>
                <option value="teste">🧪 Teste</option>
              </select>

              <select
                value={logStatusFilter}
                onChange={(e) => setLogStatusFilter(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
              >
                <option value="todos">Todos os Status</option>
                <option value="sucesso">🟢 Sucesso (SMTP)</option>
                <option value="simulado">🟡 Simulado</option>
                <option value="falha">🔴 Falha</option>
              </select>
            </div>
          </div>

          {/* Table of Sent Logs */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Data e Horário</th>
                    <th className="py-3 px-4">Documento Relacionado</th>
                    <th className="py-3 px-4">Empresa & Colaborador</th>
                    <th className="py-3 px-4">Marco</th>
                    <th className="py-3 px-4">Destinatários</th>
                    <th className="py-3 px-4">Status & Idempotência</th>
                    <th className="py-3 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <Clock size={32} className="mx-auto text-slate-400 mb-2" />
                        <p className="font-semibold text-slate-300">Nenhum registro de envio encontrado.</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Acione "Executar Verificação Agora" para disparar alertas pendentes.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-850/60 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono text-slate-300 font-semibold">
                            {formatDateBR(log.dataHora.split('T')[0])}
                          </span>
                          <span className="block text-[10px] text-slate-400 font-mono">
                            {log.dataHora.split('T')[1]?.substring(0, 8)}
                          </span>
                        </td>

                        <td className="py-3 px-4 max-w-[220px]">
                          <span className="font-semibold text-white truncate block">{log.documentoTitulo}</span>
                          <span className="text-[10px] text-slate-400">{log.categoria}</span>
                          {log.dataVencimento && (
                            <span className="text-[10px] text-amber-400/90 block font-mono">
                              Venc: {formatDateBR(log.dataVencimento)}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[200px]">
                          <span className="text-slate-200 font-medium truncate block">{log.empresaNome}</span>
                          {log.colaboradorNome && (
                            <span className="text-[10px] text-slate-400 truncate block">
                              {log.colaboradorNome}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.marco === 'hoje' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-500">
                              🚨 Vence Hoje
                            </span>
                          )}
                          {log.marco === '15_dias' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-orange-950/80 text-orange-300 border border-orange-500/60">
                              ⚠️ 15 Dias
                            </span>
                          )}
                          {log.marco === '30_dias' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-500/40">
                              ⏳ 30 Dias
                            </span>
                          )}
                          {log.marco === 'recalculo' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/50">
                              🔄 Recálculo
                            </span>
                          )}
                          {log.marco === 'teste' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-500/50">
                              🧪 Teste
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[220px]">
                          <div className="flex flex-wrap gap-1">
                            {log.destinatarios.map((dest, i) => (
                              <span
                                key={i}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 truncate max-w-[190px]"
                                title={dest}
                              >
                                {dest}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            {log.status === 'sucesso' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 size={11} /> Enviado (SMTP)
                              </span>
                            )}
                            {log.status === 'simulado' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                <Sparkles size={11} /> Simulado (Dev)
                              </span>
                            )}
                            {log.status === 'falha' && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30"
                                title={log.erro}
                              >
                                <XCircle size={11} /> Falha no Envio
                              </span>
                            )}
                            <span
                              className="text-[9px] text-slate-400 font-mono block truncate max-w-[160px]"
                              title={`Chave Idempotência: ${log.idempotencyKey}`}
                            >
                              key: {log.idempotencyKey}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => setPreviewLog(log)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                            title="Visualizar Prévia do E-mail Enviado"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Previsão de Próximos Alertas (Monitoramento dos Marcos 30d, 15d, 0d) */}
      {activeSubTab === 'upcoming' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar size={18} className="text-blue-400" />
              Previsão de Alertas Agendados
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Esta lista exibe os documentos que estão se aproximando dos marcos de disparo (30 dias, 15 dias e Hoje).
              O serviço de monitoramento no backend avaliará cada um deles e executará o envio automático aos destinatários configurados.
            </p>
          </div>

          <div className="space-y-3">
            {upcomingAlerts.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
                <ShieldCheck size={36} className="text-emerald-500 mx-auto mb-2" />
                <p className="font-semibold text-slate-300">Nenhum documento prestes a vencer!</p>
                <p className="text-xs text-slate-400 mt-0.5">Todos os itens estão regulares com mais de 35 dias de validade.</p>
              </div>
            ) : (
              upcomingAlerts.map((alert, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border transition-all ${
                    alert.marco === 'hoje'
                      ? 'bg-red-950/20 border-red-500/60 shadow-lg shadow-red-950/30'
                      : alert.marco === '15_dias'
                      ? 'bg-orange-950/20 border-orange-500/50'
                      : 'bg-amber-950/15 border-amber-500/40'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {alert.tipoItem}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            alert.marco === 'hoje'
                              ? 'bg-red-600 text-white animate-pulse'
                              : alert.marco === '15_dias'
                              ? 'bg-orange-950/80 text-orange-300 border border-orange-500/60'
                              : 'bg-amber-950/70 text-amber-300 border border-amber-500/40'
                          }`}
                        >
                          Marco: {alert.marcoDescricao}
                        </span>
                        {alert.jaDisparado && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 size={11} /> Já Disparado
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white">{alert.documentoTitulo}</h4>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Empresa: <strong className="text-slate-100">{alert.empresaNome}</strong>
                        {alert.colaboradorNome && ` • Colaborador: ${alert.colaboradorNome}`}
                      </p>

                      <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-3 flex-wrap">
                        <span>
                          Vencimento: <strong className="text-amber-400 font-mono">{formatDateBR(alert.dataVencimento)}</strong>
                        </span>
                        <span>
                          Dias Restantes:{' '}
                          <strong className={alert.diasRestantes <= 0 ? 'text-red-400' : 'text-amber-300'}>
                            {alert.diasRestantes === 0 ? 'VENCE HOJE' : `${alert.diasRestantes} dias`}
                          </strong>
                        </span>
                        <span>
                          Regras:{' '}
                          <span className="text-slate-300 font-medium">{alert.regrasAplicaveis.join(', ')}</span>
                        </span>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <p className="text-[10px] text-slate-400 uppercase font-semibold">Destinatários Notificados:</p>
                      <div className="flex sm:justify-end flex-wrap gap-1 mt-1 max-w-[260px]">
                        {alert.destinatariosPrevistos.map((dest, i) => (
                          <span
                            key={i}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 truncate"
                          >
                            {dest}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Serviço SMTP & Diagnóstico Backend */}
      {activeSubTab === 'smtp' && (
        <div className="space-y-6">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Configuração do Servidor de E-mail (SMTP)</h3>
                  <p className="text-xs text-slate-400">
                    Comunicação real com o servidor de correio eletrônico via Nodemailer e agendamento backend 24/7.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    smtpStatusInfo?.configured
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {smtpStatusInfo?.configured ? '🟢 SMTP Configurado' : '🟡 Credenciais Incompletas no .env'}
                </span>
              </div>
            </div>

            {/* Test connection alert */}
            {connTestResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  connTestResult.connected
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/40 text-red-200'
                }`}
              >
                {connTestResult.connected ? (
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">
                    {connTestResult.connected
                      ? 'Conexão SMTP validada com sucesso!'
                      : 'Falha na conexão SMTP com o servidor'}
                  </p>
                  <p className="text-[11px] mt-0.5 opacity-90">{connTestResult.message}</p>
                </div>
              </div>
            )}

            {smtpFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  smtpFeedback.success
                    ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
                    : 'bg-red-950/40 border-red-500/40 text-red-200'
                }`}
              >
                <Info size={15} className="shrink-0" />
                <span>{smtpFeedback.text}</span>
              </div>
            )}

            {/* SMTP Form */}
            <form onSubmit={handleSaveSmtpConfig} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Servidor SMTP (Host) *
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="Ex: smtp.gmail.com ou smtp.office365.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Host de envio do seu provedor</p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Porta SMTP *</label>
                  <input
                    type="text"
                    required
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587 ou 465"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Geralmente 587 (TLS/STARTTLS) ou 465 (SSL)</p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Usuário / E-mail de Envio *
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="notificacoes.sst@gmail.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">E-mail ou nome de usuário da conta SMTP</p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Senha / Senha de App *
                  </label>
                  <input
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Para contas Gmail, utilize uma &quot;Senha de App&quot; de 16 caracteres.
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Remetente Exibido (From) *
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpFrom}
                    onChange={(e) => setSmtpFrom(e.target.value)}
                    placeholder='Gestão SST <notificacoes.sst@gmail.com>'
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Nome e e-mail que aparecem para o destinatário</p>
                </div>

                <div className="flex items-center gap-3 pt-6">
                  <label className="relative flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-0"
                    />
                    <span className="text-slate-300 font-medium">Conexão Segura Direta SSL (Porta 465)</span>
                  </label>
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestConnectionOnly}
                  disabled={testingConnection}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} className={testingConnection ? 'animate-spin' : ''} />
                  <span>{testingConnection ? 'Testando Conexão...' : 'Testar Conexão com Servidor'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTestResult(null);
                      setIsTestEmailModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-950/60 hover:bg-blue-900/60 text-blue-300 border border-blue-500/30 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <Send size={13} />
                    <span>Disparar E-mail de Teste</span>
                  </button>

                  <button
                    type="submit"
                    disabled={savingSmtp}
                    className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {savingSmtp && <RefreshCw size={13} className="animate-spin" />}
                    <span>{savingSmtp ? 'Salvando...' : 'Salvar e Validar SMTP'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Quick Guide Card */}
          <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-3">
            <h4 className="font-bold text-slate-200 flex items-center gap-2">
              <Info size={15} className="text-blue-400" />
              Orientações para Provedores de E-mail
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-400 text-[11px] leading-relaxed">
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-semibold text-slate-200 mb-1">Google Gmail</p>
                <p>1. Ative a verificação em duas etapas na sua conta Google.</p>
                <p>2. Acesse Segurança &gt; Senhas de App e crie uma senha para o Gestão SST.</p>
                <p className="mt-1 font-mono text-blue-300">Host: smtp.gmail.com | Porta: 587</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-semibold text-slate-200 mb-1">Microsoft 365 / Outlook</p>
                <p>1. Utilize o host oficial do Office365 com autenticação moderna ou SMTP Auth.</p>
                <p className="mt-1 font-mono text-blue-300">Host: smtp.office365.com | Porta: 587</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-semibold text-slate-200 mb-1">Amazon SES / SendGrid</p>
                <p>1. Crie credenciais dedicadas de API SMTP.</p>
                <p>2. Verifique o domínio ou e-mail remetente no painel do provedor.</p>
                <p className="mt-1 font-mono text-blue-300">Porta: 587 (TLS) ou 465 (SSL)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Criar / Editar Regra de Notificação */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders size={18} className="text-blue-400" />
                {editingRuleId ? 'Editar Regra de Notificação' : 'Nova Regra de Notificação'}
              </h3>
              <button
                onClick={() => setIsRuleModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
              {/* Rule Name */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nome da Regra *</label>
                <input
                  type="text"
                  required
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Ex: Alerta Diretoria e Engenharia SST"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Multi-recipient Tag Input */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Destinatários (Múltiplos e-mails) *
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="email"
                    value={ruleEmailInput}
                    onChange={(e) => setRuleEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddEmail();
                      }
                    }}
                    placeholder="Digite um e-mail e clique em Adicionar"
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddEmail}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                  >
                    Adicionar
                  </button>
                </div>

                {/* Email Chips */}
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 min-h-[44px]">
                  {ruleEmails.length === 0 ? (
                    <span className="text-slate-400 text-[11px]">Nenhum e-mail adicionado ainda.</span>
                  ) : (
                    ruleEmails.map((email, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-xs font-mono"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(email)}
                          className="hover:text-red-400 ml-0.5"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Filters: Company, Employee, Category */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Company Filter */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Empresa</label>
                  <select
                    value={ruleCompanyId}
                    onChange={(e) => setRuleCompanyId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="todas">Todas as Empresas</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nomeFantasia || c.razaoSocial}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Employee Filter */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Colaborador</label>
                  <select
                    value={ruleEmployeeId}
                    onChange={(e) => setRuleEmployeeId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="todos">Todos os Colaboradores</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nomeCompleto}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category Filter */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Categoria Documental</label>
                  <select
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="todas">Todas as Categorias</option>
                    <option value="Documento Empresarial">Documentos Empresariais</option>
                    <option value="Documento Individual">Documentos Individuais</option>
                    <option value="ASO">ASO / Exames Ocupacionais</option>
                    <option value="Treinamento">Treinamentos / NRs</option>
                    <option value="Documento Ambiental">Licenças Ambientais</option>
                  </select>
                </div>
              </div>

              {/* Milestones Checkboxes (30d, 15d, 0d) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Marcos de Disparo Automático *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleMilestones.includes('30_dias')}
                      onChange={(e) => {
                        if (e.target.checked) setRuleMilestones([...ruleMilestones, '30_dias']);
                        else setRuleMilestones(ruleMilestones.filter((m) => m !== '30_dias'));
                      }}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-amber-400 block text-xs">⏳ 30 Dias Antes</span>
                      <span className="text-[10px] text-slate-400">Aviso inicial preventivo</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleMilestones.includes('15_dias')}
                      onChange={(e) => {
                        if (e.target.checked) setRuleMilestones([...ruleMilestones, '15_dias']);
                        else setRuleMilestones(ruleMilestones.filter((m) => m !== '15_dias'));
                      }}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-orange-400 block text-xs">⚠️ 15 Dias Antes</span>
                      <span className="text-[10px] text-slate-400">Atenção crítica</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleMilestones.includes('hoje')}
                      onChange={(e) => {
                        if (e.target.checked) setRuleMilestones([...ruleMilestones, 'hoje']);
                        else setRuleMilestones(ruleMilestones.filter((m) => m !== 'hoje'));
                      }}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-red-400 block text-xs">🚨 Data Vencimento</span>
                      <span className="text-[10px] text-slate-400">Na própria data (0d)</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div>
                  <span className="font-semibold text-white block">Status da Regra</span>
                  <span className="text-[11px] text-slate-400">
                    Ative ou desative o disparo automático para esta regra
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setRuleActive(!ruleActive)}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
                    ruleActive
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {ruleActive ? 'Ativada' : 'Desativada'}
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  {editingRuleId ? 'Salvar Alterações' : 'Criar Regra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Teste de Disparo de E-mail */}
      {isTestEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Send size={18} className="text-blue-400" />
                Testar Disparo de E-mail
              </h3>
              <button
                onClick={() => setIsTestEmailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendTestEmail} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Destinatário do Teste *</label>
                <input
                  type="email"
                  required
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="seu-email@dominio.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nota de Teste (Opcional)</label>
                <input
                  type="text"
                  value={testEmailNote}
                  onChange={(e) => setTestEmailNote(e.target.value)}
                  placeholder="Ex: Testando envio de alerta para validação do SESMT"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    testResult.success
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                      : 'bg-red-950/40 border-red-500/50 text-red-300'
                  }`}
                >
                  <p className="font-bold">{testResult.success ? '✅ Disparo realizado com sucesso' : '❌ Falha no disparo'}</p>
                  <p className="text-[11px] mt-0.5">{testResult.message}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsTestEmailModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={sendingTest}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  {sendingTest && <RefreshCw size={13} className="animate-spin" />}
                  <span>{sendingTest ? 'Enviando...' : 'Enviar Agora'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DISPARAR E-MAIL (Exclusivo Administrador) */}
      {isCustomEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Mail size={18} className="text-blue-400" />
                Disparar E-mail (Comunicação SESMT / EHS)
              </h3>
              <button
                onClick={() => setIsCustomEmailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Envio real de e-mails para empresas contratadas, colaboradores ou equipes de SST via servidor SMTP.
            </p>

            {customEmailResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  customEmailResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                    : 'bg-red-950/40 border-red-500/50 text-red-300'
                }`}
              >
                {customEmailResult.success ? (
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">{customEmailResult.message}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSendCustomEmail} className="space-y-3.5 text-xs">
              {/* Destinatário(s) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Destinatário(s) *
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="email"
                    value={customToInput}
                    onChange={(e) => setCustomToInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomEmail();
                      }
                    }}
                    placeholder="Digite um e-mail e clique em Adicionar"
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomEmail}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer shrink-0"
                  >
                    Adicionar
                  </button>
                </div>

                {/* Email Chips */}
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800 min-h-[42px]">
                  {customToEmails.length === 0 ? (
                    <span className="text-slate-500 text-[11px] py-1">
                      Nenhum destinatário adicionado. Digite acima e clique em Adicionar.
                    </span>
                  ) : (
                    customToEmails.map((email, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-xs font-mono"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomEmail(email)}
                          className="hover:text-red-400 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Empresa Relacionada */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Empresa Relacionada
                </label>
                <select
                  value={customCompanyId}
                  onChange={(e) => setCustomCompanyId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Geral / Todas as Empresas</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razaoSocial} {c.cnpj ? `(${c.cnpj})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assunto */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Assunto *
                </label>
                <input
                  type="text"
                  required
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  placeholder="Ex: Convocação para Renovação de Treinamento NR-35 / ASO"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              {/* Mensagem */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Mensagem *
                </label>
                <textarea
                  required
                  rows={5}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Escreva a mensagem oficial que será enviada aos destinatários..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Anexar Documentos */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Anexar Documento (Opcional - PDF, Imagens, Documentos)
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer font-medium">
                    <Paperclip size={14} className="text-blue-400" />
                    <span>{customAttachment ? 'Substituir Anexo' : 'Escolher Arquivo'}</span>
                    <input
                      type="file"
                      onChange={handleCustomAttachmentChange}
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx"
                    />
                  </label>

                  {customAttachment && (
                    <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-slate-300">
                      <span className="font-medium truncate max-w-[200px]" title={customAttachment.name}>
                        {customAttachment.name}
                      </span>
                      <span className="text-[10px] text-slate-500">({customAttachment.size})</span>
                      <button
                        type="button"
                        onClick={() => setCustomAttachment(null)}
                        className="text-slate-400 hover:text-red-400"
                        title="Remover anexo"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCustomEmailModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCustomEmail}
                  className="px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingCustomEmail && <RefreshCw size={13} className="animate-spin" />}
                  <span>{isSubmittingCustomEmail ? 'Enviando...' : 'Disparar E-mail Agora'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Visualizar Prévia do E-mail */}
      {previewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Eye size={18} className="text-blue-400" />
                  Prévia do E-mail Disparado
                </h3>
                <p className="text-[11px] text-slate-400">
                  Enviado em {formatDateBR(previewLog.dataHora.split('T')[0])} para {previewLog.destinatarios.join(', ')}
                </p>
              </div>
              <button
                onClick={() => setPreviewLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Rendered HTML preview inside iframe or sanitized container */}
            <div className="flex-1 overflow-y-auto p-2 bg-slate-950 rounded-xl border border-slate-800 custom-scrollbar">
              <iframe
                title="Email Preview"
                srcDoc={buildNotificationHtml({
                  to: previewLog.destinatarios,
                  documentTitle: previewLog.documentoTitulo,
                  category: previewLog.categoria,
                  companyName: previewLog.empresaNome,
                  employeeName: previewLog.colaboradorNome,
                  expirationDate: previewLog.dataVencimento || '',
                  daysRemaining: previewLog.diasRestantes ?? 15,
                  milestone: (previewLog.marco === 'hoje' || previewLog.marco === '15_dias' || previewLog.marco === '30_dias') ? previewLog.marco : '15_dias',
                })}
                className="w-full h-[450px] border-none rounded-lg"
              />
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono text-[11px]">Chave: {previewLog.idempotencyKey}</span>
              <button
                onClick={() => setPreviewLog(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold"
              >
                Fechar Prévia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
