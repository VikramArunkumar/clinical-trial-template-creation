# RAG Knowledge Integration - Quick Start Guide

## 5-Minute Setup

### 1. Add Your First Knowledge Document

```bash
curl -X POST http://localhost:3000/api/rag/add-document \
  -H "Content-Type: application/json" \
  -d '{
    "title": "FDA Guidance for Industry: ICF",
    "content": "The FDA requires informed consent forms to include...",
    "source_type": "regulation",
    "source_name": "FDA",
    "document_type": "consent",
    "tags": ["consent", "ICF", "FDA"]
  }'
```

### 2. Retrieve Knowledge for a Query

```bash
curl -X POST http://localhost:3000/api/rag/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are ICF requirements?",
    "topK": 5
  }'
```

### 3. Evaluate Response Grounding

```bash
curl -X POST http://localhost:3000/api/grounding/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "responseText": "ICFs must include objectives, procedures, risks, and benefits.",
    "citations": [
      {
        "chunk_id": "chunk_123",
        "document_id": "doc_456",
        "source_name": "FDA",
        "source_type": "regulation",
        "title": "FDA Guidance for Industry",
        "relevance_score": 0.95
      }
    ]
  }'
```

**Response:**
```json
{
  "ok": true,
  "evaluation": {
    "confidence_score": 0.92,
    "approved": true,
    "grounding_breakdown": {
      "evidence_based": 0.95,
      "compliance_aligned": 0.88,
      "source_recency": 0.90,
      "source_credibility": 0.98,
      "specificity": 0.85
    }
  }
}
```

---

## Common Tasks

### View All Documents

```bash
curl http://localhost:3000/api/rag/documents
```

### Filter by Source

```bash
curl "http://localhost:3000/api/rag/documents?sourceName=FDA&sourceType=regulation"
```

### Search Documents

```bash
curl "http://localhost:3000/api/rag/search?q=adverse%20events&topK=10"
```

### Get KB Statistics

```bash
curl http://localhost:3000/api/rag/statistics
```

### Get Grounding Statistics

```bash
curl http://localhost:3000/api/grounding/statistics
```

---

## Integration with Draft Generation

### Workflow

1. **User creates draft request**
   ```
   Topic: "Informed Consent Form"
   Guidelines: "FDA, ICH-GCP"
   ```

2. **System retrieves relevant knowledge**
   ```javascript
   const sources = await fetch('/api/rag/retrieve', {
     method: 'POST',
     body: JSON.stringify({
       query: 'FDA ICH informed consent requirements',
       topK: 5
     })
   }).then(r => r.json());
   ```

3. **LLM generates draft with context**
   ```javascript
   const draft = generateDraft(userRequest, sources);
   ```

4. **Validate grounding**
   ```javascript
   const evaluation = await fetch('/api/grounding/evaluate', {
     method: 'POST',
     body: JSON.stringify({
       responseText: draft,
       citations: sources
     })
   }).then(r => r.json());
   ```

5. **Route based on approval**
   - ✓ Score >90%: Auto-approve + notify
   - ✗ Score <90%: Get recommendations + retry

---

## Recommended Knowledge Base

### Essential Regulatory Documents

**FDA** (Federal Drug Administration)
- [ ] Guidance for Industry: Informed Consent
- [ ] Common Data Standards
- [ ] Safety Reporting Requirements
- [ ] Protocol Design Guidance

**EMA** (European Medicines Agency)
- [ ] Good Clinical Practice Directive
- [ ] CTIS Guidance
- [ ] GDPR in Clinical Trials
- [ ] Safety Assessment

**ICH** (International Council for Harmonisation)
- [ ] ICH-GCP Guidelines
- [ ] Statistical Principles
- [ ] Common Technical Document
- [ ] E6 Guideline (GCP)

**Organization**
- [ ] Internal SOPs
- [ ] Approved templates
- [ ] Compliance checklists
- [ ] Best practices

---

## Performance Targets

| Component | Target | How to Monitor |
|-----------|--------|---|
| Confidence Score | >90% | `GET /api/grounding/statistics` |
| Approval Rate | >85% | `approval_rate` field |
| Search Speed | <500ms | Measure API response time |
| Retrieval Accuracy | >80% | Review false positives |

---

## Tips for Best Results

### ✓ DO

- Add high-quality, recent source documents
- Use specific search queries
- Include multiple citations (3-5+)
- Tag documents for categorization
- Review and update knowledge regularly
- Track low-confidence evaluations
- Batch evaluate for efficiency

### ✗ DON'T

- Add incomplete or vague documents
- Use single sources for critical decisions
- Ignore low confidence warnings
- Skip manual review of <80% scores
- Over-rely on keyword matching
- Use generic/ambiguous queries

---

## API Cheat Sheet

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rag/add-document` | POST | Add knowledge source |
| `/api/rag/documents` | GET | List all documents |
| `/api/rag/retrieve` | POST | Semantic search |
| `/api/rag/search` | GET | Quick keyword search |
| `/api/rag/statistics` | GET | KB stats |
| `/api/rag/export` | GET | Backup KB |
| `/api/grounding/evaluate` | POST | Check grounding |
| `/api/grounding/report` | POST | Detailed report |
| `/api/grounding/recommendations` | POST | Get improvements |
| `/api/grounding/statistics` | GET | Approval metrics |
| `/api/grounding/batch-evaluate` | POST | Evaluate many |

---

## Example: Complete Workflow

```javascript
// 1. Add FDA ICF guidance
const docResp = await fetch('/api/rag/add-document', {
  method: 'POST',
  body: JSON.stringify({
    title: 'FDA Guidance: Informed Consent Form',
    content: 'FDA requires ICF to include...',
    source_type: 'regulation',
    source_name: 'FDA',
    document_type: 'consent'
  })
});

// 2. Retrieve for a question
const retrieveResp = await fetch('/api/rag/retrieve', {
  method: 'POST',
  body: JSON.stringify({
    query: 'What must be in an ICF?',
    topK: 5
  })
});
const sources = retrieveResp.json().results;

// 3. Generate response using sources
const response = `Based on FDA guidance, the ICF must include:
- Study objectives
- Procedures
- Risks and benefits
- Confidentiality measures`;

// 4. Validate grounding
const evalResp = await fetch('/api/grounding/evaluate', {
  method: 'POST',
  body: JSON.stringify({
    responseText: response,
    citations: sources
  })
});
const eval = evalResp.json().evaluation;

// 5. Check result
if (eval.approved) {
  console.log(`✓ Response approved (${eval.confidence_score})`);
} else {
  console.log('✗ Needs revision:');
  console.log(eval.recommendations);
}
```

---

## Monitoring

### Daily Checks

1. **KB Health**
   ```bash
   curl http://localhost:3000/api/rag/statistics
   ```
   Look for: Document count, recent updates

2. **Approval Metrics**
   ```bash
   curl http://localhost:3000/api/grounding/statistics
   ```
   Look for: Approval rate >85%, avg confidence >89%

3. **Common Issues**
   ```bash
   curl http://localhost:3000/api/grounding/statistics
   ```
   Check: `improvement_focus` - top areas to address

### Weekly Tasks

- [ ] Export and backup KB and evaluations
- [ ] Review any <70% confidence evaluations
- [ ] Add new regulatory updates
- [ ] Update outdated documents
- [ ] Generate compliance report

---

## Troubleshooting

**Q: Evaluations returning low confidence**
A: Add more high-quality sources, ensure citations are specific and relevant

**Q: Search results not relevant**
A: Add more documents on topic, use more specific search terms

**Q: Performance slow**
A: Reduce document count, batch evaluate instead of single, optimize queries

**Q: Approval rate dropping**
A: Review improvement_focus, update compliance rules, add missing sources

---

**Ready to get started? Start with Step 1 above!**
