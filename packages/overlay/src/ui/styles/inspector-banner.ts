export const INSPECTOR_BANNER_CSS = `
.inspect-banner {
  position: fixed;
  top: 18px;
  left: 50%;
  z-index: var(--aid-z-toast);
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: var(--aid-space-2) 14px;
  pointer-events: none;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-accent);
  border-radius: var(--aid-radius-full);
  box-shadow: var(--aid-shadow-lg);
  font-weight: 560;
}
`;
