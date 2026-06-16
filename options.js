(function () {
  "use strict";

  let settings = null;

  function $(selector) {
    return document.querySelector(selector);
  }

  function setStatus(message, kind) {
    const status = $("#status");
    status.textContent = message;
    status.className = `status ${kind || ""}`.trim();
  }

  function renderDomainRules() {
    const rows = Object.entries(settings.domainRules || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([host, rule]) => {
        return `
          <tr>
            <td>${host}</td>
            <td>${rule.mode || "default"}</td>
            <td>${rule.tailorAutomatically === false ? "No" : "Yes"}</td>
            <td><button class="secondary" data-remove="${host}" type="button">Remove</button></td>
          </tr>
        `;
      })
      .join("");
    $("#domain-rules").innerHTML =
      rows || `<tr><td colspan="4" class="muted">No domain rules yet.</td></tr>`;
    document.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        settings = await JobOpsSettings.removeDomainRule(button.dataset.remove);
        renderDomainRules();
        setStatus("Domain rule removed.", "success");
      });
    });
  }

  async function loadSettings() {
    settings = await JobOpsSettings.getSettings();
    $("#base-url").value = settings.baseUrl;
    $("#username").value = settings.username;
    $("#password").value = "";
    $("#default-mode").value = settings.defaultDomainMode;
    $("#default-tailor").checked = settings.defaultTailorAutomatically;
    $("#domain-tailor").checked = settings.defaultTailorAutomatically;
    renderDomainRules();
    setStatus(
      settings.token ? "Signed in token is stored locally." : "Not signed in.",
      settings.token ? "success" : "warning"
    );
  }

  async function saveConnectionPatch() {
    settings = await JobOpsSettings.saveSettings({
      baseUrl: $("#base-url").value,
      username: $("#username").value
    });
  }

  async function signIn() {
    await saveConnectionPatch();
    const password = $("#password").value;
    if (!password) {
      setStatus("Enter your JobOps password.", "error");
      return;
    }
    $("#sign-in").disabled = true;
    setStatus("Signing in...", "");
    try {
      await JobOpsApi.login({
        baseUrl: $("#base-url").value,
        username: $("#username").value,
        password
      });
      $("#password").value = "";
      await loadSettings();
      setStatus("Signed in. Password was not stored.", "success");
    } catch (error) {
      setStatus(error.message || String(error), "error");
    } finally {
      $("#sign-in").disabled = false;
    }
  }

  async function testAuth() {
    await saveConnectionPatch();
    setStatus("Checking token...", "");
    try {
      const me = await JobOpsApi.getMe();
      setStatus(`Authenticated as ${me.user?.username || "JobOps user"}.`, "success");
    } catch (error) {
      setStatus(error.message || String(error), "error");
    }
  }

  async function signOut() {
    setStatus("Signing out...", "");
    await JobOpsApi.logout();
    await loadSettings();
  }

  async function saveDefaults() {
    const nextMode = $("#default-mode").value;
    if (
      nextMode === "autoimport" &&
      settings.defaultDomainMode !== "autoimport" &&
      !confirm("Make auto-import the global default? This can import jobs without review on any detected job page.")
    ) {
      $("#default-mode").value = settings.defaultDomainMode;
      return;
    }
    settings = await JobOpsSettings.saveSettings({
      defaultDomainMode: nextMode,
      defaultTailorAutomatically: $("#default-tailor").checked
    });
    setStatus("Defaults saved.", "success");
  }

  async function addDomainRule() {
    const host = JobOpsSettings.normalizeHostname($("#domain-host").value);
    if (!host) {
      setStatus("Enter a hostname.", "error");
      return;
    }
    const mode = $("#domain-mode").value;
    if (
      mode === "autoimport" &&
      !confirm("Enable auto-import for this domain? This will send detected jobs to JobOps without review.")
    ) {
      return;
    }
    settings = await JobOpsSettings.setDomainRule(host, {
      mode,
      tailorAutomatically: $("#domain-tailor").checked
    });
    $("#domain-host").value = "";
    renderDomainRules();
    setStatus("Domain rule saved.", "success");
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#sign-in").addEventListener("click", signIn);
    $("#test-auth").addEventListener("click", testAuth);
    $("#sign-out").addEventListener("click", signOut);
    $("#default-mode").addEventListener("change", saveDefaults);
    $("#default-tailor").addEventListener("change", saveDefaults);
    $("#add-domain").addEventListener("click", addDomainRule);
    loadSettings().catch((error) => setStatus(error.message || String(error), "error"));
  });
})();
