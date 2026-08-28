import { vi } from "vitest";

vi.mock("vscode", () => ({
  env: {
    language: "en"
  },
  commands: {
    executeCommand: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: vi.fn(),
      inspect: vi.fn()
    })),
    onDidChangeConfiguration: vi.fn()
  },
  window: {
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  }
}));
