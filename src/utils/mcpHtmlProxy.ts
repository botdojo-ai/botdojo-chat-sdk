export type McpHtmlProxyOptions = {
  html: string;
  baseUrl?: string;
  urlList?: string[];
};

export type McpProxyUrlOptions = {
  flowId: string;
  resource: string;
  origin?: string;
};

// Buffer is available in Node builds; in browsers btoa is used instead.
declare const Buffer: any;

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectIntoHead(html: string, headContent: string): string {
  if (!headContent) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${headContent}\n`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${headContent}\n</head>`);
  }
  return `<head>\n${headContent}\n</head>\n${html}`;
}

function ensureDoctype(html: string): string {
  if (/<!doctype/i.test(html)) return html;
  return `<!doctype html>\n${html}`;
}

/**
 * Build a sandbox-friendly blob URL for MCP HTML content.
 * Injects a base URL and optional url-list hint for relative assets.
 */
export function createMcpHtmlProxy(options: McpHtmlProxyOptions): { url: string; revoke: () => void } {
  const { html, baseUrl, urlList } = options;
  const headParts: string[] = ['<meta charset="utf-8">'];
  if (baseUrl) {
    headParts.push(`<base href="${escapeHtmlAttr(baseUrl)}">`);
  }
  if (urlList && urlList.length > 0) {
    headParts.push(`<script>window.__BOTDOJO_URL_LIST = ${JSON.stringify(urlList)};</script>`);
  }

  const htmlWithHead = injectIntoHead(html || '', headParts.join('\n'));
  const finalHtml = ensureDoctype(htmlWithHead);
  const blob = new Blob([finalHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const revoke = () => URL.revokeObjectURL(url);
  return { url, revoke };
}

function toBase64Url(value: string): string {
  const encoded = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(value)))
    : typeof Buffer !== 'undefined'
      ? Buffer.from(value, 'utf-8').toString('base64')
      : '';
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the MCP HTML proxy URL served by the sdk-mcp-app-html-proxy app.
 * Format: /{flowId}/?url=<encodeURIComponent(resource)>
 */
export function buildMcpProxyUrl(options: McpProxyUrlOptions): string {
  const origin = options.origin || 'https://mcp-app-proxy.botdojo.com';
  const flowId = encodeURIComponent(options.flowId || 'unknown');
  const encodedResource = encodeURIComponent(options.resource || '');
  return `${origin}/${flowId}/?url=${encodedResource}`;
}

/**
 * Build a stable cache key (base64url) for MCP UI HTML content.
 * Combines flowId + context resourceUri + resourceUri to avoid collisions.
 */
export function buildMcpCacheKey(opts: { flowId?: string; contextResourceUri?: string; resourceUri: string }): string {
  const raw = `${opts.flowId || 'unknown'}|${opts.contextResourceUri || ''}|${opts.resourceUri || ''}`;
  return toBase64Url(raw);
}
