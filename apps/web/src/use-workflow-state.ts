import { useCallback, useEffect, useState } from "react";
import { api, type WorkflowState } from "./api.js";
import { isActiveStatus } from "./workflow-model.js";

export function useWorkflowState(taskId?: string) {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      const next = await api.getWorkflowState(taskId);
      setState(next);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    async function load() {
      if (!taskId) return;
      try {
        const next = await api.getWorkflowState(taskId);
        if (!cancelled) {
          setState(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const shouldKeepPolling = state ? isActiveStatus(state.task.status) : true;

  useEffect(() => {
    if (!taskId || !state || !shouldKeepPolling) return;
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh, shouldKeepPolling, state?.task.status, taskId]);

  return {
    state,
    loading,
    error,
    refresh,
    setState,
  };
}
