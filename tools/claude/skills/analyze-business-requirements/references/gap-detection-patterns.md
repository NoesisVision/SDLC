# Gap Detection Patterns

When analyzing user requirements, systematically scan for three types of gaps:

## A. Ambiguities (Vague Language)

### Triggers

**Fuzzy Quantities**:
- "many", "few", "some", "several", "multiple"
- Replace with: specific numbers or ranges

**Vague Time**:
- "quickly", "soon", "eventually", "real-time", "promptly"
- Replace with: actual durations (2s, 1hr, within 24h)

**Unclear Quality**:
- "user-friendly", "intuitive", "simple", "easy"
- Replace with: specific usability criteria

**Relative Terms**:
- "better", "faster", "more", "improved"
- Replace with: specific comparisons or metrics

**Modal Confusion**:
- "should", "may", "could", "might"
- Replace with: SHALL (mandatory) or optional (clearly stated)

### Example

**Input**: "Users should be able to upload files quickly"

**Ambiguities Found**:
- "quickly" → What is the target time? (2s? 5s? 30s?)
- "files" → What types? What size limits?
- "should" → Is this mandatory or optional?

## B. Missing Information (Critical Gaps)

### Boundaries

Questions to ask:
- "What happens at limits?" (min/max values)
- "What are the thresholds?" (quantity, time, size)
- "Where do we draw the line?" (business rules)

**Example**: "Users can add items to cart"
- Missing: Maximum items per cart?

### Error Cases

Questions to ask:
- "What if the operation fails?"
- "What if data is invalid?"
- "What if the user has insufficient permissions?"
- "What if an external service is down?"

**Example**: "System sends email notification"
- Missing: What if email service is unavailable?

### Constraints

Questions to ask:
- "Who can perform this action?" (authorization)
- "When can this action occur?" (timing, state)
- "What are the prerequisites?" (dependencies)
- "What resources are required?" (system resources)

**Example**: "Users can delete their account"
- Missing: Can they do this if they have active subscription?

### Outcomes

Questions to ask:
- "What happens after success?"
- "What feedback does the user receive?"
- "What state changes occur?"
- "How is success confirmed?"

**Example**: "Users can submit feedback"
- Missing: Do they get confirmation? How?

## C. Corner Cases (Edge Conditions)

### Boundary Patterns

**Zero Case**:
- "What if quantity is 0?"
- "What if there are no results?"

**One Case**:
- "What if there's exactly 1 item?"
- "What if only one user exists?"

**Maximum Case**:
- "What if at limit?" (storage, count, size)
- "What if maximum concurrent users?"

**Just Over/Under**:
- "What if 1 over limit?"
- "What if 1 under threshold?"

**Example**: Premium tier at $10,000 lifetime value
- Just under: $9,999 → Which tier?
- Exact: $10,000 → Which tier?
- Just over: $10,001 → Which tier?

### Timing Patterns

**Simultaneous Actions**:
- "What if two users do this at once?"
- "What if user clicks twice quickly?"

**Sequence Issues**:
- "What if done out of order?"
- "What if prerequisites not met?"

**Repetition**:
- "What if done multiple times?"
- "What if user retries after failure?"

**Timeout**:
- "What if it takes too long?"
- "What if user navigates away during process?"

**Example**: "Users can delete their account"
- What if user clicks delete twice quickly?

### Special Values

**Empty Input**:
- "What if input is empty string?"
- "What if no data provided?"

**Null/Missing**:
- "What if value doesn't exist?"
- "What if optional field is omitted?"

**Invalid Format**:
- "What if format is wrong?"
- "What if data type mismatch?"

**Special Characters**:
- "What if input has unicode/emoji?"
- "What if input has SQL injection attempt?"

**Example**: Email validation
- Empty: ""
- Invalid format: "notanemail"
- Special chars: "user+tag@example.com"

### State Conflicts

**Already Exists**:
- "What if trying to create duplicate?"
- "What if username already taken?"

**Doesn't Exist**:
- "What if trying to modify non-existent?"
- "What if resource was deleted?"

**In Progress**:
- "What if operation already running?"
- "What if in intermediate state?"

**Locked**:
- "What if resource is locked by another process?"
- "What if in read-only mode?"

**Example**: "Users can edit their profile"
- What if another session is editing it?
- What if profile was deleted by admin?

## Detection Workflow

1. **Read requirement** carefully
2. **Check for triggers** (ambiguous language)
3. **Identify missing dimensions** (boundaries, errors, constraints, outcomes)
4. **Generate corner cases** (boundaries, timing, special values, state conflicts)
5. **Formulate questions** (specific, actionable)
6. **Group by category** (ambiguities, missing info, corner cases)
7. **Present to user** (5-7 questions at a time)

## Question Quality

**Good Questions**:
- ✅ Specific and focused
- ✅ Provides context (why it matters)
- ✅ Offers options with implications
- ✅ Has clear impact on behavior

**Poor Questions**:
- ❌ Too broad ("What about errors?")
- ❌ No context (why it matters)
- ❌ No guidance (user guessing)
- ❌ Unclear impact

## Examples

### Example 1: File Upload

**Input**: "Users can upload files"

**Detected Gaps**:

Ambiguities:
- None (straightforward action)

Missing Information:
- File types allowed? (PDF, images, all?)
- Maximum file size? (10MB? 100MB?)
- What if upload fails? (retry? error message?)
- What if file already exists? (overwrite? rename?)
- Who can see uploaded files? (uploader? everyone?)

Corner Cases:
- Zero size file (0 bytes)
- Exactly at size limit
- Just over size limit
- Empty filename
- Special characters in filename
- Duplicate upload attempt

### Example 2: Order Processing

**Input**: "Premium customers skip payment verification"

**Detected Gaps**:

Ambiguities:
- "Premium customers" - How defined? (by tier? value?)

Missing Information:
- What if customer status changes during order?
- What if payment verification is required by regulation?
- What if premium customer has payment issue?

Corner Cases:
- Customer becomes premium after order started
- Customer loses premium status during checkout
- Customer exactly at premium threshold
- New premium customer (no history)

## Tips

1. **Start broad, then narrow**: First pass for obvious gaps, second pass for subtle ones
2. **Think adversarially**: "How could this break?"
3. **Consider context**: Domain-specific corner cases
4. **Use checklists**: Systematically check each pattern
5. **Batch questions**: Present 5-7 at a time, not 20+
