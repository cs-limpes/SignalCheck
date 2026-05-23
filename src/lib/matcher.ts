import type { RuleMatch, SignalRule, TextDocument } from "./signal-types";

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/i;

export function scanDocumentsForMatches(documents: TextDocument[], rules: SignalRule[]): RuleMatch[] {
  return documents.flatMap((document) => scanTextForMatches(document, rules));
}

export function scanTextForMatches(document: TextDocument, rules: SignalRule[]): RuleMatch[] {
  return rules.flatMap((rule) => {
    const matcher = createMatcher(rule.term);
    const matches: RuleMatch[] = [];

    for (const match of document.text.matchAll(matcher)) {
      if (match.index === undefined || match[0] === "") {
        continue;
      }

      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;
      const lineInfo = getLineInfo(document.text, startIndex);

      matches.push({
        id: `${document.id}:${rule.id}:${startIndex}`,
        rule,
        sourceId: document.id,
        fileName: document.fileName,
        sourceType: document.sourceType ?? "ocr_text",
        sourceLabel: document.sourceLabel ?? "OCR text",
        matchedText: match[0],
        lineNumber: lineInfo.lineNumber,
        lineText: lineInfo.lineText,
        snippet: createSnippet(document.text, startIndex, endIndex),
        startIndex,
        endIndex
      });
    }

    return matches;
  });
}

export function createMatcher(term: string): RegExp {
  const literal = parseRegexLiteral(term);

  if (literal) {
    const flags = Array.from(new Set(`${literal.flags}g`)).join("");
    return new RegExp(literal.source, flags);
  }

  const escaped = escapeRegExp(term.trim());
  const bounded = shouldUseWordBoundary(term) ? `\\b${escaped}\\b` : escaped;
  return new RegExp(bounded, "gi");
}

function parseRegexLiteral(term: string): { source: string; flags: string } | null {
  const match = term.match(REGEX_LITERAL);

  if (!match) {
    return null;
  }

  return {
    source: match[1],
    flags: match[2]
  };
}

function shouldUseWordBoundary(term: string): boolean {
  const trimmed = term.trim();
  return /^[a-z0-9]/i.test(trimmed) && /[a-z0-9]$/i.test(trimmed);
}

function getLineInfo(text: string, index: number): { lineNumber: number; lineText: string } {
  const beforeMatch = text.slice(0, index);
  const lineNumber = beforeMatch.split(/\r\n|\r|\n/).length;
  const lineStart = Math.max(beforeMatch.lastIndexOf("\n"), beforeMatch.lastIndexOf("\r")) + 1;
  const nextNewline = text.slice(index).search(/\r\n|\r|\n/);
  const lineEnd = nextNewline === -1 ? text.length : index + nextNewline;

  return {
    lineNumber,
    lineText: text.slice(lineStart, lineEnd).trim()
  };
}

function createSnippet(text: string, startIndex: number, endIndex: number): string {
  const radius = 70;
  const start = Math.max(0, startIndex - radius);
  const end = Math.min(text.length, endIndex + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
