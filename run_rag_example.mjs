// run_rag_example.mjs
import { RAGKnowledgeBase } from "./ragKnowledgeBase.js";

async function main() {
  // Create a RAG knowledge base (no embedding model => embeddings will be placeholders)
  const kb = new RAGKnowledgeBase({ knowledgeDir: "./tmp_kb_example" });

  // Add a document
  const doc = await kb.addDocument("Sample Guidance", "This guidance says informed consent must be obtained from participants.", {
    source_type: "guideline",
    source_name: "ExampleOrg",
    document_type: "consent",
    tags: ["consent", "example"]
  });
  console.log("Added document:", doc.id);


  // Run a retrieval
  const results = await kb.retrieveRelevantKnowledge("informed consent requirements", { topK: 3 });
  console.log("Retrieve results:", JSON.stringify(results, null, 2));

  // Export KB
  const exported = kb.exportKnowledge();
  console.log("Export summary:", { total_documents: exported.documents.length });

  // Persist a backup file (returns path)
  const backupPath = kb.persistKnowledge();
  console.log("Backup saved to:", backupPath);
}

main().catch(err => {
  console.error("Example script error:", err);
  process.exit(1);
});