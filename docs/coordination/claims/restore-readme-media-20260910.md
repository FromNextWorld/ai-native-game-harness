# Restore README media and community entry

- Scope: correct the overly broad README rewrite from a08b66e; restore the original six game screenshots, prominent Xiaohongshu profile, and QQ group QR code.
- Branch: `task/restore-readme-media-20260910`, isolated publication worktree based on remote main.
- Files: `README.md` and this claim only.
- Preserve: professional document structure, current ownership links, source code, site HTML and all original image files.
- Validation: compare restored image sources to the prior README; check all local image paths and Markdown links; git diff --check.
- Validation result: all 8 original image references (logo, QR and 6 screenshots) restored and local files present; prominent Xiaohongshu profile restored; diff whitespace check passed.
- Publication: user requested restoring the GitHub version; publish and merge this bounded correction to main using FromNextWorld. No application code, website HTML or private repository changes.
