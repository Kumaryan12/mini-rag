// src/lib/chunker.ts
// Lightweight chunker (no tiktoken). Roughly 4 chars ≈ 1 token.
// Tries to split on paragraph/sentence boundaries and supports safe overlap.

/** A single chunk of text plus minimal metadata for RAG */
export type Chunk = { text: string; section: string; position: number };

export type ChunkOptions = {
  /** Target chunk size in *tokens* (approx). Default: 1000 */
  chunkTokens?: number;
  /** Overlap between consecutive chunks in *tokens* (approx). Default: 150 */
  overlap?: number;
  /** Hard cap on number of chunks (protects memory). Optional */
  maxChunks?: number;
};

const CHARS_PER_TOKEN = 4; // ~4 chars ≈ 1 token for English-like text

/** Convert tokens ↔ chars using the rough heuristic above */
const toChars = (tokens: number) => Math.max(1, Math.floor(tokens * CHARS_PER_TOKEN));

/** Normalize text: trim, unify newlines, collapse excessive blank lines */
function normalize(input: string) {
  // normalize CRLF -> LF and collapse 3+ newlines to just 2
  return input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Find a nicer cut near `targetEnd` (prefer paragraph, then sentence, then space) */
function findNiceBoundary(text: string, start: number, targetEnd: number, lookAhead = 1000) {
  const endWindow = Math.min(targetEnd + lookAhead, text.length);
  const window = text.slice(start, endWindow);

  // Paragraph break (double newline)
  const para = window.lastIndexOf("\n\n");
  // Sentence enders (., !, ?, ideographic 。！？) followed by space/newline
  const sent = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("。\n"),
    window.lastIndexOf("！\n"),
    window.lastIndexOf("？\n")
  );
  // Word boundary
  const space = window.lastIndexOf(" ");

  // Prefer a boundary that is not too close to the start
  const minGood = Math.floor(window.length * 0.4);
  const pick = [para, sent, space].filter(i => i >= minGood).sort((a, b) => a - b).pop();

  if (typeof pick === "number" && pick >= 0) {
    return start + pick + 1; // include the boundary char
  }
  return targetEnd; // fallback: hard cut
}

/** Chunk text with approximate token sizes and safe overlap */
export function chunkText(
  raw: string,
  opts: ChunkOptions = { chunkTokens: 1000, overlap: 150 }
): Chunk[] {
  const chunkTokens = opts.chunkTokens ?? 1000;
  const overlapTokens = opts.overlap ?? 150;
  const maxChunks = opts.maxChunks ?? Infinity;

  // Convert token goals to chars
  const targetChars = toChars(chunkTokens);
  // Guard: if overlap >= chunk, cap overlap to 15% of target to avoid infinite loops
  const overlapChars = Math.min(toChars(overlapTokens), Math.floor(targetChars * 0.15));

  const text = normalize(raw);
  const chunks: Chunk[] = [];

  let start = 0;
  let position = 0;

  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(start + targetChars, text.length);

    // find a nice boundary if possible
    end = findNiceBoundary(text, start, end);

    // safety: ensure forward progress
    if (end <= start) {
      end = Math.min(start + targetChars, text.length);
      if (end <= start) break; // no progress; bail
    }

    const slice = text.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, section: "body", position: position++ });
    }

    // move with overlap; ensure at least 1 char progress
    const step = Math.max(1, end - start - overlapChars);
    start += step;
  }

  return chunks;
}
