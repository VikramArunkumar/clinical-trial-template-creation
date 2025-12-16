/**
 * ========================================================================
 * ADAPTIVE TEMPLATE STANDARDIZATION MODULE
 * ========================================================================
 * Non-parametric continual learning layer that adapts compliance templates
 * to evolving guidelines without retraining core models.
 *
 * Features:
 * - Incremental rule updates (FDA/EMA guideline changes)
 * - Adaptive retrieval with dynamic rule weighting
 * - Zero-downtime template updates
 * - Compliance with regulatory evolving standards
 *
 * Usage:
 *   import { AdaptiveTemplateEngine } from './adaptiveTemplates.js';
 *   const engine = new AdaptiveTemplateEngine({ rulesDir: './compliance_rules' });
 */

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

// ========================================================================
// COMPLIANCE RULE ENGINE
// ========================================================================

/**
 * Represents a single compliance rule that can be updated incrementally
 */
class ComplianceRule {
  constructor({
    id = nanoid(),
    category,
    rule,
    guidance,
    severity = "medium",
    source = "user",
    addedAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    active = true,
    weight = 1.0
  }) {
    this.id = id;
    this.category = category; // e.g., "informed_consent", "safety_reporting", "data_protection"
    this.rule = rule; // e.g., "Must mention withdrawal rights"
    this.guidance = guidance; // Detailed guidance text
    this.severity = severity; // low | medium | high | critical
    this.source = source; // "FDA", "EMA", "ICH", "user"
    this.addedAt = addedAt;
    this.updatedAt = updatedAt;
    this.active = active;
    this.weight = weight; // For scoring/prioritization
  }

  toJSON() {
    return {
      id: this.id,
      category: this.category,
      rule: this.rule,
      guidance: this.guidance,
      severity: this.severity,
      source: this.source,
      addedAt: this.addedAt,
      updatedAt: this.updatedAt,
      active: this.active,
      weight: this.weight
    };
  }
}

/**
 * Rule versioning for audit trail
 */
class RuleVersion {
  constructor(rule, action = "created", actor = "system", reason = "") {
    this.id = nanoid();
    this.rule = rule;
    this.timestamp = new Date().toISOString();
    this.action = action; // created | updated | deactivated | reactivated
    this.actor = actor;
    this.reason = reason;
  }
}

// ========================================================================
// ADAPTIVE TEMPLATE ENGINE
// ========================================================================

export class AdaptiveTemplateEngine {
  constructor({ rulesDir = "./compliance_rules", retrievalMaxk = 5 } = {}) {
    this.rulesDir = rulesDir;
    this.retrievalMaxk = retrievalMaxk;
    this.rules = new Map(); // id -> ComplianceRule
    this.categories = new Map(); // category -> [rules]
    this.history = []; // Audit trail of rule changes
    this.ruleVersions = new Map(); // id -> [RuleVersion]

    fs.mkdirSync(rulesDir, { recursive: true });
    this._loadRulesFromDisk();
  }

  // ====================================================================
  // RULE MANAGEMENT
  // ====================================================================

  /**
   * Add a new compliance rule (incremental learning)
   */
  addRule(category, rule, guidance, { severity = "medium", source = "user", actor = "system" } = {}) {
    const newRule = new ComplianceRule({
      category,
      rule,
      guidance,
      severity,
      source,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true,
      weight: this._calculateWeight(severity)
    });

    this.rules.set(newRule.id, newRule);

    // Update category index
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category).push(newRule.id);

    // Record version
    const version = new RuleVersion(newRule, "created", actor, "New rule added");
    if (!this.ruleVersions.has(newRule.id)) {
      this.ruleVersions.set(newRule.id, []);
    }
    this.ruleVersions.get(newRule.id).push(version);

    // Persist to disk
    this._persistRule(newRule);
    this._appendHistory("add_rule", { ruleId: newRule.id, category, severity, source }, actor);

    return newRule;
  }

  /**
   * Update an existing rule
   */
  updateRule(ruleId, updates = {}, { actor = "system", reason = "Rule update" } = {}) {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Rule not found: ${ruleId}`);

    const oldRule = JSON.parse(JSON.stringify(rule));
    const now = new Date().toISOString();

    // Apply updates
    Object.assign(rule, updates);
    rule.updatedAt = now;

    // Recalculate weight if severity changed
    if (updates.severity) {
      rule.weight = this._calculateWeight(updates.severity);
    }

    // Record version
    const version = new RuleVersion(rule, "updated", actor, reason);
    this.ruleVersions.get(ruleId).push(version);

    // Persist
    this._persistRule(rule);
    this._appendHistory("update_rule", { ruleId, oldRule, updates }, actor);

    return rule;
  }

  /**
   * Deactivate a rule (soft delete for audit trail)
   */
  deactivateRule(ruleId, { actor = "system", reason = "Rule deactivated" } = {}) {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Rule not found: ${ruleId}`);

    rule.active = false;
    rule.updatedAt = new Date().toISOString();

    const version = new RuleVersion(rule, "deactivated", actor, reason);
    this.ruleVersions.get(ruleId).push(version);

    this._persistRule(rule);
    this._appendHistory("deactivate_rule", { ruleId, reason }, actor);

    return rule;
  }

  /**
   * Reactivate a deactivated rule
   */
  reactivateRule(ruleId, { actor = "system", reason = "Rule reactivated" } = {}) {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Rule not found: ${ruleId}`);

    rule.active = true;
    rule.updatedAt = new Date().toISOString();

    const version = new RuleVersion(rule, "reactivated", actor, reason);
    this.ruleVersions.get(ruleId).push(version);

    this._persistRule(rule);
    this._appendHistory("reactivate_rule", { ruleId }, actor);

    return rule;
  }

  // ====================================================================
  // ADAPTIVE RETRIEVAL
  // ====================================================================

  /**
   * Adaptively retrieve relevant compliance rules based on context
   * Uses non-parametric retrieval with dynamic weighting
   */
  retrieveAdaptiveRules(query, { category = null, k = this.retrievalMaxk } = {}) {
    const candidates = [];

    // Gather candidates: filter by category if specified, filter active rules
    for (const [ruleId, rule] of this.rules.entries()) {
      if (!rule.active) continue;
      if (category && rule.category !== category) continue;
      candidates.push({ rule, relevanceScore: this._computeRelevance(rule, query) });
    }

    // Sort by relevance + weight
    candidates.sort((a, b) => {
      const scoreA = a.relevanceScore * a.rule.weight;
      const scoreB = b.relevanceScore * b.rule.weight;
      return scoreB - scoreA;
    });

    // Return top k
    return candidates.slice(0, k).map(c => c.rule);
  }

  /**
   * Get all rules for a specific category
   */
  getRulesByCategory(category) {
    const ruleIds = this.categories.get(category) || [];
    return ruleIds
      .map(id => this.rules.get(id))
      .filter(rule => rule && rule.active);
  }

  /**
   * Get all active rules
   */
  getAllRules() {
    return Array.from(this.rules.values()).filter(r => r.active);
  }

  /**
   * Get rule version history
   */
  getRuleHistory(ruleId) {
    return this.ruleVersions.get(ruleId) || [];
  }

  // ====================================================================
  // TEMPLATE MATCHING & VALIDATION
  // ====================================================================

  /**
   * Validate document against adaptive rules
   * Returns compliance issues found
   */
  validateDocument(text) {
    const issues = [];

    // Retrieve adaptive rules for the entire document
    const relevantRules = this.retrieveAdaptiveRules(text, { k: 10 });

    for (const rule of relevantRules) {
      // Simple text-based matching (can be enhanced with LLM)
      if (!this._checkRuleCompliance(text, rule)) {
        issues.push({
          ruleId: rule.id,
          rule: rule.rule,
          category: rule.category,
          severity: rule.severity,
          guidance: rule.guidance,
          matchedAt: this._findMatchLocation(text, rule)
        });
      }
    }

    return {
      compliant: issues.length === 0,
      issues,
      complianceScore: Math.max(0, 100 - issues.length * (issues.some(i => i.severity === "critical") ? 20 : 10))
    };
  }

  /**
   * Suggest template improvements based on adaptive rules
   */
  suggestImprovements(text) {
    const suggestions = [];
    const relevantRules = this.retrieveAdaptiveRules(text, { k: 15 });

    for (const rule of relevantRules) {
      if (!this._checkRuleCompliance(text, rule) && rule.severity !== "critical") {
        suggestions.push({
          ruleId: rule.id,
          suggestion: rule.guidance,
          category: rule.category,
          priority: rule.weight
        });
      }
    }

    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);
    return suggestions;
  }

  // ====================================================================
  // INTERNAL HELPERS
  // ====================================================================

  /**
   * Compute relevance score between rule and query using simple TF-IDF style matching
   */
  _computeRelevance(rule, query) {
    const queryWords = query.toLowerCase().split(/\s+/);
    const ruleText = (rule.rule + " " + rule.guidance).toLowerCase();

    let matchCount = 0;
    for (const word of queryWords) {
      if (word.length > 2 && ruleText.includes(word)) matchCount++;
    }

    return Math.min(1.0, matchCount / Math.max(1, queryWords.length));
  }

  /**
   * Check if document complies with a single rule
   */
  _checkRuleCompliance(text, rule) {
    // Extract keywords from rule
    const keywords = this._extractKeywords(rule.rule);
    const textLower = text.toLowerCase();

    // Simple keyword matching (enhance with semantic search if needed)
    return keywords.some(keyword => textLower.includes(keyword.toLowerCase()));
  }

  /**
   * Extract keywords from rule text
   */
  _extractKeywords(rule) {
    // Remove common words and split
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "is", "be"]);
    return rule
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word.toLowerCase()));
  }

  /**
   * Find location in text where rule might apply
   */
  _findMatchLocation(text, rule) {
    const keywords = this._extractKeywords(rule.rule);
    for (const keyword of keywords) {
      const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
      if (idx !== -1) {
        return { offset: idx, length: keyword.length };
      }
    }
    return null;
  }

  /**
   * Calculate weight based on severity
   */
  _calculateWeight(severity) {
    const weights = {
      low: 0.5,
      medium: 1.0,
      high: 1.5,
      critical: 2.0
    };
    return weights[severity] || 1.0;
  }

  // ====================================================================
  // PERSISTENCE
  // ====================================================================

  /**
   * Persist individual rule to disk
   */
  _persistRule(rule) {
    const ruleFile = path.join(this.rulesDir, `${rule.id}.json`);
    fs.writeFileSync(ruleFile, JSON.stringify(rule.toJSON(), null, 2));
  }

  /**
   * Load all rules from disk
   */
  _loadRulesFromDisk() {
    const files = fs.readdirSync(this.rulesDir).filter(f => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(this.rulesDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const rule = new ComplianceRule(data);
      this.rules.set(rule.id, rule);

      if (!this.categories.has(rule.category)) {
        this.categories.set(rule.category, []);
      }
      this.categories.get(rule.category).push(rule.id);
    }
  }

  /**
   * Append to audit history
   */
  _appendHistory(action, data, actor) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      data,
      actor
    };
    this.history.push(entry);

    // Persist history
    const historyFile = path.join(this.rulesDir, "_history.jsonl");
    fs.appendFileSync(historyFile, JSON.stringify(entry) + "\n");
  }

  // ====================================================================
  // EXPORT & REPORTING
  // ====================================================================

  /**
   * Export all active rules for deployment/backup
   */
  exportRules() {
    const rules = this.getAllRules();
    return {
      exportedAt: new Date().toISOString(),
      ruleCount: rules.length,
      categories: Array.from(this.categories.keys()),
      rules: rules.map(r => r.toJSON())
    };
  }

  /**
   * Import rules (bulk update from regulatory updates)
   */
  importRules(rulesData, { actor = "system", source = "import" } = {}) {
    const imported = [];

    for (const ruleData of rulesData.rules || []) {
      // Check if rule exists
      const existing = this.rules.get(ruleData.id);
      if (existing) {
        // Update existing
        this.updateRule(ruleData.id, ruleData, { actor, reason: `Imported from ${source}` });
        imported.push({ id: ruleData.id, action: "updated" });
      } else {
        // Add new
        const rule = this.addRule(ruleData.category, ruleData.rule, ruleData.guidance, {
          severity: ruleData.severity,
          source,
          actor
        });
        imported.push({ id: rule.id, action: "created" });
      }
    }

    this._appendHistory("import_rules", { count: imported.length, source }, actor);
    return imported;
  }

  /**
   * Export compliance audit report
   */
  exportAuditReport() {
    return {
      reportedAt: new Date().toISOString(),
      totalRules: this.rules.size,
      activeRules: Array.from(this.rules.values()).filter(r => r.active).length,
      categories: Array.from(this.categories.keys()),
      sources: Array.from(new Set(Array.from(this.rules.values()).map(r => r.source))),
      severityDistribution: this._calculateSeverityDistribution(),
      recentChanges: this.history.slice(-20)
    };
  }

  /**
   * Calculate severity distribution
   */
  _calculateSeverityDistribution() {
    const dist = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const rule of this.rules.values()) {
      if (rule.active) dist[rule.severity]++;
    }
    return dist;
  }
}

export { ComplianceRule, RuleVersion };
