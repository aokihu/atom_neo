import { useTheme } from "@atom-neo/tui-kit";
import { ScheduleBar } from "./ScheduleBar";
import { ContextSection } from "./sidebar/ContextSection";
import { McpSection } from "./sidebar/McpSection";
import { NetworkSection } from "./sidebar/NetworkSection";
import { RoundsSection } from "./sidebar/RoundsSection";
import { SIDEBAR_WIDTH } from "./sidebar/sidebar-metrics";
import { TelemetrySection } from "./sidebar/TelemetrySection";
import { TodoSection } from "./sidebar/TodoSection";
import { ToolsSection } from "./sidebar/ToolsSection";

export { SIDEBAR_WIDTH, SIDEBAR_CONTENT_WIDTH, buildGauge } from "./sidebar/sidebar-metrics";
export { TelemetrySection } from "./sidebar/TelemetrySection";
export { RoundsSection } from "./sidebar/RoundsSection";
export { TodoSection } from "./sidebar/TodoSection";

export function Sidebar({ contextLimit, url, adminToken }: { contextLimit: number; url: string; adminToken?: string }) {
  const { colors } = useTheme();

  return (
    <box
      width={SIDEBAR_WIDTH}
      flexShrink={0}
      flexDirection="column"
      border={["left"]}
      borderColor={colors.decoration.subtle}
      borderStyle="single"
      overflow="hidden"
      backgroundColor={colors.bg.page}
    >
      <ContextSection contextLimit={contextLimit} />
      <RoundsSection />
      <ScheduleBar url={url} adminToken={adminToken} />
      <ToolsSection />
      <McpSection />
      <TodoSection />
      <NetworkSection />
    </box>
  );
}
