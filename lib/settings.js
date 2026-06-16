(function (global) {
  "use strict";

  const DEFAULT_SETTINGS = {
    baseUrl: "http://192.168.2.201:3005",
    username: "priyesh",
    token: null,
    tokenExpiresAt: null,
    defaultDomainMode: "default",
    defaultTailorAutomatically: true,
    domainRules: {}
  };

  const DOMAIN_MODES = ["default", "autoprompt", "autoimport"];

  function normalizeBaseUrl(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/, "");
    return trimmed || DEFAULT_SETTINGS.baseUrl;
  }

  function normalizeHostname(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function normalizeMode(value) {
    return DOMAIN_MODES.includes(value) ? value : "default";
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      username: String(stored.username || ""),
      domainRules:
        stored.domainRules && typeof stored.domainRules === "object"
          ? stored.domainRules
          : {}
    };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = {
      ...current,
      ...patch
    };
    next.baseUrl = normalizeBaseUrl(next.baseUrl);
    if (!DOMAIN_MODES.includes(next.defaultDomainMode)) {
      next.defaultDomainMode = "default";
    }
    await chrome.storage.local.set(next);
    return next;
  }

  async function getDomainRule(hostname) {
    const settings = await getSettings();
    const host = normalizeHostname(hostname);
    const rule = settings.domainRules[host] || {};
    return {
      hostname: host,
      mode: normalizeMode(rule.mode || settings.defaultDomainMode),
      tailorAutomatically:
        typeof rule.tailorAutomatically === "boolean"
          ? rule.tailorAutomatically
          : settings.defaultTailorAutomatically
    };
  }

  async function setDomainRule(hostname, rulePatch) {
    const settings = await getSettings();
    const host = normalizeHostname(hostname);
    if (!host) return settings;
    const currentRule = settings.domainRules[host] || {};
    const nextRule = {
      ...currentRule,
      ...rulePatch
    };
    nextRule.mode = normalizeMode(nextRule.mode);
    if (typeof nextRule.tailorAutomatically !== "boolean") {
      nextRule.tailorAutomatically = settings.defaultTailorAutomatically;
    }
    const nextDomainRules = {
      ...settings.domainRules,
      [host]: nextRule
    };
    return saveSettings({ domainRules: nextDomainRules });
  }

  async function removeDomainRule(hostname) {
    const settings = await getSettings();
    const host = normalizeHostname(hostname);
    const nextDomainRules = { ...settings.domainRules };
    delete nextDomainRules[host];
    return saveSettings({ domainRules: nextDomainRules });
  }

  function isTokenPresent(settings) {
    return Boolean(settings && settings.token);
  }

  global.JobOpsSettings = {
    DEFAULT_SETTINGS,
    DOMAIN_MODES,
    getSettings,
    saveSettings,
    getDomainRule,
    setDomainRule,
    removeDomainRule,
    normalizeBaseUrl,
    normalizeHostname,
    normalizeMode,
    isTokenPresent
  };
})(globalThis);
