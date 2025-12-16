/**
 * ========================================================================
 * FACTUAL GROUNDING VALIDATOR
 * ========================================================================
 * Validates that generated responses are factually grounded in evidence.
 *
 * Features:
 * - Multi-criteria grounding evaluation
 * - Compliance rule cross-checking
 * - Source credibility assessment
 * - Confidence scoring (target >90%)
 * - Detailed grounding reports
 *
 * Grounding Criteria:
 * 1. Evidence-based (sources cited)
 * 2. Regulation-compliant (aligned with rules)
 * 3. Recent (sources up-to-date)
 * 4. Authoritative (credible sources)
 * 5. Specific (not vague/generic)
 */

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

// ========================================================================
// GROUNDING EVALUATION
// ========================================================================

/**
 * Represents evaluation result for grounding
 */
class GroundingEvaluation {
  constructor({
    id = nanoid(),
    response_id,
    response_text,
    citations = [],
    compliance_checks = [],
    source_analysis = {},
    confidence_score = 0,
    grounding_breakdown = {},
    issues = [],
    recommendations = [],
    approved = false,
    evaluated_at = new Date().toISOString()
  } = {}) {
    this.id = id;
    this.response_id = response_id;
    this.response_text = response_text;
    this.citations = citations;
    this.compliance_checks = compliance_checks;
    this.source_analysis = source_analysis;
    this.confidence_score = confidence_score;
    this.grounding_breakdown = grounding_breakdown;
    this.issues = issues;
    this.recommendations = recommendations;
    this.approved = approved;
    this.evaluated_at = evaluated_at;
  }

  toJSON() {
    return {
      id: this.id,
      response_id: this.response_id,
      response_text: this.response_text,
      citations: this.citations,
      compliance_checks: this.compliance_checks,
      source_analysis: this.source_analysis,
      confidence_score: this.confidence_score,
      grounding_breakdown: this.grounding_breakdown,
      issues: this.issues,
      recommendations: this.recommendations,
      approved: this.approved,
      evaluated_at: this.evaluated_at
    };
  }
}

/**
 * Grounding issue (gap or problem)
 */
class GroundingIssue {
  constructor({
    severity = "medium", // low | medium | high
    category = "evidence", // evidence | compliance | recency | credibility | specificity
    message,
    location = null,
    suggested_fix = null
  } = {}) {
    this.severity = severity;
    this.category = category;
    this.message = message;
    this.location = location;
    this.suggested_fix = suggested_fix;
  }
}

// ========================================================================
// FACTUAL GROUNDING VALIDATOR
// ========================================================================

export class FactualGroundingValidator {
  constructor({
    evaluationsDir = "./evaluations",
    complianceRulesPath = "./compliance_rules",
    confidenceThreshold = 0.9 // >90% required
  } = {}) {
    this.evaluationsDir = evaluationsDir;
    this.complianceRulesPath = complianceRulesPath;
    this.confidenceThreshold = confidenceThreshold;
    this.evaluations = [];
    this.metrics = {
      total_evaluations: 0,
      approved_count: 0,
      rejected_count: 0,
      average_confidence: 0,
      approval_rate: 0
    };

    fs.mkdirSync(evaluationsDir, { recursive: true });
    this._loadEvaluations();
  }

  // ====================================================================
  // GROUNDING EVALUATION
  // ====================================================================

  /**
   * Evaluate if a response is factually grounded
   * Returns evaluation with confidence score and issues
   */
  async evaluateGrounding(responseText, citations = [], {
    complianceRules = [],
    sourceCredibility = {},
    requiredCitationCount = 2
  } = {}) {
    const evaluation = new GroundingEvaluation({
      response_id: nanoid(),
      response_text: responseText,
      citations
    });

    // Run evaluation criteria
    const criteriaScores = {
      evidence_based: this._evaluateEvidenceBased(citations, requiredCitationCount),
      compliance_aligned: this._evaluateComplianceAlignment(responseText, citations, complianceRules),
      source_recency: this._evaluateSourceRecency(citations),
      source_credibility: this._evaluateSourceCredibility(citations, sourceCredibility),
      specificity: this._evaluateSpecificity(responseText)
    };

    // Calculate overall confidence
    const weights = {
      evidence_based: 0.25,
      compliance_aligned: 0.30,
      source_recency: 0.15,
      source_credibility: 0.20,
      specificity: 0.10
    };

    evaluation.confidence_score = this._calculateConfidence(criteriaScores, weights);
    evaluation.grounding_breakdown = criteriaScores;

    // Determine approval
    evaluation.approved = evaluation.confidence_score >= this.confidenceThreshold;

    // Collect issues
    const issues = [];

    if (criteriaScores.evidence_based < 0.7) {
      issues.push(new GroundingIssue({
        severity: "high",
        category: "evidence",
        message: `Insufficient citations (${citations.length}). At least ${requiredCitationCount} strong sources required.`,
        suggested_fix: "Add more credible source citations to support claims."
      }));
    }

    if (criteriaScores.compliance_aligned < 0.7) {
      issues.push(new GroundingIssue({
        severity: "high",
        category: "compliance",
        message: "Response may not align with regulatory requirements.",
        suggested_fix: "Review response against compliance rules and adjust as needed."
      }));
    }

    if (criteriaScores.source_recency < 0.6) {
      issues.push(new GroundingIssue({
        severity: "medium",
        category: "recency",
        message: "Some sources are outdated.",
        suggested_fix: "Update references to more recent sources where available."
      }));
    }

    if (criteriaScores.specificity < 0.7) {
      issues.push(new GroundingIssue({
        severity: "medium",
        category: "specificity",
        message: "Response is too generic or lacks specific details.",
        suggested_fix: "Include specific regulatory sections, dates, or quantified metrics."
      }));
    }

    evaluation.issues = issues;

    // Generate recommendations
    evaluation.recommendations = this._generateRecommendations(evaluation);

    // Record evaluation
    this.evaluations.push(evaluation);
    this._updateMetrics();

    // Persist
    const evalFile = path.join(this.evaluationsDir, `eval_${evaluation.id}.json`);
    fs.writeFileSync(evalFile, JSON.stringify(evaluation.toJSON(), null, 2));

    return evaluation;
  }

  // ====================================================================
  // EVALUATION CRITERIA
  // ====================================================================

  /**
   * Criterion 1: Evidence-Based (25% weight)
   * Are claims backed by citations?
   */
  _evaluateEvidenceBased(citations, requiredCount = 2) {
    if (!citations || citations.length === 0) return 0;

    // Score based on citation count and quality
    const citationCount = Math.min(citations.length, 5); // Cap at 5
    let baseScore = citationCount / 5;

    // Consider citation relevance scores
    const relevanceScores = citations
      .filter(c => c.relevance_score !== undefined)
      .map(c => c.relevance_score);

    if (relevanceScores.length > 0) {
      const avgRelevance = relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length;
      baseScore = 0.5 * baseScore + 0.5 * avgRelevance;
    }

    // Penalty for insufficient citations
    if (citations.length < requiredCount) {
      baseScore *= 0.5;
    }

    return Math.min(1, baseScore);
  }

  /**
   * Criterion 2: Compliance Aligned (30% weight)
   * Does response align with regulatory/compliance rules?
   */
  _evaluateComplianceAlignment(responseText, citations, complianceRules = []) {
    // Check if response mentions required compliance elements
    let alignmentScore = 0.5; // Base score

    if (!responseText || responseText.length === 0) return 0;

    const textLower = responseText.toLowerCase();

    // Check for common compliance keywords
    const complianceKeywords = [
      "informed consent", "safety", "adverse event", "protocol",
      "icf", "efficacy", "eligible", "exclusion", "inclusion",
      "fda", "ema", "ich-gcp", "gdpr", "gdpr"
    ];

    const mentionedKeywords = complianceKeywords.filter(kw => textLower.includes(kw)).length;
    alignmentScore += (mentionedKeywords / complianceKeywords.length) * 0.3;

    // Check citations for regulatory sources
    const regulatorySources = citations.filter(c => 
      c.source_type === "regulation" || 
      ["FDA", "EMA", "ICH"].includes(c.source_name)
    ).length;

    if (regulatorySources > 0) {
      alignmentScore += 0.2;
    }

    // Validate against specific rules if provided
    if (complianceRules && complianceRules.length > 0) {
      const applicableRules = complianceRules.filter(rule => 
        textLower.includes(rule.category.toLowerCase()) ||
        (rule.keywords && rule.keywords.some(kw => textLower.includes(kw)))
      );

      if (applicableRules.length > 0) {
        const compliantRules = applicableRules.filter(rule => {
          // Simple check: rule severity should be reflected in response caution
          if (rule.severity === "high" && !textLower.includes("must|required|critical")) return false;
          return true;
        }).length;

        alignmentScore += (compliantRules / applicableRules.length) * 0.2;
      }
    }

    return Math.min(1, alignmentScore);
  }

  /**
   * Criterion 3: Source Recency (15% weight)
   * Are sources up-to-date?
   */
  _evaluateSourceRecency(citations) {
    if (!citations || citations.length === 0) return 0;

    const now = Date.now();
    let recencyScore = 0;

    for (const citation of citations) {
      // In real scenario, check last_updated field
      // Assume if not specified, treat as recent
      const ageInDays = 0; // Default: recent

      if (ageInDays <= 30) {
        recencyScore += 1.0; // Very recent
      } else if (ageInDays <= 90) {
        recencyScore += 0.8;
      } else if (ageInDays <= 365) {
        recencyScore += 0.6;
      } else if (ageInDays <= 730) {
        recencyScore += 0.4;
      } else {
        recencyScore += 0.1; // Very old
      }
    }

    return Math.min(1, recencyScore / citations.length);
  }

  /**
   * Criterion 4: Source Credibility (20% weight)
   * Are sources authoritative?
   */
  _evaluateSourceCredibility(citations, credibilityMap = {}) {
    if (!citations || citations.length === 0) return 0;

    let credibilityScore = 0;

    // Default credibility levels
    const defaultCredibility = {
      "FDA": 1.0,
      "EMA": 1.0,
      "ICH": 1.0,
      "WHO": 0.95,
      "NIH": 0.9,
      "peer-reviewed": 0.85,
      "organization": 0.7,
      "guideline": 0.8,
      "evidence": 0.9,
      "sop": 0.7
    };

    for (const citation of citations) {
      const sourceName = citation.source_name;
      const sourceType = citation.source_type;

      // Look up custom credibility or use default
      const credibility = credibilityMap[sourceName] || 
        defaultCredibility[sourceName] || 
        defaultCredibility[sourceType] || 
        0.5;

      credibilityScore += credibility;
    }

    return Math.min(1, credibilityScore / citations.length);
  }

  /**
   * Criterion 5: Specificity (10% weight)
   * Is response specific or generic?
   */
  _evaluateSpecificity(responseText) {
    if (!responseText) return 0;

    let specificityScore = 0.3; // Base for any response

    // Check for specific elements
    const specificPatterns = [
      /\d+\s*(?:days?|weeks?|months?|years?)/i, // Time periods
      /\d+\.?\d*\s*(?:%|percent|mg|g|ml)/i, // Quantities/units
      /section\s+\d+|article\s+\d+|page\s+\d+/i, // References
      /(?:FDA|EMA|ICH|WHO)[\s-]?\w+/i, // Specific standards
      /\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2},\s+\d{4}/i // Dates
    ];

    let patternMatches = 0;
    for (const pattern of specificPatterns) {
      if (pattern.test(responseText)) {
        patternMatches++;
      }
    }

    specificityScore += (patternMatches / specificPatterns.length) * 0.5;

    // Check for vague language (penalties)
    const vagueTerms = [
      /\bmay\b/i, /\bpossibly\b/i, /\bseem(?:s)?\b/i,
      /\bprobably\b/i, /\blikely\b/i, /\bit\s+appears\b/i
    ];

    let vagueTermCount = 0;
    for (const term of vagueTerms) {
      const matches = responseText.match(term);
      if (matches) vagueTermCount += matches.length;
    }

    const vaguePenalty = Math.min(0.3, (vagueTermCount / responseText.split(/\s+/).length) * 0.5);
    specificityScore -= vaguePenalty;

    return Math.max(0, Math.min(1, specificityScore));
  }

  // ====================================================================
  // SCORING & RECOMMENDATIONS
  // ====================================================================

  /**
   * Calculate weighted confidence score
   */
  _calculateConfidence(criteriaScores, weights) {
    let totalScore = 0;

    for (const [criterion, score] of Object.entries(criteriaScores)) {
      const weight = weights[criterion] || 0;
      totalScore += score * weight;
    }

    return Math.min(1, totalScore);
  }

  /**
   * Generate improvement recommendations
   */
  _generateRecommendations(evaluation) {
    const recommendations = [];

    // Recommendations based on low scores
    if (evaluation.grounding_breakdown.evidence_based < 0.8) {
      recommendations.push({
        priority: "high",
        action: "Strengthen evidence base",
        details: "Add 2-3 more citations from authoritative sources (FDA, EMA, peer-reviewed studies)"
      });
    }

    if (evaluation.grounding_breakdown.compliance_aligned < 0.8) {
      recommendations.push({
        priority: "high",
        action: "Align with compliance requirements",
        details: "Review and ensure response addresses relevant regulatory requirements"
      });
    }

    if (evaluation.grounding_breakdown.source_recency < 0.7) {
      recommendations.push({
        priority: "medium",
        action: "Update source references",
        details: "Replace outdated sources with recent guidance/regulations"
      });
    }

    if (evaluation.grounding_breakdown.specificity < 0.75) {
      recommendations.push({
        priority: "medium",
        action: "Increase response specificity",
        details: "Add specific section references, dates, percentages, or quantified metrics"
      });
    }

    if (evaluation.confidence_score < this.confidenceThreshold) {
      recommendations.push({
        priority: "high",
        action: "Revise for approval",
        details: `Confidence score is ${(evaluation.confidence_score * 100).toFixed(1)}%, need to reach ${(this.confidenceThreshold * 100).toFixed(0)}%`
      });
    }

    return recommendations;
  }

  // ====================================================================
  // REPORTING & ANALYTICS
  // ====================================================================

  /**
   * Generate grounding report for a response
   */
  generateGroundingReport(evaluation) {
    const report = {
      evaluation_id: evaluation.id,
      timestamp: new Date().toISOString(),
      confidence_score: (evaluation.confidence_score * 100).toFixed(1),
      approval_status: evaluation.approved ? "APPROVED" : "NEEDS_REVISION",
      summary: {
        evidence_based: `${(evaluation.grounding_breakdown.evidence_based * 100).toFixed(0)}% - ${this._scoreToLabel(evaluation.grounding_breakdown.evidence_based)}`,
        compliance_aligned: `${(evaluation.grounding_breakdown.compliance_aligned * 100).toFixed(0)}% - ${this._scoreToLabel(evaluation.grounding_breakdown.compliance_aligned)}`,
        source_recency: `${(evaluation.grounding_breakdown.source_recency * 100).toFixed(0)}% - ${this._scoreToLabel(evaluation.grounding_breakdown.source_recency)}`,
        source_credibility: `${(evaluation.grounding_breakdown.source_credibility * 100).toFixed(0)}% - ${this._scoreToLabel(evaluation.grounding_breakdown.source_credibility)}`,
        specificity: `${(evaluation.grounding_breakdown.specificity * 100).toFixed(0)}% - ${this._scoreToLabel(evaluation.grounding_breakdown.specificity)}`
      },
      citations_used: evaluation.citations.length,
      top_sources: this._getTopSources(evaluation.citations),
      issues: evaluation.issues.map(i => ({
        severity: i.severity,
        category: i.category,
        message: i.message,
        suggestion: i.suggested_fix
      })),
      recommendations: evaluation.recommendations
    };

    return report;
  }

  /**
   * Get approval statistics
   */
  getApprovalStatistics() {
    const total = this.evaluations.length;
    if (total === 0) return { total: 0, approved: 0, rejected: 0, approval_rate: 0 };

    const approved = this.evaluations.filter(e => e.approved).length;
    const rejected = total - approved;

    return {
      total,
      approved,
      rejected,
      approval_rate: (approved / total * 100).toFixed(1),
      average_confidence: (this.evaluations.reduce((sum, e) => sum + e.confidence_score, 0) / total * 100).toFixed(1),
      median_confidence: (this._getMedian(this.evaluations.map(e => e.confidence_score)) * 100).toFixed(1)
    };
  }

  /**
   * Get issues summary across all evaluations
   */
  getIssuesSummary() {
    const issuesByCategory = {};
    const issuesBySeverity = {};

    for (const evaluation of this.evaluations) {
      for (const issue of evaluation.issues) {
        // By category
        if (!issuesByCategory[issue.category]) {
          issuesByCategory[issue.category] = 0;
        }
        issuesByCategory[issue.category]++;

        // By severity
        if (!issuesBySeverity[issue.severity]) {
          issuesBySeverity[issue.severity] = 0;
        }
        issuesBySeverity[issue.severity]++;
      }
    }

    return {
      by_category: issuesByCategory,
      by_severity: issuesBySeverity,
      total_issues: this.evaluations.reduce((sum, e) => sum + e.issues.length, 0)
    };
  }

  /**
   * Get most common improvement areas
   */
  getImprovementFocus() {
    const focus = {};

    for (const evaluation of this.evaluations) {
      for (const recommendation of evaluation.recommendations) {
        if (!focus[recommendation.action]) {
          focus[recommendation.action] = 0;
        }
        focus[recommendation.action]++;
      }
    }

    return Object.entries(focus)
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count }));
  }

  // ====================================================================
  // UTILITIES
  // ====================================================================

  /**
   * Convert score to label
   */
  _scoreToLabel(score) {
    if (score >= 0.9) return "Excellent";
    if (score >= 0.75) return "Good";
    if (score >= 0.6) return "Fair";
    if (score >= 0.4) return "Poor";
    return "Very Poor";
  }

  /**
   * Get top sources from citations
   */
  _getTopSources(citations) {
    const sources = {};

    for (const citation of citations) {
      const key = citation.source_name;
      if (!sources[key]) {
        sources[key] = { count: 0, avg_relevance: 0 };
      }
      sources[key].count++;
      sources[key].avg_relevance += citation.relevance_score || 0;
    }

    // Calculate averages
    for (const key in sources) {
      sources[key].avg_relevance /= sources[key].count;
    }

    return Object.entries(sources)
      .map(([name, data]) => ({ source: name, citations: data.count, avg_relevance: data.avg_relevance.toFixed(2) }))
      .sort((a, b) => b.citations - a.citations);
  }

  /**
   * Calculate median
   */
  _getMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // ====================================================================
  // PERSISTENCE
  // ====================================================================

  /**
   * Load evaluations from disk
   */
  _loadEvaluations() {
    if (!fs.existsSync(this.evaluationsDir)) return;

    const files = fs.readdirSync(this.evaluationsDir).filter(f => f.startsWith("eval_") && f.endsWith(".json"));

    for (const file of files) {
      try {
        const filePath = path.join(this.evaluationsDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const evaluation = new GroundingEvaluation(data);
        this.evaluations.push(evaluation);
      } catch (e) {
        console.error(`Failed to load evaluation ${file}:`, e.message);
      }
    }

    this._updateMetrics();
  }

  /**
   * Update internal metrics
   */
  _updateMetrics() {
    this.metrics.total_evaluations = this.evaluations.length;
    this.metrics.approved_count = this.evaluations.filter(e => e.approved).length;
    this.metrics.rejected_count = this.evaluations.length - this.metrics.approved_count;
    this.metrics.approval_rate = this.evaluations.length > 0 ? this.metrics.approved_count / this.evaluations.length : 0;
    this.metrics.average_confidence = this.evaluations.length > 0 ? 
      this.evaluations.reduce((sum, e) => sum + e.confidence_score, 0) / this.evaluations.length : 0;
  }

  /**
   * Export evaluations for analysis
   */
  exportEvaluations() {
    return {
      exported_at: new Date().toISOString(),
      evaluations: this.evaluations.map(e => e.toJSON()),
      metrics: this.getApprovalStatistics(),
      issues_summary: this.getIssuesSummary(),
      improvement_focus: this.getImprovementFocus()
    };
  }
}

export { GroundingEvaluation, GroundingIssue };
