import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  IntegrationWorkflowActor,
  IntegrationWorkflowError,
  IntegrationWorkflowService,
  createInMemoryIntegrationRepository,
} from '../backend/integrationWorkflowService';
import { InMemoryIntegrationFileStorage } from '../backend/integrationFileStorage';
import { createApiApp } from '../backend/app';
import { signAuthToken } from '../backend/authMiddleware';
import { evaluateActivityCompliance } from '../src/utils/activityComplianceEngine';
import {
  PermitWorkflowService,
  createInMemoryPermitRepository,
} from '../backend/permitWorkflowService';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  Employee,
} from '../src/types/sst';

function makePdfBuffer(tag: string, sizeBytes = 2048): Buffer {
  const header = Buffer.from(`%PDF-1.4\n%${tag}\n`, 'latin1');
  const footer = Buffer.from('\n%%EOF', 'latin1');
  const padLen = Math.max(0, sizeBytes - header.length - footer.length);
  return Buffer.concat([header, Buffer.alloc(padLen, 0x20), footer]);
}

function toPdfDataUrl(buf: Buffer): string {
  return `data:application/pdf;base64,${buf.toString('base64')}`;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const FIXED_NOW = () => new Date('2026-06-15T12:00:00.000Z');

const ADMIN: IntegrationWorkflowActor = {
  id: 'admin-ehs-1',
  nome: 'Admin EHS Master',
  email: 'admin@ehs.com',
  role: 'admin',
};

const SOLICITANTE_A: IntegrationWorkflowActor = {
  id: 'sol-alfa-1',
  nome: 'Carlos Solicitante Alfa',
  email: 'carlos@alfa.com',
  role: 'solicitante',
  empresaId: 'comp-a',
};

function buildSeed() {
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
      atividadeContratada: 'Manutenção Industrial',
      dataInicioContrato: '2025-01-01',
      dataTerminoContrato: '2027-12-31',
      contrato_indeterminado: false,
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
      id: 'emp-a2',
      empresaId: 'comp-a',
      empresaNome: 'Alfa Engenharia Terceirizada Ltda',
      nomeCompleto: 'Ana Paula Técnica',
      cpf: '222.333.444-55',
      cargo: 'Eletricista Industrial',
      setor: 'Manutenção',
      situacaoCadastral: 'ativo',
    },
  ];

  const activityProfiles: ActivityProfile[] = [
    {
      id: 'act-altura',
      codigo: 'TRAB_ALTURA',
      nome: 'Trabalho em Altura (NR-35)',
      descricao: 'Serviços acima de 2m',
      nivelRisco: 'critico',
      riscosAssociados: ['Queda de altura'],
      exigeAPR: true,
      exigePT: true,
      exigeLOTO: false,
      exigePET: false,
      normasAplicaveis: ['NR-35', 'NR-07', 'NR-06', 'NR-01'],
      ativo: true,
      criadoPorId: 'admin-ehs-1',
    },
  ];

  // Mandatory items covering Empresa + ALL 4 official collaborator categories + 1 optional document
  const activityDocumentRequirements: ActivityDocumentRequirement[] = [
    {
      id: 'req-pgr',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'PGR',
      nomeExibicao: 'PGR — Programa de Gerenciamento de Riscos',
      escopo: 'empresa',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['PGR'],
      baseLegal: 'NR-01',
      ativo: true,
      ordemExibicao: 1,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-rg',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'RG',
      nomeExibicao: 'RG — Documento de Identidade',
      escopo: 'colaborador',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['RG'],
      baseLegal: 'Identificação Legal',
      ativo: true,
      ordemExibicao: 2,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-aso',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'ASO',
      nomeExibicao: 'ASO — Atestado de Saúde Ocupacional',
      escopo: 'colaborador',
      origemColecao: 'exams',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      exigeAptoASO: true,
      aptidaoEspecifica: 'trabalho_altura',
      palavrasChaveMatch: ['ASO'],
      baseLegal: 'NR-07',
      ativo: true,
      ordemExibicao: 3,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'NR-35',
      nomeExibicao: 'Certificado NR-35 — Trabalho em Altura',
      escopo: 'colaborador',
      origemColecao: 'trainings',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['NR-35', 'NR35'],
      baseLegal: 'NR-35',
      ativo: true,
      ordemExibicao: 4,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-ctps',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'CTPS_ESOCIAL',
      nomeExibicao: 'CTPS Digital / Registro eSocial',
      escopo: 'colaborador',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['CTPS', 'ESOCIAL'],
      baseLegal: 'CLT / eSocial',
      ativo: true,
      ordemExibicao: 5,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-opcional',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'MANUAL_COMPLEMENTAR',
      nomeExibicao: 'Manual Complementar (Opcional)',
      escopo: 'colaborador',
      origemColecao: 'documents',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: false,
      palavrasChaveMatch: ['MANUAL'],
      baseLegal: 'Boas Práticas',
      ativo: true,
      ordemExibicao: 6,
      criadoPorId: 'admin-ehs-1',
    },
  ];

  return {
    companies,
    employees,
    activityProfiles,
    activityDocumentRequirements,
    documents: [],
    trainings: [],
    exams: [],
    epiDeliveries: [],
    safetyPermits: [],
    integrations: [],
    items: [],
    auditLogs: [],
  };
}

async function runTests() {
  let passed = 0;

  // TEST 1: Cadastro com documento obrigatório ausente (bloqueio 422 + status RASCUNHO / PENDENTE_DOCUMENTACAO)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      novosColaboradores: [
        {
          nomeCompleto: 'Pedro Henrique Novo',
          cpf: '333.444.555-66',
          cargo: 'Caldeireiro',
          setor: 'Caldeiraria',
        },
      ],
    });

    assert.equal(created.integration.status, 'RASCUNHO');
    assert.equal(created.submissionReadiness.podeSubmeter, false);
    assert.equal(created.submissionReadiness.totalObrigatorios, 5);
    assert.equal(created.submissionReadiness.obrigatoriosConfirmados, 0);
    assert.equal(created.submissionReadiness.totalOpcionais, 1);

    // Direct submit with 0 files -> 422 MANDATORY_DOCUMENTS_INCOMPLETE
    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.length === 5
    );

    // Upload only 2 of 5 mandatory items -> status becomes PENDENTE_DOCUMENTACAO
    const pgrItem = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!;
    const rgItem = created.items.find((i) => i.documentoCodigoCanonico === 'RG')!;

    const up1 = await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: pgrItem.id,
      arquivoNome: 'pgr.pdf',
      arquivoBase64: toPdfDataUrl(makePdfBuffer('PGR-V1')),
      dataEmissao: '2026-01-01',
      dataValidade: '2027-01-01',
    });
    assert.equal(up1.integration.status, 'PENDENTE_DOCUMENTACAO');
    assert.equal(up1.submissionReadiness.podeSubmeter, false);
    assert.equal(up1.submissionReadiness.obrigatoriosConfirmados, 1);

    // Batch upload with autoSubmit: true while 3 mandatory items remain missing -> 422
    await assert.rejects(
      () =>
        service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
          autoSubmit: true,
          files: [
            {
              itemId: rgItem.id,
              arquivoNome: 'rg.pdf',
              arquivoBase64: toPdfDataUrl(makePdfBuffer('RG-V1')),
              semValidade: true,
            },
          ],
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.obrigatoriosConfirmados === 2 &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.length === 3
    );

    const afterPartial = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
    assert.equal(afterPartial.integration.status, 'PENDENTE_DOCUMENTACAO');
    assert.equal(afterPartial.submissionReadiness.obrigatoriosConfirmados, 2);

    passed++;
    console.log('✅ Test 1 passed: Documento obrigatório ausente bloqueia submissão (422) e mantém status PENDENTE_DOCUMENTACAO');
  }

  // TEST 2: Upload pendente (metadados isolados sem binário) e upload malsucedido (arquivo perdido / corrompido / SHA-256 divergente)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });

    const mandatoryItems = created.items.filter((i) => i.obrigatorio);
    for (const item of mandatoryItems) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toPdfDataUrl(makePdfBuffer(`DOC-${item.documentoCodigoCanonico}`)),
        dataEmissao: '2026-01-01',
        dataValidade: '2027-06-01',
        conclusaoAso: item.origemColecao === 'exams' ? 'apto' : undefined,
        aptidoesEspecificas: item.origemColecao === 'exams' ? ['trabalho_altura'] : undefined,
      });
    }

    // 2a. Upload pendente: metadados gravados SEM storageKey no armazenamento privado (metadados isolados jamais são aceitos)
    const rawRg = repo.state.items.find((i) => i.documentoCodigoCanonico === 'RG')!;
    const savedRgStorageKey = rawRg.storageKey;
    const savedRgVerKey = rawRg.versoes[0].storageKey;
    rawRg.storageKey = '';
    rawRg.versoes[0].storageKey = '';

    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.some(
          (p: any) => p.documentoCodigoCanonico === 'RG'
        )
    );
    // Restore RG
    rawRg.storageKey = savedRgStorageKey;
    rawRg.versoes[0].storageKey = savedRgVerKey;

    // 2b. Upload malsucedido: binário ausente no storage privado
    const rawAso = repo.state.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
    const origAsoKey = rawAso.storageKey;
    rawAso.storageKey = 'integrations/comp-a/missing/nonexistent_v1.pdf';
    rawAso.versoes[0].storageKey = 'integrations/comp-a/missing/nonexistent_v1.pdf';

    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.some(
          (p: any) => p.documentoCodigoCanonico === 'ASO'
        )
    );

    // 2c. Upload corrompido / SHA-256 divergente no storage privado
    rawAso.storageKey = origAsoKey;
    rawAso.versoes[0].storageKey = origAsoKey;
    rawAso.versoes[0].arquivoHashSha256 = '0000000000000000000000000000000000000000000000000000000000000000';

    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.some(
          (p: any) => p.documentoCodigoCanonico === 'ASO' && String(p.motivo).includes('SHA-256')
        )
    );

    passed++;
    console.log('✅ Test 2 passed: Upload pendente (metadados isolados) e upload malsucedido (ausente ou SHA-256 divergente) bloqueiam submissão (422)');
  }

  // TEST 3: Invisibilidade para Admin EHS antes da submissão completa + bloqueio em todos endpoints Admin (409)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const asoItem = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;

    await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: asoItem.id,
      arquivoNome: 'aso.pdf',
      arquivoBase64: toPdfDataUrl(makePdfBuffer('ASO-DRAFT')),
    });

    assert.equal((await service.listIntegrations(ADMIN)).length, 0);

    for (const fn of [
      () => service.getIntegrationDetail(ADMIN, created.integration.id),
      () => service.getDocumentFile(ADMIN, created.integration.id, asoItem.id),
      () => service.startReview(ADMIN, created.integration.id),
      () => service.reviewDocumentItem(ADMIN, created.integration.id, asoItem.id, { decisao: 'APROVADO' }),
      () => service.approveIntegration(ADMIN, created.integration.id),
      () =>
        service.renewIntegrationItem(SOLICITANTE_A, created.integration.id, asoItem.id, {
          arquivoNome: 'bypass.pdf',
          arquivoBase64: toPdfDataUrl(makePdfBuffer('BYPASS')),
        }),
    ]) {
      await assert.rejects(
        fn,
        (err: any) =>
          err instanceof IntegrationWorkflowError &&
          err.statusCode === 409 &&
          err.code === 'INTEGRATION_NOT_SUBMITTED'
      );
    }

    passed++;
    console.log('✅ Test 3 passed: Cadastro não submetido oculto na fila do Admin EHS e bloqueado em todos endpoints (409)');
  }

  // TEST 4: Cadastro 100% completo com opcionais ausentes -> submissão liberada sem autoaprovação
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      novosColaboradores: [
        {
          nomeCompleto: 'Lucas Ferreira Novo',
          cpf: '444.555.666-77',
          cargo: 'Soldador',
          setor: 'Montagem',
        },
      ],
    });

    const mandatoryItems = created.items.filter((i) => i.obrigatorio);
    const optionalItem = created.items.find((i) => !i.obrigatorio)!;
    assert.equal(mandatoryItems.length, 5);
    assert.equal(optionalItem.documentoCodigoCanonico, 'MANUAL_COMPLEMENTAR');

    for (const item of mandatoryItems) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toPdfDataUrl(makePdfBuffer(`COMP-${item.documentoCodigoCanonico}`)),
        dataEmissao: '2026-01-15',
        dataValidade:
          item.documentoCodigoCanonico === 'RG' || item.documentoCodigoCanonico === 'CTPS_ESOCIAL'
            ? ''
            : '2027-06-30',
        semValidade:
          item.documentoCodigoCanonico === 'RG' || item.documentoCodigoCanonico === 'CTPS_ESOCIAL',
        conclusaoAso: item.origemColecao === 'exams' ? 'apto' : undefined,
        aptidoesEspecificas: item.origemColecao === 'exams' ? ['trabalho_altura'] : undefined,
      });
    }

    const preSubmit = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
    assert.equal(preSubmit.integration.status, 'EM_ENVIO');
    assert.equal(preSubmit.submissionReadiness.podeSubmeter, true);
    assert.equal(preSubmit.submissionReadiness.obrigatoriosConfirmados, 5);
    assert.equal(preSubmit.submissionReadiness.opcionaisEnviados, 0);
    assert.equal(preSubmit.submissionReadiness.porColaborador?.length, 1);
    assert.equal(preSubmit.submissionReadiness.porColaborador?.[0].completo, true);

    // Still hidden from Admin before final submission click
    assert.equal((await service.listIntegrations(ADMIN)).length, 0);

    // Finalize & submit complete registration (optional item remains unsent)
    const submitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
    assert.equal(submitted.integration.status, 'AGUARDANDO_ANALISE');

    const adminList = await service.listIntegrations(ADMIN);
    assert.equal(adminList.length, 1);
    const adminDetail = await service.getIntegrationDetail(ADMIN, created.integration.id);
    assert.ok(adminDetail.items.every((i) => i.status !== 'APROVADO'));
    assert.equal(repo.state.employees.length, 2); // only seeded emp-a1 and emp-a2

    passed++;
    console.log('✅ Test 4 passed: Cadastro 100% completo com opcionais ausentes libera submissão sem autoaprovação');
  }

  // TEST 5: Múltiplos colaboradores com situações documentais diferentes (validação individual por colaborador)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1', 'emp-a2'],
    });

    // Upload Company PGR + 100% of emp-a1 mandatory docs, but leave NR-35 missing for emp-a2!
    const pgrItem = created.items.find((i) => i.documentoCodigoCanonico === 'PGR')!;
    const emp1Mandatory = created.items.filter((i) => i.colaboradorId === 'emp-a1' && i.obrigatorio);
    const emp2Mandatory = created.items.filter((i) => i.colaboradorId === 'emp-a2' && i.obrigatorio);
    assert.equal(emp1Mandatory.length, 4);
    assert.equal(emp2Mandatory.length, 4);

    for (const item of [pgrItem, ...emp1Mandatory]) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}_e1.pdf`,
        arquivoBase64: toPdfDataUrl(makePdfBuffer(`E1-${item.documentoCodigoCanonico}`)),
      });
    }
    // For emp-a2, upload 3 of 4 mandatory docs (skip NR-35)
    for (const item of emp2Mandatory.filter((i) => i.documentoCodigoCanonico !== 'NR-35')) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}_e2.pdf`,
        arquivoBase64: toPdfDataUrl(makePdfBuffer(`E2-${item.documentoCodigoCanonico}`)),
      });
    }

    const detail = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
    assert.equal(detail.integration.status, 'PENDENTE_DOCUMENTACAO');
    assert.equal(detail.submissionReadiness.podeSubmeter, false);
    assert.equal(detail.submissionReadiness.porColaborador?.length, 2);

    const col1 = detail.submissionReadiness.porColaborador!.find((c) => c.colaboradorId === 'emp-a1')!;
    const col2 = detail.submissionReadiness.porColaborador!.find((c) => c.colaboradorId === 'emp-a2')!;
    assert.equal(col1.completo, true);
    assert.equal(col1.obrigatoriosConfirmados, 4);
    assert.equal(col1.obrigatoriosPendentes, 0);
    assert.equal(col2.completo, false);
    assert.equal(col2.obrigatoriosConfirmados, 3);
    assert.equal(col2.obrigatoriosPendentes, 1);
    assert.equal(col2.pendencias[0].documentoCodigoCanonico, 'NR-35');

    // Submit MUST fail 422 identifying emp-a2's missing NR-35
    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 422 &&
        err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.length === 1 &&
        err.details?.submissionReadiness?.pendenciasObrigatorias?.[0].colaboradorId === 'emp-a2'
    );

    // Complete emp-a2's NR-35 -> now BOTH collaborators are complete and submission succeeds
    const emp2Nr35 = emp2Mandatory.find((i) => i.documentoCodigoCanonico === 'NR-35')!;
    await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: emp2Nr35.id,
      arquivoNome: 'nr35_e2.pdf',
      arquivoBase64: toPdfDataUrl(makePdfBuffer('E2-NR35')),
    });
    const submitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
    assert.equal(submitted.integration.status, 'AGUARDANDO_ANALISE');
    assert.ok(submitted.submissionReadiness.porColaborador!.every((c) => c.completo));

    passed++;
    console.log('✅ Test 5 passed: Múltiplos colaboradores validados individualmente — 1 completo e 1 pendente bloqueia até 100%');
  }

  // TEST 6: Tentativa de submissão direta pela API (HTTP sem auth/token forjado -> 401 + payload adulterado -> 422 + vínculo cruzado -> 403)
  {
    const prevSecret = process.env.API_AUTH_SECRET;
    process.env.API_AUTH_SECRET = 'test-etapa5-secret-32-chars-minimum-ok!';
    try {
      const repo = createInMemoryIntegrationRepository(buildSeed());
      const storage = new InMemoryIntegrationFileStorage();
      const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

      const created = await service.createIntegration(SOLICITANTE_A, {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: 'comp-a',
        atividadeIds: ['act-altura'],
        colaboradorIds: ['emp-a1'],
      });

      // 6a. Real Express HTTP server rejects unauthenticated & forged-token direct API calls to /submit and /documents/batch
      const app = createApiApp({ integrationWorkflowService: service });
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as any).port;

      try {
        const resNoAuth = await fetch(`http://127.0.0.1:${port}/api/integrations/${created.integration.id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ forceSubmit: true, podeSubmeter: true, status: 'APROVADA' }),
        });
        assert.equal(resNoAuth.status, 401);

        const resForged = await fetch(`http://127.0.0.1:${port}/api/integrations/${created.integration.id}/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer forged.jwt.signature',
          },
          body: JSON.stringify({ forceSubmit: true }),
        });
        assert.equal(resForged.status, 401);

        const resBatchNoAuth = await fetch(
          `http://127.0.0.1:${port}/api/integrations/${created.integration.id}/documents/batch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoSubmit: true, files: [] }),
          }
        );
        assert.equal(resBatchNoAuth.status, 401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      // 6b. Authenticated direct API call attempting to spoof flags on submitIntegration -> MUST fail 422
      const validJwt = signAuthToken({
        id: SOLICITANTE_A.id,
        cpf: '000.000.000-00',
        email: SOLICITANTE_A.email,
        nome: SOLICITANTE_A.nome,
        role: 'solicitante',
      });
      assert.ok(validJwt.token.split('.').length === 3);

      await assert.rejects(
        () =>
          service.submitIntegration(SOLICITANTE_A, created.integration.id, {
            justificativa: 'tentativa direta',
            ...({ forceSubmit: true, podeSubmeter: true, skipValidation: true } as any),
          }),
        (err: any) =>
          err instanceof IntegrationWorkflowError &&
          err.statusCode === 422 &&
          err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE' &&
          err.details?.submissionReadiness?.podeSubmeter === false
      );

      // 6c. Direct upload attempting to attach a document to an alien collaborator not in this integration -> MUST fail 403
      await assert.rejects(
        () =>
          service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
            categoria: 'colaborador',
            colaboradorId: 'emp-outra-empresa-999',
            documentoCodigoCanonico: 'RG',
            arquivoNome: 'rg_forjado.pdf',
            arquivoBase64: toPdfDataUrl(makePdfBuffer('FAKE-COLAB')),
          }),
        (err: any) =>
          err instanceof IntegrationWorkflowError &&
          err.statusCode === 403 &&
          err.code === 'COLLABORATOR_NOT_IN_INTEGRATION'
      );

      // 6d. Direct upload attempting to pass obrigatorio: false cannot downgrade existing mandatory item
      const rgItem = created.items.find((i) => i.documentoCodigoCanonico === 'RG')!;
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: rgItem.id,
        arquivoNome: 'rg_valido.pdf',
        arquivoBase64: toPdfDataUrl(makePdfBuffer('RG-OK')),
        ...({ obrigatorio: false, status: 'APROVADO' } as any),
      });
      const checkAfter = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
      const rgAfter = checkAfter.items.find((i) => i.id === rgItem.id)!;
      assert.equal(rgAfter.obrigatorio, true, 'Upload nunca pode rebaixar item obrigatório para opcional');
      assert.equal(rgAfter.status, 'ENVIADO', 'Upload nunca pode autoaprovar item');
    } finally {
      if (prevSecret === undefined) delete process.env.API_AUTH_SECRET;
      else process.env.API_AUTH_SECRET = prevSecret;
    }

    passed++;
    console.log('✅ Test 6 passed: API HTTP (401 sem auth/token forjado), submissão direta adulterada (422) e vínculo cruzado (403) bloqueados');
  }

  // TEST 7: Proteção contra submissão duplicada (concorrente e sequencial) e dupla aprovação
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });

    for (const item of created.items.filter((i) => i.obrigatorio)) {
      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toPdfDataUrl(makePdfBuffer(`DUP-${item.documentoCodigoCanonico}`)),
        dataEmissao: '2026-01-01',
        dataValidade: '2027-06-01',
        conclusaoAso: item.origemColecao === 'exams' ? 'apto' : undefined,
        aptidoesEspecificas: item.origemColecao === 'exams' ? ['trabalho_altura'] : undefined,
      });
    }

    // Fire 3 CONCURRENT submitIntegration calls -> EXACTLY 1 succeeds, 2 MUST fail 409 ALREADY_SUBMITTED
    const concurrentResults = await Promise.allSettled([
      service.submitIntegration(SOLICITANTE_A, created.integration.id),
      service.submitIntegration(SOLICITANTE_A, created.integration.id),
      service.submitIntegration(SOLICITANTE_A, created.integration.id),
    ]);

    const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
    const rejected = concurrentResults.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, 'Exatamente 1 submissão concorrente deve ser aceita');
    assert.equal(rejected.length, 2, 'As 2 submissões duplicadas devem ser bloqueadas');
    for (const rej of rejected) {
      assert.ok(rej.reason instanceof IntegrationWorkflowError);
      assert.equal(rej.reason.statusCode, 409);
      assert.equal(rej.reason.code, 'ALREADY_SUBMITTED');
    }

    // Sequential duplicate submit also fails 409 ALREADY_SUBMITTED
    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 409 && err.code === 'ALREADY_SUBMITTED'
    );

    // Verify only 1 ENVIO_PARA_ANALISE event in history (zero duplicates)
    const afterSub = await service.getIntegrationDetail(SOLICITANTE_A, created.integration.id);
    const submitEvents = afterSub.integration.historicoWorkflow.filter((h) => h.acao === 'ENVIO_PARA_ANALISE');
    assert.equal(submitEvents.length, 1);

    // Approve all mandatory items and test concurrent duplicate approveIntegration -> EXACTLY 1 succeeds!
    for (const item of afterSub.items.filter((i) => i.obrigatorio)) {
      await service.reviewDocumentItem(ADMIN, created.integration.id, item.id, { decisao: 'APROVADO' });
    }
    const concurrentApprovals = await Promise.allSettled([
      service.approveIntegration(ADMIN, created.integration.id),
      service.approveIntegration(ADMIN, created.integration.id),
    ]);
    assert.equal(concurrentApprovals.filter((r) => r.status === 'fulfilled').length, 1);
    const rejApp = concurrentApprovals.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(rejApp.length, 1);
    assert.equal(rejApp[0].reason.statusCode, 409);
    assert.equal(rejApp[0].reason.code, 'ALREADY_APPROVED');

    passed++;
    console.log('✅ Test 7 passed: Proteção contra submissão duplicada (concorrente/sequencial) e dupla aprovação (409)');
  }

  // TEST 8: Sem aprovação parcial + correção exata + preservação de aprovados + histórico de versões + oficialização atômica + preservação integral do fluxo PT/APR
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage, nowProvider: FIXED_NOW });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      novosColaboradores: [
        {
          nomeCompleto: 'Marina Costa Terceirizada',
          cpf: '555.666.777-88',
          cargo: 'Técnica de Montagem',
          setor: 'Obras',
        },
      ],
    });

    const byCode = (code: string) => created.items.find((i) => i.documentoCodigoCanonico === code)!;
    const pgrId = byCode('PGR').id;
    const rgId = byCode('RG').id;
    const asoId = byCode('ASO').id;
    const nr35Id = byCode('NR-35').id;
    const ctpsId = byCode('CTPS_ESOCIAL').id;

    await service.uploadBatchDocuments(SOLICITANTE_A, created.integration.id, {
      autoSubmit: true,
      files: [
        { itemId: pgrId, arquivoNome: 'pgr.pdf', arquivoBase64: toPdfDataUrl(makePdfBuffer('PGR-1')), dataEmissao: '2026-01-01', dataValidade: '2027-06-01' },
        { itemId: rgId, arquivoNome: 'rg.pdf', arquivoBase64: toPdfDataUrl(makePdfBuffer('RG-1')), semValidade: true },
        { itemId: asoId, arquivoNome: 'aso.pdf', arquivoBase64: toPdfDataUrl(makePdfBuffer('ASO-1')), dataEmissao: '2026-02-01', dataValidade: '2027-02-01', conclusaoAso: 'apto', aptidoesEspecificas: ['trabalho_altura'] },
        { itemId: nr35Id, arquivoNome: 'nr35_borrado.pdf', arquivoBase64: toPdfDataUrl(makePdfBuffer('NR35-V1-BAD')), dataEmissao: '2026-02-01', dataValidade: '2028-02-01' },
        { itemId: ctpsId, arquivoNome: 'ctps.pdf', arquivoBase64: toPdfDataUrl(makePdfBuffer('CTPS-1')), semValidade: true },
      ],
    });

    await service.startReview(ADMIN, created.integration.id);

    // Admin approves 4 of 5 mandatory items -> NO partial officialization!
    for (const id of [pgrId, rgId, asoId, ctpsId]) {
      await service.reviewDocumentItem(ADMIN, created.integration.id, id, { decisao: 'APROVADO' });
    }
    assert.equal(repo.state.employees.length, 2, 'Novo colaborador não pode ser oficializado parcialmente');
    assert.equal(repo.state.documents.length, 0, 'Documentos não podem ser oficializados parcialmente');
    assert.equal(repo.state.exams.length, 0);

    // Attempt partial final approval -> MUST fail 422
    await assert.rejects(
      () => service.approveIntegration(ADMIN, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 422 && err.code === 'MANDATORY_ITEMS_INCOMPLETE'
    );

    // Reject NR-35 & return for correction -> exact document listed in itensPendentesCorrecao
    await service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, {
      decisao: 'REPROVADO',
      motivo: 'Certificado NR-35 borrado e sem assinatura do instrutor.',
    });
    const returned = await service.returnForCorrection(ADMIN, created.integration.id, {
      justificativa: 'Substituir somente o certificado NR-35.',
    });
    assert.equal(returned.integration.status, 'PENDENTE_CORRECAO');
    assert.equal(returned.integration.itensPendentesCorrecao?.length, 1);
    assert.equal(returned.integration.itensPendentesCorrecao?.[0].documentoCodigoCanonico, 'NR-35');
    assert.equal(returned.integration.itensPendentesCorrecao?.[0].itemId, nr35Id);

    // Previously approved 4 documents preserved intact
    for (const id of [pgrId, rgId, asoId, ctpsId]) {
      assert.equal(returned.items.find((x) => x.id === id)!.status, 'APROVADO');
    }

    // Resubmit while NR-35 is still rejected -> MUST fail 422
    await assert.rejects(
      () => service.submitIntegration(SOLICITANTE_A, created.integration.id),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 422 && err.code === 'MANDATORY_DOCUMENTS_INCOMPLETE'
    );

    // Replace ONLY NR-35 -> version history preserved (v1 REPROVADO + v2 ENVIADO)
    const nr35V2Buf = makePdfBuffer('NR35-V2-ASSINADO');
    const upV2 = await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
      itemId: nr35Id,
      arquivoNome: 'nr35_assinado_v2.pdf',
      arquivoBase64: toPdfDataUrl(nr35V2Buf),
      dataEmissao: '2026-02-01',
      dataValidade: '2028-02-01',
    });
    assert.equal(upV2.item.versaoAtual, 2);
    assert.equal(upV2.item.versoes.length, 2);
    assert.equal(upV2.item.versoes[0].status, 'REPROVADO');
    assert.equal(upV2.item.versoes[1].status, 'ENVIADO');

    // Resubmit complete integration -> REENVIADA
    const resubmitted = await service.submitIntegration(SOLICITANTE_A, created.integration.id);
    assert.equal(resubmitted.integration.status, 'REENVIADA');

    // Admin downloads v2 with SHA-256 fidelity, approves NR-35, and finalizes complete approval
    const dlV2 = await service.getDocumentFile(ADMIN, created.integration.id, nr35Id, 2);
    assert.equal(sha256(dlV2.buffer), sha256(nr35V2Buf));

    await service.reviewDocumentItem(ADMIN, created.integration.id, nr35Id, {
      decisao: 'APROVADO',
      dataEmissao: '2026-02-01',
      dataValidade: '2028-02-01',
    });
    const approved = await service.approveIntegration(ADMIN, created.integration.id, {
      justificativa: 'Documentação 100% conferida e aprovada.',
    });
    assert.equal(approved.integration.status, 'APROVADA');

    // Complete atomic officialization happened NOW:
    const newEmp = repo.state.employees.find((e) => e.nomeCompleto === 'Marina Costa Terceirizada');
    assert.ok(newEmp);
    assert.equal(repo.state.documents.length, 3); // PGR + RG + CTPS
    assert.equal(repo.state.exams.length, 1); // ASO
    assert.equal(repo.state.trainings.length, 1); // NR-35

    // Compliance engine recognizes new collaborator as CONFORME
    const compliance = evaluateActivityCompliance({
      company: repo.state.companies[0],
      atividadeIds: ['act-altura'],
      colaboradorIds: [newEmp!.id],
      activityProfiles: repo.state.activityProfiles,
      requirements: repo.state.activityDocumentRequirements,
      employees: repo.state.employees,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: repo.state.epiDeliveries,
      safetyPermits: repo.state.safetyPermits,
      dataReferenciaAtividade: '2026-06-15',
    });
    assert.equal(compliance.podeLiberar, true);

    // PT/APR workflow remains 100% separate and intact: no auto-created PT; creating PT still requires separate APR/PT release flow
    assert.equal(repo.state.safetyPermits.length, 0);
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
    const draftPt = await permitService.createPermitDraft(SOLICITANTE_A, {
      tipo: 'PT',
      titulo: 'Montagem em altura — Marina',
      empresaId: 'comp-a',
      localTrabalho: 'Torre A',
      dataInicio: '2026-06-16',
      dataFim: '2026-06-17',
      atividadeIds: ['act-altura'],
      colaboradorIds: [newEmp!.id],
    });
    // PT starts in elaboracao and still requires formal APR + two-step Admin EHS approval/release!
    assert.equal(draftPt.permit.status, 'elaboracao');
    assert.equal(draftPt.compliance.podeLiberar, true);

    passed++;
    console.log('✅ Test 8 passed: Sem aprovação parcial, correção exata, histórico preservado, oficialização atômica e fluxo PT/APR 100% preservado');
  }

  console.log(`\n🎉 All ${passed}/8 Etapa 5 complete-submission tests passed!`);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
