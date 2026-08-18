import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PDF_FONTS = {
  regular: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"),
  bold: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"),
  italic: require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf"),
};

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";
const PAGE_WIDTH = 12_240;
const PAGE_HEIGHT = 15_840;
const PAGE_MARGIN = 1_440;
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  return !line.trim()
    || /^#{1,3}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^```/.test(line)
    || (line.includes("|") && isTableSeparator(lines[index + 1] ?? ""));
}

export function parseBusinessMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const language = line.replace(/^```/, "").trim();
      const content = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, text: content.join("\n") });
      continue;
    }
    if (line.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const rows = [tableCells(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      blocks.push({ type: "table", rows });
      continue;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items = [];
      const pattern = orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const content = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) content.push(lines[index++].replace(/^>\s?/, "").trim());
      blocks.push({ type: "quote", text: content.join(" ") });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function inlineRuns(text) {
  const tokens = String(text ?? "").split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return tokens.map((token) => {
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return new TextRun({ text: `${link[1]} (${link[2]})`, color: "2563EB" });
    if (/^\*\*.*\*\*$/.test(token)) return new TextRun({ text: token.slice(2, -2), bold: true });
    if (/^\*.*\*$/.test(token)) return new TextRun({ text: token.slice(1, -1), italics: true });
    if (/^`.*`$/.test(token)) return new TextRun({ text: token.slice(1, -1), font: "Courier New", shading: { type: ShadingType.CLEAR, fill: "EEF2F7" } });
    return new TextRun(token);
  });
}

function plainText(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function tableColumnWidths(rows, totalWidth) {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const weights = Array.from({ length: columnCount }, (_, column) => Math.max(6, ...rows.map((row) => plainText(row[column] ?? "").length))).map((weight) => Math.min(weight, 40));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const widths = weights.map((weight) => Math.floor(totalWidth * weight / sum));
  widths[widths.length - 1] += totalWidth - widths.reduce((total, width) => total + width, 0);
  return widths;
}

function docxTable(rows) {
  const widths = tableColumnWidths(rows, CONTENT_WIDTH);
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    indent: { size: 120, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: widths.map((width, columnIndex) => new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: "F2F4F7" } : undefined,
        verticalAlign: "center",
        children: [new Paragraph({
          spacing: { before: 40, after: 40, line: 280 },
          children: [new TextRun({ text: plainText(row[columnIndex] ?? ""), bold: rowIndex === 0, size: 19 })],
        })],
      })),
    })),
  });
}

function docxContent(blocks) {
  const children = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1], keepNext: true, children: inlineRuns(block.text) }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ spacing: { after: 120, line: 264 }, children: inlineRuns(block.text) }));
    } else if (block.type === "quote") {
      children.push(new Paragraph({ spacing: { before: 80, after: 180, line: 300 }, indent: { left: 360, right: 180 }, shading: { type: ShadingType.CLEAR, fill: "F1F5F9" }, children: [new TextRun({ text: plainText(block.text), italics: true, color: "334155" })] }));
    } else if (block.type === "code") {
      children.push(new Paragraph({ spacing: { before: 80, after: 180, line: 276 }, shading: { type: ShadingType.CLEAR, fill: "F1F5F9" }, children: [new TextRun({ text: block.text, font: "Courier New", size: 18 })] }));
    } else if (block.type === "list") {
      for (const item of block.items) children.push(new Paragraph({ numbering: { reference: block.ordered ? "business-numbers" : "business-bullets", level: 0 }, spacing: { after: 160, line: 280 }, children: inlineRuns(item) }));
      children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    } else if (block.type === "table") {
      children.push(docxTable(block.rows), new Paragraph({ spacing: { after: 180 }, children: [] }));
    }
  }
  return children;
}

export async function generateBusinessDocx(documentation) {
  const generatedAt = documentation.generatedAt ?? new Date();
  const document = new Document({
    creator: "Dashboard IA",
    title: documentation.title,
    description: `Documentação de negócio do projeto ${documentation.projectName}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: "1E293B" }, paragraph: { spacing: { after: 120, line: 264 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: "Calibri", size: 46, bold: true, color: "0B2545" }, paragraph: { spacing: { before: 0, after: 160 }, keepNext: true } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Calibri", size: 32, bold: true, color: "2E74B5" }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: "Calibri", size: 26, bold: true, color: "2E74B5" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { font: "Calibri", size: 24, bold: true, color: "1F4D78" }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [
      { reference: "business-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "business-numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ] },
    sections: [{
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, header: 708, footer: 708 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: `${documentation.projectName}  |  Documentação de negócio`, color: "64748B", size: 17 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Dashboard IA  |  ", color: "64748B", size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: "64748B", size: 17 })] })] }) },
      children: [
        new Paragraph({ style: "Title", children: [new TextRun(documentation.title)] }),
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "DOCUMENTAÇÃO DE NEGÓCIO", bold: true, color: "1D4ED8", size: 19, characterSpacing: 80 })] }),
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `Projeto: ${documentation.projectName}`, bold: true }), new TextRun(`  |  Repositório: ${documentation.repository}`)] }),
        new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: `Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(generatedAt)}`, color: "64748B", size: 19 })] }),
        ...docxContent(parseBusinessMarkdown(documentation.content)),
      ],
    }],
  });
  return Packer.toBuffer(document);
}

function pdfTable(doc, rows) {
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = tableColumnWidths(rows, availableWidth);
  const padding = 7;
  rows.forEach((row, rowIndex) => {
    doc.x = doc.page.margins.left;
    doc.font(rowIndex === 0 ? "Business-Bold" : "Business-Regular").fontSize(8.5);
    const rowHeight = Math.max(...widths.map((width, columnIndex) => doc.heightOfString(plainText(row[columnIndex] ?? ""), { width: width - (padding * 2), lineGap: 1 }))) + (padding * 2);
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
    const top = doc.y;
    let left = doc.page.margins.left;
    widths.forEach((width, columnIndex) => {
      doc.save();
      if (rowIndex === 0) doc.fillColor("#E8EEF7").rect(left, top, width, rowHeight).fill();
      doc.strokeColor("#CBD5E1").lineWidth(0.5).rect(left, top, width, rowHeight).stroke();
      doc.fillColor("#1E293B").text(plainText(row[columnIndex] ?? ""), left + padding, top + padding, { width: width - (padding * 2), lineGap: 1 });
      doc.restore();
      left += width;
    });
    doc.y = top + rowHeight;
  });
  doc.x = doc.page.margins.left;
  doc.moveDown(0.8);
}

function renderPdfBlocks(doc, blocks) {
  for (const block of blocks) {
    doc.x = doc.page.margins.left;
    if (block.type === "heading") {
      const sizes = [17, 14, 11.5];
      doc.moveDown(block.level === 1 ? 0.7 : 0.45).font("Business-Bold").fontSize(sizes[block.level - 1]).fillColor(block.level === 1 ? "#1D4ED8" : "#1E3A8A").text(plainText(block.text), { keepTogether: true }).moveDown(0.25);
    } else if (block.type === "paragraph") {
      doc.font("Business-Regular").fontSize(10).fillColor("#1E293B").text(plainText(block.text), { lineGap: 3, paragraphGap: 7, align: "left" });
    } else if (block.type === "quote") {
      const left = doc.x;
      const width = doc.page.width - doc.page.margins.right - left;
      const height = doc.heightOfString(plainText(block.text), { width: width - 24, lineGap: 3 }) + 18;
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const top = doc.y;
      doc.save().fillColor("#F1F5F9").rect(left, top, width, height).fill().fillColor("#334155").font("Business-Italic").fontSize(10).text(plainText(block.text), left + 12, top + 9, { width: width - 24, lineGap: 3 }).restore();
      doc.y = top + height + 8;
      doc.x = doc.page.margins.left;
    } else if (block.type === "code") {
      doc.font("Courier").fontSize(8.5).fillColor("#334155").text(block.text, { lineGap: 2, paragraphGap: 7 });
    } else if (block.type === "list") {
      block.items.forEach((item, index) => doc.font("Business-Regular").fontSize(10).fillColor("#1E293B").text(`${block.ordered ? `${index + 1}.` : "•"}  ${plainText(item)}`, { indent: 14, lineGap: 3, paragraphGap: 3 }));
      doc.moveDown(0.35);
    } else if (block.type === "table") {
      pdfTable(doc, block.rows);
    }
  }
}

export async function generateBusinessPdf(documentation) {
  const generatedAt = documentation.generatedAt ?? new Date();
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, right: 64, bottom: 64, left: 64 }, bufferPages: true, info: { Title: documentation.title, Author: "Dashboard IA", Subject: `Documentação de negócio do projeto ${documentation.projectName}` } });
    doc.registerFont("Business-Regular", PDF_FONTS.regular);
    doc.registerFont("Business-Bold", PDF_FONTS.bold);
    doc.registerFont("Business-Italic", PDF_FONTS.italic);
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font("Business-Bold").fontSize(21).fillColor("#172554").text(documentation.title, { lineGap: 2 });
    doc.moveDown(0.45).font("Business-Bold").fontSize(9).fillColor("#1D4ED8").text("DOCUMENTAÇÃO DE NEGÓCIO");
    doc.moveDown(0.7).font("Business-Bold").fontSize(9.5).fillColor("#1E293B").text(`Projeto: ${documentation.projectName}`);
    doc.font("Business-Regular").fillColor("#475569").text(`Repositório: ${documentation.repository}`);
    doc.text(`Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(generatedAt)}`);
    doc.moveDown(0.7).strokeColor("#CBD5E1").lineWidth(0.8).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().moveDown(0.8);
    renderPdfBlocks(doc, parseBusinessMarkdown(documentation.content));
    const range = doc.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Business-Regular").fontSize(8).fillColor("#64748B").text(`Dashboard IA  |  ${pageIndex + 1} de ${range.count}`, 64, doc.page.height - 42, { width: doc.page.width - 128, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

export function documentationFilename(title, extension) {
  const safe = String(title ?? "documentacao-de-negocio").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "documentacao-de-negocio";
  return `${safe}.${extension}`;
}

export function documentationResponseMetadata(format, title) {
  if (!new Set(["docx", "pdf"]).has(format)) return null;
  const filename = documentationFilename(title, format);
  return {
    filename,
    contentType: format === "docx" ? DOCX_CONTENT_TYPE : PDF_CONTENT_TYPE,
    contentDisposition: `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}
