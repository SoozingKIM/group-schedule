import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const project = await createProject(body?.name);
  return NextResponse.json(project, { status: 201 });
}
