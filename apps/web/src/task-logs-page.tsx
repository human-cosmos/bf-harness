import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type TaskLogEntry,
  type TaskLogLevel,
  type TaskLogPhase,
  type TaskLogSource,
} from "./api.js";
import { useWorkflowState } from "./use-workflow-state.js";
import { TaskShell } from "./TaskShell.js";
import { Badge, ErrorNotice, formatDate, Loading } from "./pages.js";
import { isActiveStatus } from "./workflow-model.js";

function levelTone(level: TaskLogLevel) {
  switch (level) {
    case "error":
      return "danger" as const;
    case "warn":
      return "warning" as const;
    case "info":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

function LogRow({
  item,
  expanded,
  onToggle,
}: {
  item: TaskLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="log-row">
      <button type="button" className="log-row-main" onClick={onToggle}>
        <span className="event-time">{formatDate(item.createdAt)}</span>
        <Badge tone={levelTone(item.level)}>{item.level}</Badge>
        <span className="mono">{item.source}</span>
        <span className="mono">{item.phase}</span>
        <span className="log-message">{item.message}</span>
        <span className="muted">{expanded ? "收起" : "详情"}</span>
      </button>
      {expanded ? (
        <div className="log-row-detail">
          <pre>{JSON.stringify(item, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function TaskLogsPage() {
  const { id } = useParams();
  const { state, loading, error } = useWorkflowState(id);
  const [level, setLevel] = useState<TaskLogLevel | "">("");
  const [source, setSource] = useState<TaskLogSource | "">("");
  const [phase, setPhase] = useState<TaskLogPhase | "">("");
  const [items, setItems] = useState<TaskLogEntry[]>([]);
  const [nextAfterSeq, setNextAfterSeq] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const latestSeqRef = useRef(0);
  const requestGenerationRef = useRef(0);

  const loadFirst = useCallback(async () => {
    if (!id) return;
    const generation = ++requestGenerationRef.current;
    setListLoading(true);
    setListError("");
    try {
      const result = await api.listTaskLogs(id, {
        afterSeq: 0,
        limit: 100,
        level: level || undefined,
        source: source || undefined,
        phase: phase || undefined,
      });
      if (generation !== requestGenerationRef.current) {
        return;
      }
      setItems(result.items);
      setNextAfterSeq(result.nextAfterSeq);
      latestSeqRef.current = result.items.at(-1)?.seq ?? 0;
      setExpanded(new Set());
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setListLoading(false);
    }
  }, [id, level, source, phase]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    latestSeqRef.current = items.at(-1)?.seq ?? 0;
  }, [items]);

  const refreshNew = useCallback(async () => {
    if (!id || nextAfterSeq !== null) {
      return;
    }
    const generation = requestGenerationRef.current;
    try {
      const result = await api.listTaskLogs(id, {
        afterSeq: latestSeqRef.current,
        limit: 100,
        level: level || undefined,
        source: source || undefined,
        phase: phase || undefined,
      });
      if (generation !== requestGenerationRef.current) {
        return;
      }
      if (result.items.length === 0) {
        return;
      }
      setItems((current) => [...current, ...result.items]);
      setNextAfterSeq(result.nextAfterSeq);
    } catch {
      // Polling is best-effort; user-facing errors are handled by loadFirst/loadMore.
    }
  }, [id, level, nextAfterSeq, phase, source]);

  const taskActive = state ? isActiveStatus(state.task.status) : false;

  useEffect(() => {
    if (!taskActive) {
      return;
    }
    const timer = setInterval(() => {
      void refreshNew();
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshNew, taskActive]);

  async function loadMore() {
    if (!id || nextAfterSeq === null || loadingMore) return;
    const generation = requestGenerationRef.current;
    setLoadingMore(true);
    setListError("");
    try {
      const result = await api.listTaskLogs(id, {
        afterSeq: nextAfterSeq,
        limit: 100,
        level: level || undefined,
        source: source || undefined,
        phase: phase || undefined,
      });
      if (generation !== requestGenerationRef.current) {
        return;
      }
      setItems((current) => [...current, ...result.items]);
      setNextAfterSeq(result.nextAfterSeq);
      latestSeqRef.current = result.items.at(-1)?.seq ?? latestSeqRef.current;
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggle(item: TaskLogEntry) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  return (
    <TaskShell
      state={state}
      loading={loading}
      error={error}
      kicker="任务运行日志"
      title={state?.task.title ?? "运行日志"}
      actions={
        id ? (
          <Link to={`/tasks/${id}`} className="btn">
            返回任务详情
          </Link>
        ) : null
      }
    >
      <div className="card">
        <div className="card-head">
          <h2>运行日志</h2>
          <Badge tone={items.some((item) => item.level === "error") ? "danger" : "neutral"}>
            {items.length} 条
          </Badge>
        </div>

        <div className="log-filters">
          <label>
            级别
            <select
              value={level}
              onChange={(event) =>
                setLevel(event.target.value as TaskLogLevel | "")
              }
            >
              <option value="">全部</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </label>
          <label>
            来源
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as TaskLogSource | "")
              }
            >
              <option value="">全部</option>
              <option value="runtime">runtime</option>
              <option value="workflow">workflow</option>
              <option value="validation">validation</option>
              <option value="approval">approval</option>
              <option value="server">server</option>
            </select>
          </label>
          <label>
            阶段
            <select
              value={phase}
              onChange={(event) =>
                setPhase(event.target.value as TaskLogPhase | "")
              }
            >
              <option value="">全部</option>
              <option value="prepare">prepare</option>
              <option value="analyze">analyze</option>
              <option value="plan">plan</option>
              <option value="implement">implement</option>
              <option value="validate">validate</option>
              <option value="report">report</option>
              <option value="lifecycle">lifecycle</option>
            </select>
          </label>
        </div>

        <ErrorNotice message={listError} />

        {listLoading ? (
          <Loading>正在加载运行日志...</Loading>
        ) : items.length === 0 ? (
          <p className="muted">暂无运行日志。</p>
        ) : (
          <div className="log-list">
            {items.map((item) => (
              <LogRow
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={() => toggle(item)}
              />
            ))}
          </div>
        )}

        {nextAfterSeq !== null ? (
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </button>
          </div>
        ) : null}
      </div>
    </TaskShell>
  );
}
