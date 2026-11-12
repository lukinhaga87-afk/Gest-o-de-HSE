import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import {
  Employee,
  Company,
  DocumentSST,
  Training,
  OccupationalExam,
  EPIDelivery,
} from '../types/sst';
import { formatDateBR, getTrafficLightStatus, formatCPF } from './trafficLight';

/**
 * Generates an official, comprehensive individual SST PDF report for an employee
 */
export function generateIndividualEmployeePDF(
  employee: Employee,
  company?: Company,
  documents: DocumentSST[] = [],
  trainings: Training[] = [],
  exams: OccupationalExam[] = [],
  epis: EPIDelivery[] = []
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentY = 18;

  // Header background banner
  doc.setFillColor(15, 23, 42); // slate-900 / navy
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Brand Name
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Gestão de EHS', 15, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text('Sistema de Meio Ambiente, Saúde e Segurança do Trabalho', 15, 17);
  doc.text(`Ficha Individual de Conformidade | Emitido em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 15, 22);

  currentY = 36;

  // Employee Identity Summary Box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(14, currentY, pageWidth - 28, 38, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(employee.nomeCompleto, 18, currentY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);

  doc.text(`CPF: ${formatCPF(employee.cpf)}`, 18, currentY + 15);
  doc.text(`RG: ${employee.rg || 'Não informado'}`, 75, currentY + 15);
  doc.text(`Nascimento: ${formatDateBR(employee.dataNascimento)}`, 130, currentY + 15);

  doc.text(`Empresa: ${employee.empresaNome}`, 18, currentY + 22);
  doc.text(`Matrícula: ${employee.matricula || '-'}`, 130, currentY + 22);

  doc.text(`Cargo: ${employee.cargo}`, 18, currentY + 29);
  doc.text(`Setor: ${employee.setor}`, 75, currentY + 29);
  doc.text(`Situação: ${employee.situacaoCadastral.toUpperCase()}`, 130, currentY + 29);

  doc.text(`Admissão: ${formatDateBR(employee.dataAdmissao)}`, 18, currentY + 35);
  doc.text(`Integração: ${formatDateBR(employee.dataIntegracao)}`, 75, currentY + 35);
  doc.text(`Unidade: ${employee.unidadeAlocacao || 'Padrão'}`, 130, currentY + 35);

  currentY += 46;

  // Section 1: Exames Ocupacionais & ASO
  doc.setFillColor(30, 58, 138); // blue-900
  doc.rect(14, currentY, pageWidth - 28, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('1. EXAMES OCUPACIONAIS E ASO (ATESTADO DE SAÚDE OCUPACIONAL)', 18, currentY + 4.5);
  currentY += 9;

  if (exams.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Nenhum exame ocupacional registrado no momento.', 18, currentY + 4);
    currentY += 8;
  } else {
    exams.forEach((ex) => {
      const farol = getTrafficLightStatus(ex.dataValidade, ex.semValidade, ex.situacao);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`• ${ex.tipoExame} (${ex.conclusao.toUpperCase()})`, 18, currentY + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Realização: ${formatDateBR(ex.dataRealizacao)} | Validade: ${formatDateBR(ex.dataValidade)} | Médico: ${ex.medicoResponsavel || 'Não informado'} (CRM: ${ex.crmMedico || '-'})`,
        22,
        currentY + 7
      );
      doc.text(`Status Farol: ${farol.label}`, 22, currentY + 11);
      currentY += 14;
    });
  }

  currentY += 3;

  // Section 2: Treinamentos e Capacitações
  doc.setFillColor(30, 58, 138);
  doc.rect(14, currentY, pageWidth - 28, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('2. TREINAMENTOS, CAPACITAÇÕES E QUALIFICAÇÕES', 18, currentY + 4.5);
  currentY += 9;

  if (trainings.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Nenhum treinamento ou capacitação cadastrado.', 18, currentY + 4);
    currentY += 8;
  } else {
    trainings.forEach((tr) => {
      const farol = getTrafficLightStatus(tr.dataValidade, tr.semValidade, tr.situacao);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`• ${tr.nomeTreinamento}`, 18, currentY + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Realização: ${formatDateBR(tr.dataRealizacao)} | Validade: ${tr.semValidade ? 'Sem Vencimento' : formatDateBR(tr.dataValidade)} | Carga Horária: ${tr.cargaHoraria || '-'} | Instrutor: ${tr.instrutor || '-'}`,
        22,
        currentY + 7
      );
      doc.text(`Status Farol: ${farol.label} | Aprovação: ${tr.situacao.toUpperCase()}`, 22, currentY + 11);
      currentY += 14;
    });
  }

  currentY += 3;

  // Section 3: Documentos e Certificados
  doc.setFillColor(30, 58, 138);
  doc.rect(14, currentY, pageWidth - 28, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('3. DOCUMENTOS VINCULADOS E CERTIFICADOS', 18, currentY + 4.5);
  currentY += 9;

  if (documents.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Nenhum documento individual vinculado cadastrado.', 18, currentY + 4);
    currentY += 8;
  } else {
    documents.forEach((dc) => {
      const farol = getTrafficLightStatus(dc.dataValidade, dc.semValidade, dc.situacao);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`• ${dc.nomeDocumento} (${dc.categoria})`, 18, currentY + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Emissão: ${formatDateBR(dc.dataEmissao)} | Validade: ${dc.semValidade ? 'Sem Vencimento' : formatDateBR(dc.dataValidade)} | Situação: ${dc.situacao.toUpperCase()}`,
        22,
        currentY + 7
      );
      if (dc.motivoReprovacao) {
        doc.setTextColor(185, 28, 28);
        doc.text(`Motivo da Reprovação: ${dc.motivoReprovacao}`, 22, currentY + 11);
        currentY += 15;
      } else {
        currentY += 12;
      }
    });
  }

  currentY += 3;

  // Section 4: Equipamentos de Proteção Individual (EPI)
  doc.setFillColor(30, 58, 138);
  doc.rect(14, currentY, pageWidth - 28, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('4. HISTÓRICO DE ENTREGA DE EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL (EPI)', 18, currentY + 4.5);
  currentY += 9;

  if (epis.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Nenhum registro de entrega de EPI para este colaborador.', 18, currentY + 4);
    currentY += 8;
  } else {
    epis.forEach((ep) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`• ${ep.nomeEpi} (CA: ${ep.caNumero})`, 18, currentY + 3);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Data de Entrega: ${formatDateBR(ep.dataEntrega)} | Quantidade: ${ep.quantidade} | Entregue por: ${ep.responsavelEntrega}`,
        22,
        currentY + 7
      );
      currentY += 11;
    });
  }

  // Footer / Signatures
  if (currentY > pageHeight - 35) {
    doc.addPage();
    currentY = 25;
  } else {
    currentY = pageHeight - 28;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(18, currentY, 85, currentY);
  doc.line(110, currentY, 180, currentY);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Assinatura do Colaborador', 30, currentY + 4);
  doc.text('Responsável SST / SESMT Contratante', 120, currentY + 4);

  // Save the PDF
  const filename = `Relatorio_SST_${employee.nomeCompleto.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

/**
 * Exports data table directly to Excel (.xlsx)
 */
export function exportToExcel(data: Record<string, any>[], fileName: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio_SST');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/**
 * Exports a generic SST report to PDF
 */
export function exportReportToPDF(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  fileName: string
) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  // Header banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Gestão de EHS - RELATÓRIO EXECUTIVO', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`${title} | Gerado em ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`, 14, 18);

  let currentY = 32;

  // Table header
  doc.setFillColor(30, 58, 138);
  doc.rect(14, currentY, pageWidth - 28, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  const colWidth = (pageWidth - 28) / headers.length;
  headers.forEach((h, i) => {
    doc.text(String(h), 16 + i * colWidth, currentY + 5);
  });

  currentY += 8;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  rows.forEach((row, rowIndex) => {
    if (currentY > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      currentY = 20;
    }

    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, currentY, pageWidth - 28, 6, 'F');
    }

    doc.setTextColor(15, 23, 42);
    row.forEach((cell, cellIndex) => {
      const cellText = String(cell ?? '-');
      // Truncate if too long for column
      const truncated = cellText.length > 28 ? cellText.substring(0, 26) + '...' : cellText;
      doc.text(truncated, 16 + cellIndex * colWidth, currentY + 4.2);
    });

    currentY += 6;
  });

  doc.save(`${fileName}.pdf`);
}
