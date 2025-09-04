import weaviate, { type WeaviateClient } from "weaviate-ts-client";

let client: WeaviateClient | null = null;

export function getWeaviate() {
  if (client) return client;
  const host = process.env.WEAVIATE_HOST;
  const apiKey = process.env.WEAVIATE_API_KEY;
  if (!host || !apiKey) throw new Error("WEAVIATE_HOST / WEAVIATE_API_KEY missing");

  client = weaviate.client({
    scheme: "https",
    host,
    apiKey: new weaviate.ApiKey(apiKey),
  });
  return client;
}
