export function StatusBar() {
  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" gap={1}>
        <text fg="#58a6ff"><strong>atom</strong></text>
        <text fg="#8b949e">neo</text>
      </box>
      <text fg="#3fb950">● ready</text>
    </box>
  );
}
