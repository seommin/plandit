import { EMBEDDING_DIMENSIONS, hashEmbedding } from "../ai/embedding";
import { ApiError } from "../common/api-error";
import { chunkText, documentText } from "./document-text";

const file = (originalname: string, buffer: Buffer) => ({ originalname, mimetype: "application/octet-stream", size: buffer.length, buffer });

/** A one-page PDF with `text` in Helvetica, offsets computed so any reader accepts it */
function tinyPdf(text: string) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const reasonOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof ApiError ? [error.code, (error.details as { reason: string }).reason] : error;
};

describe("documentText", () => {
  it("reads UTF-8 (without a byte-order mark), EUC-KR and markdown", async () => {
    expect(await documentText(file("회의록.txt", Buffer.from(`${String.fromCharCode(0xfeff)}  A사와 출시일 확정  `, "utf8")))).toEqual({ text: "A사와 출시일 확정", mimeType: "text/plain" });
    const eucKr = Buffer.from([0xc8, 0xb8, 0xc0, 0xc7]); // "회의" in EUC-KR, not valid UTF-8
    expect((await documentText(file("notes.TXT", eucKr))).text).toBe("회의");
    expect((await documentText(file("a.md", Buffer.from("# 결정\n- 10월 출시")))).mimeType).toBe("text/markdown");
  });

  it("extracts the text of a PDF", async () => {
    expect(await documentText(file("meeting.pdf", tinyPdf("Company A agreed on the October launch")))).toEqual({
      text: "Company A agreed on the October launch",
      mimeType: "application/pdf",
    });
  });

  it("refuses what it cannot read, saying why", async () => {
    expect(await reasonOf(documentText(file("blank.txt", Buffer.from("   \n ", "utf8"))))).toEqual(["DOCUMENT_UNREADABLE", "NO_TEXT"]);
    expect(await reasonOf(documentText(file("notes.docx", Buffer.from("PK..."))))).toEqual(["DOCUMENT_UNREADABLE", "TYPE"]);
    expect(await reasonOf(documentText(file("broken.pdf", Buffer.from("%PDF-1.4 not really"))))).toEqual(["DOCUMENT_UNREADABLE", "CORRUPT"]);
    expect(await reasonOf(documentText(file("long.txt", Buffer.from("가".repeat(200_001)))))).toEqual(["DOCUMENT_UNREADABLE", "TOO_LONG"]);
  });
});

describe("chunkText", () => {
  it("keeps short text whole and tidies whitespace", () => {
    expect(chunkText("A사 미팅\r\n\r\n\r\n\r\n결정:   10월 출시")).toEqual(["A사 미팅\n\n결정: 10월 출시"]);
  });

  it("cuts long text at sentence ends, with overlap, and loses nothing", () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 안건은 일정 조정이다.`);
    const chunks = chunkText(sentences.join(" "), 200, 40);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.endsWith(".")).toBe(true);
    for (const sentence of sentences) expect(chunks.some((c) => c.includes(sentence))).toBe(true);
    // consecutive chunks share some text
    expect(chunks[1].startsWith(chunks[0].slice(-10).trim().slice(0, 3)) || chunks[0].includes(chunks[1].slice(0, 10))).toBe(true);
  });

  it("still cuts text that has no breaks at all", () => {
    expect(chunkText("가".repeat(2_000), 800, 100).map((c) => c.length)).toEqual([800, 800, 600]);
  });
});

describe("hashEmbedding", () => {
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

  it("is deterministic, unit length and of the column's size", () => {
    const v = hashEmbedding("A사 미팅");
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(hashEmbedding("A사 미팅")).toEqual(v);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  it("puts text that shares words closer", () => {
    const q = hashEmbedding("A사 출시 일정");
    expect(cos(q, hashEmbedding("A사와 10월 출시 일정을 확정했다"))).toBeGreaterThan(cos(q, hashEmbedding("점심은 김치찌개")));
  });
});
