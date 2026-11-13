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
  Bold,
  Italic,
  Link2,
  List,
  UserPlus,
  Lock,
  Eraser,
  CheckSquare,
  Square,
  EyeOff,
} from 'lucide-react';
import { useSST } from '../../context/SSTContext';
import { useAuth } from '../../context/AuthContext';
import {
  NotificationConfig,
  NotificationDispatchType,
  NotificationLog,
  NotificationMilestone,
  NotificationRecipientDetail,
  SmtpSessionConfig,
  UpcomingExpirationAlert,
} from '../../types/sst';
import { formatDateBR, getDaysRemaining } from '../../utils/trafficLight';
import { buildNotificationHtml } from '../../utils/notificationTemplate';

function formatPreviewBodyHtml(raw: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>'
  );
  text = text.replace(
    /(?<!href=")(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" style="color: #38bdf8; text-decoration: underline;">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\n/g, '<br/>');
  return text;
}

export const NotificationsView: React.FC = () => {
  const {
    notificationConfigs,
    notificationLogs,
    companies,
    employees,
    userProfiles,
    documents,
    trainings,
    exams,
    environmentalDocs,
    addNotificationConfig,
    updateNotificationConfig,
    deleteNotificationConfig,
    triggerNotificationCheck,
    sendTestNotificationEmail,
    sendCustomNotificationEmail,
  } = useSST();

  const { isAdmin, profile, apiToken, authorizedFetch } = useAuth();

  // Active Tab: 'config' | 'history' | 'upcoming' | 'smtp'
  const [activeSubTab, setActiveSubTab] = useState<'config' | 'history' | 'upcoming' | 'smtp'>('config');

  // Search & Filter in Logs
  const [logSearch, setLogSearch] = useState('');
  const [logMilestoneFilter, setLogMilestoneFilter] = useState<'todos' | NotificationMilestone | 'teste' | 'recalculo' | 'avulso'>('todos');
  const [logTypeFilter, setLogTypeFilter] = useState<'todos' | NotificationDispatchType>('todos');
  const [logCompanyFilter, setLogCompanyFilter] = useState('todas');
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'todos' | 'sucesso' | 'falha' | 'simulado'>('todos');

  // Trigger State
  const [runningCheck, setRunningCheck] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    dispatched: number;
    skippedDuplicates: number;
    totalEvaluated: number;
    message: string;
    isError?: boolean;
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
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(null);

  // Modal: Test Email
  const [isTestEmailModalOpen, setIsTestEmailModalOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailMessage, setTestEmailMessage] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    detail?: string;
    status?: string;
  } | null>(null);

  // Modal: ENVIAR E-MAIL AVULSO (Manual Custom BCC Dispatch - Administrator Exclusive)
  const [isCustomEmailModalOpen, setIsCustomEmailModalOpen] = useState(false);
  const [customToInput, setCustomToInput] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<NotificationRecipientDetail[]>([]);
  const [customCompanyId, setCustomCompanyId] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [customAttachment, setCustomAttachment] = useState<{ name: string; dataUrl: string; size: string } | null>(null);
  const [isSubmittingCustomEmail, setIsSubmittingCustomEmail] = useState(false);
  const [customEmailResult, setCustomEmailResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCompanyFilter, setPickerCompanyFilter] = useState('todas');
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [linkTextInput, setLinkTextInput] = useState('');
  const [linkUrlInput, setLinkUrlInput] = useState('https://');
  const [isCustomPreviewOpen, setIsCustomPreviewOpen] = useState(false);
  const customMessageRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Tab 4 & Session SMTP Configuration State (never written to .env or Firestore)
  const [smtpStatusInfo, setSmtpStatusInfo] = useState<{
    configured: boolean;
    envConfigured?: boolean;
    source?: string;
    mode: string;
    hostConfigured: boolean;
    hostLabel: string;
    port: string;
    secure: boolean;
    userConfigured: boolean;
    userMasked: string;
    passConfigured: boolean;
    fromConfigured: boolean;
    missingVars?: string[];
  } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ connected: boolean; message: string } | null>(null);

  const [smtpForm, setSmtpForm] = useState<SmtpSessionConfig>(() => {
    try {
      const raw = sessionStorage.getItem('gestao_sst_smtp_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          host: parsed.host || '',
          port: parsed.port || '587',
          secure: Boolean(parsed.secure),
          user: parsed.user || '',
          pass: parsed.pass || '',
          from: parsed.from || '',
        };
      }
    } catch {
      // Ignore storage errors
    }
    return {
      host: '',
      port: '587',
      secure: false,
      user: '',
      pass: '',
      from: '',
    };
  });
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpSaveResult, setSmtpSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showInlineSmtpInTestModal, setShowInlineSmtpInTestModal] = useState(false);

  const hasLocalSmtpConfig = Boolean(smtpForm.host.trim() && smtpForm.user.trim() && smtpForm.pass);
  const effectiveSmtpConfigured = Boolean(smtpStatusInfo?.configured || hasLocalSmtpConfig);

  const applySmtpPreset = (preset: 'gmail' | 'outlook' | 'brevo' | 'sendgrid') => {
    setSmtpSaveResult(null);
    if (preset === 'gmail') {
      setSmtpForm((prev) => ({ ...prev, host: 'smtp.gmail.com', port: '587', secure: false }));
    } else if (preset === 'outlook') {
      setSmtpForm((prev) => ({ ...prev, host: 'smtp.office365.com', port: '587', secure: false }));
    } else if (preset === 'brevo') {
      setSmtpForm((prev) => ({ ...prev, host: 'smtp-relay.brevo.com', port: '587', secure: false }));
    } else if (preset === 'sendgrid') {
      setSmtpForm((prev) => ({ ...prev, host: 'smtp.sendgrid.net', port: '587', secure: false, user: prev.user || 'apikey' }));
    }
  };

  const persistSessionSmtpLocally = (cfg: SmtpSessionConfig | null) => {
    try {
      if (!cfg) {
        sessionStorage.removeItem('gestao_sst_smtp_session');
      } else {
        sessionStorage.setItem('gestao_sst_smtp_session', JSON.stringify(cfg));
      }
    } catch {
      // Ignore storage errors
    }
  };

  // Consolidated searchable directory of registered people with valid emails
  const registeredPeopleDirectory = useMemo<NotificationRecipientDetail[]>(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const map = new Map<string, NotificationRecipientDetail>();

    userProfiles.forEach((u) => {
      const email = (u.email || '').trim().toLowerCase();
      if (email && emailRegex.test(email)) {
        map.set(email, {
          nome: u.nome || email,
          email,
          empresa: u.empresaNome || 'SESMT / Plataforma',
          origem: 'usuario',
          cargoOuPerfil: u.role === 'admin' ? 'Administrador' : u.role === 'solicitante' ? 'Solicitante' : 'Auditor',
        });
      }
    });

    employees.forEach((emp) => {
      const email = (emp.email || '').trim().toLowerCase();
      if (email && emailRegex.test(email) && !map.has(email)) {
        map.set(email, {
          nome: emp.nomeCompleto || email,
          email,
          empresa: emp.empresaNome || 'Empresa não informada',
          origem: 'colaborador',
          cargoOuPerfil: emp.cargo || 'Colaborador',
        });
      }
    });

    companies.forEach((comp) => {
      const email = (comp.email || '').trim().toLowerCase();
      if (email && emailRegex.test(email) && !map.has(email)) {
        map.set(email, {
          nome: comp.responsavelSST || comp.responsavelLegal || comp.razaoSocial,
          email,
          empresa: comp.razaoSocial,
          origem: 'empresa',
          cargoOuPerfil: 'Contato Corporativo',
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [userProfiles, employees, companies]);

  const pickerCompanies = useMemo(() => {
    const set = new Set<string>();
    registeredPeopleDirectory.forEach((p) => {
      if (p.empresa) set.add(p.empresa);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [registeredPeopleDirectory]);

  const filteredDirectory = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return registeredPeopleDirectory.filter((person) => {
      const matchesSearch =
        !q ||
        person.nome.toLowerCase().includes(q) ||
        person.email.toLowerCase().includes(q) ||
        (person.empresa && person.empresa.toLowerCase().includes(q));
      const matchesCompany =
        pickerCompanyFilter === 'todas' || person.empresa === pickerCompanyFilter;
      return matchesSearch && matchesCompany;
    });
  }, [registeredPeopleDirectory, pickerSearch, pickerCompanyFilter]);

  // Fetch SMTP Status (public healthcheck + admin-only safe diagnostics)
  const fetchSmtpHealth = async () => {
    try {
      if (isAdmin) {
        const res = await authorizedFetch('/api/notifications/smtp-status');
        if (res.ok) {
          const data = await res.json();
          if (data.smtp) {
            setSmtpStatusInfo(data.smtp);
            return;
          }
        }
      }
      const res = await fetch('/api/notifications/health');
      if (res.ok) {
        const data = await res.json();
        setSmtpStatusInfo({
          configured: Boolean(data.smtpConfigured),
          mode: data.smtpConfigured ? 'SMTP Real Ativo (Variáveis Netlify)' : 'Aguardando Configuração SMTP no Servidor',
          hostConfigured: Boolean(data.smtpConfigured),
          hostLabel: data.smtpConfigured ? 'Protegido no servidor' : 'Não configurado',
          port: '587 / 465',
          secure: true,
          userConfigured: Boolean(data.smtpConfigured),
          userMasked: data.smtpConfigured ? 'Protegido no servidor' : 'Não configurado',
          passConfigured: Boolean(data.smtpConfigured),
          fromConfigured: Boolean(data.smtpConfigured),
          missingVars: data.smtpConfigured ? [] : ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
        });
      }
    } catch (e) {
      console.warn('Erro ao carregar status SMTP:', e);
    }
  };

  React.useEffect(() => {
    fetchSmtpHealth();
  }, [isAdmin, apiToken]);

  // Modal: Email Preview
  const [previewLog, setPreviewLog] = useState<NotificationLog | null>(null);

  const uniqueLogCompanies = useMemo(() => {
    const set = new Set<string>();
    notificationLogs.forEach((l) => {
      if (l.empresaNome) set.add(l.empresaNome);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [notificationLogs]);

  // Helper to resolve dispatch type for both new and legacy logs
  const resolveDispatchType = (log: NotificationLog): NotificationDispatchType => {
    if (log.tipoEnvio) return log.tipoEnvio;
    if (log.marco === 'teste') return 'teste';
    if (log.marco === 'avulso' || log.marco === 'disparo_manual') return 'avulso';
    return 'automatico';
  };

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return notificationLogs.filter((log) => {
      const searchLower = logSearch.toLowerCase();
      const matchesSearch =
        !logSearch ||
        log.documentoTitulo.toLowerCase().includes(searchLower) ||
        (log.assunto && log.assunto.toLowerCase().includes(searchLower)) ||
        log.empresaNome.toLowerCase().includes(searchLower) ||
        (log.colaboradorNome && log.colaboradorNome.toLowerCase().includes(searchLower)) ||
        (log.usuarioResponsavel && log.usuarioResponsavel.toLowerCase().includes(searchLower)) ||
        log.destinatarios.some((e) => e.toLowerCase().includes(searchLower)) ||
        (log.destinatariosDetalhados &&
          log.destinatariosDetalhados.some(
            (d) => d.nome.toLowerCase().includes(searchLower) || d.email.toLowerCase().includes(searchLower)
          )) ||
        log.idempotencyKey.toLowerCase().includes(searchLower);

      const matchesMilestone = logMilestoneFilter === 'todos' || log.marco === logMilestoneFilter;
      const matchesType = logTypeFilter === 'todos' || resolveDispatchType(log) === logTypeFilter;
      const matchesCompany = logCompanyFilter === 'todas' || log.empresaNome === logCompanyFilter;
      const matchesStatus = logStatusFilter === 'todos' || log.status === logStatusFilter;

      const logDate = (log.dataHora || '').split('T')[0];
      const matchesStart = !logStartDate || (logDate && logDate >= logStartDate);
      const matchesEnd = !logEndDate || (logDate && logDate <= logEndDate);

      return (
        matchesSearch &&
        matchesMilestone &&
        matchesType &&
        matchesCompany &&
        matchesStatus &&
        matchesStart &&
        matchesEnd
      );
    });
  }, [
    notificationLogs,
    logSearch,
    logMilestoneFilter,
    logTypeFilter,
    logCompanyFilter,
    logStartDate,
    logEndDate,
    logStatusFilter,
  ]);

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
        isError: false,
      });
    } catch (err: any) {
      setCheckResult({
        dispatched: 0,
        skippedDuplicates: 0,
        totalEvaluated: 0,
        message: `Falha na verificação: ${err.message || String(err)}`,
        isError: true,
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
    setRuleFormError(null);
    if (!ruleName.trim()) {
      setRuleFormError('Informe o nome da regra de notificação.');
      return;
    }
    if (ruleEmails.length === 0) {
      setRuleFormError('Cadastre ao menos um e-mail destinatário.');
      return;
    }
    if (ruleMilestones.length === 0) {
      setRuleFormError('Selecione ao menos um marco de vencimento (30d, 15d ou Hoje).');
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

  // Custom Bulk Email Handlers ("ENVIAR E-MAIL AVULSO")
  const handleAddManualRecipient = () => {
    const trimmed = customToInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setCustomEmailResult({
        success: false,
        message: 'Informe um endereço de e-mail válido antes de adicionar.',
      });
      return;
    }
    if (!selectedRecipients.some((r) => r.email === trimmed)) {
      const existingPerson = registeredPeopleDirectory.find((p) => p.email === trimmed);
      setSelectedRecipients([
        ...selectedRecipients,
        existingPerson || {
          nome: trimmed.split('@')[0],
          email: trimmed,
          empresa: 'Destinatário Externo / Manual',
          origem: 'manual',
        },
      ]);
      setCustomEmailResult(null);
    }
    setCustomToInput('');
  };

  const handleToggleDirectoryPerson = (person: NotificationRecipientDetail) => {
    const exists = selectedRecipients.some((r) => r.email === person.email);
    if (exists) {
      setSelectedRecipients(selectedRecipients.filter((r) => r.email !== person.email));
    } else {
      setSelectedRecipients([...selectedRecipients, person]);
    }
  };

  const handleSelectAllFiltered = () => {
    const currentEmails = new Set(selectedRecipients.map((r) => r.email));
    const additions = filteredDirectory.filter((p) => !currentEmails.has(p.email));
    setSelectedRecipients([...selectedRecipients, ...additions]);
  };

  const handleDeselectAllFiltered = () => {
    const filteredEmails = new Set(filteredDirectory.map((p) => p.email));
    setSelectedRecipients(selectedRecipients.filter((r) => !filteredEmails.has(r.email)));
  };

  const handleRemoveSelectedRecipient = (emailToRemove: string) => {
    setSelectedRecipients(selectedRecipients.filter((r) => r.email !== emailToRemove));
  };

  const applyFormatting = (type: 'bold' | 'italic' | 'list') => {
    const el = customMessageRef.current;
    const start = el ? el.selectionStart : customMessage.length;
    const end = el ? el.selectionEnd : customMessage.length;
    const selected = customMessage.slice(start, end);
    let replacement = '';
    if (type === 'bold') {
      replacement = `**${selected || 'texto em negrito'}**`;
    } else if (type === 'italic') {
      replacement = `*${selected || 'texto em itálico'}*`;
    } else {
      replacement = selected
        ? selected
            .split('\n')
            .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
            .join('\n')
        : '\n- Item 1\n- Item 2';
    }
    const next = customMessage.slice(0, start) + replacement + customMessage.slice(end);
    setCustomMessage(next);
  };

  const handleInsertLink = () => {
    const cleanUrl = linkUrlInput.trim();
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      return;
    }
    const label = linkTextInput.trim() || cleanUrl;
    const snippet = `[${label}](${cleanUrl})`;
    const el = customMessageRef.current;
    const start = el ? el.selectionStart : customMessage.length;
    const end = el ? el.selectionEnd : customMessage.length;
    setCustomMessage(customMessage.slice(0, start) + snippet + customMessage.slice(end));
    setLinkTextInput('');
    setLinkUrlInput('https://');
    setIsLinkInputOpen(false);
  };

  const handleClearCustomForm = () => {
    setSelectedRecipients([]);
    setCustomToInput('');
    setCustomCompanyId('');
    setCustomSubject('');
    setCustomMessage('');
    setCustomAttachment(null);
    setCustomEmailResult(null);
    setIsLinkInputOpen(false);
  };

  const handleCustomAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setCustomEmailResult({
        success: false,
        message: 'O arquivo selecionado excede o limite máximo permitido de 10 MB.',
      });
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
    if (!isAdmin) return;

    let finalRecipientsList = [...selectedRecipients];
    const trimmedManual = customToInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedManual && emailRegex.test(trimmedManual)) {
      if (!finalRecipientsList.some((r) => r.email === trimmedManual)) {
        finalRecipientsList.push({
          nome: trimmedManual.split('@')[0],
          email: trimmedManual,
          empresa: 'Destinatário Externo / Manual',
          origem: 'manual',
        });
      }
      setSelectedRecipients(finalRecipientsList);
      setCustomToInput('');
    }

    const validRecipients = finalRecipientsList.filter((r) => emailRegex.test(r.email));
    if (validRecipients.length === 0) {
      setCustomEmailResult({
        success: false,
        message: 'Adicione pelo menos um destinatário com e-mail válido antes de enviar.',
      });
      return;
    }

    if (!customSubject.trim()) {
      setCustomEmailResult({
        success: false,
        message: 'O campo Assunto é obrigatório.',
      });
      return;
    }

    if (!customMessage.trim()) {
      setCustomEmailResult({
        success: false,
        message: 'O campo Mensagem é obrigatório.',
      });
      return;
    }

    setIsSubmittingCustomEmail(true);
    setCustomEmailResult(null);

    const selectedCompany = companies.find((c) => c.id === customCompanyId);

    try {
      const data = await sendCustomNotificationEmail({
        to: validRecipients.map((r) => r.email),
        recipientsDetails: validRecipients,
        companyId: customCompanyId || undefined,
        companyName: selectedCompany?.razaoSocial || 'Geral / Todas as Empresas',
        subject: customSubject.trim(),
        message: customMessage.trim(),
        attachmentName: customAttachment?.name,
        attachmentDataUrl: customAttachment?.dataUrl,
        senderName: profile?.nome || 'Administrador EHS',
        senderEmail: profile?.email || undefined,
      });

      if (data.success) {
        setCustomEmailResult({
          success: true,
          message: `E-mail avulso enviado com sucesso em cópia oculta (BCC) para ${validRecipients.length} destinatário(s)!`,
        });
        setTimeout(() => {
          handleClearCustomForm();
        }, 2000);
      } else {
        setCustomEmailResult({
          success: false,
          message: data.message || 'Não foi possível enviar o e-mail avulso.',
          detail: data.error || data.detalhes,
        });
      }
    } catch (err: any) {
      setCustomEmailResult({
        success: false,
        message: 'Não foi possível realizar o envio. Verifique as configurações SMTP e tente novamente.',
        detail: err.message || String(err),
      });
    } finally {
      setIsSubmittingCustomEmail(false);
    }
  };

  // Save & Verify Session SMTP Config (RAM + tab sessionStorage only; never writes .env or Firestore)
  const handleSaveAndVerifySessionSmtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAdmin) return;

    const cleanConfig: SmtpSessionConfig = {
      host: smtpForm.host.trim(),
      port: (smtpForm.port || '587').trim(),
      secure: smtpForm.port.trim() === '465' ? true : smtpForm.port.trim() === '587' ? false : smtpForm.secure,
      user: smtpForm.user.trim(),
      pass: smtpForm.pass,
      from: smtpForm.from.trim(),
    };

    if (!cleanConfig.host || !cleanConfig.user || !cleanConfig.pass) {
      setSmtpSaveResult({
        success: false,
        message: 'Preencha Servidor SMTP (host), Usuário e Senha/Senha de App para validar e ativar o envio real.',
      });
      return;
    }

    setSavingSmtp(true);
    setSmtpSaveResult(null);
    setConnTestResult(null);
    try {
      const res = await authorizedFetch('/api/notifications/save-smtp-config', {
        method: 'POST',
        body: JSON.stringify({ ...cleanConfig, verify: true }),
      });
      const rawText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { success: false, message: `Erro HTTP ${res.status}: ${rawText.slice(0, 200)}` };
      }

      if (res.ok && data?.success) {
        setSmtpForm(cleanConfig);
        persistSessionSmtpLocally(cleanConfig);
        if (data.smtp) setSmtpStatusInfo(data.smtp);
        setSmtpSaveResult({
          success: true,
          message:
            data.message ||
            'Servidor SMTP validado! Os testes de e-mail e envios avulsos agora serão enviados de verdade aos destinatários.',
        });
        setConnTestResult({ connected: true, message: data.message });
      } else {
        setSmtpSaveResult({
          success: false,
          message: data?.message || 'Não foi possível conectar ao servidor SMTP com as credenciais informadas.',
        });
      }
    } catch (err: any) {
      setSmtpSaveResult({
        success: false,
        message: `Erro ao comunicar com o servidor: ${err.message || String(err)}`,
      });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleClearSessionSmtp = async () => {
    if (!isAdmin) return;
    persistSessionSmtpLocally(null);
    setSmtpForm({ host: '', port: '587', secure: false, user: '', pass: '', from: '' });
    setSmtpSaveResult(null);
    setConnTestResult(null);
    try {
      await authorizedFetch('/api/notifications/save-smtp-config', {
        method: 'POST',
        body: JSON.stringify({ clear: true }),
      });
      await fetchSmtpHealth();
    } catch {
      // Ignore clear failure
    }
  };

  // SMTP Connection Test (Admin Only)
  const handleTestConnectionOnly = async () => {
    if (!isAdmin) return;
    setTestingConnection(true);
    setConnTestResult(null);
    try {
      const res = await authorizedFetch('/api/notifications/verify-smtp', {
        method: 'POST',
        body: hasLocalSmtpConfig ? JSON.stringify({ smtpConfig: smtpForm }) : undefined,
      });
      const rawText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {
          connected: false,
          message: `Erro HTTP ${res.status} ao verificar SMTP: ${rawText.slice(0, 200) || res.statusText}`,
        };
      }
      setConnTestResult({
        connected: Boolean(data?.connected),
        message: data?.message || 'Verificação concluída.',
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

  // Handle Immediate Test Email
  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const trimmedEmail = testEmailAddress.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      setTestResult({
        success: false,
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        detail: 'Informe um endereço de e-mail válido (ex: nome@empresa.com).',
      });
      return;
    }

    const activeOverride: SmtpSessionConfig | undefined = hasLocalSmtpConfig
      ? {
          host: smtpForm.host.trim(),
          port: (smtpForm.port || '587').trim(),
          secure: smtpForm.port.trim() === '465' ? true : smtpForm.port.trim() === '587' ? false : smtpForm.secure,
          user: smtpForm.user.trim(),
          pass: smtpForm.pass,
          from: smtpForm.from.trim(),
        }
      : undefined;

    if (!smtpStatusInfo?.configured && !activeOverride) {
      setShowInlineSmtpInTestModal(true);
      setTestResult({
        success: false,
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        detail: 'Preencha abaixo os dados do servidor SMTP (Host, Usuário e Senha/Senha de App) para enviar este e-mail de verdade ao destinatário.',
      });
      return;
    }

    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await sendTestNotificationEmail(
        trimmedEmail,
        testEmailSubject.trim() || undefined,
        testEmailMessage.trim() || undefined,
        profile?.nome || 'Administrador EHS',
        activeOverride
      );
      if (res.success) {
        if (activeOverride) {
          persistSessionSmtpLocally(activeOverride);
          await fetchSmtpHealth();
        }
        setTestResult({
          success: true,
          message:
            res.message ||
            'E-mail de teste enviado com sucesso. Verifique a caixa de entrada do destinatário.',
          detail: [res.detalhes, res.messageId ? `ID: ${res.messageId}` : ''].filter(Boolean).join(' • '),
          status: res.status,
        });
      } else {
        setTestResult({
          success: false,
          message:
            res.message ||
            'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
          detail: res.error || res.detalhes,
          status: res.status,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Não foi possível enviar o e-mail. Verifique as configurações SMTP e os detalhes do erro.',
        detail: err.message || String(err),
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
              <>
                <button
                  onClick={() => {
                    handleClearCustomForm();
                    setIsCustomEmailModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all border border-blue-400/30 cursor-pointer"
                  title="Enviar e-mail avulso em cópia oculta (BCC) para pessoas cadastradas"
                >
                  <Mail size={15} className="text-white" />
                  <span>ENVIAR E-MAIL AVULSO</span>
                </button>

                <button
                  onClick={handleRunCheckNow}
                  disabled={runningCheck}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
                  title="Executa a rotina de monitoramento diário no backend agora"
                >
                  <RefreshCw size={15} className={runningCheck ? 'animate-spin' : ''} />
                  <span>{runningCheck ? 'Verificando...' : 'Executar Verificação Agora'}</span>
                </button>

                <button
                  onClick={() => {
                    setTestResult(null);
                    setTestEmailAddress(profile?.email || '');
                    setTestEmailSubject('');
                    setTestEmailMessage('');
                    setShowInlineSmtpInTestModal(!effectiveSmtpConfigured);
                    setIsTestEmailModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  title="Testar envio imediato de e-mail SMTP"
                >
                  <Send size={14} className="text-blue-400" />
                  <span>ENVIAR E-MAIL DE TESTE</span>
                </button>

                <button
                  onClick={() => {
                    setRuleFormError(null);
                    handleOpenNewRuleModal();
                  }}
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-colors cursor-pointer"
                >
                  <Plus size={15} />
                  <span>Nova Regra</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Live Feedback Toast if check ran */}
        {checkResult && (
          <div
            className={`mt-4 p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 animate-fade-in ${
              checkResult.isError
                ? 'bg-red-950/50 border-red-500/40 text-red-200'
                : 'bg-blue-950/60 border-blue-500/40 text-blue-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {checkResult.isError ? (
                <AlertTriangle size={16} className="text-red-400 shrink-0" />
              ) : (
                <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
              )}
              <div>
                <span className="font-bold text-white">
                  {checkResult.isError ? 'Erro no Monitoramento: ' : 'Resultado do Monitoramento: '}
                </span>
                {checkResult.isError ? (
                  <span>{checkResult.message}</span>
                ) : (
                  <span>
                    {checkResult.dispatched} e-mail(s) disparado(s) • {checkResult.skippedDuplicates} duplicata(s) evitada(s) •{' '}
                    {checkResult.totalEvaluated} documentos avaliados.
                  </span>
                )}
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

        {isAdmin && (
          <button
            onClick={() => setActiveSubTab('smtp')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'smtp'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Server size={14} />
            <span>Serviço SMTP &amp; Netlify</span>
          </button>
        )}
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
                    {confirmDeleteRuleId === rule.id ? (
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-red-300 font-medium">Confirmar exclusão?</span>
                        <button
                          type="button"
                          onClick={() => {
                            deleteNotificationConfig(rule.id);
                            setConfirmDeleteRuleId(null);
                          }}
                          className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold"
                        >
                          Excluir
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRuleId(null)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenEditRuleModal(rule)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                          title="Editar Regra"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteRuleId(rule.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                          title="Excluir Regra"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Histórico de Envios & Auditoria Completa */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {/* Header & Filter Bar */}
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Buscar por assunto, documento, empresa, destinatário ou responsável..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={logTypeFilter}
                  onChange={(e) => setLogTypeFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                >
                  <option value="todos">Todos os Tipos</option>
                  <option value="automatico">⚙️ Automático</option>
                  <option value="avulso">✉️ Avulso (BCC)</option>
                  <option value="teste">🧪 Teste</option>
                </select>

                <select
                  value={logCompanyFilter}
                  onChange={(e) => setLogCompanyFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500 max-w-[200px]"
                >
                  <option value="todas">Todas as Empresas</option>
                  {uniqueLogCompanies.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </select>

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
                  <option value="avulso">✉️ Avulso</option>
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

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-400 flex items-center gap-1">
                  <Filter size={12} /> Período:
                </span>
                <input
                  type="date"
                  value={logStartDate}
                  onChange={(e) => setLogStartDate(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                  aria-label="Data inicial"
                />
                <span className="text-slate-500">até</span>
                <input
                  type="date"
                  value={logEndDate}
                  onChange={(e) => setLogEndDate(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                  aria-label="Data final"
                />
              </div>

              {(logSearch ||
                logTypeFilter !== 'todos' ||
                logCompanyFilter !== 'todas' ||
                logMilestoneFilter !== 'todos' ||
                logStatusFilter !== 'todos' ||
                logStartDate ||
                logEndDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setLogSearch('');
                    setLogTypeFilter('todos');
                    setLogCompanyFilter('todas');
                    setLogMilestoneFilter('todos');
                    setLogStatusFilter('todos');
                    setLogStartDate('');
                    setLogEndDate('');
                  }}
                  className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Eraser size={12} />
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Table of Sent Logs */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Data e Horário</th>
                    <th className="py-3 px-4">Assunto / Documento</th>
                    <th className="py-3 px-4">Empresa &amp; Responsável</th>
                    <th className="py-3 px-4">Tipo / Marco</th>
                    <th className="py-3 px-4">Destinatários</th>
                    <th className="py-3 px-4">Status &amp; Resultado</th>
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
                          Ajuste os filtros ou realize um disparo de teste/avulso/monitoramento.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const dispatchType = resolveDispatchType(log);
                      const recipientsToShow =
                        log.destinatariosDetalhados && log.destinatariosDetalhados.length > 0
                          ? log.destinatariosDetalhados
                          : log.destinatarios.map((email) => ({ nome: email, email }));

                      return (
                        <tr key={log.id} className="hover:bg-slate-850/60 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-mono text-slate-300 font-semibold">
                              {formatDateBR(log.dataHora.split('T')[0])}
                            </span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              {log.dataHora.split('T')[1]?.substring(0, 8)}
                            </span>
                          </td>

                          <td className="py-3 px-4 max-w-[230px]">
                            <span className="font-semibold text-white truncate block" title={log.assunto || log.documentoTitulo}>
                              {log.assunto || log.documentoTitulo}
                            </span>
                            <span className="text-[10px] text-slate-400">{log.categoria}</span>
                            {log.dataVencimento && dispatchType === 'automatico' && (
                              <span className="text-[10px] text-amber-400/90 block font-mono">
                                Venc: {formatDateBR(log.dataVencimento)}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 max-w-[200px]">
                            <span className="text-slate-200 font-medium truncate block">{log.empresaNome}</span>
                            {(log.usuarioResponsavel || log.colaboradorNome) && (
                              <span className="text-[10px] text-slate-400 truncate block">
                                Resp: {log.usuarioResponsavel || log.colaboradorNome}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap space-y-1">
                            <div>
                              {dispatchType === 'teste' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                                  🧪 Teste SMTP
                                </span>
                              )}
                              {dispatchType === 'avulso' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/40">
                                  ✉️ Avulso (BCC)
                                </span>
                              )}
                              {dispatchType === 'automatico' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                  ⚙️ Automático
                                </span>
                              )}
                            </div>

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
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/50">
                                🔄 Recálculo
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 max-w-[230px]">
                            <div className="flex flex-wrap gap-1">
                              {recipientsToShow.slice(0, 3).map((dest, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 truncate max-w-[190px]"
                                  title={`${dest.nome} (${dest.email})`}
                                >
                                  {dest.nome !== dest.email ? `${dest.nome} <${dest.email}>` : dest.email}
                                </span>
                              ))}
                              {recipientsToShow.length > 3 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                  +{recipientsToShow.length - 3} destinatário(s)
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 max-w-[220px]">
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
                                <div>
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30"
                                    title={log.erro}
                                  >
                                    <XCircle size={11} /> Falha no Envio
                                  </span>
                                  {log.erro && (
                                    <p className="text-[10px] text-red-300/90 mt-1 line-clamp-2" title={log.erro}>
                                      {log.erro}
                                    </p>
                                  )}
                                </div>
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
                              title="Visualizar Detalhes e Prévia do E-mail"
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
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

      {/* TAB 4: Serviço SMTP & Diagnóstico Protegido (Netlify Functions) */}
      {activeSubTab === 'smtp' && isAdmin && (
        <div className="space-y-6">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Serviço SMTP &amp; Agendamento Serverless (Netlify)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Credenciais gerenciadas exclusivamente por Variáveis de Ambiente protegidas do Netlify, com execução diária via Netlify Scheduled Function.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    effectiveSmtpConfigured
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {smtpStatusInfo?.envConfigured
                    ? '🟢 SMTP Real Ativo (Servidor)'
                    : effectiveSmtpConfigured
                    ? '🟢 SMTP Real Ativo (Sessão)'
                    : '🟡 Aguardando Configuração SMTP'}
                </span>
              </div>
            </div>

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

            {smtpStatusInfo && !smtpStatusInfo.configured && !hasLocalSmtpConfig && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-100">
                    Envio real aguardando configuração SMTP
                  </p>
                  <p className="text-[11px] mt-0.5 opacity-90">
                    Variáveis de ambiente ausentes no servidor:{' '}
                    <span className="font-mono font-bold text-white">
                      {(smtpStatusInfo.missingVars && smtpStatusInfo.missingVars.length > 0
                        ? smtpStatusInfo.missingVars
                        : ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']
                      ).join(', ')}
                    </span>
                    . Preencha o formulário abaixo para ativar envios reais imediatamente nesta sessão ou defina essas chaves no painel Environment Variables do Netlify.
                  </p>
                </div>
              </div>
            )}

            {/* Interactive Session SMTP Form (Never writes .env or Firestore) */}
            <form onSubmit={handleSaveAndVerifySessionSmtp} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                    <Mail size={15} className="text-blue-400" />
                    Configurar Servidor SMTP para Envios Reais Imediatos
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Credenciais mantidas somente na memória da sessão atual (nunca gravadas em arquivo .env ou no banco Firestore).
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-400 mr-1">Atalhos:</span>
                  <button
                    type="button"
                    onClick={() => applySmtpPreset('gmail')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium cursor-pointer"
                  >
                    Gmail (App Password)
                  </button>
                  <button
                    type="button"
                    onClick={() => applySmtpPreset('outlook')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium cursor-pointer"
                  >
                    Outlook / M365
                  </button>
                  <button
                    type="button"
                    onClick={() => applySmtpPreset('brevo')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium cursor-pointer"
                  >
                    Brevo
                  </button>
                  <button
                    type="button"
                    onClick={() => applySmtpPreset('sendgrid')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium cursor-pointer"
                  >
                    SendGrid
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Servidor SMTP (Host) *</label>
                  <input
                    type="text"
                    value={smtpForm.host}
                    onChange={(e) => setSmtpForm((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder="smtp.gmail.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Porta &amp; Segurança *</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={smtpForm.port}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSmtpForm((prev) => ({
                          ...prev,
                          port: val,
                          secure: val.trim() === '465' ? true : val.trim() === '587' ? false : prev.secure,
                        }));
                      }}
                      placeholder="587"
                      className="w-24 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={smtpForm.secure ? 'ssl' : 'starttls'}
                      onChange={(e) => {
                        const isSsl = e.target.value === 'ssl';
                        setSmtpForm((prev) => ({
                          ...prev,
                          secure: isSsl,
                          port: isSsl ? '465' : '587',
                        }));
                      }}
                      className="flex-1 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="starttls">STARTTLS (587)</option>
                      <option value="ssl">SSL/TLS (465)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Remetente (From)</label>
                  <input
                    type="text"
                    value={smtpForm.from}
                    onChange={(e) => setSmtpForm((prev) => ({ ...prev, from: e.target.value }))}
                    placeholder="Gestão SST <seu-email@dominio.com>"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Usuário / E-mail SMTP *</label>
                  <input
                    type="text"
                    value={smtpForm.user}
                    onChange={(e) => setSmtpForm((prev) => ({ ...prev, user: e.target.value }))}
                    placeholder="seu-email@gmail.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">Senha / Senha de App SMTP *</label>
                  <div className="relative">
                    <input
                      type={showSmtpPass ? 'text' : 'password'}
                      value={smtpForm.pass}
                      onChange={(e) => setSmtpForm((prev) => ({ ...prev, pass: e.target.value }))}
                      placeholder="Para Gmail/M365 com MFA, informe a Senha de App de 16 caracteres"
                      className="w-full pl-3 pr-10 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                      title={showSmtpPass ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              {smtpSaveResult && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    smtpSaveResult.success
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-red-950/40 border-red-500/40 text-red-200'
                  }`}
                >
                  {smtpSaveResult.success ? (
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span>{smtpSaveResult.message}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClearSessionSmtp}
                  disabled={savingSmtp || !hasLocalSmtpConfig}
                  className="px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Eraser size={13} />
                  <span>Limpar Sessão</span>
                </button>

                <button
                  type="submit"
                  disabled={savingSmtp}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-md shadow-emerald-600/20"
                >
                  <RefreshCw size={13} className={savingSmtp ? 'animate-spin' : ''} />
                  <span>{savingSmtp ? 'Validando Conexão...' : 'Validar e Ativar SMTP para Envios Reais'}</span>
                </button>
              </div>
            </form>

            <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 flex items-start gap-2.5">
              <Lock size={16} className="text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white">Proteção de Credenciais em Produção</p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Nenhuma senha ou credencial SMTP é gravada em arquivo .env local ou no banco de dados. Para a rotina automática diária (08:00 UTC), defina as variáveis protegidas no painel do Netlify.
                </p>
              </div>
            </div>

            {/* Safe Masked Diagnostics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Servidor SMTP (SMTP_HOST)</span>
                <span className="font-mono font-semibold text-white mt-1 block">
                  {smtpStatusInfo?.hostConfigured
                    ? smtpStatusInfo.hostLabel
                    : smtpForm.host.trim() || 'Não configurado'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Porta &amp; Segurança (SMTP_PORT / SECURE)</span>
                <span className="font-mono font-semibold text-white mt-1 block">
                  {(smtpStatusInfo?.configured ? smtpStatusInfo.port : smtpForm.port || '587')} •{' '}
                  {(smtpStatusInfo?.configured ? smtpStatusInfo.secure : smtpForm.secure) ? 'SSL/TLS' : 'STARTTLS'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Usuário SMTP (SMTP_USER)</span>
                <span className="font-mono font-semibold text-white mt-1 block">
                  {smtpStatusInfo?.userConfigured
                    ? smtpStatusInfo.userMasked
                    : smtpForm.user.trim() || 'Não configurado'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Senha SMTP (SMTP_PASS)</span>
                <span
                  className={`font-semibold mt-1 block ${
                    smtpStatusInfo?.passConfigured || smtpForm.pass ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {smtpStatusInfo?.envConfigured
                    ? 'Configurada no Servidor'
                    : smtpStatusInfo?.passConfigured || smtpForm.pass
                    ? 'Ativa na Sessão'
                    : 'Pendente'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Remetente (SMTP_FROM)</span>
                <span
                  className={`font-semibold mt-1 block ${
                    smtpStatusInfo?.fromConfigured || smtpForm.from.trim() ? 'text-emerald-400' : 'text-slate-300'
                  }`}
                >
                  {smtpStatusInfo?.fromConfigured || smtpForm.from.trim()
                    ? 'Definido'
                    : 'Usa Usuário SMTP como padrão'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Rotina Automática Diária</span>
                <span className="font-semibold text-blue-300 mt-1 block">
                  Netlify Scheduled Function (08:00 UTC)
                </span>
              </div>
            </div>

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

              <button
                type="button"
                onClick={() => {
                  setTestResult(null);
                  setTestEmailAddress(profile?.email || '');
                  setTestEmailSubject('');
                  setTestEmailMessage('');
                  setShowInlineSmtpInTestModal(!effectiveSmtpConfigured);
                  setIsTestEmailModalOpen(true);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/20 flex items-center gap-2 cursor-pointer"
              >
                <Send size={13} />
                <span>ENVIAR E-MAIL DE TESTE</span>
              </button>
            </div>
          </div>

          {/* Required Netlify Environment Variables Reference */}
          <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-3">
            <h4 className="font-bold text-slate-200 flex items-center gap-2">
              <Info size={15} className="text-blue-400" />
              Variáveis de Ambiente Necessárias no Netlify (Site Settings &gt; Environment Variables)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-slate-400 text-[11px]">
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-mono font-bold text-blue-300">SMTP_HOST</p>
                <p className="mt-1">Servidor SMTP (ex: smtp.gmail.com, smtp.office365.com)</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-mono font-bold text-blue-300">SMTP_PORT / SMTP_SECURE</p>
                <p className="mt-1">Porta 587 (false) ou 465 SSL (true)</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-mono font-bold text-blue-300">SMTP_USER / SMTP_PASS</p>
                <p className="mt-1">Conta de envio e Senha / Senha de App</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                <p className="font-mono font-bold text-blue-300">API_AUTH_SECRET / APP_URL</p>
                <p className="mt-1">Chave de assinatura dos tokens e URL pública do Netlify</p>
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

            {ruleFormError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-400 shrink-0" />
                <span>{ruleFormError}</span>
              </div>
            )}

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

      {/* MODAL: Envio Imediato de E-mail de Teste */}
      {isTestEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Send size={18} className="text-blue-400" />
                Envio Imediato de E-mail de Teste
              </h3>
              <button
                onClick={() => setIsTestEmailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendTestEmail} className="space-y-3.5 text-xs">
              {/* Live SMTP Delivery Status + Inline Config Toggle */}
              <div
                className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                  effectiveSmtpConfigured
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {effectiveSmtpConfigured ? (
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                  )}
                  <span className="text-[11px] font-medium">
                    {effectiveSmtpConfigured
                      ? `Envio real habilitado via ${
                          smtpForm.host.trim() || smtpStatusInfo?.hostLabel || 'SMTP'
                        }`
                      : 'Informe o servidor SMTP abaixo para enviar o e-mail real ao destinatário.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInlineSmtpInTestModal((v) => !v)}
                  className="text-[11px] font-semibold underline text-blue-300 hover:text-blue-200 cursor-pointer"
                >
                  {showInlineSmtpInTestModal ? 'Ocultar SMTP' : 'Configurar / Alterar SMTP'}
                </button>
              </div>

              {showInlineSmtpInTestModal && (
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-700/80 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-bold text-slate-200 text-[11px]">
                      Credenciais SMTP do Remetente (Envio Real)
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applySmtpPreset('gmail')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 border border-slate-700 cursor-pointer"
                      >
                        Gmail
                      </button>
                      <button
                        type="button"
                        onClick={() => applySmtpPreset('outlook')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 border border-slate-700 cursor-pointer"
                      >
                        Outlook
                      </button>
                      <button
                        type="button"
                        onClick={() => applySmtpPreset('brevo')}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 border border-slate-700 cursor-pointer"
                      >
                        Brevo
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] text-slate-400 mb-0.5">Servidor SMTP (Host)</label>
                      <input
                        type="text"
                        value={smtpForm.host}
                        onChange={(e) => setSmtpForm((prev) => ({ ...prev, host: e.target.value }))}
                        placeholder="smtp.gmail.com"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Porta</label>
                      <input
                        type="text"
                        value={smtpForm.port}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSmtpForm((prev) => ({
                            ...prev,
                            port: val,
                            secure: val.trim() === '465' ? true : val.trim() === '587' ? false : prev.secure,
                          }));
                        }}
                        placeholder="587"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-[11px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Usuário / E-mail SMTP</label>
                      <input
                        type="text"
                        value={smtpForm.user}
                        onChange={(e) => setSmtpForm((prev) => ({ ...prev, user: e.target.value }))}
                        placeholder="seu-email@gmail.com"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Senha / Senha de App</label>
                      <div className="relative">
                        <input
                          type={showSmtpPass ? 'text' : 'password'}
                          value={smtpForm.pass}
                          onChange={(e) => setSmtpForm((prev) => ({ ...prev, pass: e.target.value }))}
                          placeholder="Senha de App SMTP"
                          className="w-full pl-2.5 pr-8 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSmtpPass((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showSmtpPass ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Remetente (From - Opcional)</label>
                    <input
                      type="text"
                      value={smtpForm.from}
                      onChange={(e) => setSmtpForm((prev) => ({ ...prev, from: e.target.value }))}
                      placeholder="Gestão SST <seu-email@dominio.com>"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-[11px]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  E-mail destinatário do teste *
                </label>
                <input
                  type="email"
                  required
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="destinatario@empresa.com.br"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Assunto do e-mail (Opcional)
                </label>
                <input
                  type="text"
                  value={testEmailSubject}
                  onChange={(e) => setTestEmailSubject(e.target.value)}
                  placeholder="Teste de Integração SMTP - Gestão SST"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Mensagem de teste (Opcional)
                </label>
                <textarea
                  rows={3}
                  value={testEmailMessage}
                  onChange={(e) => setTestEmailMessage(e.target.value)}
                  placeholder="Mensagem opcional para validar a entrega imediata via SMTP..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {testResult && (
                <div
                  className={`p-3.5 rounded-xl text-xs border space-y-1 ${
                    testResult.success
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                      : 'bg-red-950/40 border-red-500/50 text-red-300'
                  }`}
                >
                  <p className="font-bold flex items-center gap-1.5">
                    {testResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    <span>{testResult.message}</span>
                  </p>
                  {testResult.detail && (
                    <p className="text-[11px] opacity-90 font-mono break-words bg-slate-950/50 p-2 rounded border border-slate-800">
                      Detalhes: {testResult.detail}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
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
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {sendingTest ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                  <span>{sendingTest ? 'Enviando...' : 'ENVIAR E-MAIL DE TESTE'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ENVIAR E-MAIL AVULSO (Exclusivo Administrador - BCC) */}
      {isCustomEmailModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Mail size={18} className="text-blue-400" />
                  ENVIAR E-MAIL AVULSO
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Lock size={12} className="text-emerald-400" />
                  Envio protegido em cópia oculta (BCC): os destinatários não visualizam os endereços uns dos outros.
                </p>
              </div>
              <button
                onClick={() => setIsCustomEmailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

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
                <div className="space-y-1">
                  <p className="font-bold">{customEmailResult.message}</p>
                  {customEmailResult.detail && (
                    <p className="text-[11px] font-mono opacity-90">{customEmailResult.detail}</p>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSendCustomEmail} className="space-y-4 text-xs">
              {/* Destinatários: Lista pesquisável + manual */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-slate-300 font-semibold">
                    Destinatários ({selectedRecipients.length} selecionado(s)) *
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsRecipientPickerOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
                  >
                    <UserPlus size={14} />
                    <span>Selecionar Pessoas Cadastradas ({registeredPeopleDirectory.length})</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={customToInput}
                    onChange={(e) => setCustomToInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddManualRecipient();
                      }
                    }}
                    placeholder="Ou digite um e-mail avulso externo e clique em Adicionar"
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualRecipient}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold cursor-pointer shrink-0"
                  >
                    Adicionar
                  </button>
                </div>

                {/* Selected Recipients Chips (Nome, Empresa, E-mail) */}
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 max-h-36 overflow-y-auto custom-scrollbar min-h-[48px]">
                  {selectedRecipients.length === 0 ? (
                    <span className="text-slate-500 text-[11px] py-1">
                      Nenhum destinatário selecionado. Clique em &quot;Selecionar Pessoas Cadastradas&quot; ou adicione um e-mail acima.
                    </span>
                  ) : (
                    selectedRecipients.map((recipient) => (
                      <span
                        key={recipient.email}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-200 border border-blue-500/30 text-[11px]"
                      >
                        <span className="font-semibold text-white">{recipient.nome}</span>
                        {recipient.empresa && (
                          <span className="text-slate-400">({recipient.empresa})</span>
                        )}
                        <span className="font-mono text-blue-300">&lt;{recipient.email}&gt;</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSelectedRecipient(recipient.email)}
                          className="hover:text-red-400 ml-0.5 cursor-pointer"
                          title="Remover destinatário"
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
                  Empresa Relacionada (Opcional)
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
                <label className="block text-slate-300 font-semibold mb-1">Assunto *</label>
                <input
                  type="text"
                  required
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  placeholder="Ex: Solicitação de Atualização Documental / Comunicado SESMT"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              {/* Mensagem com Barra de Formatação */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="block text-slate-300 font-semibold">Mensagem *</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => applyFormatting('bold')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      title="Negrito (**texto**)"
                    >
                      <Bold size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormatting('italic')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      title="Itálico (*texto*)"
                    >
                      <Italic size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => applyFormatting('list')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      title="Lista com marcadores"
                    >
                      <List size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLinkInputOpen(!isLinkInputOpen)}
                      className={`p-1.5 rounded border ${
                        isLinkInputOpen
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                      title="Inserir link"
                    >
                      <Link2 size={13} />
                    </button>
                  </div>
                </div>

                {isLinkInputOpen && (
                  <div className="mb-2 p-2.5 rounded-lg bg-slate-950 border border-blue-500/40 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={linkTextInput}
                      onChange={(e) => setLinkTextInput(e.target.value)}
                      placeholder="Texto do link (opcional)"
                      className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                    />
                    <input
                      type="url"
                      value={linkUrlInput}
                      onChange={(e) => setLinkUrlInput(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleInsertLink}
                      className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                    >
                      Inserir
                    </button>
                  </div>
                )}

                <textarea
                  ref={customMessageRef}
                  required
                  rows={5}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Escreva o comunicado, orientação ou cobrança de documentos..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Anexar Documento */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Anexar Documento (Opcional - máx. 10 MB)
                </label>
                <div className="flex items-center gap-3 flex-wrap">
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleClearCustomForm}
                  className="px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <Eraser size={13} />
                  <span>Limpar formulário</span>
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsCustomPreviewOpen(true)}
                    disabled={!customSubject.trim() && !customMessage.trim()}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Eye size={13} />
                    <span>Pré-visualizar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsCustomEmailModalOpen(false)}
                    className="px-3.5 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmittingCustomEmail}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    {isSubmittingCustomEmail ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                    <span>{isSubmittingCustomEmail ? 'Enviando...' : 'Enviar e-mail'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Seletor Pesquisável de Destinatários Cadastrados */}
      {isRecipientPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users size={18} className="text-indigo-400" />
                  Selecionar Destinatários Cadastrados
                </h3>
                <p className="text-[11px] text-slate-400">
                  Usuários, colaboradores e contatos empresariais com e-mail válido no Gestão SST.
                </p>
              </div>
              <button
                onClick={() => setIsRecipientPickerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Pesquisar por nome, empresa ou e-mail..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <select
                value={pickerCompanyFilter}
                onChange={(e) => setPickerCompanyFilter(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="todas">Todas as Empresas ({registeredPeopleDirectory.length})</option>
                {pickerCompanies.map((comp) => (
                  <option key={comp} value={comp}>
                    {comp}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
              <span className="text-slate-400">
                Exibindo <strong className="text-white">{filteredDirectory.length}</strong> pessoa(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllFiltered}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  Desmarcar filtrados
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar min-h-[220px]">
              {filteredDirectory.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  Nenhuma pessoa com e-mail válido encontrada para este filtro.
                </div>
              ) : (
                filteredDirectory.map((person) => {
                  const isChecked = selectedRecipients.some((r) => r.email === person.email);
                  return (
                    <button
                      key={person.email}
                      type="button"
                      onClick={() => handleToggleDirectoryPerson(person)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-3 ${
                        isChecked
                          ? 'bg-blue-950/40 border-blue-500/50 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isChecked ? (
                          <CheckSquare size={16} className="text-blue-400 shrink-0" />
                        ) : (
                          <Square size={16} className="text-slate-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {person.nome}{' '}
                            {person.cargoOuPerfil && (
                              <span className="text-[10px] font-normal text-slate-400">
                                • {person.cargoOuPerfil}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">{person.empresa}</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-blue-300 shrink-0">{person.email}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-300">
                <strong className="text-blue-400">{selectedRecipients.length}</strong> destinatário(s) selecionado(s)
              </span>
              <button
                type="button"
                onClick={() => setIsRecipientPickerOpen(false)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold"
              >
                Concluir Seleção
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Pré-visualização do E-mail Avulso */}
      {isCustomPreviewOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Eye size={18} className="text-blue-400" />
                Pré-visualização do E-mail Avulso (BCC)
              </h3>
              <button
                onClick={() => setIsCustomPreviewOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <p>
                  <span className="text-slate-400">Remetente:</span>{' '}
                  <strong className="text-white">{profile?.nome || 'Administrador EHS'}</strong>
                </p>
                <p>
                  <span className="text-slate-400">Destinatários (Cópia Oculta - BCC):</span>{' '}
                  <strong className="text-emerald-400">{selectedRecipients.length} pessoa(s)</strong>
                </p>
                <p>
                  <span className="text-slate-400">Assunto:</span>{' '}
                  <strong className="text-white">{customSubject || '(Sem assunto)'}</strong>
                </p>
                {customAttachment && (
                  <p>
                    <span className="text-slate-400">Anexo:</span>{' '}
                    <span className="text-blue-300 font-mono">{customAttachment.name}</span>
                  </p>
                )}
              </div>

              <div
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 leading-relaxed min-h-[160px] max-h-[320px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: formatPreviewBodyHtml(customMessage) }}
              />
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsCustomPreviewOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs"
              >
                Voltar à Edição
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Visualizar Prévia do E-mail (Histórico) */}
      {previewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Eye size={18} className="text-blue-400" />
                  Detalhes e Prévia do E-mail
                </h3>
                <p className="text-[11px] text-slate-400">
                  Registrado em {formatDateBR(previewLog.dataHora.split('T')[0])} • Destinatário(s):{' '}
                  {previewLog.destinatarios.join(', ')}
                </p>
              </div>
              <button
                onClick={() => setPreviewLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {resolveDispatchType(previewLog) === 'automatico' && previewLog.marco !== 'recalculo' ? (
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
                    milestone:
                      previewLog.marco === 'hoje' ||
                      previewLog.marco === '15_dias' ||
                      previewLog.marco === '30_dias'
                        ? previewLog.marco
                        : '15_dias',
                  })}
                  className="w-full h-[450px] border-none rounded-lg"
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 text-xs">
                <div className="space-y-1 border-b border-slate-800 pb-3">
                  <p>
                    <span className="text-slate-400">Assunto:</span>{' '}
                    <strong className="text-white">{previewLog.assunto || previewLog.documentoTitulo}</strong>
                  </p>
                  <p>
                    <span className="text-slate-400">Empresa:</span>{' '}
                    <span className="text-slate-200">{previewLog.empresaNome}</span>
                  </p>
                  {previewLog.usuarioResponsavel && (
                    <p>
                      <span className="text-slate-400">Responsável:</span>{' '}
                      <span className="text-slate-200">{previewLog.usuarioResponsavel}</span>
                    </p>
                  )}
                </div>
                <div
                  className="text-slate-200 leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: formatPreviewBodyHtml(previewLog.mensagem || 'Sem conteúdo textual registrado.'),
                  }}
                />
                {previewLog.erro && (
                  <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-red-200">
                    <p className="font-bold">Motivo da Falha:</p>
                    <p className="font-mono text-[11px] mt-0.5">{previewLog.erro}</p>
                  </div>
                )}
              </div>
            )}

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
