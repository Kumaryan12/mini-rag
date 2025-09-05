import { NextResponse } from "next/server";
import { z } from "zod";
import { getWeaviate } from "@/lib/weaviate";
import { CohereClient } from "cohere-ai";

export const runtime = "nodejs";

/* ---------- Types ---------- */

type EmbeddingsUnion = number[][] | Record<string, number[][]>;
interface CohereEmbedResponse { embeddings: EmbeddingsUnion; }
interface CohereRerankResponse { results: Array<{ index: number }>; }
interface CohereChatMessagePart { text?: string }
interface CohereChatLike { text?: string; message?: { content?: CohereChatMessagePart[] } }

interface WeaviateHit {
  text: string;
  title?: string;
  section?: string;
  position?: number;
  source?: string;
  url?: string;
  doc_id?: string;
  _additional?: { id?: string; distance?: number };
}
interface WeaviateGraphQLGet {
  data?: { Get?: Record<string, WeaviateHit[]> };
}

/* ---------- Helpers ---------- */

function toVectors(emb: unknown): number[][] {
  const e = emb as EmbeddingsUnion;
  if (Array.isArray(e)) return e;
  const obj = e as Record<string, number[][]>;
  return (obj.float ?? Object.values(obj)[0]) ?? [];
}

// ADD: optional docId
const AskBody = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().default(12),
  finalN: z.number().int().positive().default(6),
  docId: z.string().optional(),
});

function buildPrompt(query: string, numberedSnippets: string[]) {
  const context = numberedSnippets.map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
  return `You are a helpful assistant answering strictly from the provided context.
Add inline citations like [1], [2] at the END of sentences that use that source.
If the answer is not in the context, say "I don't know." Do not fabricate.

Question: ${query}

Context:
${context}

Answer (concise, with citations):`;
}

/* ---------- Route ---------- */

export async function POST(req: Request) {
  try {
    // PARSE docId as well
    const { query, topK, finalN, docId } = AskBody.parse(await req.json());
    const t0 = Date.now();

    const co = new CohereClient({ token: process.env.COHERE_API_KEY! });

    // 1) embed query
    const qemb = (await co.embed({
      model: process.env.EMBEDDING_MODEL || "embed-english-v3.0",
      texts: [query],
      // runtime value preserved; cast only to satisfy types:
      inputType: "search_query" as unknown as never,
    })) as unknown as CohereEmbedResponse;
    const qvec = toVectors(qemb.embeddings)[0];

    // 2) retrieve from Weaviate (optionally filter by doc_id)
    const weav = getWeaviate();
    const className = process.env.VECTOR_CLASS_NAME || "DocChunk";

    const getBuilder = weav.graphql
      .get()
      .withClassName(className)
      .withFields(`
        text
        title
        section
        position
        source
        url
        doc_id
        _additional { id distance }
      `)
      .withNearVector({ vector: qvec })
      .withLimit(topK);

    // NEW: scope to a single document when docId is provided
    if (docId) {
      getBuilder.withWhere({
        path: ["doc_id"],
        operator: "Equal",
        valueString: docId,
      } as unknown as never);
    }

    const gql = (await getBuilder.do()) as unknown as WeaviateGraphQLGet;

    const hits: WeaviateHit[] = gql?.data?.Get?.[className] ?? [];
    if (!hits.length) {
      return NextResponse.json({
        ok: true,
        answer: "I don't know.",
        sources: [],
        timings_ms: { total: Date.now() - t0 },
      });
    }

    // 3) rerank
    const documents: string[] = hits.map(
      (h) => `${h.title ? `${h.title} — ` : ""}${h.section ? `${h.section}: ` : ""}${h.text}`
    );
    const rr = (await co.rerank({
      model: "rerank-english-v3.0",
      query,
      documents,
      topN: Math.min(finalN, documents.length),
    })) as unknown as CohereRerankResponse;

    const picked: WeaviateHit[] = rr.results.map(r => hits[r.index]).filter(Boolean);
    if (!picked.length) {
      return NextResponse.json({
        ok: true,
        answer: "I don't know.",
        sources: [],
        timings_ms: { total: Date.now() - t0 },
      });
    }

    // 4) build context
    const numberedSnippets = picked.map((h) => {
      const meta = `${h.title ?? "Untitled"}${h.section ? " — " + h.section : ""} (${h.source}${
        h.url ? ": " + h.url : ""
      }, #${h.position})`;
      const snippet = h.text.slice(0, 900);
      return `${snippet}\n— ${meta}`;
    });

    // 5) answer with Cohere Chat
    const prompt = buildPrompt(query, numberedSnippets);
    const chat = (await co.chat({
      model: "command-r-plus",
      temperature: 0.2,
      message: prompt,
    })) as unknown as CohereChatLike;

    const answer = chat.text ?? chat.message?.content?.[0]?.text ?? "I don't know.";

    const sources = picked.map((h, i) => ({
      n: i + 1,
      title: h.title ?? "Untitled",
      section: h.section ?? "",
      position: h.position ?? 0,
      source: h.source ?? "",
      url: h.url ?? "",
      snippet: h.text.slice(0, 300) + (h.text.length > 300 ? "…" : ""),
    }));

    return NextResponse.json({
      ok: true,
      answer,
      timings_ms: { total: Date.now() - t0 },
      sources,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
