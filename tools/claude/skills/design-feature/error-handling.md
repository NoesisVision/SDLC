# Error Handling

## p3model.json Not Found
1. Inform user: "I couldn't locate p3model.json in the repository."
2. Use AskUserQuestion tool with options:
   - "Proceed without P3 analysis"
   - "Use different file path"
3. Wait for response before continuing

## Invalid p3model.json Structure
1. Inform user: "p3model.json exists but has structural issues: [specific error]"
2. Use AskUserQuestion tool with options:
   - "Ignore and proceed"
   - "Abort design"
   - "Try again (after user fix)"
3. You MUST NEVER guess structure

## User Provides Contradictory Requirements
1. Detect contradiction: FR-XX says Y, but FR-YY says Z
2. Present both to user with specific conflict description
3. Use AskUserQuestion tool presenting both options with clear descriptions
4. Update requirements based on response

## Repository Root Cannot Be Determined
1. Attempt: git rev-parse --show-toplevel
2. If fails: Search upward for .git directory
3. If still fails: Inform user and return design content in response (do not write file)

## User Requests Out-of-Scope Task
Examples: "implement this", "write the code", "create unit tests"
1. Inform user: "That's outside the design phase scope."
2. Use AskUserQuestion tool with options:
   - "Add implementation notes to design"
   - "Defer to implementation phase"

## Unclear User Input
You MUST use AskUserQuestion tool to ask user for clarification with relevant options. NEVER guess or infer unclear requirements.

**Before Using AskUserQuestion Tool:**
1. Verify ambiguity cannot be inferred from existing context (requirements, design sketch, P3 model)
2. Ensure question is specific with clear options (not open-ended)
3. Provide 2-4 mutually exclusive answer options (tool adds "Other" automatically)
4. Confirm timing is appropriate (don't ask mid-step; ask at decision points)

## Multiple Equally Valid Design Solutions
You MUST use AskUserQuestion tool when there are multiple equally valid solutions. Present each option with description. NEVER proceed with design without explicit user choice.

## User's Design Sketch Conflicts with Requirements
1. Identify specific conflict: "Requirement FR-XX says Y, but design sketch proposes Z"
2. Use AskUserQuestion tool with options:
   - "Prioritize requirement (adjust sketch)"
   - "Prioritize design sketch (adjust requirement)"
   - "Hybrid approach" (specify how to combine both)
3. Update affected artifacts based on response
