import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function PageBackLink({
  to,
  label = "返回",
  children,
}: {
  to: string;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-context">
      <Link to={to} className="back-link">
        <svg
          className="back-link-icon"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M10 3 5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{children ?? label}</span>
      </Link>
    </div>
  );
}
