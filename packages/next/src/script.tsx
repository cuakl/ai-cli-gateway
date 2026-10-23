import { DEFAULT_GATEWAY_URL, ENV, GLOBAL_CONFIG_KEY } from './brand.js';

export interface AidevScriptConfig {
  gatewayUrl: string;
  projectId?: string;
  browserToken?: string;
  projectName?: string;
}

/** Escape `<` so inline JSON cannot close a `<script>` tag. */
export function serializeAidevConfig(config: AidevScriptConfig): string {
  return JSON.stringify(config).replace(/</g, '\\u003c');
}

function readDevConfig(): AidevScriptConfig {
  const gatewayUrl = (process.env[ENV.gatewayUrl] ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
  const projectId = process.env[ENV.projectId];
  const browserToken = process.env[ENV.browserToken];
  const projectName = process.env[ENV.projectName];
  return {
    gatewayUrl,
    ...(projectId ? { projectId } : {}),
    ...(browserToken ? { browserToken } : {}),
    ...(projectName ? { projectName } : {}),
  };
}

/**
 * App Router root-layout helper. Server Component compatible (no hooks).
 * Renders nothing in production. In development, injects the overlay config
 * and loads `GET /overlay.js` from the gateway.
 */
export function AidevScript(): React.JSX.Element | null {
  if (process.env.NODE_ENV === 'production') return null;
  const config = readDevConfig();
  const json = serializeAidevConfig(config);
  const overlaySrc = `${config.gatewayUrl}/overlay.js`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.${GLOBAL_CONFIG_KEY} = ${json};` }} />
      <script src={overlaySrc} defer />
    </>
  );
}
