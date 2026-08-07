import type { ElementType, HTMLAttributes, ReactNode, Ref } from "react";

type ListProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: "div" | "ul" | "ol" | "section";
};

type ListItemProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: "div" | "li" | "article";
  ref?: Ref<HTMLElement> | Ref<HTMLLIElement>;
};

export function List({ as: Component = "div", children, className, role = "list", ...props }: ListProps) {
  return <Component {...props} role={role} className={`ui-list ${className ?? ""}`.trim()}>{children}</Component>;
}

export function ListItem({ as: Component = "div", children, className, role = "listitem", ...props }: ListItemProps) {
  const Element = Component as ElementType;
  return <Element {...props} role={role} className={`ui-list-item ${className ?? ""}`.trim()}>{children}</Element>;
}
