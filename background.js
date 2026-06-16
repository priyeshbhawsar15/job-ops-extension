importScripts("lib/settings.js", "lib/api.js");

async function withErrorEnvelope(work) {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        status: error && error.status,
        code: error && error.code
      }
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;

  if (type === "JOBOPS_SET_BADGE") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId !== undefined) {
      chrome.action.setBadgeText({ tabId, text: message.text || "" });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (type === "JOBOPS_INFER") {
    withErrorEnvelope(() => JobOpsApi.inferJob(message.jobDescription)).then(
      sendResponse
    );
    return true;
  }

  if (type === "JOBOPS_IMPORT") {
    withErrorEnvelope(() =>
      JobOpsApi.importJob(message.job, {
        tailorAutomatically: message.tailorAutomatically !== false
      })
    ).then(sendResponse);
    return true;
  }

  return false;
});
