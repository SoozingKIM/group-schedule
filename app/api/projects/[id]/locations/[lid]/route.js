import { NextResponse } from "next/server";
import { updateLocation, deleteLocation } from "@/lib/db";
import { withActor } from "@/lib/route-actor";

export const dynamic = "force-dynamic";

export const PATCH = withActor(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const loc = await updateLocation(params.id, params.lid, body);
  if (!loc) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(loc);
});

export const DELETE = withActor(async (request, { params }) => {
  const ok = await deleteLocation(params.id, params.lid);
  if (!ok) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
