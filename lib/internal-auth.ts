import "server-only";
import { timingSafeEqual } from "node:crypto";

export function internalAuthOk(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-internal-secret") ?? "";
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
