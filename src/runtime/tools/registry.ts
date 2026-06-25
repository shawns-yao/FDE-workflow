import type { BaseTaskInput } from "../task-types.js";
import type { CoreTool, ToolProvider } from "./core-tool.js";

export async function assembleToolPool(input: BaseTaskInput, providers: ToolProvider[]): Promise<CoreTool[]> {
  const context = {
    allowed_tools: input.allowed_tools,
    permission_profile: input.permission_profile
  };
  const partitions = await Promise.all(providers.map((provider) => provider.listTools(context)));
  const byName = new Map<string, CoreTool>();

  for (const tool of partitions.flat()) {
    if (!input.allowed_tools.some((allowedTool) => allowedTool === tool.name)) {
      continue;
    }
    if (!byName.has(tool.name)) {
      byName.set(tool.name, tool);
      continue;
    }
    const existing = byName.get(tool.name);
    if (existing?.source !== "builtin" && tool.source === "builtin") {
      byName.set(tool.name, tool);
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
