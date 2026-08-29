import { NavLink } from "react-router-dom";
import type { WorkflowState } from "./api.js";
import { sectionAttention, TASK_SECTIONS } from "./workflow-model.js";

export function TaskRail({ state }: { state: WorkflowState }) {
  const badges = sectionAttention(state);
  const id = state.task.id;

  return (
    <nav className="task-rail" aria-label="任务节区">
      <span className="rail-label">任务</span>
      {TASK_SECTIONS.map((section) => {
        const count = badges[section.key];
        return (
          <NavLink
            key={section.key}
            to={`/tasks/${id}${section.path}`}
            end={section.path === ""}
            className={({ isActive }) =>
              `task-rail-link${isActive ? " active" : ""}`
            }
          >
            <span className="task-rail-label">{section.label}</span>
            {count ? <span className="rail-count">{count}</span> : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
