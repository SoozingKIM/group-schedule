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
  applyProjectPatch,
  applyPersonPatch,
  applyTeamPatch,
  applyLocationPatch,
  inferTeamLocation,
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

  function parseDoc(v) {
    const d = typeof v === "string" ? JSON.parse(v) : v;
    if (d) {
      if (!Array.isArray(d.teams)) d.teams = [];
      if (!Array.isArray(d.locations)) d.locations = [];
      if (d.adminPassword === undefined) d.adminPassword = null;
      if (d.sharePassword === undefined) d.sharePassword = null;
      if (d.notes === undefined) d.notes = "";
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
        applyProjectPatch(doc, patch);
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
        return { value: person, commit: true };
      });
      return res.value;
    },

    async updatePerson(projectId, personId, patch) {
      const res = await mutate(projectId, (doc) => {
        const person = doc.people.find((x) => x.id === personId);
        if (!person) return { value: null, commit: false };
        applyPersonPatch(person, patch);
        return { value: person, commit: true };
      });
      return res.value;
    },

    async deletePerson(projectId, personId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.people.findIndex((x) => x.id === personId);
        if (i === -1) return { value: false, commit: false };
        doc.people.splice(i, 1);
        for (const t of doc.teams) t.memberIds = (t.memberIds || []).filter((id) => id !== personId);
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
        return { value: team, commit: true };
      });
      return res.value;
    },

    async updateTeam(projectId, teamId, patch) {
      const res = await mutate(projectId, (doc) => {
        const team = doc.teams.find((t) => t.id === teamId);
        if (!team) return { value: null, commit: false };
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
        return { value: team, commit: true };
      });
      return res.value;
    },

    async deleteTeam(projectId, teamId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.teams.findIndex((t) => t.id === teamId);
        if (i === -1) return { value: false, commit: false };
        doc.teams.splice(i, 1);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },

    async addLocation(projectId, name) {
      const res = await mutate(projectId, (doc) => {
        const loc = newLocation(name);
        doc.locations.push(loc);
        // 분류 없는 사람들을 이 새 위치로 자동 편입
        for (const person of doc.people) {
          if (!person.locationId || !doc.locations.some((l) => l.id === person.locationId)) {
            person.locationId = loc.id;
          }
        }
        return { value: loc, commit: true };
      });
      return res.value;
    },

    async updateLocation(projectId, locationId, patch) {
      const res = await mutate(projectId, (doc) => {
        const loc = doc.locations.find((l) => l.id === locationId);
        if (!loc) return { value: null, commit: false };
        applyLocationPatch(loc, patch);
        return { value: loc, commit: true };
      });
      return res.value;
    },

    async deleteLocation(projectId, locationId) {
      const res = await mutate(projectId, (doc) => {
        const i = doc.locations.findIndex((l) => l.id === locationId);
        if (i === -1) return { value: false, commit: false };
        doc.locations.splice(i, 1);
        for (const person of doc.people) {
          if (person.locationId === locationId) person.locationId = null;
        }
        doc.teams = doc.teams.filter((t) => t.locationId !== locationId);
        return { value: true, commit: true };
      });
      return res.found ? res.value : false;
    },
  };
}
