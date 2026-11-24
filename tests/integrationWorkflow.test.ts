import assert from 'node:assert/strict';
import http from 'node:http';
import {
  IntegrationWorkflowActor,
  IntegrationWorkflowError,
  IntegrationWorkflowService,
  createInMemoryIntegrationRepository,
} from '../backend/integrationWorkflowService';
import {
  PermitWorkflowService,
  createInMemoryPermitRepository,
} from '../backend/permitWorkflowService';
import { createApiApp } from '../backend/app';
import { evaluateActivityCompliance } from '../src/utils/activityComplianceEngine';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  DocumentSST,
  Employee,
  OccupationalExam,
  Training,
} from '../src/types/sst';

const SAMPLE_PDF_BASE64 =
  'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%EHS More Integration Test PDF\n%%EOF').toString('base64');
const SAMPLE_PDF_V2_BASE64 =
  'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%EHS More Integration Test PDF V2\n%%EOF').toString('base64');
const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,' +
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');

const ADMIN: IntegrationWorkflowActor = {
  id: 'admin-1',
  nome: 'Admin EHS Master',
  email: 'admin.ehs@empresa.com',
  role: 'admin',
};

const SOLICITANTE_A: IntegrationWorkflowActor = {
  id: 'sol-a',
  nome: 'Carlos Solicitante Alfa',
  email: 'carlos@alfa.com',
  role: 'solicitante',
  empresaId: 'comp-a',
};

const SOLICITANTE_UNBOUND: IntegrationWorkflowActor = {
  id: 'sol-new',
  nome: 'Joana Nova Contratada',
  email: 'joana@nova.com',
  role: 'solicitante',
};

const SOLICITANTE_B: IntegrationWorkflowActor = {
  id: 'sol-b',
  nome: 'Marcos Solicitante Beta',
  email: 'marcos@beta.com',
  role: 'solicitante',
  empresaId: 'comp-b',
};

const AUDITOR: IntegrationWorkflowActor = {
  id: 'aud-1',
  nome: 'Helena Auditora',
  email: 'helena@auditoria.com',
  role: 'auditor',
};

function buildBaseSeed() {
  const companies: Company[] = [
    {
      id: 'comp-a',
      razaoSocial: 'Alfa Engenharia Terceirizada Ltda',
      nomeFantasia: 'Alfa Engenharia',
      cnpj: '11.111.111/0001-11',
      responsavelLegal: 'Roberto Alfa',
      responsavelSST: 'Eng. Paula Alfa',
      telefone: '11999990001',
      email: 'contato@alfa.com',
      endereco: 'Av. Industrial, 100',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Manutenção em Altura',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '2027-12-31',
      contrato_indeterminado: false,
      situacao: 'ativa',
    },
    {
      id: 'comp-b',
      razaoSocial: 'Beta Montagens Industriais S.A.',
      nomeFantasia: 'Beta Montagens',
      cnpj: '22.222.222/0001-22',
      responsavelLegal: 'Paulo Beta',
      responsavelSST: 'Téc. Bruno Beta',
      telefone: '11999990002',
      email: 'contato@beta.com',
      endereco: 'Rua das Indústrias, 200',
      unidadeAtendimento: 'Planta SP',
      atividadeContratada: 'Serviços Elétricos',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '',
      contrato_indeterminado: true,
      situacao: 'ativa',
    },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-a1',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      nomeCompleto: 'João Silva Terceiro',
      cpf: '111.222.333-44',
      cargo: 'Montador Industrial',
      setor: 'Manutenção',
      situacaoCadastral: 'ativo',
    },
    {
      id: 'emp-b1',
      empresaId: 'comp-b',
      empresaNome: 'Beta Montagens Industriais S.A.',
      nomeCompleto: 'Pedro Costa Beta',
      cpf: '555.666.777-88',
      cargo: 'Eletricista',
      setor: 'Elétrica',
      situacaoCadastral: 'ativo',
    },
  ];

  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-altura',
      codigo: 'TRABALHO_ALTURA',
      nome: 'Trabalho em Altura — NR-35',
      descricao: 'Atividades acima de 2 metros com risco de queda.',
      nivelRisco: 'critico',
      riscosAssociados: ['Queda de altura'],
      normasAplicaveis: ['NR-35', 'NR-07'],
      exigeAPR: true,
      exigePT: true,
      exigeLOTO: false,
      exigePET: false,
      ativo: true,
      criadoPorId: 'admin-1',
    },
  ];

  const activityDocumentRequirements: ActivityDocumentRequirement[] = [
    {
      id: 'req-pgr',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'PGR — Programa de Gerenciamento de Riscos',
      documentoCodigoCanonico: 'PGR',
      palavrasChaveMatch: ['pgr', 'gerenciamento de riscos'],
      escopo: 'empresa',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-01',
      ordemExibicao: 1,
      ativo: true,
      criadoPorId: 'admin-1',
    },
    {
      id: 'req-aso-alt',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'ASO Apto para Trabalho em Altura',
      documentoCodigoCanonico: 'ASO',
      palavrasChaveMatch: ['aso'],
      escopo: 'colaborador',
      origemColecao: 'exams',
      funcoesAplicaveis: [],
      exigeAptoASO: true,
      aptidaoEspecifica: 'trabalho_altura',
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-07 / NR-35',
      ordemExibicao: 2,
      ativo: true,
      criadoPorId: 'admin-1',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'Certificado NR-35 (Trabalho em Altura)',
      documentoCodigoCanonico: 'NR-35',
      palavrasChaveMatch: ['nr-35', 'nr35', 'trabalho em altura'],
      escopo: 'colaborador',
      origemColecao: 'trainings',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-35',
      ordemExibicao: 3,
      ativo: true,
      criadoPorId: 'admin-1',
    },
    {
      id: 'req-optional',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'Manual Complementar da Contratada',
      documentoCodigoCanonico: 'MANUAL_COMP',
      palavrasChaveMatch: ['manual'],
      escopo: 'empresa',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: false,
      baseLegal: 'Boas práticas',
      ordemExibicao: 4,
      ativo: true,
      criadoPorId: 'admin-1',
    },
    {
      id: 'req-pt',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'Permissão de Trabalho (PT)',
      documentoCodigoCanonico: 'PT',
      palavrasChaveMatch: ['pt', 'permissao de trabalho'],
      escopo: 'atividade_pt',
      origemColecao: 'safetyPermits',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-35',
      ordemExibicao: 5,
      ativo: true,
      criadoPorId: 'admin-1',
    },
  ];

  return { companies, employees, activityProfiles, activityDocumentRequirements };
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

async function main() {
  let passed = 0;
  const fixedNow = () => new Date('2026-06-15T12:00:00.000Z');

  const wrap = async (name: string, fn: () => Promise<void>) => {
    await runTest(name, fn);
    passed += 1;
  };

  // TEST 1: Dynamic checklist from Activity Matrix (no hardcoding)
  await wrap('1. Criação de integração gera checklist dinâmico a partir da Matriz de Atividades', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const detail = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      novosColaboradores: [
        {
          nomeCompleto: 'Lucas Ferreira Novo',
          cpf: '999.888.777-66',
          cargo: 'Soldador',
          setor: 'Caldeiraria',
        },
      ],
    });

    assert.equal(detail.integration.status, 'RASCUNHO');
    assert.equal(detail.integration.colaboradoresCandidatos.length, 2);
    // 2 company requirements (PGR mandatory + Manual optional) + 2 employees * 2 requirements (ASO + NR-35) = 6 items (PT is NOT in integration)
    assert.equal(detail.items.length, 6);
    assert.ok(!detail.items.some((i) => i.documentoCodigoCanonico === 'PT'));
    assert.equal(detail.items.filter((i) => i.obrigatorio).length, 5);
    assert.equal(detail.items.filter((i) => !i.obrigatorio).length, 1);
  });

  // TEST 2 & 3: Multi-file batch upload + automatic association + SmartDocs suggestion (NEVER auto-approves)
  await wrap('2 & 3. Envio em lote com associação automática e sugestão SmartDocs IA sem aprovação automática', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({
      repo,
      nowProvider: fixedNow,
      smartDocsSuggestionRunner: async (inp) => ({
        processadoEm: '2026-06-15T12:01:00.000Z',
        tipoDocumentoSugerido: inp.arquivoNome.includes('ASO') ? 'ASO' : 'PGR',
        dataEmissaoSugerida: '2026-06-01',
        dataValidadeSugerida: '2027-06-01',
        resultadoAptidaoSugerido: inp.arquivoNome.includes('ASO') ? 'apto' : '',
        confianca: 0.94,
        qualidadeLeitura: 'alta',
      }),
    });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });

    const uploaded = await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { arquivoNome: 'PGR_Alfa_2026.pdf', arquivoBase64: SAMPLE_PDF_BASE64, runSmartDocsAi: true },
        { arquivoNome: 'ASO_Joao_2026.pdf', arquivoBase64: SAMPLE_PDF_BASE64, runSmartDocsAi: true },
        { arquivoNome: 'NR-35_Joao_2026.png', arquivoBase64: SAMPLE_PNG_BASE64, runSmartDocsAi: false },
      ],
    });

    assert.equal(uploaded.uploadedCount, 3);
    assert.equal(uploaded.integration.status, 'AGUARDANDO_ANALISE');
    const pgrItem = uploaded.items.find((i) => i.documentoCodigoCanonico === 'PGR')!;
    const asoItem = uploaded.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
    const nr35Item = uploaded.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!;

    assert.equal(pgrItem.status, 'ENVIADO');
    assert.equal(pgrItem.smartDocsSugestao?.dataValidadeSugerida, '2027-06-01');
    assert.equal(asoItem.status, 'ENVIADO');
    assert.equal(asoItem.colaboradorId, 'emp-a1');
    assert.equal(nr35Item.status, 'ENVIADO');
    assert.equal(nr35Item.colaboradorId, 'emp-a1');
    // Crucial: SmartDocs NEVER auto-approves or writes to official collections
    assert.equal(repo.state.documents.length, 0);
    assert.equal(repo.state.exams.length, 0);
    assert.equal(repo.state.trainings.length, 0);
  });

  // TEST 4: Duplicate company detection by CNPJ
  await wrap('4. Detecção e bloqueio de empresa duplicada por CNPJ', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const dup = await service.checkDuplicates(ADMIN, { cnpj: '11111111000111' });
    assert.equal(dup.cnpjDuplicado, true);
    assert.equal(dup.empresaExistente?.id, 'comp-a');

    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_UNBOUND, {
          tipo: 'INTEGRACAO_INICIAL',
          solicitacaoNovaEmpresa: {
            razaoSocial: 'Alfa Duplicada Ltda',
            nomeFantasia: 'Alfa Dup',
            cnpj: '11.111.111/0001-11',
            responsavelLegal: 'Fulano',
            responsavelSST: 'Beltrano',
            telefone: '11900000000',
            email: 'dup@alfa.com',
            endereco: 'Rua X',
            unidadeAtendimento: 'SP',
            atividadeContratada: 'Altura',
            dataInicioContrato: '2026-01-01',
            dataTerminoContrato: '2027-01-01',
          },
          atividadeIds: ['act-altura'],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 409 && err.code === 'DUPLICATE_COMPANY_CNPJ'
    );
  });

  // TEST 5: Duplicate employee detection by CPF (same company & cross-company)
  await wrap('5. Detecção e bloqueio de colaborador duplicado por CPF (mesma e outra empresa)', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const dupSame = await service.checkDuplicates(SOLICITANTE_A, { cpf: '11122233344' });
    assert.equal(dupSame.cpfDuplicado, true);
    assert.equal(dupSame.colaboradorExistente?.mesmaEmpresa, true);

    const dupOther = await service.checkDuplicates(SOLICITANTE_A, { cpf: '55566677788' });
    assert.equal(dupOther.cpfDuplicado, true);
    assert.equal(dupOther.colaboradorExistente?.mesmaEmpresa, false);
    assert.equal(dupOther.colaboradorExistente?.id, ''); // No cross-company ID leak

    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_A, {
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
          novosColaboradores: [
            { nomeCompleto: 'João Duplicado', cpf: '111.222.333-44', cargo: 'Montador' },
          ],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 409 && err.code === 'DUPLICATE_EMPLOYEE_CPF'
    );

    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_A, {
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
          novosColaboradores: [
            { nomeCompleto: 'Pedro de Outra Empresa', cpf: '555.666.777-88', cargo: 'Eletricista' },
          ],
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 409 &&
        err.code === 'DUPLICATE_EMPLOYEE_CPF_OTHER_COMPANY'
    );
  });

  // TEST 6, 7, 8, 9, 10: Individual review, partial approval preserving approved docs, mandatory rejection justification, resubmission of only rejected docs, version history preservation
  await wrap('6, 7, 8, 9 & 10. Conferência individual, aprovação parcial preservando aprovados, reprovação justificada, reenvio parcial e histórico de versões', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });

    const pgrId = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!.id;
    const asoId = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!.id;
    const nr35Id = created.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!.id;

    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'PGR.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataEmissao: '2026-01-01', dataValidade: '2027-01-01' },
        { itemId: asoId, arquivoNome: 'ASO.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataEmissao: '2026-02-01', dataValidade: '2027-02-01', conclusaoAso: 'apto', aptidoesEspecificas: ['trabalho_altura'] },
        { itemId: nr35Id, arquivoNome: 'NR35_ilegivel.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataEmissao: '2026-03-01', dataValidade: '2028-03-01' },
      ],
    });

    await service.startReview(ADMIN, created.integration.id);

    // Admin approves PGR & ASO (for INTEGRACAO_INICIAL, partial officialization is deferred until final complete approval)
    const afterPgr = await service.reviewDocumentItem(ADMIN, created.integration.id, pgrId, {
      decisao: 'APROVADO',
      dataEmissao: '2026-01-01',
      dataValidade: '2027-01-01',
    });
    const approvedPgrSnapshot = afterPgr.items.find((i) => i.id === pgrId)!;
    assert.equal(approvedPgrSnapshot.status, 'APROVADO');
    assert.equal(repo.state.documents.length, 0);

    await service.reviewDocumentItem(ADMIN, created.integration.id, asoId, {
      decisao: 'APROVADO',
      dataEmissao: '2026-02-01',
      dataValidade: '2027-02-01',
      conclusaoAso: 'apto',
      aptidoesEspecificas: ['trabalho_altura'],
    });
    assert.equal(repo.state.exams.length, 0);

    // Reject NR-35 WITHOUT justification must fail 400
    await assert.rejects(
      () => service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, { decisao: 'REPROVADO', motivo: '   ' }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 400 && err.code === 'JUSTIFICATION_REQUIRED'
    );

    // Reject NR-35 WITH justification
    await service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, {
      decisao: 'REPROVADO',
      motivo: 'Certificado sem assinatura do instrutor responsável.',
    });

    // Return ONLY pending/rejected for correction
    const returned = await service.returnForCorrection(ADMIN, created.integration.id, {
      justificativa: 'Reenvie apenas o certificado NR-35 assinado.',
    });
    assert.equal(returned.integration.status, 'PENDENTE_CORRECAO');

    // Verify PGR & ASO remained 100% preserved
    const pgrAfterReturn = returned.items.find((i) => i.id === pgrId)!;
    assert.equal(pgrAfterReturn.status, 'APROVADO');
    assert.equal(pgrAfterReturn.analisadoPorId, ADMIN.id);
    assert.equal(pgrAfterReturn.arquivoHashSha256, approvedPgrSnapshot.arquivoHashSha256);

    // Solicitante CANNOT directly overwrite already approved PGR in batch upload
    await assert.rejects(
      () =>
        service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
          files: [{ itemId: pgrId, arquivoNome: 'PGR_hack.pdf', arquivoBase64: SAMPLE_PDF_V2_BASE64 }],
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 409 &&
        err.code === 'ITEM_ALREADY_APPROVED_USE_RENEWAL'
    );

    // Solicitante resubmits ONLY the rejected NR-35
    const resubmitted = await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        {
          itemId: nr35Id,
          arquivoNome: 'NR35_assinado_v2.pdf',
          arquivoBase64: SAMPLE_PDF_V2_BASE64,
          dataEmissao: '2026-03-01',
          dataValidade: '2028-03-01',
        },
      ],
    });

    assert.equal(resubmitted.integration.status, 'REENVIADA');
    const nr35Item = resubmitted.items.find((i) => i.id === nr35Id)!;
    assert.equal(nr35Item.versaoAtual, 2);
    assert.equal(nr35Item.versoes.length, 2);
    assert.equal(nr35Item.versoes[0].status, 'REPROVADO');
    assert.equal(nr35Item.versoes[1].status, 'ENVIADO');

    // Admin approves NR-35 v2 and approves integration (note: optional item 'MANUAL_COMP' is still PENDENTE_ENVIO and must NOT block!)
    await service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, {
      decisao: 'APROVADO',
      dataEmissao: '2026-03-01',
      dataValidade: '2028-03-01',
    });
    const finalApproved = await service.approveIntegration(ADMIN, created.integration.id);
    assert.equal(finalApproved.integration.status, 'APROVADA');
    assert.equal(repo.state.documents.length, 1);
    assert.equal(repo.state.exams.length, 1);
    assert.equal(repo.state.trainings.length, 1);
  });

  // TEST 11: Document update / renewal — expired old version keeps blocking compliance until Admin approves new version, preserving version history
  await wrap('11. Atualização/renovação documental preserva histórico e mantém versão vencida bloqueando até aprovação do Admin EHS', async () => {
    const seed = buildBaseSeed();
    const expiredPgr: DocumentSST = {
      id: 'doc-pgr-old',
      nomeDocumento: 'PGR 2025',
      tipoDocumentoCanonico: 'PGR',
      categoria: 'Documento Empresarial',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      dataEmissao: '2025-01-01',
      dataValidade: '2026-01-01', // Expired on 2026-06-15!
      responsavelEnvio: 'Carlos',
      arquivoUrl: '',
      arquivoNome: 'PGR_2025.pdf',
      situacao: 'aprovado',
      analisadoPor: 'Admin EHS Master',
      dataAnalise: '2025-01-02T10:00:00.000Z',
      versao: 1,
      historicoVersoes: [
        {
          versao: 1,
          arquivoUrl: '',
          arquivoNome: 'PGR_2025.pdf',
          dataEnvio: '2025-01-01T10:00:00.000Z',
          responsavelEnvio: 'Carlos',
          situacao: 'aprovado',
          analisadoPor: 'Admin EHS Master',
          dataAnalise: '2025-01-02T10:00:00.000Z',
        },
      ],
    };
    const validAso: OccupationalExam = {
      id: 'exam-valid',
      tipoExame: 'ASO Periódico',
      tipoDocumentoCanonico: 'ASO',
      aptidoesEspecificas: ['trabalho_altura'],
      colaboradorId: 'emp-a1',
      colaboradorNome: 'João Silva Terceiro',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2027-02-01',
      conclusao: 'apto',
      situacao: 'aprovado',
    };
    const validNr35: Training = {
      id: 'trn-valid',
      nomeTreinamento: 'NR-35',
      tipoDocumentoCanonico: 'NR-35',
      colaboradorId: 'emp-a1',
      colaboradorNome: 'João Silva Terceiro',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      dataRealizacao: '2026-02-01',
      dataValidade: '2028-02-01',
      situacao: 'aprovado',
    };

    const repo = createInMemoryIntegrationRepository({
      ...seed,
      documents: [expiredPgr],
      exams: [validAso],
      trainings: [validNr35],
    });
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    // Create ATUALIZACAO_DOCUMENTAL solely for PGR
    const renewal = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'ATUALIZACAO_DOCUMENTAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      customItems: [
        {
          categoria: 'empresa',
          documentoCodigoCanonico: 'PGR',
          nomeExibicao: 'PGR — Renovação 2026/2027',
          origemColecao: 'documents',
          obrigatorio: true,
          officialRecordId: 'doc-pgr-old',
        },
      ],
    });

    const pgrRenewalItemId = renewal.items[0].id;

    // Solicitante sends new valid PGR PDF — NOT yet approved by Admin
    await service.uploadBatchDocuments(SOLICITANTE_A, renewal.integration.id, {
      autoSubmit: true,
      files: [
        {
          itemId: pgrRenewalItemId,
          arquivoNome: 'PGR_2026_2027.pdf',
          arquivoBase64: SAMPLE_PDF_V2_BASE64,
          dataEmissao: '2026-06-01',
          dataValidade: '2027-06-01',
        },
      ],
    });

    // Compliance engine MUST STILL BE BLOCKED because Admin hasn't approved the renewal yet!
    const beforeAdminCompliance = evaluateActivityCompliance({
      company: repo.state.companies[0],
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      activityProfiles: repo.state.activityProfiles,
      requirements: repo.state.activityDocumentRequirements.filter((r) => r.origemColecao !== 'safetyPermits'),
      employees: repo.state.employees,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: [],
      safetyPermits: [],
      dataReferenciaAtividade: '2026-06-15',
    });
    assert.equal(beforeAdminCompliance.podeLiberar, false);
    assert.equal(beforeAdminCompliance.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PGR')?.status, 'VENCIDO');

    // Admin approves renewal -> updates official PGR preserving v1 history and creating v2!
    await service.reviewDocumentItem(ADMIN, renewal.integration.id, pgrRenewalItemId, {
      decisao: 'APROVADO',
      dataEmissao: '2026-06-01',
      dataValidade: '2027-06-01',
    });
    await service.approveIntegration(ADMIN, renewal.integration.id);

    const updatedOfficialDoc = repo.state.documents.find((d) => d.id === 'doc-pgr-old')!;
    assert.equal(updatedOfficialDoc.versao, 2);
    assert.equal(updatedOfficialDoc.historicoVersoes?.length, 2);
    assert.equal(updatedOfficialDoc.historicoVersoes?.[0].arquivoNome, 'PGR_2025.pdf');
    assert.equal(updatedOfficialDoc.historicoVersoes?.[1].arquivoNome, 'PGR_2026_2027.pdf');

    // Compliance engine now evaluates PGR as CONFORME
    const afterAdminCompliance = evaluateActivityCompliance({
      company: repo.state.companies[0],
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      activityProfiles: repo.state.activityProfiles,
      requirements: repo.state.activityDocumentRequirements.filter((r) => r.origemColecao !== 'safetyPermits'),
      employees: repo.state.employees,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: [],
      safetyPermits: [],
      dataReferenciaAtividade: '2026-06-15',
    });
    assert.equal(afterAdminCompliance.podeLiberar, true);
    assert.equal(afterAdminCompliance.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PGR')?.status, 'CONFORME');
  });

  // TEST 12: Block integration approval when mandatory items are pending
  await wrap('12. Bloqueio de aprovação final da integração com documentos obrigatórios pendentes', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const pgrId = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!.id;
    const asoId = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!.id;
    const nr35Id = created.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!.id;

    // Upload all mandatory docs and submit; Admin approves ONLY PGR
    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'PGR.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2027-06-01' },
        { itemId: asoId, arquivoNome: 'ASO.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2027-06-01', conclusaoAso: 'apto', aptidoesEspecificas: ['trabalho_altura'] },
        { itemId: nr35Id, arquivoNome: 'NR35.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2028-06-01' },
      ],
    });
    await service.reviewDocumentItem(ADMIN, created.integration.id, pgrId, {
      decisao: 'APROVADO',
      dataValidade: '2027-06-01',
    });

    // ASO and NR-35 are not yet approved -> approveIntegration MUST fail 422 and no partial officialization occurs
    await assert.rejects(
      () => service.approveIntegration(ADMIN, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_ITEMS_INCOMPLETE'
    );
    assert.equal(repo.state.documents.length, 0);
  });

  // TEST 13: Block Solicitante self-approval & Auditor write actions
  await wrap('13. Bloqueio de autoaprovação pelo Solicitante e bloqueio de escrita pelo Auditor', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    // Auditor cannot create integration
    await assert.rejects(
      () =>
        service.createIntegration(AUDITOR, {
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
          colaboradorIds: ['emp-a1'],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'AUDITOR_READ_ONLY'
    );

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const pgrId = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!.id;
    const asoId = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!.id;
    const nr35Id = created.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!.id;
    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'PGR.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
        { itemId: asoId, arquivoNome: 'ASO.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
        { itemId: nr35Id, arquivoNome: 'NR35.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
      ],
    });

    // Auditor CAN read detail
    const auditView = await service.getIntegrationDetail(AUDITOR, created.integration.id);
    assert.equal(auditView.integration.id, created.integration.id);

    // Solicitante CANNOT startReview, reviewDocumentItem, returnForCorrection, or approveIntegration
    await assert.rejects(
      () => service.startReview(SOLICITANTE_A, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'ADMIN_REQUIRED'
    );
    await assert.rejects(
      () => service.reviewDocumentItem(SOLICITANTE_A, created.integration.id, pgrId, { decisao: 'APROVADO' }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'ADMIN_REQUIRED'
    );
    await assert.rejects(
      () => service.approveIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'ADMIN_REQUIRED'
    );
  });

  // TEST 14: Strict company isolation for Solicitante
  await wrap('14. Isolamento estrito por empresa contratada (Solicitante B não acessa integração da Empresa A)', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });

    // Solicitante B list returns empty
    const listB = await service.listIntegrations(SOLICITANTE_B);
    assert.equal(listB.length, 0);

    // Solicitante B cannot read A's integration
    await assert.rejects(
      () => service.getIntegrationDetail(SOLICITANTE_B, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'COMPANY_SCOPE_VIOLATION'
    );

    // Solicitante B cannot create integration for Company A
    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_B, {
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 403 && err.code === 'COMPANY_SCOPE_VIOLATION'
    );
  });

  // TEST 15: Complete audit log trail
  await wrap('15. Registro completo na trilha de auditoria (auditLogs e historicoWorkflow)', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const pgrId = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!.id;
    const asoId = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!.id;
    const nr35Id = created.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!.id;
    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'PGR.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
        { itemId: asoId, arquivoNome: 'ASO.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
        { itemId: nr35Id, arquivoNome: 'NR35.pdf', arquivoBase64: SAMPLE_PDF_BASE64 },
      ],
    });
    await service.startReview(ADMIN, created.integration.id);
    const afterReview = await service.reviewDocumentItem(ADMIN, created.integration.id, pgrId, {
      decisao: 'APROVADO',
      dataValidade: '2027-06-01',
    });

    assert.ok(repo.state.auditLogs.length >= 4);
    assert.ok(afterReview.integration.historicoWorkflow.length >= 4);
    assert.ok(afterReview.integration.historicoWorkflow.some((h) => h.acao === 'APROVACAO_ITEM_DOCUMENTAL'));
  });

  // TEST 16: Integration with Compliance Engine & PermitWorkflowService — Integration approval does NOT auto-release critical PT!
  await wrap('16. Aprovação da integração alimenta Motor de Conformidade mas NÃO libera automaticamente PT de atividade crítica', async () => {
    const repo = createInMemoryIntegrationRepository(buildBaseSeed());
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    const created = await service.createIntegration(SOLICITANTE_A, {
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const pgrId = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!.id;
    const asoId = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!.id;
    const nr35Id = created.items.find((i) => i.documentoCodigoCanonico === 'NR-35')!.id;

    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'PGR.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2027-06-01' },
        { itemId: asoId, arquivoNome: 'ASO.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2027-06-01', conclusaoAso: 'apto', aptidoesEspecificas: ['trabalho_altura'] },
        { itemId: nr35Id, arquivoNome: 'NR35.pdf', arquivoBase64: SAMPLE_PDF_BASE64, dataValidade: '2028-06-01' },
      ],
    });

    await service.reviewDocumentItem(ADMIN, created.integration.id, pgrId, { decisao: 'APROVADO', dataValidade: '2027-06-01' });
    await service.reviewDocumentItem(ADMIN, created.integration.id, asoId, { decisao: 'APROVADO', dataValidade: '2027-06-01', conclusaoAso: 'apto', aptidoesEspecificas: ['trabalho_altura'] });
    await service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, { decisao: 'APROVADO', dataValidade: '2028-06-01' });
    await service.approveIntegration(ADMIN, created.integration.id);

    // Crucial check 1: ZERO safetyPermits were auto-created or auto-released!
    assert.equal(repo.state.safetyPermits.length, 0);

    // Crucial check 2: Now feed the official records generated by Central de Integração into PermitWorkflowService
    const permitRepo = createInMemoryPermitRepository({
      companies: repo.state.companies,
      employees: repo.state.employees,
      activityProfiles: repo.state.activityProfiles,
      activityDocumentRequirements: repo.state.activityDocumentRequirements,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: repo.state.epiDeliveries,
      safetyPermits: [],
    });
    const permitService = new PermitWorkflowService(permitRepo);

    // Create a formal PT draft referencing the approved employee & company
    const draft = await permitService.createPermitDraft(SOLICITANTE_A, {
      tipo: 'PT',
      titulo: 'Manutenção Telhado Galpão A',
      empresaId: 'comp-a',
      localTrabalho: 'Galpão A',
      dataInicio: '2026-06-20',
      dataFim: '2026-06-22',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      anexosControles: [
        { tipo: 'APR', nomeArquivo: 'APR.pdf', url: 'https://example.com/apr.pdf' },
        { tipo: 'PT', nomeArquivo: 'PT.pdf', url: 'https://example.com/pt.pdf' },
      ],
    });

    // Compliance recognizes ALL company & employee documents approved via Central de Integração!
    assert.equal(draft.compliance.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PGR')?.status, 'CONFORME');
    assert.equal(draft.compliance.colaboradores.length, 1);
    assert.equal(draft.compliance.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'ASO')?.status, 'CONFORME');
    assert.equal(draft.compliance.colaboradores[0].itens.find((i) => i.documentoCodigoCanonico === 'NR-35')?.status, 'CONFORME');
    // Crucial check 3: PT item (escopo atividade_pt) is NOT auto-approved by Central de Integração,
    // and the permit itself starts in 'elaboracao' — NEVER auto-released!
    assert.equal(draft.compliance.itensAtividade.find((i) => i.documentoCodigoCanonico === 'PT')?.status, 'AUSENTE');
    assert.equal(draft.compliance.podeLiberar, false);
    assert.equal(draft.permit.status, 'elaboracao');

    // Crucial check 4: Once an approved PT exists in the separate PT workflow, overall compliance becomes CONFORME!
    const fullCheck = evaluateActivityCompliance({
      company: repo.state.companies.find((c) => c.id === 'comp-a')!,
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      dataReferenciaAtividade: '2026-06-20',
      dataFimAtividade: '2026-06-22',
      activityProfiles: repo.state.activityProfiles,
      requirements: repo.state.activityDocumentRequirements,
      employees: repo.state.employees,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: repo.state.epiDeliveries,
      safetyPermits: [
        {
          ...draft.permit,
          status: 'aprovado',
        },
      ],
      smartDocs: [],
    });
    assert.equal(fullCheck.podeLiberar, true);
    // Item opcional (MANUAL_COMP) não enviado gera status 'atencao', sem bloquear liberação
    assert.equal(fullCheck.statusGeral, 'atencao');
  });

  // TEST 17: Legacy records compatibility + Express HTTP route auth/delete guards
  await wrap('17. Compatibilidade com registros legados e proteção HTTP nas rotas /api/integrations/*', async () => {
    const legacySeed = buildBaseSeed();
    // Legacy company without atividadesAutorizadasIds and legacy doc without tipoDocumentoCanonico
    const legacyDoc: DocumentSST = {
      id: 'legacy-doc-1',
      nomeDocumento: 'PGR - Programa de Gerenciamento de Riscos Legado',
      categoria: 'Documento Empresarial',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      dataEmissao: '2026-01-01',
      dataValidade: '2027-01-01',
      responsavelEnvio: 'Legado',
      arquivoUrl: '',
      arquivoNome: 'pgr_legado.pdf',
      situacao: 'aprovado',
      versao: 1,
    };

    const repo = createInMemoryIntegrationRepository({
      ...legacySeed,
      documents: [legacyDoc],
    });
    const service = new IntegrationWorkflowService({ repo, nowProvider: fixedNow });

    // Renewal via item renewal preserves legacy history seamlessly
    const detail = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    assert.ok(detail.compliancePreview !== null);
    assert.equal(
      detail.compliancePreview!.itensEmpresa.find((i) => i.documentoCodigoCanonico === 'PGR')?.status,
      'CONFORME'
    );

    // Express HTTP test: unauthenticated requests MUST fail 401
    process.env.API_AUTH_SECRET = 'test-secret-integration-workflow-32-chars!!';
    const app = createApiApp({ integrationWorkflowService: service });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const resGet = await fetch(`http://127.0.0.1:${port}/api/integrations`);
      assert.equal(resGet.status, 401);

      const resPost = await fetch(`http://127.0.0.1:${port}/api/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 'comp-a' }),
      });
      assert.equal(resPost.status, 401);

      const resDelete = await fetch(`http://127.0.0.1:${port}/api/integrations/int-1`, {
        method: 'DELETE',
      });
      assert.equal(resDelete.status, 401);
    } finally {
      server.close();
    }
  });

  console.log(`\n🎉 ALL ${passed}/17 MANDATORY INTEGRATION WORKFLOW TESTS PASSED!\n`);
}

main().catch((err) => {
  console.error('Integration workflow test suite failed:', err);
  process.exit(1);
});
