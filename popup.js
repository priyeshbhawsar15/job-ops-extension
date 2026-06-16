(function () {
  "use strict";

  const state = {
    tab: null,
    extraction: null,
    draft: null,
    inferenceFailed: false,
    rule: null
  };

  const FIELD_CONFIG = [
    ["title", "Title", false],
    ["employer", "Employer", false],
    ["location", "Location", false],
    ["jobUrl", "Job URL", false],
    ["salary", "Salary", false],
    ["deadline", "Deadline", false],
    ["jobType", "Job type", false],
    ["jobLevel", "Job level", false],
    ["jobFunction", "Job function", false],
    ["disciplines", "Disciplines", false],
    ["degreeRequired", "Degree required", false],
    ["starting", "Starting", false],
    ["applicationLink", "Application URL", false],
    ["jobDescription", "Description", true]
  ];

  function $(selector) {
    return document.querySelector(selector);
  }

  function setStatus(message, kind) {
    const status = $("#status");
    status.textContent = message;
    status.className = `status ${kind || ""}`.trim();
  }

  function setHidden(selector, hidden) {
    document.querySelector(selector).classList.toggle("hidden", hidden);
  }

  function messageTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: { message: chrome.runtime.lastError.message } });
          return;
        }
        resolve(response);
      });
    });
  }

  function messageRuntime(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response));
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFields(draft) {
    $("#fields").innerHTML = FIELD_CONFIG.map(([key, label, multiline]) => {
      const wide = multiline || key === "jobUrl" || key === "applicationLink";
      const value = escapeHtml(draft[key] || "");
      return `
        <label class="${wide ? "wide" : ""}">
          ${label}
          ${
            multiline
              ? `<textarea data-key="${key}" rows="8">${value}</textarea>`
              : `<input data-key="${key}" value="${value}">`
          }
        </label>
      `;
    }).join("");
  }

  function collectDraft() {
    const next = { ...state.draft };
    document.querySelectorAll("[data-key]").forEach((input) => {
      next[input.dataset.key] = input.value.trim();
    });
    return next;
  }

  async function runInference() {
    if (!state.extraction) return;
    setStatus("Running JobOps inference...", "");
    $("#import").disabled = true;
    const response = await messageRuntime({
      type: "JOBOPS_INFER",
      jobDescription: state.extraction.draft.jobDescription
    });
    $("#import").disabled = false;
    if (!response || !response.ok) {
      state.inferenceFailed = true;
      state.draft = state.extraction.draft;
      renderFields(state.draft);
      setStatus(
        `${response?.error?.message || "Inference failed."} You can review and import extracted fields anyway.`,
        "warning"
      );
      return;
    }
    state.inferenceFailed = false;
    state.draft = JobOpsExtractor.mergeInferredJob(
      state.extraction.draft,
      response.data.job || {}
    );
    renderFields(state.draft);
    setStatus(
      response.data.warning || "Inference complete. Review before importing.",
      response.data.warning ? "warning" : "success"
    );
  }

  async function importDraft() {
    const job = JobOpsExtractor.toImportPayload(collectDraft());
    for (const key of ["title", "employer", "jobUrl", "jobDescription"]) {
      if (!job[key]) {
        setStatus(`${key} is required before import.`, "error");
        return;
      }
    }

    $("#import").disabled = true;
    setStatus(
      state.inferenceFailed
        ? "Importing with extracted fields after failed inference..."
        : "Importing to JobOps...",
      ""
    );
    const response = await messageRuntime({
      type: "JOBOPS_IMPORT",
      job,
      tailorAutomatically: $("#tailor").checked
    });
    $("#import").disabled = false;
    if (response && response.ok) {
      setStatus("Saved. JobOps is processing this job.", "success");
      return;
    }
    const error = response && response.error;
    if (error && error.status === 409) {
      setStatus("Already saved in your JobOps workspace.", "success");
      return;
    }
    setStatus(error?.message || "Import failed.", "error");
  }

  async function saveDomainRule() {
    if (!state.extraction) return;
    const mode = $("#domain-mode").value;
    if (
      mode === "autoimport" &&
      state.rule &&
      state.rule.mode !== "autoimport" &&
      !confirm("Enable auto-import for this domain? This will send detected jobs to JobOps without review.")
    ) {
      $("#domain-mode").value = state.rule.mode;
      return;
    }
    await JobOpsSettings.setDomainRule(state.extraction.hostname, {
      mode,
      tailorAutomatically: $("#domain-tailor").checked
    });
    state.rule = await JobOpsSettings.getDomainRule(state.extraction.hostname);
    setStatus("Domain rule saved.", "success");
  }

  async function init() {
    $("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("#open-options-auth").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("#import").addEventListener("click", importDraft);
    $("#retry-infer").addEventListener("click", runInference);
    $("#show-overlay").addEventListener("click", async () => {
      if (!state.tab) return;
      await messageTab(state.tab.id, { type: "JOBOPS_SHOW_OVERLAY" });
      window.close();
    });
    $("#domain-mode").addEventListener("change", saveDomainRule);
    $("#domain-tailor").addEventListener("change", saveDomainRule);

    const settings = await JobOpsSettings.getSettings();
    if (!JobOpsSettings.isTokenPresent(settings)) {
      setHidden("#auth-panel", false);
      setStatus("Sign in before importing jobs.", "warning");
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tabs[0];
    if (!state.tab || !/^https?:\/\//i.test(state.tab.url || "")) {
      setStatus("Open an http or https job page first.", "warning");
      return;
    }

    const url = new URL(state.tab.url);
    $("#page-host").textContent = url.hostname;
    const response = await messageTab(state.tab.id, { type: "JOBOPS_GET_EXTRACTION" });
    if (!response || !response.ok) {
      setStatus("This page is not available to the extension yet. Refresh it and try again.", "error");
      return;
    }
    state.extraction = response.data;
    state.rule = await JobOpsSettings.getDomainRule(state.extraction.hostname);
    $("#confidence").textContent = `${state.extraction.confidence}% confidence`;
    $("#domain-mode").value = state.rule.mode;
    $("#domain-tailor").checked = state.rule.tailorAutomatically;
    $("#tailor").checked = state.rule.tailorAutomatically;
    setHidden("#domain-panel", false);
    setHidden("#review-panel", false);
    state.draft = state.extraction.draft;
    renderFields(state.draft);

    if (!JobOpsSettings.isTokenPresent(settings)) return;
    await runInference();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => setStatus(error.message || String(error), "error"));
  });
})();
