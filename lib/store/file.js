// JSON 파일 저장소 (로컬 개발 / 영구 디스크 호스팅용). 외부 의존성 없음.
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import {
  summary,
  newProject,
  newPerson,
  newTeam,
  newLocation,
  applyProjectPatch,
  applyPersonPatch,
  applyTeamPatch,
  applyLocationPatch,
  inferTeamLocation,
} from "./util.js";

const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), "data.json");

function read() {
  if (!existsSync(DATA_FILE)) return { projects: [] };
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (!parsed || !Array.isArray(parsed.projects)) return { projects: [] };
    // 구버전 데이터 호환
    for (const p of parsed.projects) {
      if (!Array.isArray(p.teams)) p.teams = [];
      if (!Array.isArray(p.locations)) p.locations = [];
      if (p.adminPassword === undefined) p.adminPassword = null;
      if (p.sharePassword === undefined) p.sharePassword = null;
      if (p.notes === undefined) p.notes = "";
      for (const person of p.people) {
        if (person.locationId === undefined) person.locationId = null;
        if (person.updatedAt === undefined) person.updatedAt = p.updatedAt || Date.now();
      }
      for (const t of p.teams) {
        if (!t.locationId) t.locationId = inferTeamLocation(t, p.people);
      }
    }
    return parsed;
  } catch {
    return { projects: [] };
  }
}

function write(db) {
  const tmp = DATA_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DATA_FILE);
}

function bump(p) {
  p.rev = (p.rev || 0) + 1;
  p.updatedAt = Date.now();
}

export async function listProjects() {
  return read().projects.map(summary);
}

export async function createProject(name) {
  const db = read();
  const p = newProject(name);
  db.projects.push(p);
  write(db);
  return p;
}

export async function getProject(id) {
  return read().projects.find((p) => p.id === id) || null;
}

export async function getRev(id) {
  const p = await getProject(id);
  return p ? p.rev || 0 : null;
}

export async function updateProject(id, patch) {
  const db = read();
  const p = db.projects.find((x) => x.id === id);
  if (!p) return null;
  applyProjectPatch(p, patch);
  bump(p);
  write(db);
  return p;
}

export async function deleteProject(id) {
  const db = read();
  const i = db.projects.findIndex((p) => p.id === id);
  if (i === -1) return false;
  db.projects.splice(i, 1);
  write(db);
  return true;
}

export async function addPerson(projectId, name, locationId = null) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  // 위치가 지정됐는데 그런 위치가 없으면 null로
  const validLocId = locationId && p.locations.some((l) => l.id === locationId) ? locationId : null;
  const person = newPerson(p, name, validLocId);
  p.people.push(person);
  bump(p);
  write(db);
  return person;
}

export async function updatePerson(projectId, personId, patch) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const person = p.people.find((x) => x.id === personId);
  if (!person) return null;
  applyPersonPatch(person, patch);
  bump(p);
  write(db);
  return person;
}

export async function deletePerson(projectId, personId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const i = p.people.findIndex((x) => x.id === personId);
  if (i === -1) return false;
  p.people.splice(i, 1);
  // 팀 멤버에서도 제거
  for (const t of p.teams) t.memberIds = (t.memberIds || []).filter((id) => id !== personId);
  bump(p);
  write(db);
  return true;
}

// ----------------------------- 팀 ------------------------------
export async function addTeam(projectId, name, memberIds, locationId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  // 같은 위치 사람만 멤버로 통과
  const targetLoc = locationId || null;
  const valid = (memberIds || []).filter((id) => {
    const person = p.people.find((x) => x.id === id);
    return person && (person.locationId || null) === targetLoc;
  });
  const team = newTeam(name, valid, targetLoc);
  p.teams.push(team);
  bump(p);
  write(db);
  return team;
}

export async function updateTeam(projectId, teamId, patch) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const team = p.teams.find((t) => t.id === teamId);
  if (!team) return null;
  if (Array.isArray(patch?.memberIds)) {
    // 멤버는 팀 자신의 위치 안에서만
    patch = {
      ...patch,
      memberIds: patch.memberIds.filter((id) => {
        const person = p.people.find((x) => x.id === id);
        return person && (person.locationId || null) === (team.locationId || null);
      }),
    };
  }
  applyTeamPatch(team, patch);
  bump(p);
  write(db);
  return team;
}

export async function deleteTeam(projectId, teamId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const i = p.teams.findIndex((t) => t.id === teamId);
  if (i === -1) return false;
  p.teams.splice(i, 1);
  bump(p);
  write(db);
  return true;
}

// ----------------------------- 위치 -----------------------------
export async function addLocation(projectId, name) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const loc = newLocation(name);
  p.locations.push(loc);
  // 분류 안 된(orphan) 사람들을 이 새 위치로 자동 편입
  for (const person of p.people) {
    if (!person.locationId || !p.locations.some((l) => l.id === person.locationId)) {
      person.locationId = loc.id;
    }
  }
  bump(p);
  write(db);
  return loc;
}

export async function updateLocation(projectId, locationId, patch) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const loc = p.locations.find((l) => l.id === locationId);
  if (!loc) return null;
  applyLocationPatch(loc, patch);
  bump(p);
  write(db);
  return loc;
}

export async function deleteLocation(projectId, locationId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const i = p.locations.findIndex((l) => l.id === locationId);
  if (i === -1) return false;
  p.locations.splice(i, 1);
  // 이 위치에 속한 사람들은 분류 없음(orphan)으로
  for (const person of p.people) {
    if (person.locationId === locationId) person.locationId = null;
  }
  // 이 위치의 팀도 함께 삭제
  p.teams = p.teams.filter((t) => t.locationId !== locationId);
  bump(p);
  write(db);
  return true;
}
