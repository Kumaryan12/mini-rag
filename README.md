<a id="readme-top"></a>

# Mini-RAG (Track B)

**Live demo:** `https://mini-rag-ak.vercel.app`  

Paste text → index to a **cloud-hosted vector DB** (Weaviate) → **retrieve** top-k → **rerank** (Cohere) → **answer** (Cohere) with inline citations like `[1]`.

---

## Highlights

- **Cloud vector DB:** Weaviate Cloud, HNSW, cosine, vectorizer=none, **1024-dim** vectors  
- **Embeddings:** Cohere `embed-english-v3.0`  
- **Retrieval + Rerank:** top-k (default 12) → Cohere `rerank-english-v3.0` → keep best N (default 6)  
- **LLM + Citations:** Cohere `command-r-plus`, grounded answers with inline `[n]` and source panel  
- **Chunking:** ~1,000 tokens per chunk, ~150-token overlap (~10–15%), sentence-aware splits  
- **Batching:** Cohere embed batches (≤96) and Weaviate upserts in batches to avoid limits  
- **Frontend:** Next.js (App Router) with timing and sources UI

<p align="right"><a href="#readme-top">↑ back to top</a></p>

---

## Architecture

```mermaid
flowchart LR
  A[Frontend (Next.js)] -->|POST "/api/ingest"| B[Ingest API]
  A -->|POST "/api/ask"| C[Ask API]
  B -->|"chunk → embed (Cohere)"| D[Cohere Embeddings]
  B -->|"batched upserts"| E[Weaviate Cloud]
  C -->|"embed query"| D
  C -->|"top-k vector search"| E
  C -->|"rerank best N"| F[Cohere Rerank]
  C -->|"prompt with numbered snippets"| G[Cohere Chat]
  G -->|"answer + [n] citations"| A
<p align="right"><a href="#readme-top">↑ back to top</a></p>
Index / Collection Config (Weaviate)
Class name: DocChunk

Distance: cosine

Vectorizer: none

Vector index: HNSW

Dimension: 1024 (Cohere embed-english-v3.0)

Properties stored:
doc_id, chunk_id, source, title, section, position, text, url, published_at

Upsert strategy: one object per chunk with its vector + metadata.

One-time schema helper: scripts/init-weaviate.mjs creates/ensures the DocChunk class.

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Chunking Strategy
Target ~1,000 tokens/chunk (fast 4 chars ≈ 1 token heuristic)

~150 token overlap (~10–15%)

Prefer sentence/paragraph boundaries; record section="body", position (0-based)

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Environment Variables
Create .env.local locally and set the same on Vercel Production:

bash
Copy code
COHERE_API_KEY=your_cohere_key

# Hostname only — no "https://" and no trailing slash
WEAVIATE_HOST=your-cluster.weaviate.cloud
WEAVIATE_API_KEY=your_weaviate_admin_key

EMBEDDING_MODEL=embed-english-v3.0
VECTOR_CLASS_NAME=DocChunk

# Tunables (safe defaults)
MAX_INGEST_CHUNKS=800
COHERE_EMBED_BATCH=96
WEAVIATE_UPSERT_BATCH=200
Important: WEAVIATE_HOST must be just the hostname (xyz.weaviate.cloud), not a full URL.

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Project Structure
text
Copy code
.
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ ingest/route.ts      # chunk → embed (batched) → upsert (batched)
│  │  │  └─ ask/route.ts         # embed query → retrieve → rerank → chat → citations
│  │  ├─ layout.tsx
│  │  └─ page.tsx                # simple paste + ask UI
│  └─ lib/
│     ├─ chunker.ts              # sentence-aware ~1000/150 chunking (char→token approx)
│     └─ weaviate.ts             # client factory using env vars
├─ scripts/
│  └─ init-weaviate.mjs          # ensure DocChunk (1024-d, cosine, HNSW)
├─ .env.example
├─ next.config.ts
├─ package.json
└─ README.md
<p align="right"><a href="#readme-top">↑ back to top</a></p>
Quick Start (Local)
bash
Copy code
# 1) Install
npm i

# 2) Copy env template and fill values
cp .env.example .env.local

# 3) Ensure Weaviate class exists
node --env-file=.env.local scripts/init-weaviate.mjs

# 4) Run
npm run dev
Open http://localhost:3000

Paste some text → Index Text

Ask a question → see answer + [n] citations + sources

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Deploy (Vercel – free host)
Import the GitHub repo into Vercel

Add the Environment Variables above to Production

Deploy → open the live URL (first screen should load with no console errors)

<p align="right"><a href="#readme-top">↑ back to top</a></p>
API
POST /api/ingest
Request

json
Copy code
{
  "text": "full document text",
  "title": "My Document",
  "source": "upload",
  "url": "",
  "docId": ""
}
Behavior

Chunk (~1000/150)

Cohere embeddings in batches of ≤ 96

Upsert to Weaviate in batches (default 200)

Response

json
Copy code
{ "ok": true, "doc_id": "uuid", "chunks": 74, "embedded": 74, "weaviate_status": 74 }
POST /api/ask
Request

json
Copy code
{ "query": "string", "topK": 12, "finalN": 6 }
Behavior

Embed query (Cohere) → vector search (Weaviate) → rerank (Cohere) → chat (Cohere)

Answer with inline citations [n]; show sources/snippets

Response

json
Copy code
{
  "ok": true,
  "answer": "… [1] … [3].",
  "sources": [
    { "n": 1, "title": "My Document", "section": "body", "position": 12, "source": "upload", "url": "", "snippet": "…" }
  ],
  "timings_ms": { "total": 1830 }
}
<p align="right"><a href="#readme-top">↑ back to top</a></p>
Minimal Eval (Acceptance Criteria)
Use this sample doc to create a small index:

text
Copy code
System: Mini-RAG demo spec.

Vector DB: Weaviate Cloud, HNSW, cosine, vectorizer=none.

Embeddings: Cohere embed-english-v3.0 (1024-dim).

Chunking: ~1,000 tokens per chunk with ~150-token overlap (~10–15%). We store metadata: doc_id, chunk_id, source, title, section, position, text, url, published_at.

Retrieval: vector top-k = 12 from Weaviate.

Reranker: Cohere rerank-english-v3.0; after reranking we keep the best 6 chunks.

Answering LLM: Cohere command-r-plus. Answers must be grounded in context with inline [n] citations; if not found, reply “I don’t know.”

Frontend: shows total time in ms.

Upsert strategy: one object per chunk with its vector and metadata.
Ask these 5 questions on the live URL and record your outcomes:

What embedding model and dimensionality are used?

What chunk size and overlap are configured?

Which reranker is used and how many chunks are kept?

What distance metric does the vector DB use?

What should the model answer if the info isn’t in the context?

Expected: clear answers with correct [n] citations and visible sources.

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Troubleshooting
401 invalid api token → check COHERE_API_KEY / WEAVIATE_API_KEY

Weaviate host issues → WEAVIATE_HOST must be hostname only (no https://)

Cohere “≤96 texts” error → batching is implemented; if you still hit it, reload and try again

Class not found → run node --env-file=.env.local scripts/init-weaviate.mjs

No-answer cases → should return “I don’t know.”

<p align="right"><a href="#readme-top">↑ back to top</a></p>
Remarks (Limits & Next Steps)
Current limits

Vector-only retrieval (no hybrid BM25) and no metadata filters yet

No delete/list endpoints (re-ingest may duplicate)

Single-turn answers; no streaming or conversation history

Approximate tokenizer for chunk sizes

English embedding model; multilingual content may underperform

Possible next steps

Hybrid search (BM25 + vector) & basic metadata filters (title, date, source)

Delete/list APIs + small admin UI

Streaming answers & highlighted citations

Switchable multilingual embeddings

Auth + per-user namespaces and quotas

<p align="right"><a href="#readme-top">↑ back to top</a></p>
License
MIT — free to use, no warranty.

Notes for Reviewers
Working URL loads without console errors

Flow: query → retrieved chunks → reranked → LLM answer with citations

README includes index config, chunking params, providers, quick-start, remarks

.env.example
bash
Copy code
# Cohere
COHERE_API_KEY=YOUR_KEY

# Weaviate Cloud (hostname only; no https://)
WEAVIATE_HOST=your-cluster.weaviate.cloud
WEAVIATE_API_KEY=YOUR_ADMIN_KEY

# RAG config
EMBEDDING_MODEL=embed-english-v3.0
VECTOR_CLASS_NAME=DocChunk

# Batching / limits
MAX_INGEST_CHUNKS=800
COHERE_EMBED_BATCH=96
WEAVIATE_UPSERT_BATCH=200
