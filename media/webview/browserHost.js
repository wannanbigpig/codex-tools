(() => {
  const dispatch = (message) => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  };

  const parseJsonResponse = async (response, label) => {
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error(`${label} returned an invalid response. Reload the dashboard and sign in again.`);
    }
    return response.json();
  };

  const loadSnapshot = async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.status === 401) {
      window.location.reload();
      return;
    }
    if (!response.ok) {
      throw new Error(`Dashboard refresh failed (${response.status})`);
    }
    dispatch({ type: "dashboard:snapshot", state: await parseJsonResponse(response, "Dashboard refresh") });
  };

  const postMessage = async (message) => {
    try {
      if (message?.type === "dashboard:ready") {
        await loadSnapshot();
        return;
      }
      const response = await fetch("/api/message", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Codex-Dashboard": "1"
        },
        body: JSON.stringify(message)
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) {
        throw new Error(`Dashboard action failed (${response.status})`);
      }
      const payload = await parseJsonResponse(response, "Dashboard action");
      if (!Array.isArray(payload.messages)) {
        throw new Error("Dashboard action returned no result. Reload the dashboard and try again.");
      }
      payload.messages.forEach(dispatch);
    } catch (error) {
      console.error("[codex-accounts-manager] browser dashboard bridge", error);
      const detail = error instanceof Error ? error.message : "The dashboard action failed. Please try again.";
      if (message?.type === "dashboard:action") {
        dispatch({
          type: "dashboard:action-result",
          requestId: message.requestId,
          action: message.action,
          accountId: message.accountId,
          status: "failed",
          error: detail
        });
      }
      dispatch({
        type: "dashboard:notice",
        level: "error",
        message: detail
      });
    }
  };

  window.acquireVsCodeApi = () => ({
    postMessage,
    getState: () => undefined,
    setState: () => undefined
  });

  window.setInterval(() => {
    void loadSnapshot().catch((error) => {
      console.error("[codex-accounts-manager] browser dashboard refresh", error);
      dispatch({
        type: "dashboard:notice",
        level: "warning",
        message: error instanceof Error ? error.message : "The dashboard could not refresh."
      });
    });
  }, 10_000);
})();
