export const NOTICE_CSS = `
.notice {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: var(--aid-z-toast);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(440px, calc(100vw - 32px));
  padding: 10px 10px 10px 14px;
  pointer-events: auto;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-accent);
  border-radius: var(--aid-radius-lg);
  box-shadow: var(--aid-shadow-lg);
}

.notice button {
  flex: none;
  padding: 6px 10px;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-weight: 620;
  white-space: nowrap;
}
`;
