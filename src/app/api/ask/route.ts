import { NextResponse } from "next/server";
import { z } from "zod";
import { getWeaviate } from "@/lib/weaviate";
import { CohereClient } from "cohere-ai";

export const runtime = "nodejs";

// Normalize Cohere embed() output to number[][]
function toVectors(emb: any): number[][] {
  if (Array.isArray(emb)) return emb as number[][];
  const obj = emb as Record<string, number[][]>;
  return (obj.float ?? Object.values(obj)[0]) as number[][];
}

const AskBody = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().default(12),
  finalN: z.number().int().positive().default(6),
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

export async function POST(req: Request) {
  try {
    const { query, topK, finalN } = AskBody.parse(await req.json());
    const t0 = Date.now();

    const co = new CohereClient({ token: process.env.COHERE_API_KEY! });

    // 1) embed query
    const qemb = await co.embed({
      model: process.env.EMBEDDING_MODEL || "embed-english-v3.0",
      texts: [query],
      inputType: "search_query" as any,
    });
    const qvec = toVectors(qemb.embeddings)[0];

    // 2) retrieve from Weaviate
    const weav = getWeaviate();
    const className = process.env.VECTOR_CLASS_NAME || "DocChunk";
    const gql = await weav.graphql
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
      .withLimit(topK)
      .do();

    const hits: any[] = gql?.data?.Get?.[className] ?? [];
    if (!hits.length) {
      return NextResponse.json({ ok: true, answer: "I don't know.", sources: [], timings_ms: { total: Date.now() - t0 } });
    }

    // 3) rerank
    const documents: string[] = hits.map(
      (h: any) => `${h.title ? `${h.title} — ` : ""}${h.section ? `${h.section}: ` : ""}${h.text}`
    );
    const rr = await co.rerank({
      model: "rerank-english-v3.0",
      query,
      documents,
      topN: Math.min(finalN, documents.length),
    });
    const picked = rr.results.map((r: any) => hits[r.index]);
    if (!picked.length) {
      return NextResponse.json({ ok: true, answer: "I don't know.", sources: [], timings_ms: { total: Date.now() - t0 } });
    }

    // 4) build context
    const numberedSnippets = picked.map((h: any) => {
      const meta = `${h.title ?? "Untitled"}${h.section ? " — " + h.section : ""} (${h.source}${h.url ? ": " + h.url : ""}, #${h.position})`;
      const snippet = (h.text as string).slice(0, 900);
      return `${snippet}\n— ${meta}`;
    });

    // 5) answer with Cohere Chat
    const prompt = buildPrompt(query, numberedSnippets);
    const chat = await co.chat({ model: "command-r-plus", temperature: 0.2, message: prompt });
    const answer =
      (chat as any).text ??
      (chat as any).message?.content?.[0]?.text ??
      "I don't know.";

    const sources = picked.map((h: any, i: number) => ({
      n: i + 1,
      title: h.title ?? "Untitled",
      section: h.section ?? "",
      position: h.position ?? 0,
      source: h.source ?? "",
      url: h.url ?? "",
      snippet: (h.text as string).slice(0, 300) + ((h.text as string).length > 300 ? "…" : ""),
    }));

    return NextResponse.json({ ok: true, answer, timings_ms: { total: Date.now() - t0 }, sources });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
