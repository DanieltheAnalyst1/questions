# MyQuest Collector (GitHub Actions)

Files:
- collect_exam.js, package.json

How to run on GitHub:
1. Create a repo and push these files.
2. Add secret MYQUEST_KEY in repo Settings > Secrets.
3. Add workflow `.github/workflows/collect.yml` (see next section).
4. Trigger workflow from Actions UI, or via GH CLI.

Outputs:
- `outputs/<EXAM>/exam_<EXAM>.json` and `.csv`
- `outputs/<EXAM>/subjects/*.json`
