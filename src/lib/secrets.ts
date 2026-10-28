const encoder = new TextEncoder();

/**
 * Constant-time string compare on UTF-8 bytes. Returns false (never throws) when the
 * lengths differ; only the length, not the content, can leak through timing then.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
