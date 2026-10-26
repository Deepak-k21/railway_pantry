const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedOrigin(
  candidate: string | undefined,
  configured: string,
  allowLocalAliases = false,
) {
  if (!candidate) return false;
  try {
    const received = new URL(candidate);
    const expected = new URL(configured);
    if (received.origin !== candidate) return false;
    if (received.origin === expected.origin) return true;
    return (
      allowLocalAliases &&
      loopbackHosts.has(received.hostname) &&
      loopbackHosts.has(expected.hostname) &&
      received.protocol === expected.protocol &&
      received.port === expected.port
    );
  } catch {
    return false;
  }
}
