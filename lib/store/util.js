// 저장소(파일/Postgres) 공통 헬퍼 — 순수 로직만 담아 두 저장소가 동일하게 동작하도록 함
import { randomUUID } from "node:crypto";

export function defaultConfig() {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  return { startDate: start, endDate: end, startTime: "09:00", endTime: "18:00", slotMinutes: 30 };
}

export function summary(p) {
  return {
    id: p.id,
    name: p.name,
    peopleCount: p.people.length,
    config: p.config,
    rev: p.rev || 0,
    updatedAt: p.updatedAt,
  };
}

export function newProject(name) {
  return {
    id: randomUUID(),
    name: (name || "새 프로젝트").toString().trim() || "새 프로젝트",
    config: defaultConfig(),
    people: [],
    teams: [],
    locations: [],
    events: [],
    adminPassword: null,
    sharePassword: null,
    notes: "",
    dateColors: {}, // { "YYYY-MM-DD": "red" | ... } 날짜별 강조 색
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rev: 1,
  };
}

export function newTeam(name, memberIds, locationId) {
  return {
    id: randomUUID(),
    name: (name || "새 팀").toString().trim() || "새 팀",
    locationId: locationId || null,
    memberIds: Array.isArray(memberIds) ? [...new Set(memberIds.map(String))] : [],
  };
}

export function applyTeamPatch(team, { name, memberIds, locationId } = {}) {
  if (typeof name === "string" && name.trim()) team.name = name.trim();
  if (Array.isArray(memberIds)) team.memberIds = [...new Set(memberIds.map(String))];
  if (locationId !== undefined) team.locationId = locationId || null;
}

// 팀의 위치를 멤버들의 위치로 추론 (구버전 데이터 마이그레이션용)
export function inferTeamLocation(team, people) {
  const counts = new Map();
  for (const mid of team.memberIds || []) {
    const person = people.find((x) => x.id === mid);
    if (person && person.locationId) {
      counts.set(person.locationId, (counts.get(person.locationId) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function newPerson(project, name, locationId = null) {
  return {
    id: randomUUID(),
    name:
      (name || `사람 ${project.people.length + 1}`).toString().trim() ||
      `사람 ${project.people.length + 1}`,
    locationId: locationId || null,
    slots: [],
    memos: {},
    updatedAt: Date.now(),
  };
}

export function newLocation(name) {
  return {
    id: randomUUID(),
    name: (name || "새 위치").toString().trim() || "새 위치",
  };
}

export function applyLocationPatch(loc, { name } = {}) {
  if (typeof name === "string" && name.trim()) loc.name = name.trim();
}

// 일정(약속) — { id, title, date, startTime, endTime, description, createdAt }
export function newEvent({ title, date, startTime, endTime, description } = {}) {
  return {
    id: randomUUID(),
    title: (title || "새 일정").toString().trim() || "새 일정",
    date: date || "",
    startTime: startTime || "",
    endTime: endTime || "",
    description: (description || "").toString(),
    createdAt: Date.now(),
  };
}

export function applyEventPatch(ev, { title, date, startTime, endTime, description } = {}) {
  if (typeof title === "string" && title.trim()) ev.title = title.trim();
  if (typeof date === "string" && date) ev.date = date;
  if (typeof startTime === "string" && startTime) ev.startTime = startTime;
  if (typeof endTime === "string" && endTime) ev.endTime = endTime;
  if (description !== undefined) ev.description = String(description || "");
}

// 프로젝트 이름/설정/배열 순서/비밀번호 변경 (in-place)
export function applyProjectPatch(p, { name, config, peopleOrder, teamOrder, locationOrder, adminPassword, sharePassword, notes, dateColors } = {}) {
  if (typeof name === "string" && name.trim()) p.name = name.trim();
  if (config && typeof config === "object") {
    p.config = { ...p.config, ...config, slotMinutes: 30 };
  }
  if (Array.isArray(peopleOrder)) p.people = reorderBy(p.people, peopleOrder);
  if (Array.isArray(teamOrder)) p.teams = reorderBy(p.teams, teamOrder);
  if (Array.isArray(locationOrder)) p.locations = reorderBy(p.locations, locationOrder);
  // 비밀번호: 빈 문자열이면 해제(null), 미지정이면 변경 안 함
  if (adminPassword !== undefined) p.adminPassword = adminPassword ? String(adminPassword) : null;
  if (sharePassword !== undefined) p.sharePassword = sharePassword ? String(sharePassword) : null;
  if (notes !== undefined) p.notes = typeof notes === "string" ? notes : "";
  // 날짜별 색: 객체 전체 교체 ({date → color key}). value가 falsy면 해당 날짜 제거
  if (dateColors !== undefined) {
    const next = {};
    if (dateColors && typeof dateColors === "object") {
      for (const [k, v] of Object.entries(dateColors)) {
        if (typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "string" && v) {
          next[k] = v;
        }
      }
    }
    p.dateColors = next;
  }
}

// 주어진 id 순서에 맞춰 배열을 재정렬 (순서에 없는 항목은 뒤에 그대로 붙음)
function reorderBy(items, idsInOrder) {
  const map = new Map(items.map((x) => [x.id, x]));
  const out = [];
  for (const id of idsInOrder) {
    if (map.has(id)) {
      out.push(map.get(id));
      map.delete(id);
    }
  }
  for (const x of map.values()) out.push(x);
  return out;
}

// 사람 이름/슬롯/메모/위치 변경 (in-place) + updatedAt 갱신
export function applyPersonPatch(person, { name, slots, memos, locationId } = {}) {
  let changed = false;
  if (typeof name === "string" && name.trim() && person.name !== name.trim()) {
    person.name = name.trim();
    changed = true;
  }
  if (Array.isArray(slots)) {
    const next = [...new Set(slots.map(String))];
    const cur = person.slots || [];
    if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) {
      person.slots = next;
      changed = true;
    }
  }
  if (memos && typeof memos === "object") {
    const prev = JSON.stringify(person.memos || {});
    person.memos = { ...person.memos, ...memos };
    for (const k of Object.keys(person.memos)) {
      if (!person.memos[k]) delete person.memos[k];
    }
    if (JSON.stringify(person.memos) !== prev) changed = true;
  }
  if (locationId !== undefined) {
    const nl = locationId || null;
    if (person.locationId !== nl) { person.locationId = nl; changed = true; }
  }
  if (changed) person.updatedAt = Date.now();
}
