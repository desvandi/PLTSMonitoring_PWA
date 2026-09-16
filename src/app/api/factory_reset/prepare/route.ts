import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { generateRandomToken } from '@/lib/jwt';
import { authFailure, fail, ok } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// In-memory token store with 60s TTL.
const tokens = new Map<string, number>();

export async function POST(req: NextRequest) {
  const auth = await requireAuth({ mutation: true });
  if (!auth.ok) return authFailure(auth);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  // [audit-2 S-9 FIX] Sweep expired tokens on every prepare. Previously,
  // tokens were only cleaned when the confirm route accessed a specific
  // token — operators who clicked "Prepare" repeatedly without "Confirm"
  // accumulated expired tokens in memory forever (slow memory leak).
  const now = Date.now();
  for (const [t, exp] of tokens) {
    if (exp <= now) tokens.delete(t);
  }

  // CSPRNG token — never Math.random() for security tokens.
  const token = generateRandomToken(32);
  const expiresAt = now + 60_000; // 60s TTL
  tokens.set(token, expiresAt);
  return ok({ token, expiresAt }, 'Reset token generated (valid 60s)');
}

// Export token store for confirm route.
export { tokens as resetTokens };
