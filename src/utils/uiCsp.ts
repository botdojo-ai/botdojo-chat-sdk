type MaybeArray<T> = T | T[] | undefined;

const DEFAULT_CSP_META = {
  allowSameOrigin: true,
  allowForms: false,
  allowPopups: false,
} as const;

export type UiCspMeta = {
  domain?: string;
  connectDomains?: string[];
  resourceDomains?: string[];
  allowPopups?: boolean;
  allowForms?: boolean;
  allowSameOrigin?: boolean;
};

export type ResolvedUiCsp = {
  /** Space-delimited sandbox attribute value */
  sandbox: string;
  /** Content-Security-Policy string */
  csp: string;
  /** Normalized metadata used to build the policy */
  meta: UiCspMeta;
};

function ensureArray<T>(value: MaybeArray<T>): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sanitizeSource(value: string): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  // Reject obvious injection characters
  if (/[;\n\r]/.test(trimmed)) return null;
  const keywords = ["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "'unsafe-hashes'", "'report-sample'"];
  if (keywords.includes(trimmed)) return trimmed;
  if (trimmed === 'data:' || trimmed === 'blob:') return trimmed;
  if (/^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^[*.A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(?::\d+)?$/.test(trimmed)) return trimmed;
  return null;
}

function uniq(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  list.forEach((item) => {
    if (item && !seen.has(item)) {
      seen.add(item);
    }
  });
  return Array.from(seen);
}

function buildSources(base: string[], domains: string[], extras: string[] = []): string[] {
  return uniq([...base, ...domains, ...extras].map((v) => sanitizeSource(v || '')).filter(Boolean));
}

export function resolveUiCsp(meta?: UiCspMeta): ResolvedUiCsp {
  const merged: UiCspMeta = {
    ...DEFAULT_CSP_META,
    ...(meta || {}),
  };

  const connectDomains = ensureArray(merged.connectDomains);
  const resourceDomains = ensureArray(merged.resourceDomains);
  const domain = merged.domain ? [merged.domain] : [];

  const sandboxParts = ['allow-scripts'];
  if (merged.allowSameOrigin !== false) {
    sandboxParts.push('allow-same-origin');
  }
  if (merged.allowForms) {
    sandboxParts.push('allow-forms');
  }
  if (merged.allowPopups) {
    sandboxParts.push('allow-popups', 'allow-top-navigation-by-user-activation');
  }

  const scriptSrc = buildSources(["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'], [...resourceDomains, ...domain]);
  const styleSrc = buildSources(["'self'", "'unsafe-inline'", 'blob:'], resourceDomains);
  const imgSrc = buildSources(["'self'", 'data:', 'blob:'], resourceDomains);
  const fontSrc = buildSources(["'self'", 'data:', 'blob:'], resourceDomains);
  const connectSrc = buildSources(["'self'"], [...connectDomains, ...domain]);
  const mediaSrc = buildSources(["'self'", 'data:', 'blob:'], resourceDomains);
  const frameSrc = buildSources(["'none'"], []);

  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': scriptSrc.length ? scriptSrc : ["'self'"],
    'style-src': styleSrc.length ? styleSrc : ["'self'", "'unsafe-inline'"],
    'img-src': imgSrc.length ? imgSrc : ["'self'", 'data:'],
    'font-src': fontSrc.length ? fontSrc : ["'self'", 'data:'],
    'connect-src': connectSrc.length ? connectSrc : ["'self'"],
    'media-src': mediaSrc.length ? mediaSrc : ["'self'", 'data:'],
    'frame-src': frameSrc,
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': merged.allowForms ? ["'self'"] : ["'none'"],
  };

  const csp = Object.entries(directives)
    .map(([key, sources]) => `${key} ${sources.join(' ')}`)
    .join('; ');

  return {
    sandbox: sandboxParts.join(' '),
    csp,
    meta: merged,
  };
}

export function extractUiCspFromResource(resource: any): UiCspMeta | undefined {
  if (!resource || typeof resource !== 'object') return undefined;
  const uiMeta =
    (resource as any)?.meta?.ui ||
    (resource as any)?.metadata?.ui ||
    (resource as any)?._meta?.ui ||
    undefined;
  const csp = uiMeta?.csp;
  return csp || undefined;
}
