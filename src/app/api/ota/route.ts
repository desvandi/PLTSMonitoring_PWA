import { NextRequest } from 'next/server';
import { requireAuth, verifyCsrfToken } from '@/lib/auth';
import { getStore, simulateOtaUpdate } from '@/lib/mockStore';
import { ok, fail, unauthorized } from '@/lib/apiResponse';

export const runtime = 'nodejs';

// POST /api/ota — upload binary file and trigger OTA update.
// Multipart form with field "file".
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return unauthorized(auth.message);
  if (!(await verifyCsrfToken(req))) return fail('Invalid CSRF token', 403);

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return fail('No file uploaded');
  }
  // ESP32 partition limit (1.5 MB OTA partition + factory).
  if (file.size > 2_000_000) {
    return fail('Binary too large (max 2MB for ESP32 OTA partition)');
  }

  const store = await getStore();
  const targetVersion = store.latestAvailable;
  const success = await simulateOtaUpdate(targetVersion);
  if (success) {
    return ok({ success: true, newVersion: targetVersion }, 'OTA update successful');
  }
  return fail('OTA update failed — rolled back', 500);
}
