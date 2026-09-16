// =============================================================================
// gas-fetch.test.ts — [AUDIT p.488 REMEDIATION regression tests]
// Policy under test: every credential-bearing GAS request is constrained by
//   1. a STRICT origin allowlist (script.google.com / script.googleusercontent.com
//      / env extras; localhost dev outside production);
//   2. `redirect: 'error'` — cross-origin redirects never carry tokens;
//   3. full URL parsing (no prefix string matching).
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertGasUrlAllowed, gasFetch, gasAllowedHosts } from "@/lib/gasFetch";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("assertGasUrlAllowed — strict GAS origin allowlist", () => {
  it("accepts a canonical GAS web app URL", () => {
    const check = assertGasUrlAllowed(
      "https://script.google.com/macros/s/AKfycbx123/exec",
    );
    expect(check.ok).toBe(true);
  });

  it("accepts script.googleusercontent.com (GAS redirect target host)", () => {
    const check = assertGasUrlAllowed(
      "https://script.googleusercontent.com/macros/s/AKfycbx123/exec",
    );
    expect(check.ok).toBe(true);
  });

  it.each([
    "https://evil.example.com/macros/s/x/exec",
    "https://attacker.tld/?gas=1",
    "https://script.google.com.evil.io/exec",
    "http://script.google.com/macros/s/x/exec", // plaintext http in production
    "https://123.45.67.89/exec",
  ])("REJECTS non-allowlisted / plaintext origin: %s", (url) => {
    const check = assertGasUrlAllowed(url);
    expect(check.ok).toBe(false);
  });

  it("REJECTS malformed URLs that prefix-matching previously accepted", () => {
    // The old check `startsWith('https://')` accepted arbitrary garbage after
    // the scheme; full URL parsing now fails these.
    expect(assertGasUrlAllowed("https://").ok).toBe(false);
    expect(assertGasUrlAllowed("https://not a url").ok).toBe(false);
    expect(assertGasUrlAllowed("https:///path-only").ok).toBe(false);
  });

  it("REJECTS embedded credentials (user:pass@) — token exfiltration vector", () => {
    const check = assertGasUrlAllowed(
      "https://token:secret@script.google.com/macros/s/x/exec",
    );
    expect(check.ok).toBe(false);
  });

  it("REJECTS non-standard ports", () => {
    const check = assertGasUrlAllowed(
      "https://script.google.com:8443/macros/s/x/exec",
    );
    expect(check.ok).toBe(false);
  });

  it("REJECTS oversized URLs (payload smuggling / log pollution)", () => {
    const check = assertGasUrlAllowed(
      "https://script.google.com/macros/s/" + "A".repeat(4000) + "/exec",
    );
    expect(check.ok).toBe(false);
  });

  it("accepts localhost http OUTSIDE production only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(assertGasUrlAllowed("http://localhost:3000/gas-mock").ok).toBe(true);
    expect(assertGasUrlAllowed("http://127.0.0.1:8787/gas-mock").ok).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(assertGasUrlAllowed("http://localhost:3000/gas-mock").ok).toBe(false);
  });

  it("honors NEXT_PUBLIC_GAS_ALLOWED_HOSTS extras (self-hosted mirror)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GAS_ALLOWED_HOSTS", "gas.mirror.example.com");
    expect(gasAllowedHosts()).toContain("gas.mirror.example.com");
    expect(assertGasUrlAllowed("https://gas.mirror.example.com/exec").ok).toBe(true);
    // …but the allowlist is still closed to everything else.
    expect(assertGasUrlAllowed("https://other.example.com/exec").ok).toBe(false);
  });
});

describe("gasFetch — credential-bearing transport", () => {
  it("sends with redirect:'error' and text/plain content type", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "SUCCESS" }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await gasFetch("https://script.google.com/macros/s/x/exec", {
      body: JSON.stringify({ action: "PING", token: "t" }),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://script.google.com/macros/s/x/exec");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.method).toBe("POST");
  });

  it("THROWS before any network call for a non-allowlisted origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      gasFetch("https://evil.example.com/exec", { body: "{}" }),
    ).rejects.toThrow(/allowlist/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
