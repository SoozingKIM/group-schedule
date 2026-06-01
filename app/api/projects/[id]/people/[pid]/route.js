import { NextResponse } from "next/server";
import { updatePerson, deletePerson } from "@/lib/db";
import { withActor } from "@/lib/route-actor";

export const dynamic = "force-dynamic";

export const PATCH = withActor(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const person = await updatePerson(params.id, params.pid, body);
  if (!person) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(person);
});

export const DELETE = withActor(async (request, { params }) => {
  const ok = await deletePerson(params.id, params.pid);
  if (!ok) return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
