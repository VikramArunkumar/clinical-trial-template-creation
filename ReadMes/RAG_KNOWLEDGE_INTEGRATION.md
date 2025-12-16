# RAG-Based Knowledge Integration System

## Overview

The RAG (Retrieval-Augmented Generation) system provides **factually grounded responses** to clinical trial template questions by:

1. **Retrieving** relevant knowledge from a multi-source knowledge base
2. **Augmenting** LLM prompts with authoritative context
3. **Generating** responses backed by evidence and citations
4. **Validating** factual accuracy against compliance rules

**Target Accuracy:** >90% factual grounding score

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│         Clinical Trial Template Generation          │
│  (Draft → Validate → Approve Workflow)              │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
    ┌────────────────────────────────┐
    │  RAG Knowledge Base            │
    │  ├─ FDA Regulations            │
    │  ├─ EMA Guidelines             │
    │  ├─ ICH-GCP Standards          │
    │  ├─ Organization SOPs          │
    │  └─ Approved Templates         │
    └────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌──────────┐
    │Retrieve │ │  Rank   │ │ Generate │
    │Relevant │ │Relevance│ │ Grounded │
    │Knowledge│ │ Score   │ │Response  │
    └─────────┘ └─────────┘ └──────────┘
         │           │           │
         └───────────┼───────────┘
                     ▼
        ┌────────────────────────────┐
        │ Grounding Validator        │
        │ ├─ Evidence Coverage       │
        │ ├─ Compliance Alignment    │
        │ ├─ Source Recency          │
        │ ├─ Source Credibility      │
        │ └─ Specificity             │
        └────────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
        ✓ Approved        ✗ Needs Revision
       (>90%)            (<90%)
```

---

## Knowledge Base Management

### Knowledge Document Types

```javascript
// Add regulatory documentation
POST /api/rag/add-document
{
  "title": "FDA Guidance for Industry: Clinical Trial Endpoints",
  "content": "<full document content>",
  "source_type": "regulation",      // "regulation" | "guideline" | "sop" | "template" | "evidence"
  "source_name": "FDA",             // "FDA" | "EMA" | "ICH" | "WHO" | "organization"
  "document_type": "protocol",      // "protocol" | "consent" | "safety" | "analysis"
  "version": "1.0",
  "tags": ["endpoints", "primary", "secondary"],
  "metadata": { "effective_date": "2024-01-01" }
}

Response:
{
  "ok": true,
  "document": {
    "id": "doc_abc123xyz",
    "title": "FDA Guidance...",
    "source_type": "regulation",
    "source_name": "FDA",
    "version": "1.0",
    "last_updated": "2024-01-15T10:30:00Z"
  }
}
```

### Update Documents

```javascript
// Update document with new version
PUT /api/rag/update-document/:docId
{
  "content": "<new document content>",
  "version": "1.1"  // Optional, auto-increments if omitted
}
```

### List Documents

```javascript
// Get all documents
GET /api/rag/documents

// Filter by source
GET /api/rag/documents?sourceType=regulation&sourceName=FDA

Response:
{
  "ok": true,
  "count": 42,
  "documents": [
    {
      "id": "doc_xyz789",
      "title": "FDA Guidance...",
      "source_type": "regulation",
      "source_name": "FDA",
      "document_type": "protocol",
      "version": "1.0",
      "last_updated": "2024-01-15T10:30:00Z",
      "tags": ["endpoints", "primary"]
    },
    // ... more documents
  ]
}
```

---

## Retrieval-Augmented Generation (RAG)

### Retrieve Relevant Knowledge

```javascript
// Semantic + keyword search for query
POST /api/rag/retrieve
{
  "query": "What are the requirements for informed consent in clinical trials?",
  "topK": 5,           // Number of results (default: 5)
  "sourceType": null,  // Optional filter
  "sourceName": "FDA", // Optional filter
  "documentType": null // Optional filter
}

Response:
{
  "ok": true,
  "query": "What are the requirements for informed consent...",
  "results_count": 5,
  "results": [
    {
      "id": "chunk_123abc",
      "text": "The informed consent form must contain...",
      "document_id": "doc_xyz789",
      "title": "FDA Guidance for Industry...",
      "source_type": "regulation",
      "source_name": "FDA",
      "relevance_score": 0.94,
      "semantic_score": 0.92,
      "keyword_score": 0.89
    },
    // ... more results ranked by relevance
  ]
}
```

### Search Knowledge Base

```javascript
// Quick keyword/semantic search
GET /api/rag/search?q=adverse%20events&topK=10&threshold=0.3

Response:
{
  "ok": true,
  "query": "adverse events",
  "results_count": 8,
  "results": [
    {
      "id": "chunk_456def",
      "text": "All adverse events must be reported within...",
      "relevance_score": 0.87,
      // ... other fields
    }
  ]
}
```

---

## Factual Grounding Validation

### Evaluation Criteria (Weighted)

```
Evidence-Based      (25%)  ← Are claims backed by citations?
Compliance-Aligned  (30%)  ← Does response match regulatory rules?
Source Recency      (15%)  ← Are sources up-to-date?
Source Credibility  (20%)  ← Are sources authoritative?
Specificity         (10%)  ← Are details specific or generic?
```

### Evaluate Response Grounding

```javascript
// Check if response is factually grounded
POST /api/grounding/evaluate
{
  "responseText": "Informed consent must include explanation of study objectives, procedures, risks, and benefits. See FDA ICF guidance.",
  "citations": [
    {
      "chunk_id": "chunk_123abc",
      "document_id": "doc_xyz789",
      "source_name": "FDA",
      "source_type": "regulation",
      "title": "FDA Guidance for Industry: Informed Consent",
      "relevance_score": 0.94,
      "quote": "The informed consent form must contain..."
    }
  ],
  "complianceRules": [],
  "sourceCredibility": {}
}

Response:
{
  "ok": true,
  "evaluation": {
    "id": "eval_789xyz",
    "response_id": "resp_123",
    "confidence_score": 0.92,           // >90% = APPROVED
    "approved": true,
    "grounding_breakdown": {
      "evidence_based": 0.95,
      "compliance_aligned": 0.88,
      "source_recency": 0.90,
      "source_credibility": 0.98,
      "specificity": 0.85
    },
    "issues": [],                       // Empty = No problems
    "recommendations": [],              // Empty = No improvements needed
    "evaluated_at": "2024-01-15T10:45:00Z"
  }
}
```

### Generate Grounding Report

```javascript
// Detailed human-readable report
POST /api/grounding/report
{
  "responseText": "...",
  "citations": [...],
  "complianceRules": [...]
}

Response:
{
  "ok": true,
  "report": {
    "evaluation_id": "eval_789xyz",
    "timestamp": "2024-01-15T10:45:00Z",
    "confidence_score": "92.1",
    "approval_status": "APPROVED",
    "summary": {
      "evidence_based": "95% - Excellent",
      "compliance_aligned": "88% - Good",
      "source_recency": "90% - Excellent",
      "source_credibility": "98% - Excellent",
      "specificity": "85% - Good"
    },
    "citations_used": 1,
    "top_sources": [
      {
        "source": "FDA",
        "citations": 1,
        "avg_relevance": "0.94"
      }
    ],
    "issues": [],
    "recommendations": []
  }
}
```

### Batch Evaluation

```javascript
// Evaluate multiple responses at once
POST /api/grounding/batch-evaluate
{
  "responses": [
    {
      "text": "Response 1 text...",
      "citations": [...],
      "complianceRules": [...]
    },
    {
      "text": "Response 2 text...",
      "citations": [...],
      "complianceRules": [...]
    },
    // ... more responses
  ]
}

Response:
{
  "ok": true,
  "evaluated_count": 3,
  "approved_count": 2,
  "evaluations": [
    { "id": "eval_1", "confidence_score": 0.92, "approved": true },
    { "id": "eval_2", "confidence_score": 0.88, "approved": true },
    { "id": "eval_3", "confidence_score": 0.72, "approved": false }
  ],
  "batch_statistics": {
    "total": 3,
    "approved": 2,
    "rejected": 1,
    "approval_rate": "66.7",
    "average_confidence": "84.1",
    "median_confidence": "88.0"
  }
}
```

### Get Recommendations

```javascript
// Get specific improvement recommendations
POST /api/grounding/recommendations
{
  "responseText": "Clinical trials must be conducted...",
  "citations": [...],
  "complianceRules": [...]
}

Response:
{
  "ok": true,
  "confidence_score": 0.82,
  "approved": false,
  "recommendations": [
    {
      "priority": "high",
      "action": "Strengthen evidence base",
      "details": "Add 2-3 more citations from authoritative sources (FDA, EMA, peer-reviewed studies)"
    },
    {
      "priority": "medium",
      "action": "Increase response specificity",
      "details": "Add specific section references, dates, or quantified metrics"
    }
  ],
  "issues": [
    {
      "severity": "medium",
      "category": "specificity",
      "message": "Response is too generic or lacks specific details.",
      "suggestion": "Include specific regulatory sections, dates, or quantified metrics."
    }
  ]
}
```

---

## Statistics & Analytics

### Knowledge Base Statistics

```javascript
GET /api/rag/statistics

Response:
{
  "ok": true,
  "statistics": {
    "total_documents": 42,
    "total_chunks": 1250,
    "total_citations": 450,
    "sources": {
      "FDA": 18,
      "EMA": 12,
      "ICH": 8,
      "organization": 4
    },
    "document_types": {
      "protocol": 15,
      "consent": 12,
      "safety": 10,
      "analysis": 5
    },
    "average_chunk_citations": 0.36,
    "last_updated": "2024-01-15T10:30:00Z"
  },
  "source_analysis": [
    {
      "source_name": "FDA",
      "source_type": "regulation",
      "count": 18,
      "citations_used": 85,
      "average_recency": 45
    },
    // ... more sources
  ]
}
```

### Grounding Approval Statistics

```javascript
GET /api/grounding/statistics

Response:
{
  "ok": true,
  "approval_statistics": {
    "total": 250,
    "approved": 220,
    "rejected": 30,
    "approval_rate": "88.0",
    "average_confidence": "89.2",
    "median_confidence": "91.5"
  },
  "issues_summary": {
    "by_category": {
      "evidence": 25,
      "compliance": 18,
      "recency": 12,
      "credibility": 8,
      "specificity": 35
    },
    "by_severity": {
      "high": 30,
      "medium": 45,
      "low": 23
    },
    "total_issues": 98
  },
  "improvement_focus": [
    {
      "action": "Increase response specificity",
      "count": 35
    },
    {
      "action": "Strengthen evidence base",
      "count": 25
    }
  ]
}
```

---

## Integration with Draft Generation

### Complete Workflow

```javascript
// 1. User submits draft request
POST /api/draft/create
{
  "topic": "Informed Consent Form",
  "requirements": "FDA guidelines, ICH-GCP compliant"
}

// 2. System retrieves relevant knowledge
POST /api/rag/retrieve
{
  "query": "informed consent requirements FDA ICH"
}
// Returns: [source1, source2, source3, ...]

// 3. LLM generates draft using retrieved context
// (Draft generation uses retrieved knowledge as context)

// 4. System validates grounding
POST /api/grounding/evaluate
{
  "responseText": "<generated draft>",
  "citations": "<sources used>"
}

// 5. Results
// - If confidence >= 90%: Auto-approve or route to reviewer
// - If confidence < 90%: Return recommendations and retry
```

---

## Implementation Examples

### Python Client

```python
import requests

BASE_URL = "http://localhost:3000"

# Add FDA guideline
response = requests.post(
    f"{BASE_URL}/api/rag/add-document",
    json={
        "title": "FDA Guidance: Clinical Trial Design",
        "content": "FDA requires...",
        "source_type": "regulation",
        "source_name": "FDA",
        "document_type": "protocol"
    }
)
print(response.json())

# Retrieve relevant knowledge
response = requests.post(
    f"{BASE_URL}/api/rag/retrieve",
    json={
        "query": "What are primary efficacy endpoints?",
        "topK": 5
    }
)
sources = response.json()["results"]

# Evaluate grounding
response = requests.post(
    f"{BASE_URL}/api/grounding/evaluate",
    json={
        "responseText": "Primary endpoints should be...",
        "citations": sources
    }
)
evaluation = response.json()["evaluation"]
print(f"Confidence: {evaluation['confidence_score']:.1%}")
print(f"Approved: {evaluation['approved']}")
```

### JavaScript Client

```javascript
const BASE_URL = "http://localhost:3000";

// Search knowledge base
const searchResults = await fetch(`${BASE_URL}/api/rag/search?q=adverse%20events`).then(r => r.json());
console.log(`Found ${searchResults.results_count} relevant documents`);

// Evaluate response
const evaluation = await fetch(`${BASE_URL}/api/grounding/evaluate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    responseText: "Safety monitoring must include...",
    citations: searchResults.results
  })
}).then(r => r.json());

if (evaluation.evaluation.approved) {
  console.log("✓ Response is factually grounded");
} else {
  console.log("✗ Needs revision:");
  console.log(evaluation.evaluation.recommendations);
}
```

---

## Performance Targets

### Accuracy Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Confidence Score | >90% | ↑ Tracking |
| Approval Rate | >85% | ↑ Tracking |
| Average Evidence Score | >85% | ↑ Tracking |
| False Positive Rate | <5% | ↑ Tracking |
| False Negative Rate | <10% | ↑ Tracking |

### System Performance

| Component | Metric | Target |
|-----------|--------|--------|
| Knowledge Retrieval | Latency | <500ms |
| Embedding Generation | Latency | <1s |
| Grounding Validation | Latency | <300ms |
| Batch Evaluation | Throughput | 100+ docs/min |

---

## Best Practices

### Knowledge Base Management

✓ **DO:**
- Add versions to documents (v1.0, v1.1, v2.0)
- Tag documents for easy categorization
- Include metadata (effective dates, update frequency)
- Maintain source diversity (FDA, EMA, ICH, org practices)
- Regularly audit document recency

✗ **DON'T:**
- Add incomplete or partial documents
- Mix multiple topics in one document
- Update without version tracking
- Keep outdated sources active

### Citation Best Practices

✓ **DO:**
- Include specific quotes from sources
- Cite credible sources (FDA, EMA, WHO)
- Use multiple sources (3-5 minimum)
- Verify relevance scores (>0.70)
- Track citation usage

✗ **DON'T:**
- Cite without relevance score
- Over-rely on single source
- Use generic/vague citations
- Mix credibility levels without disclosure

### Grounding Evaluation

✓ **DO:**
- Set confidence threshold based on risk level
- Review low-confidence responses manually
- Track improvement metrics over time
- Iterate on feedback
- Maintain audit trail

✗ **DON'T:**
- Ignore low-confidence warnings
- Approve without reviewing issues
- Change thresholds without justification
- Skip batch evaluation for compliance

---

## Troubleshooting

### Low Confidence Scores

**Problem:** Evaluations returning <85% confidence

**Solutions:**
1. Add more authoritative sources (FDA, EMA)
2. Increase chunk overlap in document splitting
3. Add more specific citations
4. Review generated response for vague language
5. Check compliance rule alignment

### Poor Retrieval Results

**Problem:** Query returns irrelevant documents

**Solutions:**
1. Add more documents on topic
2. Use more specific search terms
3. Lower relevance threshold
4. Increase topK results
5. Add keywords/tags to documents

### Slow Performance

**Problem:** Retrieval/evaluation taking >2 seconds

**Solutions:**
1. Reduce number of documents
2. Limit topK in queries
3. Cache frequent queries
4. Batch evaluate instead of single
5. Optimize embedding model

---

## Data Backup & Export

### Export All Data

```javascript
// Export knowledge base
GET /api/rag/export

// Export all evaluations
GET /api/grounding/export
```

### Restore from Backup

Knowledge base and evaluations are automatically persisted to disk:
- `knowledge_base/documents/` - Document storage
- `knowledge_base/chunks/` - Chunk storage
- `evaluations/` - Evaluation records

---

## Future Enhancements

- [ ] Fine-tuned embedding models for biomedical text
- [ ] Multi-language support (EU languages)
- [ ] Real-time document updates from regulatory feeds
- [ ] Interactive citation editing UI
- [ ] Advanced analytics dashboard
- [ ] A/B testing framework
- [ ] Feedback loop for continuous improvement
- [ ] Integration with compliance rule engine

---

**For questions or issues, contact the development team.**
