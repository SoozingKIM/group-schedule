"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "@/lib/ui";

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState(null);

  async function refresh() {
    try {
      setProjects(await api.get("/api/projects"));
    } catch (e) {
      toast(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addProject() {
    const name = window.prompt("새 프로젝트 이름을 입력하세요", "새 프로젝트");
    if (name === null) return; // 취소
    try {
      const p = await api.post("/api/projects", { name: name.trim() || "새 프로젝트" });
      router.push(`/p/${p.id}`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeProject(e, p) {
    e.stopPropagation();
    if (!window.confirm(`"${p.name}" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api.del(`/api/projects/${p.id}`);
      setProjects((list) => list.filter((x) => x.id !== p.id));
      toast("삭제되었습니다");
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <>
      <div className="topbar">
        <span className="brand">📅 일정 취합</span>
        <span className="spacer" />
      </div>

      <div className="container">
        <div className="list-head">
          <h1>프로젝트</h1>
          <button className="fab-add" onClick={addProject} title="프로젝트 추가" aria-label="프로젝트 추가">
            +
          </button>
        </div>

        {projects === null ? (
          <div className="loading">불러오는 중…</div>
        ) : projects.length === 0 ? (
          <div className="empty-hint">
            아직 프로젝트가 없습니다.
            <br />
            오른쪽 위 <b>+</b> 버튼을 눌러 첫 프로젝트를 만들어 보세요.
          </div>
        ) : (
          <div className="cards">
            {projects.map((p) => (
              <div key={p.id} className="card" onClick={() => router.push(`/p/${p.id}`)}>
                <button className="del" title="삭제" onClick={(e) => removeProject(e, p)}>
                  ✕
                </button>
                <h3>{p.name}</h3>
                <div className="meta">
                  참여자 {p.peopleCount}명
                  <br />
                  {p.config.startDate} ~ {p.config.endDate}
                  <br />
                  {p.config.startTime} ~ {p.config.endTime}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
