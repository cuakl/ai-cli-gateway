import type { ComponentChildren } from 'preact';

export interface EmptyStateProps {
  icon: ComponentChildren;
  title: string;
  hint: string;
}

export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      <p className="empty-copy">{hint}</p>
    </div>
  );
}
