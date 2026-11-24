import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  IntegrationWorkflowActor,
  IntegrationWorkflowError,
  IntegrationWorkflowService,
  createInMemoryIntegrationRepository,
} from '../backend/integrationWorkflowService';
import {
  InMemoryIntegrationFileStorage,
  LocalPrivateIntegrationFileStorage,
} from '../backend/integrationFileStorage';
import { createApiApp } from '../backend/app';
import {
  MANDATORY_DOCUMENT_CATEGORIES,
  groupItemsByMandatoryCategories,
  suggestDocumentCatalogForFilename,
} from '../src/utils/integrationDocumentCatalog';
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

function makePngBuffer(sizeBytes = 1024): Buffer {
  const sig = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);
  return Buffer.concat([sig, Buffer.alloc(Math.max(0, sizeBytes - sig.length), 0x42)]);
}

function toDataUrl(buf: Buffer, mime: 'application/pdf' | 'image/png' | 'image/jpeg'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

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
      nomeCompleto: 'Maria Oliveira Técnica',
      cpf: '222.333.444-55',
      cargo: 'Eletricista Industrial',
      setor: 'Elétrica',
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
      normasAplicaveis: ['NR-35', 'NR-07', 'NR-06'],
      ativo: true,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'act-eletrica',
      codigo: 'SERV_ELETRICA',
      nome: 'Instalações Elétricas (NR-10)',
      descricao: 'Serviços em baixa e alta tensão',
      nivelRisco: 'critico',
      riscosAssociados: ['Choque elétrico', 'Arco elétrico'],
      exigeAPR: true,
      exigePT: true,
      exigeLOTO: true,
      exigePET: false,
      normasAplicaveis: ['NR-10', 'NR-07'],
      ativo: true,
      criadoPorId: 'admin-ehs-1',
    },
  ];

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
      aptidaoEspecifica: 'Trabalho em Altura',
      palavrasChaveMatch: ['ASO'],
      baseLegal: 'NR-07',
      ativo: true,
      ordemExibicao: 2,
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
      ordemExibicao: 3,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-epi',
      activityId: 'act-altura',
      activityCodigo: 'TRAB_ALTURA',
      documentoCodigoCanonico: 'FICHA_EPI',
      nomeExibicao: 'Ficha de Entrega de EPI',
      escopo: 'colaborador',
      origemColecao: 'epiDeliveries',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['EPI'],
      baseLegal: 'NR-06',
      ativo: true,
      ordemExibicao: 4,
      criadoPorId: 'admin-ehs-1',
    },
    {
      id: 'req-nr10',
      activityId: 'act-eletrica',
      activityCodigo: 'SERV_ELETRICA',
      documentoCodigoCanonico: 'NR-10',
      nomeExibicao: 'Certificado NR-10 — Segurança em Eletricidade',
      escopo: 'colaborador',
      origemColecao: 'trainings',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      palavrasChaveMatch: ['NR-10', 'NR10'],
      baseLegal: 'NR-10',
      ativo: true,
      ordemExibicao: 5,
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
    smartDocs: [],
  };
}

async function runTests() {
  let passed = 0;

  // TEST 1: Criação de protocolo com 1 colaborador e geração automática do checklist
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage });

    const detail = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      observacoes: 'Teste protocolo com 1 colaborador',
    });

    assert.ok(detail.integration.id, 'Protocolo deve retornar ID real persistido');
    assert.match(detail.integration.codigoProtocolo, /^INT-\d{8}-[A-F0-9]{4}$/);
    assert.equal(detail.integration.status, 'RASCUNHO');
    assert.equal(detail.integration.colaboradoresCandidatos.length, 1);
    assert.equal(detail.integration.colaboradoresCandidatos[0].colaboradorId, 'emp-a1');
    // 1 empresa (PGR) + 3 colaborador (ASO, NR-35, FICHA_EPI) = 4 items
    assert.equal(detail.items.length, 4);

    // Verificar ordenação das 4 categorias obrigatórias para o colaborador
    const colabItems = detail.items.filter((i) => i.categoria === 'colaborador');
    const grouped = groupItemsByMandatoryCategories(colabItems);
    assert.deepEqual(
      grouped.map((g) => g.category.id),
      [
        'pessoais_legais',
        'saude_ocupacional',
        'seguranca_trabalho',
        'vinculo_empregaticio',
      ]
    );
    assert.equal(MANDATORY_DOCUMENT_CATEGORIES.length, 4);
    assert.equal(grouped[1].items[0].documentoCodigoCanonico, 'ASO');
    assert.ok(grouped[2].items.some((i) => i.documentoCodigoCanonico === 'NR-35'));
    assert.ok(grouped[2].items.some((i) => i.documentoCodigoCanonico === 'FICHA_EPI'));

    passed++;
    console.log('✅ Test 1 passed: Protocolo com 1 colaborador + checklist + 4 categorias em ordem');
  }

  // TEST 2: Criação de protocolo com múltiplos colaboradores (existentes + novo colaborador)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage });

    const detail = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura', 'act-eletrica'],
      colaboradorIds: ['emp-a1', 'emp-a2'],
      novosColaboradores: [
        {
          nomeCompleto: 'Pedro Terceiro Novo',
          cpf: '333.444.555-66',
          cargo: 'Soldador Industrial',
        },
      ],
    });

    assert.equal(detail.integration.colaboradoresCandidatos.length, 3);
    const emp1Items = detail.items.filter((i) => i.colaboradorId === 'emp-a1');
    const emp2Items = detail.items.filter((i) => i.colaboradorId === 'emp-a2');
    const newCand = detail.integration.colaboradoresCandidatos.find(
      (c) => c.nomeCompleto === 'Pedro Terceiro Novo'
    );
    assert.ok(newCand?.candidateId, 'Novo colaborador deve possuir candidateId persistido');
    const newEmpItems = detail.items.filter((i) => i.colaboradorCandidateId === newCand!.candidateId);

    // Cada colaborador recebe ASO, NR-35, FICHA_EPI, NR-10 = 4 itens
    assert.equal(emp1Items.length, 4);
    assert.equal(emp2Items.length, 4);
    assert.equal(newEmpItems.length, 4);

    passed++;
    console.log('✅ Test 2 passed: Protocolo com múltiplos colaboradores (existentes + novo candidato)');
  }

  // TEST 3: Upload de múltiplos arquivos para colaboradores diferentes SEM contaminação cruzada (fix Bug #6)
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1', 'emp-a2'],
    });

    const integrationId = created.integration.id;
    const asoEmp1Buf = makePdfBuffer('ASO-EMP-1');
    const nr35Emp1Buf = makePdfBuffer('NR35-EMP-1');
    const rgEmp1Buf = makePngBuffer(1500);
    const asoEmp2Buf = makePdfBuffer('ASO-EMP-2');
    const nr35Emp2Buf = makePdfBuffer('NR35-EMP-2');

    // Enviar sem itemId explícito (testando auto-match rigorosamente isolado por colaborador!)
    const up1 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'ASO',
      arquivoNome: 'aso_generico.pdf',
      arquivoBase64: toDataUrl(asoEmp1Buf, 'application/pdf'),
    });
    assert.equal(up1.item.colaboradorId, 'emp-a1');
    assert.equal(up1.item.documentoCodigoCanonico, 'ASO');

    // Enviar ASO para emp-a2 com nome genérico (NÃO pode sobrescrever item de emp-a1!)
    const up2 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a2',
      documentoCodigoCanonico: 'ASO',
      arquivoNome: 'aso_generico.pdf',
      arquivoBase64: toDataUrl(asoEmp2Buf, 'application/pdf'),
    });
    assert.equal(up2.item.colaboradorId, 'emp-a2');
    assert.notEqual(up2.item.id, up1.item.id, 'ASO de emp-a2 não pode sobrescrever item de emp-a1');

    // Enviar NR-35 para emp-a1 e emp-a2
    const up3 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      arquivoNome: 'certificado_nr35.pdf',
      arquivoBase64: toDataUrl(nr35Emp1Buf, 'application/pdf'),
    });
    assert.equal(up3.item.colaboradorId, 'emp-a1');
    assert.equal(up3.item.documentoCodigoCanonico, 'NR-35');

    const up4 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a2',
      arquivoNome: 'certificado_nr35.pdf',
      arquivoBase64: toDataUrl(nr35Emp2Buf, 'application/pdf'),
    });
    assert.equal(up4.item.colaboradorId, 'emp-a2');
    assert.equal(up4.item.documentoCodigoCanonico, 'NR-35');
    assert.notEqual(up4.item.id, up3.item.id);

    // Enviar RG (Categoria 1 - Documentos Pessoais e Legais) adicional para emp-a1
    const suggestion = suggestDocumentCatalogForFilename('rg_frente_verso.png', []);
    assert.equal(suggestion.categoriaId, 'pessoais_legais');
    const up5 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      categoriaOrganizacional: suggestion.categoriaId,
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: suggestion.codigoCanonico,
      nomeExibicao: suggestion.nomeExibicao,
      origemColecao: suggestion.origemColecao,
      arquivoNome: 'rg_frente_verso.png',
      arquivoBase64: toDataUrl(rgEmp1Buf, 'image/png'),
    });
    assert.equal(up5.item.colaboradorId, 'emp-a1');
    assert.equal(up5.item.categoriaOrganizacional, 'pessoais_legais');

    // Bloqueio explícito caso alguém tente enviar itemId de emp-a1 passando colaboradorId = emp-a2
    await assert.rejects(
      () =>
        service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          itemId: up1.item.id,
          categoria: 'colaborador',
          colaboradorId: 'emp-a2',
          arquivoNome: 'tentativa_cruzada.pdf',
          arquivoBase64: toDataUrl(asoEmp2Buf, 'application/pdf'),
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.code === 'ITEM_COLLABORATOR_MISMATCH'
    );

    // Garantir que nenhum arquivo Base64 foi gravado nos metadados do repositório
    const rawDetail = await service.getIntegrationDetail(SOLICITANTE_A, integrationId);
    for (const item of rawDetail.items) {
      assert.equal(item.arquivoUrl || '', '', 'Nenhum Base64 pode ser gravado em item.arquivoUrl');
      for (const v of item.versoes) {
        assert.equal(v.arquivoUrl || '', '', 'Nenhum Base64 pode ser gravado em versoes[].arquivoUrl');
      }
    }

    // Completar documento obrigatório remanescente da empresa (PGR) e submeter para análise do Admin EHS
    for (const rem of rawDetail.items.filter((i) => i.obrigatorio && !i.arquivoNome)) {
      await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
        itemId: rem.id,
        arquivoNome: `${rem.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toDataUrl(makePdfBuffer(`REM-${rem.documentoCodigoCanonico}`), 'application/pdf'),
      });
    }
    await service.submitIntegration(SOLICITANTE_A, integrationId);

    // Conferência pelo Admin EHS: consulta e download de todos os binários com integridade SHA-256
    const adminDetail = await service.getIntegrationDetail(ADMIN, integrationId);
    assert.equal(adminDetail.integration.id, integrationId);
    const adminFileEmp1 = await service.getDocumentFile(ADMIN, integrationId, up1.item.id);
    const adminFileEmp2 = await service.getDocumentFile(ADMIN, integrationId, up2.item.id);
    assert.equal(sha256(adminFileEmp1.buffer), sha256(asoEmp1Buf));
    assert.equal(sha256(adminFileEmp2.buffer), sha256(asoEmp2Buf));
    assert.notEqual(sha256(adminFileEmp1.buffer), sha256(adminFileEmp2.buffer));

    passed++;
    console.log('✅ Test 3 passed: Multi-file upload para colaboradores distintos sem contaminação cruzada + conferência Admin EHS');
  }

  // TEST 4: Reenvio de arquivo com falha preservando os arquivos já enviados com sucesso
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage });

    const created = await service.createIntegration(SOLICITANTE_A, {
      tipo: 'INTEGRACAO_INICIAL',
      empresaId: 'comp-a',
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
    });
    const id = created.integration.id;

    // Arquivo 1 válido (sucesso)
    const okPdf = makePdfBuffer('ASO-VALIDO');
    const res1 = await service.uploadSingleDocument(SOLICITANTE_A, id, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'ASO',
      arquivoNome: 'aso_valido.pdf',
      arquivoBase64: toDataUrl(okPdf, 'application/pdf'),
    });
    assert.equal(res1.item.status, 'ENVIADO');

    // Arquivo 2 com conteúdo corrompido/falso PDF (falha)
    await assert.rejects(
      () =>
        service.uploadSingleDocument(SOLICITANTE_A, id, {
          categoria: 'colaborador',
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'NR-35',
          arquivoNome: 'nr35_corrompido.pdf',
          arquivoBase64: 'data:application/pdf;base64,' + Buffer.from('NOT-A-PDF').toString('base64'),
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 400
    );

    // Arquivo 1 permanece intacto após falha do Arquivo 2
    const afterPartialFail = await service.getIntegrationDetail(SOLICITANTE_A, id);
    const savedAso = afterPartialFail.items.find((i) => i.id === res1.item.id)!;
    assert.equal(savedAso.status, 'ENVIADO');
    assert.equal(savedAso.arquivoNome, 'aso_valido.pdf');

    // Reenvio apenas do Arquivo 2 corrigido (sem reenviar Arquivo 1)
    const fixedNr35 = makePdfBuffer('NR35-CORRIGIDO');
    const res2 = await service.uploadSingleDocument(SOLICITANTE_A, id, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'NR-35',
      arquivoNome: 'nr35_corrigido.pdf',
      arquivoBase64: toDataUrl(fixedNr35, 'application/pdf'),
    });
    assert.equal(res2.item.status, 'ENVIADO');
    assert.equal(res2.integration.resumoItens.enviados, 2);

    passed++;
    console.log('✅ Test 4 passed: Reenvio apenas do arquivo com falha preservando os enviados');
  }

  // TEST 5: Persistência após recarregamento da página (F5) usando storage privado em disco
  {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ehs-more-refresh-test-'));
    try {
      const repo = createInMemoryIntegrationRepository(buildSeed());
      const storage = new LocalPrivateIntegrationFileStorage(tmpDir);
      const serviceBeforeReload = new IntegrationWorkflowService({ repo, fileStorage: storage });

      const created = await serviceBeforeReload.createIntegration(SOLICITANTE_A, {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: 'comp-a',
        atividadeIds: ['act-altura'],
        colaboradorIds: ['emp-a1'],
      });
      const persistedId = created.integration.id;

      const pdfBuf = makePdfBuffer('PERSISTED-AFTER-F5');
      const uploaded = await serviceBeforeReload.uploadSingleDocument(SOLICITANTE_A, persistedId, {
        categoria: 'colaborador',
        colaboradorId: 'emp-a1',
        documentoCodigoCanonico: 'ASO',
        arquivoNome: 'aso_persistente.pdf',
        arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
      });

      // Simular F5: nova instância de serviço consultando o mesmo repositório & storage com o ID salvo
      const serviceAfterReload = new IntegrationWorkflowService({ repo, fileStorage: storage });
      const listedAfterReload = await serviceAfterReload.listIntegrations(SOLICITANTE_A);
      assert.ok(listedAfterReload.some((i) => i.id === persistedId));

      const detailAfterReload = await serviceAfterReload.getIntegrationDetail(SOLICITANTE_A, persistedId);
      assert.equal(detailAfterReload.integration.codigoProtocolo, created.integration.codigoProtocolo);
      const reloadedItem = detailAfterReload.items.find((i) => i.id === uploaded.item.id)!;
      assert.equal(reloadedItem.status, 'ENVIADO');
      assert.equal(reloadedItem.arquivoNome, 'aso_persistente.pdf');

      const reloadedBinary = await serviceAfterReload.getDocumentFile(SOLICITANTE_A, persistedId, uploaded.item.id);
      assert.equal(sha256(reloadedBinary.buffer), sha256(pdfBuf));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }

    passed++;
    console.log('✅ Test 5 passed: Persistência integral de protocolo, checklist e anexos após recarregamento');
  }

  // TEST 6: Validação de erro sem falso sucesso e sem protocolo órfão
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const storage = new InMemoryIntegrationFileStorage();
    const service = new IntegrationWorkflowService({ repo, fileStorage: storage });

    // Sem atividade selecionada
    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_A, {
          tipo: 'INTEGRACAO_INICIAL',
          empresaId: 'comp-a',
          atividadeIds: [],
          colaboradorIds: ['emp-a1'],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.code === 'ACTIVITY_REQUIRED'
    );

    // Novo colaborador com CPF inválido
    await assert.rejects(
      () =>
        service.createIntegration(SOLICITANTE_A, {
          tipo: 'INTEGRACAO_INICIAL',
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
          novosColaboradores: [{ nomeCompleto: 'Teste', cpf: '123', cargo: 'Ajudante' }],
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.code === 'INVALID_EMPLOYEE_DATA'
    );

    // Nenhum protocolo órfão foi gravado
    const all = await service.listIntegrations(SOLICITANTE_A);
    assert.equal(all.length, 0);

    passed++;
    console.log('✅ Test 6 passed: Validação falha sem criar protocolo órfão e sem falso sucesso');
  }

  // TEST 7: Falha fail-closed de Firestore permission-denied e proteção JWT na API
  {
    const repo = createInMemoryIntegrationRepository(buildSeed());
    const permissionError = Object.assign(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    const brokenRepo = {
      ...repo,
      listIntegrations: async () => {
        throw permissionError;
      },
      listActivityProfiles: async () => {
        throw permissionError;
      },
    };
    const brokenService = new IntegrationWorkflowService({
      repo: brokenRepo,
      fileStorage: new InMemoryIntegrationFileStorage(),
    });

    const prevSecret = process.env.API_AUTH_SECRET;
    process.env.API_AUTH_SECRET = 'test-only-ephemeral-secret-for-checklist-flow-suite-32chars!';
    const app = createApiApp({ integrationWorkflowService: brokenService });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const resp = await fetch(`http://127.0.0.1:${address.port}/api/integrations`);
      assert.equal(resp.status, 401, 'Rota protegida deve exigir JWT');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (prevSecret === undefined) {
        delete process.env.API_AUTH_SECRET;
      } else {
        process.env.API_AUTH_SECRET = prevSecret;
      }
    }

    // Validar que o service propaga permission-denied (fail-closed, sem criar falso protocolo)
    await assert.rejects(
      () =>
        brokenService.createIntegration(SOLICITANTE_A, {
          tipo: 'INTEGRACAO_INICIAL',
          empresaId: 'comp-a',
          atividadeIds: ['act-altura'],
          colaboradorIds: ['emp-a1'],
        }),
      (err: any) => err?.code === 'permission-denied'
    );

    passed++;
    console.log('✅ Test 7 passed: Falha fail-closed de Firestore permission-denied preservada e rota protegida por JWT');
  }

  console.log(`\n🎉 ALL ${passed}/${passed} INTEGRATION CHECKLIST & ATTACHMENT FLOW TESTS PASSED!`);
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
