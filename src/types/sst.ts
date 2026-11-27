export type UserRole = 'admin' | 'solicitante' | 'auditor';

export type FarolStatus = 'verde' | 'amarelo' | 'vermelho' | 'cinza';

export interface UserProfile {
  id: string;
  cpf?: string; // Número do CPF (Identificador principal de acesso)
  username?: string;
  email: string;
  nome: string;
  role: UserRole;
  empresaId?: string;
  empresaNome?: string;
  empresaIds?: string[]; // Múltiplas empresas vinculadas ao Solicitante (retrocompatível com empresaId)
  cargo?: string;
  telefone?: string;
  passwordHash?: string;
  hashAlgorithm?: 'bcrypt';
  passwordResetRequired?: boolean;
  tokenVersion?: number;
  passwordChangedAt?: string;
  fotoPerfilUrl?: string; // FOTO DE PERFIL persistente
  createdAt?: string;
  updatedAt?: string;
}

export type CompanyChangeRequestStatus = 'pendente' | 'aprovada' | 'recusada';

export type CompanyEditableFields = Pick<
  Company,
  | 'razaoSocial'
  | 'nomeFantasia'
  | 'cnpj'
  | 'responsavelLegal'
  | 'responsavelSST'
  | 'telefone'
  | 'email'
  | 'endereco'
  | 'unidadeAtendimento'
  | 'atividadeContratada'
  | 'dataInicioContrato'
  | 'dataTerminoContrato'
  | 'contrato_indeterminado'
>;

export interface CompanyChangeRequest {
  id: string;
  empresaId: string;
  solicitadoPorId: string;
  solicitadoPorNome: string;
  solicitadoPorEmail?: string;
  dataSolicitacao: string;
  justificativaSolicitante: string;
  dadosAnteriores: Partial<CompanyEditableFields>;
  dadosSolicitados: Partial<CompanyEditableFields>;
  status: CompanyChangeRequestStatus;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  dataAnalise?: string;
  justificativaAnalise?: string;
}

export interface Company {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  responsavelLegal: string;
  responsavelSST: string;
  telefone: string;
  email: string;
  endereco: string;
  unidadeAtendimento: string;
  atividadeContratada: string;
  atividadesAutorizadasIds?: string[]; // IDs de ActivityProfile vinculadas à empresa contratada
  dataInicioContrato: string;
  dataTerminoContrato: string;
  contrato_indeterminado?: boolean;
  situacao: 'ativa' | 'inativa';
  documentosLegais?: {
    nome: string;
    url: string;
    dataValidade?: string;
  }[];
  solicitacoesAlteracao?: CompanyChangeRequest[];
  solicitantesAutorizadosIds?: string[]; // IDs dos Solicitantes autorizados a gerenciar esta empresa
  criadoPorId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SituacaoColaborador = 'ativo' | 'afastado' | 'ferias' | 'demitido';

export interface Employee {
  id: string;
  empresaId: string;
  empresaNome: string;
  nomeCompleto: string;
  cpf: string;
  rg?: string;
  dataNascimento?: string;
  telefone?: string;
  email?: string;
  matricula?: string;
  cargo: string;
  setor: string;
  atividadeExecutada?: string;
  atividadesHabilitadasIds?: string[]; // IDs de ActivityProfile vinculadas ao colaborador terceirizado
  unidadeAlocacao?: string;
  dataAdmissao?: string;
  dataIntegracao?: string;
  responsavelEmpresa?: string;
  situacaoCadastral: SituacaoColaborador;
  fotoUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DocumentCategory =
  | 'Documento Empresarial'
  | 'Documento Individual'
  | 'ASO'
  | 'Treinamento'
  | 'Documento Ambiental'
  | 'Outros';

export type DocumentStatus = 'pendente' | 'aprovado' | 'reprovado' | 'vencido';

export interface DocumentVersion {
  versao: number;
  arquivoUrl: string;
  arquivoNome: string;
  arquivoHashSha256?: string;
  dataEnvio: string;
  responsavelEnvio: string;
  observacoes?: string;
  situacao: DocumentStatus;
  motivoReprovacao?: string;
  analisadoPor?: string;
  dataAnalise?: string;
}

export interface DocumentSST {
  id: string;
  nomeDocumento: string; // Campo livre e inicialmente em branco
  tipoDocumentoCanonico?: string; // Código canônico opcional alinhado ao SmartDocs e à Matriz de Atividades (ex.: PGR, PCMSO, PET, ART_ESCORAMENTO)
  categoria: DocumentCategory | string;
  empresaId: string;
  empresaNome: string;
  colaboradorId?: string;
  colaboradorNome?: string;
  numeroDocumento?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  responsavelEnvio: string;
  arquivoUrl: string;
  arquivoNome: string;
  observacoes?: string;
  situacao: DocumentStatus;
  motivoReprovacao?: string;
  analisadoPor?: string;
  dataAnalise?: string;
  origemEnvio?: 'empresa' | 'colaborador' | 'integracao' | 'admin';
  solicitacaoCodigo?: string;
  versao: number;
  historicoVersoes?: DocumentVersion[];
  /** Nova versão enviada enquanto a versão atual ainda está aprovada e vigente (não invalida a versão vigente até aprovação do Admin EHS). */
  versaoPendente?: PendingDocumentVersion | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PendingDocumentVersion {
  versao: number;
  arquivoUrl: string;
  arquivoNome: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusao?: ConclusaoAptidao;
  observacoes?: string;
  responsavelEnvio: string;
  dataEnvio: string;
  situacao: DocumentStatus;
}

export interface Training {
  id: string;
  nomeTreinamento: string; // Campo livre e inicialmente em branco
  tipoDocumentoCanonico?: string; // Código canônico opcional alinhado ao SmartDocs e à Matriz de Atividades (ex.: NR-35, NR-33, NR-10, NR-18, NR-23)
  colaboradorId: string;
  colaboradorNome: string;
  empresaId: string;
  empresaNome: string;
  instituicaoResponsavel?: string;
  instrutor?: string;
  dataRealizacao: string;
  cargaHoraria?: string;
  dataValidade?: string;
  semValidade?: boolean;
  certificadoUrl?: string;
  certificadoNome?: string;
  observacoes?: string;
  situacao: DocumentStatus;
  motivoReprovacao?: string;
  analisadoPor?: string;
  dataAnalise?: string;
  versao?: number;
  historicoVersoes?: DocumentVersion[];
  versaoPendente?: PendingDocumentVersion | null;
  createdAt?: string;
  updatedAt?: string;
}

export type TipoExame =
  | 'ASO Admissional'
  | 'ASO Periódico'
  | 'ASO Retorno ao Trabalho'
  | 'ASO Mudança de Riscos Ocupacionais'
  | 'ASO Demissional'
  | 'Exame Complementar'
  | string;

export type ConclusaoAptidao = 'apto' | 'inapto' | 'apto_com_restricoes';

export interface OccupationalExam {
  id: string;
  tipoExame: TipoExame;
  tipoDocumentoCanonico?: string; // Código canônico opcional alinhado ao SmartDocs e à Matriz de Atividades (ex.: ASO)
  aptidoesEspecificas?: string[]; // Aptidões específicas declaradas no ASO (ex.: trabalho_altura, espaco_confinado, eletricidade)
  colaboradorId: string;
  colaboradorNome: string;
  empresaId: string;
  empresaNome: string;
  dataRealizacao: string;
  dataValidade?: string;
  semValidade?: boolean;
  medicoResponsavel?: string;
  crmMedico?: string;
  conclusao: ConclusaoAptidao;
  anexoUrl?: string;
  anexoNome?: string;
  observacoes?: string;
  situacao: DocumentStatus;
  motivoReprovacao?: string;
  analisadoPor?: string;
  dataAnalise?: string;
  versao?: number;
  historicoVersoes?: DocumentVersion[];
  versaoPendente?: PendingDocumentVersion | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EPIDelivery {
  id: string;
  colaboradorId: string;
  colaboradorNome: string;
  empresaId: string;
  empresaNome: string;
  nomeEpi: string;
  caNumero: string;
  dataEntrega: string;
  quantidade: number;
  responsavelEntrega: string;
  assinaturaUrl?: string;
  comprovanteNome?: string;
  observacoes?: string;
  createdAt?: string;
}

export type SafetyPermitType = 'APR' | 'PT' | 'LOTO';
export type SafetyPermitStatus =
  | 'elaboracao' // 1. Rascunho / Em Elaboração (retrocompatível)
  | 'pendente_liberacao' // 2. Solicitação Enviada (retrocompatível)
  | 'em_analise' // 3. Em Análise pelo Admin EHS
  | 'pendente_documentacao' // 4. Pendente de Documentação
  | 'pendente_correcao' // 5. Pendente de Correção
  | 'aprovado' // 6. Aprovada (retrocompatível)
  | 'liberado' // 7. Liberada para Execução
  | 'em_execucao' // Execução em campo (legado retrocompatível)
  | 'reprovado' // 8. Reprovada
  | 'cancelado' // 9. Cancelada (retrocompatível)
  | 'encerrado'; // 10. Encerrada (retrocompatível)

export type OperationalControlAttachmentType = 'APR' | 'PT' | 'LOTO' | 'PET';

export interface SafetyPermitOperationalControls {
  exigeAPR: boolean;
  exigePT: boolean;
  exigeLOTO: boolean;
  exigePET: boolean;
}

export interface SafetyPermitControlAttachment {
  tipo: OperationalControlAttachmentType;
  nomeArquivo: string;
  url: string;
  enviadoEm?: string;
  enviadoPorNome?: string;
}

export interface SafetyPermitWorkflowHistoryEntry {
  dataHora: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioRole: UserRole;
  acao: string;
  statusAnterior: SafetyPermitStatus | null;
  statusNovo: SafetyPermitStatus;
  justificativa?: string;
}

export interface SafetyPermitEmployeeSnapshot {
  id: string;
  nomeCompleto: string;
  cargo: string;
  cpf?: string;
}

export interface ActivityComplianceSnapshot {
  avaliadoEm: string;
  statusGeral: ActivityComplianceOverallStatus;
  podeLiberar: boolean;
  totalRequisitosAvaliados: number;
  conformes: number;
  alertasAVencer: number;
  pendentesAprovacao: number;
  bloqueiosObrigatorios: number;
  motivosBloqueio: string[];
}

export interface SafetyPermit {
  id: string;
  tipo: SafetyPermitType;
  titulo: string;
  descricaoServico?: string;
  empresaId: string;
  empresaNome: string;
  localTrabalho: string;
  dataInicio: string;
  dataFim: string;
  responsavelEmissao: string;
  responsavelAtividade?: string;
  riscosIdentificados: string;
  medidasPreventivas: string;
  observacoes?: string;
  status: SafetyPermitStatus;
  anexoUrl?: string;
  controlesOperacionais?: SafetyPermitOperationalControls;
  anexosControles?: SafetyPermitControlAttachment[];
  // Campos opcionais para Gestão de Terceiros e Liberação de Atividades
  atividadeIds?: string[];
  atividadeNomes?: string[];
  colaboradorIds?: string[];
  colaboradoresSnapshot?: SafetyPermitEmployeeSnapshot[];
  statusConformidade?: ActivityComplianceOverallStatus;
  pendenciasObrigatoriasCount?: number;
  pendenciasAlertaCount?: number;
  snapshotValidacao?: ActivityComplianceSnapshot;
  solicitadoPorId?: string;
  solicitadoPorNome?: string;
  solicitadoPorRole?: UserRole;
  dataSolicitacao?: string;
  aprovadoPorId?: string;
  aprovadoPorNome?: string;
  dataAprovacao?: string;
  liberadoPorId?: string;
  liberadoPorNome?: string;
  liberadoPorRole?: 'admin';
  dataLiberacao?: string;
  motivoBloqueioOuRejeicao?: string;
  motivoCorrecao?: string;
  justificativaDecisao?: string;
  versaoConcorrencia?: number;
  complianceFingerprint?: string;
  validadoServerSide?: boolean;
  historicoWorkflow?: SafetyPermitWorkflowHistoryEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Inspection {
  id: string;
  tipo: 'inspecao' | 'auditoria';
  titulo: string;
  local: string;
  data: string;
  auditor: string;
  empresaAuditadaId?: string;
  empresaAuditadaNome?: string;
  conformidades: number;
  naoConformidades: number;
  observacoes: string;
  status: 'planejada' | 'concluida' | 'pendente_acao';
  createdAt?: string;
}

export interface ActionPlanComment {
  id: string;
  autor: string;
  autorCpf?: string;
  dataHora: string;
  texto: string;
}

export type ActionPlanStatus =
  | 'concluido'
  | 'pendente'
  | 'cancelada'
  | 'a_iniciar'
  | 'em_andamento'
  | 'atrasado';

export interface ActionPlan {
  id: string;
  origem: string;
  descricaoAcao: string;
  responsavel: string;
  prazo: string;
  status: ActionPlanStatus;
  empresaId?: string;
  empresaNome?: string;
  observacoes?: string;
  evidenciaUrl?: string;
  comentarios?: ActionPlanComment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EnvironmentalDoc {
  id: string;
  nome: string;
  orgaoEmissor: string;
  numeroLicenca: string;
  dataEmissao: string;
  dataValidade?: string;
  semValidade?: boolean;
  situacao: 'valido' | 'em_renovacao' | 'vencido';
  anexoUrl?: string;
  createdAt?: string;
}

export interface AuditLog {
  id: string;
  usuario: string;
  usuarioEmail: string;
  acao: string;
  entidade: string;
  entidadeId?: string;
  detalhes: string;
  dataHora: string;
}

export type NotificationMilestone = '30_dias' | '15_dias' | '7_dias' | 'hoje' | 'vencido';

export type InAppNotificationRecipientRole = 'admin' | 'solicitante' | 'all_solicitantes';
export type InAppNotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type InAppNotificationType =
  | 'INTEGRACAO_ENVIADA'
  | 'INTEGRACAO_REENVIADA'
  | 'INTEGRACAO_APROVADA'
  | 'INTEGRACAO_REPROVADA'
  | 'INTEGRACAO_AGUARDANDO_COMPLEMENTACAO'
  | 'INTEGRACAO_AGUARDANDO_DECISAO'
  | 'DOCUMENTO_APROVADO'
  | 'DOCUMENTO_REJEITADO'
  | 'DOCUMENTO_CORRIGIDO'
  | 'NOVA_EXIGENCIA_DOCUMENTAL'
  | 'DOCUMENTO_PROXIMO_VENCIMENTO'
  | 'DOCUMENTO_VENCIDO'
  | 'COLABORADOR_PENDENTE'
  | 'NOVA_CONTRATADA'
  | 'COMUNICADO_ADM';

export interface InAppNotification {
  id: string;
  recipientRole: InAppNotificationRecipientRole;
  recipientUserId?: string;
  empresaId?: string;
  empresaNome?: string;
  type: InAppNotificationType;
  severity: InAppNotificationSeverity;
  title: string;
  message: string;
  actionLabel?: string;
  actionTab?: string;
  integrationId?: string;
  companyId?: string;
  employeeId?: string;
  documentId?: string;
  read: boolean;
  readAt?: string;
  readByUserIds?: string[];
  createdById?: string;
  createdByNome?: string;
  createdByRole?: UserRole | 'sistema';
  idempotencyKey: string;
  isDemo?: boolean;
  createdAt: string;
}

export type NotificationDispatchType = 'teste' | 'automatico' | 'avulso';

export interface NotificationRecipientDetail {
  nome: string;
  email: string;
  empresa?: string;
  origem?: 'usuario' | 'colaborador' | 'empresa' | 'manual';
  cargoOuPerfil?: string;
}

export interface NotificationConfig {
  id: string;
  nomeRegra: string;
  destinatarios: string[];
  empresaId?: string; // ID da empresa ou 'todas'
  empresaNome?: string;
  colaboradorId?: string; // ID do colaborador ou 'todos'
  colaboradorNome?: string;
  categoria?: string; // 'todas' ou categoria específica
  marcos: NotificationMilestone[];
  ativo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type NotificationStatus = 'sucesso' | 'falha' | 'simulado';

export interface NotificationLog {
  id: string;
  dataHora: string;
  tipoEnvio?: NotificationDispatchType;
  destinatarios: string[];
  destinatariosDetalhados?: NotificationRecipientDetail[];
  documentoId: string;
  documentoTitulo: string;
  assunto?: string;
  categoria: string;
  empresaNome: string;
  empresaId?: string;
  colaboradorNome?: string;
  usuarioResponsavel?: string;
  marco: NotificationMilestone | 'teste' | 'recalculo' | 'disparo_manual' | 'avulso';
  dataVencimento?: string;
  diasRestantes?: number;
  status: NotificationStatus;
  mensagem?: string;
  erro?: string;
  idempotencyKey: string;
  recalculado?: boolean;
  createdAt?: string;
}

export interface UpcomingExpirationAlert {
  documentoId: string;
  documentoTitulo: string;
  tipoItem: 'Documento' | 'Treinamento' | 'Exame/ASO' | 'Licença Ambiental';
  categoria: string;
  empresaNome: string;
  empresaId?: string;
  colaboradorNome?: string;
  colaboradorId?: string;
  dataVencimento: string;
  diasRestantes: number;
  marco: NotificationMilestone;
  marcoDescricao: string;
  destinatariosPrevistos: string[];
  regrasAplicaveis: string[];
  jaDisparado: boolean;
  ultimaNotificacao?: string;
}

export interface SmtpSessionConfig {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

// ============================================================================
// EHS SMARTDOCS – LEITURA INTELIGENTE DE DOCUMENTOS
// ============================================================================

export type SmartDocProcessingState =
  | 'AGUARDANDO_PROCESSAMENTO'
  | 'PROCESSANDO'
  | 'PROCESSADO'
  | 'ERRO_LEITURA'
  | 'PENDENTE_APROVACAO'
  | 'APROVADO'
  | 'REJEITADO';

export type SmartDocValidityStatus =
  | 'REGULAR'
  | 'A_VENCER'
  | 'VENCIDO'
  | 'SEM_VALIDADE_DEFINIDA'
  | 'PENDENTE_APROVACAO'
  | 'REJEITADO';

export type SmartDocCategoryGroup =
  | 'saude_ocupacional'
  | 'treinamentos'
  | 'documentos_empresariais'
  | 'outros';

export interface SmartDocExtractedData {
  nomeDocumento?: string;
  nomeColaborador?: string;
  cpf?: string;
  empresa?: string;
  cnpj?: string;
  dataRealizacao?: string;
  dataEmissao?: string;
  dataRevisao?: string;
  dataValidade?: string;
  validadeExplicitaNoDocumento?: boolean;
  validadeOrigem?: 'documento' | 'regra_configurada' | 'manual' | 'nao_identificada';
  semValidade?: boolean;

  // ASO / Saúde ocupacional
  funcao?: string;
  tipoExame?: string;
  resultadoAptidao?: 'apto' | 'inapto' | 'apto_com_restricoes' | '';
  medicoResponsavel?: string;
  crm?: string;

  // Treinamentos e capacitações
  nomeTreinamento?: string;
  nrCorrespondente?: string;
  cargaHoraria?: string;
  nomeInstrutor?: string;
  registroProfissionalInstrutor?: string;
  instituicaoEmissora?: string;

  // Documentos empresariais
  razaoSocial?: string;
  unidade?: string;
  numeroDocumento?: string;
  responsavelTecnico?: string;
  registroProfissionalRT?: string;

  resumoConteudo?: string;
  observacoes?: string;
  observacoesIA?: string[];
  qualidadeLeitura?: 'alta' | 'media' | 'baixa' | 'ilegivel';
  documentoIlegivel?: boolean;
  documentoIncompleto?: boolean;
  ocrAplicado?: boolean;
  tabelasExtraidasResumo?: string;
}

export interface SmartDocDiagnosticsReport {
  geminiKeyConfigured: boolean;
  geminiKeyStatus: 'ok' | 'missing' | 'placeholder' | 'malformed' | 'oauth_token_not_supported';
  authSecretConfigured: boolean;
  primaryModel: string;
  fallbackModel: string | null;
  authMode: 'api_key_x_goog_api_key';
  endpoint: 'https://generativelanguage.googleapis.com/';
  runtime: 'netlify_functions' | 'node_server';
  backendStatus: 'online';
  connectionStatus: 'connected' | 'error' | 'not_tested' | 'key_missing';
  lastTestedAt: string | null;
  lastModelTested: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
}

export interface SmartDocInconsistency {
  codigo: string;
  severidade: 'alta' | 'media' | 'baixa';
  campo?: string;
  mensagem: string;
}

export interface SmartDocProcessingAttempt {
  tentativa: number;
  dataHora: string;
  modelo: string;
  fallbackModelo: boolean;
  origem: 'inicial' | 'automatica_503' | 'manual_reprocessamento' | 'versao_corrigida';
  sucesso: boolean;
  codigoHttp?: number;
  codigoErro?: string;
  retryable?: boolean;
  duracaoMs: number;
  mensagem: string;
}

export interface SmartDocHistoryEntry {
  dataHora: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioRole: UserRole;
  acao:
    | 'ENVIO_INICIAL'
    | 'INICIO_PROCESSAMENTO'
    | 'RESULTADO_OCR'
    | 'PROCESSAMENTO_IA'
    | 'ERRO_PROCESSAMENTO'
    | 'REPROCESSAMENTO_IA'
    | 'TENTATIVA_AUTOMATICA'
    | 'MODELO_FALLBACK'
    | 'VERSAO_CORRIGIDA'
    | 'EDICAO_MANUAL'
    | 'APROVACAO'
    | 'SOLICITACAO_CORRECAO'
    | 'REJEICAO'
    | 'ACESSO_MEDICO_LGPD';
  detalhes: string;
  camposAlterados?: string[];
}

export interface SmartDocValidityRule {
  id: string;
  tipoDocumento: string;
  mesesValidade: number;
  ativo: boolean;
  observacao?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SmartDocRecord {
  id: string;
  arquivoNome: string;
  arquivoMimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  arquivoTamanhoBytes: number;
  arquivoHashSha256: string;
  arquivoUrl?: string;
  hasPreservedFile?: boolean;
  fileStorageMode?: 'inline' | 'chunked';
  chunkCount?: number;
  previewTruncated?: boolean;
  previewIndisponivelMotivo?: string;

  categoriaGrupo: SmartDocCategoryGroup;
  tipoDocumento: string;
  classificacaoManual: boolean;
  classificacaoConfianca: number;

  status: SmartDocProcessingState;
  statusValidade: SmartDocValidityStatus;
  erroLeitura?: string;
  erroCodigo?: string;
  erroRetryable?: boolean;
  tentativasCount?: number;
  ultimoModeloUsado?: string;
  fallbackModeloUtilizado?: boolean;
  tentativasHistorico?: SmartDocProcessingAttempt[];

  empresaId?: string;
  empresaNome?: string;
  empresaMatchMetodo?: 'cnpj' | 'nome' | 'manual' | 'nao_vinculada' | 'ambiguo';
  colaboradorId?: string;
  colaboradorNome?: string;
  colaboradorMatchMetodo?: 'cpf' | 'nome' | 'manual' | 'nao_vinculado' | 'ambiguo';

  dadosExtraidos: SmartDocExtractedData;
  camposNaoIdentificados: string[];
  inconsistencias: SmartDocInconsistency[];

  isSensitiveMedical: boolean;
  lgpdRedacted?: boolean;

  enviadoPorId: string;
  enviadoPorNome: string;
  enviadoPorEmail: string;
  dataEnvio: string;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  dataAnalise?: string;
  correcaoSolicitada?: boolean;
  motivoCorrecao?: string;
  motivoRejeicao?: string;

  integratedCollection?: 'exams' | 'trainings' | 'documents';
  integratedDocId?: string;

  historico: SmartDocHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// GESTÃO DE TERCEIROS — MATRIZ DE ATIVIDADES E DOCUMENTOS OBRIGATÓRIOS
// ============================================================================

export type ActivityRiskLevel = 'baixo' | 'medio' | 'alto' | 'critico';

export type ActivityRequirementScope = 'empresa' | 'colaborador' | 'atividade_pt';

export type ActivityRequirementSourceCollection =
  | 'documents'
  | 'trainings'
  | 'exams'
  | 'epiDeliveries'
  | 'safetyPermits';

export type ActivityRequirementComplianceStatus =
  | 'CONFORME'
  | 'A_VENCER'
  | 'PENDENTE_APROVACAO'
  | 'VENCIDO'
  | 'REPROVADO'
  | 'ASO_INAPTO'
  | 'AUSENTE';

export type ActivityComplianceOverallStatus = 'conforme' | 'atencao' | 'bloqueado';

export interface ActivityProfile {
  id: string;
  codigo: string; // Ex.: TRABALHO_ALTURA, ESPACO_CONFINADO, SERVICOS_ELETRICOS, TRABALHO_QUENTE, ESCAVACAO
  nome: string;
  descricao: string;
  nivelRisco: ActivityRiskLevel;
  riscosAssociados: string[];
  normasAplicaveis: string[];
  exigeAPR: boolean;
  exigePT: boolean;
  exigeLOTO: boolean;
  exigePET?: boolean;
  templateOrigem?: string; // Identificador do template inicial (editável pelo Admin EHS)
  ativo: boolean;
  criadoPorId: string;
  criadoPorNome?: string;
  atualizadoPorId?: string;
  atualizadoPorNome?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivityDocumentRequirement {
  id: string;
  activityId: string;
  activityCodigo?: string;
  nomeExibicao: string;
  descricao?: string;
  documentoCodigoCanonico: string; // Ex.: NR-35, NR-33, NR-10, NR-18, NR-23, ASO, PGR, PCMSO, APR, PT, PET, LOTO
  palavrasChaveMatch: string[]; // Termos normalizados para reconhecimento de documentos legados em texto livre
  escopo: ActivityRequirementScope;
  origemColecao: ActivityRequirementSourceCollection;
  funcoesAplicaveis: string[]; // Vazio = todos os terceirizados executantes; preenchido = filtra por cargo/função
  exigeAptoASO?: boolean;
  aptidaoEspecifica?: string; // Ex.: trabalho_altura, espaco_confinado, eletricidade
  validadePadraoMeses?: number;
  obrigatorioParaLiberacao: boolean;
  baseLegal?: string;
  ordemExibicao?: number;
  templateOrigem?: string; // Editável pelo Admin EHS
  ativo: boolean;
  criadoPorId: string;
  criadoPorNome?: string;
  atualizadoPorId?: string;
  atualizadoPorNome?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivityComplianceItemResult {
  requirementId: string;
  activityId: string;
  activityIds?: string[];
  activityNome: string;
  nomeExibicao: string;
  documentoCodigoCanonico: string;
  escopo: ActivityRequirementScope;
  origemColecao: ActivityRequirementSourceCollection;
  obrigatorioParaLiberacao: boolean;
  baseLegal?: string;
  colaboradorId?: string;
  colaboradorNome?: string;
  colaboradorCargo?: string;
  status: ActivityRequirementComplianceStatus;
  bloqueante: boolean;
  motivo: string;
  matchedRecordId?: string;
  matchedCollection?: ActivityRequirementSourceCollection | 'smartDocs';
  matchedTitulo?: string;
  dataEmissao?: string;
  dataValidade?: string;
  diasRestantes?: number | null;
  pendenteSmartDocId?: string;
}

export interface EmployeeActivityComplianceSummary {
  colaboradorId: string;
  colaboradorNome: string;
  cargo: string;
  situacaoCadastral: SituacaoColaborador;
  statusGeral: ActivityComplianceOverallStatus;
  aptoParaExecucao: boolean;
  itens: ActivityComplianceItemResult[];
  totalObrigatorios: number;
  conformesCount: number;
  alertasCount: number;
  bloqueiosCount: number;
  pendentesAprovacaoCount: number;
}

export interface ActivityComplianceResult {
  empresaId: string;
  empresaNome: string;
  contratoVigente: boolean;
  contratoIndeterminado: boolean;
  contratoMensagem: string;
  atividadeIds: string[];
  atividadeNomes: string[];
  statusGeral: ActivityComplianceOverallStatus;
  podeLiberar: boolean;
  avaliadoEm: string;
  itensEmpresa: ActivityComplianceItemResult[];
  itensAtividade: ActivityComplianceItemResult[];
  colaboradores: EmployeeActivityComplianceSummary[];
  resumo: {
    totalRequisitosAvaliados: number;
    conformes: number;
    alertasAVencer: number;
    pendentesAprovacao: number;
    bloqueiosObrigatorios: number;
    ausentes: number;
    vencidosOuReprovados: number;
  };
  motivosBloqueio: string[];
}

// ============================================================================
// CENTRAL DE INTEGRAÇÃO DE TERCEIROS (NORMALIZADO / PREPARADO PARA DATAVERSE)
// ============================================================================

export type IntegrationType = 'INTEGRACAO_INICIAL' | 'ATUALIZACAO_DOCUMENTAL';

export type IntegrationWorkflowStatus =
  | 'RASCUNHO'
  | 'PENDENTE_DOCUMENTACAO'
  | 'EM_ENVIO'
  | 'ENVIADA'
  | 'AGUARDANDO_ANALISE'
  | 'EM_ANALISE'
  | 'PENDENTE_CORRECAO'
  | 'REENVIADA'
  | 'APROVADA'
  | 'REPROVADA'
  | 'ENCERRADA';

export type IntegrationItemStatus =
  | 'PENDENTE_ENVIO'
  | 'ENVIADO'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REPROVADO'
  | 'SUBSTITUIDO';

export type IntegrationItemCategory = 'empresa' | 'colaborador' | 'atividade_critica';

export type IntegrationOfficialCollection = 'documents' | 'trainings' | 'exams' | 'epiDeliveries';

export type IntegrationDocumentGroupId =
  | 'pessoais_legais'
  | 'saude_ocupacional'
  | 'seguranca_trabalho'
  | 'vinculo_empregaticio'
  | 'atividade_simples';

export type SimpleActivityStatus =
  | 'PENDENTE_ANALISE'
  | 'APROVADA'
  | 'RECUSADA'
  | 'COMPLEMENTACAO_SOLICITADA';

export interface SimpleActivityHistoryEntry {
  dataHora: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioRole: UserRole;
  acao:
    | 'CRIACAO_ATIVIDADE_SIMPLES'
    | 'ATUALIZACAO_ATIVIDADE_SIMPLES'
    | 'DOCUMENTO_ADICIONADO'
    | 'APROVACAO_ATIVIDADE_SIMPLES'
    | 'RECUSA_ATIVIDADE_SIMPLES'
    | 'SOLICITACAO_COMPLEMENTACAO';
  statusAnterior: SimpleActivityStatus | null;
  statusNovo: SimpleActivityStatus;
  detalhes: string;
  justificativa?: string;
}

export interface SimpleActivityDocumentInput {
  nomeDocumento: string;
  documentoCodigoCanonico?: string;
  escopo?: 'empresa' | 'colaborador';
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  obrigatorio?: boolean;
  observacoes?: string;
}

export interface SimpleActivityEntry {
  id: string;
  empresaId?: string;
  integrationId?: string;
  nome: string;
  descricaoServico: string;
  observacoes?: string;
  status: SimpleActivityStatus;
  criadoPorId: string;
  criadoPorNome: string;
  criadoPorRole: UserRole;
  criadoEm: string;
  atualizadoEm: string;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  dataAnalise?: string;
  justificativaAnalise?: string;
  historico: SimpleActivityHistoryEntry[];
}

export type IntegrationFileStorageProvider =
  | 'local_private'
  | 'memory'
  | 'firebase_storage'
  | 'gcs'
  | 'azure_blob'
  | 'legacy_inline';

export interface IntegrationSmartDocsSuggestion {
  processadoEm: string;
  smartDocId?: string;
  tipoDocumentoSugerido?: string;
  categoriaGrupoSugerida?: SmartDocCategoryGroup;
  nomeDocumentoSugerido?: string;
  nomeColaboradorSugerido?: string;
  cpfSugerido?: string;
  empresaSugerida?: string;
  cnpjSugerido?: string;
  dataEmissaoSugerida?: string;
  dataValidadeSugerida?: string;
  semValidadeSugerida?: boolean;
  resultadoAptidaoSugerido?: ConclusaoAptidao | '';
  confianca?: number;
  qualidadeLeitura?: 'alta' | 'media' | 'baixa' | 'ilegivel';
  documentoIlegivel?: boolean;
  documentoIncompleto?: boolean;
  alertas?: string[];
  modeloUtilizado?: string;
  erroLeitura?: string;
}

export interface IntegrationDocumentVersion {
  versao: number;
  arquivoId?: string;
  storageProvider?: IntegrationFileStorageProvider;
  storageKey?: string;
  arquivoNome: string;
  arquivoMimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  arquivoTamanhoBytes: number;
  arquivoHashSha256: string;
  arquivoUrl?: string;
  hasStoredFile?: boolean;
  smartDocId?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusaoAso?: ConclusaoAptidao;
  aptidoesEspecificas?: string[];
  observacoes?: string;
  enviadoPorId: string;
  enviadoPorNome: string;
  enviadoEm: string;
  status: Exclude<IntegrationItemStatus, 'PENDENTE_ENVIO'>;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  analisadoEm?: string;
  motivoReprovacao?: string;
  smartDocsSugestao?: IntegrationSmartDocsSuggestion;
}

export interface IntegrationWorkflowHistoryEntry {
  dataHora: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioRole: UserRole;
  acao: string;
  statusAnterior: IntegrationWorkflowStatus | IntegrationItemStatus | null;
  statusNovo: IntegrationWorkflowStatus | IntegrationItemStatus;
  itemId?: string;
  detalhes: string;
  justificativa?: string;
}

export interface IntegrationCompanyRequest {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  responsavelLegal: string;
  responsavelSST: string;
  telefone: string;
  email: string;
  endereco: string;
  unidadeAtendimento: string;
  atividadeContratada: string;
  dataInicioContrato: string;
  dataTerminoContrato: string;
  contrato_indeterminado?: boolean;
  aprovadoCompanyId?: string;
}

export interface IntegrationEmployeeCandidate {
  candidateId: string;
  colaboradorId?: string;
  nomeCompleto: string;
  cpf: string;
  cargo: string;
  setor: string;
  telefone?: string;
  email?: string;
  atividadeExecutada?: string;
  atividadesHabilitadasIds: string[];
  jaExistiaNaBase: boolean;
  aprovadoEmployeeId?: string;
}

export interface ContractorIntegrationItem {
  id: string;
  integrationId: string;
  empresaId?: string;
  empresaNome: string;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  colaboradorNome?: string;
  colaboradorCpf?: string;
  colaboradorCargo?: string;
  categoria: IntegrationItemCategory;
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  requirementId?: string;
  activityId?: string;
  activityNome?: string;
  simpleActivityId?: string;
  simpleActivityNome?: string;
  documentoCodigoCanonico: string;
  nomeExibicao: string;
  origemColecao: IntegrationOfficialCollection;
  obrigatorio: boolean;
  exigeAptoASO?: boolean;
  aptidaoEspecifica?: string;
  baseLegal?: string;
  status: IntegrationItemStatus;
  versaoAtual: number;
  versoes: IntegrationDocumentVersion[];
  arquivoId?: string;
  storageProvider?: IntegrationFileStorageProvider;
  storageKey?: string;
  hasStoredFile?: boolean;
  arquivoNome?: string;
  arquivoMimeType?: 'application/pdf' | 'image/jpeg' | 'image/png';
  arquivoTamanhoBytes?: number;
  arquivoHashSha256?: string;
  arquivoUrl?: string;
  smartDocId?: string;
  dataEmissao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  numeroDocumento?: string;
  conclusaoAso?: ConclusaoAptidao;
  aptidoesEspecificas?: string[];
  observacoes?: string;
  smartDocsSugestao?: IntegrationSmartDocsSuggestion;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  dataAnalise?: string;
  motivoReprovacao?: string;
  officialCollection?: IntegrationOfficialCollection;
  officialRecordId?: string;
  /** True quando o requisito foi automaticamente atendido por um documento oficial aprovado, vigente e disponível no armazenamento. */
  reaproveitado?: boolean;
  reaproveitadoDe?: IntegrationDocumentReuseSource;
  /** Diagnóstico do documento já existente na base centralizada para este requisito. */
  situacaoDocumentoExistente?: DocumentReuseResolutionState;
  documentoExistenteAviso?: string;
  documentoExistenteId?: string;
  documentoExistenteColecao?: IntegrationOfficialCollection;
  enviadoPorId?: string;
  enviadoPorNome?: string;
  dataEnvio?: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentReuseResolutionState =
  | 'REAPROVEITADO_VALIDO'
  | 'PENDENTE_APROVACAO'
  | 'RECUSADO'
  | 'VENCIDO'
  | 'ARQUIVO_INDISPONIVEL'
  | 'AUSENTE';

export interface IntegrationDocumentReuseSource {
  colecao: IntegrationOfficialCollection;
  registroId: string;
  versao?: number;
  aprovadoPor?: string;
  dataAprovacao?: string;
  dataValidade?: string;
  semValidade?: boolean;
  storageKey?: string;
  arquivoNome?: string;
}

export interface IntegrationReusePreviewItem {
  categoria: IntegrationItemCategory;
  colaboradorId?: string;
  colaboradorNome?: string;
  documentoCodigoCanonico: string;
  nomeExibicao: string;
  origemColecao: IntegrationOfficialCollection;
  obrigatorio: boolean;
  situacao: DocumentReuseResolutionState;
  reaproveitado: boolean;
  aviso?: string;
  arquivoNome?: string;
  dataValidade?: string;
  semValidade?: boolean;
  officialRecordId?: string;
  motivoReprovacao?: string;
  simpleActivityId?: string;
  simpleActivityNome?: string;
}

export interface IntegrationReusePreviewResult {
  empresaId: string;
  empresaNome: string;
  totalRequisitos: number;
  reaproveitadosAprovados: number;
  pendentesAprovacao: number;
  ausentes: number;
  vencidos: number;
  recusados: number;
  itens: IntegrationReusePreviewItem[];
}

export interface ContractorIntegrationSummaryCounts {
  total: number;
  obrigatorios: number;
  pendentesEnvio: number;
  enviados: number;
  emAnalise: number;
  aprovados: number;
  reprovados: number;
  substituidos: number;
}

export interface IntegrationPendingDocumentInfo {
  itemId: string;
  documentoCodigoCanonico: string;
  nomeExibicao: string;
  categoria: IntegrationItemCategory;
  categoriaOrganizacional?: IntegrationDocumentGroupId;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  colaboradorNome?: string;
  status: IntegrationItemStatus;
  motivo: string;
  motivoReprovacao?: string;
}

export interface IntegrationCollaboratorReadiness {
  colaboradorKey: string;
  colaboradorId?: string;
  colaboradorCandidateId?: string;
  colaboradorNome: string;
  completo: boolean;
  totalObrigatorios: number;
  obrigatoriosConfirmados: number;
  obrigatoriosPendentes: number;
  totalOpcionais: number;
  opcionaisEnviados: number;
  pendencias: IntegrationPendingDocumentInfo[];
}

export interface IntegrationSubmissionReadiness {
  podeSubmeter: boolean;
  totalItens: number;
  totalObrigatorios: number;
  obrigatoriosConfirmados: number;
  obrigatoriosPendentes: number;
  totalOpcionais: number;
  opcionaisEnviados: number;
  /** Contadores consolidados da Etapa 4 (Resumo Único de Entrega Documental). */
  reaproveitadosAprovados?: number;
  novosEnviados?: number;
  pendentesAprovacaoExistentes?: number;
  recusados?: number;
  atualizacaoNecessaria?: number;
  pendenciasObrigatorias: IntegrationPendingDocumentInfo[];
  porColaborador?: IntegrationCollaboratorReadiness[];
  resumoBloqueio?: string;
}

export interface ContractorIntegration {
  id: string;
  codigoProtocolo: string;
  tipo: IntegrationType;
  status: IntegrationWorkflowStatus;
  empresaId?: string;
  empresaNome: string;
  empresaCnpj: string;
  solicitacaoNovaEmpresa?: IntegrationCompanyRequest;
  empresaPendenteCadastro?: boolean;
  atividadeIds: string[];
  atividadeNomes: string[];
  atividadesSimples?: SimpleActivityEntry[];
  colaboradorIds: string[];
  colaboradoresCandidatos: IntegrationEmployeeCandidate[];
  observacoes?: string;
  solicitadoPorId: string;
  solicitadoPorNome: string;
  solicitadoPorEmail: string;
  solicitadoPorRole: UserRole;
  dataCriacao: string;
  dataEnvio?: string;
  dataUltimaAtualizacao: string;
  analisadoPorId?: string;
  analisadoPorNome?: string;
  dataAnalise?: string;
  aprovadoPorId?: string;
  aprovadoPorNome?: string;
  dataAprovacao?: string;
  motivoReprovacaoOuDevolucao?: string;
  itensPendentesCorrecao?: IntegrationPendingDocumentInfo[];
  resumoItens: ContractorIntegrationSummaryCounts;
  versaoConcorrencia: number;
  historicoWorkflow: IntegrationWorkflowHistoryEntry[];
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MirroredIntegrationDocumentItem extends ContractorIntegrationItem {
  codigoProtocolo: string;
  protocoloStatus: IntegrationWorkflowStatus;
  protocoloTipo: IntegrationType;
  empresaCnpj: string;
  solicitadoPorNome: string;
  protocoloDataEnvio?: string;
  protocoloDataUltimaAtualizacao: string;
}


