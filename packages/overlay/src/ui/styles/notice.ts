export const NOTICE_CSS = `
.notice {
  position: fixed;
  z-index: var(--aid-z-toast);
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  max-width: min(360px, calc(100vw - var(--aid-space-6)));
  padding: var(--aid-space-2) var(--aid-space-2) var(--aid-space-2) var(--aid-space-3);
  pointer-events: auto;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  box-shadow: var(--aid-shadow-lg);
  font-size: var(--aid-text-sm);
}

.notice button {
  flex: none;
  padding: var(--aid-space-1) var(--aid-space-3);
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-weight: 620;
  white-space: nowrap;
}

.notice button:hover { filter: brightness(1.08); }
`;
