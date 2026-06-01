import { NextResponse } from "next/server";
import { updateEvent, deleteEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const ev = await updateEvent(params.id, params.eid, body);
  if (!ev) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(ev);
}

export async function DELETE(request, { params }) {
  const ok = await deleteEvent(params.id, params.eid);
  if (!ok) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
