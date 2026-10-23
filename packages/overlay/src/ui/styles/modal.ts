export const MODAL_CSS = `
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--aid-z-modal);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--aid-space-6) var(--aid-space-4);
  pointer-events: auto;
  background: color-mix(in srgb, var(--aid-bg) 62%, transparent);
}

.modal {
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(640px, calc(100vh - var(--aid-space-6)));
  overflow: hidden;
  pointer-events: auto;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-lg);
  box-shadow: var(--aid-shadow-lg);
}

.palette {
  width: min(560px, 100%);
  margin-top: 12vh;
}

.settings-modal { margin-top: 8vh; }

.palette-search-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--aid-space-2);
  padding: var(--aid-space-3) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
  color: var(--aid-text-muted);
}

.palette-search {
  flex: 1;
  min-width: 0;
  padding: var(--aid-space-1) 0;
  border: 0;
  background: transparent;
  color: var(--aid-text);
  font-size: var(--aid-text-lg);
  outline: none;
}

.palette-list {
  overflow: auto;
  padding: var(--aid-space-2);
}

.palette-heading {
  padding: var(--aid-space-2) var(--aid-space-3);
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.palette-item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-3);
  min-height: 36px;
  padding: var(--aid-space-2) var(--aid-space-3);
  border: 0;
  border-radius: var(--aid-radius-md);
  background: transparent;
  color: var(--aid-text);
  cursor: pointer;
  text-align: left;
}

.palette-item:hover,
.palette-item[aria-selected="true"] {
  background: var(--aid-bg-hover);
}

.palette-hint {
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
}

.palette-empty {
  margin: 0;
  padding: var(--aid-space-4);
  color: var(--aid-text-muted);
}

.settings-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--aid-space-2);
  min-height: 48px;
  padding: var(--aid-space-2) var(--aid-space-2) var(--aid-space-2) var(--aid-space-4);
  border-bottom: 1px solid var(--aid-border);
}

.settings-title {
  margin: 0;
  font-size: var(--aid-text-lg);
  font-weight: 620;
  letter-spacing: -0.03em;
}

.settings-body {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-5);
  padding: var(--aid-space-4);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-3);
}

.settings-section h3 {
  margin: 0;
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-fieldset {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.settings-fieldset legend {
  padding: 0 0 var(--aid-space-2);
  color: var(--aid-text);
  font-weight: 560;
}

.settings-fieldset label,
.settings-field {
  display: flex;
  align-items: center;
  gap: var(--aid-space-2);
  min-height: 32px;
  color: var(--aid-text);
}

.settings-field {
  justify-content: space-between;
}

.settings-field select {
  min-width: 10rem;
  padding: var(--aid-space-1) var(--aid-space-3);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  background: var(--aid-bg);
}

.settings-meta {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-3);
  margin: 0;
}

.settings-meta div {
  display: flex;
  flex-direction: column;
  gap: var(--aid-space-1);
}

.settings-meta dt {
  color: var(--aid-text-muted);
  font-size: var(--aid-text-xs);
  font-weight: 620;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-meta dd {
  margin: 0;
  color: var(--aid-text);
}

.settings-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 14px;
  border-radius: var(--aid-radius-full);
  text-decoration: none;
}
`;
