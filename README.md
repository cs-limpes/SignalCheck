# SignalCheck

SignalCheck is a personal-use MVP for reviewing screenshots of public social media profiles or feeds for possible extremist dogwhistles. It produces an evidence-based human-review report. It must not label a person or account as extremist.

## What It Does

- Upload one or more screenshots in the browser.
- Run OCR locally with Tesseract.js.
- Run an experimental local visual scan for symbols, flags, hand signs, or tattoos.
- Match extracted text against an editable JSON rules database.
- Match model-suggested visual observations against the same editable rules database.
- Generate a report with flagged item, category, where it appeared, possible meaning, context note, confidence level, evidence snippet, and human review guidance.
- Export the report manually as Markdown or JSON.

## Privacy Model

For the MVP, screenshots are processed locally in the browser. The app defines no upload endpoint and does not send screenshots to a backend, database, or analysis API.

Image retention is off by default. Screenshots are held only long enough to run OCR unless the user explicitly enables local preview retention for the current browser session. Reports are downloaded only when the user clicks an export button.

Tesseract.js may need OCR engine/language assets in the browser depending on build/deployment setup. For fully offline or air-gapped use, vendor those assets into `public/` and configure Tesseract paths before relying on offline operation.

Visual scanning is experimental in this MVP. The app downloads a browser ML model and runs zero-shot image classification locally; screenshots are not uploaded for visual analysis. Results are suggestions, not definitive symbol identification, and they require human review because false positives and misses are expected.

The visual scan also checks approximate regions of the screenshot and generates session-only evidence clips with a red outline. These clips are meant to explain what area the model may have reacted to. They are not pixel-perfect object detection boxes.

## Setup

```bash
cd SignalCheck
npm install
npm run dev
```

Open the local URL printed by Next.js.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm test
```

## Editable Rules

The starter database lives at `src/data/rules.json`. It contains sample entries only:

```json
{
  "id": "string",
  "term": "string or /regex/flags",
  "category": "number | phrase | symbol | slogan | account_reference",
  "risk": "low | medium | high",
  "meaning": "short explanation",
  "context_note": "why this can be ambiguous",
  "review_guidance": "what to look for next"
}
```

Plain string terms are matched case-insensitively with word boundaries. Regex terms can be written as JSON strings like `"/\\b1488\\b/i"`.

Visual review uses the same rules by converting model suggestions and optional reviewer notes into evidence text. For example, a local visual-model suggestion for "swastika" creates a visual-observation evidence item that can match the editable `swastika` rule.

## Ethical Limits

SignalCheck shows receipts, not accusations. It should use language such as "possible signal," "context-dependent," "requires review," and "strong concern based on repeated possible signals."

Do not use this MVP to make definitive identity claims such as "this person is a Nazi" or "this person is extremist." OCR can be wrong, visual model suggestions can be mistaken, symbols and numbers can be ambiguous, and public posts may include criticism, quotation, satire, journalism, or research. Human review is required before any action is considered.
