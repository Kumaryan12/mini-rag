"use client";
import { useState } from "react";

type AskResp = {
  ok: boolean;
  answer?: string;
  sources?: {
    n: number; title: string; section: string; position: number;
    source: string; url: string; snippet: string;
  }[];
  timings_ms?: { total: number };
  error?: string | unknown; // ← was `any`
};

export default function Home() {
  const [title, setTitle] = useState("My Document");
  const [text, setText] = useState("");
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<AskResp | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleIngest() {
    const content = text.trim();
    if (!content) { setIngestStatus("Paste some text first."); return; }
    setIngestStatus("Indexing…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content, title, source: "upload" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(JSON.stringify(data.error ?? data));
      setIngestStatus(`✅ Indexed ${data.chunks} chunks (doc_id=${data.doc_id})`);
    } catch (e: unknown) { // ← was `any`
      const msg = e instanceof Error ? e.message : String(e);
      setIngestStatus(`❌ ${msg}`);
    }
  }

  async function handleAsk() {
    const q = query.trim();
    if (!q) { setAnswer({ ok: false, error: "Please type a question." }); return; }
    setLoading(true);
    setAnswer(null);
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, topK: 12, finalN: 6 }),
    });
    const data: AskResp = await res.json();
    setAnswer(data);
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <h1 className="text-3xl font-bold">Mini-RAG</h1>
      <p className="text-sm opacity-80">
        Paste text → index to Weaviate → retrieve, rerank (Cohere), answer (Cohere) with citations.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1) Ingest</h2>
        <input className="w-full border rounded p-2"
          placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="w-full h-40 border rounded p-3 font-mono"
          placeholder="Paste any text here…" value={text} onChange={(e) => setText(e.target.value)} />
        <button onClick={handleIngest} disabled={!text.trim()}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-40">Index Text</button>
        {ingestStatus && <div className="text-sm">{ingestStatus}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2) Ask</h2>
        <input className="w-full border rounded p-2"
          placeholder="Ask a question about your indexed text…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={handleAsk} disabled={!query.trim() || loading}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-40">
          {loading ? "Thinking…" : "Ask"}
        </button>

        {answer?.ok && (
          <div className="mt-4 space-y-4">
            <div className="prose max-w-none">
              <h3 className="font-semibold">Answer</h3>
              <div className="whitespace-pre-wrap">{answer.answer}</div>
              {answer.timings_ms?.total && (
                <div className="text-xs opacity-70 mt-2">Total time: {answer.timings_ms.total} ms</div>
              )}
            </div>
            <div>
              <h4 className="font-semibold">Sources</h4>
              <ul className="space-y-3">
                {answer.sources?.map((s) => (
                  <li key={s.n} className="border rounded p-3">
                    <div className="text-sm font-medium">[{s.n}] {s.title} {s.section ? `— ${s.section}` : ""}</div>
                    <div className="text-xs opacity-70">
                      {s.source} {s.url ? `• ${s.url}` : ""} • chunk #{s.position}
                    </div>
                    <p className="text-sm mt-1">{s.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {answer && !answer.ok && (
          <div className="text-red-500 text-sm">Error: {typeof answer.error === "string" ? answer.error : JSON.stringify(answer.error)}</div>
        )}
      </section>
    </main>
  );
}
