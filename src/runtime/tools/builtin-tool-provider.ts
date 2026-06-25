import type { CoreTool, ToolProvider } from "./core-tool.js";
import { createRunCommandTool, type RunCommandExecutor } from "./run-command.js";
import { createListFilesTool } from "./workspace/list-files.js";
import { createReadFileTool } from "./workspace/read-file.js";

export interface BuiltinToolProviderOptions {
  runCommandExecutor?: RunCommandExecutor;
}

export function createBuiltinToolProvider(options: BuiltinToolProviderOptions = {}): ToolProvider {
  return {
    name: "fde-builtin",
    source: "builtin",
    listTools(context) {
      const tools: CoreTool[] = [];
      if (context.allowed_tools.includes("read_file")) {
        tools.push(markBuiltin(createReadFileTool()));
      }
      if (context.allowed_tools.includes("list_files")) {
        tools.push(markBuiltin(createListFilesTool()));
      }
      if (context.allowed_tools.includes("run_command")) {
        tools.push(markBuiltin(createRunCommandTool({ execute: options.runCommandExecutor })));
      }
      return tools;
    }
  };
}

function markBuiltin(tool: CoreTool): CoreTool {
  return {
    ...tool,
    source: "builtin",
    source_name: "fde-builtin"
  };
}
