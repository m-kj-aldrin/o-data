# Create PR (GitHub CLI)

Create a GitHub Pull Request for the current branch using `gh`.

## Inputs (optional)
- Title
- Description (body)
- Base branch (default: `main`)

## Rules
- If **Title** is not provided: generate a concise title from the branch name + recent commits (imperative, <= 72 chars).
- If **Description** is not provided: generate a short body from the diff/commits using this template:
  - What
  - Why
  - How

## Quoting (important on Windows)
- On **PowerShell**: pass title and body in **single quotes** so `$` (e.g. `$batch`), backticks, and other symbols are sent literally to `gh` and not interpreted by the shell.
- On **Bash**: double-quoted `"$TITLE"` / `"$BODY"` are fine; avoid unquoted strings if title/body contain `$` or backticks.

## Steps
1) Verify auth: `gh auth status` (if not authenticated, tell me to run `gh auth login`).
2) Get current branch: `BR=$(git branch --show-current)` (PowerShell: `git branch --show-current`).
3) Ensure branch is pushed: `git push -u origin "$BR"`. If push fails (e.g. SSH permission denied), tell the user and still try create/edit if the branch might already exist on the remote.
4) **Create or edit**:
   - If the user asked to **edit** the existing PR, or `gh pr create` reports that a PR for this branch already exists: get the PR number from the message (e.g. `3` from `.../pull/3`) and run `gh pr edit <number> --title '...' --body '...'` (PowerShell: use single-quoted title/body).
   - Otherwise run: `gh pr create --base "${BASE:-main}" --head "$BR" --title "$TITLE" --body "$BODY"` (on PowerShell use single quotes for title/body if they contain `$` or backticks).
5) To find the PR for the current branch: `gh pr view` (opens or shows it), or `gh pr list --head <branch>`.