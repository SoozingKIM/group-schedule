// ---------------------------------------------------------------------------
// 데이터 저장 계층 (서버 전용) — 환경에 따라 저장소 자동 선택
//
//   • DATABASE_URL 환경변수 있음  → Postgres (Vercel + Neon 등 배포 환경)
//   • 없음                        → data.json 파일 (로컬 개발 / 영구 디스크 호스팅)
//
// API 라우트는 이 파일의 함수만 호출하므로, 저장소를 바꿔도 나머지 코드는 그대로입니다.
// ---------------------------------------------------------------------------
import * as fileStore from "./store/file.js";
import { makePostgresStore } from "./store/postgres.js";

let storePromise = null;

function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      if (process.env.DATABASE_URL) {
        const { Pool } = await import("@neondatabase/serverless");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        return makePostgresStore(pool);
      }
      return fileStore;
    })();
  }
  return storePromise;
}

export async function listProjects() {
  return (await getStore()).listProjects();
}
export async function createProject(name) {
  return (await getStore()).createProject(name);
}
export async function getProject(id) {
  return (await getStore()).getProject(id);
}
export async function getRev(id) {
  return (await getStore()).getRev(id);
}
export async function updateProject(id, patch) {
  return (await getStore()).updateProject(id, patch);
}
export async function deleteProject(id) {
  return (await getStore()).deleteProject(id);
}
export async function addPerson(projectId, name, locationId) {
  return (await getStore()).addPerson(projectId, name, locationId);
}
export async function updatePerson(projectId, personId, patch) {
  return (await getStore()).updatePerson(projectId, personId, patch);
}
export async function deletePerson(projectId, personId) {
  return (await getStore()).deletePerson(projectId, personId);
}
export async function addTeam(projectId, name, memberIds, locationId) {
  return (await getStore()).addTeam(projectId, name, memberIds, locationId);
}
export async function updateTeam(projectId, teamId, patch) {
  return (await getStore()).updateTeam(projectId, teamId, patch);
}
export async function deleteTeam(projectId, teamId) {
  return (await getStore()).deleteTeam(projectId, teamId);
}
export async function addLocation(projectId, name) {
  return (await getStore()).addLocation(projectId, name);
}
export async function updateLocation(projectId, locationId, patch) {
  return (await getStore()).updateLocation(projectId, locationId, patch);
}
export async function deleteLocation(projectId, locationId) {
  return (await getStore()).deleteLocation(projectId, locationId);
}
