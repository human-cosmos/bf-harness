import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  ApprovalsPage,
  DiffPage,
  Layout,
  NewProjectPage,
  NewTaskPage,
  PendingPage,
  PlanPage,
  ProjectPage,
  ProjectsPage,
  ReportPage,
  TaskDetailPage,
} from "./pages.js";
import { SettingsPage } from "./system-settings-page.js";
import {
  ConversationListPage as ChatListPage,
  ConversationPage as ChatPage,
} from "./conversation-pages.js";
import { TaskLogsPage } from "./task-logs-page.js";

function titleForPath(pathname: string) {
  if (pathname === "/") return "本地项目";
  if (pathname === "/projects/new") return "添加项目";
  if (pathname === "/pending") return "待办中心";
  if (pathname.includes("/chat/")) return "项目对话";
  if (pathname.endsWith("/chat")) return "项目对话";
  if (pathname.startsWith("/projects/")) return "项目任务";
  if (pathname === "/tasks/new") return "新建任务";
  if (pathname.includes("/plan")) return "修复计划";
  if (pathname.includes("/approvals")) return "操作审批";
  if (pathname.includes("/diff")) return "变更与检查";
  if (pathname.includes("/report")) return "验收报告";
  if (pathname.startsWith("/tasks/")) return "任务详情";
  if (pathname === "/settings") return "系统设置";
  return "页面不存在";
}

function DocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} · bf-harness`;
  }, [location.pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <section>
      <div className="card empty-state">
        <p className="page-kicker">404</p>
        <h1>页面不存在</h1>
        <p className="muted">当前地址没有对应的页面。</p>
        <div className="actions">
          <Link to="/" className="btn btn-primary">
            返回项目列表
          </Link>
        </div>
      </div>
    </section>
  );
}

function ApiKeyGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ready" | "needs-key">(
    () => (window.desktop ? "checking" : "ready"),
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.getAuthStatus) {
      setStatus("ready");
      return;
    }

    let cancelled = false;
    desktop
      .getAuthStatus()
      .then((auth) => {
        if (!cancelled) {
          setStatus(auth.authenticated ? "ready" : "needs-key");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("needs-key");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError("请输入 API key。");
      return;
    }
    if (!window.desktop) {
      setStatus("ready");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await window.desktop.setApiKey(key);
      setApiKey("");
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status === "ready") {
    return <>{children}</>;
  }

  return (
    <main className="login-gate">
      <form className="card login-card" onSubmit={submit}>
        <div className="card-head">
          <div>
            <p className="page-kicker">Bugfix Harness</p>
            <h1>连接 Codex</h1>
          </div>
        </div>
        <p className="muted">
          首次使用需要提供 OpenAI API key。Key 只会写入本机应用的 Codex
          登录目录，不会出现在日志或进程参数中。
        </p>
        {status === "checking" ? (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="muted">正在检查登录状态...</span>
          </div>
        ) : (
          <>
            <label className="field">
              API key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                disabled={busy}
                placeholder="sk-..."
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            {error ? <div className="notice notice-error">{error}</div> : null}
            <div className="actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !apiKey.trim()}
              >
                {busy ? "登录中..." : "登录并继续"}
              </button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <DocumentTitle />
      <ApiKeyGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ProjectsPage />} />
            <Route path="/pending" element={<PendingPage />} />
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/projects/:id/chat" element={<ChatListPage />} />
            <Route
              path="/projects/:id/chat/:conversationId"
              element={<ChatPage />}
            />
            <Route path="/tasks/new" element={<NewTaskPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/tasks/:id/plan" element={<PlanPage />} />
            <Route path="/tasks/:id/approvals" element={<ApprovalsPage />} />
            <Route path="/tasks/:id/diff" element={<DiffPage />} />
            <Route path="/tasks/:id/report" element={<ReportPage />} />
            <Route path="/tasks/:id/logs" element={<TaskLogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ApiKeyGate>
    </BrowserRouter>
  );
}
