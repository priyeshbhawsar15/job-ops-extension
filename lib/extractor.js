(function (global) {
  "use strict";

  const DESCRIPTION_LIMIT = 39500;
  const TEXT_BLOCK_SELECTOR =
    "main, article, [role='main'], .job-description, .job-details, .job-content, #job-description, #job-details, [class*='job-desc'], [class*='jobDesc'], [class*='posting'], [class*='vacancy']";

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function firstNonEmpty(values) {
    for (const value of values) {
      const cleaned = text(value);
      if (cleaned) return cleaned;
    }
    return "";
  }

  function getMeta(document, selector) {
    return document.querySelector(selector)?.getAttribute("content") || "";
  }

  function stripTitleNoise(value) {
    return text(value)
      .replace(/\s+\|\s+.*$/g, "")
      .replace(/\s+-\s+(careers|jobs|job details|apply now).*$/gi, "")
      .slice(0, 500);
  }

  function htmlToText(html) {
    const holder = document.createElement("div");
    holder.innerHTML = String(html || "");
    return cleanWhitespace(holder.textContent || "");
  }

  function cleanWhitespace(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findJobPosting(input, seen = new Set()) {
    if (!input || typeof input !== "object" || seen.has(input)) return null;
    seen.add(input);

    const type = input["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((item) => String(item).toLowerCase() === "jobposting")) {
      return input;
    }

    for (const value of Object.values(input)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          const found = findJobPosting(child, seen);
          if (found) return found;
        }
      } else if (value && typeof value === "object") {
        const found = findJobPosting(value, seen);
        if (found) return found;
      }
    }
    return null;
  }

  function parseJsonLd(document) {
    const scripts = [...document.querySelectorAll("script[type='application/ld+json']")];
    for (const script of scripts) {
      const raw = script.textContent;
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const found = findJobPosting(parsed);
        if (found) return found;
      } catch {
        // Ignore malformed page-owned JSON-LD.
      }
    }
    return null;
  }

  function getOrganizationName(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return getOrganizationName(value[0]);
    return value.name || value.legalName || "";
  }

  function getLocationName(value) {
    if (!value) return "";
    const item = Array.isArray(value) ? value[0] : value;
    if (typeof item === "string") return item;
    const address = item.address || item;
    if (typeof address === "string") return address;
    return firstNonEmpty([
      address.addressLocality,
      [address.addressLocality, address.addressRegion, address.addressCountry]
        .filter(Boolean)
        .join(", "),
      item.name
    ]);
  }

  function getSalary(value) {
    if (!value) return "";
    const item = Array.isArray(value) ? value[0] : value;
    if (typeof item === "string" || typeof item === "number") return String(item);
    const amount = item.value || item;
    if (typeof amount === "string" || typeof amount === "number") {
      return [item.currency, amount].filter(Boolean).join(" ");
    }
    const min = amount.minValue;
    const max = amount.maxValue;
    const unit = amount.unitText || item.unitText || "";
    const range = min && max ? `${min}-${max}` : min || max || "";
    return [item.currency, range, unit].filter(Boolean).join(" ");
  }

  function canonicalUrl(document, pageUrl) {
    const href =
      document.querySelector("link[rel='canonical']")?.getAttribute("href") ||
      getMeta(document, "meta[property='og:url']") ||
      pageUrl;
    try {
      const url = new URL(href, pageUrl);
      url.hash = "";
      return url.toString();
    } catch {
      return pageUrl;
    }
  }

  function sourceFromUrl(pageUrl) {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    const safeHost = hostname.replace(/[^a-z0-9-]/gi, "-").slice(0, 100);
    return `extension:${safeHost}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getVisibleJobText(document) {
    const clone = document.cloneNode(true);
    clone
      .querySelectorAll(
        "script, style, nav, header, footer, aside, iframe, noscript, svg, canvas, form, button, input, select, textarea, [hidden], [aria-hidden='true']"
      )
      .forEach((element) => element.remove());

    const main = clone.querySelector(TEXT_BLOCK_SELECTOR) || clone.body;
    let content = cleanWhitespace(main?.textContent || "");
    if (content.length < 800 && clone.body) {
      content = cleanWhitespace(clone.body.textContent || "");
    }
    return content.slice(0, DESCRIPTION_LIMIT);
  }

  function calculateConfidence({ schema, pageUrl, title, description }) {
    const lowerUrl = pageUrl.toLowerCase();
    const lowerText = `${title}\n${description.slice(0, 5000)}`.toLowerCase();
    let score = 0;
    if (schema) score += 55;
    if (/(^|[/-])(job|jobs|careers|positions?|vacancies|apply)([/-]|$)/i.test(lowerUrl)) {
      score += 20;
    }
    for (const signal of ["apply", "job description", "responsibilities", "requirements", "qualifications"]) {
      if (lowerText.includes(signal)) score += 8;
    }
    if (title) score += 10;
    return Math.min(score, 100);
  }

  function extractFromDocument(document, pageUrl) {
    const schema = parseJsonLd(document);
    const url = canonicalUrl(document, pageUrl);
    const descriptionFromSchema = schema?.description
      ? htmlToText(schema.description)
      : "";
    const pageDescription = getVisibleJobText(document);
    const jobDescription = (descriptionFromSchema || pageDescription).slice(
      0,
      DESCRIPTION_LIMIT
    );
    const title = stripTitleNoise(
      firstNonEmpty([
        schema?.title,
        schema?.name,
        getMeta(document, "meta[property='og:title']"),
        document.querySelector("h1")?.textContent,
        document.title
      ])
    );
    const employer = firstNonEmpty([
      getOrganizationName(schema?.hiringOrganization),
      getMeta(document, "meta[property='og:site_name']"),
      document.querySelector("[data-company], .company, .employer")?.textContent
    ]).slice(0, 500);
    const location = getLocationName(schema?.jobLocation).slice(0, 200);
    const salary = getSalary(schema?.baseSalary).slice(0, 200);
    const deadline = text(schema?.validThrough).slice(0, 100);
    const applicationLink = firstNonEmpty([
      schema?.url,
      document.querySelector("a[href*='apply' i]")?.href,
      url
    ]);

    const draft = {
      source: sourceFromUrl(url),
      sourceJobId: `url-${hashString(url)}`,
      title,
      employer,
      jobUrl: url,
      applicationLink,
      location,
      salary,
      deadline,
      jobDescription,
      jobType: text(schema?.employmentType).slice(0, 200),
      jobLevel: "",
      jobFunction: "",
      disciplines: "",
      degreeRequired: "",
      starting: ""
    };
    return {
      draft,
      confidence: calculateConfidence({ schema, pageUrl: url, title, description: jobDescription }),
      hasSchema: Boolean(schema),
      url,
      hostname: new URL(url).hostname.toLowerCase(),
      extractedAt: new Date().toISOString()
    };
  }

  function mergeInferredJob(localDraft, inferredJob) {
    const inferred = inferredJob || {};
    const merged = { ...localDraft };
    for (const key of [
      "title",
      "employer",
      "location",
      "salary",
      "deadline",
      "jobType",
      "jobLevel",
      "jobFunction",
      "disciplines",
      "degreeRequired",
      "starting",
      "applicationLink"
    ]) {
      if (text(inferred[key])) merged[key] = text(inferred[key]);
    }
    merged.source = localDraft.source;
    merged.sourceJobId = localDraft.sourceJobId;
    merged.jobUrl = localDraft.jobUrl;
    merged.jobDescription = localDraft.jobDescription;
    return merged;
  }

  function isValidUrl(value) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  function toImportPayload(draft) {
    const payload = {
      title: text(draft.title),
      employer: text(draft.employer),
      jobUrl: text(draft.jobUrl),
      jobDescription: String(draft.jobDescription || "").trim()
    };
    for (const key of [
      "source",
      "sourceJobId",
      "location",
      "salary",
      "deadline",
      "jobType",
      "jobLevel",
      "jobFunction",
      "disciplines",
      "degreeRequired",
      "starting"
    ]) {
      const value = text(draft[key]);
      if (value) payload[key] = value;
    }
    const applicationLink = text(draft.applicationLink);
    if (applicationLink && isValidUrl(applicationLink)) {
      payload.applicationLink = applicationLink;
    }
    return payload;
  }

  global.JobOpsExtractor = {
    DESCRIPTION_LIMIT,
    extractFromDocument,
    mergeInferredJob,
    toImportPayload,
    cleanWhitespace
  };
})(globalThis);
