import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mini-RAG",
  description: "Cohere + Weaviate Mini RAG with citations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
