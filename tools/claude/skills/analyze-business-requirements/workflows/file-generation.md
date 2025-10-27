# File Generation Workflow

## Overview

After clarifications are complete, generate a single, comprehensive requirements.md file. This workflow ensures correct file placement, structure, and traceability.

## Process Steps

```
Clarifications Complete
    ↓
Step 1: Resolve Repository Context
    ↓
Step 2: Generate Feature Slug
    ↓
Step 3: Construct File Path (if path resolved)
    ↓
Step 4: Create Directory (if path resolved)
    ↓
Step 5: Generate Content
    ↓
Step 6: Write File or Stage Inline Output
    ↓
Step 7: Validate Output
    ↓
Step 8: Report to User
```

## Step 1: Resolve Repository Context

Determine the repository root without asking the user.

1. Attempt `git rev-parse --show-toplevel`.
2. If git metadata is unavailable, fall back to the current working directory.
3. When neither yields a reliable path (sandboxed executions, missing permissions), set `delivery_mode = "inline"` and skip filesystem writes.

Example helper:

```python
repo_root = detect_git_root() or os.getcwd()
if not repo_root:
    delivery_mode = "inline"
```

**Notes**:
- This skill runs inside a repository, so a path should usually be available.
- Treat `delivery_mode = "inline"` as a signal to generate the requirements content and return it directly to the user instead of touching the filesystem.

## Step 2: Generate Feature Slug

Transform feature name to slug:

### Rules

1. Convert to lowercase
2. Replace spaces with hyphens
3. Remove special characters (keep only alphanumeric and hyphens)
4. Limit to 30 characters
5. Remove trailing/leading hyphens

### Algorithm

```python
def generate_slug(feature_name: str) -> str:
    slug = feature_name.lower()
    slug = slug.replace(' ', '-')
    slug = ''.join(c for c in slug if c.isalnum() or c == '-')
    slug = slug[:30]
    slug = slug.strip('-')
    return slug
```

### Examples

| Feature Name | Slug |
|--------------|------|
| "Order Tracking & Customer Support" | "order-tracking-customer-sup" |
| "User Profile Management" | "user-profile-management" |
| "Payment Gateway Integration (Stripe)" | "payment-gateway-integration" |
| "Real-time Chat with Emoji Support 😊" | "real-time-chat-with-emoji" |

## Step 3: Construct File Path

### Format

```
{repository_root}/specs/{YYYY-MM-DD}_{feature-slug}/requirements.md
```

### Components

- `{repository_root}`: Resolved in Step 1; if unavailable, skip this step and operate in inline mode
- `{YYYY-MM-DD}`: Current date in ISO format (e.g., 2024-10-21)
- `{feature-slug}`: From Step 2
- `requirements.md`: Fixed filename

### Example

**Input**:
- Repository: `/home/marcin/repos/ecommerce`
- Feature: "Order Tracking System"
- Date: 2024-10-21

**Output**:
```
/home/marcin/repos/ecommerce/specs/2024-10-21_order-tracking-system/requirements.md
```

## Step 4: Create Directory

```bash
mkdir -p {repository_root}/specs/{YYYY-MM-DD}_{feature-slug}
```

**Notes**:
- Skip this step entirely when operating in inline mode
- Use `-p` flag to create parent directories if needed
- Don't fail if directory already exists

## Step 5: Generate Content

Use template from [../templates/requirements-template.md](../templates/requirements-template.md) to generate complete specification.

### Content Sections (in order)

1. **Frontmatter**: Title, version, date, status
2. **Feature Overview**: Purpose, scope, success criteria
3. **Actors**: Who interacts, what roles
4. **Functional Requirements**: FR-001, FR-002, etc. (with nested Business Rules and BDD Scenarios)
5. **Data Requirements**: Information items, constraints
6. **Non-Functional Requirements**: Performance, security, etc.
7. **Assumptions & Dependencies**: What's assumed, what's needed
8. **Constraints**: Regulatory, business, technical
9. **Glossary**: Domain terms
10. **Traceability Matrix**: Scenario counts per requirement
11. **Acceptance Checklist**: Quality verification

### Key Rules

**Single File**:
- All content in requirements.md
- No separate .feature files
- No external references

**Nested Structure**:
- Business rules nested under relevant requirements
- BDD scenarios nested under their parent requirement
- Visual hierarchy shows relationships (no cross-references needed)

**Numbering**:
- Requirements: FR-001, FR-002, FR-003, ... (sequential across document)
- Scenarios: 001, 002, ... (sequential within each requirement)
- Business Rules: BR-001, BR-002, ... (sequential across document)

**Heading Levels**:
- Section: `##` (e.g., `## 3. Functional Requirements`)
- Requirement: `###` (e.g., `### FR-001: Title`)
- Subsections: `####` (e.g., `#### Business Rules`, `#### BDD Scenarios`)

## Step 6: Write File or Stage Inline Output

First, generate the specification content:

```python
file_content = generate_requirements_from_template(
    feature_name=feature_name,
    clarifications=clarifications,
    requirements=requirements,
    scenarios=scenarios
)
```

- If `delivery_mode != "inline"`: write `file_content` to `{file_path}` with your preferred file helper.
- If `delivery_mode == "inline"`: skip filesystem writes, but keep `file_content` available for validation and return.

## Step 7: Validate Output

### Mandatory Checks

Run these checks before reporting success:

#### File Checks (when writing to disk)
- [ ] File exists at correct path
- [ ] File size > 5KB (not trivially empty)
- [ ] File is valid UTF-8 text

#### Inline Checks (when returning content)
- [ ] Payload length > 5KB (or equivalent character threshold)
- [ ] Content encoded as UTF-8-safe string

#### Structure Checks
- [ ] All 11 sections present
- [ ] Frontmatter has title, version, date
- [ ] At least 1 requirement (FR-001 exists)
- [ ] At least 1 scenario nested under requirements
- [ ] No heading level gaps (## → ### → ####)

#### Nesting Checks
- [ ] Every requirement uses heading level 3 (###)
- [ ] Business Rules subsection uses heading level 4 (####)
- [ ] BDD Scenarios subsection uses heading level 4 (####)
- [ ] Scenarios are properly nested under requirements
- [ ] No orphaned scenarios (all under a requirement)

#### Traceability Checks
- [ ] Traceability matrix exists
- [ ] Matrix includes all requirements
- [ ] Matrix shows scenario count for each requirement
- [ ] Coverage calculation is 100%

#### Quality Checks
- [ ] No "should", "may", "could" in requirements
- [ ] All requirements have "SHALL" or "MUST"
- [ ] No vague terms ("quickly", "many", "user-friendly")
- [ ] All acceptance criteria are specific

### Validation Script Example

```python
def validate_output(content: str, *, file_path: str | None = None) -> dict:
    checks = {}

    if file_path:
        checks['file_exists'] = os.path.exists(file_path)
        checks['file_size_ok'] = os.path.getsize(file_path) > 5000
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    else:
        checks['payload_size_ok'] = len(content) > 5000

    checks.update({
        'has_requirements': '### FR-001' in content,
        'has_scenarios': '#### BDD Scenarios' in content,
        'has_business_rules': '#### Business Rules' in content,
        'has_traceability': 'Traceability Matrix' in content,
        'no_vague_terms': not any(term in content.lower()
                                  for term in ['should', 'quickly', 'many']),
        'proper_nesting': content.count('### FR-') > 0,
    })

    return {'passed': all(checks.values()), 'details': checks}
```

## Step 8: Report to User

### Success Message Format

```markdown
✅ Requirements specification created successfully!

📄 Output: {file_path or "Inline response"}

📊 Statistics:
   - Requirements: {N}
   - BDD Scenarios: {M}
   - Business Rules: {P}
   - Traceability: 100%

📝 File size: {X} KB

🔗 Next steps:
   1. Review the specification
   2. Share with stakeholders for approval
   3. Use as input for P3 Model Designer skill

📌 File location:
   {file_path}

Would you like me to:
- Generate a summary of the requirements?
- Create a visual diagram of the actors and actions?
- Proceed to design phase with P3 Model Designer?
```

### If Validation Fails

```markdown
⚠️ File created but validation warnings found:

📄 File: {file_path or "Inline response"}

⚠️ Warnings:
   - {warning_1}
   - {warning_2}

The file has been created but may need manual review.

Would you like me to fix these issues?
```

## Error Handling

### Error 1: Repository Root Unresolved

If git metadata and current working directory both fail to produce a usable path, switch to inline mode automatically and notify the user:

```markdown
ℹ️ Repository path could not be resolved, so I generated the requirements inline instead of writing to disk.
```

### Error 2: File Already Exists

```markdown
⚠️ File already exists at:
   {file_path}

Options:
A) Overwrite (you'll lose existing content)
B) Create new version (append -v2, -v3, etc.)
C) Use different feature name
D) Cancel operation

What would you like to do?
```

### Error 3: Permission Denied

```markdown
❌ Error: Permission denied

Cannot write to:
   {file_path}

This might be because:
- Directory requires elevated permissions
- File is read-only
- Disk is full

Please check permissions and try again.
```

## Post-Generation Tasks

### Optional Enhancements

After successful generation, offer:

1. **Generate Summary**:
   - Executive summary (1 page)
   - Key requirements list
   - Risk summary

2. **Create Visuals**:
   - Actor diagram
   - User flow diagram
   - State transition diagram

3. **Export Formats**:
   - HTML version (for sharing)
   - PDF version (for printing)
   - Confluence format (for wikis)

## File Metadata

Store metadata at top of file:

```markdown
---
created: 2024-10-21T10:30:00Z
created_by: Business Requirements Analysis Skill
feature_name: Order Tracking System
status: draft
version: 1.0
---
```

## Version Control Notes

**Do NOT**:
- Perform git operations
- Create branches
- Make commits
- Push changes

**User is responsible for**:
- Creating feature branch
- Committing requirements
- Pushing to remote
- Creating pull request

If the specification was returned inline, remind the user to write it to `specs/{date}_{slug}/requirements.md` (or preferred location) before running these commands.

**Remind user**:
```markdown
💡 Don't forget to commit your requirements:

git checkout -b feature/order-tracking
git add specs/2024-10-21_order-tracking-system/
git commit -m "feat: add requirements for order tracking"
git push origin feature/order-tracking
```

## Integration Points

### Input (from clarification dialog)

Receives:
- Feature name
- Clarification answers
- Requirements list
- Scenarios list
- Business rules
- Data requirements
- Assumptions
- Constraints

### Output (for design phase)

Produces:
- Single requirements.md file
- Complete specification
- BDD scenarios (embedded)
- Traceability matrix

### Handoff to Next Phase

```markdown
✅ Requirements complete!

This file is ready for Phase 2: Design

Next: Use the P3 Model Designer skill with this command:

"Using the requirements at specs/2024-10-21_order-tracking/requirements.md,
 design the P3 model changes needed to implement this feature."
```

## Quality Standards

### File Must Have

- ✅ Clear feature name and description
- ✅ All actors identified
- ✅ At least 5 functional requirements
- ✅ At least 10 BDD scenarios (nested under requirements)
- ✅ Business rules nested under relevant requirements
- ✅ Corner cases addressed
- ✅ Traceability matrix complete
- ✅ Acceptance checklist included
- ✅ Proper heading hierarchy (## → ### → ####)

### Typical Sizes

- **Simple feature** (5-10 requirements): 15-30 KB
- **Standard feature** (11-20 requirements): 30-60 KB
- **Complex feature** (21+ requirements): 60-120 KB

**If < 5KB**: Specification is likely incomplete

## Troubleshooting

**Problem**: File is too short
- **Cause**: Missing sections or scenarios
- **Fix**: Review template, ensure all sections included

**Problem**: Scenarios not nested under requirements
- **Cause**: Incorrect heading levels or structure
- **Fix**: Ensure scenarios are under `#### BDD Scenarios` within each requirement

**Problem**: Duplicate requirement IDs
- **Cause**: Numbering error
- **Fix**: Renumber requirements sequentially

**Problem**: Missing scenarios for requirements
- **Cause**: Forgot to add BDD Scenarios subsection
- **Fix**: Add `#### BDD Scenarios` subsection under each requirement

## Checklist

Before reporting success:

- [ ] Repository path obtained
- [ ] Feature slug generated correctly
- [ ] Directory created
- [ ] File written to correct path
- [ ] All sections present (11 total)
- [ ] Requirements numbered correctly
- [ ] Scenarios numbered correctly within each requirement
- [ ] Business rules and scenarios properly nested
- [ ] No heading level gaps
- [ ] Traceability matrix complete
- [ ] File size > 5KB
- [ ] No validation errors
- [ ] User notified with file path
- [ ] Next steps provided
