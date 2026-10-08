import { extractText } from "unpdf";

import { ApiError, ErrorCode } from "../common/api-error";

export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
/** About 100 pages of meeting notes; longer files are refused rather than silently cut */
export const DOCUMENT_MAX_CHARS = 200_000;

export type UploadedFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

const unreadable = (reason: string, message: string) => new ApiError(ErrorCode.DOCUMENT_UNREADABLE, message, { reason });

/** UTF-8 first; a Korean Windows text file is often EUC-KR (CP949), so that is tried next. */
function decodeText(buffer: Buffer) {
  for (const encoding of ["utf-8", "euc-kr"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      // try the next encoding
    }
  }
  throw unreadable("ENCODING", "The text file is neither UTF-8 nor EUC-KR.");
}

/** The text of a PDF, TXT or MD upload. Only this is kept; the file itself is not stored. */
export async function documentText(file: UploadedFile): Promise<{ text: string; mimeType: string }> {
  const extension = file.originalname.toLowerCase().split(".").pop();
  if (file.size > DOCUMENT_MAX_BYTES) throw unreadable("SIZE", "The file is larger than 5MB.");

  let text: string;
  let mimeType: string;
  if (extension === "pdf") {
    mimeType = "application/pdf";
    try {
      text = (await extractText(new Uint8Array(file.buffer), { mergePages: true })).text;
    } catch {
      throw unreadable("CORRUPT", "The PDF could not be read.");
    }
  } else if (extension === "txt" || extension === "md") {
    mimeType = extension === "md" ? "text/markdown" : "text/plain";
    text = decodeText(file.buffer);
  } else {
    throw unreadable("TYPE", "Only PDF, TXT and MD files are supported.");
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // a byte-order mark some editors put first
  text = text.trim();
  if (!text) throw unreadable("NO_TEXT", "No text found (a scanned PDF has only images).");
  if (text.length > DOCUMENT_MAX_CHARS) throw unreadable("TOO_LONG", `The text is longer than ${DOCUMENT_MAX_CHARS} characters.`);
  return { text, mimeType };
}

const BREAKS = ["\n", ". ", "? ", "! ", "。"];

/**
 * Overlapping pieces of about `size` characters for embedding. A piece ends at a line or sentence break in its last
 * third when there is one, so it rarely cuts a sentence; `overlap` keeps the context that spans a cut.
 */
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; ) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const from = start + Math.floor((size * 2) / 3);
      const tail = clean.slice(from, end);
      const cut = Math.max(...BREAKS.map((b) => tail.lastIndexOf(b) + (tail.lastIndexOf(b) >= 0 ? b.length : 0)));
      if (cut > 0) end = from + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
