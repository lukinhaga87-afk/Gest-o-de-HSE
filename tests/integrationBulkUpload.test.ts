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
  IntegrationStorageUnavailableError,
  LocalPrivateIntegrationFileStorage,
  sanitizeDownloadFileName,
  validateBinaryMagicBytes,
} from '../backend/integrationFileStorage';
import { createApiApp } from '../backend/app';
import { evaluateActivityCompliance } from '../src/utils/activityComplianceEngine';
import {
  EMPLOYEE_DOCUMENT_CATALOG,
  MANDATORY_DOCUMENT_CATEGORIES,
  groupItemsByMandatoryCategories,
} from '../src/utils/integrationDocumentCatalog';
import type {
  ActivityDocumentRequirement,
  ActivityProfile,
  Company,
  Employee,
} from '../src/types/sst';

// =============================================================================
// FIXTURES & BINARY HELPERS
// =============================================================================

function makePdfBuffer(sizeBytes: number, tag = 'EHS-MORE'): Buffer {
  const header = Buffer.from(`%PDF-1.4\n%${tag}\n`, 'latin1');
  const footer = Buffer.from('\n%%EOF', 'latin1');
  const padLen = Math.max(0, sizeBytes - header.length - footer.length);
  const pad = Buffer.alloc(padLen, 0x20);
  return Buffer.concat([header, pad, footer]);
}

function makePngBuffer(sizeBytes = 1024): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);
  const pad = Buffer.alloc(Math.max(0, sizeBytes - signature.length), 0x41);
  return Buffer.concat([signature, pad]);
}

function makeJpegBuffer(sizeBytes = 1024): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const footer = Buffer.from([0xff, 0xd9]);
  const pad = Buffer.alloc(Math.max(0, sizeBytes - header.length - footer.length), 0x55);
  return Buffer.concat([header, pad, footer]);
}

function toDataUrl(buffer: Buffer, mime: 'application/pdf' | 'image/jpeg' | 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function sha256Of(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

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
      id: 'req-aso',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'ASO — Atestado de Saúde Ocupacional',
      documentoCodigoCanonico: 'ASO',
      palavrasChaveMatch: ['aso', 'saude ocupacional'],
      escopo: 'colaborador',
      origemColecao: 'exams',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-07',
      ordemExibicao: 2,
      ativo: true,
      criadoPorId: 'admin-1',
    },
    {
      id: 'req-nr35',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'Certificado NR-35 — Trabalho em Altura',
      documentoCodigoCanonico: 'NR35',
      palavrasChaveMatch: ['nr-35', 'nr35', 'altura'],
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
      id: 'req-epi',
      activityId: 'act-altura',
      activityCodigo: 'TRABALHO_ALTURA',
      nomeExibicao: 'Ficha de Entrega de EPI',
      documentoCodigoCanonico: 'FICHA_EPI',
      palavrasChaveMatch: ['ficha de entrega de epi', 'ficha de epi', 'entrega de epi'],
      escopo: 'colaborador',
      origemColecao: 'epiDeliveries',
      funcoesAplicaveis: [],
      obrigatorioParaLiberacao: true,
      baseLegal: 'NR-06',
      ordemExibicao: 4,
      ativo: true,
      criadoPorId: 'admin-1',
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

const fixedNow = () => new Date('2026-06-15T12:00:00.000Z');

async function createTestContext() {
  const repo = createInMemoryIntegrationRepository(buildSeed());
  const storage = new InMemoryIntegrationFileStorage();
  const service = new IntegrationWorkflowService({
    repo,
    fileStorage: storage,
    nowProvider: fixedNow,
  });
  const detail = await service.createIntegration(SOLICITANTE_A, {
    tipo: 'INTEGRACAO_INICIAL',
    empresaId: 'comp-a',
    atividadeIds: ['act-altura'],
    colaboradorIds: ['emp-a1'],
  });
  return { repo, storage, service, integrationId: detail.integration.id, detail };
}

function assertNoBase64StoredInRepo(repo: ReturnType<typeof createInMemoryIntegrationRepository>) {
  for (const item of repo.state.items) {
    assert.ok(
      !String(item.arquivoUrl || '').startsWith('data:'),
      `Item ${item.id} não pode conter Base64 em arquivoUrl no Firestore.`
    );
    for (const v of item.versoes || []) {
      assert.ok(
        !String(v.arquivoUrl || '').startsWith('data:'),
        `Versão ${v.versao} do item ${item.id} não pode conter Base64 em arquivoUrl no Firestore.`
      );
    }
  }
}

async function main() {
  let passed = 0;

  async function runTest(name: string, fn: () => Promise<void>) {
    await fn();
    passed += 1;
    console.log(`✅ [PASS ${passed}/12] ${name}`);
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Upload de 1 documento
  // ---------------------------------------------------------------------------
  await runTest('1. Upload de 1 documento com metadados no repositório e binário no storage privado (zero Base64)', async () => {
    const { repo, storage, service, integrationId, detail } = await createTestContext();
    const asoItem = detail.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
    assert.ok(asoItem);

    const pdfBuf = makePdfBuffer(12 * 1024, 'ASO-V1');
    const result = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      itemId: asoItem.id,
      arquivoNome: 'aso_joao_silva.pdf',
      arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
      dataEmissao: '2026-06-01',
      dataValidade: '2027-06-01',
    });

    assert.equal(result.item.status, 'ENVIADO');
    assert.equal(result.item.versaoAtual, 1);
    assert.equal(result.item.hasStoredFile, true);
    assert.equal(result.item.arquivoUrl, '');
    assert.equal((result.item as any).storageKey, undefined, 'storageKey interno não pode vazar na resposta da API');
    assert.equal(result.item.arquivoHashSha256, sha256Of(pdfBuf));
    assert.equal(result.item.categoriaOrganizacional, 'saude_ocupacional');
    assert.equal(storage.count(), 1);
    assertNoBase64StoredInRepo(repo);

    // Retrieve binary and verify integrity
    const retrieved = await service.getDocumentFile(SOLICITANTE_A, integrationId, asoItem.id);
    assert.equal(retrieved.sizeBytes, pdfBuf.length);
    assert.equal(sha256Of(retrieved.buffer), sha256Of(pdfBuf));
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Upload simultâneo de 10 documentos (fila concorrente com mutex)
  // ---------------------------------------------------------------------------
  await runTest('2. Upload simultâneo de 10 documentos em paralelo sem conflito de concorrência', async () => {
    const { repo, storage, service, integrationId } = await createTestContext();

    const files = Array.from({ length: 10 }, (_, idx) => {
      const buf = makePdfBuffer(8192 + idx * 100, `DOC-CONC-${idx + 1}`);
      return {
        categoria: 'colaborador' as const,
        colaboradorId: 'emp-a1',
        documentoCodigoCanonico: `DOC_EXTRA_${idx + 1}`,
        nomeExibicao: `Documento Obrigatório ${idx + 1}`,
        categoriaOrganizacional:
          idx < 3
            ? ('pessoais_legais' as const)
            : idx < 5
              ? ('saude_ocupacional' as const)
              : idx < 8
                ? ('seguranca_trabalho' as const)
                : ('vinculo_empregaticio' as const),
        arquivoNome: `doc_${idx + 1}.pdf`,
        arquivoBase64: toDataUrl(buf, 'application/pdf'),
        dataEmissao: '2026-06-01',
        dataValidade: '2027-06-01',
      };
    });

    // Dispatch all 10 concurrently (simulating multiple simultaneous HTTP requests)
    const results = await Promise.all(
      files.map((f) => service.uploadSingleDocument(SOLICITANTE_A, integrationId, f))
    );

    assert.equal(results.length, 10);
    assert.equal(storage.count(), 10);
    assertNoBase64StoredInRepo(repo);

    const refreshed = await service.getIntegrationDetail(SOLICITANTE_A, integrationId);
    const uploadedExtras = refreshed.items.filter((i) =>
      i.documentoCodigoCanonico.startsWith('DOC_EXTRA_')
    );
    assert.equal(uploadedExtras.length, 10);
    assert.ok(uploadedExtras.every((i) => i.status === 'ENVIADO' && i.hasStoredFile));
    assert.equal(refreshed.integration.resumoItens.enviados, 10);
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Upload de 50 documentos para um colaborador (sem limite artificial)
  // ---------------------------------------------------------------------------
  await runTest('3. Upload de 50 documentos para um colaborador sem limite artificial de quantidade', async () => {
    const { repo, storage, service, integrationId } = await createTestContext();

    // Run with controlled concurrency = 2 (matching frontend queue)
    const total = 50;
    let cursor = 0;
    const uploadedIds: string[] = [];

    const worker = async () => {
      while (cursor < total) {
        const idx = cursor++;
        const buf = makePdfBuffer(4096 + idx * 17, `BULK50-${idx + 1}`);
        const res = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          categoria: 'colaborador',
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: `CERT_LOTE_${idx + 1}`,
          nomeExibicao: `Certificado Operacional #${idx + 1}`,
          categoriaOrganizacional: 'seguranca_trabalho',
          arquivoNome: `certificado_${idx + 1}.pdf`,
          arquivoBase64: toDataUrl(buf, 'application/pdf'),
        });
        uploadedIds.push(res.item.id);
      }
    };

    await Promise.all([worker(), worker()]);

    assert.equal(uploadedIds.length, 50);
    assert.equal(new Set(uploadedIds).size, 50);
    assert.equal(storage.count(), 50);
    assertNoBase64StoredInRepo(repo);

    const detail = await service.getIntegrationDetail(SOLICITANTE_A, integrationId);
    assert.equal(detail.integration.resumoItens.enviados, 50);
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Upload de PDF, JPEG e PNG + bloqueio de spoofing (magic bytes)
  // ---------------------------------------------------------------------------
  await runTest('4. Upload de arquivos PDF, JPEG e PNG válidos + rejeição de MIME falsificado (magic bytes)', async () => {
    const { storage, service, integrationId } = await createTestContext();

    const pdfBuf = makePdfBuffer(6000, 'FORMAT-PDF');
    const jpgBuf = makeJpegBuffer(6000);
    const pngBuf = makePngBuffer(6000);

    const rPdf = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'RG_CNH',
      nomeExibicao: 'RG ou CNH',
      arquivoNome: 'rg.pdf',
      arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
    });
    const rJpg = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'CPF',
      nomeExibicao: 'CPF',
      arquivoNome: 'cpf.jpg',
      arquivoBase64: toDataUrl(jpgBuf, 'image/jpeg'),
    });
    const rPng = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'ORDEM_SERVICO',
      nomeExibicao: 'Ordem de Serviço de Segurança',
      arquivoNome: 'os_seguranca.png',
      arquivoBase64: toDataUrl(pngBuf, 'image/png'),
    });

    assert.equal(rPdf.item.arquivoMimeType, 'application/pdf');
    assert.equal(rJpg.item.arquivoMimeType, 'image/jpeg');
    assert.equal(rPng.item.arquivoMimeType, 'image/png');
    assert.equal(storage.count(), 3);

    // Spoofed PDF (plain text disguised as application/pdf) must be rejected
    const fakePdf = Buffer.from('<script>alert("xss")</script> not a real pdf');
    assert.equal(validateBinaryMagicBytes(fakePdf, 'application/pdf'), false);
    await assert.rejects(
      () =>
        service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          categoria: 'colaborador',
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'OUTRO_LEGAL',
          arquivoNome: 'spoof.pdf',
          arquivoBase64: toDataUrl(fakePdf, 'application/pdf'),
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 400 &&
        (err.code === 'INVALID_PDF' || err.code === 'INVALID_FILE_SIGNATURE')
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Upload de arquivos de 200 KB, 1 MB e 4 MB (elimina descarte > 450 KB)
  // ---------------------------------------------------------------------------
  await runTest('5. Upload íntegro de arquivos de 200 KB, 1 MB e 4 MB (sem descarte > 450 KB) + bloqueio > 4 MB', async () => {
    const { repo, storage, service, integrationId } = await createTestContext();

    const buf200k = makePdfBuffer(200 * 1024, 'SIZE-200KB');
    const buf1m = makePdfBuffer(1 * 1024 * 1024, 'SIZE-1MB');
    const buf4m = makePdfBuffer(4 * 1024 * 1024, 'SIZE-4MB');

    const res200 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'DOC_200KB',
      nomeExibicao: 'Documento 200 KB',
      arquivoNome: 'doc_200kb.pdf',
      arquivoBase64: toDataUrl(buf200k, 'application/pdf'),
    });
    const res1m = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'DOC_1MB',
      nomeExibicao: 'Documento 1 MB',
      arquivoNome: 'doc_1mb.pdf',
      arquivoBase64: toDataUrl(buf1m, 'application/pdf'),
    });
    const res4m = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'DOC_4MB',
      nomeExibicao: 'Documento 4 MB',
      arquivoNome: 'doc_4mb.pdf',
      arquivoBase64: toDataUrl(buf4m, 'application/pdf'),
    });

    assert.equal(storage.count(), 3);
    assertNoBase64StoredInRepo(repo);

    // Retrieve all 3 as Solicitante (draft is hidden from Admin EHS until complete submission) and assert exact byte-for-byte integrity
    const dl200 = await service.getDocumentFile(SOLICITANTE_A, integrationId, res200.item.id);
    const dl1m = await service.getDocumentFile(SOLICITANTE_A, integrationId, res1m.item.id);
    const dl4m = await service.getDocumentFile(SOLICITANTE_A, integrationId, res4m.item.id);

    assert.equal(dl200.sizeBytes, 200 * 1024);
    assert.equal(sha256Of(dl200.buffer), sha256Of(buf200k));
    assert.equal(dl1m.sizeBytes, 1 * 1024 * 1024);
    assert.equal(sha256Of(dl1m.buffer), sha256Of(buf1m));
    assert.equal(dl4m.sizeBytes, 4 * 1024 * 1024);
    assert.equal(sha256Of(dl4m.buffer), sha256Of(buf4m));

    // > 4 MB rejected cleanly with HTTP 413
    const bufOver = makePdfBuffer(4 * 1024 * 1024 + 1024, 'OVER-LIMIT');
    await assert.rejects(
      () =>
        service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          categoria: 'colaborador',
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'DOC_OVER',
          arquivoNome: 'doc_over.pdf',
          arquivoBase64: toDataUrl(bufOver, 'application/pdf'),
        }),
      (err: any) => err instanceof IntegrationWorkflowError && err.statusCode === 413
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 6 & TEST 7: Falha parcial no lote + Reenvio apenas do arquivo com falha
  // ---------------------------------------------------------------------------
  await runTest('6. Falha em 1 arquivo durante envio em lote não prejudica os demais arquivos válidos', async () => {
    const { storage, service, integrationId } = await createTestContext();

    const queue = [
      {
        key: 'rg',
        payload: {
          categoria: 'colaborador' as const,
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'RG_CNH',
          nomeExibicao: 'RG ou CNH',
          arquivoNome: 'rg_valido.pdf',
          arquivoBase64: toDataUrl(makePdfBuffer(5000, 'RG'), 'application/pdf'),
        },
      },
      {
        key: 'corrompido',
        payload: {
          categoria: 'colaborador' as const,
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'REGISTRO_EMPREGADO',
          nomeExibicao: 'Registro de Empregado',
          arquivoNome: 'registro_corrompido.pdf',
          arquivoBase64: toDataUrl(Buffer.from('CORRUPTED_NOT_A_PDF'), 'application/pdf'),
        },
      },
      {
        key: 'contrato',
        payload: {
          categoria: 'colaborador' as const,
          colaboradorId: 'emp-a1',
          documentoCodigoCanonico: 'CONTRATO_TRABALHO',
          nomeExibicao: 'Contrato de Trabalho',
          arquivoNome: 'contrato_valido.pdf',
          arquivoBase64: toDataUrl(makePdfBuffer(7000, 'CONTRATO'), 'application/pdf'),
        },
      },
    ];

    const outcomes: Array<{ key: string; ok: boolean; error?: string }> = [];
    for (const entry of queue) {
      try {
        await service.uploadSingleDocument(SOLICITANTE_A, integrationId, entry.payload);
        outcomes.push({ key: entry.key, ok: true });
      } catch (err: any) {
        outcomes.push({ key: entry.key, ok: false, error: err?.message });
      }
    }

    assert.equal(outcomes.filter((o) => o.ok).length, 2);
    assert.equal(outcomes.filter((o) => !o.ok).length, 1);
    assert.equal(outcomes.find((o) => o.key === 'corrompido')?.ok, false);
    assert.equal(storage.count(), 2);
  });

  await runTest('7. Reenvio do arquivo com falha conclui o lote mantendo os arquivos enviados anteriormente', async () => {
    const { storage, service, integrationId } = await createTestContext();

    // First pass: 2 succeed, 1 fails
    const ok1 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'RG_CNH',
      nomeExibicao: 'RG ou CNH',
      arquivoNome: 'rg.pdf',
      arquivoBase64: toDataUrl(makePdfBuffer(4000, 'RG-1'), 'application/pdf'),
    });
    let failedOnce = false;
    try {
      await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
        categoria: 'colaborador',
        colaboradorId: 'emp-a1',
        documentoCodigoCanonico: 'REGISTRO_EMPREGADO',
        nomeExibicao: 'Registro de Empregado',
        arquivoNome: 'registro_bad.pdf',
        arquivoBase64: toDataUrl(Buffer.from('BAD'), 'application/pdf'),
      });
    } catch {
      failedOnce = true;
    }
    const ok2 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'CONTRATO_TRABALHO',
      nomeExibicao: 'Contrato de Trabalho',
      arquivoNome: 'contrato.pdf',
      arquivoBase64: toDataUrl(makePdfBuffer(4500, 'CTR-1'), 'application/pdf'),
    });

    assert.equal(failedOnce, true);
    assert.equal(storage.count(), 2);

    // Retry ONLY the failed file with a valid PDF
    const retried = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'REGISTRO_EMPREGADO',
      nomeExibicao: 'Registro de Empregado',
      arquivoNome: 'registro_ok.pdf',
      arquivoBase64: toDataUrl(makePdfBuffer(5500, 'REG-OK'), 'application/pdf'),
    });

    assert.equal(retried.item.status, 'ENVIADO');
    assert.equal(storage.count(), 3);

    // Earlier succeeded files remain intact and retrievable
    const dl1 = await service.getDocumentFile(SOLICITANTE_A, integrationId, ok1.item.id);
    const dl2 = await service.getDocumentFile(SOLICITANTE_A, integrationId, ok2.item.id);
    const dl3 = await service.getDocumentFile(SOLICITANTE_A, integrationId, retried.item.id);
    assert.equal(dl1.fileName, 'rg.pdf');
    assert.equal(dl2.fileName, 'contrato.pdf');
    assert.equal(dl3.fileName, 'registro_ok.pdf');
  });

  // ---------------------------------------------------------------------------
  // TEST 8: Renovação de documento já aprovado (preserva histórico e oficial)
  // ---------------------------------------------------------------------------
  await runTest('8. Renovação de documento já aprovado preserva versão anterior e exige nova aprovação do Admin EHS', async () => {
    const { repo, storage, service, integrationId, detail } = await createTestContext();
    const asoItem = detail.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
    const mandatoryItems = detail.items.filter((i) => i.obrigatorio);
    const v1Buf = makePdfBuffer(10_000, 'ASO-V1-APPROVED');
    const v2Buf = makePdfBuffer(12_000, 'ASO-V2-RENEWAL');

    for (const item of mandatoryItems) {
      if (item.id === asoItem.id) {
        await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          itemId: asoItem.id,
          arquivoNome: 'aso_v1.pdf',
          arquivoBase64: toDataUrl(v1Buf, 'application/pdf'),
          dataEmissao: '2026-01-10',
          dataValidade: '2027-01-10',
          conclusaoAso: 'apto',
          aptidoesEspecificas: ['trabalho_altura'],
        });
      } else {
        await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
          itemId: item.id,
          arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}_v1.pdf`,
          arquivoBase64: toDataUrl(makePdfBuffer(6000, `V1-${item.documentoCodigoCanonico}`), 'application/pdf'),
          dataEmissao: '2026-01-10',
          dataValidade: '2027-01-10',
        });
      }
    }

    // Submit complete package and Admin approves all mandatory docs + finalizes integration
    await service.submitIntegration(SOLICITANTE_A, integrationId);
    for (const item of mandatoryItems) {
      await service.reviewDocumentItem(ADMIN, integrationId, item.id, {
        decisao: 'APROVADO',
        observacoes: 'Conferido e aprovado.',
      });
    }
    await service.approveIntegration(ADMIN, integrationId);

    assert.equal(repo.state.exams.length, 1);
    assert.equal(repo.state.exams[0].situacao, 'aprovado');
    assert.equal(repo.state.exams[0].anexoNome, 'aso_v1.pdf');
    assert.ok(
      String(repo.state.exams[0].anexoUrl || '').startsWith('/api/integrations/'),
      'Registro oficial deve salvar caminho protegido da API, jamais Base64'
    );

    // Solicitante renews ASO with v2
    const renewedDetail = await service.renewIntegrationItem(SOLICITANTE_A, integrationId, asoItem.id, {
      arquivoNome: 'aso_v2.pdf',
      arquivoBase64: toDataUrl(v2Buf, 'application/pdf'),
      dataEmissao: '2026-06-15',
      dataValidade: '2027-06-15',
      observacoes: 'Novo exame periódico anual',
    });

    const renewedItem = renewedDetail.items.find((i) => i.id === asoItem.id)!;
    assert.equal(renewedItem.versaoAtual, 2);
    assert.equal(renewedItem.status, 'ENVIADO');
    assert.equal(renewedItem.versoes.length, 2);
    assert.equal(renewedItem.versoes[0].status, 'APROVADO');
    assert.equal(renewedItem.versoes[1].status, 'ENVIADO');
    assert.equal(storage.count(), mandatoryItems.length + 1);
    assertNoBase64StoredInRepo(repo);

    // Official exam collection MUST still reflect v1 until Admin approves v2
    assert.equal(repo.state.exams.length, 1);
    assert.equal(repo.state.exams[0].anexoNome, 'aso_v1.pdf');
  });

  // ---------------------------------------------------------------------------
  // TEST 9: Acesso autenticado do Admin EHS (download/preview, disco local e fail-closed Netlify)
  // ---------------------------------------------------------------------------
  await runTest('9. Acesso autenticado do Admin EHS (preview/download por versão, storage local seguro e fail-closed em serverless)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ehs-more-private-storage-'));
    try {
      const repo = createInMemoryIntegrationRepository(buildSeed());
      const localDiskStorage = new LocalPrivateIntegrationFileStorage(tmpDir);
      const service = new IntegrationWorkflowService({
        repo,
        fileStorage: localDiskStorage,
        nowProvider: fixedNow,
      });

      const created = await service.createIntegration(SOLICITANTE_A, {
        tipo: 'INTEGRACAO_INICIAL',
        empresaId: 'comp-a',
        atividadeIds: ['act-altura'],
        colaboradorIds: ['emp-a1'],
      });
      const asoItem = created.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
      const pdfBuf = makePdfBuffer(900 * 1024, 'LOCAL-DISK-900KB');

      await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
        itemId: asoItem.id,
        arquivoNome: '../../../ataque_path_traversal_aso.pdf',
        arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
        dataEmissao: '2026-06-01',
        dataValidade: '2027-06-01',
      });
      // Complete remaining mandatory documents and submit so Admin EHS can access the integration
      for (const rem of created.items.filter((i) => i.obrigatorio && i.id !== asoItem.id)) {
        await service.uploadSingleDocument(SOLICITANTE_A, created.integration.id, {
          itemId: rem.id,
          arquivoNome: `${rem.documentoCodigoCanonico.toLowerCase()}.pdf`,
          arquivoBase64: toDataUrl(makePdfBuffer(4096, `REM-${rem.documentoCodigoCanonico}`), 'application/pdf'),
        });
      }
      await service.submitIntegration(SOLICITANTE_A, created.integration.id);

      // Verify sanitized filename and disk retrieval by Admin EHS
      const retrieved = await service.getDocumentFile(ADMIN, created.integration.id, asoItem.id, 1);
      assert.equal(retrieved.sizeBytes, pdfBuf.length);
      assert.equal(sha256Of(retrieved.buffer), sha256Of(pdfBuf));
      assert.equal(sanitizeDownloadFileName(retrieved.fileName), 'ataque_path_traversal_aso.pdf');

      // Verify HTTP endpoint requires JWT (unauthenticated -> 401)
      process.env.API_AUTH_SECRET = 'test-secret-bulk-upload-32-chars-minimum!!';
      const app = createApiApp({ integrationWorkflowService: service });
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;
      try {
        const resFileUnauth = await fetch(
          `http://127.0.0.1:${port}/api/integrations/${created.integration.id}/items/${asoItem.id}/file`
        );
        assert.equal(resFileUnauth.status, 401);

        const resUploadUnauth = await fetch(
          `http://127.0.0.1:${port}/api/integrations/${created.integration.id}/documents/upload`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ arquivoNome: 'a.pdf', arquivoBase64: 'x' }),
          }
        );
        assert.equal(resUploadUnauth.status, 401);
      } finally {
        server.close();
      }

      // Verify fail-closed 503 when running on Netlify serverless without cloud Object Storage
      const prevNetlify = process.env.NETLIFY;
      process.env.NETLIFY = 'true';
      try {
        const serverlessStorage = new LocalPrivateIntegrationFileStorage(tmpDir);
        await assert.rejects(
          () =>
            serverlessStorage.putObject({
              storageKey: 'integrations/comp-a/int/item/v1_uuid.pdf',
              buffer: pdfBuf,
              mimeType: 'application/pdf',
              sha256: sha256Of(pdfBuf),
            }),
          (err: any) =>
            err instanceof IntegrationStorageUnavailableError &&
            err.status === 503 &&
            err.code === 'STORAGE_PROVIDER_NOT_CONFIGURED'
        );
      } finally {
        if (prevNetlify === undefined) {
          delete process.env.NETLIFY;
        } else {
          process.env.NETLIFY = prevNetlify;
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 10: Bloqueio de acesso cruzado entre empresas diferentes
  // ---------------------------------------------------------------------------
  await runTest('10. Bloqueio de acesso cruzado entre empresas diferentes (upload e download) + auditor somente leitura', async () => {
    const { service, integrationId, detail } = await createTestContext();
    const asoItem = detail.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;
    const pdfBuf = makePdfBuffer(5000, 'TENANT-A-ONLY');

    await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      itemId: asoItem.id,
      arquivoNome: 'aso_privado_alfa.pdf',
      arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
    });

    // Solicitante B MUST be blocked from uploading to Company A's integration
    await assert.rejects(
      () =>
        service.uploadSingleDocument(SOLICITANTE_B, integrationId, {
          itemId: asoItem.id,
          arquivoNome: 'invasao_beta.pdf',
          arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 403 &&
        err.code === 'COMPANY_SCOPE_VIOLATION'
    );

    // Solicitante B MUST be blocked from downloading Company A's file
    await assert.rejects(
      () => service.getDocumentFile(SOLICITANTE_B, integrationId, asoItem.id),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 403 &&
        err.code === 'COMPANY_SCOPE_VIOLATION'
    );

    // Auditor MUST be blocked from uploading (read-only), but CAN audit/view files
    await assert.rejects(
      () =>
        service.uploadSingleDocument(AUDITOR, integrationId, {
          itemId: asoItem.id,
          arquivoNome: 'auditor_write.pdf',
          arquivoBase64: toDataUrl(pdfBuf, 'application/pdf'),
        }),
      (err: any) =>
        err instanceof IntegrationWorkflowError &&
        err.statusCode === 403 &&
        err.code === 'AUDITOR_READ_ONLY'
    );

    const auditorFile = await service.getDocumentFile(AUDITOR, integrationId, asoItem.id);
    assert.equal(auditorFile.sizeBytes, pdfBuf.length);
  });

  // ---------------------------------------------------------------------------
  // TEST 11: Persistência do histórico de versões (v1, v2, v3 recuperáveis)
  // ---------------------------------------------------------------------------
  await runTest('11. Persistência integral do histórico de versões (v1, v2, v3) recuperáveis individualmente sem Base64', async () => {
    const { repo, storage, service, integrationId, detail } = await createTestContext();
    const asoItem = detail.items.find((i) => i.documentoCodigoCanonico === 'ASO')!;

    const b1 = makePdfBuffer(5000, 'HIST-V1');
    const b2 = makePdfBuffer(6000, 'HIST-V2');
    const b3 = makePdfBuffer(7000, 'HIST-V3');

    await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      itemId: asoItem.id,
      arquivoNome: 'aso_v1.pdf',
      arquivoBase64: toDataUrl(b1, 'application/pdf'),
    });
    await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      itemId: asoItem.id,
      arquivoNome: 'aso_v2.pdf',
      arquivoBase64: toDataUrl(b2, 'application/pdf'),
    });
    const res3 = await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      itemId: asoItem.id,
      arquivoNome: 'aso_v3.pdf',
      arquivoBase64: toDataUrl(b3, 'application/pdf'),
    });

    assert.equal(res3.item.versaoAtual, 3);
    assert.equal(res3.item.versoes.length, 3);
    assert.equal(storage.count(), 3);
    assertNoBase64StoredInRepo(repo);

    // Distinct arquivoId across all 3 versions
    const fileIds = new Set(res3.item.versoes.map((v) => v.arquivoId));
    assert.equal(fileIds.size, 3);

    // Complete remaining mandatory docs and submit so Admin EHS can inspect all 3 versions
    for (const rem of detail.items.filter((i) => i.obrigatorio && i.id !== asoItem.id)) {
      await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
        itemId: rem.id,
        arquivoNome: `${rem.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toDataUrl(makePdfBuffer(4096, `HIST-REM-${rem.documentoCodigoCanonico}`), 'application/pdf'),
      });
    }
    await service.submitIntegration(SOLICITANTE_A, integrationId);

    // Admin can retrieve v1, v2, and v3 individually with exact byte fidelity
    const dl1 = await service.getDocumentFile(ADMIN, integrationId, asoItem.id, 1);
    const dl2 = await service.getDocumentFile(ADMIN, integrationId, asoItem.id, 2);
    const dl3 = await service.getDocumentFile(ADMIN, integrationId, asoItem.id, 3);

    assert.equal(sha256Of(dl1.buffer), sha256Of(b1));
    assert.equal(sha256Of(dl2.buffer), sha256Of(b2));
    assert.equal(sha256Of(dl3.buffer), sha256Of(b3));
    assert.equal(dl1.fileName, 'aso_v1.pdf');
    assert.equal(dl2.fileName, 'aso_v2.pdf');
    assert.equal(dl3.fileName, 'aso_v3.pdf');
  });

  // ---------------------------------------------------------------------------
  // TEST 12: Integração com o motor de conformidade por atividade + 4 categorias obrigatórias
  // ---------------------------------------------------------------------------
  await runTest('12. Integração com o motor de conformidade por atividade e validação das 4 categorias obrigatórias (ordem 1 a 4)', async () => {
    // 12a. Verify exact 4 mandatory categories order & 11 standard catalog entries
    assert.equal(MANDATORY_DOCUMENT_CATEGORIES.length, 4);
    assert.deepEqual(
      MANDATORY_DOCUMENT_CATEGORIES.map((c) => c.id),
      [
        'pessoais_legais',
        'saude_ocupacional',
        'seguranca_trabalho',
        'vinculo_empregaticio',
      ]
    );
    assert.equal(EMPLOYEE_DOCUMENT_CATALOG.length, 11);

    const { repo, service, integrationId, detail } = await createTestContext();

    // Upload all 4 required matrix items (PGR, ASO, NR35, FICHA_EPI)
    for (const item of detail.items) {
      const buf = makePdfBuffer(15_000, `MATRIX-${item.documentoCodigoCanonico}`);
      await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
        itemId: item.id,
        arquivoNome: `${item.documentoCodigoCanonico.toLowerCase()}.pdf`,
        arquivoBase64: toDataUrl(buf, 'application/pdf'),
        dataEmissao: '2026-06-01',
        dataValidade: '2027-06-01',
      });
    }

    // Also upload personal & employment items to test 4-category grouping
    await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'RG_CNH',
      nomeExibicao: 'RG ou CNH',
      arquivoNome: 'rg_joao.pdf',
      arquivoBase64: toDataUrl(makePdfBuffer(8000, 'RG'), 'application/pdf'),
    });
    await service.uploadSingleDocument(SOLICITANTE_A, integrationId, {
      categoria: 'colaborador',
      colaboradorId: 'emp-a1',
      documentoCodigoCanonico: 'REGISTRO_EMPREGADO',
      nomeExibicao: 'Registro de empregado ou ficha de registro',
      arquivoNome: 'ficha_registro.pdf',
      arquivoBase64: toDataUrl(makePdfBuffer(8000, 'REG'), 'application/pdf'),
    });

    const beforeApproval = await service.getIntegrationDetail(SOLICITANTE_A, integrationId);
    const empItems = beforeApproval.items.filter((i) => i.categoria === 'colaborador');
    const grouped = groupItemsByMandatoryCategories(empItems);
    assert.equal(grouped.length, 4);
    assert.equal(grouped[0].category.id, 'pessoais_legais');
    assert.equal(grouped[0].items.length, 1);
    assert.equal(grouped[1].category.id, 'saude_ocupacional');
    assert.equal(grouped[1].items.length, 1);
    assert.equal(grouped[2].category.id, 'seguranca_trabalho');
    assert.equal(grouped[2].items.length, 2); // NR35 + FICHA_EPI
    assert.equal(grouped[3].category.id, 'vinculo_empregaticio');
    assert.equal(grouped[3].items.length, 1);

    // Submit integration — BEFORE Admin approval, compliance engine MUST NOT approve release
    await service.submitIntegration(SOLICITANTE_A, integrationId);
    const complianceBefore = evaluateActivityCompliance({
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
      safetyPermits: repo.state.safetyPermits,
      smartDocs: [],
    });
    assert.equal(complianceBefore.podeLiberar, false);

    // Admin approves all items and performs final approval
    for (const item of beforeApproval.items) {
      await service.reviewDocumentItem(ADMIN, integrationId, item.id, {
        decisao: 'APROVADO',
        observacoes: 'Documentação conferida.',
      });
    }
    await service.approveIntegration(ADMIN, integrationId, {
      justificativa: 'Integração completa aprovada.',
    });

    // Official collections must be populated with protected API paths (zero Base64)
    assert.equal(repo.state.documents.length, 3); // PGR + RG_CNH + REGISTRO_EMPREGADO
    assert.equal(repo.state.exams.length, 1);
    assert.equal(repo.state.trainings.length, 1);
    assert.equal(repo.state.epiDeliveries.length, 1);
    for (const docRec of repo.state.documents) {
      assert.ok(!String(docRec.arquivoUrl || '').startsWith('data:'));
      assert.ok(String(docRec.arquivoUrl || '').startsWith('/api/integrations/'));
    }

    // Compliance engine evaluates all company and employee documents as CONFORME
    const complianceAfter = evaluateActivityCompliance({
      company: repo.state.companies.find((c) => c.id === 'comp-a')!,
      atividadeIds: ['act-altura'],
      colaboradorIds: ['emp-a1'],
      dataReferenciaAtividade: '2026-11-25',
      dataFimAtividade: '2026-11-27',
      activityProfiles: repo.state.activityProfiles,
      requirements: repo.state.activityDocumentRequirements,
      employees: repo.state.employees,
      documents: repo.state.documents,
      trainings: repo.state.trainings,
      exams: repo.state.exams,
      epiDeliveries: repo.state.epiDeliveries,
      safetyPermits: [
        {
          id: 'pt-test-1',
          tipo: 'PT',
          titulo: 'PT-2026-001 — Trabalho em Altura',
          descricaoServico: 'Manutenção preventiva',
          empresaId: 'comp-a',
          empresaNome: 'Alfa Engenharia Terceirizada Ltda',
          atividadeIds: ['act-altura'],
          localTrabalho: 'Telhado Galpão A',
          colaboradorIds: ['emp-a1'],
          dataInicio: '2026-11-25',
          dataFim: '2026-11-27',
          responsavelEmissao: 'Carlos Solicitante Alfa',
          riscosIdentificados: 'Queda de altura',
          medidasPreventivas: 'Cinto paraquedista e linha de vida',
          status: 'aprovado',
        },
      ],
      smartDocs: [],
    });

    assert.ok(
      complianceAfter.itensEmpresa.every((i) => i.status === 'CONFORME'),
      `Esperado todos os itens da empresa CONFORME: ${JSON.stringify(complianceAfter.itensEmpresa)}`
    );
    assert.ok(
      complianceAfter.colaboradores.every((col) =>
        col.itens.every((i) => i.status === 'CONFORME')
      ),
      `Esperado todos os itens do colaborador CONFORME: ${JSON.stringify(complianceAfter.colaboradores)}`
    );
    assert.equal(complianceAfter.podeLiberar, true);
    assert.equal(complianceAfter.statusGeral, 'conforme');
    assertNoBase64StoredInRepo(repo);
  });

  console.log(`\n🎉 ALL ${passed}/12 MANDATORY BULK UPLOAD & STORAGE TESTS PASSED!\n`);
}

main().catch((err) => {
  console.error('Bulk upload test suite failed:', err);
  process.exit(1);
});
