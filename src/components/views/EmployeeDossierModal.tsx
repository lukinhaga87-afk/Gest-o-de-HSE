import React, { useState } from 'react';
import {
  X,
  FileDown,
  User,
  Building2,
  Calendar,
  Briefcase,
  ShieldCheck,
  HeartPulse,
  GraduationCap,
  HardHat,
  FileText,
  History,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react';
import { Employee } from '../../types/sst';
import { useSST } from '../../context/SSTContext';
import { formatCPF, formatDateBR, getTrafficLightStatus } from '../../utils/trafficLight';
import { generateIndividualEmployeePDF } from '../../utils/exportUtils';

interface EmployeeDossierModalProps {
  employee: Employee;
  onClose: () => void;
}

export const EmployeeDossierModal: React.FC<EmployeeDossierModalProps> = ({
  employee,
  onClose,
}) => {
  const { companies, documents, trainings, exams, epiDeliveries, auditLogs } = useSST();

  const [activeTab, setActiveTab] = useState<
    'visao_geral' | 'exames' | 'treinamentos' | 'documentos' | 'epi' | 'historico'
  >('visao_geral');

  // Filter linked items
  const linkedCompany = companies.find((c) => c.id === employee.empresaId);
  const empDocs = documents.filter((d) => d.colaboradorId === employee.id);
  const empTrainings = trainings.filter((t) => t.colaboradorId === employee.id);
  const empExams = exams.filter((e) => e.colaboradorId === employee.id);
  const empEpis = epiDeliveries.filter((ep) => ep.colaboradorId === employee.id);
  const empLogs = auditLogs.filter(
    (l) => l.entidadeId === employee.id || l.detalhes.includes(employee.nomeCompleto)
  );

  // Farol counts for this employee
  let validCount = 0;
  let warningCount = 0;
  let expiredCount = 0;
  let pendingCount = 0;

  const allItems = [
    ...empDocs.map((d) => ({
      type: 'Documento',
      name: d.nomeDocumento,
      validade: d.dataValidade,
      semValidade: d.semValidade,
      status: d.situacao,
    })),
    ...empTrainings.map((t) => ({
      type: 'Treinamento',
      name: t.nomeTreinamento,
      validade: t.dataValidade,
      semValidade: t.semValidade,
      status: t.situacao,
    })),
    ...empExams.map((e) => ({
      type: 'ASO / Exame',
      name: `${e.tipoExame} (${e.conclusao.toUpperCase()})`,
      validade: e.dataValidade,
      semValidade: e.semValidade,
      status: e.situacao,
    })),
  ];

  allItems.forEach((it) => {
    const f = getTrafficLightStatus(it.validade, it.semValidade, it.status);
    if (f.status === 'verde') validCount++;
    else if (f.status === 'amarelo') warningCount++;
    else if (f.status === 'vermelho') expiredCount++;
    else pendingCount++;
  });

  const handleDownloadPDF = () => {
    generateIndividualEmployeePDF(
      employee,
      linkedCompany,
      empDocs,
      empTrainings,
      empExams,
      empEpis
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-blue-600/20 text-blue-400">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                Ficha Individual de Conformidade SST
              </h3>
              <p className="text-xs text-slate-400">
                Prontuário completo de treinamentos, ASOs, EPIs e documentação
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all"
              title="Gerar Relatório Individual em PDF"
            >
              <FileDown size={15} />
              <span>GERAR RELATÓRIO INDIVIDUAL EM PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Employee Header Profile Strip */}
        <div className="p-6 bg-slate-850 border-b border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              {employee.fotoUrl ? (
                <img
                  src={employee.fotoUrl}
                  alt={employee.nomeCompleto}
                  className="h-20 w-20 rounded-2xl object-cover border-2 border-blue-500/50 shadow-md"
                />
              ) : (
                <div className="h-20 w-20 rounded-2xl bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-400">
                  <User size={36} />
                </div>
              )}
              <span
                className={`absolute -bottom-1.5 -right-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                  employee.situacaoCadastral === 'ativo'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-amber-500 text-slate-950'
                }`}
              >
                {employee.situacaoCadastral}
              </span>
            </div>

            <div>
              <h2 className="text-xl font-bold text-white">{employee.nomeCompleto}</h2>
              <p className="text-xs text-blue-400 font-medium flex items-center gap-1.5 mt-0.5">
                <Briefcase size={13} />
                {employee.cargo} • {employee.setor}
              </p>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                <Building2 size={13} />
                {employee.empresaNome}
                {employee.matricula && (
                  <span className="font-mono text-slate-400">({employee.matricula})</span>
                )}
              </p>
            </div>
          </div>

          {/* Traffic Light Counter Strip */}
          <div className="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-emerald-400">{validCount}</span>
              <span className="text-[10px] text-slate-400">Válidos</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-amber-400">{warningCount}</span>
              <span className="text-[10px] text-slate-400">Vencendo</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="block text-base font-extrabold text-red-400">{expiredCount}</span>
              <span className="text-[10px] text-slate-400">Vencidos</span>
            </div>
            <div className="text-center px-3">
              <span className="block text-base font-extrabold text-slate-400">{pendingCount}</span>
              <span className="text-[10px] text-slate-400">Pendentes</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-900/50 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab('visao_geral')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'visao_geral'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Visão Geral e Dados
          </button>
          <button
            onClick={() => setActiveTab('exames')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'exames'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <HeartPulse size={14} /> Exames e ASO ({empExams.length})
          </button>
          <button
            onClick={() => setActiveTab('treinamentos')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'treinamentos'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <GraduationCap size={14} /> Treinamentos ({empTrainings.length})
          </button>
          <button
            onClick={() => setActiveTab('documentos')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'documentos'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <FileText size={14} /> Documentos ({empDocs.length})
          </button>
          <button
            onClick={() => setActiveTab('epi')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'epi'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <HardHat size={14} /> Ficha de EPI ({empEpis.length})
          </button>
          <button
            onClick={() => setActiveTab('historico')}
            className={`py-3 px-3 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'historico'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <History size={14} /> Auditoria & Histórico
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs">
          {/* TAB 1: VISÃO GERAL */}
          {activeTab === 'visao_geral' && (
            <div className="space-y-6">
              {/* Personal and Professional Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                  <h4 className="font-bold text-white text-xs uppercase tracking-wider text-blue-400 mb-3">
                    Dados Pessoais
                  </h4>
                  <p className="flex justify-between">
                    <span className="text-slate-400">CPF:</span>
                    <span className="font-mono text-slate-200">{formatCPF(employee.cpf)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">RG:</span>
                    <span className="text-slate-200">{employee.rg || 'Não informado'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Data de Nascimento:</span>
                    <span className="text-slate-200">{formatDateBR(employee.dataNascimento)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Telefone:</span>
                    <span className="text-slate-200">{employee.telefone || 'Não informado'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">E-mail:</span>
                    <span className="text-slate-200">{employee.email || 'Não informado'}</span>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                  <h4 className="font-bold text-white text-xs uppercase tracking-wider text-blue-400 mb-3">
                    Dados Profissionais & Alocação
                  </h4>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Empresa:</span>
                    <span className="text-slate-200 font-semibold">{employee.empresaNome}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Matrícula:</span>
                    <span className="font-mono text-slate-200">{employee.matricula || '-'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Cargo / Função:</span>
                    <span className="text-slate-200">{employee.cargo}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Setor:</span>
                    <span className="text-slate-200">{employee.setor}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Unidade de Alocação:</span>
                    <span className="text-slate-200">{employee.unidadeAlocacao || 'Padrão'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Data de Admissão:</span>
                    <span className="text-slate-200">{formatDateBR(employee.dataAdmissao)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-400">Data de Integração SST:</span>
                    <span className="text-slate-200">{formatDateBR(employee.dataIntegracao)}</span>
                  </p>
                </div>
              </div>

              {/* Atividade Executada */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider text-blue-400 mb-1.5">
                  Descrição das Atividades Executadas
                </h4>
                <p className="text-slate-300">
                  {employee.atividadeExecutada ||
                    'Atividades rotineiras compatíveis com o cargo e as diretrizes operacionais de segurança do trabalho da contratante.'}
                </p>
              </div>

              {/* Faróis de Todos os Registros do Colaborador */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider text-blue-400 mb-3">
                  Quadro Geral de Faróis e Vencimentos deste Colaborador
                </h4>
                {allItems.length === 0 ? (
                  <p className="text-slate-400 italic">
                    Nenhum documento, exame ou treinamento vinculado a este colaborador no momento.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {allItems.map((it, idx) => {
                      const f = getTrafficLightStatus(it.validade, it.semValidade, it.status);
                      return (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-lg bg-slate-900 border flex items-center justify-between ${f.borderClass}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: f.status === 'verde' ? '#10b981' : f.status === 'amarelo' ? '#f59e0b' : f.status === 'vermelho' ? '#ef4444' : '#94a3b8' }} />
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">
                                [{it.type}]
                              </span>
                              <span className="font-semibold text-slate-200">{it.name}</span>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${f.badgeClass}`}>
                            {f.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: EXAMES E ASO */}
          {activeTab === 'exames' && (
            <div className="space-y-3">
              {empExams.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <HeartPulse size={36} className="mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum exame cadastrado</p>
                  <p className="text-[11px] text-slate-400 mt-1">Utilize o módulo "Exames e ASO" para vincular atestados.</p>
                </div>
              ) : (
                empExams.map((ex) => {
                  const farol = getTrafficLightStatus(ex.dataValidade, ex.semValidade, ex.situacao);
                  return (
                    <div
                      key={ex.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{ex.tipoExame}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              ex.conclusao === 'apto'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}
                          >
                            {ex.conclusao}
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs">
                          Médico: {ex.medicoResponsavel || 'Não informado'} | CRM: {ex.crmMedico || '-'}
                        </p>
                        <p className="text-slate-400 text-xs">
                          Realização: {formatDateBR(ex.dataRealizacao)} | Validade:{' '}
                          {ex.semValidade ? 'Sem Vencimento' : formatDateBR(ex.dataValidade)}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 rounded text-xs font-semibold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                        {ex.anexoUrl && (
                          <a
                            href={ex.anexoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium"
                          >
                            Ver ASO
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: TREINAMENTOS */}
          {activeTab === 'treinamentos' && (
            <div className="space-y-3">
              {empTrainings.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <GraduationCap size={36} className="mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum treinamento registrado</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Cadastre capacitações (NR-10, NR-35, etc.) pelo módulo de Treinamentos.
                  </p>
                </div>
              ) : (
                empTrainings.map((tr) => {
                  const farol = getTrafficLightStatus(tr.dataValidade, tr.semValidade, tr.situacao);
                  return (
                    <div
                      key={tr.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <span className="font-bold text-white text-sm">{tr.nomeTreinamento}</span>
                        <p className="text-slate-400 text-xs">
                          Carga Horária: {tr.cargaHoraria || '-'} | Instrutor: {tr.instrutor || 'Não informado'}
                        </p>
                        <p className="text-slate-400 text-xs">
                          Realizado em: {formatDateBR(tr.dataRealizacao)} | Vencimento:{' '}
                          {tr.semValidade ? 'Sem Vencimento' : formatDateBR(tr.dataValidade)}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 rounded text-xs font-semibold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                        {tr.certificadoUrl && (
                          <a
                            href={tr.certificadoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium"
                          >
                            Certificado
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 4: DOCUMENTOS */}
          {activeTab === 'documentos' && (
            <div className="space-y-3">
              {empDocs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <FileText size={36} className="mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum documento individual vinculado</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Fichas, ordens de serviço e certificados vinculados aparecerão aqui.
                  </p>
                </div>
              ) : (
                empDocs.map((doc) => {
                  const farol = getTrafficLightStatus(doc.dataValidade, doc.semValidade, doc.situacao);
                  return (
                    <div
                      key={doc.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{doc.nomeDocumento}</span>
                          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">
                            {doc.categoria}
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs">
                          Nº: {doc.numeroDocumento || '-'} | Emissão: {formatDateBR(doc.dataEmissao)} | Validade:{' '}
                          {doc.semValidade ? 'Sem Vencimento' : formatDateBR(doc.dataValidade)}
                        </p>
                        {doc.motivoReprovacao && (
                          <p className="text-red-400 text-xs font-medium">
                            Motivo Reprovação: {doc.motivoReprovacao}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 rounded text-xs font-semibold ${farol.badgeClass}`}>
                          {farol.label}
                        </span>
                        {doc.arquivoUrl && (
                          <a
                            href={doc.arquivoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium"
                          >
                            Abrir Documento
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 5: FICHA DE EPI */}
          {activeTab === 'epi' && (
            <div className="space-y-3">
              {empEpis.length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800">
                  <HardHat size={36} className="mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-slate-300">Nenhum EPI fornecido registrado</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Registre a entrega de EPIs pelo módulo de Controle de EPI.
                  </p>
                </div>
              ) : (
                empEpis.map((epi) => (
                  <div
                    key={epi.id}
                    className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{epi.nomeEpi}</span>
                        <span className="font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                          CA: {epi.caNumero}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs mt-1">
                        Data de Fornecimento: {formatDateBR(epi.dataEntrega)} | Quantidade: {epi.quantidade} | Entregador: {epi.responsavelEntrega}
                      </p>
                    </div>

                    <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                      Entregue
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 6: HISTÓRICO E AUDITORIA */}
          {activeTab === 'historico' && (
            <div className="space-y-2">
              {empLogs.length === 0 ? (
                <p className="text-slate-400 italic py-6 text-center">
                  Nenhuma alteração registrada recentemente para este colaborador.
                </p>
              ) : (
                empLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-start justify-between gap-4"
                  >
                    <div>
                      <span className="font-semibold text-white">{log.acao}</span>
                      <p className="text-slate-400 text-[11px] mt-0.5">{log.detalhes}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Responsável: {log.usuario} ({log.usuarioEmail})
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {new Date(log.dataHora).toLocaleString('pt-BR')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Bottom Close */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-between items-center">
          <span className="text-[11px] text-slate-400">
            Conforme NR-01, NR-07 e Lei Geral de Proteção de Dados (LGPD)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white"
          >
            Fechar Ficha
          </button>
        </div>
      </div>
    </div>
  );
};
