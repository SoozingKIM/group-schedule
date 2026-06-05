"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setActor } from "@/lib/api";
import { toast } from "@/lib/ui";
import ScheduleGrid from "@/components/ScheduleGrid";
import OverviewGrid from "@/components/OverviewGrid";
import { generateDates } from "@/lib/schedule";
import { COLOR_PALETTE, paletteEntry, paletteRgba, paletteDarkText } from "@/lib/colorPalette";

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
  const [localViewCfg, setLocalViewCfg] = useState(null); // 게스트가 본인 화면에만 적용하는 보기 범위
  const [saving, setSaving] = useState(false); // 저장 중 여부
  const [lastSaved, setLastSaved] = useState(null); // 마지막 자동 저장 시각
  const [editing, setEditing] = useState(false); // 사람 탭에서 일정 수정 모드
  const [multiSel, setMultiSel] = useState(() => new Set()); // '여러명 보기'에서 선택한 사람 id 집합
  const [teamModal, setTeamModal] = useState(null); // null | { editingId?: string }
  const [dragging, setDragging] = useState(null); // { kind:'team'|'person', id }
  const [dragOver, setDragOver] = useState(null); // { kind, id }
  const [compare, setCompare] = useState(null); // null | { left: locId, right: locId }
  const [dupModal, setDupModal] = useState(null); // null | { name, locationId, existingLocations, suggestedName }
  const subTabsLoadedRef = useRef(false); // sessionStorage 1회만 로드
  const [notesEditing, setNotesEditing] = useState(false); // 비었을 때 오너가 '메모 쓰기' 누르면 패널 펼침
  const [eventMode, setEventMode] = useState(false); // '일정 잡기' 모드 켰을 때 셀 드래그로 약속 생성
  const [authMode, setAuthMode] = useState("loading"); // 'loading' | 'pending' | 'owner' | 'guest'
  const [authError, setAuthError] = useState(null);
  const [shareModal, setShareModal] = useState(false);
  const [colorModal, setColorModal] = useState(false); // 🎨 색 수정 모달
  // 'schedule' = 기본 표 화면 / 'calendar' = 전체 일정 달력 (전체 영역 차지)
  const [view, setView] = useState("schedule");
  const [eventEditing, setEventEditing] = useState(null); // 수정 중인 일정 객체
  const [activityModal, setActivityModal] = useState(false);

  // 권한 흐름:
  //   · 관리자 비밀번호가 없으면 → 누구든 owner (보호 해제 상태)
  //   · 있으면 → 기본은 guest(=조회 전용), URL 해시 #<adminHash>가 있을 때만 관리자 비밀번호 게이트
  //   · 세션에 이전 인증된 흔적이 있으면 복원
  useEffect(() => {
    if (!project) return;
    if (!project.adminPassword) {
      setAuthMode("owner");
      return;
    }
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(`auth_${project.id}`);
    if (stored === "owner") { setAuthMode("owner"); return; }
    const wanted = "#" + (project.adminHash || "admin");
    if (window.location.hash === wanted) {
      setAuthMode("pending");
      return;
    }
    setAuthMode("guest");
  }, [project?.id, project?.adminPassword, project?.adminHash]);

  function tryAuth(pw) {
    if (!project) return;
    if (project.adminPassword && pw === project.adminPassword) {
      setAuthMode("owner");
      window.sessionStorage.setItem(`auth_${project.id}`, "owner");
      setAuthError(null);
      // URL 해시 흔적 제거 (북마크해두면 다음 접속 시에도 게이트가 다시 뜸)
      if (typeof window !== "undefined" && window.location.hash) {
        try { history.replaceState(null, "", window.location.pathname); } catch {}
      }
    } else {
      setAuthError("비밀번호가 맞지 않습니다.");
    }
  }
  // 게스트가 관리자 모드로 진입하길 원할 때 호출
  function requestAdmin() {
    if (!project) return;
    if (!project.adminPassword) {
      setAuthMode("owner");
      return;
    }
    setAuthMode("pending");
    setAuthError(null);
  }
  const isOwner = authMode === "owner";
  const isGuest = authMode === "guest";
  // API 요청의 X-Actor 헤더에 사용 — 활동 로그가 누가 한 변경인지 알 수 있게
  useEffect(() => {
    if (authMode === "owner" || authMode === "guest") setActor(authMode);
  }, [authMode]);

  // 탭이 바뀌면 수정 모드 OFF + 여러명 보기 선택 초기화
  useEffect(() => {
    setEditing(false);
    setMultiSel(new Set());
  }, [activeTab]);

  // 1) sessionStorage에서 이전 세션의 activeTab 복원 (프로젝트 로드 직후, 1회만)
  useEffect(() => {
    if (!project || subTabsLoadedRef.current) return;
    if (typeof window !== "undefined") {
      try {
        const storedTab = window.sessionStorage.getItem(`activeTab_${project.id}`);
        if (storedTab) {
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

  // 2) activeTab을 sessionStorage에 저장 (새로고침해도 유지)
  useEffect(() => {
    if (!project || typeof window === "undefined" || !subTabsLoadedRef.current) return;
    try {
      window.sessionStorage.setItem(`activeTab_${project.id}`, activeTab);
    } catch {}
  }, [activeTab, project?.id]);

  // 위치 탭 클릭 시 호출 — 현재 보고 있는 뷰의 종류(전체취합/여러명/팀/사람)를 새 위치에서도 유지.
  //   · 새 위치에 같은 이름의 팀/사람이 있으면 그것을 우선 선택
  //   · 없으면 그 위치의 첫 번째 팀/사람으로 폴백
  //   · 종류 자체가 새 위치에 없으면(예: 사람 모드인데 새 위치에 사람 없음) 전체취합으로 폴백
  function gotoLocation(locId) {
    const key = locId || "";
    if (!project) return;

    let kind = "overview"; // 'overview' | 'multi' | 'person' | 'team'
    let curName = null;
    if (activeTab.startsWith("multi:")) {
      kind = "multi";
    } else if (activeTab.startsWith("overview:")) {
      kind = "overview";
    } else {
      const team = (project.teams || []).find((t) => t.id === activeTab);
      if (team) { kind = "team"; curName = team.name; }
      else {
        const person = project.people.find((p) => p.id === activeTab);
        if (person) { kind = "person"; curName = person.name; }
      }
    }

    if (kind === "multi") { setActiveTab(`multi:${key}`); return; }
    if (kind === "team") {
      const teamsHere = (project.teams || []).filter((t) => (t.locationId || "") === key);
      if (teamsHere.length > 0) {
        const same = teamsHere.find((t) => t.name === curName);
        setActiveTab((same || teamsHere[0]).id);
        return;
      }
    }
    if (kind === "person") {
      const peopleHere = project.people.filter((p) => (p.locationId || "") === key);
      if (peopleHere.length > 0) {
        const same = peopleHere.find((p) => p.name === curName);
        setActiveTab((same || peopleHere[0]).id);
        return;
      }
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
  //   · 관리자(owner): 서버에 저장 → 모든 참여자에게 반영
  //   · 게스트: 본인 화면에만 적용 (localViewCfg) — 다른 사람한테 안 보임
  async function applyConfig() {
    if (cfg.endDate < cfg.startDate) return toast("종료일은 시작일과 같거나 이후여야 합니다.");
    if (isGuest) {
      setLocalViewCfg({ ...cfg, slotMinutes: 30 });
      toast("본인 화면에만 보기 범위가 적용됐어요");
      return;
    }
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { config: cfg }));
      revRef.current = p.rev || 0;
      setProject(p);
      // 서버 설정이 바뀌면 게스트가 만져둔 로컬 뷰는 의미 없어지므로 초기화
      setLocalViewCfg(null);
      toast("표를 다시 만들었습니다");
    } catch (e) {
      toast(e.message);
    }
  }
  // 모든 그리드/달력이 사용할 보기 범위 (게스트 로컬 변경 우선)
  const viewConfig = localViewCfg || project?.config || null;

  // ---- 날짜별 색 ----
  async function saveDateColors(dateColors) {
    try {
      const p = await persist(api.patch(`/api/projects/${id}`, { dateColors }));
      revRef.current = p.rev || 0;
      setProject(p);
      toast("날짜 색을 저장했습니다");
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

  async function createEvent(payload) {
    try {
      const ev = await persist(api.post(`/api/projects/${id}/events`, payload));
      bumpRev();
      setProject((p) => ({ ...p, events: [...(p.events || []), ev] }));
      toast("일정이 추가되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeEvent(eventId) {
    try {
      await persist(api.del(`/api/projects/${id}/events/${eventId}`));
      bumpRev();
      setProject((p) => ({ ...p, events: (p.events || []).filter((e) => e.id !== eventId) }));
      toast("일정이 삭제되었습니다");
    } catch (e) {
      toast(e.message);
    }
  }

  async function updateEventFn(eventId, patch) {
    try {
      const ev = await persist(api.patch(`/api/projects/${id}/events/${eventId}`, patch));
      bumpRev();
      setProject((p) => ({ ...p, events: (p.events || []).map((e) => (e.id === eventId ? ev : e)) }));
      toast("일정이 수정되었습니다");
    } catch (e) {
      toast(e.message);
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
        guestHint={isGuest}
        onShowActivity={isOwner ? () => setActivityModal(true) : null}
        activityCount={isOwner ? (project.activities || []).length : 0}
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

        {view === "calendar" ? (
          <EventCalendarPage
            events={project.events || []}
            config={viewConfig}
            dateColors={project.dateColors || {}}
            canDelete={isOwner}
            onDeleteEvent={removeEvent}
            onEditEvent={isOwner ? (ev) => setEventEditing(ev) : null}
            onBack={() => setView("schedule")}
          />
        ) : (
        <>
        {/* 설정 */}
        <div className="panel">
          <h4>표 설정 (30분 단위) · 종료시간을 시작시간보다 빠르게 두면 익일까지 이어집니다</h4>
          <div className="config-grid">
            <div className="field">
              <label>시작일</label>
              <input type="date" value={cfg.startDate} onChange={(e) => setCfg({ ...cfg, startDate: e.target.value })} />
            </div>
            <div className="field">
              <label>종료일</label>
              <input type="date" value={cfg.endDate} onChange={(e) => setCfg({ ...cfg, endDate: e.target.value })} />
            </div>
            <div className="field">
              <label>시작시간</label>
              <input type="time" step="1800" value={cfg.startTime} onChange={(e) => setCfg({ ...cfg, startTime: e.target.value })} />
            </div>
            <div className="field">
              <label>종료시간</label>
              <input type="time" step="1800" value={cfg.endTime} onChange={(e) => setCfg({ ...cfg, endTime: e.target.value })} />
            </div>
            <button className="btn primary" onClick={applyConfig}>
              적용
            </button>
            {isGuest && localViewCfg && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setLocalViewCfg(null);
                  setCfg({ ...project.config });
                  toast("관리자가 정한 기본 보기로 돌아왔어요");
                }}
                title="본인 보기 범위를 해제하고 관리자 설정으로 돌아갑니다"
              >
                ↺ 기본으로
              </button>
            )}
            {isGuest && (
              <span className="hint" style={{ marginLeft: 4 }}>
                (사용자 모드: <strong>{localViewCfg ? "본인 화면에만" : "변경 후 ‘적용’을 누르면 본인 화면에만"} 적용</strong>)
              </span>
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

        {/* 프로젝트 전역 — 위치와 무관한 잡힌 일정 모음 */}
        <div className="project-wide-bar">
          <span className="project-wide-bar-label">🌐 전체 위치 통합</span>
          <CalendarButton onClick={() => setView("calendar")} count={(project.events || []).length} />
        </div>

        {/* 내용 — 표 입력 영역 (선택 영역 카드와 시각적으로 구분) */}
        {isOverviewTab ? (
          <>
            <div className="person-bar">
              <span style={{ fontSize: 17, fontWeight: 700 }}>
                🗂 {activeLoc ? activeLoc.name : "개인"} 전체 취합
              </span>
              <span className="hint">{activeLocPeople.length}명 · 일정을 자동으로 합쳐서 봅니다.</span>
              {isOwner && (
                <>
                  <button
                    type="button"
                    className="btn small color-edit-btn"
                    onClick={() => setColorModal(true)}
                    title="날짜별 색을 지정합니다"
                  >
                    🎨 색 수정
                  </button>
                  <EventModeButton on={eventMode} onToggle={() => setEventMode((v) => !v)} />
                </>
              )}
            </div>
            <OverviewGrid
              config={viewConfig}
              people={activeLocPeople}
              locationName={activeLoc ? activeLoc.name : "개인"}
              events={project.events || []}
              eventMode={eventMode && isOwner}
              onCreateEvent={createEvent}
              onDeleteEvent={removeEvent}
              onEditEvent={isOwner ? (ev) => setEventEditing(ev) : undefined}
              dateColors={project.dateColors || {}}
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
              {isOwner && multiSel.size > 0 && (
                <EventModeButton on={eventMode} onToggle={() => setEventMode((v) => !v)} />
              )}
            </div>
            {multiSel.size === 0 ? (
              <div className="empty-hint">위에서 한 명 이상 선택하면 그 사람들의 일정을 합쳐서 봅니다.</div>
            ) : (
              <OverviewGrid
                config={viewConfig}
                people={activeLocPeople.filter((p) => multiSel.has(p.id))}
                locationName={activeLoc ? activeLoc.name : "개인"}
                events={project.events || []}
                eventMode={eventMode && isOwner}
                onCreateEvent={createEvent}
                onDeleteEvent={removeEvent}
              onEditEvent={isOwner ? (ev) => setEventEditing(ev) : undefined}
                dateColors={project.dateColors || {}}
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
                  <EventModeButton on={eventMode} onToggle={() => setEventMode((v) => !v)} />
                </>
              )}
            </div>
            <TeamScheduleView
              team={activeTeam}
              config={viewConfig}
              people={project.people.filter((p) => activeTeam.memberIds.includes(p.id))}
              locationName={(project.locations || []).find((l) => l.id === activeTeam.locationId)?.name || "개인"}
              events={project.events || []}
              eventMode={eventMode && isOwner}
              onCreateEvent={createEvent}
              onDeleteEvent={removeEvent}
              onEditEvent={isOwner ? (ev) => setEventEditing(ev) : undefined}
              dateColors={project.dateColors || {}}
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
                readOnly={isGuest}
                onBlur={(e) => !isGuest && savePersonName(activePerson.id, e.target.value)}
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
              config={viewConfig}
              person={activePerson}
              editing={editing}
              onCommitSlots={(slots) => commitSlots(activePerson.id, slots)}
              onMemoChange={(dateKey, value) => changeMemo(activePerson.id, dateKey, value)}
              dateColors={project.dateColors || {}}
            />
          </>
        ) : null}
        </>
        )}
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
                  placeholder={isGuest ? "(사용자 모드: 읽기 전용)" : "여기에 자유롭게 메모하세요. 포커스를 잃을 때 자동 저장됩니다."}
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
      {colorModal && (
        <ColorEditModal
          project={project}
          onSave={(dc) => { saveDateColors(dc); setColorModal(false); }}
          onClose={() => setColorModal(false)}
        />
      )}
      {activityModal && (
        <ActivityLogModal
          activities={project.activities || []}
          onClose={() => setActivityModal(false)}
        />
      )}
      {eventEditing && (
        <EventEditModal
          event={eventEditing}
          onSave={async (patch) => {
            await updateEventFn(eventEditing.id, patch);
            setEventEditing(null);
          }}
          onDelete={() => {
            if (window.confirm(`"${eventEditing.title}" 일정을 삭제할까요?`)) {
              removeEvent(eventEditing.id);
              setEventEditing(null);
            }
          }}
          onClose={() => setEventEditing(null)}
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
        <OverviewGrid
          config={viewConfig}
          people={people}
          locationName={loc?.name || "?"}
          events={project.events || []}
          dateColors={project.dateColors || {}}
        />
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
// 활동 내역 모달 — 누가/어떤 변경을 했는지 시간순으로 (관리자 전용)
function ActivityLogModal({ activities, onClose }) {
  // 최신부터 보여주기
  const sorted = useMemo(
    () => [...(activities || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    [activities]
  );
  const [filter, setFilter] = useState("all"); // all | person | event | config | other | guest | owner

  function matchesFilter(a) {
    if (filter === "all") return true;
    if (filter === "guest") return a.actor === "guest";
    if (filter === "owner") return a.actor === "owner";
    if (filter === "person") return a.type?.startsWith("person.");
    if (filter === "event") return a.type?.startsWith("event.");
    if (filter === "config") return a.type === "config" || a.type === "project.rename" || a.type === "notes" || a.type === "color" || a.type === "reorder";
    if (filter === "other") return !a.type?.startsWith("person.") && !a.type?.startsWith("event.") && a.type !== "config" && a.type !== "project.rename" && a.type !== "notes" && a.type !== "color" && a.type !== "reorder";
    return true;
  }
  const filtered = sorted.filter(matchesFilter);
  const guestCount = sorted.filter((a) => a.actor === "guest").length;
  const ownerCount = sorted.filter((a) => a.actor === "owner").length;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function iconFor(type) {
    if (type?.startsWith("person.slots")) return "🗓";
    if (type?.startsWith("person.memo")) return "📝";
    if (type?.startsWith("person.add")) return "➕";
    if (type?.startsWith("person.delete")) return "🗑";
    if (type?.startsWith("person.rename")) return "✎";
    if (type?.startsWith("person.move")) return "📍";
    if (type?.startsWith("team.")) return "🏷";
    if (type?.startsWith("location.")) return "📍";
    if (type?.startsWith("event.")) return "📅";
    if (type === "config") return "⚙️";
    if (type === "color") return "🎨";
    if (type === "notes") return "📓";
    if (type === "security") return "🔐";
    if (type === "reorder") return "↕️";
    return "•";
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal activity-log-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 6 }}>📋 수정 내역 <small style={{ fontWeight: 400, color: "var(--muted)" }}>· {sorted.length}건 (최대 500건 보관)</small></h3>
        <div className="activity-filter-row">
          {[
            { k: "all", label: `전체 ${sorted.length}` },
            { k: "owner", label: `👑 관리자 ${ownerCount}` },
            { k: "guest", label: `👤 참여자 ${guestCount}` },
            { k: "person", label: "사람" },
            { k: "event", label: "일정" },
            { k: "config", label: "설정" },
            { k: "other", label: "기타" },
          ].map((f) => (
            <button
              key={f.k}
              type="button"
              className={"activity-filter-chip" + (filter === f.k ? " on" : "")}
              onClick={() => setFilter(f.k)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="empty-hint" style={{ padding: "30px 12px", textAlign: "center" }}>
            기록된 수정 내역이 없습니다.
          </div>
        ) : (
          <ol className="activity-list">
            {filtered.map((a) => (
              <li key={a.id} className={"activity-item actor-" + (a.actor || "unknown")}>
                <span className="activity-icon">{iconFor(a.type)}</span>
                <div className="activity-body">
                  <div className="activity-summary">
                    {a.actor === "owner" && <span className="actor-badge owner">👑 관리자</span>}
                    {a.actor === "guest" && <span className="actor-badge guest">👤 참여자</span>}
                    <span>{a.summary}</span>
                  </div>
                  <div className="activity-time">{formatTimestamp(a.ts)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `오늘 ${time}`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `어제 ${time}`;
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 일정 수정 모달 — 제목/날짜/시작·종료 시간/설명을 편집
function EventEditModal({ event, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(event.title || "");
  const [date, setDate] = useState(event.date || "");
  const [startTime, setStartTime] = useState(event.startTime || "");
  const [endTime, setEndTime] = useState(event.endTime || "");
  const [description, setDescription] = useState(event.description || "");
  const [color, setColor] = useState(event.color || "red");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) { toast("제목을 입력하세요."); return; }
    if (!date) { toast("날짜를 선택하세요."); return; }
    if (!startTime || !endTime) { toast("시작·종료 시간을 입력하세요."); return; }
    setSubmitting(true);
    await onSave({ title: t, date, startTime, endTime, description: description.trim(), color });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>✎ 일정 수정</h3>
        <form onSubmit={submit}>
          <label className="evt-edit-row">
            <span>제목</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} autoFocus />
          </label>
          <label className="evt-edit-row">
            <span>날짜</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="evt-edit-row">
            <span>시간</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <span>–</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <label className="evt-edit-row">
            <span>설명</span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="설명 (선택)"
            />
          </label>
          <div className="evt-edit-row">
            <span>색</span>
            <div className="evt-color-swatches" style={{ flex: 1 }}>
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={"evt-color-swatch" + (color === c.key ? " active" : "")}
                  style={{ background: c.hex, width: 22, height: 22 }}
                  onClick={() => setColor(c.key)}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>
          <div className="modal-actions">
            {onDelete && (
              <button type="button" className="btn danger small" onClick={onDelete} disabled={submitting}>
                🗑 삭제
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>취소</button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 전체 일정 달력 — 메인 화면을 통째로 차지하는 풀스크린 뷰
function EventCalendarPage({ events, config, dateColors, canDelete, onDeleteEvent, onEditEvent, onBack }) {
  // 날짜별 일정 묶음 + startTime 기준 정렬
  const byDate = useMemo(() => {
    const m = new Map();
    for (const ev of events) {
      if (!ev.date) continue;
      if (!m.has(ev.date)) m.set(ev.date, []);
      m.get(ev.date).push(ev);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    }
    return m;
  }, [events]);

  // 일정이 있는 월 + 프로젝트 시작·종료 월을 모두 포함
  const months = useMemo(() => {
    const seen = new Set();
    const add = (y, m) => seen.add(`${y}-${String(m).padStart(2, "0")}`);
    // 프로젝트 범위
    if (config?.startDate) {
      const s = new Date(config.startDate);
      const e = new Date(config.endDate || config.startDate);
      let cur = new Date(s.getFullYear(), s.getMonth(), 1);
      const end = new Date(e.getFullYear(), e.getMonth(), 1);
      while (cur <= end) {
        add(cur.getFullYear(), cur.getMonth() + 1);
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    // 일정이 있는 월도 추가 (범위 밖일 수 있음)
    for (const k of byDate.keys()) {
      const d = new Date(k);
      if (!isNaN(d)) add(d.getFullYear(), d.getMonth() + 1);
    }
    return [...seen].sort().map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m - 1 }; // month 0-indexed
    });
  }, [byDate, config]);

  function handleDelete(ev) {
    if (!onDeleteEvent) return;
    if (window.confirm(`"${ev.title}" 일정을 삭제할까요?`)) onDeleteEvent(ev.id);
  }

  return (
    <div className="event-cal-page">
      <div className="event-cal-head">
        {onBack && (
          <button type="button" className="btn small" onClick={onBack} title="일정 표로 돌아갑니다">
            ← 일정 표로
          </button>
        )}
        <h3 style={{ margin: 0 }}>🗓 전체 일정{events.length > 0 ? ` (${events.length}개)` : ""}</h3>
        <span style={{ flex: 1 }} />
        {onEditEvent && <span className="hint">💡 일정을 클릭하면 수정할 수 있어요</span>}
      </div>
      {events.length === 0 ? (
        <div className="empty-hint" style={{ padding: "40px 12px", textAlign: "center" }}>
          아직 잡힌 일정이 없습니다.<br />
          <span className="hint">전체취합 표에서 <strong>📅 일정 잡기</strong>를 켜고 셀을 드래그해 추가할 수 있어요.</span>
        </div>
      ) : (
        <div className="event-cal-months">
          {months.map(({ year, month }) => (
            <MonthCalendar
              key={`${year}-${month}`}
              year={year}
              month={month}
              byDate={byDate}
              dateColors={dateColors}
              canDelete={canDelete}
              onDelete={handleDelete}
              onEdit={onEditEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthCalendar({ year, month, byDate, dateColors, canDelete, onDelete, onEdit }) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const pad2 = (n) => String(n).padStart(2, "0");

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d, key: `${year}-${pad2(month + 1)}-${pad2(d)}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="month-cal">
      <div className="month-cal-title">{year}년 {month + 1}월</div>
      <div className="month-cal-weekdays">
        {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
          <div key={d} className={"month-cal-wd" + (i === 0 ? " sun" : i === 6 ? " sat" : "")}>{d}</div>
        ))}
      </div>
      <div className="month-cal-grid">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="month-cal-day blank" />;
          const evs = byDate.get(cell.key) || [];
          const colorKey = dateColors && dateColors[cell.key];
          const entry = colorKey ? paletteEntry(colorKey) : null;
          const dow = i % 7;
          return (
            <div
              key={i}
              className={"month-cal-day" + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") + (entry ? " marked" : "")}
              style={entry ? { borderColor: entry.hex, background: paletteRgba(colorKey, 0.07) } : undefined}
            >
              <div className="day-num">{cell.d}</div>
              {evs.map((ev) => {
                const eHex = paletteEntry(ev.color || "red")?.hex || "#e5484d";
                const eHexLight = paletteRgba(ev.color || "red", 0.10) || "#fff5f5";
                const eHexDark = paletteDarkText(ev.color || "red");
                return (
                <div
                  key={ev.id}
                  className={"day-evt" + (onEdit ? " clickable" : "")}
                  style={{ borderLeftColor: eHex, background: eHexLight }}
                  title={`${ev.startTime}–${ev.endTime} ${ev.title}${ev.description ? `\n${ev.description}` : ""}${onEdit ? "\n(클릭하면 수정)" : ""}`}
                  onClick={onEdit ? () => onEdit(ev) : undefined}
                >
                  <div className="day-evt-body">
                    <div className="day-evt-time" style={{ color: eHexDark }}>{ev.startTime}–{ev.endTime}</div>
                    <div className="day-evt-title">{ev.title}</div>
                    {ev.description && <div className="day-evt-desc">{ev.description}</div>}
                  </div>
                  {canDelete && onDelete && (
                    <button
                      type="button"
                      className="day-evt-del"
                      onClick={(e) => { e.stopPropagation(); onDelete(ev); }}
                      title="삭제"
                      aria-label="일정 삭제"
                    >×</button>
                  )}
                </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 날짜별 색 수정 모달 — 팔레트에서 색을 고르고, 아래 날짜를 눌러 칠하기
function ColorEditModal({ project, onSave, onClose }) {
  const dates = useMemo(
    () => generateDates(project.config.startDate, project.config.endDate),
    [project.config.startDate, project.config.endDate]
  );
  const [local, setLocal] = useState(() => ({ ...(project.dateColors || {}) }));
  const [activeColor, setActiveColor] = useState(COLOR_PALETTE[0].key);
  const [eraser, setEraser] = useState(false);

  function paintDate(dateKey) {
    setLocal((cur) => {
      const next = { ...cur };
      if (eraser) {
        delete next[dateKey];
      } else if (next[dateKey] === activeColor) {
        delete next[dateKey]; // 같은 색을 다시 누르면 해제
      } else {
        next[dateKey] = activeColor;
      }
      return next;
    });
  }
  function clearAll() {
    if (!Object.keys(local).length) return;
    if (window.confirm("모든 날짜의 색 설정을 지울까요?")) setLocal({});
  }

  // 짧은 날짜 라벨 (예: "6/23(월)")
  const fmtLabel = (dt) => `${dt.m}/${dt.d}(${dt.dowLabel})`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal color-edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🎨 날짜별 색 수정</h3>
        <div className="color-palette-row">
          <span className="color-palette-label">색 고르기</span>
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.key}
              type="button"
              className={"color-swatch" + (!eraser && activeColor === c.key ? " active" : "")}
              style={{ background: c.hex }}
              onClick={() => { setActiveColor(c.key); setEraser(false); }}
              title={c.name}
              aria-label={c.name}
            />
          ))}
          <button
            type="button"
            className={"color-swatch color-swatch-eraser" + (eraser ? " active" : "")}
            onClick={() => setEraser(true)}
            title="지우기"
            aria-label="지우기"
          >
            ✕
          </button>
        </div>
        <div className="modal-sub">
          위에서 색을 고르고 아래 날짜를 눌러 칠하세요. 같은 색을 다시 누르면 해제됩니다.
          {eraser && <span className="hint" style={{ marginLeft: 6, color: "#c5363a" }}>· 지우기 모드</span>}
        </div>
        <div className="color-date-grid">
          {dates.map((dt) => {
            const cur = local[dt.key];
            const entry = cur ? paletteEntry(cur) : null;
            return (
              <button
                key={dt.key}
                type="button"
                className={
                  "color-date-cell" +
                  (entry ? " on" : "") +
                  (dt.dow === 6 ? " sat" : dt.dow === 0 ? " sun" : "")
                }
                style={entry ? { background: entry.hex, borderColor: entry.accent, color: "#fff" } : undefined}
                onClick={() => paintDate(dt.key)}
                title={cur ? `${dt.label}(${dt.dowLabel}) — ${paletteEntry(cur)?.name}` : `${dt.label}(${dt.dowLabel})`}
              >
                {fmtLabel(dt)}
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn small" onClick={clearAll} disabled={!Object.keys(local).length}>전체 지우기</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn primary" onClick={() => onSave(local)}>저장</button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ project, projectUrl, onSave, onClose }) {
  const [protectionOn, setProtectionOn] = useState(!!project.adminPassword);
  const [admin, setAdmin] = useState(project.adminPassword || "");
  const [hashWord, setHashWord] = useState(project.adminHash || "admin");
  // 입력값 정제 — 영문/숫자/대시/언더스코어만 허용 (URL 안전)
  function onHashChange(v) {
    const cleaned = (v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    setHashWord(cleaned);
  }
  const effectiveHash = hashWord.trim() || "admin";
  const adminUrl = `${projectUrl}#${effectiveHash}`;
  function copy(text, msg) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(msg));
    else window.prompt("아래를 복사하세요", text);
  }
  function handleSave() {
    if (protectionOn) {
      if (!admin.trim()) {
        toast("관리자 비밀번호를 입력하거나 보호를 끄세요.");
        return;
      }
      onSave({
        adminPassword: admin.trim(),
        sharePassword: "",
        adminHash: effectiveHash,
      });
    } else {
      onSave({ adminPassword: "", sharePassword: "" });
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>🔗 공유 설정</h3>

        <label className="protection-toggle">
          <input
            type="checkbox"
            checked={protectionOn}
            onChange={(e) => setProtectionOn(e.target.checked)}
          />
          <span className="protection-toggle-label">
            <strong>관리자 비밀번호로 보호하기</strong>
            <small>
              {protectionOn
                ? "방문자는 비밀번호 없이 조회 전용으로 들어옴 · 관리자 진입은 #admin 링크 + 비밀번호 필요"
                : "누구나 링크만 알면 자유롭게 들어와 편집할 수 있음 (관리자 구분 없음)"}
            </small>
          </span>
        </label>

        {protectionOn && (
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
              <span style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                관리자 진입 비밀단어 <small style={{ color: "var(--muted)" }}>· URL 뒤 #<strong>{effectiveHash}</strong> 로 진입</small>
              </span>
              <input
                className="modal-input"
                type="text"
                value={hashWord}
                onChange={(e) => onHashChange(e.target.value)}
                placeholder="예: secret-2026 (영문·숫자·-·_ 만)"
                spellCheck={false}
                autoComplete="off"
              />
              <small style={{ color: "var(--muted)", marginTop: 2 }}>
                기본값 'admin'은 누구나 추측 가능 — 본인만 아는 단어로 바꿔두면 좋아요.
              </small>
            </label>
          </div>
        )}

        <div style={{ marginTop: 14, padding: 10, background: "#f5f7fb", borderRadius: 8, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>📤 참여자용 (조회·편집 가능)</div>
          <div style={{ marginBottom: 4, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectUrl}</code>
            <button className="btn small" onClick={() => copy(projectUrl, "주소를 복사했습니다")}>복사</button>
          </div>
          <small style={{ color: "var(--muted)" }}>비밀번호 없이 바로 일정 입력 가능</small>
        </div>

        {protectionOn && (
          <div style={{ marginTop: 10, padding: 10, background: "#fff4f0", borderRadius: 8, fontSize: 13, border: "1px solid #f7d4c4" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>🔐 관리자용 (본인 책갈피)</div>
            <div style={{ marginBottom: 4, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{adminUrl}</code>
              <button className="btn small" onClick={() => copy(adminUrl, "관리자 링크를 복사했습니다")}>복사</button>
            </div>
            <small style={{ color: "var(--muted)" }}>이 링크로 들어와 관리자 비밀번호 입력하면 전체 편집 가능 · 절대 공유하지 마세요</small>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  );
}

// 팀 뷰: 멤버 칩으로 토글하여 일부만 포함한 일정을 즉시 볼 수 있음
function TeamScheduleView({ team, config, people, locationName, events, eventMode, onCreateEvent, onDeleteEvent, onEditEvent, dateColors }) {
  const [hidden, setHidden] = useState(() => new Set());
  // 팀이 바뀌면 토글 상태 초기화
  useEffect(() => { setHidden(new Set()); }, [team.id]);
  const visiblePeople = people.filter((p) => !hidden.has(p.id));
  const total = people.length;
  const activeCount = visiblePeople.length;
  function toggle(id) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function showAll() { setHidden(new Set()); }
  function hideAll() { setHidden(new Set(people.map((p) => p.id))); }
  return (
    <>
      <div className="team-members-bar">
        <span className="team-members-label">
          팀원 <strong>{activeCount}</strong>/{total}
        </span>
        <div className="team-members-chips">
          {people.map((p) => {
            const isOn = !hidden.has(p.id);
            return (
              <button
                type="button"
                key={p.id}
                className={"team-member-chip" + (isOn ? " on" : " off")}
                onClick={() => toggle(p.id)}
                title={isOn ? "클릭하면 일정에서 제외합니다" : "클릭하면 일정에 포함합니다"}
              >
                {isOn ? "✓" : "○"} {p.name}
              </button>
            );
          })}
        </div>
        <div className="team-members-actions">
          <button type="button" className="btn-ghost-sm" onClick={showAll} disabled={hidden.size === 0}>전체</button>
          <button type="button" className="btn-ghost-sm" onClick={hideAll} disabled={activeCount === 0}>모두 끄기</button>
        </div>
      </div>
      {activeCount === 0 ? (
        <div className="empty-hint">표시할 팀원이 모두 꺼져 있습니다. 위에서 켜주세요.</div>
      ) : (
        <OverviewGrid
          config={config}
          people={visiblePeople}
          locationName={locationName}
          events={events}
          eventMode={eventMode}
          onCreateEvent={onCreateEvent}
          onDeleteEvent={onDeleteEvent}
          onEditEvent={onEditEvent}
          dateColors={dateColors}
        />
      )}
    </>
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

// 표 바로 위에 두는 '일정 잡기' 토글 버튼 — 켜져 있을 땐 강조
// '🗓 전체 일정 보기' 버튼 — 위치 탭 아래 전용 행의 큼직한 CTA
function CalendarButton({ onClick, count = 0 }) {
  return (
    <button
      type="button"
      className="calendar-btn-big"
      onClick={onClick}
      title="잡힌 일정을 달력으로 봅니다"
    >
      <span className="calendar-btn-icon">🗓</span>
      <span className="calendar-btn-label">전체 일정 보기</span>
      {count > 0 && <span className="calendar-btn-count">{count}</span>}
      <span className="calendar-btn-arrow">→</span>
    </button>
  );
}

function EventModeButton({ on, onToggle }) {
  return (
    <button
      type="button"
      className={"btn small event-mode-btn" + (on ? " on" : "")}
      onClick={onToggle}
      title="셀을 드래그해 약속 시간을 잡습니다"
    >
      {on ? "✓ 일정 잡기 완료" : "📅 일정 잡기"}
    </button>
  );
}

function Topbar({ onShare, onShareSettings, onDelete, onHome, protectionOn, guestHint, onShowActivity, activityCount = 0 }) {
  return (
    <div className="topbar">
      <span className="brand" style={{ cursor: onHome ? "pointer" : "default" }} onClick={onHome || undefined}>
        📅 일정 취합
      </span>
      {guestHint && (
        <span className="topbar-guest-hint" title="사용자 모드: 본인 일정만 입력할 수 있어요">
          👤 사용자 모드 · 본인 일정만 입력 가능
        </span>
      )}
      <span className="spacer" />
      {onShowActivity && (
        <button className="btn small" onClick={onShowActivity} title="수정 내역 보기 (관리자 전용)">
          📋 수정 내역{activityCount > 0 ? ` (${activityCount})` : ""}
        </button>
      )}
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
