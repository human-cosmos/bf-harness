import { Link } from "react-router-dom";

export type BreadcrumbItem = {
  label: string;
  to?: string;
};

export function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumb" aria-label="面包屑导航">
      {items.map((item, index) => (
        <span className="breadcrumb-item" key={`${item.label}-${index}`}>
          {index > 0 ? (
            <span className="breadcrumb-sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
