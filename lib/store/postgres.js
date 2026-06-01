// Postgres 저장소 (Vercel + Neon 등 서버리스 배포용).
//
// pool 은 node-postgres 호환 객체 — query(text, params) -> { rows } 형태면 됩니다.
// (@neondatabase/serverless 의 Pool, pg 의 Pool, 테스트용 PGlite 모두 호환)
//
// 프로젝트 전체를 하나의 JSONB 문서로 저장하고, rev 컬럼으로 낙관적 잠금(CAS)을
// 구현해 여러 명이 동시에 입력해도 변경이 유실되지 않게 합니다.
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

export function makePostgresStore(pool) {
  let schemaReady = null;
  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool.query(
        `CREATE TABLE IF NOT EXISTS projects (
           id text PRIMARY KEY,
           doc jsonb NOT NULL,
           rev integer NOT NULL DEFAULT 0,
           updated_at bigint
         )`
      );
    }
    return schemaReady;
  }

  async function q(text, params) {
    await ensureSchema();
    return pool.query(text, params);
  }

  // file.js와 동일한 시드 로직 — 구 프로젝트의 6/23~29 빨강 강조 보존
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

  function parseDoc(v) {
    const d = typeof v === "string" ? JSON.parse(v) : v;
    if (d) {
      if (!Array.isArray(d.teams)) d.teams = [];
      if (!Array.isArray(d.locations)) d.locations = [];
      if (d.adminPassword === undefined) d.adminPassword = null;
      if (d.sharePassword === undefined) d.sharePassword = null;
      if (!d.adminHash || typeof d.adminHash !== "string") d.adminHash = "admin";
      if (d.notes === undefined) d.notes = "";
      if (!Array.isArray(d.events)) d.events = [];
      if (!d.dateColors || typeof d.dateColors !== "object") {
        d.dateColors = seedLegacyDateColors(d);
      }
      if (!Array.isArray(d.activities)) d.activities = [];
      for (const person of d.people || []) {
        if (person.locationId === undefined) person.locationId = null;
        if (person.updatedAt === undefined) person.updatedAt = d.updatedAt || Date.now();
      }
      for (const t of d.teams) {
        if (!t.locationId) t.locationId = inferTeamLocation(t, d.people || []);
      }
    }
    return d;
  }

  // 읽기-수정-쓰기를 rev 비교(CAS)로 안전하게 반복
  async function mutate(id, fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await q(`SELECT doc, rev FROM projects WHERE id = $1`, [id]);
      if (r.rows.length === 0) return { found: false, value: null };
      const doc = parseDoc(r.rows[0].doc);
      const expected = r.rows[0].rev;
      const out = fn(doc); // { value, commit }
      if (!out.commit) return { found: true, value: out.value };
      const newRev = expected + 1;
      doc.rev = newRev;
      doc.updatedAt = Date.now();
      const u = await q(
        `UPDATE projects SET doc = $2::jsonb, rev = $3, updated_at = $4
         WHERE id = $1 AND rev = $5 RETURNING id`,
        [id, JSON.stringify(doc), newRev, doc.updatedAt, expected]
      );
      if (u.rows.length === 1) return { found: true, value: out.value };
      // rev가 바뀌었으면(다른 사람이 먼저 저장) 다시 시도
    }
    throw new Error("동시 수정이 반복되어 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  return {
    async listProjects() {
      const r = await q(`SELECT doc FROM projects ORDER BY updated_at DESC NULLS LAST`);
      return r.rows.map((row) => summary(parseDoc(row.doc)));
    },

    async createProject(name) {
      const p = newProject(name);
      await q(
        `INSERT INTO projects (id, doc, rev, updated_at) VALUES ($1, $2::jsonb, $3, $4)`,
        [p.id, JSON.stringify(p), p.rev, p.updatedAt]
      );
      return p;
    },

    async getProject(id) {
      const r = await q(`SELECT doc FROM projects WHERE id = $1`, [id]);
      return r.rows.length ? parseDoc(r.rows[0].doc) : null;
    },

    async getRev(id) {
      const r = await q(`SELECT rev FROM projects WHERE id = $1`, [id]);
      return r.rows.length ? r.rows[0].rev : null;
    },

    async updateProject(id, patch) {
      const res = await mutate(id, (doc) => {
        const before = {
          name: doc.name,
          config: { ...(doc.config || {}) },
          notes: doc.notes || "",
          dateColors: { ...(doc.dateColors || {}) },
          adminPassword: doc.adminPassword || "",
          adminHash: doc.adminHash || "admin",
        };
        applyProjectPatch(doc, patch);
        if (patch?.name !== undefined && before.name !== doc.name) {
          addActivity(doc, "project.rename", `프로젝트 이름: ${before.name} → ${doc.name}`);
        }
        if (patch?.config) {
          const parts = [];
          if (before.config.startDate !== doc.config.startDate) parts.push(`시작일 ${before.config.startDate} → ${doc.config.startDate}`);
          if (before.config.endDate !== doc.config.endDate) parts.push(`종료일 ${before.config.endDate} → ${doc.config.endDate}`);
          if (before.config.startTime !== doc.config.startTime) parts.push(`시작시간 ${before.config.startTime} → ${doc.config.startTime}`);
          if (before.config.endTime !== doc.config.endTime) parts.push(`종료시간 ${before.config.endTime} → ${doc.config.endTime}`);
          if (parts.length) addActivity(doc, "config", `표 설정 변경: ${parts.join(", ")}`);
        }
        if (patch?.notes !== undefined && before.notes !== doc.notes) {
          const action = !before.notes ? "추가" : !doc.notes ? "삭제" : "수정";
          addActivity(doc, "notes", `프로젝트 메모 ${action}`);
        }
        if (patch?.dateColors !== undefined) {
          const oldKeys = Object.keys(before.dateColors).length;
          const newKeys = Object.keys(doc.dateColors).length;
          if (oldKeys !== newKeys || JSON.stringify(before.dateColors) !== JSON.stringify(doc.dateColors)) {
            addActivity(doc, "color", `날짜 색 설정 변경 (${oldKeys}개 → ${newKeys}개 칠해짐)`);
          }
        }
        if (patch?.adminPassword !== undefined && before.adminPassword !== (doc.adminPassword || "")) {
          const action = !before.adminPassword ? "설정" : !doc.adminPassword ? "해제" : "변경";
          addActivity(doc, "security", `관리자 비밀번호 ${action}`);
        }
        if (patch?.adminHash !== undefined && before.adminHash !== doc.adminHash) {
          addActivity(doc, "security", `관리자 진입 비밀단어 변경`);
        }
        if (Array.isArray(patch?.peopleOrder)) addActivity(doc, "reorder", "사람 순서 변경");
        if (Array.isArray(patch?.teamOrder)) addActivity(doc, "reorder", "팀 순서 변경");
        if (Array.isArray(patch?.locationOrder)) addActivity(doc, "reorder", "위치 순서 변경");
        return { value: doc, commit: true };
      });
      return res.value;
    },

    async deleteProject(id) {
      const r = await q(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
      return r.rows.length === 1;
    },

    async addPerson(projectId, name, locationId = null) {
      const res = await mutate(projectId, (doc) => {
        const validLocId = locationId && doc.locations.some((l) => l.id === locationId) ? locationId : null;
        const person = newPerson(doc, name, validLocId);
        doc.people.push(person);
        const locName = (doc.locations.find((l) => l.id === validLocId) || {}).name || "(분류없음)";
        addActivity(doc, "person.add", `사람 추가: ${person.name} (${locName})`);
        return { value: person, commit: true };
      });
      return res.value;
    },

    async updatePerson(projectId, personId, patch) {
      const res = await mutate(projectId, (doc) => {
        const person = doc.people.find((x) => x.id === personId);
        if (!person) return { value: null, commit: false };
        const before = snapshotPerson(person);
        applyPersonPatch(person, patch);
        logPersonChange(doc, before, person, patch);
        return { value: person, commit: true };
      });
      return res.value;
    },

    async deletePerson(projectId, personId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.people.findIndex((x) => x.id === personId);
        if (i === -1) return { value: false, commit: false };
        const removed = doc.people[i];
        doc.people.splice(i, 1);
        for (const t of doc.teams) t.memberIds = (t.memberIds || []).filter((id) => id !== personId);
        addActivity(doc, "person.delete", `사람 삭제: ${removed.name}`);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },

    async addTeam(projectId, name, memberIds, locationId) {
      const res = await mutate(projectId, (doc) => {
        const targetLoc = locationId || null;
        const valid = (memberIds || []).filter((id) => {
          const person = doc.people.find((x) => x.id === id);
          return person && (person.locationId || null) === targetLoc;
        });
        const team = newTeam(name, valid, targetLoc);
        doc.teams.push(team);
        const locName = (doc.locations.find((l) => l.id === targetLoc) || {}).name || "(분류없음)";
        addActivity(doc, "team.add", `팀 추가: ${team.name} (${locName}, ${valid.length}명)`);
        return { value: team, commit: true };
      });
      return res.value;
    },

    async updateTeam(projectId, teamId, patch) {
      const res = await mutate(projectId, (doc) => {
        const team = doc.teams.find((t) => t.id === teamId);
        if (!team) return { value: null, commit: false };
        const beforeName = team.name;
        const beforeMembers = team.memberIds.length;
        let p = patch;
        if (Array.isArray(p?.memberIds)) {
          p = {
            ...p,
            memberIds: p.memberIds.filter((id) => {
              const person = doc.people.find((x) => x.id === id);
              return person && (person.locationId || null) === (team.locationId || null);
            }),
          };
        }
        applyTeamPatch(team, p);
        if (typeof p?.name === "string" && beforeName !== team.name) {
          addActivity(doc, "team.rename", `팀 이름 변경: ${beforeName} → ${team.name}`);
        }
        if (Array.isArray(p?.memberIds) && beforeMembers !== team.memberIds.length) {
          addActivity(doc, "team.members", `${team.name} 팀원 수: ${beforeMembers} → ${team.memberIds.length}명`);
        }
        return { value: team, commit: true };
      });
      return res.value;
    },

    async deleteTeam(projectId, teamId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.teams.findIndex((t) => t.id === teamId);
        if (i === -1) return { value: false, commit: false };
        const removed = doc.teams[i];
        doc.teams.splice(i, 1);
        addActivity(doc, "team.delete", `팀 삭제: ${removed.name}`);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },

    async addLocation(projectId, name) {
      const res = await mutate(projectId, (doc) => {
        const loc = newLocation(name);
        doc.locations.push(loc);
        for (const person of doc.people) {
          if (!person.locationId || !doc.locations.some((l) => l.id === person.locationId)) {
            person.locationId = loc.id;
          }
        }
        addActivity(doc, "location.add", `위치 추가: ${loc.name}`);
        return { value: loc, commit: true };
      });
      return res.value;
    },

    async updateLocation(projectId, locationId, patch) {
      const res = await mutate(projectId, (doc) => {
        const loc = doc.locations.find((l) => l.id === locationId);
        if (!loc) return { value: null, commit: false };
        const beforeName = loc.name;
        applyLocationPatch(loc, patch);
        if (typeof patch?.name === "string" && beforeName !== loc.name) {
          addActivity(doc, "location.rename", `위치 이름 변경: ${beforeName} → ${loc.name}`);
        }
        return { value: loc, commit: true };
      });
      return res.value;
    },

    async deleteLocation(projectId, locationId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.locations.findIndex((l) => l.id === locationId);
        if (i === -1) return { value: false, commit: false };
        const removed = doc.locations[i];
        doc.locations.splice(i, 1);
        for (const person of doc.people) {
          if (person.locationId === locationId) person.locationId = null;
        }
        doc.teams = doc.teams.filter((t) => t.locationId !== locationId);
        addActivity(doc, "location.delete", `위치 삭제: ${removed.name}`);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },

    async addEvent(projectId, payload) {
      const res = await mutate(projectId, (doc) => {
        if (!Array.isArray(doc.events)) doc.events = [];
        const ev = newEvent(payload || {});
        doc.events.push(ev);
        addActivity(doc, "event.add", `일정 추가: ${ev.title} (${ev.date} ${ev.startTime}–${ev.endTime})`);
        return { value: ev, commit: true };
      });
      return res.value;
    },

    async updateEvent(projectId, eventId, patch) {
      const res = await mutate(projectId, (doc) => {
        const ev = (doc.events || []).find((e) => e.id === eventId);
        if (!ev) return { value: null, commit: false };
        const before = { title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime };
        applyEventPatch(ev, patch);
        const changed = [];
        if (before.title !== ev.title) changed.push(`제목 ${before.title} → ${ev.title}`);
        if (before.date !== ev.date) changed.push(`날짜 ${before.date} → ${ev.date}`);
        if (before.startTime !== ev.startTime || before.endTime !== ev.endTime) {
          changed.push(`시간 ${before.startTime}–${before.endTime} → ${ev.startTime}–${ev.endTime}`);
        }
        if (changed.length) addActivity(doc, "event.update", `일정 수정: ${ev.title} (${changed.join(", ")})`);
        return { value: ev, commit: true };
      });
      return res.value;
    },

    async deleteEvent(projectId, eventId) {
      const res = await mutate(projectId, (doc) => {
        const i = (doc.events || []).findIndex((e) => e.id === eventId);
        if (i === -1) return { value: false, commit: false };
        const removed = doc.events[i];
        doc.events.splice(i, 1);
        addActivity(doc, "event.delete", `일정 삭제: ${removed.title} (${removed.date})`);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },
  };
}
