import { type Request } from 'express';

import { config } from './config.js';

export function getCanonicalHost(req: Request): string {
  if (config.serverCanonicalHost) return config.serverCanonicalHost;
  return `${req.protocol}://${req.get('host')}`;
}

export function getUrl(req: Request): URL {
  return new URL(req.originalUrl, getCanonicalHost(req));
}

export function getSearchParams(req: Request): URLSearchParams {
  return new URL(req.originalUrl, getCanonicalHost(req)).searchParams;
}

/**
 * Build a valid `mailto:` link. The recipient and each header value are
 * percent-encoded so that reserved characters (`?`, `#`, `&`, spaces, etc.) in
 * a free-form uid/email cannot corrupt the address or leak into the query.
 *
 * `encodeURIComponent` is used for the headers rather than `URLSearchParams`
 * because the latter encodes spaces as `+`, which mail clients render literally
 * in a `mailto:` body; `%20` is what we want.
 */
export function formatMailtoLink(recipient: string, headers: Record<string, string>): string {
  const query = Object.entries(headers)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const base = `mailto:${encodeURIComponent(recipient)}`;
  return query ? `${base}?${query}` : base;
}
