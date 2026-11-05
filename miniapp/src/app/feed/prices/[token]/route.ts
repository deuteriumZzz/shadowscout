import type { NextRequest } from "next/server";
import { normalizePrices } from "@/lib/feeds/polymarket";

const DATA_API = "https://data-api.polymarket.com/v2/prices-history";
const BUCKETS = new Set(["60", "3600"]);
const CACHE_SECONDS = 30;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const bucket = request.nextUrl.searchParams.get("bucket") ?? "";
  // All three end up in a server-side URL, so only known shapes get through.
  if (!/^\d{10,90}$/.test(token) || !/^\d{9,11}$/.test(from) || !BUCKETS.has(bucket)) {
    return Response.json({ error: "Неверный запрос" }, { status: 400 });
  }
  const query = new URLSearchParams({ token_id: token, start: from, end: String(Math.floor(Date.now() / 1000)), bucket_seconds: bucket });
  const response = await fetch(`${DATA_API}?${query}`, { next: { revalidate: CACHE_SECONDS } });
  if (!response.ok) return Response.json({ error: "История цены недоступна" }, { status: 502 });
  return Response.json(normalizePrices(await response.json()));
}
