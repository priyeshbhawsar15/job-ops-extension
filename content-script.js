(function () {
  "use strict";

  if (window.top !== window) return;

  const OVERLAY_ID = "jobops-clipper-overlay";
  let latestExtraction = null;

  function chromeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response));
    });
  }

  function getCurrentExtraction() {
    latestExtraction = JobOpsExtractor.extractFromDocument(document, location.href);
    return latestExtraction;
  }

  function setStatus(root, message, kind) {
    const status = root.querySelector("[data-jobops-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind || "info";
  }

  function field(label, key, value, multiline) {
    const id = `jobops-${key}`;
    return `
      <label class="jobops-field" for="${id}">
        <span>${label}</span>
        ${
          multiline
            ? `<textarea id="${id}" data-key="${key}" rows="8">${escapeHtml(value)}</textarea>`
            : `<input id="${id}" data-key="${key}" value="${escapeHtml(value)}">`
        }
      </label>
    `;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function collectDraft(root, draft) {
    const next = { ...draft };
    root.querySelectorAll("[data-key]").forEach((input) => {
      next[input.dataset.key] = input.value.trim();
    });
    return next;
  }

  function renderForm(root, draft, rule, inferenceWarning) {
    root.querySelector(".jobops-body").innerHTML = `
      <div class="jobops-grid">
        ${field("Title", "title", draft.title)}
        ${field("Employer", "employer", draft.employer)}
        ${field("Location", "location", draft.location)}
        ${field("Job URL", "jobUrl", draft.jobUrl)}
        ${field("Description", "jobDescription", draft.jobDescription, true)}
      </div>
      <label class="jobops-check">
        <input type="checkbox" data-tailor ${rule.tailorAutomatically ? "checked" : ""}>
        <span>Tailor and score automatically after import</span>
      </label>
      ${inferenceWarning ? `<p class="jobops-warning">${escapeHtml(inferenceWarning)}</p>` : ""}
      <div class="jobops-actions">
        <button type="button" data-action="import">Import</button>
        <button type="button" data-action="auto-prompt">Auto-prompt here</button>
        <button type="button" data-action="close" class="secondary">Close</button>
      </div>
    `;

    root.querySelector("[data-action='import']").addEventListener("click", async () => {
      setStatus(root, "Importing to JobOps...", "info");
      const job = JobOpsExtractor.toImportPayload(collectDraft(root, draft));
      const tailorAutomatically = root.querySelector("[data-tailor]").checked;
      const response = await chromeMessage({
        type: "JOBOPS_IMPORT",
        job,
        tailorAutomatically
      });
      if (response && response.ok) {
        setStatus(root, "Saved. JobOps is processing this job.", "success");
        return;
      }
      const error = response && response.error;
      if (error && error.status === 409) {
        setStatus(root, "Already saved in your JobOps workspace.", "success");
        return;
      }
      setStatus(root, error?.message || "Import failed.", "error");
    });

    root.querySelector("[data-action='auto-prompt']").addEventListener("click", async () => {
      await JobOpsSettings.setDomainRule(location.hostname, {
        mode: "autoprompt",
        tailorAutomatically: root.querySelector("[data-tailor]").checked
      });
      setStatus(root, "This domain will auto-prompt next time.", "success");
    });
    root.querySelector("[data-action='close']").addEventListener("click", () => root.remove());
  }

  async function inferDraft(extraction) {
    const response = await chromeMessage({
      type: "JOBOPS_INFER",
      jobDescription: extraction.draft.jobDescription
    });
    if (!response || !response.ok) {
      const error = response && response.error;
      throw new Error(error?.message || "Inference failed.");
    }
    return {
      draft: JobOpsExtractor.mergeInferredJob(
        extraction.draft,
        response.data.job || {}
      ),
      warning: response.data.warning || null
    };
  }

  async function showOverlay(extraction, options = {}) {
    document.getElementById(OVERLAY_ID)?.remove();
    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.innerHTML = `
      <style>
        #${OVERLAY_ID}{position:fixed;z-index:2147483647;right:20px;top:20px;width:min(460px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;box-shadow:0 20px 50px rgba(0,0,0,.35);font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
        #${OVERLAY_ID} *{box-sizing:border-box}
        #${OVERLAY_ID} .jobops-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #374151}
        #${OVERLAY_ID} .jobops-title{font-weight:700}
        #${OVERLAY_ID} .jobops-close{border:0;background:transparent;color:#f9fafb;font-size:22px;cursor:pointer}
        #${OVERLAY_ID} .jobops-body{padding:14px 16px}
        #${OVERLAY_ID} .jobops-grid{display:grid;gap:10px}
        #${OVERLAY_ID} .jobops-field span{display:block;margin-bottom:4px;color:#d1d5db;font-size:12px}
        #${OVERLAY_ID} input,#${OVERLAY_ID} textarea{width:100%;border:1px solid #4b5563;border-radius:6px;background:#030712;color:#f9fafb;padding:8px;font:13px system-ui,-apple-system,Segoe UI,sans-serif}
        #${OVERLAY_ID} textarea{resize:vertical}
        #${OVERLAY_ID} .jobops-check{display:flex;gap:8px;align-items:center;margin:12px 0;color:#d1d5db}
        #${OVERLAY_ID} .jobops-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        #${OVERLAY_ID} button{border:1px solid #2563eb;background:#2563eb;color:white;border-radius:6px;padding:8px 10px;cursor:pointer;font-weight:600}
        #${OVERLAY_ID} button.secondary{border-color:#4b5563;background:#1f2937}
        #${OVERLAY_ID} [data-jobops-status]{margin:0;padding:10px 16px;border-top:1px solid #374151;color:#d1d5db}
        #${OVERLAY_ID} [data-kind='success']{color:#86efac}
        #${OVERLAY_ID} [data-kind='error']{color:#fca5a5}
        #${OVERLAY_ID} .jobops-warning{color:#fde68a;margin:8px 0 0}
      </style>
      <div class="jobops-head">
        <div class="jobops-title">Save to JobOps</div>
        <button class="jobops-close" type="button" aria-label="Close">x</button>
      </div>
      <div class="jobops-body">Running JobOps inference...</div>
      <p data-jobops-status data-kind="info">Detected job confidence: ${extraction.confidence}%</p>
    `;
    document.documentElement.appendChild(root);
    root.querySelector(".jobops-close").addEventListener("click", () => root.remove());

    const rule = await JobOpsSettings.getDomainRule(location.hostname);
    try {
      const inferred = await inferDraft(extraction);
      if (options.autoImport) {
        setStatus(root, "Importing to JobOps...", "info");
        const response = await chromeMessage({
          type: "JOBOPS_IMPORT",
          job: JobOpsExtractor.toImportPayload(inferred.draft),
          tailorAutomatically: rule.tailorAutomatically
        });
        if (response && response.ok) {
          root.querySelector(".jobops-body").textContent =
            "Saved. JobOps is processing this job.";
          setStatus(root, "Import complete.", "success");
          return;
        }
        const error = response && response.error;
        if (error && error.status === 409) {
          root.querySelector(".jobops-body").textContent =
            "Already saved in your JobOps workspace.";
          setStatus(root, "No duplicate was created.", "success");
          return;
        }
        throw new Error(error?.message || "Import failed.");
      }
      renderForm(root, inferred.draft, rule, inferred.warning);
      setStatus(root, "Review inferred fields, then import.", "info");
    } catch (error) {
      root.querySelector(".jobops-body").innerHTML = `
        <p>${escapeHtml(error.message)}</p>
        <p>Automatic import was stopped. You can still import manually from the extension popup.</p>
      `;
      setStatus(root, "Inference or import failed.", "error");
    }
  }

  async function init() {
    const extraction = getCurrentExtraction();
    if (extraction.confidence >= 55) {
      chrome.runtime.sendMessage({ type: "JOBOPS_SET_BADGE", text: "JOB" });
    }
    const rule = await JobOpsSettings.getDomainRule(extraction.hostname);
    const onceKey = `jobops:${rule.mode}:${extraction.url}`;
    if (sessionStorage.getItem(onceKey)) return;
    if (extraction.confidence < 55) return;
    if (rule.mode === "autoprompt") {
      sessionStorage.setItem(onceKey, "1");
      await showOverlay(extraction);
    }
    if (rule.mode === "autoimport") {
      sessionStorage.setItem(onceKey, "1");
      await showOverlay(extraction, { autoImport: true });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "JOBOPS_GET_EXTRACTION") {
      sendResponse({ ok: true, data: getCurrentExtraction() });
      return false;
    }
    if (message && message.type === "JOBOPS_SHOW_OVERLAY") {
      showOverlay(getCurrentExtraction()).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  window.setTimeout(() => {
    init().catch(() => {
      // Content detection should never break the page.
    });
  }, 800);
})();
