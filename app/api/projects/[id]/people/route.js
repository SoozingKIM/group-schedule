import { NextResponse } from "next/server";
import { addPerson } from "@/lib/db";
import { withActor } from "@/lib/route-actor";

export const dynamic = "force-dynamic";

export const POST = withActor(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const person = await addPerson(params.id, body?.name, body?.locationId || null);
  if (!person) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(person, { status: 201 });
});
