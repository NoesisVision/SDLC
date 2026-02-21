# Idea unit detection
Status: Done

## Goal
Create a new MCP tool in noesis_local server that detects topics in a conversation.

Idea unit is a fragment of a statement (from one word to several sentences) of one person that carries one, coherent piece of information.

## Input format

List of speaker turns: `SpeakerTurn[]`

## Data structures

```python
class IdeaUnitCategory(str, Enum):
    Issue = 'Issue'
    Position = 'Position'
    Argument = 'Argument'
    Decision = 'Decision'
    Irrelevant = 'Irrelevant'
    
class IdeaUnit(BaseModel):
    sentences: list[str]
    category: IdeaUnitCategory

class TopicStatement(BaseModel):
    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time of the statement relative to the beginning of the conversation in HH:MM format")
    idea_units: list[IdeaUnit]

class Topic(BaseModel):
    name: str = Field(description="Name of the topic that briefly describes its essence")
    summary: str = Field(description="A 1-3 sentence description of what has been discussed in this topic")
    statements: list[TopicStatement]


class StructuredConversation(BaseModel):
    title: str = Field(description="Title of the conversation"),
    date: str = Field(description="Date and time of the first statement in YYYY-MM-DD HH:MM format"),
    topics: list[Topic]
```

`StructuredConversation` should be saved as a JSON file in the location of the imput file. The file name should be the same as the input file name plus `_structured` postfix.

## Output format
Output should be an object with the following structure:

```python
class ConversationSummary(BaseModel):
    title: str = Field(description="Title of the conversation"),
    date: str = Field(description="Date and time of the first statement in YYYY-MM-DD HH:MM format"),
    topics: list[TopicSummary]

class TopicSummary(BaseModel):
    name: str = Field(description="Name of the topic that briefly describes its essence")
    summary: str = Field(description="A 1-3 sentence description of what has been discussed in this topic")
```

## Design consideration

The Architecture Pipeline

### Phase 0: Use existing `clean_conversation` tool to extract speaker turns and clean the text. Call it as a normal function do not use MCP protocol for it because it's inside the same process.

To handle mid-turn topic shifts, non-linear topic resumption, and strict idea classification, you should split the logic into two distinct phases.

### Phase 1: Idea Unit Extraction & Classification (Turn Processing)

Because topic shifts can happen mid-turn, you must extract idea units before you assign topics.
1. Contextual Windowing: Pass the current turn, along with a rolling window of the previous 3-5 turns, to an LLM. The context is vital for resolving pronouns and understanding if a sentence is an Argument for a previous Position. 
2. Structured Output Extraction: Use a strict schema to force the model to group the pre-split sentences into "Idea Units" and classify them. 
3. Handling Noise: Include "Irrelevant" classification for sentences that contain phatic communication (e.g., "Can you hear me?", "Let's move on," or off-topic banter).

Use exactly these categories: Issue, Position, Argument, Decision, Irrelevant.
When calling LLM via `Context` object always use structured output and validate it.
Each input speaker turn has time (relative to the start of the conversation), so you always know what was said in the past and can be referred in next turns.
Overlapping Sentences: A single complex sentence might fall into multiple categories (eg. Position and Argument, or Argument and Decision). Idea Unit is already split into sentences. If distinct sentenc

Example LLM Prompt Logic for Phase 1: "Analyze the following Current Turn, using the Context Turns for reference. Group the sentences in the Current Turn into distinct 'Idea Units'. For each Idea Unit, classify it as exactly one of the following: Issue (a question or problem being addressed), Position (a proposed solution or stance on an Issue), Argument (evidence or reasoning supporting/opposing a Position), Decision (the final agreed-upon action/conclusion), or Irrelevant (filler, pleasantries, uninformative text). Return a list of JSON objects."
Creating a final prompt check best practices and optimize prompt for quality and token efficiency.

### Phase 2: Dynamic Topic Mapping (The Global Registry)

Once you have an array of classified Idea Units, you must map them to topics. Because speakers can jump back to previous topics at any time, sequential segmentation (like TextTiling) will fail. You need a Global Topic Registry.

**Structure of the Registry**

In your local MCP server, the registry should be maintained in memory (or a lightweight local database like SQLite/DuckDB if transcripts are massive) as a collection of Topic objects.

Each Topic in the registry needs the following properties:
- Topic ID: A unique identifier (e.g., topic_001). 
- Label: A short, LLM-generated title for the topic. 
- Summary: A running, 1-3 sentence description of what has been discussed in this topic so far. 
- Centroid Vector: The mathematical average of the embeddings of all Idea Units currently assigned to this topic. 
- Idea Unit IDs: A list of pointers back to the specific Idea Units (Issues, Positions, Arguments, Decisions) that belong to it.

**The Step-by-Step Matching Algorithm**

When Phase 1 outputs a new, classified Idea Unit (skipping Irrelevant ones), Phase 2 executes the following loop:

**Step A**: Embed the Idea Unit
Convert the text of the new Idea Unit into a dense vector embedding using a local model (like all-MiniLM-L6-v2).

**Step B**: Cosine Similarity Scoring
Calculate the cosine similarity between the new Idea Unit's vector and the Centroid Vector of every existing topic in the Global Topic Registry. Rank the existing topics from highest to lowest similarity.

**Step C**: The Tri-State Decision Logic
To guarantee high-quality output, rely on strict confidence thresholds to route the Idea Unit:
- High Confidence (e.g., > 0.82): Automatically assign the Idea Unit to the top-scoring topic. 
- Low Confidence (e.g., < 0.65): The Idea Unit is talking about something completely new. Create a new Topic in the registry. Pass the Idea Unit to the LLM to generate a new Label and initial Summary. 
- The Gray Zone (e.g., 0.65 - 0.82): Vector search isn't perfect, especially with abstract arguments. If the score falls here, trigger LLM Arbitration.

**Step D**: LLM Arbitration (Quality Check)
If an Idea Unit falls in the gray zone, do not guess. Construct a quick, deterministic prompt for the LLM. Provide the text of the Idea Unit and the Summary of the top 2-3 candidate topics from the registry. Ask the LLM to explicitly return the Topic ID it belongs to, or output NEW if it warrants a new topic.

**State Evolution (Updating the Registry)**

Once an Idea Unit is assigned to a topic (whether an existing one or a newly created one), the registry must update.
- Recalculate the Centroid: Update the topic's Centroid Vector by averaging it with the new Idea Unit's vector. This ensures the topic's mathematical representation "drifts" naturally as the conversation evolves. 
- Update the Summary: If a significant new Decision or Position is added to the topic, trigger a background LLM call to rewrite the topic's Summary. This ensures that future LLM Arbitrations (from Step D) have the most accurate, up-to-date context of the topic.  Use Chain of Density technique to modify Topic's description.
