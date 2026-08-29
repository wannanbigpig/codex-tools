# User-Initiated Action Feedback Rule

- Every user-initiated action must reach a visible terminal state: success, warning, cancellation, or failure.
- Never clear a spinner, swallow an exception, or leave a waiting state without telling the user what happened and what they can do next.
- Background work may log quietly, but the same operation run explicitly by a user must surface failures and inconclusive outcomes in the UI that initiated it.
- Dashboard action failures must be returned to the dashboard host and rendered in both the VS Code webview and browser dashboard. Command Palette failures must show a VS Code notification.
- Add or update regression coverage whenever an action's completion, timeout, or error behavior changes.
