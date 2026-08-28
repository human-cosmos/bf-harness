import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  ApprovalsPage,
  DiffPage,
  Layout,
  NewProjectPage,
  NewTaskPage,
  PlanPage,
  ProjectPage,
  ProjectsPage,
  ReportPage,
  SettingsPage,
  TaskDetailPage,
} from "./pages.js";

function titleForPath(pathname: string) {
  if (pathname === "/") return "本地项目";
  if (pathname === "/projects/new") return "添加项目";
  if (pathname.startsWith("/projects/")) return "项目任务";
  if (pathname === "/tasks/new") return "新建任务";
  if (pathname.includes("/plan")) return "修复计划";
  if (pathname.includes("/approvals")) return "操作审批";
  if (pathname.includes("/diff")) return "变更与检查";
  if (pathname.includes("/report")) return "验收报告";
  if (pathname === "/settings") return "系统诊断";
  return "页面不存在";
}

function DocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} · Bugfix Harness`;
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

export function App() {
  return (
    <BrowserRouter>
      <DocumentTitle />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/tasks/:id/plan" element={<PlanPage />} />
          <Route path="/tasks/:id/approvals" element={<ApprovalsPage />} />
          <Route path="/tasks/:id/diff" element={<DiffPage />} />
          <Route path="/tasks/:id/report" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
