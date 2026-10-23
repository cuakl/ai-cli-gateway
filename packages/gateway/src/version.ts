import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

/** Version from this package's package.json. */
export const GATEWAY_VERSION = pkg.version ?? '0.0.0';
