import { useEffect, useState } from "react";
import { MenuConfirm, MenuScreen } from "./menu-frame";
import type { MenuPreview } from "./menu-frame";
import type { MenuActions, SessionSummary } from "./menu-types";

function shortSession(sessionId: string): string {
  return sessionId.length <= 34 ? sessionId : `${sessionId.slice(0, 31)}…`;
}

function detail(session: SessionSummary): string {
  const seen = session.lastTuiUsedAt > 0 ? new Date(session.lastTuiUsedAt).toLocaleString() : "no TUI access";
  return `${session.status}${session.active ? " · active" : ""}${session.attached ? " · attached" : ""} · ${seen}`;
}

export function HistoryView({ workspace, gateway, core, actions, externalError, onBack, onOpen, onRefreshStatus }: {
  workspace: string;
  gateway: "online" | "offline" | "unknown";
  core: "online" | "offline" | "unknown";
  actions: MenuActions;
  externalError?: string;
  onBack: () => void;
  onOpen: (sessionId: string) => void;
  onRefreshStatus: () => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SessionSummary>();

  const load = async () => {
    if (core !== "online") {
      setSessions([]);
      setError("Core is offline. Start Core Server or Attach Server first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setSessions(await actions.listSessions());
    } catch (caught) {
      setSessions([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [core]);

  const session = sessions[selected];
  const items = [
    ...sessions.map(entry => ({
      key: entry.sessionId,
      label: shortSession(entry.sessionId),
      detail: detail(entry),
    })),
    { key: "refresh", label: "Refresh" },
    { key: "back", label: "‹ Back" },
  ];

  return (
    <>
      <MenuScreen
        title="Session / History"
        workspace={workspace}
        gateway={gateway}
        core={core}
        items={items}
        onSelect={(key) => {
          if (key === "back") onBack();
          else if (key === "refresh") {
            onRefreshStatus();
            void load();
          } else onOpen(key);
        }}
        onBack={onBack}
        onDelete={() => {
          if (!session) return;
          if (session.active || session.attached) {
            setError(`Cannot delete ${session.active ? "active" : "attached"} session ${session.sessionId}`);
            return;
          }
          setError("");
          setPendingDelete(session);
        }}
        preview={(item): MenuPreview => {
          const match = sessions.find(entry => entry.sessionId === item.key);
          if (match) return { title: "SESSION", lines: [match.sessionId, "", detail(match), "Enter open · Del delete"] };
          if (item.key === "refresh") return { title: "REFRESH", lines: ["Reload sessions from Core.", "", "Enter refresh."] };
          return { title: "BACK", lines: ["Return to Session.", "", "Esc back."] };
        }}
        onSelectionChange={setSelected}
        hint="↑/↓ move · Enter open · Del delete · Esc back"
        error={externalError || error}
        notice={notice}
        suspended={Boolean(pendingDelete)}
      >
        {loading ? <text>Loading sessions…</text> : null}
        {!loading && sessions.length === 0 && !error ? <text>No sessions.</text> : null}
      </MenuScreen>
      {pendingDelete ? (
        <MenuConfirm
          title="Delete session"
          message={`Delete ${pendingDelete.sessionId}? This removes its checkpoint data.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(undefined);
            void actions.deleteSession(target.sessionId).then(() => {
              setNotice(`Deleted ${target.sessionId}`);
              setError("");
              void load();
            }).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)));
          }}
          onCancel={() => setPendingDelete(undefined)}
        />
      ) : null}
    </>
  );
}
