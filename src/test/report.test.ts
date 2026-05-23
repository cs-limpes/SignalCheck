import { describe, expect, it } from "vitest";
import { generateReviewReport, reportToMarkdown } from "@/lib/report";
import type { SignalRule } from "@/lib/signal-types";

const rules: SignalRule[] = [
  {
    id: "num-1488",
    term: "1488",
    category: "number",
    risk: "high",
    meaning: "Possible coded reference",
    context_note: "Ambiguous without surrounding evidence",
    review_guidance: "Review neighboring text and repeated use"
  }
];

describe("generateReviewReport", () => {
  it("returns educational evidence items instead of identity claims", () => {
    const report = generateReviewReport(
      [
        {
          id: "image-1",
          fileName: "profile.png",
          text: "username 1488"
        }
      ],
      rules,
      "2026-05-22T12:00:00.000Z"
    );
    const markdown = reportToMarkdown(report);

    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      flaggedItem: "1488",
      category: "number",
      confidenceLevel: "high",
      humanReviewNote: "Review neighboring text and repeated use"
    });
    expect(report.summary).toContain("possible signal");
    expect(markdown).toContain("Possible signal");
    expect(markdown).not.toMatch(/this person is a nazi/i);
    expect(markdown).not.toMatch(/this person is extremist/i);
  });

  it("explains that no matches is not proof of absence", () => {
    const report = generateReviewReport(
      [
        {
          id: "image-2",
          fileName: "feed.png",
          text: "ordinary profile text"
        }
      ],
      rules,
      "2026-05-22T12:00:00.000Z"
    );

    expect(report.items).toHaveLength(0);
    expect(report.summary).toContain("does not prove the absence");
  });

  it("includes reviewer-entered visual observations as evidence", () => {
    const report = generateReviewReport(
      [
        {
          id: "visual-1",
          fileName: "feed.png",
          text: "Reviewer observed possible 1488 tattoo in profile image",
          sourceType: "visual_observation",
          sourceLabel: "visual cue checklist"
        }
      ],
      rules,
      "2026-05-22T12:00:00.000Z"
    );

    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      evidenceType: "visual_observation",
      whereAppeared: "feed.png, visual cue checklist"
    });
    expect(report.summary).toContain("visual observations");
  });
});
