// JSON 파일 저장소 (로컬 개발 / 영구 디스크 호스팅용). 외부 의존성 없음.
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import {
  summary,
  newProject,
  newPerson,
  newTeam,
  newLocation,
  newEvent,
  applyProjectPatch,
  applyPersonPatch,
  applyTeamPatch,
  applyLocationPatch,
  applyEventPatch,
  inferTeamLocation,
  addActivity,
  snapshotPerson,
  logPersonChange,
} from "./util.js";

const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), "data.json");

// 신규 dateColors 필드가 없는 구 프로젝트: 6/23~29(원래 하드코딩된 강조 주)를 빨강으로 시드
function seedLegacyDateColors(p) {
  const out = {};
  const s = p?.config?.startDate;
  const e = p?.config?.endDate;
  if (!s || !e) return out;
  let cur = new Date(s);
  const end = new Date(e);
  while (cur <= end) {
    const mm = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    const md = `${mm}-${dd}`;
    if (md >= "06-23" && md <= "06-29") {
      out[`${cur.getFullYear()}-${mm}-${dd}`] = "red";
    }
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

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
      if (!p.adminHash || typeof p.adminHash !== "string") p.adminHash = "admin";
      if (p.notes === undefined) p.notes = "";
      if (!Array.isArray(p.events)) p.events = [];
      if (!p.dateColors || typeof p.dateColors !== "object") {
        // 첫 마이그레이션: 기존 6/23~29 빨간색 강조를 보존
        p.dateColors = seedLegacyDateColors(p);
      }
      if (!Array.isArray(p.activities)) p.activities = [];
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
  const before = {
    name: p.name,
    config: { ...(p.config || {}) },
    notes: p.notes || "",
    dateColors: { ...(p.dateColors || {}) },
    adminPassword: p.adminPassword || "",
    adminHash: p.adminHash || "admin",
  };
  applyProjectPatch(p, patch);
  if (patch?.name !== undefined && before.name !== p.name) {
    addActivity(p, "project.rename", `프로젝트 이름: ${before.name} → ${p.name}`);
  }
  if (patch?.config) {
    const parts = [];
    if (before.config.startDate !== p.config.startDate) parts.push(`시작일 ${before.config.startDate} → ${p.config.startDate}`);
    if (before.config.endDate !== p.config.endDate) parts.push(`종료일 ${before.config.endDate} → ${p.config.endDate}`);
    if (before.config.startTime !== p.config.startTime) parts.push(`시작시간 ${before.config.startTime} → ${p.config.startTime}`);
    if (before.config.endTime !== p.config.endTime) parts.push(`종료시간 ${before.config.endTime} → ${p.config.endTime}`);
    if (parts.length) addActivity(p, "config", `표 설정 변경: ${parts.join(", ")}`);
  }
  if (patch?.notes !== undefined && before.notes !== p.notes) {
    const action = !before.notes ? "추가" : !p.notes ? "삭제" : "수정";
    addActivity(p, "notes", `프로젝트 메모 ${action}`);
  }
  if (patch?.dateColors !== undefined) {
    const oldKeys = Object.keys(before.dateColors).length;
    const newKeys = Object.keys(p.dateColors).length;
    if (oldKeys !== newKeys || JSON.stringify(before.dateColors) !== JSON.stringify(p.dateColors)) {
      addActivity(p, "color", `날짜 색 설정 변경 (${oldKeys}개 → ${newKeys}개 칠해짐)`);
    }
  }
  if (patch?.adminPassword !== undefined && before.adminPassword !== (p.adminPassword || "")) {
    const action = !before.adminPassword ? "설정" : !p.adminPassword ? "해제" : "변경";
    addActivity(p, "security", `관리자 비밀번호 ${action}`);
  }
  if (patch?.adminHash !== undefined && before.adminHash !== p.adminHash) {
    addActivity(p, "security", `관리자 진입 비밀단어 변경`);
  }
  if (Array.isArray(patch?.peopleOrder)) addActivity(p, "reorder", "사람 순서 변경");
  if (Array.isArray(patch?.teamOrder)) addActivity(p, "reorder", "팀 순서 변경");
  if (Array.isArray(patch?.locationOrder)) addActivity(p, "reorder", "위치 순서 변경");
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
  const validLocId = locationId && p.locations.some((l) => l.id === locationId) ? locationId : null;
  const person = newPerson(p, name, validLocId);
  p.people.push(person);
  const locName = (p.locations.find((l) => l.id === validLocId) || {}).name || "(분류없음)";
  addActivity(p, "person.add", `사람 추가: ${person.name} (${locName})`);
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
  const before = snapshotPerson(person);
  applyPersonPatch(person, patch);
  logPersonChange(p, before, person, patch);
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
  const removed = p.people[i];
  p.people.splice(i, 1);
  for (const t of p.teams) t.memberIds = (t.memberIds || []).filter((id) => id !== personId);
  addActivity(p, "person.delete", `사람 삭제: ${removed.name}`);
  bump(p);
  write(db);
  return true;
}

// ----------------------------- 팀 ------------------------------
export async function addTeam(projectId, name, memberIds, locationId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const targetLoc = locationId || null;
  const valid = (memberIds || []).filter((id) => {
    const person = p.people.find((x) => x.id === id);
    return person && (person.locationId || null) === targetLoc;
  });
  const team = newTeam(name, valid, targetLoc);
  p.teams.push(team);
  const locName = (p.locations.find((l) => l.id === targetLoc) || {}).name || "(분류없음)";
  addActivity(p, "team.add", `팀 추가: ${team.name} (${locName}, ${valid.length}명)`);
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
  const beforeName = team.name;
  const beforeMembers = team.memberIds.length;
  if (Array.isArray(patch?.memberIds)) {
    patch = {
      ...patch,
      memberIds: patch.memberIds.filter((id) => {
        const person = p.people.find((x) => x.id === id);
        return person && (person.locationId || null) === (team.locationId || null);
      }),
    };
  }
  applyTeamPatch(team, patch);
  if (typeof patch?.name === "string" && beforeName !== team.name) {
    addActivity(p, "team.rename", `팀 이름 변경: ${beforeName} → ${team.name}`);
  }
  if (Array.isArray(patch?.memberIds) && beforeMembers !== team.memberIds.length) {
    addActivity(p, "team.members", `${team.name} 팀원 수: ${beforeMembers} → ${team.memberIds.length}명`);
  }
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
  const removed = p.teams[i];
  p.teams.splice(i, 1);
  addActivity(p, "team.delete", `팀 삭제: ${removed.name}`);
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
  for (const person of p.people) {
    if (!person.locationId || !p.locations.some((l) => l.id === person.locationId)) {
      person.locationId = loc.id;
    }
  }
  addActivity(p, "location.add", `위치 추가: ${loc.name}`);
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
  const beforeName = loc.name;
  applyLocationPatch(loc, patch);
  if (typeof patch?.name === "string" && beforeName !== loc.name) {
    addActivity(p, "location.rename", `위치 이름 변경: ${beforeName} → ${loc.name}`);
  }
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
  const removed = p.locations[i];
  p.locations.splice(i, 1);
  for (const person of p.people) {
    if (person.locationId === locationId) person.locationId = null;
  }
  p.teams = p.teams.filter((t) => t.locationId !== locationId);
  addActivity(p, "location.delete", `위치 삭제: ${removed.name}`);
  bump(p);
  write(db);
  return true;
}

// ----------------------------- 일정 (events) -----------------------------
export async function addEvent(projectId, payload) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  if (!Array.isArray(p.events)) p.events = [];
  const ev = newEvent(payload || {});
  p.events.push(ev);
  addActivity(p, "event.add", `일정 추가: ${ev.title} (${ev.date} ${ev.startTime}–${ev.endTime})`);
  bump(p);
  write(db);
  return ev;
}

export async function updateEvent(projectId, eventId, patch) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const ev = (p.events || []).find((e) => e.id === eventId);
  if (!ev) return null;
  const before = { title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime };
  applyEventPatch(ev, patch);
  const changed = [];
  if (before.title !== ev.title) changed.push(`제목 ${before.title} → ${ev.title}`);
  if (before.date !== ev.date) changed.push(`날짜 ${before.date} → ${ev.date}`);
  if (before.startTime !== ev.startTime || before.endTime !== ev.endTime) {
    changed.push(`시간 ${before.startTime}–${before.endTime} → ${ev.startTime}–${ev.endTime}`);
  }
  if (changed.length) addActivity(p, "event.update", `일정 수정: ${ev.title} (${changed.join(", ")})`);
  bump(p);
  write(db);
  return ev;
}

export async function deleteEvent(projectId, eventId) {
  const db = read();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const i = (p.events || []).findIndex((e) => e.id === eventId);
  if (i === -1) return false;
  const removed = p.events[i];
  p.events.splice(i, 1);
  addActivity(p, "event.delete", `일정 삭제: ${removed.title} (${removed.date})`);
  bump(p);
  write(db);
  return true;
}
