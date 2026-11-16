import { useEffect, useState } from "react";
import { health, resetEngine } from "./lib/api";
import { go, useRoute } from "./lib/router";
import { currentStreak, dayKey, useAppState } from "./lib/store";
import { PathPage } from "./pages/PathPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { ReferencePage } from "./pages/ReferencePage";
import { SettingsPage } from "./pages/SettingsPage";
import { LessonPage } from "./pages/LessonPage";
import { DrillPage, dueDrillKeys } from "./pages/DrillPage";
import { ExamPage, ExamsPage } from "./pages/ExamPage";
import { SheetsPage } from "./pages/SheetsPage";

const NAV = [
  { path: "", label: "Course" },
  { path: "review", label: "Review" },
  { path: "exams", label: "Past exams" },
  { path: "playground", label: "Playground" },
  { path: "sheets", label: "Unassessed sheets" },
  { path: "reference", label: "Functions" },
  { path: "settings", label: "Settings" },
];

export function App() {
  const route = useRoute();
  const state = useAppState();
  const [ghc, setGhc] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    health().then(setGhc);
  }, []);

  const [page, ...rest] = route;
  if (page === "lesson") return <LessonPage key={rest[0]} id={rest[0]} />;
  if (page === "drill") return <DrillPage key={route.join("/")} mode="set" setId={rest[0]} />;
  if (page === "review") return <DrillPage key={route.join("/")} mode="review" />;

  const due = dueDrillKeys().length;
  const streak = currentStreak(state);
  const xpToday = state.xpByDay[dayKey()] ?? 0;

  let content;
  if (page === "exam") content = <ExamPage key={rest[0]} id={rest[0]} />;
  else if (page === "exams") content = <ExamsPage />;
  else if (page === "playground") content = <PlaygroundPage ghcUp={!!ghc} />;
  else if (page === "reference") content = <ReferencePage query={rest[0]} />;
  else if (page === "settings") content = <SettingsPage />;
  else if (page === "sheets") content = <SheetsPage />;
  else content = <PathPage />;

  const active = page === "exam" ? "exams" : page ?? "";
  const wide = page === "exam";
  const sheets = page === "sheets";

  return (
    <div className={`shell ${wide ? "shell-wide" : ""} ${sheets ? "shell-sheets" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="brand-name">Haskell Prep</span>
          <span className="brand-sig">:: IO FullMarks</span>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path === "review" ? `review/${Date.now()}` : n.path}`} className={`nav-link ${active === n.path ? "active" : ""}`}>
              {n.label}
              {n.path === "review" && due > 0 && <span className="badge">{due}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-stats">
          <div className="stat">
            <span className="stat-value">{streak}</span>
            <span className="stat-label">day streak</span>
          </div>
          <div className="stat">
            <span className="stat-value">{xpToday}</span>
            <span className="stat-label">XP today</span>
          </div>
        </div>
      </aside>
      <main className="main">
        {ghc === undefined && !sheets && (
          <div className="banner" role="status">
            Starting Haskell in this tab…
          </div>
        )}
        {ghc === null && !sheets && (
          <div className="banner" role="status">
            Couldn't start the in-browser Haskell compiler. Retry, or run <code className="code">npm run dev</code> for full GHCi.
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                resetEngine();
                setGhc(undefined);
                health().then(setGhc);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {content}
      </main>
      <nav className="mobile-nav">
        {NAV.slice(0, 4).map((n) => (
          <button type="button" key={n.path} className={active === n.path ? "active" : ""} onClick={() => go(n.path === "review" ? `/review/${Date.now()}` : `/${n.path}`)}>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
