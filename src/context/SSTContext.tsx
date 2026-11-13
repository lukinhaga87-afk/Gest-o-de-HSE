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
} from '../types/sst';
import { INITIAL_COMPANIES, INITIAL_EMPLOYEES } from '../utils/initialData';

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
  loading: boolean;
  // CRUD actions
  addCompany: (comp: Omit<Company, 'id'>) => Promise<string>;
  updateCompany: (id: string, comp: Partial<Company>) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

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

  seedInitialBenchmarkData: () => Promise<void>;
}

const SSTContext = createContext<SSTContextType | undefined>(undefined);

export const SSTProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, activeRole, activeEmpresaId, isAdmin, authorizedFetch } = useAuth();

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
  const [loading, setLoading] = useState(true);

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
    const docRef = await addDoc(colRef, {
      ...comp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Criação', 'Empresa', docRef.id, `Cadastrada empresa ${comp.razaoSocial} (CNPJ: ${comp.cnpj})`);
    return docRef.id;
  };

  const updateCompany = async (id: string, comp: Partial<Company>) => {
    const docRef = doc(db, 'companies', id);
    await updateDoc(docRef, {
      ...comp,
      updatedAt: new Date().toISOString(),
    });
    await logAudit('Atualização', 'Empresa', id, `Atualizados dados da empresa ${comp.razaoSocial || id}`);
  };

  const deleteCompany = async (id: string) => {
    const comp = companies.find((c) => c.id === id);
    await deleteDoc(doc(db, 'companies', id));
    await logAudit('Exclusão', 'Empresa', id, `Excluída empresa ${comp?.razaoSocial || id}`);
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
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('O motivo da reprovação é obrigatório.');
    }
    const current = documents.find((d) => d.id === id);
    const docRef = doc(db, 'documents', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';

    const updatedVersions = (current?.historicoVersoes || []).map((v) =>
      v.versao === current?.versao
        ? { ...v, situacao: 'reprovado' as DocumentStatus, motivoReprovacao: motivo, analisadoPor, dataAnalise }
        : v
    );

    await updateDoc(docRef, {
      situacao: 'reprovado',
      motivoReprovacao: motivo,
      analisadoPor,
      dataAnalise,
      historicoVersoes: updatedVersions,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Reprovação',
      'Documento',
      id,
      `Documento "${current?.nomeDocumento}" reprovado por ${analisadoPor}. Justificativa: ${motivo}`
    );
  };

  const deleteDocument = async (id: string) => {
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
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('O motivo da reprovação é obrigatório.');
    }
    const trn = trainings.find((t) => t.id === id);
    const docRef = doc(db, 'trainings', id);
    const dataAnalise = new Date().toISOString();
    const analisadoPor = profile?.nome || 'Administrador SST';
    await updateDoc(docRef, {
      situacao: 'reprovado',
      motivoReprovacao: motivo,
      analisadoPor,
      dataAnalise,
      updatedAt: dataAnalise,
    });
    await logAudit(
      'Reprovação',
      'Treinamento',
      id,
      `Treinamento "${trn?.nomeTreinamento}" reprovado por ${analisadoPor}. Justificativa: ${motivo}`
    );
  };

  const deleteTraining = async (id: string) => {
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

  const deleteExam = async (id: string) => {
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
        notificationConfigs,
        notificationLogs,
        loading,
        addCompany,
        updateCompany,
        deleteCompany,
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
