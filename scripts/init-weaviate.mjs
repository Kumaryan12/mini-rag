import weaviate from "weaviate-ts-client";

const host = process.env.WEAVIATE_HOST;
const apiKey = process.env.WEAVIATE_API_KEY;
const className = process.env.VECTOR_CLASS_NAME || "DocChunk";

if (!host || !apiKey) {
  console.error("WEAVIATE_HOST / WEAVIATE_API_KEY missing");
  process.exit(1);
}

const client = weaviate.client({
  scheme: "https",
  host,
  apiKey: new weaviate.ApiKey(apiKey),
});

async function main() {
  const schema = await client.schema.getter().do();
  const exists = schema?.classes?.some(c => c.class === className);
  if (exists) {
    console.log(`Class ${className} exists; deleting for a clean start…`);
    await client.schema.classDeleter().withClassName(className).do();
  }

  await client.schema.classCreator().withClass({
    class: className,
    vectorizer: "none",
    vectorIndexType: "hnsw",
    vectorIndexConfig: { distance: "cosine" },
    properties: [
      { name: "doc_id", dataType: ["text"] },
      { name: "chunk_id", dataType: ["text"] },
      { name: "source", dataType: ["text"] },
      { name: "title", dataType: ["text"] },
      { name: "section", dataType: ["text"] },
      { name: "position", dataType: ["int"] },
      { name: "text", dataType: ["text"] },
      { name: "url", dataType: ["text"] },
      { name: "published_at", dataType: ["text"] }
    ]
  }).do();

  console.log(`Created class ${className}.`);
}

main().catch(e => (console.error(e), process.exit(1)));
