// 저장소(파일/Postgres) 공통 헬퍼 — 순수 로직만 담아 두 저장소가 동일하게 동작하도록 함
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// ─── 요청 스코프 actor (owner | guest | unknown) ─────────────────
// API 라우트에서 actorContext.run(actor, async () => ...)로 감싸면
// 그 안에서 호출되는 addActivity가 자동으로 actor를 기록함.
export const actorContext = new AsyncLocalStorage();
export function getActor() {
  return actorContext.getStore() || "unknown";
}

// ─── 활동 로그(activities) ──────────────────────────────────────────
// 프로젝트에 변경 내역을 남겨두기 위한 헬퍼. 최대 500건만 보관(가장 오래된 것부터 제거).
const ACTIVITY_LIMIT = 500;
export function addActivity(p, type, summary, details = null) {
  if (!Array.isArray(p.activities)) p.activities = [];
  p.activities.push({
    id: randomUUID(),
    ts: Date.now(),
    type,
    summary: String(summary || ""),
    actor: getActor(),
    details: details || null,
  });
  if (p.activities.length > ACTIVITY_LIMIT) {
    p.activities.splice(0, p.activities.length - ACTIVITY_LIMIT);
  }
}

// 사람 스냅샷 (변경 전 후 비교용)
export function snapshotPerson(person) {
  return {
    name: person.name,
    slots: [...(person.slots || [])],
    memos: { ...(person.memos || {}) },
    locationId: person.locationId || null,
  };
}
// 사람 변경 사항을 활동 로그로 남김
export function logPersonChange(p, before, person, patch) {
  if (!before || !person) return;
  if (patch && typeof patch === "object") {
    if (typeof patch.name === "string" && before.name !== person.name) {
      addActivity(p, "person.rename", `사람 이름 변경: ${before.name} → ${person.name}`);
    }
    if (Array.isArray(patch.slots)) {
      const oldSet = new Set(before.slots);
      const newSet = new Set(person.slots);
      const addedKeys = [...newSet].filter((s) => !oldSet.has(s));
      const removedKeys = [...oldSet].filter((s) => !newSet.has(s));
      if (addedKeys.length || removedKeys.length) {
        const parts = [];
        if (addedKeys.length) parts.push(`추가 ${describeSlotsCompact(addedKeys)}`);
        if (removedKeys.length) parts.push(`제거 ${describeSlotsCompact(removedKeys)}`);
        addActivity(
          p,
          "person.slots",
          `${person.name} 일정 — ${parts.join(" / ")}`,
          { added: addedKeys, removed: removedKeys }
        );
      }
    }
    if (patch.memos && typeof patch.memos === "object") {
      for (const k of Object.keys(patch.memos)) {
        const oldVal = (before.memos[k] || "").trim();
        const newVal = (person.memos[k] || "").trim();
        if (oldVal === newVal) continue;
        let summary;
        if (!oldVal) summary = `${person.name} 메모(${k}) 추가: "${truncate(newVal, 40)}"`;
        else if (!newVal) summary = `${person.name} 메모(${k}) 삭제`;
        else summary = `${person.name} 메모(${k}) 수정: "${truncate(oldVal, 24)}" → "${truncate(newVal, 24)}"`;
        addActivity(p, "person.memo", summary);
      }
    }
    if (patch.locationId !== undefined && before.locationId !== person.locationId) {
      const newLocName = nameById(p.locations, person.locationId) || "(분류없음)";
      const oldLocName = nameById(p.locations, before.locationId) || "(분류없음)";
      addActivity(p, "person.move", `${person.name} 위치 이동: ${oldLocName} → ${newLocName}`);
    }
  }
}
function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function nameById(arr, id) {
  if (!id || !Array.isArray(arr)) return null;
  const x = arr.find((it) => it.id === id);
  return x ? x.name : null;
}

// 슬롯 키 배열을 "6/23 14:00–15:30, 6/24 09:00–10:00" 식으로 짧게 요약
// slot 키 형식: "YYYY-MM-DD|HH:MM" (lib/schedule.js slotKey 와 동일)
function describeSlotsCompact(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return "";
  const parsed = [];
  for (const s of slots) {
    const [date, time] = String(s).split("|");
    if (!date || !time) continue;
    const [h, m] = time.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;
    parsed.push({ date, time, minutes: h * 60 + m });
  }
  if (parsed.length === 0) return `${slots.length}칸`;
  // 날짜별로 묶기
  const byDate = new Map();
  for (const item of parsed) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  const segments = [];
  const sortedDates = [...byDate.keys()].sort();
  for (const date of sortedDates) {
    const list = byDate.get(date).sort((a, b) => a.minutes - b.minutes);
    // 연속(30분 간격) 구간 묶기
    const ranges = [];
    let s = list[0];
    let e = list[0];
    for (let i = 1; i < list.length; i++) {
      if (list[i].minutes === e.minutes + 30) e = list[i];
      else { ranges.push([s, e]); s = list[i]; e = list[i]; }
    }
    ranges.push([s, e]);
    // 형식: "6/23 14:00–15:30, 16:00–16:30"
    const [, mm, dd] = date.split("-");
    const dateLabel = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
    const pad2 = (n) => String(n).padStart(2, "0");
    const rangeStr = ranges.map(([a, b]) => {
      const endMin = b.minutes + 30;
      const eh = Math.floor(endMin / 60) % 24;
      const em = endMin % 60;
      return `${a.time}–${pad2(eh)}:${pad2(em)}`;
    }).join(", ");
    segments.push(`${dateLabel} ${rangeStr}`);
  }
  const full = segments.join(" · ");
  if (full.length <= 120) return full;
  return full.slice(0, 110) + `… (총 ${slots.length}칸)`;
}

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
    adminHash: "admin", // URL 뒤에 #xxx로 붙는 관리자 진입용 비밀단어 (오너가 변경 가능)
    notes: "",
    dateColors: {}, // { "YYYY-MM-DD": "red" | ... } 날짜별 강조 색
    activities: [], // 활동 로그 — [{ id, ts, type, summary, details }]
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

// 일정(약속) — { id, title, date, startTime, endTime, description, color, createdAt }
//   color: 팔레트 키(red/orange/...). 기본값 'red'
function sanitizeEventColor(c) {
  if (typeof c !== "string") return null;
  // 'red', 'blue', 'neon-yellow' 같은 케밥 케이스 키 허용
  return /^[a-z]+(-[a-z]+)*$/.test(c) ? c : null;
}
export function newEvent({ title, date, startTime, endTime, description, color } = {}) {
  return {
    id: randomUUID(),
    title: (title || "새 일정").toString().trim() || "새 일정",
    date: date || "",
    startTime: startTime || "",
    endTime: endTime || "",
    description: (description || "").toString(),
    color: sanitizeEventColor(color) || "red",
    createdAt: Date.now(),
  };
}

export function applyEventPatch(ev, { title, date, startTime, endTime, description, color } = {}) {
  if (typeof title === "string" && title.trim()) ev.title = title.trim();
  if (typeof date === "string" && date) ev.date = date;
  if (typeof startTime === "string" && startTime) ev.startTime = startTime;
  if (typeof endTime === "string" && endTime) ev.endTime = endTime;
  if (description !== undefined) ev.description = String(description || "");
  if (color !== undefined) {
    const c = sanitizeEventColor(color);
    if (c) ev.color = c;
  }
}

// 프로젝트 이름/설정/배열 순서/비밀번호 변경 (in-place)
// URL 해시 안에 들어갈 영문/숫자만 허용 (대시·언더스코어 허용)
function sanitizeAdminHash(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^#/, "");
  if (!t) return null;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(t)) return null;
  return t;
}
export function applyProjectPatch(p, { name, config, peopleOrder, teamOrder, locationOrder, adminPassword, sharePassword, adminHash, notes, dateColors } = {}) {
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
  if (adminHash !== undefined) {
    const v = sanitizeAdminHash(adminHash);
    p.adminHash = v || "admin"; // 빈/잘못된 값이면 기본값 'admin'으로 복구
  }
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
