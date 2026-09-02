import { requireAuth } from '@/lib/auth';
import { getDiagnostics } from '@/lib/mockStore';
import { ok, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  return ok(getDiagnostics());
}
