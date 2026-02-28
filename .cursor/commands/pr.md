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

## Steps
1) Verify auth: `gh auth status` (if not authenticated, tell me to run `gh auth login`).
2) Get current branch: `BR=$(git branch --show-current)`
3) Ensure branch is pushed: `git push -u origin "$BR"`
4) If Title/Body missing, generate them per Rules, then run:
   `gh pr create --base "${BASE:-main}" --head "$BR" --title "$TITLE" --body "$BODY"`