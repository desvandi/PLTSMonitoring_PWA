import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { generateRandomToken } from '@/lib/jwt';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// In-memory token store with 60s TTL.
const tokens = new Map<string, number>();

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  // CSPRNG token — never Math.random() for security tokens.
  const token = generateRandomToken(32);
  const expiresAt = Date.now() + 60_000; // 60s TTL
  tokens.set(token, expiresAt);
  return ok({ token, expiresAt }, 'Reset token generated (valid 60s)');
}

// Export token store for confirm route.
export { tokens as resetTokens };
