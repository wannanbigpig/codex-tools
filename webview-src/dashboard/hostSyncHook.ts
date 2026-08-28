import { useEffect, useRef } from "preact/hooks";
import type { DashboardHostMessage } from "../../src/domain/dashboard/types";
import { postMessageToHost } from "./host";

export function useDashboardHostSync(params: {
  handleHostMessage: (message: DashboardHostMessage) => void;
  handleEscape: () => boolean;
}) {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    const onMessage = (event: MessageEvent<DashboardHostMessage>) => {
      if (event.data) {
        paramsRef.current.handleHostMessage(event.data);
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        paramsRef.current.handleEscape();
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeydown);
    postMessageToHost({ type: "dashboard:ready" });

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeydown);
    };
  }, []);
}
