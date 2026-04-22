# Development Rules

## 1. Version Bumping
**CRITICAL:** Before every new deployment or push that triggers a publish, you **must** increment the `"version"` field in `package.json`. 

The VS Code Marketplace and Open VSX Registry will reject any package that shares a version number with an already published release (even if a previous publish failed halfway through).

To update the version, simply open `package.json` and bump the patch version (e.g., from `0.0.36` to `0.0.37`).
