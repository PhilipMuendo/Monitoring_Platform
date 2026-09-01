/**
 * Validates a post-login redirect target taken from the `next` search param.
 *
 * Anything reaching this came out of a URL, so it is attacker-controllable:
 * a phishing link of the form `/login?next=https://evil.example/login` would
 * otherwise bounce a freshly-authenticated user onto a lookalike page at the
 * exact moment they trust the app most. Only same-origin PATHS are allowed.
 *
 * Rejected, specifically:
 *  - absolute URLs of any scheme (https, javascript, data)
 *  - protocol-relative "//host/path", which a browser treats as absolute
 *  - backslash variants that some parsers normalise to that form
 *  - control characters, used to smuggle a scheme past naive checks
 *  - "/login" itself, which would bounce straight back and loop
 */
export const DEFAULT_REDIRECT = "/";

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

export function safeRedirect(next: string | null | undefined): string {
  if (!next) return DEFAULT_REDIRECT;

  // Must be a rooted path, and the character after the leading slash must not
  // turn it into an authority reference.
  if (!next.startsWith("/")) return DEFAULT_REDIRECT;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_REDIRECT;

  if (CONTROL_CHARS.test(next)) return DEFAULT_REDIRECT;

  // Bouncing back to the sign-in page after signing in is a loop, not a
  // destination.
  const path = next.split("?")[0].split("#")[0];
  if (path === "/login") return DEFAULT_REDIRECT;

  return next;
}

/**
 * Builds the login URL that remembers where someone was headed.
 * Returns a bare "/login" for the default destination so the common case does
 * not carry a redundant param.
 */
export function loginUrlFor(pathWithQuery: string): string {
  const target = safeRedirect(pathWithQuery);
  return target === DEFAULT_REDIRECT ? "/login" : `/login?next=${encodeURIComponent(target)}`;
}
