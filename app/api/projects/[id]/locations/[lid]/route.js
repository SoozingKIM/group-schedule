import { NextResponse } from "next/server";
import { updateLocation, deleteLocation } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const loc = await updateLocation(params.id, params.lid, body);
  if (!loc) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(loc);
}

export async function DELETE(request, { params }) {
  const ok = await deleteLocation(params.id, params.lid);
  if (!ok) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
