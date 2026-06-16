(function (global) {
  "use strict";

  function buildUrl(baseUrl, path) {
    return `${JobOpsSettings.normalizeBaseUrl(baseUrl)}${path}`;
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`JobOps returned a non-JSON response (${response.status}).`);
    }
  }

  function getApiErrorMessage(body, response) {
    if (body && body.error && body.error.message) return body.error.message;
    if (body && body.message) return body.message;
    return `JobOps request failed with HTTP ${response.status}.`;
  }

  async function request(path, options = {}) {
    const settings = await JobOpsSettings.getSettings();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    if (options.auth !== false) {
      if (!settings.token) {
        const error = new Error("Sign in to JobOps before importing jobs.");
        error.code = "AUTH_REQUIRED";
        throw error;
      }
      headers.Authorization = `Bearer ${settings.token}`;
    }

    const response = await fetch(buildUrl(settings.baseUrl, path), {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const body = await parseJsonResponse(response);
    if (!response.ok || body.ok === false) {
      const error = new Error(getApiErrorMessage(body, response));
      error.status = response.status;
      error.code = body && body.error ? body.error.code : undefined;
      error.body = body;
      throw error;
    }
    return body.data === undefined ? body : body.data;
  }

  async function login({ baseUrl, username, password }) {
    const response = await fetch(
      buildUrl(baseUrl, "/api/auth/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      }
    );
    const body = await parseJsonResponse(response);
    if (!response.ok || body.ok === false) {
      const error = new Error(getApiErrorMessage(body, response));
      error.status = response.status;
      throw error;
    }
    const data = body.data || {};
    if (!data.token) throw new Error("JobOps did not return a login token.");
    const expiresAt =
      typeof data.expiresIn === "number"
        ? Date.now() + data.expiresIn * 1000
        : null;
    await JobOpsSettings.saveSettings({
      baseUrl,
      username,
      token: data.token,
      tokenExpiresAt: expiresAt
    });
    return data;
  }

  async function logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch {
      // Local logout should still clear stale or invalid tokens.
    }
    await JobOpsSettings.saveSettings({ token: null, tokenExpiresAt: null });
  }

  async function getMe() {
    return request("/api/auth/me");
  }

  async function inferJob(jobDescription) {
    return request("/api/manual-jobs/infer", {
      method: "POST",
      body: { jobDescription }
    });
  }

  async function importJob(job, options = {}) {
    return request("/api/manual-jobs/import", {
      method: "POST",
      body: {
        skipTailoring: options.tailorAutomatically === false,
        job
      }
    });
  }

  global.JobOpsApi = {
    request,
    login,
    logout,
    getMe,
    inferJob,
    importJob
  };
})(globalThis);
