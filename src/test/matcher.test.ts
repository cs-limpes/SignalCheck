import { describe, expect, it } from "vitest";
import { scanTextForMatches } from "@/lib/matcher";
import type { SignalRule } from "@/lib/signal-types";

const rules: SignalRule[] = [
  {
    id: "num-1488",
    term: "/\\b1488\\b/i",
    category: "number",
    risk: "high",
    meaning: "Sample meaning",
    context_note: "Sample context",
    review_guidance: "Sample guidance"
  },
  {
    id: "phrase-blood-soil",
    term: "blood and soil",
    category: "slogan",
    risk: "high",
    meaning: "Sample meaning",
    context_note: "Sample context",
    review_guidance: "Sample guidance"
  }
];

describe("scanTextForMatches", () => {
  it("matches regex and plain-text rules with source line evidence", () => {
    const matches = scanTextForMatches(
      {
        id: "screenshot-1",
        fileName: "profile.png",
        text: "Display name\nBio says 1488 here\nAnother line says Blood and Soil"
      },
      rules
    );

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      matchedText: "1488",
      lineNumber: 2,
      fileName: "profile.png"
    });
    expect(matches[1].matchedText.toLowerCase()).toBe("blood and soil");
    expect(matches[1].snippet).toContain("Another line");
  });

  it("uses word boundaries for plain terms", () => {
    const matches = scanTextForMatches(
      {
        id: "screenshot-2",
        fileName: "feed.png",
        text: "The phrase blood and soils should not match, but blood and soil should."
      },
      [rules[1]]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText).toBe("blood and soil");
  });
});
