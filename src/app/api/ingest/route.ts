import { NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getWeaviate } from "@/lib/weaviate";
import { chunkText } from "@/lib/chunker";
import { CohereClient } from "cohere-ai";

export const runtime = "nodejs";

// ---- Tunables (or set via .env) ----
const EMBED_BATCH = Number(process.env.COHERE_EMBED_BATCH ?? 96);   // Cohere hard limit
const UPSERT_BATCH = Number(process.env.WEAVIATE_UPSERT_BATCH ?? 200);
const MAX_INGEST_CHUNKS = Number(process.env.MAX_INGEST_CHUNKS ?? 800);

// Cohere can return number[][] or { float: number[][], ... }
type EmbeddingsUnion = number[][] | Record<string, number[][]>;
function toVectors(emb: unknown): number[][] {
  const e = emb as EmbeddingsUnion;
  if (Array.isArray(e)) return e;
  const obj = e as Record<string, number[][]>;
  return (obj.float ?? Object.values(obj)[0]) as number[][];
}

const IngestBody = z.object({
  text: z.string().min(1),
  title: z.string().default("Untitled"),
  source: z.string().default("upload"),
  url: z.string().optional(),
  docId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = IngestBody.parse(await req.json());
    const doc_id = body.docId ?? uuidv4();

    // 1) Chunk (lightweight, token-approx)
    let chunks = chunkText(body.text, { chunkTokens: 1000, overlap: 150, maxChunks: MAX_INGEST_CHUNKS });
    if (chunks.length > MAX_INGEST_CHUNKS) {
      chunks = chunks.slice(0, MAX_INGEST_CHUNKS);
    }

    // 2) Embed with Cohere in batches of ≤ 96
    if (!process.env.COHERE_API_KEY) {
      return NextResponse.json({ ok: false, error: "COHERE_API_KEY missing" }, { status: 400 });
    }
    const co = new CohereClient({ token: process.env.COHERE_API_KEY! });

    const vectors: number[][] = [];
    const model = process.env.EMBEDDING_MODEL || "embed-english-v3.0";

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const resp = (await co.embed({
        model,
        texts: slice.map((c) => c.text),
        // keep the runtime value but avoid `any` in types:
        inputType: "search_document" as unknown as never,
      })) as unknown as { embeddings: EmbeddingsUnion };

      const vs = toVectors(resp.embeddings);
      if (vs.length !== slice.length) {
        throw new Error(`Embedding count mismatch at batch starting ${i}: expected ${slice.length}, got ${vs.length}`);
      }
      vectors.push(...vs);
    }

    // 3) Upsert to Weaviate (batch as well)
    const weav = getWeaviate();
    const className = process.env.VECTOR_CLASS_NAME || "DocChunk";

    let totalInserted = 0;
    for (let i = 0; i < chunks.length; i += UPSERT_BATCH) {
      const end = Math.min(i + UPSERT_BATCH, chunks.length);
      const batcher = weav.batch.objectsBatcher();

      for (let j = i; j < end; j++) {
        const c = chunks[j];
        batcher.withObject({
          class: className,
          properties: {
            doc_id,
            chunk_id: uuidv4(),
            source: body.source,
            title: body.title,
            section: c.section,
            position: c.position,
            text: c.text,
            url: body.url ?? "",
            published_at: "",
          },
          vector: vectors[j],
        });
      }

      const res = (await batcher.do()) as unknown;
      const inserted = Array.isArray(res)
        ? (res as unknown[]).length
        : ((res as { results?: { objects?: unknown[] } })?.results?.objects?.length ?? 0);

      totalInserted += inserted;
    }

    return NextResponse.json({
      ok: true,
      doc_id,
      chunks: chunks.length,
      embedded: vectors.length,
      weaviate_status: totalInserted,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
