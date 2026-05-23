export type RuleCategory = "number" | "phrase" | "symbol" | "slogan" | "account_reference";

export type RiskLevel = "low" | "medium" | "high";

export type EvidenceSourceType = "ocr_text" | "visual_observation";

export type SignalRule = {
  id: string;
  term: string;
  category: RuleCategory;
  risk: RiskLevel;
  meaning: string;
  context_note: string;
  review_guidance: string;
};

export type RulesDatabase = {
  editable_notice: string;
  rules: SignalRule[];
};

export type TextDocument = {
  id: string;
  fileName: string;
  text: string;
  sourceType?: EvidenceSourceType;
  sourceLabel?: string;
};

export type RuleMatch = {
  id: string;
  rule: SignalRule;
  sourceId: string;
  fileName: string;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  matchedText: string;
  lineNumber: number;
  lineText: string;
  snippet: string;
  startIndex: number;
  endIndex: number;
};

export type ReportItem = {
  id: string;
  evidenceType: EvidenceSourceType;
  flaggedItem: string;
  category: RuleCategory;
  whereAppeared: string;
  whatItCanMean: string;
  whyContextMatters: string;
  confidenceLevel: RiskLevel;
  humanReviewNote: string;
  evidenceSnippet: string;
  ruleId: string;
  sourceId: string;
};

export type ReviewReport = {
  title: string;
  generatedAt: string;
  safetyNote: string;
  privacyNote: string;
  summary: string;
  itemCount: number;
  items: ReportItem[];
};
