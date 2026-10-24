export const INSPECTOR_CSS = `
.chip-warning {
  background: color-mix(in srgb, var(--aid-warning) 18%, var(--aid-bg-hover));
  color: var(--aid-text);
}

.chip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 999px;
  background: var(--aid-accent);
  color: var(--aid-accent-fg);
  font-size: var(--aid-text-xs);
  font-weight: 700;
}

.chip-thumb-btn {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  flex: none;
  border-radius: var(--aid-radius-sm);
  overflow: hidden;
}

.chip-crumb {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.chip-menu {
  position: absolute;
  z-index: var(--aid-z-popover);
  min-width: 160px;
  margin-top: var(--aid-space-1);
  padding: var(--aid-space-1);
  background: var(--aid-bg-raised);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  box-shadow: var(--aid-shadow-lg);
}

.chip-menu button {
  display: block;
  width: 100%;
  padding: var(--aid-space-1) var(--aid-space-2);
  border: 0;
  border-radius: var(--aid-radius-sm);
  background: transparent;
  color: var(--aid-text);
  text-align: left;
  font-size: var(--aid-text-xs);
}

.chip-menu button:hover,
.chip-menu button[aria-current="true"] {
  background: var(--aid-bg-hover);
}

.chip-wrap {
  position: relative;
}

.chip-preview {
  position: absolute;
  z-index: var(--aid-z-popover);
  right: 0;
  bottom: calc(100% + var(--aid-space-1));
  width: 220px;
  padding: var(--aid-space-2);
  background: var(--aid-bg-raised);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-md);
  box-shadow: var(--aid-shadow-lg);
}

.chip-preview-image {
  display: block;
  width: 100%;
  height: auto;
  max-height: 160px;
  object-fit: contain;
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg);
}

.chip-preview-actions {
  display: flex;
  gap: var(--aid-space-1);
  margin-top: var(--aid-space-2);
}

.chip-preview-actions button {
  flex: 1;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  font-weight: 560;
  cursor: pointer;
}

.screenshot-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--aid-space-1);
  padding: 0 var(--aid-space-4) var(--aid-space-1);
}

.screenshot-tools button {
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--aid-radius-full);
  background: var(--aid-bg-hover);
  color: var(--aid-text);
  font-size: var(--aid-text-xs);
  font-weight: 560;
}

.annotate-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--aid-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--aid-space-4);
  pointer-events: auto;
  background: color-mix(in srgb, var(--aid-bg) 72%, transparent);
}

.annotate-modal {
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: 90vw;
  min-width: min(520px, 100%);
  overflow: hidden;
  pointer-events: auto;
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  border: 1px solid var(--aid-border);
  border-radius: var(--aid-radius-lg);
  box-shadow: var(--aid-shadow-lg);
}

.annotate-toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--aid-space-1);
  padding: var(--aid-space-2) var(--aid-space-3);
  border-bottom: 1px solid var(--aid-border);
}

.annotate-toolbar .icon-button[aria-pressed="true"] {
  background: var(--aid-bg-hover);
  color: var(--aid-accent);
}

.annotate-spacer { flex: 1; }

.annotate-stage {
  position: relative;
  align-self: center;
  flex: none;
  overflow: hidden;
  background: var(--aid-bg);
}

.annotate-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.annotate-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.annotate-text-input {
  position: absolute;
  min-width: 80px;
  padding: 2px 6px;
  border: 1px solid var(--aid-accent);
  border-radius: var(--aid-radius-sm);
  background: var(--aid-bg-raised);
  color: var(--aid-text);
  font-size: var(--aid-text-sm);
}
`;
