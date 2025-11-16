# Coverage Reporting Guide

## Overview

The CI/CD pipeline now includes comprehensive test coverage reporting with GitHub Actions artifacts, making coverage data accessible, persistent, and visible in the GitHub UI.

## Features

### 1. **GitHub Actions Artifacts**
Coverage reports are automatically uploaded as workflow artifacts with:
- **Retention**: 30 days (configurable in workflow)
- **Formats**: HTML reports, LCOV data, JSON coverage
- **Compression**: Level 6 for optimal storage
- **Access**: Download from GitHub Actions UI

### 2. **Coverage Metrics**
Accurate coverage calculation includes:
- **Lines Covered**: Exact count of tested lines
- **Total Lines**: Total executable lines
- **Coverage Percentage**: (Lines Hit / Lines Found) × 100
- **Detailed Breakdown**: Available in HTML reports

### 3. **GitHub UI Integration**
Coverage data appears in:
- **Job Summary**: Table format in workflow run summary
- **Workflow Logs**: Console output with metrics
- **Artifacts Section**: Downloadable reports
- **PR Comments**: Automatic coverage updates (PRs only)

### 4. **Pull Request Comments**
For pull requests:
- **Automatic posting**: Coverage comment on every PR run
- **Smart updates**: Updates existing comment instead of creating duplicates
- **Non-blocking**: Won't fail workflow if comment fails
- **Direct links**: Links to workflow artifacts for full reports

## Accessing Coverage Reports

### Method 1: GitHub UI (Recommended)

1. Navigate to **Actions** tab in GitHub repository
2. Click on the workflow run you want to inspect
3. Scroll to **Artifacts** section at bottom of page
4. Download `coverage-report-{run-id}` artifact
5. Extract the ZIP file
6. Open `backend/coverage/lcov-report/index.html` in browser

### Method 2: Workflow Summary

1. Navigate to **Actions** tab
2. Click on any workflow run
3. View **Job Summary** for coverage table
4. See metrics without downloading

### Method 3: Pull Request Comments (PRs only)

1. Open any pull request
2. Scroll to automated comments section
3. Find "Test Coverage Report" comment
4. View metrics and click artifact link

### Method 4: GitHub CLI

```bash
# List artifacts for a workflow run
gh run view {run-id} --json artifacts

# Download coverage artifact
gh run download {run-id} -n coverage-report-{run-id}

# View HTML report
open backend/coverage/lcov-report/index.html
```

## Coverage Report Files

### HTML Report (`lcov-report/index.html`)
- **Visual coverage report** with syntax highlighting
- **Line-by-line coverage** showing tested vs untested code
- **File navigation** with coverage percentages
- **Color coding**: Green (covered), Red (uncovered), Orange (partial)

### LCOV Data (`lcov.info`)
- **Standard LCOV format** for tool integration
- **Line coverage data** for all source files
- **Branch coverage** information
- **Compatible** with SonarQube, Codecov, Coveralls

### JSON Report (`coverage-final.json`)
- **Machine-readable format** for automation
- **Detailed metrics** per file and function
- **Integration** with custom tools and dashboards

## Interpreting Coverage Metrics

### Coverage Table
```markdown
| Metric               | Value      |
|----------------------|------------|
| Lines Covered        | 850 / 1000 |
| Coverage Percentage  | 85.00%     |
| Test Status          | success    |
```

**Lines Covered**: `{lines_hit} / {lines_found}`
- **Lines Hit**: Number of lines executed by tests
- **Lines Found**: Total executable lines (excludes comments, blank lines)

**Coverage Percentage**: `(lines_hit / lines_found) × 100`
- **< 60%**: ⚠️ Low coverage - consider more tests
- **60-80%**: ✅ Good coverage - acceptable for most projects
- **> 80%**: 🎯 Excellent coverage - comprehensive testing

### Understanding HTML Reports

**File Overview**:
- Each file shows coverage percentage
- Click filename to see line-by-line coverage
- Sort by coverage to find gaps

**Line-by-Line View**:
- **Green**: Line covered by tests
- **Red**: Line not covered (needs test)
- **Orange**: Line partially covered (branch/condition)
- **Gray**: Not executable (comments, declarations)

## Best Practices

### 1. Coverage Goals
- **Minimum**: 60% for new projects
- **Target**: 80% for production code
- **Critical**: 90%+ for security/auth code
- **Not 100%**: Diminishing returns, focus on critical paths

### 2. Using Coverage Data
- **Identify gaps**: Find untested code paths
- **Guide testing**: Write tests for red/orange lines
- **Refactor confidently**: Good coverage enables safe refactoring
- **Track trends**: Monitor coverage over time

### 3. PR Review Process
1. Check coverage comment on PR
2. Ensure coverage doesn't decrease significantly
3. Review HTML report for new uncovered code
4. Request tests for critical uncovered paths

### 4. Artifact Management
- **Download before expiry**: Artifacts expire after 30 days
- **Archive important reports**: Save locally for compliance
- **Monitor storage**: Large repos may hit artifact limits

## Configuration

### Adjusting Retention Period

Edit `.github/workflows/deploy.yml`:

```yaml
- name: "📊 Upload coverage reports as artifacts"
  uses: actions/upload-artifact@v4
  with:
    retention-days: 30  # Change to 7, 14, 60, 90, etc.
```

### Disabling PR Comments

Remove or comment out the "💬 Comment coverage on PR" step:

```yaml
# - name: "💬 Comment coverage on PR"
#   if: github.event_name == 'pull_request'
#   uses: actions/github-script@v7
#   ...
```

### Changing Coverage Threshold

Add coverage enforcement in workflow:

```yaml
- name: "🎯 Enforce coverage threshold"
  run: |
    COVERAGE_PERCENT=$(awk "BEGIN {printf \"%.2f\", ($LINES_HIT / $LINES_FOUND) * 100}")
    THRESHOLD=80

    if (( $(echo "$COVERAGE_PERCENT < $THRESHOLD" | bc -l) )); then
      echo "❌ Coverage $COVERAGE_PERCENT% below threshold $THRESHOLD%"
      exit 1
    fi
```

## Troubleshooting

### Issue: No coverage data generated

**Symptoms**: "⚠️ No coverage data available" in logs

**Solutions**:
1. Verify test command includes `--coverage` flag
2. Check tests are actually running (`npm run test:unit`)
3. Ensure coverage is configured in `package.json` or `jest.config.js`

### Issue: Artifact not found

**Symptoms**: No artifact in GitHub Actions UI

**Solutions**:
1. Check step completed: "📊 Upload coverage reports"
2. Verify `backend/coverage/` directory exists
3. Look for `if-no-files-found: warn` message in logs
4. Ensure tests ran successfully before upload

### Issue: PR comment not posting

**Symptoms**: No coverage comment on pull request

**Solutions**:
1. Verify `github.event_name == 'pull_request'` condition
2. Check `continue-on-error: true` allows workflow to proceed
3. Ensure GitHub token has PR comment permissions
4. Review logs for `github-script` step errors

### Issue: Coverage percentage seems wrong

**Symptoms**: Coverage shows 0% or unexpected value

**Solutions**:
1. Check `lcov.info` file format is correct
2. Verify regex patterns: `LF:[0-9]*` and `LH:[0-9]*`
3. Ensure coverage tool generates LCOV format
4. Review HTML report for accurate visualization

## Integration with External Tools

### SonarQube

```bash
# Use LCOV data for SonarQube analysis
sonar-scanner \
  -Dsonar.javascript.lcov.reportPaths=backend/coverage/lcov.info
```

### Codecov

```yaml
- name: Upload to Codecov
  uses: codecov/codecov-action@v4
  with:
    files: ./backend/coverage/lcov.info
```

### Coveralls

```yaml
- name: Coveralls
  uses: coverallsapp/github-action@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    path-to-lcov: ./backend/coverage/lcov.info
```

## Comparison: Before vs After

### Before (Local Temp Storage)
- ❌ Reports deleted after workflow completion
- ❌ No historical tracking
- ❌ Manual download required from runner
- ❌ No visibility in GitHub UI
- ❌ No PR integration

### After (GitHub Artifacts)
- ✅ Reports accessible for 30 days
- ✅ Historical trend tracking possible
- ✅ One-click download from GitHub UI
- ✅ Coverage visible in job summary
- ✅ Automatic PR comments
- ✅ Multiple format support (HTML, LCOV, JSON)
- ✅ No manual cleanup needed

## Resources

- [GitHub Actions Artifacts Documentation](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)
- [LCOV Format Specification](https://github.com/linux-test-project/lcov)
- [Jest Coverage Documentation](https://jestjs.io/docs/configuration#collectcoverage-boolean)
- [Istanbul Coverage Tools](https://istanbul.js.org/)

---

**Last Updated**: 2025-11-16
**Pipeline Version**: Optimized CI/CD with Artifact Upload
**Retention Policy**: 30 days (configurable)
