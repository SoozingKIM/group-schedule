"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "@/lib/ui";
import ScheduleGrid from "@/components/ScheduleGrid";
import OverviewGrid from "@/components/OverviewGrid";

function formatRelative(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString())
    return `어제 ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ProjectPage({ params }) {
  const { id } = params;
  const router = useRouter();

  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'multi' | personId
  const [cfg, setCfg] = useState(null); // 설정 입력 임시값
  const [saving, setSaving] = useState(false); // 저장 중 여부
  const [lastSaved, setLastSaved] = useState(null); // 마지막 자동 저장 시각
  const [editing, setEditing] = useState(false); // 사람 탭에서 일정 수정 모드
  const [multiSel, setMultiSel] = useState(() => new Set()); // '여러명 보기'에서 선택한 사람 id 집합
  const [teamModal, setTeamModal] = useState(null); // null | { editingId?: string }
  const [dragging, setDragging] = useState(null); // { kind:'team'|'person', id }
  const [dragOver, setDragOver] = useState(null); // { kind, id }
  const [compare, setCompare] = useState(null); // null | { left: locId, right: locId }
  const [dupModal, setDupModal] = useState(null); // null | { name, locationId, existingLocations, suggestedName }
  const [locSubTabs, setLocSubTabs] = useState({}); // { locId: lastActiveTabInThatLocation } — 위치 전환 시 복원용
  const subTabsLoadedRef = useRef(false); // sessionStorage 1회만 로드
  const [notesEditing, setNotesEditing] = useState(false); // 비었을 때 오너가 '메모 쓰기' 누르면 패널 펼침
  const [authMode, setAuthMode] = useState("loading"); // 'loading' | 'pending' | 'owner' | 'guest'
  const [authError, setAuthError] = useState(null);
  const [shareModal, setShareModal] = useState(false);

  // 권한: 프로젝트 로드 시 세션에서 권한 복원 또는 게이트
  useEffect(() => {
    if (!project) return;
    if (!project.adminPassword && !project.sharePassword) {
      setAuthMode("owner");
      return;
    }
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(`auth_${project.id}`);
    if (stored === "owner" || stored === "guest") setAuthMode(stored);
    else setAuthMode("pending");
  }, [project?.id, project?.adminPassword, project?.sharePassword]);

  function tryAuth(pw) {
    if (!project) return;
    if (project.adminPassword && pw === project.adminPassword) {
      setAuthMode("owner");
      window.sessionStorage.setItem(`auth_${project.id}`, "owner");
      setAuthError(null);
    } else if (project.sharePassword && pw === project.sharePassword) {
      setAuthMode("guest");
      window.sessionStorage.setItem(`auth_${project.id}`, "guest");
      setAuthError(null);
    } else {
      setAuthError("비밀번호가 맞지 않습니다.");
    }
  }
  const isOwner = authMode === "owner";
  const isGuest = authMode === "guest";

  // 탭이 바뀌면 수정 모드 OFF + 여러명 보기 선택 초기화
  useEffect(() => {
    setEditing(false);
    setMultiSel(new Set());
  }, [activeTab]);

  // 1) sessionStorage에서 이전 세션의 위치별 마지막 탭 복원 (프로젝트 로드 직후, 1회만)
  useEffect(() => {
    if (!project || subTabsLoadedRef.current) return;
    if (typeof window !== "undefined") {
      try {
        const stored = window.sessionStorage.getItem(`subTabs_${project.id}`);
        if (stored) setLocSubTabs(JSON.parse(stored));
        const storedTab = window.sessionStorage.getItem(`activeTab_${project.id}`);
        if (storedTab) {
          // 복원 가능 여부 검증
          const ok =
            storedTab.startsWith("overview:") ||
            storedTab.startsWith("multi:") ||
            (project.teams || []).some((t) => t.id === storedTab) ||
            project.people.some((p) => p.id === storedTab);
          if (ok) setActiveTab(storedTab);
        }
      } catch {}
    }
    subTabsLoadedRef.current = true;
  }, [project?.id]);

  // 2) activeTab이 바뀔 때마다 "이 위치에서 마지막으로 본 하위 탭"을 저장 — 위치 전환 후 복원에 사용
  useEffect(() => {
    if (!project || !activeTab) return;
    let locKey = null;
    if (activeTab.startsWith("overview:")) locKey = activeTab.slice("overview:".length);
    else if (activeTab.startsWith("multi:")) locKey = activeTab.slice("multi:".length);
    else {
      const team = (project.teams || []).find((t) => t.id === activeTab);
      if (team) locKey = team.locationId || "";
      else {
        const person = project.people.find((p) => p.id === activeTab);
        if (person) locKey = person.locationId || "";
      }
    }
    if (locKey !== null) {
      setLocSubTabs((prev) => (prev[locKey] === activeTab ? prev : { ...prev, [locKey]: activeTab }));
    }
  }, [activeTab, project?.id]);

  // 3) locSubTabs와 activeTab을 sessionStorage에 저장 (새로고침해도 유지)
  useEffect(() => {
    if (!project || typeof window === "undefined" || !subTabsLoadedRef.current) return;
    try {
      window.sessionStorage.setItem(`subTabs_${project.id}`, JSON.stringify(locSubTabs));
      window.sessionStorage.setItem(`activeTab_${project.id}`, activeTab);
    } catch {}
  }, [locSubTabs, activeTab, project?.id]);

  // 위치 탭 클릭 시 호출 — 저장된 하위 탭이 있으면 거기로, 없으면 그 위치의 전체취합으로
  function gotoLocation(locId) {
    const key = locId || "";
    const saved = locSubTabs[key];
    if (saved && project) {
      if (saved.startsWith("overview:") || saved.startsWith("multi:")) {
        setActiveTab(saved);
        return;
      }
      const team = (project.teams || []).find((t) => t.id === saved);
      if (team && (team.locationId || "") === key) { setActiveTab(saved); return; }
      const person = project.people.find((p) => p.id === saved);
      if (person && (person.locationId || "") === key) { setActiveTab(saved); return; }
    }
    setActiveTab(`overview:${key}`);
  }

  const revRef = useRef(0);
  const loadedIdRef = useRef(null);

  // ---- 불러오기 ----
  const loadProject = useCallback(async () => {
    try {
      const p = await api.get(`/api/projects/${id}`);
      revRef.current = p.rev || 0;
      setProject(p);
      // 최초 로드 시에만 탭/설정 초기화 — 첫 위치의 전체취합 또는 분류없음(개인)의 전체취합
      if (loadedIdRef.current !== p.id) {
        loadedIdRef.current = p.id;
        const firstLoc = (p.locations || [])[0];
        setActiveTab(firstLoc ? `overview:${firstLoc.id}` : "overview:");
        setCfg({ ...p.config });
      }
    } catch (e) {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // ---- 변경 폴링 (다른 사람이 입력하면 자동 반영) ----
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const { rev } = await api.get(`/api/projects/${id}/rev`);
        if (rev !== revRef.current) {
          const ae = document.activeElement;
          const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
          if (typing) return; // 입력 중에는 방해하지 않음
          const p = await api.get(`/api/projects/${id}`);
          revRef.current = p.rev || 0;
          setProject(p);
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  // 로컬 변경 후 서버 리비전과 동기 (서버는 쓰기마다 +1)
  function bumpRev() {
    revRef.current += 1;
  }

  // 모든 저장(자동저장)을 감싸 "저장 중" 상태와 "마지막 저장 시각"을 갱신
  async function persist(promise) {
    setSaving(true);
    try {
      const r = await promise;
      setLastSaved(new Date());
      return r;
    } finally {
      setSaving(false);
    }
  }

  // ---- 프로젝트 이름 ----
  async function saveName(name) {
    const n = name.trim();
    if (!n || n === project.name) return;
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { name: n }));
      revRef.current = p.rev || 0;
      setProject(p);
      toast("저장되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 설정 적용 ----
  async function applyConfig() {
    if (cfg.endDate < cfg.startDate) return toast("종료일은 시작일과 같거나 이후여야 합니다.");
    // 종료시간이 시작시간보다 빠르면 익일까지 이어지는 야간 일정으로 처리됩니다.
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { config: cfg }));
      revRef.current = p.rev || 0;
      setProject(p);
      toast("표를 다시 만들었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 사람 ----
  async function doAddPerson(name, locationId) {
    try {
      const person = await persist(
        api.post(`/api/projects/${id}/people`, { name, locationId })
      );
      bumpRev();
      setProject((p) => ({ ...p, people: [...p.people, person] }));
      setActiveTab(person.id);
      toast("추가되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }
  async function addPerson(locationId = null) {
    const name = window.prompt("추가할 사람의 이름을 입력하세요");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // 동명 감지 (대소문자·공백 무시한 비교)
    const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
    const dupes = project.people.filter((p) => norm(p.name) === norm(trimmed));
    if (dupes.length > 0) {
      let suffix = 2;
      while (project.people.some((p) => p.name === `${trimmed} (${suffix})`)) suffix++;
      const existingLocations = [...new Set(dupes.map((p) => {
        const loc = (project.locations || []).find((l) => l.id === p.locationId);
        return loc ? loc.name : "개인";
      }))];
      setDupModal({
        name: trimmed,
        locationId,
        existingLocations,
        suggestedName: `${trimmed} (${suffix})`,
      });
      return;
    }
    await doAddPerson(trimmed, locationId);
  }

  // ---- 위치 ----
  async function createLocation() {
    const name = window.prompt("위치 이름 (예: 홍대, 강남)");
    if (name === null) return;
    const n = name.trim();
    if (!n) return toast("위치 이름을 입력하세요.");
    try {
      const loc = await persist(api.post(`/api/projects/${id}/locations`, { name: n }));
      bumpRev();
      // 분류 없던 사람들도 새 위치에 자동 편입됨 — 서버 응답을 다시 받아 동기화
      const refreshed = await api.get(`/api/projects/${id}`);
      revRef.current = refreshed.rev || 0;
      setProject(refreshed);
      toast(`"${loc.name}" 위치가 추가됐습니다`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function saveLocationName(locId, name) {
    const n = name.trim();
    const cur = (project.locations || []).find((l) => l.id === locId);
    if (!n || !cur || n === cur.name) return;
    try {
      const loc = await persist(api.patch(`/api/projects/${id}/locations/${locId}`, { name: n }));
      bumpRev();
      setProject((p) => ({ ...p, locations: p.locations.map((l) => (l.id === locId ? loc : l)) }));
      toast("저장되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 드래그앤드롭 순서 변경 ----
  function moveById(items, fromId, toId) {
    const from = items.findIndex((x) => x.id === fromId);
    const to = items.findIndex((x) => x.id === toId);
    if (from === -1 || to === -1 || from === to) return null;
    const out = items.slice();
    const [it] = out.splice(from, 1);
    out.splice(to, 0, it);
    return out;
  }

  async function reorderTeams(fromId, toId) {
    const next = moveById(project.teams || [], fromId, toId);
    if (!next) return;
    setProject((p) => ({ ...p, teams: next }));
    try {
      const updated = await persist(
        api.patch(`/api/projects/${id}`, { teamOrder: next.map((t) => t.id) })
      );
      revRef.current = updated.rev || 0;
    } catch (e) {
      toast(e.message);
      loadProject();
    }
  }

  async function reorderLocations(fromId, toId) {
    const next = moveById(project.locations || [], fromId, toId);
    if (!next) return;
    setProject((p) => ({ ...p, locations: next }));
    try {
      const updated = await persist(
        api.patch(`/api/projects/${id}`, { locationOrder: next.map((l) => l.id) })
      );
      revRef.current = updated.rev || 0;
    } catch (e) {
      toast(e.message);
      loadProject();
    }
  }

  async function reorderPeople(fromId, toId) {
    const from = project.people.find((p) => p.id === fromId);
    const to = project.people.find((p) => p.id === toId);
    if (!from || !to || from.locationId !== to.locationId) return; // 같은 위치 안에서만
    const next = moveById(project.people, fromId, toId);
    if (!next) return;
    setProject((p) => ({ ...p, people: next }));
    try {
      const updated = await persist(
        api.patch(`/api/projects/${id}`, { peopleOrder: next.map((p) => p.id) })
      );
      revRef.current = updated.rev || 0;
    } catch (e) {
      toast(e.message);
      loadProject();
    }
  }

  function onTabDragStart(e, kind, tabId) {
    setDragging({ kind, id: tabId });
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", tabId); } catch {}
  }
  function onTabDragOver(e, kind, tabId) {
    if (!dragging || dragging.kind !== kind || dragging.id === tabId) return;
    if (kind === "person") {
      const a = project.people.find((p) => p.id === dragging.id);
      const b = project.people.find((p) => p.id === tabId);
      if (!a || !b || a.locationId !== b.locationId) return; // 다른 위치엔 드롭 불가
    }
    e.preventDefault();
    if (!dragOver || dragOver.id !== tabId) setDragOver({ kind, id: tabId });
  }
  function onTabDrop(e, kind, tabId) {
    if (!dragging || dragging.kind !== kind) return;
    e.preventDefault();
    if (kind === "team") reorderTeams(dragging.id, tabId);
    else if (kind === "person") reorderPeople(dragging.id, tabId);
    else if (kind === "location") reorderLocations(dragging.id, tabId);
    setDragging(null);
    setDragOver(null);
  }
  function onTabDragEnd() {
    setDragging(null);
    setDragOver(null);
  }

  async function removeLocation(locId) {
    const loc = (project.locations || []).find((l) => l.id === locId);
    const pCount = project.people.filter((p) => p.locationId === locId).length;
    const tCount = (project.teams || []).filter((t) => t.locationId === locId).length;
    const parts = [];
    if (pCount > 0) parts.push(`${pCount}명은 '개인'(분류 없음)으로 이동`);
    if (tCount > 0) parts.push(`이 위치의 팀 ${tCount}개는 함께 삭제`);
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    if (!loc || !window.confirm(`"${loc.name}" 위치를 삭제할까요?${detail}`)) return;
    try {
      await persist(api.del(`/api/projects/${id}/locations/${locId}`));
      bumpRev();
      setProject((p) => ({
        ...p,
        locations: p.locations.filter((l) => l.id !== locId),
        people: p.people.map((x) => (x.locationId === locId ? { ...x, locationId: null } : x)),
        teams: p.teams.filter((t) => t.locationId !== locId),
      }));
      setActiveTab((cur) => {
        if (cur === `overview:${locId}` || cur === `multi:${locId}`) {
          const remaining = project.locations.filter((l) => l.id !== locId);
          return remaining[0] ? `overview:${remaining[0].id}` : "overview:";
        }
        return cur;
      });
      toast("삭제되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function savePersonName(personId, name) {
    const n = name.trim();
    const cur = project.people.find((x) => x.id === personId);
    if (!n || !cur || n === cur.name) return;
    try {
      const person = await persist(api.patch(`/api/projects/${id}/people/${personId}`, { name: n }));
      bumpRev();
      setProject((p) => ({ ...p, people: p.people.map((x) => (x.id === personId ? person : x)) }));
      toast("저장되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 팀 ----
  async function createTeam(payload) {
    try {
      const team = await persist(api.post(`/api/projects/${id}/teams`, payload));
      bumpRev();
      setProject((p) => ({ ...p, teams: [...(p.teams || []), team] }));
      setActiveTab(team.id);
      setTeamModal(null);
      toast("팀이 만들어졌습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function saveTeamEdit(teamId, payload) {
    try {
      const team = await persist(api.patch(`/api/projects/${id}/teams/${teamId}`, payload));
      bumpRev();
      setProject((p) => ({ ...p, teams: p.teams.map((t) => (t.id === teamId ? team : t)) }));
      setTeamModal(null);
      toast("저장되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeTeam(teamId) {
    const team = (project.teams || []).find((t) => t.id === teamId);
    if (!team || !window.confirm(`"${team.name}" 팀을 삭제할까요? 사람이 함께 삭제되지는 않습니다.`)) return;
    try {
      await persist(api.del(`/api/projects/${id}/teams/${teamId}`));
      bumpRev();
      setProject((p) => ({ ...p, teams: p.teams.filter((t) => t.id !== teamId) }));
      setActiveTab((cur) => (cur === teamId ? `overview:${team.locationId || ""}` : cur));
      toast("삭제되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function deletePerson(personId) {
    const cur = project.people.find((x) => x.id === personId);
    if (!cur || !window.confirm(`"${cur.name}" 님을 삭제할까요?`)) return;
    try {
      await persist(api.del(`/api/projects/${id}/people/${personId}`));
      bumpRev();
      setProject((p) => {
        const people = p.people.filter((x) => x.id !== personId);
        return { ...p, people };
      });
      setActiveTab((cur2) => (cur2 === personId ? "overview" : cur2));
      toast("삭제되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 슬롯/메모 저장 (해당 사람) ----
  async function commitSlots(personId, slots) {
    setProject((p) => ({
      ...p,
      people: p.people.map((x) => (x.id === personId ? { ...x, slots } : x)),
    }));
    try {
      await persist(api.patch(`/api/projects/${id}/people/${personId}`, { slots }));
      bumpRev();
    } catch (e) {
      toast(e.message);
    }
  }

  async function changeMemo(personId, dateKey, value) {
    const cur = project.people.find((x) => x.id === personId);
    if (!cur) return;
    if ((cur.memos?.[dateKey] || "") === value) return; // 변화 없음
    setProject((p) => ({
      ...p,
      people: p.people.map((x) =>
        x.id === personId ? { ...x, memos: { ...x.memos, [dateKey]: value } } : x
      ),
    }));
    try {
      await persist(api.patch(`/api/projects/${id}/people/${personId}`, { memos: { [dateKey]: value } }));
      bumpRev();
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`"${project.name}" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api.del(`/api/projects/${id}`);
      router.push("/");
    } catch (e) {
      toast(e.message);
    }
  }

  function copyShareLink() {
    const url = window.location.origin + window.location.pathname;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast("공유 링크를 복사했습니다"),
        () => window.prompt("아래 링크를 복사하세요", url)
      );
    } else {
      window.prompt("아래 링크를 복사하세요", url);
    }
  }

  async function saveProjectNotes(notes) {
    if ((project.notes || "") === notes) return;
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { notes }));
      revRef.current = p.rev || 0;
      setProject(p);
    } catch (e) {
      toast(e.message);
    }
  }

  async function savePasswords({ adminPassword, sharePassword }) {
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { adminPassword, sharePassword }));
      revRef.current = p.rev || 0;
      setProject(p);
      // 비밀번호 설정한 현재 세션은 owner로 유지
      window.sessionStorage.setItem(`auth_${id}`, "owner");
      setAuthMode("owner");
      setShareModal(false);
      toast("공유 설정이 저장되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- 렌더 ----
  if (notFound) {
    return (
      <>
        <Topbar onShare={null} onDelete={null} />
        <div className="container">
          <div className="empty-hint">
            프로젝트를 찾을 수 없습니다.
            <br />
            <button className="btn" style={{ marginTop: 14 }} onClick={() => router.push("/")}>
              ← 목록으로
            </button>
          </div>
        </div>
      </>
    );
  }

  if (project && (authMode === "pending" || authMode === "loading")) {
    if (authMode === "pending") {
      return (
        <>
          <Topbar />
          <div className="container">
            <PasswordGate
              projectName={project.name}
              onAuth={tryAuth}
              error={authError}
            />
          </div>
        </>
      );
    }
  }

  if (!project || !cfg) {
    return (
      <>
        <Topbar />
        <div className="container">
          <div className="loading">불러오는 중…</div>
        </div>
      </>
    );
  }

  // 활성 탭 해석
  const isOverviewTab = activeTab.startsWith("overview:");
  const isMultiTab = activeTab.startsWith("multi:");
  const activeTeam = (!isOverviewTab && !isMultiTab)
    ? (project.teams || []).find((t) => t.id === activeTab)
    : null;
  const activePerson = (!isOverviewTab && !isMultiTab && !activeTeam)
    ? project.people.find((x) => x.id === activeTab)
    : null;
  // activeLocId — overview/multi 의 콜론 뒤 값, 또는 팀/사람의 locationId
  const activeLocId = (() => {
    if (isOverviewTab) return activeTab.slice("overview:".length) || null;
    if (isMultiTab) return activeTab.slice("multi:".length) || null;
    if (activeTeam) return activeTeam.locationId || null;
    if (activePerson) return activePerson.locationId || null;
    return null;
  })();
  const activeLoc = activeLocId ? (project.locations || []).find((l) => l.id === activeLocId) : null;
  const activeLocPeople = (isOverviewTab || isMultiTab)
    ? project.people.filter((p) => (p.locationId || null) === activeLocId)
    : [];

  return (
    <>
      <Topbar
        onShare={copyShareLink}
        onShareSettings={isOwner ? () => setShareModal(true) : null}
        onDelete={isOwner ? deleteProject : null}
        onHome={() => router.push("/")}
        protectionOn={!!project.adminPassword || !!project.sharePassword}
      />

      <div className="container">
        <div className="proj-head">
          <input
            className="name-input"
            defaultValue={project.name}
            key={`name-${project.id}`}
            readOnly={isGuest}
            onBlur={(e) => !isGuest && saveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
            aria-label="프로젝트 이름"
          />
          <span className={"save-status" + (saving ? " saving" : "")}>
            {saving
              ? "💾 저장 중…"
              : lastSaved
              ? `✓ 변경 시 자동 저장됨 · 마지막 저장 ${lastSaved.toLocaleTimeString("ko-KR")}`
              : "✓ 모든 변경은 자동 저장됩니다"}
          </span>
        </div>

        {/* 설정 */}
        <div className="panel">
          <h4>표 설정 (30분 단위) · 종료시간을 시작시간보다 빠르게 두면 익일까지 이어집니다</h4>
          <div className="config-grid">
            <div className="field">
              <label>시작일</label>
              <input type="date" value={cfg.startDate} disabled={isGuest} onChange={(e) => setCfg({ ...cfg, startDate: e.target.value })} />
            </div>
            <div className="field">
              <label>종료일</label>
              <input type="date" value={cfg.endDate} disabled={isGuest} onChange={(e) => setCfg({ ...cfg, endDate: e.target.value })} />
            </div>
            <div className="field">
              <label>시작시간</label>
              <input type="time" step="1800" value={cfg.startTime} disabled={isGuest} onChange={(e) => setCfg({ ...cfg, startTime: e.target.value })} />
            </div>
            <div className="field">
              <label>종료시간</label>
              <input type="time" step="1800" value={cfg.endTime} disabled={isGuest} onChange={(e) => setCfg({ ...cfg, endTime: e.target.value })} />
            </div>
            {isOwner && (
              <button className="btn primary" onClick={applyConfig}>
                적용
              </button>
            )}
            {isGuest && (
              <span className="hint" style={{ marginLeft: 4 }}>(공유 모드: 설정 변경 불가)</span>
            )}
          </div>
        </div>

        {compare ? (
          <CompareView
            project={project}
            compare={compare}
            setCompare={setCompare}
          />
        ) : (
        <>
        {/* 선택 영역 — 위치/카테고리/사람 (표 입력 영역과 시각적으로 구분되는 카드) */}
        <div className="select-area">
        {/* 위치 선택 탭 (가로) — 활성 탭 안에서 인라인 이름 수정·삭제 가능 */}
        {(() => {
          const locs = project.locations || [];
          const orphanCount = project.people.filter((p) => !p.locationId || !locs.some((l) => l.id === p.locationId)).length;
          return (
            <div className="tabs location-tabs">
              {locs.map((loc) => {
                const count = project.people.filter((p) => p.locationId === loc.id).length;
                const isActive = activeLocId === loc.id;
                if (isActive) {
                  const isDrag = dragging?.kind === "location" && dragging.id === loc.id;
                  const isOver = dragOver?.kind === "location" && dragOver.id === loc.id;
                  return (
                    <div
                      key={loc.id}
                      className={"tab loc-tab active" + (isDrag ? " dragging" : "") + (isOver ? " drag-over" : "")}
                      draggable={isOwner}
                      onDragStart={isOwner ? (e) => onTabDragStart(e, "location", loc.id) : undefined}
                      onDragOver={isOwner ? (e) => onTabDragOver(e, "location", loc.id) : undefined}
                      onDrop={isOwner ? (e) => onTabDrop(e, "location", loc.id) : undefined}
                      onDragEnd={isOwner ? onTabDragEnd : undefined}
                    >
                      📍
                      <input
                        className="loc-name-inline"
                        defaultValue={loc.name}
                        size={Math.max(loc.name.length + 1, 3)}
                        key={`loc-${loc.id}-${loc.name}`}
                        readOnly={isGuest}
                        onBlur={(e) => !isGuest && saveLocationName(loc.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                        aria-label="위치 이름"
                      />
                      <span className="tab-count">({count}명)</span>
                      {isOwner && (
                        <button
                          className="loc-del-inline"
                          title="위치 삭제"
                          onClick={() => removeLocation(loc.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                }
                const isDrag = dragging?.kind === "location" && dragging.id === loc.id;
                const isOver = dragOver?.kind === "location" && dragOver.id === loc.id;
                return (
                  <button
                    key={loc.id}
                    className={"tab loc-tab" + (isDrag ? " dragging" : "") + (isOver ? " drag-over" : "")}
                    draggable={isOwner}
                    onDragStart={isOwner ? (e) => onTabDragStart(e, "location", loc.id) : undefined}
                    onDragOver={isOwner ? (e) => onTabDragOver(e, "location", loc.id) : undefined}
                    onDrop={isOwner ? (e) => onTabDrop(e, "location", loc.id) : undefined}
                    onDragEnd={isOwner ? onTabDragEnd : undefined}
                    onClick={() => gotoLocation(loc.id)}
                  >
                    📍 {loc.name} <span className="tab-count">({count}명)</span>
                  </button>
                );
              })}
              {(orphanCount > 0 || locs.length === 0) && (
                <button
                  className={"tab loc-tab" + (activeLocId === null ? " active" : "")}
                  onClick={() => gotoLocation("")}
                >
                  📍 개인 <span className="tab-count">({orphanCount}명)</span>
                </button>
              )}
              {isOwner && (
                <button className="tab tab-add" onClick={createLocation}>
                  + 위치 추가
                </button>
              )}
              {locs.length >= 2 && (
                <button
                  className="tab tab-compare"
                  onClick={() => setCompare({ left: locs[0].id, right: locs[1].id })}
                  title="두 위치를 좌우 분할로 비교"
                >
                  🔀 두 장소 비교
                </button>
              )}
            </div>
          );
        })()}

        {/* 활성 위치의 카테고리 + 사람 — 위치 탭에서 선택한 한 위치만 표시 */}
        {(() => {
          const locs = project.locations || [];
          const isOrphan = activeLocId === null;
          const activeSecPeople = project.people.filter((p) => (p.locationId || null) === activeLocId);
          const activeSecTeams = (project.teams || []).filter((t) => (t.locationId || null) === activeLocId);
          const ovKey = `overview:${activeLoc ? activeLoc.id : ""}`;
          const muKey = `multi:${activeLoc ? activeLoc.id : ""}`;
          // 위치도 사람도 없으면 표시 안 함
          if (!activeLoc && activeSecPeople.length === 0 && locs.length > 0) return null;
          return (
            <div className="loc-active">
              <div className="tabs loc-cat-row">
                <button
                  className={"tab overview" + (activeTab === muKey ? " active" : "")}
                  onClick={() => setActiveTab(muKey)}
                >
                  👥 여러명 보기
                </button>
                <button
                  className={"tab overview" + (activeTab === ovKey ? " active" : "")}
                  onClick={() => setActiveTab(ovKey)}
                >
                  🗂 전체 취합 <span className="tab-count">({activeSecPeople.length}명)</span>
                </button>
                {activeSecTeams.map((t) => {
                  const isDrag = dragging?.kind === "team" && dragging.id === t.id;
                  const isOver = dragOver?.kind === "team" && dragOver.id === t.id;
                  return (
                    <button
                      key={t.id}
                      className={
                        "tab team-tab" +
                        (activeTab === t.id ? " active" : "") +
                        (isDrag ? " dragging" : "") +
                        (isOver ? " drag-over" : "")
                      }
                      draggable
                      onDragStart={(e) => onTabDragStart(e, "team", t.id)}
                      onDragOver={(e) => onTabDragOver(e, "team", t.id)}
                      onDrop={(e) => onTabDrop(e, "team", t.id)}
                      onDragEnd={onTabDragEnd}
                      onClick={() => setActiveTab(t.id)}
                    >
                      🏷 {t.name} <span className="tab-count">({t.memberIds.length}명)</span>
                    </button>
                  );
                })}
                {activeLoc && isOwner && (
                  <button
                    className="tab tab-add"
                    onClick={() => {
                      if (activeSecPeople.length === 0) {
                        toast("이 위치에 사람을 먼저 추가하세요.");
                      } else {
                        setTeamModal({ locationId: activeLoc.id });
                      }
                    }}
                  >
                    + 팀 만들기
                  </button>
                )}
              </div>
              <div className="tabs loc-persons-row">
                {activeSecPeople.map((person) => {
                  const isDrag = dragging?.kind === "person" && dragging.id === person.id;
                  const isOver = dragOver?.kind === "person" && dragOver.id === person.id;
                  return (
                    <button
                      key={person.id}
                      className={
                        "tab" +
                        (activeTab === person.id ? " active" : "") +
                        (isDrag ? " dragging" : "") +
                        (isOver ? " drag-over" : "")
                      }
                      draggable
                      onDragStart={(e) => onTabDragStart(e, "person", person.id)}
                      onDragOver={(e) => onTabDragOver(e, "person", person.id)}
                      onDrop={(e) => onTabDrop(e, "person", person.id)}
                      onDragEnd={onTabDragEnd}
                      onClick={() => setActiveTab(person.id)}
                    >
                      {person.name}
                    </button>
                  );
                })}
                {isOwner && (
                  <button
                    className="tab tab-add"
                    onClick={() => addPerson(activeLoc ? activeLoc.id : null)}
                  >
                    + 사람 추가
                  </button>
                )}
              </div>
            </div>
          );
        })()}
        </div>

        {/* 내용 — 표 입력 영역 (선택 영역 카드와 시각적으로 구분) */}
        {isOverviewTab ? (
          <>
            <div className="person-bar">
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                🗂 {activeLoc ? activeLoc.name : "개인"} 전체 취합
              </span>
              <span className="hint">{activeLocPeople.length}명 · 일정을 자동으로 합쳐서 봅니다.</span>
            </div>
            <OverviewGrid
              config={project.config}
              people={activeLocPeople}
              locationName={activeLoc ? activeLoc.name : "개인"}
            />
          </>
        ) : isMultiTab ? (
          <>
            <div className="person-bar">
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                👥 {activeLoc ? activeLoc.name : "개인"} 여러명 보기
              </span>
              <span className="hint" style={{ marginRight: 4 }}>합쳐서 볼 사람을 선택하세요:</span>
              {activeLocPeople.length === 0 && <span className="hint">먼저 사람을 추가하세요.</span>}
              {activeLocPeople.map((p) => {
                const on = multiSel.has(p.id);
                return (
                  <button
                    key={p.id}
                    className={"chip" + (on ? " on" : "")}
                    onClick={() => {
                      const next = new Set(multiSel);
                      if (on) next.delete(p.id);
                      else next.add(p.id);
                      setMultiSel(next);
                    }}
                  >
                    {on ? "✓ " : ""}{p.name}
                  </button>
                );
              })}
              {multiSel.size > 0 && (
                <button className="btn small" onClick={() => setMultiSel(new Set())}>
                  선택 해제
                </button>
              )}
            </div>
            {multiSel.size === 0 ? (
              <div className="empty-hint">위에서 한 명 이상 선택하면 그 사람들의 일정을 합쳐서 봅니다.</div>
            ) : (
              <OverviewGrid
                config={project.config}
                people={activeLocPeople.filter((p) => multiSel.has(p.id))}
                locationName={activeLoc ? activeLoc.name : "개인"}
              />
            )}
          </>
        ) : activeTeam ? (
          <>
            <div className="person-bar">
              {(() => {
                const tLoc = (project.locations || []).find((l) => l.id === activeTeam.locationId);
                return <span className="location-badge">📍 {tLoc ? tLoc.name : "개인"}</span>;
              })()}
              <span style={{ fontSize: 17, fontWeight: 700 }}>🏷 {activeTeam.name}</span>
              <span className="hint">팀원 {activeTeam.memberIds.length}명 · 일정을 자동으로 합쳐서 봅니다.</span>
              {isOwner && (
                <>
                  <button className="btn small" onClick={() => setTeamModal({ editingId: activeTeam.id })}>
                    ✎ 팀 수정
                  </button>
                  <button className="btn danger small" onClick={() => removeTeam(activeTeam.id)}>
                    팀 삭제
                  </button>
                </>
              )}
            </div>
            <OverviewGrid
              config={project.config}
              people={project.people.filter((p) => activeTeam.memberIds.includes(p.id))}
              locationName={(project.locations || []).find((l) => l.id === activeTeam.locationId)?.name || "개인"}
            />
          </>
        ) : activePerson ? (
          <>
            <div className="person-bar">
              {(() => {
                const pLoc = (project.locations || []).find((l) => l.id === activePerson.locationId);
                return <span className="location-badge">📍 {pLoc ? pLoc.name : "개인"}</span>;
              })()}
              <input
                className="name-input"
                style={{ fontSize: 17 }}
                defaultValue={activePerson.name}
                key={`pname-${activePerson.id}`}
                onBlur={(e) => savePersonName(activePerson.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
                aria-label="사람 이름"
              />
              {editing ? (
                <button className="btn primary small" onClick={() => setEditing(false)}>
                  ✓ 완료
                </button>
              ) : (
                <button className="btn small" onClick={() => setEditing(true)}>
                  ✎ 수정하기
                </button>
              )}
              {isOwner && (
                <button className="btn danger small" onClick={() => deletePerson(activePerson.id)}>
                  사람 삭제
                </button>
              )}
              {activePerson.updatedAt && (
                <span className="last-updated" title={new Date(activePerson.updatedAt).toLocaleString("ko-KR")}>
                  🕒 마지막 수정: {formatRelative(activePerson.updatedAt)}
                </span>
              )}
              <span className="hint">
                {editing
                  ? "칸을 클릭하거나 드래그해서 칠하세요. 다시 칠하면 취소됩니다."
                  : "보기 모드입니다. 일정을 바꾸려면 '수정하기'를 누르세요."}
              </span>
            </div>
            <ScheduleGrid
              config={project.config}
              person={activePerson}
              editing={editing}
              onCommitSlots={(slots) => commitSlots(activePerson.id, slots)}
              onMemoChange={(dateKey, value) => changeMemo(activePerson.id, dateKey, value)}
            />
          </>
        ) : null}
        </>
        )}

        {(() => {
          const hasNotes = !!(project.notes && project.notes.trim());
          const showPanel = hasNotes || (isOwner && notesEditing);
          if (showPanel) {
            return (
              <aside className="side-memo">
                <h4>
                  📝 프로젝트 메모
                  {isOwner && !hasNotes && (
                    <button
                      className="side-memo-close"
                      onClick={() => setNotesEditing(false)}
                      title="닫기"
                      aria-label="메모 패널 닫기"
                    >
                      ×
                    </button>
                  )}
                </h4>
                <textarea
                  className="side-memo-input"
                  defaultValue={project.notes || ""}
                  placeholder={isGuest ? "(공유 모드: 읽기 전용)" : "여기에 자유롭게 메모하세요. 포커스를 잃을 때 자동 저장됩니다."}
                  readOnly={isGuest}
                  onBlur={(e) => !isGuest && saveProjectNotes(e.target.value)}
                  key={`notes-${project.id}-${project.rev}`}
                  autoFocus={notesEditing && !hasNotes}
                />
              </aside>
            );
          }
          if (isOwner) {
            return (
              <button
                className="side-memo-add"
                onClick={() => setNotesEditing(true)}
                title="프로젝트 메모 추가"
              >
                📝 메모 쓰기
              </button>
            );
          }
          return null;
        })()}
      </div>

      {shareModal && (
        <ShareModal
          project={project}
          projectUrl={typeof window !== "undefined" ? window.location.origin + window.location.pathname : ""}
          onSave={savePasswords}
          onClose={() => setShareModal(false)}
        />
      )}
      {dupModal && (
        <div className="modal-overlay" onClick={() => setDupModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>이미 "{dupModal.name}"님이 있어요</h3>
            <div className="modal-sub">
              {dupModal.existingLocations.length > 0 && (
                <>({dupModal.existingLocations.join(", ")} 위치에 있음)<br /></>
              )}
              같은 이름의 다른 사람(동명이인)을 추가하려면 번호를 붙이세요.
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDupModal(null)}>취소</button>
              <button className="btn" onClick={() => {
                const lid = dupModal.locationId;
                setDupModal(null);
                setTimeout(() => addPerson(lid), 50);
              }}>이름 다시 입력</button>
              <button className="btn primary" onClick={() => {
                const newName = dupModal.suggestedName;
                const lid = dupModal.locationId;
                setDupModal(null);
                doAddPerson(newName, lid);
              }}>{`번호 붙이기 "${dupModal.suggestedName}"`}</button>
            </div>
          </div>
        </div>
      )}
      {teamModal && (() => {
        // 수정일 땐 그 팀의 위치, 신규일 땐 모달이 가진 위치 컨텍스트
        const editingTeam = teamModal.editingId
          ? project.teams.find((t) => t.id === teamModal.editingId)
          : null;
        const ctxLocId = editingTeam ? editingTeam.locationId : teamModal.locationId;
        const ctxLoc = (project.locations || []).find((l) => l.id === ctxLocId);
        const ctxPeople = project.people.filter((p) => (p.locationId || null) === (ctxLocId || null));
        return (
          <TeamModal
            locationLabel={ctxLoc ? ctxLoc.name : "개인"}
            projectPeople={ctxPeople}
            initial={editingTeam}
            onSave={(payload) => {
              if (editingTeam) saveTeamEdit(editingTeam.id, payload);
              else createTeam({ ...payload, locationId: ctxLocId });
            }}
            onClose={() => setTeamModal(null)}
          />
        );
      })()}
    </>
  );
}

function CompareView({ project, compare, setCompare }) {
  const locs = project.locations || [];
  const peopleAt = (locId) => project.people.filter((p) => p.locationId === locId);
  const Pane = ({ side }) => {
    const locId = compare[side];
    const loc = locs.find((l) => l.id === locId);
    const people = loc ? peopleAt(loc.id) : [];
    return (
      <div className="compare-pane">
        <div className="compare-pane-head">
          <span className="location-badge">📍 {loc?.name || "?"}</span>
          <select
            className="loc-select"
            value={locId || ""}
            onChange={(e) => setCompare({ ...compare, [side]: e.target.value })}
            aria-label={`${side === "left" ? "왼쪽" : "오른쪽"} 위치 선택`}
          >
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({peopleAt(l.id).length}명)
              </option>
            ))}
          </select>
          <span className="hint">전체 취합 · 칸 클릭하여 인원 고정</span>
        </div>
        <OverviewGrid config={project.config} people={people} locationName={loc?.name || "?"} />
      </div>
    );
  };
  return (
    <>
      <div className="select-area">
        <div className="tabs">
          <button className="tab tab-add" onClick={() => setCompare(null)}>
            ← 비교 종료
          </button>
          <span className="tabs-label" style={{ marginLeft: 8 }}>
            🔀 두 장소 좌우 비교 모드 — 양쪽 셀 클릭하여 각각 인원 고정 가능
          </span>
        </div>
      </div>
      <div className="compare-grid">
        <Pane side="left" />
        <Pane side="right" />
      </div>
    </>
  );
}

// 비밀번호 게이트 — 보호된 프로젝트에 처음 접근하면 표시
function PasswordGate({ projectName, onAuth, error }) {
  const [pw, setPw] = useState("");
  return (
    <div className="pw-gate">
      <div className="pw-gate-box">
        <h2>🔒 {projectName}</h2>
        <p className="pw-gate-hint">이 프로젝트는 비밀번호로 보호되어 있습니다.</p>
        <input
          className="pw-gate-input"
          type="password"
          placeholder="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAuth(pw); }}
          autoFocus
        />
        {error && <div className="pw-gate-error">{error}</div>}
        <button className="btn primary" style={{ width: "100%", marginTop: 8 }} onClick={() => onAuth(pw)}>
          확인
        </button>
      </div>
    </div>
  );
}

// 공유 설정 모달 — 비밀번호 보호 ON/OFF + 관리자/공유 비밀번호 + 링크 복사
function ShareModal({ project, projectUrl, onSave, onClose }) {
  const [protectionOn, setProtectionOn] = useState(!!(project.adminPassword || project.sharePassword));
  const [admin, setAdmin] = useState(project.adminPassword || "");
  const [share, setShare] = useState(project.sharePassword || "");
  function copy(text, msg) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(msg));
    else window.prompt("아래를 복사하세요", text);
  }
  function handleSave() {
    if (protectionOn) {
      if (!admin.trim() && !share.trim()) {
        toast("비밀번호를 입력하거나 보호를 끄세요.");
        return;
      }
      onSave({ adminPassword: admin.trim(), sharePassword: share.trim() });
    } else {
      // 보호 OFF — 비밀번호 모두 해제
      onSave({ adminPassword: "", sharePassword: "" });
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h3>🔗 공유 설정</h3>

        <label className="protection-toggle">
          <input
            type="checkbox"
            checked={protectionOn}
            onChange={(e) => setProtectionOn(e.target.checked)}
          />
          <span className="protection-toggle-label">
            <strong>비밀번호로 보호하기</strong>
            <small>
              {protectionOn
                ? "비밀번호를 모르면 들어올 수 없음 — 친구들에게 공유 비번 전달 필요"
                : "누구나 링크만 알면 자유롭게 들어와 편집할 수 있음"}
            </small>
          </span>
        </label>

        {protectionOn ? (
          <>
            <div className="modal-sub" style={{ marginTop: 12 }}>
              관리자 비밀번호로 들어오면 전체 편집 가능, 공유 비밀번호로는 사람 일정만 수정 가능합니다.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <label className="field" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>관리자 비밀번호 (본인만)</span>
                <input
                  className="modal-input"
                  type="text"
                  value={admin}
                  onChange={(e) => setAdmin(e.target.value)}
                  placeholder="예: myAdmin123"
                />
              </label>
              <label className="field" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>공유 비밀번호 (참여자들에게 알려줄)</span>
                <input
                  className="modal-input"
                  type="text"
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                  placeholder="예: team2026"
                />
              </label>
            </div>
          </>
        ) : null}

        <div style={{ marginTop: 14, padding: 10, background: "#f5f7fb", borderRadius: 8, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>참여자에게 전달할 정보</div>
          <div style={{ marginBottom: protectionOn && share ? 6 : 0, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectUrl}</code>
            <button className="btn small" onClick={() => copy(projectUrl, "주소를 복사했습니다")}>주소 복사</button>
          </div>
          {protectionOn && share && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <code style={{ flex: 1 }}>비밀번호: {share}</code>
              <button className="btn small" onClick={() => copy(share, "비밀번호를 복사했습니다")}>비밀번호 복사</button>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  );
}

function TeamModal({ projectPeople, locationLabel, initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [memberIds, setMemberIds] = useState(() => new Set(initial?.memberIds || []));

  function toggle(id) {
    const next = new Set(memberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMemberIds(next);
  }

  function save() {
    const n = name.trim();
    if (!n) {
      toast("팀 이름을 입력하세요.");
      return;
    }
    if (memberIds.size === 0) {
      toast("팀에 포함할 사람을 한 명 이상 선택하세요.");
      return;
    }
    onSave({ name: n, memberIds: [...memberIds] });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {initial ? "팀 수정" : "팀 만들기"}
          {locationLabel && (
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", marginLeft: 8 }}>
              · {locationLabel} 위치
            </span>
          )}
        </h3>
        <input
          className="modal-input"
          placeholder="팀 이름 (예: 디자인팀, A조)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onClose();
          }}
          autoFocus
        />
        <div className="modal-sub">팀에 포함할 사람을 선택하세요 ({memberIds.size}명 선택됨)</div>
        <div className="modal-members">
          {projectPeople.length === 0 && (
            <span className="hint">먼저 사람을 추가해 주세요.</span>
          )}
          {projectPeople.map((p) => {
            const on = memberIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={"chip" + (on ? " on" : "")}
                onClick={() => toggle(p.id)}
              >
                {on ? "✓ " : ""}
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            {initial ? "저장" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Topbar({ onShare, onShareSettings, onDelete, onHome, protectionOn }) {
  return (
    <div className="topbar">
      <span className="brand" style={{ cursor: onHome ? "pointer" : "default" }} onClick={onHome || undefined}>
        📅 일정 취합
      </span>
      <span className="spacer" />
      {onShareSettings && (
        <button className="btn small" onClick={onShareSettings} title="공유 비밀번호 설정">
          {protectionOn ? "🔒 공유 설정" : "🔓 공유 설정"}
        </button>
      )}
      {onShare && (
        <button className="btn small" onClick={onShare}>
          🔗 링크 복사
        </button>
      )}
      {onDelete && (
        <button className="btn small danger" onClick={onDelete}>
          프로젝트 삭제
        </button>
      )}
    </div>
  );
}
