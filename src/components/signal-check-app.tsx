"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileJson,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  ScanText,
  ShieldCheck,
  Trash2,
  UploadCloud
} from "lucide-react";
import { editableRulesDatabase, getEditableRules } from "@/lib/rules";
import { generateReviewReport, reportToMarkdown } from "@/lib/report";
import type { ReviewReport, TextDocument } from "@/lib/signal-types";

type OcrStatus = "queued" | "processing" | "complete" | "error";
type VisualScanStatus = "not_started" | "loading_model" | "scanning" | "complete" | "error";

type VisualPrediction = {
  clipUrl: string | null;
  displayName: string;
  label: string;
  regionLabel: string;
  ruleText: string;
  score: number;
};

type VisualClassifier = (
  image: string,
  candidateLabels: string[],
  options?: { hypothesis_template?: string }
) => Promise<Array<{ label: string; score: number }>>;

type UploadedScreenshot = {
  id: string;
  file: File | null;
  name: string;
  size: number;
  previewUrl: string | null;
  ocrStatus: OcrStatus;
  progress: number;
  text: string;
  visualScanStatus: VisualScanStatus;
  visualPredictions: VisualPrediction[];
  visualNotes: string;
  error: string | null;
  visualError: string | null;
};

type TesseractProgress = {
  status?: string;
  progress?: number;
};

type VisualScanTarget = {
  modelLabel: string;
  displayName: string;
  reportText: string;
};

type VisualRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

type WorkflowAction = "upload" | "ocr" | "visual" | "analyze" | "done";

type WorkflowStep = {
  action: WorkflowAction;
  buttonLabel: string;
  detail: string;
  isDisabled: boolean;
  tone: "idle" | "ready" | "working" | "complete";
  title: string;
};

type VisualResult = {
  clipUrl: string | null;
  displayName: string;
  fileName: string;
  isReportable: boolean;
  regionLabel: string;
  score: number;
  sourceId: string;
};

const rules = getEditableRules();
const visualReportThreshold = 0.18;
const visualDisplayThreshold = 0.08;

const visualScanTargets: VisualScanTarget[] = [
  { modelLabel: "a swastika symbol", displayName: "Swastika", reportText: "swastika" },
  {
    modelLabel: "a Confederate battle flag",
    displayName: "Confederate flag",
    reportText: "confederate flag"
  },
  {
    modelLabel: "a black sun sonnenrad symbol",
    displayName: "Black sun / sonnenrad",
    reportText: "black sun sonnenrad"
  },
  { modelLabel: "SS lightning bolt symbols", displayName: "SS-style bolts", reportText: "SS bolts" },
  {
    modelLabel: "a Totenkopf death head skull symbol",
    displayName: "Totenkopf / death's head",
    reportText: "totenkopf death's head"
  },
  { modelLabel: "an OK hand sign gesture", displayName: "OK hand sign", reportText: "OK hand sign" },
  {
    modelLabel: "a Nazi salute raised arm gesture",
    displayName: "Raised-arm salute",
    reportText: "Nazi salute Roman salute"
  },
  {
    modelLabel: "a tattoo of an extremist symbol",
    displayName: "Possible symbol tattoo",
    reportText: "hate symbol tattoo extremist tattoo"
  }
];

const neutralVisualLabels = [
  "ordinary social media screenshot with no extremist symbols",
  "text-only screenshot",
  "unclear image"
];

let visualClassifierPromise: Promise<VisualClassifier> | null = null;

export function SignalCheckApp() {
  const [screenshots, setScreenshots] = useState<UploadedScreenshot[]>([]);
  const [retainImages, setRetainImages] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isVisualScanning, setIsVisualScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Upload screenshots to begin.");
  const [analysisReport, setAnalysisReport] = useState<ReviewReport | null>(null);
  const [analysisSignature, setAnalysisSignature] = useState<string | null>(null);
  const screenshotsRef = useRef<UploadedScreenshot[]>([]);
  const retainImagesRef = useRef(retainImages);

  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);

  useEffect(() => {
    retainImagesRef.current = retainImages;
  }, [retainImages]);

  useEffect(() => {
    return () => {
      screenshotsRef.current.forEach((screenshot) => revokePreview(screenshot.previewUrl));
    };
  }, []);

  const evidenceDocuments = useMemo<TextDocument[]>(
    () => buildEvidenceDocuments(screenshots),
    [screenshots]
  );
  const evidenceSignature = useMemo(() => createEvidenceSignature(evidenceDocuments), [evidenceDocuments]);
  const hasEvidenceInput = evidenceDocuments.length > 0;
  const needsAnalysis = hasEvidenceInput && analysisSignature !== evidenceSignature;
  const activeReport = analysisReport && !needsAnalysis ? analysisReport : null;
  const isBusy = isScanning || isVisualScanning;
  const canRunOcr = screenshots.some((screenshot) => screenshot.file) && !isBusy;
  const canRunVisualScan = screenshots.some((screenshot) => screenshot.file) && !isBusy;
  const canAnalyze = hasEvidenceInput && !isBusy;
  const canExport = Boolean(activeReport);
  const visualResults = useMemo(() => buildVisualResults(screenshots), [screenshots]);
  const workflowStep = getWorkflowStep({
    activeReport,
    canAnalyze,
    canRunOcr,
    canRunVisualScan,
    hasEvidenceInput,
    isScanning,
    isVisualScanning,
    needsAnalysis,
    screenshots
  });
  const analysisStatus = getAnalysisStatus({
    hasScreenshots: screenshots.length > 0,
    hasEvidenceInput,
    isBusy,
    needsAnalysis,
    activeReport
  });
  const AnalysisIcon = analysisStatus.icon;

  function runWorkflowStep() {
    if (workflowStep.isDisabled) {
      return;
    }

    if (workflowStep.action === "ocr") {
      void runOcr();
      return;
    }

    if (workflowStep.action === "visual") {
      void runVisualScan();
      return;
    }

    if (workflowStep.action === "analyze") {
      analyzeEvidence();
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (files.length === 0) {
      setStatusMessage("No image files were selected.");
      return;
    }

    setScreenshots((current) => [...current, ...files.map(createScreenshotRecord)]);
    setStatusMessage(
      `${files.length} screenshot${files.length === 1 ? "" : "s"} uploaded. Extract OCR, scan visuals, then click Analyze evidence.`
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      addFiles(event.target.files);
      event.target.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  function removeScreenshot(id: string) {
    setScreenshots((current) => {
      const target = current.find((screenshot) => screenshot.id === id);
      revokePreview(target?.previewUrl ?? null);
      return current.filter((screenshot) => screenshot.id !== id);
    });
  }

  function clearScreenshots() {
    screenshotsRef.current.forEach((screenshot) => revokePreview(screenshot.previewUrl));
    setScreenshots([]);
    setAnalysisReport(null);
    setAnalysisSignature(null);
    setStatusMessage("Workspace cleared.");
  }

  function updateRetainImages(checked: boolean) {
    setRetainImages(checked);
    setScreenshots((current) =>
      current.map((screenshot) => {
        if (checked) {
          return {
            ...screenshot,
            previewUrl:
              screenshot.previewUrl ?? (screenshot.file ? URL.createObjectURL(screenshot.file) : null)
          };
        }

        if (
          screenshot.ocrStatus === "queued" ||
          screenshot.ocrStatus === "processing" ||
          screenshot.visualScanStatus === "not_started" ||
          screenshot.visualScanStatus === "loading_model" ||
          screenshot.visualScanStatus === "scanning"
        ) {
          return screenshot;
        }

        revokePreview(screenshot.previewUrl);

        return {
          ...screenshot,
          file: null,
          previewUrl: null
        };
      })
    );
  }

  function updateOcrText(id: string, text: string) {
    setScreenshots((current) =>
      current.map((screenshot) => (screenshot.id === id ? { ...screenshot, text } : screenshot))
    );
    setStatusMessage("OCR text edited. Click Analyze evidence to refresh the report.");
  }

  function updateVisualNotes(id: string, visualNotes: string) {
    setScreenshots((current) =>
      current.map((screenshot) =>
        screenshot.id === id
          ? {
              ...screenshot,
              visualNotes
            }
          : screenshot
      )
    );
    setStatusMessage("Visual note edited. Click Analyze evidence to refresh the report.");
  }

  async function runOcr() {
    const queuedScreenshots = screenshotsRef.current.filter((screenshot) => screenshot.file);

    if (queuedScreenshots.length === 0) {
      return;
    }

    setIsScanning(true);
    setStatusMessage("Loading browser OCR worker.");

    try {
      const { recognize } = await import("tesseract.js");

      for (const screenshot of queuedScreenshots) {
        if (!screenshot.file) {
          continue;
        }

        setStatusMessage(`Extracting text from ${screenshot.name}`);
        setScreenshots((current) =>
          current.map((item) =>
            item.id === screenshot.id
              ? { ...item, ocrStatus: "processing", progress: 0, error: null }
              : item
          )
        );

        try {
          const result = await recognize(screenshot.file, "eng", {
            logger(message: TesseractProgress) {
              if (message.status === "recognizing text" && typeof message.progress === "number") {
                updateProgress(screenshot.id, message.progress);
              }
            }
          });

          finishOcr(screenshot.id, result.data.text ?? "");
        } catch (error) {
          failOcr(screenshot.id, error);
        }
      }
    } finally {
      setIsScanning(false);
      setStatusMessage("OCR extracted. Next step: run Scan visuals.");
    }
  }

  async function runVisualScan() {
    const scanTargets = screenshotsRef.current.filter((screenshot) => screenshot.file);

    if (scanTargets.length === 0) {
      setStatusMessage("No image data is available for visual scanning. Re-upload the screenshot to scan visuals.");
      return;
    }

    setIsVisualScanning(true);
    setStatusMessage("Loading local visual model. First run can take a bit while model files download.");

    try {
      scanTargets.forEach((screenshot) => updateVisualStatus(screenshot.id, "loading_model"));
      const classifier = await getVisualClassifier();

      for (const screenshot of scanTargets) {
        if (!screenshot.file) {
          continue;
        }

        setStatusMessage(`Scanning visual symbols in ${screenshot.name}`);
        updateVisualStatus(screenshot.id, "scanning");

        try {
          const imageUrl = screenshot.previewUrl ?? URL.createObjectURL(screenshot.file);
          const predictions = await scanVisualEvidence(screenshot.file, imageUrl, classifier);

          if (!screenshot.previewUrl) {
            URL.revokeObjectURL(imageUrl);
          }

          finishVisualScan(screenshot.id, predictions);
        } catch (error) {
          failVisualScan(screenshot.id, error);
        }
      }
    } catch (error) {
      visualClassifierPromise = null;
      setStatusMessage(
        error instanceof Error
          ? `Cannot load visual model: ${error.message}`
          : "Cannot load visual model."
      );
      scanTargets.forEach((screenshot) => failVisualScan(screenshot.id, error));
    } finally {
      setIsVisualScanning(false);
      setStatusMessage("Visual scan complete. Next step: click Analyze evidence.");
    }
  }

  function updateProgress(id: string, progress: number) {
    setScreenshots((current) =>
      current.map((screenshot) =>
        screenshot.id === id ? { ...screenshot, progress: Math.round(progress * 100) } : screenshot
      )
    );
  }

  function updateVisualStatus(id: string, visualScanStatus: VisualScanStatus) {
    setScreenshots((current) =>
      current.map((screenshot) =>
        screenshot.id === id
          ? { ...screenshot, visualScanStatus, visualError: null, visualPredictions: [] }
          : screenshot
      )
    );
  }

  function finishOcr(id: string, text: string) {
    setScreenshots((current) =>
      current.map((screenshot) => {
        if (screenshot.id !== id) {
          return screenshot;
        }

        const shouldClearImage =
          !retainImagesRef.current &&
          (screenshot.visualScanStatus === "complete" || screenshot.visualScanStatus === "error");

        if (shouldClearImage) {
          revokePreview(screenshot.previewUrl);
        }

        return {
          ...screenshot,
          file: shouldClearImage ? null : screenshot.file,
          previewUrl: shouldClearImage ? null : screenshot.previewUrl,
          ocrStatus: "complete",
          progress: 100,
          text: text.trim(),
          error: null
        };
      })
    );
  }

  function failOcr(id: string, error: unknown) {
    setScreenshots((current) =>
      current.map((screenshot) => {
        if (screenshot.id !== id) {
          return screenshot;
        }

        const shouldClearImage =
          !retainImagesRef.current &&
          (screenshot.visualScanStatus === "complete" || screenshot.visualScanStatus === "error");

        if (shouldClearImage) {
          revokePreview(screenshot.previewUrl);
        }

        return {
          ...screenshot,
          file: shouldClearImage ? null : screenshot.file,
          previewUrl: shouldClearImage ? null : screenshot.previewUrl,
          ocrStatus: "error",
          progress: 0,
          error: error instanceof Error ? error.message : "OCR failed."
        };
      })
    );
  }

  function finishVisualScan(id: string, visualPredictions: VisualPrediction[]) {
    setScreenshots((current) =>
      current.map((screenshot) => {
        if (screenshot.id !== id) {
          return screenshot;
        }

        const shouldClearImage =
          !retainImagesRef.current &&
          (screenshot.ocrStatus === "complete" || screenshot.ocrStatus === "error");

        if (shouldClearImage) {
          revokePreview(screenshot.previewUrl);
        }

        return {
          ...screenshot,
          file: shouldClearImage ? null : screenshot.file,
          previewUrl: shouldClearImage ? null : screenshot.previewUrl,
          visualScanStatus: "complete",
          visualPredictions,
          visualError: null
        };
      })
    );
  }

  function failVisualScan(id: string, error: unknown) {
    setScreenshots((current) =>
      current.map((screenshot) =>
        screenshot.id === id
          ? {
              ...screenshot,
              visualScanStatus: "error",
              visualError:
                error instanceof Error
                  ? error.message
                  : "Visual scan failed before producing suggestions."
            }
          : screenshot
      )
    );
  }

  function analyzeEvidence() {
    if (!hasEvidenceInput) {
      setStatusMessage("Add OCR text, run visual scan, or add visual notes before analysis.");
      return;
    }

    const nextReport = generateReviewReport(evidenceDocuments, rules);
    setAnalysisReport(nextReport);
    setAnalysisSignature(evidenceSignature);
    setStatusMessage(
      `Report ready: ${nextReport.itemCount} possible signal${nextReport.itemCount === 1 ? "" : "s"} flagged for human review. Review results in the Evidence report panel.`
    );
  }

  function downloadReport(format: "markdown" | "json") {
    if (!activeReport) {
      return;
    }

    const content =
      format === "json" ? JSON.stringify(activeReport, null, 2) : reportToMarkdown(activeReport);
    const extension = format === "json" ? "json" : "md";
    const mime = format === "json" ? "application/json" : "text/markdown";
    const date = new Date().toISOString().slice(0, 10);

    downloadTextFile(`signalcheck-report-${date}.${extension}`, content, mime);
  }

  return (
    <div className="signal-app">
      <header className="topbar">
        <div className="brand" aria-label="SignalCheck">
          <span className="brand-mark">SC</span>
          <span>
            <strong>SignalCheck</strong>
            <small>Human-review evidence reports</small>
          </span>
        </div>
        <span className="status-pill">
          <ShieldCheck size={17} aria-hidden="true" />
          Local OCR + visual scan
        </span>
      </header>

      <main className="workspace">
        <section className="control-column" aria-label="Screenshot OCR and visual scan controls">
          <div className="privacy-panel">
            <div>
              <Lock size={19} aria-hidden="true" />
              <p>Screenshots stay in this browser. Visual scanning runs locally after model files load.</p>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={retainImages}
                onChange={(event) => updateRetainImages(event.target.checked)}
              />
              <span>Keep local image previews after OCR and visual scan</span>
            </label>
          </div>

          <label
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <input type="file" accept="image/*" multiple onChange={handleFileChange} />
            <UploadCloud size={28} aria-hidden="true" />
            <span>
              <strong>Upload screenshots</strong>
              <small>PNG, JPG, WEBP, or GIF</small>
            </span>
          </label>

          <div className={`workflow-card ${workflowStep.tone}`}>
            <div>
              <span>Next step</span>
              <strong>{workflowStep.title}</strong>
              <p>{workflowStep.detail}</p>
            </div>
            <button
              type="button"
              onClick={runWorkflowStep}
              disabled={workflowStep.isDisabled || workflowStep.action === "upload" || workflowStep.action === "done"}
            >
              {workflowStep.buttonLabel}
            </button>
          </div>

          <div className="action-row">
            <button className="primary-action" type="button" onClick={runOcr} disabled={!canRunOcr}>
              {isScanning ? (
                <Loader2 size={18} aria-hidden="true" />
              ) : (
                <ScanText size={18} aria-hidden="true" />
              )}
              Extract OCR
            </button>
            <button
              className="visual-action"
              type="button"
              onClick={runVisualScan}
              disabled={!canRunVisualScan}
            >
              {isVisualScanning ? (
                <Loader2 size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
              Scan visuals
            </button>
            <button
              className="analysis-action"
              type="button"
              onClick={analyzeEvidence}
              disabled={!canAnalyze || (!needsAnalysis && Boolean(activeReport))}
            >
              <ClipboardCheck size={18} aria-hidden="true" />
              {activeReport && !needsAnalysis ? "Analyzed" : "Analyze evidence"}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={clearScreenshots}
              disabled={!screenshots.length || isBusy}
            >
              <Trash2 size={18} aria-hidden="true" />
              Clear
            </button>
          </div>

          <div className={`analysis-status ${analysisStatus.tone}`} aria-live="polite">
            <AnalysisIcon size={18} aria-hidden="true" />
            <div>
              <strong>{analysisStatus.title}</strong>
              <p>{analysisStatus.detail}</p>
            </div>
          </div>

          <p className="worker-status" aria-live="polite">
            {statusMessage}
          </p>

          <div className="screenshot-list" aria-label="Queued screenshots">
            {screenshots.length === 0 ? (
              <div className="empty-state">
                <ImagePlus size={22} aria-hidden="true" />
                <p>No screenshots queued.</p>
              </div>
            ) : (
              screenshots.map((screenshot) => (
                <ScreenshotCard
                  key={screenshot.id}
                  screenshot={screenshot}
                  activeReport={activeReport}
                  needsAnalysis={needsAnalysis}
                  isBusy={isBusy}
                  onRemove={removeScreenshot}
                  onOcrTextChange={updateOcrText}
                  onVisualNotesChange={updateVisualNotes}
                />
              ))
            )}
          </div>
        </section>

        <section className="report-column" aria-label="Evidence report">
          <div className="report-header">
            <p className="eyebrow">Evidence report</p>
            <h1>Show receipts, not accusations.</h1>
            <p>
              {activeReport
                ? activeReport.summary
                : hasEvidenceInput
                  ? "Evidence is ready. Click Analyze evidence to scan OCR text and model-suggested visual observations."
                  : "Upload screenshots, extract OCR, and run the local visual scan for symbols, flags, hand signs, or tattoos."}
            </p>
          </div>

          <div className="report-actions">
            <button type="button" onClick={() => downloadReport("markdown")} disabled={!canExport}>
              <Download size={18} aria-hidden="true" />
              Markdown
            </button>
            <button type="button" onClick={() => downloadReport("json")} disabled={!canExport}>
              <FileJson size={18} aria-hidden="true" />
              JSON
            </button>
          </div>

          <VisualResultsPanel visualResults={visualResults} />

          <div className="rules-panel">
            <CheckCircle2 size={18} aria-hidden="true" />
            <p>
              {rules.length} editable sample rules loaded. {editableRulesDatabase.editable_notice}
            </p>
          </div>

          <div className="safety-panel">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>
              Visual matches are experimental model suggestions, not definitive symbol identification.{" "}
              {activeReport?.safetyNote ?? "Reports must not label a person or account as extremist."}
            </p>
          </div>

          <section className="evidence-list" aria-label="Flagged evidence items">
            {!activeReport ? (
              <div className="empty-report">
                <ClipboardCheck size={24} aria-hidden="true" />
                <p>No analyzed report yet.</p>
              </div>
            ) : activeReport.items.length === 0 ? (
              <div className="empty-report success">
                <CheckCircle2 size={24} aria-hidden="true" />
                <p>No editable rule matches were found in the analyzed evidence.</p>
              </div>
            ) : (
              activeReport.items.map((item, index) => (
                <article className={`evidence-item risk-${item.confidenceLevel}`} key={item.id}>
                  <div className="item-topline">
                    <span>{item.confidenceLevel} confidence</span>
                    <span>{formatEvidenceType(item.evidenceType)}</span>
                  </div>
                  <h2>
                    {index + 1}. Possible signal: <span>{item.flaggedItem}</span>
                  </h2>
                  <dl>
                    <div>
                      <dt>Category</dt>
                      <dd>{item.category}</dd>
                    </div>
                    <div>
                      <dt>Where</dt>
                      <dd>{item.whereAppeared}</dd>
                    </div>
                    <div>
                      <dt>What it can mean</dt>
                      <dd>{item.whatItCanMean}</dd>
                    </div>
                    <div>
                      <dt>Why context matters</dt>
                      <dd>{item.whyContextMatters}</dd>
                    </div>
                    <div>
                      <dt>Human review note</dt>
                      <dd>{item.humanReviewNote}</dd>
                    </div>
                  </dl>
                  <blockquote>{item.evidenceSnippet}</blockquote>
                </article>
              ))
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function ScreenshotCard({
  screenshot,
  activeReport,
  needsAnalysis,
  isBusy,
  onRemove,
  onOcrTextChange,
  onVisualNotesChange
}: {
  screenshot: UploadedScreenshot;
  activeReport: ReviewReport | null;
  needsAnalysis: boolean;
  isBusy: boolean;
  onRemove: (id: string) => void;
  onOcrTextChange: (id: string, text: string) => void;
  onVisualNotesChange: (id: string, visualNotes: string) => void;
}) {
  const screenshotItemCount =
    activeReport?.items.filter((item) => item.sourceId.startsWith(screenshot.id)).length ?? 0;
  const reportableVisualCount = screenshot.visualPredictions.filter(
    (prediction) => prediction.score >= visualReportThreshold
  ).length;
  const hasVisualInput = reportableVisualCount > 0 || Boolean(screenshot.visualNotes.trim());
  const hasAnyEvidence = Boolean(screenshot.text.trim()) || hasVisualInput;

  return (
    <article className="screenshot-item">
      {screenshot.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={screenshot.previewUrl} alt="" />
      ) : (
        <div className="image-placeholder">
          <FileText size={19} aria-hidden="true" />
          <span>Preview cleared</span>
        </div>
      )}
      <div className="screenshot-body">
        <div className="screenshot-heading">
          <div>
            <h2>{screenshot.name}</h2>
            <span>{formatBytes(screenshot.size)}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => onRemove(screenshot.id)}
            aria-label={`Remove ${screenshot.name}`}
            disabled={isBusy}
            title="Remove screenshot"
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="step-row" aria-label={`Processing status for ${screenshot.name}`}>
          <OcrStatusBadge status={screenshot.ocrStatus} progress={screenshot.progress} />
          <VisualStatusBadge status={screenshot.visualScanStatus} count={reportableVisualCount} />
          <span
            className={`status-badge analysis ${
              activeReport && !needsAnalysis ? "complete" : hasAnyEvidence ? "queued" : "idle"
            }`}
          >
            {activeReport && !needsAnalysis
              ? `Analyzed: ${screenshotItemCount} flag${screenshotItemCount === 1 ? "" : "s"}`
              : hasAnyEvidence
                ? "Needs analysis"
                : "No evidence yet"}
          </span>
        </div>

        {screenshot.error ? (
          <p className="error-message">
            <AlertTriangle size={16} aria-hidden="true" />
            {screenshot.error}
          </p>
        ) : null}

        {screenshot.visualError ? (
          <p className="error-message">
            <AlertTriangle size={16} aria-hidden="true" />
            {screenshot.visualError}
          </p>
        ) : null}

        <label className="ocr-field">
          <span>OCR text</span>
          <textarea
            value={screenshot.text}
            onChange={(event) => onOcrTextChange(screenshot.id, event.target.value)}
            placeholder="Extracted text will appear here. You can correct OCR before analysis."
            rows={6}
          />
        </label>

        <section className="visual-review" aria-label={`Visual scan for ${screenshot.name}`}>
          <div className="visual-review-heading">
            <Eye size={16} aria-hidden="true" />
            <span>Visual scan suggestions</span>
          </div>
          <p>
            These are model confidence scores, not progress bars. Low-confidence suggestions stay
            visible for review but are not added as flagged evidence.
          </p>
          {screenshot.visualPredictions.length ? (
            <div className="prediction-list">
              {screenshot.visualPredictions.map((prediction) => (
                <div
                  className={`prediction-row ${
                    prediction.score >= visualReportThreshold ? "reportable" : ""
                  }`}
                  key={prediction.label}
                >
                  {prediction.clipUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="prediction-thumb" src={prediction.clipUrl} alt="" />
                  ) : null}
                  <div>
                    <span>{prediction.displayName}</span>
                    <small>{prediction.regionLabel}</small>
                  </div>
                  <strong>{formatVisualScore(prediction.score)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="prediction-empty">
              {screenshot.visualScanStatus === "complete"
                ? "No visual symbol suggestion crossed the display threshold."
                : "Run Scan visuals to get model suggestions."}
            </div>
          )}
          <label className="visual-notes">
            <span>Additional visual notes</span>
            <textarea
              value={screenshot.visualNotes}
              onChange={(event) => onVisualNotesChange(screenshot.id, event.target.value)}
              placeholder="Optional: describe anything the model might miss, such as a partially obscured tattoo or patch."
              rows={3}
            />
          </label>
        </section>
      </div>
    </article>
  );
}

function OcrStatusBadge({ status, progress }: { status: OcrStatus; progress: number }) {
  const label =
    status === "processing"
      ? `OCR ${progress}%`
      : status === "complete"
        ? "OCR extracted"
        : status === "error"
          ? "OCR failed"
          : "OCR queued";

  return <span className={`status-badge ${status}`}>{label}</span>;
}

function VisualStatusBadge({ status, count }: { status: VisualScanStatus; count: number }) {
  const label =
    status === "loading_model"
      ? "Loading visual model"
      : status === "scanning"
        ? "Scanning visuals"
        : status === "complete"
          ? count
            ? `Visual scan: ${count} suggestion${count === 1 ? "" : "s"}`
            : "Visual scan complete"
          : status === "error"
            ? "Visual scan failed"
            : "Visual scan needed";

  return <span className={`status-badge visual ${status}`}>{label}</span>;
}

function VisualResultsPanel({ visualResults }: { visualResults: VisualResult[] }) {
  if (visualResults.length === 0) {
    return (
      <section className="results-panel" aria-label="Visual scan results">
        <div className="results-heading">
          <Eye size={18} aria-hidden="true" />
          <h2>Visual Scan Results</h2>
        </div>
        <p>No visual scan suggestions yet. Run Scan visuals after uploading an image.</p>
      </section>
    );
  }

  return (
    <section className="results-panel" aria-label="Visual scan results">
      <div className="results-heading">
        <Eye size={18} aria-hidden="true" />
        <h2>Visual Scan Results</h2>
      </div>
      <p>
        These are model confidence scores. Low-confidence suggestions are shown for transparency and
        are not treated as flagged evidence.
      </p>
      <div className="results-list">
        {visualResults.map((result) => (
          <article className={`result-row ${result.isReportable ? "reportable" : "low"}`} key={result.sourceId}>
            {result.clipUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.clipUrl} alt="" />
            ) : null}
            <div>
              <strong>{result.displayName}</strong>
              <span>{result.fileName}</span>
              <span>{result.regionLabel}</span>
            </div>
            <span>{formatVisualScore(result.score)}</span>
            <small>{result.isReportable ? "Added to report evidence" : "Low confidence, not flagged"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function buildEvidenceDocuments(screenshots: UploadedScreenshot[]): TextDocument[] {
  return screenshots.flatMap((screenshot) => {
    const documents: TextDocument[] = [];
    const text = screenshot.text.trim();
    const visualText = buildVisualObservationText(screenshot);

    if (text) {
      documents.push({
        id: `${screenshot.id}:ocr`,
        fileName: screenshot.name,
        text,
        sourceType: "ocr_text",
        sourceLabel: "OCR text"
      });
    }

    if (visualText) {
      documents.push({
        id: `${screenshot.id}:visual`,
        fileName: screenshot.name,
        text: visualText,
        sourceType: "visual_observation",
        sourceLabel: "local visual scan and notes"
      });
    }

    return documents;
  });
}

function buildVisualResults(screenshots: UploadedScreenshot[]): VisualResult[] {
  return screenshots
    .flatMap((screenshot) =>
      screenshot.visualPredictions.map((prediction) => ({
        clipUrl: prediction.clipUrl,
        displayName: prediction.displayName,
        fileName: screenshot.name,
        isReportable: prediction.score >= visualReportThreshold,
        regionLabel: prediction.regionLabel,
        score: prediction.score,
        sourceId: `${screenshot.id}:${prediction.label}`
      }))
    )
    .sort((first, second) => second.score - first.score);
}

function buildVisualObservationText(screenshot: UploadedScreenshot): string {
  const modelSuggestions = screenshot.visualPredictions
    .filter((prediction) => prediction.score >= visualReportThreshold)
    .map(
      (prediction) =>
        `Local visual model suggested possible ${prediction.ruleText} with ${Math.round(
          prediction.score * 100
        )}% confidence. Approximate region: ${prediction.regionLabel}.`
    );
  const visualNotes = screenshot.visualNotes.trim()
    ? [`Reviewer visual note: ${screenshot.visualNotes.trim()}`]
    : [];

  return [...modelSuggestions, ...visualNotes].join("\n").trim();
}

function createEvidenceSignature(documents: TextDocument[]): string {
  return JSON.stringify(
    documents.map((document) => ({
      id: document.id,
      text: document.text,
      sourceType: document.sourceType
    }))
  );
}

function createScreenshotRecord(file: File): UploadedScreenshot {
  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    name: file.name,
    size: file.size,
    previewUrl: URL.createObjectURL(file),
    ocrStatus: "queued",
    progress: 0,
    text: "",
    visualScanStatus: "not_started",
    visualPredictions: [],
    visualNotes: "",
    error: null,
    visualError: null
  };
}

async function getVisualClassifier(): Promise<VisualClassifier> {
  if (!visualClassifierPromise) {
    visualClassifierPromise = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      const classifier = await pipeline(
        "zero-shot-image-classification",
        "Xenova/clip-vit-base-patch32"
      );
      return classifier as unknown as VisualClassifier;
    })();
  }

  return visualClassifierPromise;
}

async function scanVisualEvidence(
  file: File,
  imageUrl: string,
  classifier: VisualClassifier
): Promise<VisualPrediction[]> {
  const labels = [...visualScanTargets.map((target) => target.modelLabel), ...neutralVisualLabels];
  const bestByLabel = new Map<string, VisualPrediction>();
  const wholeImageOutput = await classifier(imageUrl, labels, {
    hypothesis_template: "This screenshot contains {}."
  });

  for (const prediction of wholeImageOutput) {
    collectVisualPrediction(bestByLabel, prediction, null, "whole screenshot");
  }

  const bitmap = await createImageBitmap(file);

  try {
    const regions = createScanRegions(bitmap.width, bitmap.height);

    for (const region of regions) {
      const regionImageUrl = createRegionDataUrl(bitmap, region, false);
      const regionOutput = await classifier(regionImageUrl, labels, {
        hypothesis_template: "This image crop contains {}."
      });

      for (const prediction of regionOutput) {
        collectVisualPrediction(bestByLabel, prediction, region, region.label, bitmap);
      }
    }
  } finally {
    bitmap.close();
  }

  return Array.from(bestByLabel.values())
    .filter((prediction) => prediction.score >= visualDisplayThreshold)
    .sort((first, second) => second.score - first.score)
    .slice(0, 5);
}

function collectVisualPrediction(
  bestByLabel: Map<string, VisualPrediction>,
  rawPrediction: { label: string; score: number },
  region: VisualRegion | null,
  regionLabel: string,
  bitmap?: ImageBitmap
) {
  const target = visualScanTargets.find((scanTarget) => scanTarget.modelLabel === rawPrediction.label);

  if (!target || rawPrediction.score < visualDisplayThreshold) {
    return;
  }

  const current = bestByLabel.get(rawPrediction.label);

  if (current && current.score >= rawPrediction.score) {
    return;
  }

  bestByLabel.set(rawPrediction.label, {
    clipUrl: region && bitmap ? createRegionDataUrl(bitmap, region, true) : null,
    displayName: target.displayName,
    label: rawPrediction.label,
    regionLabel,
    ruleText: target.reportText,
    score: rawPrediction.score
  });
}

function createScanRegions(width: number, height: number): VisualRegion[] {
  const columns = width >= 900 ? 4 : 3;
  const rows = height > width * 1.25 ? 6 : 4;
  const regions: VisualRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round((column * width) / columns);
      const y = Math.round((row * height) / rows);
      const nextX = Math.round(((column + 1) * width) / columns);
      const nextY = Math.round(((row + 1) * height) / rows);

      regions.push({
        x,
        y,
        width: nextX - x,
        height: nextY - y,
        label: `approximate region ${row + 1}-${column + 1}`
      });
    }
  }

  return regions;
}

function createRegionDataUrl(bitmap: ImageBitmap, region: VisualRegion, annotate: boolean): string {
  const maxWidth = annotate ? 320 : 224;
  const scale = Math.min(maxWidth / region.width, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    return "";
  }

  context.drawImage(
    bitmap,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  if (annotate) {
    const inset = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.06));
    context.lineWidth = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.025));
    context.strokeStyle = "#dc2626";
    context.beginPath();
    context.roundRect(
      inset,
      inset,
      canvas.width - inset * 2,
      canvas.height - inset * 2,
      Math.max(12, inset)
    );
    context.stroke();
  }

  return canvas.toDataURL("image/jpeg", annotate ? 0.86 : 0.78);
}

function getAnalysisStatus({
  hasScreenshots,
  hasEvidenceInput,
  isBusy,
  needsAnalysis,
  activeReport
}: {
  hasScreenshots: boolean;
  hasEvidenceInput: boolean;
  isBusy: boolean;
  needsAnalysis: boolean;
  activeReport: ReviewReport | null;
}) {
  if (isBusy) {
    return {
      icon: Loader2,
      tone: "working",
      title: "Processing",
      detail: "OCR or local visual scanning is in progress. Analysis comes next."
    };
  }

  if (!hasScreenshots) {
    return {
      icon: UploadCloud,
      tone: "idle",
      title: "Waiting for screenshots",
      detail: "Upload screenshots to start the local review workflow."
    };
  }

  if (!hasEvidenceInput) {
    return {
      icon: ScanText,
      tone: "idle",
      title: "Evidence not ready",
      detail: "Run OCR or the local visual scan before analyzing."
    };
  }

  if (needsAnalysis) {
    return {
      icon: ClipboardCheck,
      tone: "ready",
      title: "Ready to analyze",
      detail: "Click Analyze evidence to scan OCR text and visual suggestions against the rules."
    };
  }

  return {
    icon: CheckCircle2,
    tone: "complete",
    title: "Report ready",
    detail: `${activeReport?.itemCount ?? 0} possible signal${activeReport?.itemCount === 1 ? "" : "s"} flagged for human review.`
  };
}

function getWorkflowStep({
  activeReport,
  canAnalyze,
  canRunOcr,
  canRunVisualScan,
  hasEvidenceInput,
  isScanning,
  isVisualScanning,
  needsAnalysis,
  screenshots
}: {
  activeReport: ReviewReport | null;
  canAnalyze: boolean;
  canRunOcr: boolean;
  canRunVisualScan: boolean;
  hasEvidenceInput: boolean;
  isScanning: boolean;
  isVisualScanning: boolean;
  needsAnalysis: boolean;
  screenshots: UploadedScreenshot[];
}): WorkflowStep {
  if (isScanning) {
    return {
      action: "ocr",
      buttonLabel: "Extracting OCR",
      detail: "Text extraction is running. The OCR field will fill in when this finishes.",
      isDisabled: true,
      title: "OCR in progress",
      tone: "working"
    };
  }

  if (isVisualScanning) {
    return {
      action: "visual",
      buttonLabel: "Scanning visuals",
      detail: "The local visual model is checking the screenshot for possible symbols.",
      isDisabled: true,
      title: "Visual scan in progress",
      tone: "working"
    };
  }

  if (screenshots.length === 0) {
    return {
      action: "upload",
      buttonLabel: "Upload first",
      detail: "Drop a screenshot or use the upload box. Nothing is submitted to a server.",
      isDisabled: true,
      title: "Upload a screenshot",
      tone: "idle"
    };
  }

  if (screenshots.some((screenshot) => screenshot.ocrStatus === "queued")) {
    return {
      action: "ocr",
      buttonLabel: "Extract OCR",
      detail: "Image received. Press Extract OCR to pull readable text from the screenshot.",
      isDisabled: !canRunOcr,
      title: "Extract screenshot text",
      tone: "ready"
    };
  }

  if (
    screenshots.some(
      (screenshot) =>
        screenshot.file &&
        (screenshot.visualScanStatus === "not_started" || screenshot.visualScanStatus === "error")
    )
  ) {
    return {
      action: "visual",
      buttonLabel: "Scan visuals",
      detail: "OCR is done. Press Scan visuals so the app can suggest possible symbols, flags, gestures, or tattoos.",
      isDisabled: !canRunVisualScan,
      title: "Run visual analysis",
      tone: "ready"
    };
  }

  if (needsAnalysis || (hasEvidenceInput && !activeReport)) {
    return {
      action: "analyze",
      buttonLabel: "Analyze evidence",
      detail: "OCR and visual scan results are ready. Generate the human-review report on the right.",
      isDisabled: !canAnalyze,
      title: "Generate the report",
      tone: "ready"
    };
  }

  if (!hasEvidenceInput) {
    return {
      action: "done",
      buttonLabel: "No evidence yet",
      detail:
        "OCR returned no usable text and the visual scan has no reportable suggestions. Add notes, re-upload, or try another screenshot.",
      isDisabled: true,
      title: "Nothing to analyze yet",
      tone: "idle"
    };
  }

  return {
    action: "done",
    buttonLabel: "Report ready",
    detail: "Review the Evidence report panel on the right. Export when you are ready.",
    isDisabled: true,
    title: "Report ready",
    tone: "complete"
  };
}

function revokePreview(previewUrl: string | null) {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
}

function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatEvidenceType(evidenceType: "ocr_text" | "visual_observation"): string {
  return evidenceType === "visual_observation" ? "visual observation" : "OCR text";
}

function formatVisualScore(score: number): string {
  const percent = Math.round(score * 100);
  const band = score >= visualReportThreshold ? "report confidence" : "low confidence";
  return `${percent}% ${band}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
