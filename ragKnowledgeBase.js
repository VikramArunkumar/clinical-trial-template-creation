/**
 * ========================================================================
 * RAG-BASED KNOWLEDGE INTEGRATION MODULE
 * ========================================================================
 * Retrieval-Augmented Generation system for grounding model responses in:
 * - Updated FDA/EMA regulations
 * - Clinical evidence and guidelines
 * - Past templates and SOPs
 * - Organization-specific practices
 *
 * Features:
 * - Vector embeddings for semantic search
 * - Multi-source knowledge base integration
 * - Factual grounding verification
 * - Evidence tracking and citation
 * - Relevance scoring and ranking
 *
 * Target: >90% factual grounding accuracy
 */

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ========================================================================
// KNOWLEDGE SOURCE MANAGEMENT
// ========================================================================

/**
 * Represents a single knowledge source document
 * (regulation, SOP, template, guideline, etc.)
 */
class KnowledgeDocument {
  constructor({
    id = nanoid(),
    title,
    content,
    source_type, // "regulation" | "guideline" | "sop" | "template" | "evidence"
    source_name, // "FDA", "EMA", "ICH", "organization", etc.
    document_type, // "protocol", "consent", "safety", etc.
    version = "1.0",
    last_updated = new Date().toISOString(),
    tags = [],
    metadata = {}
  }) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.source_type = source_type;
    this.source_name = source_name;
    this.document_type = document_type;
    this.version = version;
    this.last_updated = last_updated;
    this.tags = tags;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      content: this.content,
      source_type: this.source_type,
      source_name: this.source_name,
      document_type: this.document_type,
      version: this.version,
      last_updated: this.last_updated,
      tags: this.tags,
      metadata: this.metadata
    };
  }
}

/**
 * Represents a chunk of text with embeddings
 */
class EmbeddedChunk {
  constructor({
    id = nanoid(),
    document_id,
    chunk_index,
    text,
    embedding = null,
    metadata = {}
  }) {
    this.id = id;
    this.document_id = document_id;
    this.chunk_index = chunk_index;
    this.text = text;
    this.embedding = embedding;
    this.metadata = metadata;
  }
}

/**
 * Citation tracking for evidence-based responses
 */
class Citation {
  constructor({
    id = nanoid(),
    chunk_id,
    document_id,
    source_name,
    source_type,
    title,
    relevance_score,
    quote,
    paraphrase,
    used_in_response = true
  }) {
    this.id = id;
    this.chunk_id = chunk_id;
    this.document_id = document_id;
    this.source_name = source_name;
    this.source_type = source_type;
    this.title = title;
    this.relevance_score = relevance_score;
    this.quote = quote;
    this.paraphrase = paraphrase;
    this.used_in_response = used_in_response;
  }
}

// ========================================================================
// RAG KNOWLEDGE BASE ENGINE
// ========================================================================

export class RAGKnowledgeBase {
  constructor({ 
    knowledgeDir = "./knowledge_base",
    embeddingModel = null,
    chunkSize = 1200,
    chunkOverlap = 150,
    retrievalTopK = 5
  } = {}) {
    this.knowledgeDir = knowledgeDir;
    this.embeddingModel = embeddingModel;
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.retrievalTopK = retrievalTopK;

    // In-memory storage
    this.documents = new Map(); // id -> KnowledgeDocument
    this.chunks = new Map(); // id -> EmbeddedChunk
    this.documentChunks = new Map(); // docId -> [chunkIds]
    this.citations = [];

    // Statistics
    this.stats = {
      total_documents: 0,
      total_chunks: 0,
      embedding_coverage: 0,
      last_updated: null
    };

    fs.mkdirSync(knowledgeDir, { recursive: true });
    this._ensureDirectories();
    this._loadExistingKnowledge();
  }

  _ensureDirectories() {
    const dirs = [
      path.join(this.knowledgeDir, "documents"),
      path.join(this.knowledgeDir, "chunks"),
      path.join(this.knowledgeDir, "citations"),
      path.join(this.knowledgeDir, "metadata")
    ];
    dirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  }

  // ====================================================================
  // DOCUMENT MANAGEMENT
  // ====================================================================

  /**
   * Add a new knowledge source document
   */
  async addDocument(title, content, {
    source_type = "guideline",
    source_name = "organization",
    document_type = "general",
    version = "1.0",
    tags = [],
    metadata = {}
  } = {}) {
    const doc = new KnowledgeDocument({
      title,
      content,
      source_type,
      source_name,
      document_type,
      version,
      tags,
      metadata
    });

    this.documents.set(doc.id, doc);
    this.documentChunks.set(doc.id, []);

    // Persist document
    const docFile = path.join(this.knowledgeDir, "documents", `${doc.id}.json`);
    fs.writeFileSync(docFile, JSON.stringify(doc.toJSON(), null, 2));

    // Chunk the document (await to ensure chunks/embeddings are available)
    try {
      await this._chunkDocument(doc);
    } catch (e) {
      console.warn(`Chunking failed for document ${doc.id}:`, e?.message || String(e));
    }

    this.stats.total_documents = this.documents.size;
    this.stats.last_updated = new Date().toISOString();

    return doc;
  }

  /**
   * Update an existing document (new version)
   */
  async updateDocument(documentId, content, { version = null } = {}) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const nextVersion = version || this._incrementVersion(doc.version);
    const oldId = doc.id;

    // Create new version
    const newDoc = new KnowledgeDocument({
      id: documentId, // Keep same ID for version tracking
      title: doc.title,
      content,
      source_type: doc.source_type,
      source_name: doc.source_name,
      document_type: doc.document_type,
      version: nextVersion,
      tags: doc.tags,
      metadata: { ...doc.metadata, previous_version_id: oldId }
    });

    this.documents.set(documentId, newDoc);

    // Clear old chunks
    const oldChunks = this.documentChunks.get(documentId) || [];
    oldChunks.forEach(chunkId => this.chunks.delete(chunkId));
    this.documentChunks.set(documentId, []);

    // Rechunk with new content (await to ensure chunks/embeddings are updated)
    try {
      await this._chunkDocument(newDoc);
    } catch (e) {
      console.warn(`Re-chunking failed for document ${documentId}:`, e?.message || String(e));
    }

    // Persist
    const docFile = path.join(this.knowledgeDir, "documents", `${documentId}.json`);
    fs.writeFileSync(docFile, JSON.stringify(newDoc.toJSON(), null, 2));

    return newDoc;
  }

  /**
   * Remove a document (soft delete)
   */
  removeDocument(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    const chunks = this.documentChunks.get(documentId) || [];
    chunks.forEach(chunkId => this.chunks.delete(chunkId));
    this.documentChunks.delete(documentId);

    // Mark as inactive instead of deleting
    doc.metadata.active = false;
    doc.metadata.deactivated_at = new Date().toISOString();

    const docFile = path.join(this.knowledgeDir, "documents", `${documentId}.json`);
    fs.writeFileSync(docFile, JSON.stringify(doc.toJSON(), null, 2));

    this.stats.total_documents = this.documents.size;

    return doc;
  }

  /**
   * Get document by ID
   */
  getDocument(documentId) {
    return this.documents.get(documentId);
  }

  /**
   * List all active documents
   */
  getAllDocuments({ sourceType = null, sourceName = null } = {}) {
    let docs = Array.from(this.documents.values());

    // Filter by source type
    if (sourceType) {
      docs = docs.filter(d => d.source_type === sourceType);
    }

    // Filter by source name
    if (sourceName) {
      docs = docs.filter(d => d.source_name === sourceName);
    }

    // Filter active only
    return docs.filter(d => d.metadata.active !== false);
  }

  // ====================================================================
  // CHUNKING & EMBEDDING
  // ====================================================================

  /**
   * Split document into chunks and create embeddings
   */
  async _chunkDocument(doc) {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap
    });

    const texts = await splitter.splitText(doc.content);

    for (let i = 0; i < texts.length; i++) {
      const chunk = new EmbeddedChunk({
        document_id: doc.id,
        chunk_index: i,
        text: texts[i],
        metadata: {
          source_type: doc.source_type,
          source_name: doc.source_name,
          document_type: doc.document_type,
          title: doc.title
        }
      });

      // Generate embedding if model available
      if (this.embeddingModel) {
        try {
          chunk.embedding = await this._generateEmbedding(texts[i]);
        } catch (e) {
          console.warn(`Embedding generation failed for chunk ${chunk.id}:`, e.message);
        }
      }

      this.chunks.set(chunk.id, chunk);
      this.documentChunks.get(doc.id).push(chunk.id);

      // Persist chunk
      const chunkFile = path.join(this.knowledgeDir, "chunks", `${chunk.id}.json`);
      fs.writeFileSync(chunkFile, JSON.stringify({
        id: chunk.id,
        document_id: chunk.document_id,
        chunk_index: chunk.chunk_index,
        text: chunk.text,
        embedding_available: !!chunk.embedding,
        metadata: chunk.metadata
      }, null, 2));
    }

    this.stats.total_chunks = this.chunks.size;
  }

  /**
   * Generate embedding for text (placeholder - implement with actual model)
   */
  async _generateEmbedding(text) {
    if (!this.embeddingModel) return null;

    try {
      // This would use actual embedding model (e.g., sentence-transformers)
      // Placeholder returns a simple hash-based vector for testing
      const hash = require("crypto")
        .createHash("sha256")
        .update(text)
        .digest();

      // Convert hash to vector-like array
      const vector = [];
      for (let i = 0; i < 384; i++) { // 384-dim vector (all-MiniLM-L6-v2 size)
        vector.push((hash[i % hash.length] - 127) / 128);
      }
      return vector;
    } catch (e) {
      return null;
    }
  }

  /**
   * Compute cosine similarity between vectors
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-12);
  }

  // ====================================================================
  // RETRIEVAL (RAG)
  // ====================================================================

  /**
   * Retrieve relevant knowledge chunks for a query
   * Uses semantic similarity (embedding-based) + keyword matching
   */
  async retrieveRelevantKnowledge(query, {
    topK = this.retrievalTopK,
    sourceType = null,
    sourceName = null,
    documentType = null
  } = {}) {
    const queryEmbedding = await this._generateEmbedding(query);
    const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const candidates = [];

    // Score all chunks
    for (const [chunkId, chunk] of this.chunks.entries()) {
      const doc = this.documents.get(chunk.document_id);
      if (!doc || doc.metadata.active === false) continue;

      // Apply filters
      if (sourceType && chunk.metadata.source_type !== sourceType) continue;
      if (sourceName && chunk.metadata.source_name !== sourceName) continue;
      if (documentType && chunk.metadata.document_type !== documentType) continue;

      // Score: 60% semantic, 40% keyword
      let semanticScore = 0;
      if (queryEmbedding && chunk.embedding) {
        semanticScore = this._cosineSimilarity(queryEmbedding, chunk.embedding);
      }

      let keywordScore = 0;
      const chunkText = chunk.text.toLowerCase();
      for (const keyword of queryKeywords) {
        if (chunkText.includes(keyword)) keywordScore += 1;
      }
      keywordScore = Math.min(1, keywordScore / Math.max(1, queryKeywords.length));

      const combinedScore = 0.6 * semanticScore + 0.4 * keywordScore;

      candidates.push({
        chunkId,
        chunk,
        document: doc,
        score: combinedScore,
        semanticScore,
        keywordScore
      });
    }

    // Sort by combined score
    candidates.sort((a, b) => b.score - a.score);

    // Return top-K
    return candidates.slice(0, topK).map(c => ({
      id: c.chunkId,
      text: c.chunk.text,
      document_id: c.document.id,
      title: c.document.title,
      source_type: c.document.source_type,
      source_name: c.document.source_name,
      relevance_score: c.score,
      semantic_score: c.semanticScore,
      keyword_score: c.keywordScore
    }));
  }

  /**
   * Search knowledge base with keyword/semantic search
   */
  async searchKnowledge(query, { topK = 10, threshold = 0.3 } = {}) {
    const results = await this.retrieveRelevantKnowledge(query, { topK });
    return results.filter(r => r.relevance_score >= threshold);
  }

  // ====================================================================
  // CITATION & GROUNDING TRACKING
  // ====================================================================

  /**
   * Record a citation when knowledge is used in response
   */
  recordCitation(chunkId, documentId, {
    quote = "",
    paraphrase = "",
    relevance_score = 0,
    used_in_response = true
  } = {}) {
    const chunk = this.chunks.get(chunkId);
    const doc = this.documents.get(documentId);

    if (!chunk || !doc) {
      throw new Error(`Invalid chunk or document ID`);
    }

    const citation = new Citation({
      chunk_id: chunkId,
      document_id: documentId,
      source_name: doc.source_name,
      source_type: doc.source_type,
      title: doc.title,
      relevance_score,
      quote,
      paraphrase,
      used_in_response
    });

    this.citations.push(citation);

    // Persist
    const citationFile = path.join(this.knowledgeDir, "citations", `${citation.id}.json`);
    fs.writeFileSync(citationFile, JSON.stringify(citation, null, 2));

    return citation;
  }

  /**
   * Get citations for a document response
   */
  getCitations(documentId) {
    return this.citations.filter(c => c.document_id === documentId);
  }

  /**
   * Calculate grounding accuracy (how much of response is backed by sources)
   */
  calculateGroundingAccuracy(citations, responseLength) {
    if (!citations || citations.length === 0) return 0;

    const totalRelevance = citations.reduce((sum, c) => sum + (c.relevance_score || 0), 0);
    const avgRelevance = totalRelevance / citations.length;

    // Grounding accuracy = avg relevance score (0-1) * citation coverage
    const citationCoverage = Math.min(1, citations.length / 5); // Expecting ~5 sources
    const groundingAccuracy = avgRelevance * citationCoverage;

    return Math.min(1, groundingAccuracy);
  }

  // ====================================================================
  // KNOWLEDGE BASE STATISTICS & ANALYTICS
  // ====================================================================

  /**
   * Get knowledge base statistics
   */
  getStatistics() {
    const sources = new Map();
    const types = new Map();

    for (const doc of this.documents.values()) {
      if (doc.metadata.active === false) continue;

      // Count by source
      const sourceName = doc.source_name;
      sources.set(sourceName, (sources.get(sourceName) || 0) + 1);

      // Count by type
      const docType = doc.document_type;
      types.set(docType, (types.get(docType) || 0) + 1);
    }

    return {
      total_documents: Array.from(this.documents.values()).filter(d => d.metadata.active !== false).length,
      total_chunks: this.chunks.size,
      total_citations: this.citations.length,
      sources: Object.fromEntries(sources),
      document_types: Object.fromEntries(types),
      average_chunk_citations: this.citations.length / Math.max(1, this.chunks.size),
      last_updated: this.stats.last_updated
    };
  }

  /**
   * Get source credibility/impact analysis
   */
  getSourceAnalysis() {
    const analysis = {};

    for (const doc of this.documents.values()) {
      if (doc.metadata.active === false) continue;

      const key = `${doc.source_name}`;
      if (!analysis[key]) {
        analysis[key] = {
          source_name: doc.source_name,
          source_type: doc.source_type,
          count: 0,
          citations_used: 0,
          average_recency: 0
        };
      }

      analysis[key].count += 1;

      // Count citations from this source
      const sourceCitations = this.citations.filter(c => c.source_name === doc.source_name);
      analysis[key].citations_used = sourceCitations.length;

      // Calculate recency
      const daysSinceUpdate = (Date.now() - new Date(doc.last_updated).getTime()) / (1000 * 60 * 60 * 24);
      analysis[key].average_recency = daysSinceUpdate;
    }

    return Object.values(analysis);
  }

  /**
   * Export knowledge base for backup/transfer
   */
  exportKnowledge() {
    return {
      exported_at: new Date().toISOString(),
      documents: Array.from(this.documents.values()).map(d => d.toJSON()),
      statistics: this.getStatistics(),
      source_analysis: this.getSourceAnalysis()
    };
  }

  /**
   * Import knowledge base from backup
   */
  importKnowledge(exportedData) {
    const imported = [];

    for (const docData of exportedData.documents || []) {
      try {
        const doc = this.addDocument(docData.title, docData.content, {
          source_type: docData.source_type,
          source_name: docData.source_name,
          document_type: docData.document_type,
          version: docData.version,
          tags: docData.tags,
          metadata: docData.metadata
        });
        imported.push(doc.id);
      } catch (e) {
        console.error(`Failed to import document:`, e.message);
      }
    }

    return { imported_count: imported.length, imported_ids: imported };
  }

  // ====================================================================
  // PERSISTENCE
  // ====================================================================

  /**
   * Load existing knowledge from disk
   */
  _loadExistingKnowledge() {
    const docsDir = path.join(this.knowledgeDir, "documents");

    if (!fs.existsSync(docsDir)) return;

    const files = fs.readdirSync(docsDir).filter(f => f.endsWith(".json"));

    for (const file of files) {
      try {
        const filePath = path.join(docsDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

        const doc = new KnowledgeDocument(data);
        this.documents.set(doc.id, doc);
        this.documentChunks.set(doc.id, []);
      } catch (e) {
        console.error(`Failed to load document ${file}:`, e.message);
      }
    }

    this.stats.total_documents = this.documents.size;
  }

  /**
   * Persist all knowledge to disk (backup)
   */
  persistKnowledge() {
    const backup = {
      timestamp: new Date().toISOString(),
      documents: Array.from(this.documents.values()).map(d => d.toJSON()),
      statistics: this.getStatistics()
    };

    const backupFile = path.join(this.knowledgeDir, "metadata", `backup_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    return backupFile;
  }

  /**
   * Increment version string
   */
  _incrementVersion(version) {
    const parts = version.split(".");
    const last = parseInt(parts[parts.length - 1]);
    parts[parts.length - 1] = String(last + 1);
    return parts.join(".");
  }
}

export { KnowledgeDocument, EmbeddedChunk, Citation };
