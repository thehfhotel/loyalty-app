# GitHub Actions Workflow Validation Guide

## Overview

This project includes automated workflow validation using **actionlint** to catch YAML syntax errors, GitHub Actions issues, and workflow problems before pushing to GitHub.

## Quick Start

### Validate Workflows

```bash
./scripts/validate-workflow.sh
```

The script will:
1. ✅ Auto-install actionlint if not present
2. 🔍 Scan all workflow files in `.github/workflows/`
3. 📊 Report errors and warnings with file locations
4. ✅ Exit with code 0 (success) or 1 (errors found)

### Example Output

```
🔍 GitHub Actions Workflow Validator
====================================

📋 Found 1 workflow file(s) to validate

🔎 Validating: .github/workflows/deploy.yml
✅ Valid

====================================
📊 Validation Summary
====================================
Total files validated: 1
✅ All workflows are valid!
```

## Validation Tool: actionlint

**actionlint** is a static checker for GitHub Actions workflows created by rhysd.

### Features

- **YAML Syntax Validation**: Catches invalid YAML before GitHub sees it
- **Workflow Structure**: Validates job dependencies, outputs, inputs
- **Expression Syntax**: Checks `${{ }}` expressions for correctness
- **Actions Validation**: Verifies action references and versions
- **Shellcheck Integration**: Validates bash scripts in `run:` blocks (if shellcheck installed)
- **Type Checking**: Validates expressions and context objects

### What It Catches

1. **YAML Syntax Errors**
   - Invalid indentation
   - Mismatched quotes
   - Special character issues (like pipes in heredocs)

2. **Workflow Logic Errors**
   - Invalid job dependencies
   - Undefined outputs/inputs
   - Incorrect needs references

3. **Expression Errors**
   - Invalid context objects
   - Type mismatches
   - Undefined properties

4. **Common Mistakes**
   - Deprecated actions
   - Security issues
   - Performance anti-patterns

## Common Issues & Solutions

### Issue 1: Pipe Characters in YAML

**Error**: `error in your yaml syntax on line X`

**Cause**: Pipe character `|` in content conflicts with YAML block scalars

**Solution**: Use alternative approaches:

```yaml
# ❌ PROBLEM: Heredoc with pipes in YAML block
run: |
  cat >> $GITHUB_STEP_SUMMARY <<EOF
  | Header | Value |
  EOF

# ✅ SOLUTION 1: Echo statements with brace group
run: |
  {
    echo "| Header | Value |"
    echo "|--------|-------|"
  } >> $GITHUB_STEP_SUMMARY

# ✅ SOLUTION 2: Array join in JavaScript
script: >-
  const lines = [
    '| Header | Value |',
    '|--------|-------|'
  ];
  const content = lines.join('\n');
```

### Issue 2: GitHub Expressions in Heredocs

**Error**: YAML syntax error with `${{ }}` in heredoc

**Cause**: GitHub Actions tries to evaluate expressions before heredoc processing

**Solution**: Capture expressions in shell variables first

```yaml
# ❌ PROBLEM
run: |
  cat >> $GITHUB_STEP_SUMMARY <<EOF
  Status: ${{ steps.test.outcome }}
  EOF

# ✅ SOLUTION
run: |
  OUTCOME="${{ steps.test.outcome }}"
  cat >> $GITHUB_STEP_SUMMARY <<EOF
  Status: $OUTCOME
  EOF
```

### Issue 3: Undefined Job Outputs

**Error**: `property "job-name" is not defined`

**Cause**: Referencing job output that doesn't exist

**Solution**: Ensure job declares outputs

```yaml
# ✅ CORRECT
jobs:
  test:
    outputs:
      result: ${{ steps.test.outputs.passed }}
    steps:
      - id: test
        run: echo "passed=true" >> $GITHUB_OUTPUT

  deploy:
    needs: test
    if: needs.test.outputs.result == 'true'
```

### Issue 4: Missing `if: always()`

**Error**: Job outputs not set when step fails

**Cause**: Steps after failures don't run unless marked with `if: always()`

**Solution**: Add `if: always()` to critical output steps

```yaml
# ✅ CORRECT
- name: Test execution
  id: run-tests
  run: npm test

- name: Capture results
  id: results
  if: always()  # Runs even if tests fail
  run: |
    if [ "${{ steps.run-tests.outcome }}" == "success" ]; then
      echo "passed=true" >> $GITHUB_OUTPUT
    else
      echo "passed=false" >> $GITHUB_OUTPUT
    fi
```

## Integration with Development Workflow

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Validate workflows before commit

if [ -f "scripts/validate-workflow.sh" ]; then
    echo "🔍 Validating workflows..."
    ./scripts/validate-workflow.sh
    if [ $? -ne 0 ]; then
        echo "❌ Workflow validation failed. Fix errors before committing."
        exit 1
    fi
fi
```

### CI/CD Integration

Add to workflow (example):

```yaml
- name: Validate workflows
  run: ./scripts/validate-workflow.sh
```

### VS Code Integration

Install the **GitHub Actions** extension for:
- Real-time syntax highlighting
- Autocomplete for workflow syntax
- Inline error detection

## Best Practices

### 1. Avoid Heredocs for Complex Content

**Instead of heredocs**, use:
- Echo statements with brace groups for bash
- Array joins for JavaScript/Python
- Separate template files loaded at runtime

### 2. Capture Expressions Early

Always capture GitHub expressions in shell variables at the top of `run:` blocks:

```yaml
run: |
  # Capture all GitHub expressions first
  OUTCOME="${{ steps.test.outcome }}"
  COMMIT="${{ github.sha }}"

  # Use shell variables in rest of script
  echo "Test: $OUTCOME"
  echo "Commit: $COMMIT"
```

### 3. Use Explicit Step IDs

Always provide `id:` for steps that produce outputs:

```yaml
- name: Run tests
  id: run-tests  # ← Explicit ID
  run: npm test
```

### 4. Validate Locally Before Push

Always run the validator before pushing:

```bash
./scripts/validate-workflow.sh && git push
```

## Troubleshooting

### actionlint Installation Fails

**Manual installation**:

```bash
# Download binary
wget https://github.com/rhysd/actionlint/releases/download/v1.7.8/actionlint_1.7.8_linux_amd64.tar.gz

# Extract
tar -xzf actionlint_1.7.8_linux_amd64.tar.gz

# Move to path
sudo mv actionlint /usr/local/bin/
```

### False Positives

If actionlint reports issues that are actually correct:

1. Check if you're using latest actionlint version
2. Verify the workflow syntax against GitHub documentation
3. Consider adding `# actionlint: disable` comments for known false positives

### Shellcheck Warnings

If you see shellcheck warnings and don't have it installed:

```bash
# Install shellcheck for bash script validation
sudo apt-get install shellcheck  # Ubuntu/Debian
brew install shellcheck          # macOS
```

## Resources

- **actionlint GitHub**: https://github.com/rhysd/actionlint
- **GitHub Actions Documentation**: https://docs.github.com/en/actions
- **YAML Specification**: https://yaml.org/spec/
- **GitHub Actions Expressions**: https://docs.github.com/en/actions/learn-github-actions/expressions

## Historical Issues Resolved

This project encountered several YAML syntax errors that were resolved:

1. **Line 473**: GitHub expression in heredoc → Captured in shell variable
2. **Line 476**: Pipe characters in bash heredoc → Replaced with echo statements
3. **Line 514**: Pipe characters in JS template literal → Replaced with array join

All issues were caused by YAML parser ambiguity with special characters in string content. The solutions involved restructuring code to avoid heredocs with complex content.

---

**Last Updated**: 2025-11-16
**Validator Version**: actionlint 1.7.8
**Script Location**: `scripts/validate-workflow.sh`
