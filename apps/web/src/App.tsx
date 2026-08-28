import { BrowserRouter, Route, Routes } from "react-router-dom";
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

export function App() {
  return (
    <BrowserRouter>
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
