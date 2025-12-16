# Consolidated Pipeline Warnings Report

## Summary
Add a consolidated warnings report to the GitHub Job Summary that aggregates all warnings from the CI/CD pipeline run.

## Requirements
- **Output**: GitHub Job Summary (`$GITHUB_STEP_SUMMARY`)
- **Behavior**: Report only, never fail the build
- **Scope**: All warning categories (ESLint, security, deprecations, Docker, DB)

## Warning Sources to Capture

| Source | Current Output | Pattern to Match |
|--------|---------------|------------------|
| ESLint | `##[warning] LINE:COL warning MSG RULE` | `warning.*@typescript-eslint\|security/` |
| Security validation | `[TIMESTAMP] WARN: MSG` | `WARN:` |
| Security audit | `WARN: MSG` | `WARN:` |
| Node.js deprecation | `(node:PID) [DEPXXXX] DeprecationWarning` | `\[DEP[0-9]+\]` |
| Docker Compose | `level=warning msg="MSG"` | `level=warning` |
| DB migration | `[WARNING]` or `DB migration validation failed` | `\[WARNING\]\|validation failed` |

## Implementation

### Step 1: Add warning collection setup (line ~265)
Add after workspace restore, before security checks:
```yaml
- name: "Setup warning collection"
  run: |
    mkdir -p .warnings
    touch .warnings/eslint.txt .warnings/security.txt .warnings/deprecation.txt .warnings/docker.txt .warnings/db.txt
```

### Step 2: Modify ESLint step (lines 286-294)
Keep lint-output.txt, extract warnings before deleting:
```yaml
cd backend
npm run lint:security 2>&1 | tee lint-output.txt
ERROR_COUNT=$(grep -oP '✖.*\(\K[0-9]+(?= error)' lint-output.txt || echo "0")
# Capture warnings for report
grep -E "warning.*(typescript-eslint|security/)" lint-output.txt > ../.warnings/eslint.txt || true
grep -oP '✖.*problems.*warnings' lint-output.txt >> ../.warnings/eslint.txt || true
rm -f lint-output.txt
```

### Step 3: Capture security validation (line 309)
```yaml
node scripts/validate-security.js 2>&1 | tee ../security-val.txt
grep "WARN:" ../security-val.txt >> ../.warnings/security.txt || true
rm -f ../security-val.txt
```

### Step 4: Capture security audit (line 335)
```yaml
./scripts/security-audit.sh 2>&1 | tee security-audit.txt || exit 1
grep "WARN:" security-audit.txt >> .warnings/security.txt || true
rm -f security-audit.txt
```

### Step 5: Capture Docker warnings (line ~345)
```yaml
docker compose -f docker-compose.test.yml up -d 2>&1 | tee docker.txt
grep "level=warning" docker.txt >> .warnings/docker.txt || true
rm -f docker.txt
```

### Step 6: Capture Node.js deprecation warnings
Wrap npm test commands to capture deprecation warnings:
```yaml
npm run test:unit ... 2>&1 | tee test.txt
grep -E "\[DEP[0-9]+\]" test.txt | sort -u >> .warnings/deprecation.txt || true
```

### Step 7: Add consolidated report step (after line 601)
```yaml
- name: "Generate consolidated pipeline warnings report"
  if: always()
  run: |
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "---" >> $GITHUB_STEP_SUMMARY
    echo "## Pipeline Warnings Report" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY

    # Count warnings per category
    ESLINT_COUNT=$(wc -l < .warnings/eslint.txt 2>/dev/null || echo 0)
    SECURITY_COUNT=$(wc -l < .warnings/security.txt 2>/dev/null || echo 0)
    DEPRECATION_COUNT=$(wc -l < .warnings/deprecation.txt 2>/dev/null || echo 0)
    DOCKER_COUNT=$(wc -l < .warnings/docker.txt 2>/dev/null || echo 0)
    DB_COUNT=$(wc -l < .warnings/db.txt 2>/dev/null || echo 0)

    TOTAL=$((ESLINT_COUNT + SECURITY_COUNT + DEPRECATION_COUNT + DOCKER_COUNT + DB_COUNT))

    if [ "$TOTAL" -gt 0 ]; then
      echo "> **Note:** Warnings are informational only and do not affect build status." >> $GITHUB_STEP_SUMMARY
      echo "" >> $GITHUB_STEP_SUMMARY

      echo "| Category | Count |" >> $GITHUB_STEP_SUMMARY
      echo "|:---------|------:|" >> $GITHUB_STEP_SUMMARY
      echo "| ESLint | $ESLINT_COUNT |" >> $GITHUB_STEP_SUMMARY
      echo "| Security | $SECURITY_COUNT |" >> $GITHUB_STEP_SUMMARY
      echo "| Deprecation | $DEPRECATION_COUNT |" >> $GITHUB_STEP_SUMMARY
      echo "| Docker | $DOCKER_COUNT |" >> $GITHUB_STEP_SUMMARY
      echo "| Database | $DB_COUNT |" >> $GITHUB_STEP_SUMMARY
      echo "" >> $GITHUB_STEP_SUMMARY

      echo "<details>" >> $GITHUB_STEP_SUMMARY
      echo "<summary>Click to expand warning details</summary>" >> $GITHUB_STEP_SUMMARY
      echo "" >> $GITHUB_STEP_SUMMARY

      if [ -s .warnings/eslint.txt ]; then
        echo "### ESLint Warnings" >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
        cat .warnings/eslint.txt >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
      fi

      if [ -s .warnings/security.txt ]; then
        echo "### Security Warnings" >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
        cat .warnings/security.txt >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
      fi

      if [ -s .warnings/deprecation.txt ]; then
        echo "### Node.js Deprecation Warnings" >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
        cat .warnings/deprecation.txt >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
      fi

      if [ -s .warnings/docker.txt ]; then
        echo "### Docker Warnings" >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
        cat .warnings/docker.txt >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
      fi

      if [ -s .warnings/db.txt ]; then
        echo "### Database Warnings" >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
        cat .warnings/db.txt >> $GITHUB_STEP_SUMMARY
        echo '```' >> $GITHUB_STEP_SUMMARY
      fi

      echo "</details>" >> $GITHUB_STEP_SUMMARY
    else
      echo "No warnings detected." >> $GITHUB_STEP_SUMMARY
    fi
```

## Files to Modify
- `.github/workflows/deploy.yml` - Add warning capture and report generation

## Expected Output
The Job Summary will show:
```markdown
---
## Pipeline Warnings Report

> **Note:** Warnings are informational only and do not affect build status.

| Category | Count |
|:---------|------:|
| ESLint | 34 |
| Security | 13 |
| Deprecation | 2 |
| Docker | 1 |
| Database | 0 |

<details>
<summary>Click to expand warning details</summary>

### ESLint Warnings
```
  80:8   warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  ...
```
</details>
```

---
*Plan created: 2025-12-16*
