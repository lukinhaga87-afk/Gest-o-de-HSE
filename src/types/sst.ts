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

export type PasswordRecoveryChannel = 'admin' | 'whatsapp' | 'sms';

export type PasswordRecoveryStatus =
  | 'ativo'
  | 'utilizado'
  | 'expirado'
  | 'bloqueado'
  | 'substituido';

export interface PasswordRecoveryGeneratedResult {
  codeId: string;
  code: string;
  expiresAt: string;
  ttlMinutes: number;
  targetUser: {
    id: string;
    nome: string;
    cpf: string;
    role: UserRole;
  };
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
  dataInicioContrato: string;
  dataTerminoContrato: string;
  situacao: 'ativa' | 'inativa';
  documentosLegais?: {
    nome: string;
    url: string;
    dataValidade?: string;
  }[];
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
  versao: number;
  historicoVersoes?: DocumentVersion[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Training {
  id: string;
  nomeTreinamento: string; // Campo livre e inicialmente em branco
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
export type SafetyPermitStatus = 'elaboracao' | 'aprovado' | 'em_execucao' | 'encerrado' | 'cancelado';

export interface SafetyPermit {
  id: string;
  tipo: SafetyPermitType;
  titulo: string;
  empresaId: string;
  empresaNome: string;
  localTrabalho: string;
  dataInicio: string;
  dataFim: string;
  responsavelEmissao: string;
  riscosIdentificados: string;
  medidasPreventivas: string;
  status: SafetyPermitStatus;
  anexoUrl?: string;
  createdAt?: string;
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

export type NotificationMilestone = '30_dias' | '15_dias' | 'hoje';

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
}

export interface SmartDocInconsistency {
  codigo: string;
  severidade: 'alta' | 'media' | 'baixa';
  campo?: string;
  mensagem: string;
}

export interface SmartDocHistoryEntry {
  dataHora: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioRole: UserRole;
  acao:
    | 'ENVIO_INICIAL'
    | 'PROCESSAMENTO_IA'
    | 'ERRO_PROCESSAMENTO'
    | 'REPROCESSAMENTO_IA'
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
  previewTruncated?: boolean;
  previewIndisponivelMotivo?: string;

  categoriaGrupo: SmartDocCategoryGroup;
  tipoDocumento: string;
  classificacaoManual: boolean;
  classificacaoConfianca: number;

  status: SmartDocProcessingState;
  statusValidade: SmartDocValidityStatus;
  erroLeitura?: string;

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

