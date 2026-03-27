# Architecture Review — Order Persistence & Bounded Context Integration

**Date:** 2026-02-18
**Duration:** ~22 minutes
**Participants:** James (Tech Lead), Tomasz (Senior Developer), Linh (Backend Developer)
**Recording:** Teams Meeting — Sales Domain Architecture

---

**James** [14:00]: Alright, I think we're recording now. Tomasz, can you see my screen? I've got the repo pulled up.

**Tomasz** [14:00]: Yes, I see it. The DDD starter project, the `Sales.Adapters` folder. Good.

**James** [14:00]: Perfect. So today I want to go through two things. First, we need to decide on the persistence strategy for the Order aggregate — we've been going back and forth for two sprints and it's slowing people down. And second, I want to talk about how Sales integrates with RiskManagement, there's a synchronous call in `PlaceOrderHandler` that I've been thinking about. Sound good?

**Tomasz** [14:01]: Sounds good. I actually prepared some notes, I was going through all four implementations yesterday evening. I have opinions.

**James** [14:01]: Ha, I'd expect nothing less. Let me just check — Linh, are you — oh, I don't think she's joined yet. Do you see her in the call?

**Tomasz** [14:01]: No, she is not here. I think she had that standup with the platform team, the one about the infrastructure migration. It was supposed to finish at two, so she should be here any moment.

**James** [14:01]: Right, okay. Let's give her a minute then. No point starting without her, she's been working on the read side queries so her input matters. Actually, while we wait — have you had coffee yet today? I'm on my third cup and it's barely past two. This morning was brutal.

**Tomasz** [14:01]: Ha, only my second. But you know what they say, the day is young. I think there might be time for third one after this meeting.

**James** [14:02]: Definitely. Oh, I think that's Linh joining now.

**Linh** [14:02]: Hello everyone, I apologize for being late. The platform standup ran over by a few minutes — they had questions about the database provisioning timeline. I am here now and ready.

**James** [14:02]: No worries at all, Linh. We haven't started the real discussion yet. Can you see my screen share?

**Linh** [14:02]: Yes, I can see the repository. The Sales module adapters.

**James** [14:02]: Good. Okay so let me set the context. We've got the `Sales.Adapters` module open, and there are four variants of `OrderSqlRepository`. The EF Core version in `OrderSqlRepository.EF.cs`, a raw SQL implementation, the Marten document store approach in `OrderSqlRepository.Document.cs`, and event sourcing in `OrderSqlRepository.EventsSourcing.cs`. We need to pick one and commit. Every time someone touches Order persistence, they ask me "which one should I follow?" and I don't have a good answer. So today we decide.

**Tomasz** [14:03]: Yes, and I want to add that this ambiguity is actually causing problems beyond just confusion. I was reviewing Katya's pull request last week and she used the EF pattern for a new query, but then Mirko used the document store pattern for a write operation in the same sprint. We are accumulating inconsistency and it will only get worse.

**James** [14:03]: That's exactly the kind of thing I want to avoid. Alright, so let's lay out the options systematically. Tomasz, you mentioned you went through all four — give us the rundown. What can we eliminate quickly and what deserves serious discussion?

**Tomasz** [14:04]: Okay so, I went through all four implementations in detail. The raw SQL one — I think we drop it immediately. Yes, it gives full control and in theory best performance, but the boilerplate is enormous. You write all mapping by hand, every column to every property, all relationship loading. And we don't have performance problem that would justify this. Our order volume is couple hundred per day. Raw SQL optimization is solving problem we don't have.

**James** [14:04]: Agreed. Linh, any objection to dropping raw SQL from consideration?

**Linh** [14:04]: No, I fully agree. The raw SQL implementation would be very difficult to maintain as the aggregate evolves. I think we should focus on the other three.

**James** [14:05]: Good, unanimous on that. So we're really choosing between EF Core, Marten Document Store, and Event Sourcing. Tomasz, continue.

**Tomasz** [14:05]: Right. So let me talk about Event Sourcing first, because I know this is the one that looks the most exciting. When I first saw `OrderSqlRepository.EventsSourcing.cs`, I was genuinely tempted. The appeal is obvious — you store domain events directly, you get a complete audit trail for free, you can replay the entire history of an order from creation to completion. From a pure DDD perspective, it is arguably the cleanest approach because events are first-class citizens in the domain model. And for something like Order, where compliance people and finance regularly ask us "what happened to this order, when did the price change, who approved the discount" — it seems like a very natural fit.

**James** [14:05]: Right, and that audit trail argument is genuinely strong. Finance has asked us about order history at least twice this quarter alone. Last time it took Mirko half a day to reconstruct what happened from the logs because we didn't have a proper audit trail. With ES, that would have been trivial.

**Tomasz** [14:06]: Yes, that is true. But — and this is where I changed my mind after spending more time with the implementation — the complexity cost is very real. Let me give you concrete examples. Event versioning. When we change the structure of, let's say, the `OrderItemAdded` event — maybe we add a new field, or rename a property, or change how we represent the product reference — we need upcasters. That is code that transforms old event shapes into new ones. Every schema change accumulates another upcaster. Over time you end up with this chain of transformations that you have to maintain and test.

**Linh** [14:06]: If I may add to that point — I have direct experience with event sourcing from my previous company. We used it for our payment processing system. The debugging experience is also quite challenging, more than people expect. When something goes wrong in production, you cannot simply open the database and look at the current state. You have to replay events to reconstruct what happened. You need specialized tooling for that — event store browsers, projection debuggers. Without mature tooling, your on-call engineers are essentially blind. It took our team about six months to build adequate debugging tools, and even then it was not as straightforward as querying a relational database.

**James** [14:07]: That's really valuable context, Linh. Six months just for tooling is significant. And then there's the snapshot problem too, right Tomasz?

**Tomasz** [14:07]: Exactly. If an Order aggregate grows to have — I don't know — thirty, forty, fifty events over its lifecycle, reconstituting it from events every single time you load it becomes slow. So you need snapshots, which is essentially periodic materialization of the current state. But now you have whole another piece of infrastructure to build and maintain — when to snapshot, how to snapshot, how to handle snapshots that were created before an event schema change. It is infrastructure on top of infrastructure.

**James** [14:07]: Okay, let me push back on one thing though. How many events would a typical Order actually accumulate? Are we really talking about fifty events?

**Tomasz** [14:08]: Probably not, honestly. A typical order in our system goes through maybe eight to twelve events — created, items added, pricing calculated, risk checked, confirmed, maybe a modification or two, then fulfilled. So the snapshot concern is maybe not so critical for our specific case. But the event versioning concern is real regardless of event count, and the tooling gap that Linh mentioned — that is real too.

**James** [14:08]: Fair point. And honestly, let's talk about scale. How many orders are we actually processing? What are the current numbers?

**Tomasz** [14:08]: On average, maybe two hundred orders per day. On a particularly busy day, maybe three hundred. It is, you know, it is not exactly a high-throughput trading system or an e-commerce platform handling Black Friday traffic. We are a B2B sales system with a relatively small number of customers placing relatively large orders.

**James** [14:09]: Two to three hundred a day. So the scale argument for ES — the ability to handle massive write throughput, the append-only store optimization — none of that applies to us. We don't need that kind of throughput optimization.

**Tomasz** [14:09]: No, not at all. And this is where I want to propose what I think is the right answer. Marten Document Store. If you look at `OrderSqlRepository.Document.cs`, it stores the entire aggregate as a JSONB document in PostgreSQL. The aggregate is just serialized and deserialized as a whole. No mapping, no change tracking, no impedance mismatch. And here is the important part — Marten has built-in support for event projections, so if we later decide we need audit trail capabilities, we can capture domain events alongside the document store without having to reconstitute state from events. We get the audit benefit without the full event sourcing complexity.

**Linh** [14:09]: I would like to understand this better. Does this mean we store the entire Order — including all order items, pricing details, all the value objects — as a single JSON document in one database column?

**Tomasz** [14:10]: Yes, exactly. One document per Order aggregate instance. And this is actually a feature, not a limitation. Think about it from DDD perspective — the aggregate is supposed to be loaded and saved as a whole unit. That is the whole point of aggregate boundaries. With EF Core, you fight against that because the ORM wants to decompose your aggregate into separate tables — one for the order header, one for order items, another for price components, maybe joined tables for value objects. You end up with this complex mapping configuration that does not match how the domain works. With JSONB, you just say "here is my aggregate, serialize it, store it." The structure can evolve naturally — you add a new field to a value object, no migration needed, the JSON just includes the new field.

**James** [14:10]: That's clean for the write side, I agree. But what about querying? What about when we need to show a list of orders filtered by product, or by date range, or we need to join order data with customer information for a report? JSONB queries in PostgreSQL are possible but they're not exactly pleasant.

**Tomasz** [14:11]: Tak, this is very important point, and this is actually why I think we need to use CQRS approach. For querying — for the read side — JSONB is not ideal. You can query into JSON documents using PostgreSQL operators, yes, but it is slower than proper relational queries with real indexes, and the query syntax is, let's be honest, quite ugly and hard to maintain. So my proposal is this: Marten Document Store for the write side, where we care about aggregate consistency and domain logic and loading the full aggregate. And EF Core for the read side, where we care about fast queries, filtering, sorting, pagination, joins.

**James** [14:11]: Wait, so you're actually proposing we use two of the four implementations? That's an interesting twist. I was thinking we'd pick one and delete the other three.

**Tomasz** [14:11]: Not exactly two of the four existing implementations, but two approaches. The write model follows `OrderSqlRepository.Document.cs` pattern — store aggregate as document, no ORM mapping headaches, natural serialization. The read model uses EF Core but with flat read-model projections — not the complex aggregate mapping, but simple DTOs optimized for specific queries. Think of it as having an `OrderReadModel` table with denormalized columns that EF Core can query efficiently — proper indexes, proper relational structure, all the things that SQL databases are actually good at.

**Linh** [14:12]: I think this approach has significant merit. The separation of concerns is very clean — you write through the document store and read through optimized projections. But I have a practical concern. How do we keep the read model synchronized with the write model? If someone places an order through the document store, how does the EF Core read model know about it? Is there a projection mechanism that updates the read side automatically?

**Tomasz** [14:12]: Good question, and yes, Marten supports this natively. It has what they call inline projections — when you save a document, Marten can automatically update read model tables in the same database transaction. So there is no eventual consistency problem, no lag between write and read. You save the order document and the read model projection is updated atomically in same transaction. Marten also supports async projections for cases where you want eventual consistency, but for our scale, inline projections are perfectly fine. There is no performance concern with two hundred orders per day.

**James** [14:13]: Alright, let me play devil's advocate for a minute here. Why not just use EF Core for everything? It's the simplest option — one technology, one approach, the whole team already knows it, we've used it in every other module. And honestly, the Order aggregate isn't that complex. We're not building some crazy graph of entities. It's an order with items, prices, and some value objects. Can't EF Core handle that?

**Tomasz** [14:13]: It can handle it, technically. But "can handle" and "handles well" are different things. EF Core has a real impedance mismatch problem with rich domain models. Let me give you concrete examples from our own codebase. Order aggregate has value objects — `MoneyAmount`, `ProductAmount`, `TaxId`. In EF Core, each of these needs owned type configuration. You need to configure how they map to columns, how collections of value objects are stored. I personally spent two full days last month — two days! — debugging an issue where EF Core's change tracker was not detecting changes to a nested value object inside an order item. The change was happening in the domain model but EF Core didn't see it because the change tracker compares by reference for owned types and our value object was being replaced with a new instance that happened to be structurally identical to the old one. It was a nightmare to diagnose.

**Linh** [14:14]: I can confirm that experience from my own work. When I implemented the Price value object mapping for the read-side queries last sprint, the owned entity configuration code was significantly longer than the actual domain logic it was supporting. I had more lines of Fluent API configuration than lines of business logic. That feels like a signal that the tool is fighting against the design, not supporting it.

**James** [14:14]: Yeah, I remember that PR. The configuration class was like eighty lines just for the price mapping. That's a fair point. And Marten is already in our stack, right? We're already running PostgreSQL, and I think Marten is referenced in the project dependencies.

**Tomasz** [14:15]: Yes, Marten is already a dependency. We are not introducing new technology, just using one that is already there in more intentional way.

**James** [14:15]: Alright, I'm convinced. Let me try to summarize and see if we're all aligned. For the Order aggregate persistence, we're going with Marten Document Store for the write side. The key reasons are: it eliminates the ORM impedance mismatch that's been causing us real pain with EF Core, especially around value objects like `MoneyAmount` and `ProductAmount`. Aggregates are stored and loaded as complete documents, which aligns naturally with how DDD aggregates are supposed to work — as consistency boundaries that are loaded and saved as a whole unit. The JSONB format gives us flexibility for schema evolution without requiring database migrations for every value object change. For the read side, we use EF Core with flat relational projections, optimized for querying. We use Marten's inline projections to keep the read model in sync within the same transaction. And we're passing on Event Sourcing because the complexity of event versioning, snapshot management, and specialized debugging tooling isn't justified at our current scale of two to three hundred orders per day. Are we all aligned on that?

**Tomasz** [14:16]: Yes, I am fully in favor. And I want to add one more thing — if compliance requirements become stricter and we truly need a complete audit trail, we can add event capturing alongside the document store. Marten supports this natively. So we are not closing the door on audit capabilities, we are just not paying the full Event Sourcing tax to get them.

**Linh** [14:16]: I also agree with this decision. It is a pragmatic and well-reasoned choice. I would only suggest that we explicitly document the criteria under which we would revisit Event Sourcing in the future — perhaps if order volume grows by an order of magnitude, or if regulatory audit requirements become significantly more strict. Having those triggers written down will help us avoid the "we should have done ES from the start" argument later.

**James** [14:16]: Great point, Linh. I'll note that in the ADR. Okay, so that's decided. Let me update my notes... Marten Document Store for write side, EF Core for read side, CQRS split. Three reasons: impedance mismatch, natural aggregate storage, scale doesn't justify ES. Good. Moving on.

**James** [14:17]: Alright, topic two. This one might be a bit more contentious based on some Slack messages I've seen. I've been looking at how the Sales bounded context integrates with RiskManagement. If you open `PlaceOrderHandler.cs` — let me scroll to it — you can see that when we place an order, the handler calls `RiskManagementIntegration.GetMaxOrderTotalCostFor()`. This is a synchronous call. It blocks the order placement flow until RiskManagement responds with the maximum allowed order cost for that client. So the question is: is this the right pattern, or should we decouple these bounded contexts?

**Tomasz** [14:17]: I know this code well, I actually wrote the original integration. The handler needs to check maximum allowed order total cost for the client before it can accept the order. The `RiskManagementIntegration` is a port — an interface defined in the Sales domain — and the adapter in `Sales.Adapters` makes the call to the risk management module. Right now it is synchronous, in-process call.

**James** [14:18]: Right. So what are our options? I see basically three paths: keep it synchronous as is, switch to asynchronous events with some kind of process manager or saga, or maybe some hybrid approach. Tomasz, I know you have a strong opinion here, go ahead.

**Tomasz** [14:18]: I do have strong opinion, yes. I think we should keep it synchronous. And I know this might not be the fashionable answer — everyone wants to do async event-driven everything these days, it is very trendy — but let me explain why I think sync is the right choice here. First, and this is critical context: this is not a network call to some external REST API or a message sent over RabbitMQ. Sales and RiskManagement are modules within the same application, the same deployment unit, the same process. When we call `GetMaxOrderTotalCostFor()`, it is essentially a function call that happens to go through an interface. There is no network latency, no serialization overhead, no transport reliability concern. It is just method invocation.

**Tomasz** [14:18]: Second — and I think this is even more important — the order placement flow fundamentally, semantically requires the risk assessment answer before it can proceed. You cannot place an order without knowing whether the risk check passes. The domain logic requires it. If we make this async, what happens? We accept the order into some "pending risk assessment" state, show the user a "your order is being processed" message, and then... what? Two seconds later we reject it because the risk check failed? That is terrible user experience. The user expects to know immediately whether their order was accepted.

**Linh** [14:19]: I would respectfully disagree with that assessment, or at least I would like to present an alternative perspective. I would like to suggest that we seriously consider an asynchronous approach with a process manager. I have direct experience with this pattern and I think the benefits are significant.

**Linh** [14:19]: At my previous company, we had a very similar architecture. An order service called a fraud detection service synchronously to validate orders. For two years it worked fine. Then the fraud detection service started having intermittent performance issues — sometimes the response took five seconds instead of fifty milliseconds. Because the coupling was synchronous, every slow fraud check blocked an order placement thread. During peak hours, we ran out of threads, the connection pool was exhausted, and the entire order pipeline went down. Not just slow — completely down. Users could not place any orders at all, even ones that had nothing to do with fraud detection. The blast radius of that synchronous coupling was much larger than anyone anticipated.

**James** [14:20]: That's a concerning scenario. What would the async version look like concretely in our codebase?

**Linh** [14:20]: So the flow would be as follows. `PlaceOrderHandler` would no longer call `RiskManagementIntegration` directly. Instead, it would create the Order in a "pending risk assessment" state and publish an `OrderPlacementRequested` domain event. The RiskManagement bounded context would subscribe to that event, perform its assessment asynchronously, and publish back either an `OrderRiskApproved` or `OrderRiskRejected` event. We would have a process manager — some people call it a saga, although technically the saga pattern is slightly different — that coordinates this flow. The process manager tracks the state of the order placement process and handles timeouts, retries, and compensation.

**Tomasz** [14:20]: Linh, I understand the scenario you described, and it sounds like it was very painful experience. But I have to push back on applying that lesson directly to our situation. You are adding enormous complexity to solve a problem that we do not currently have and, I would argue, are unlikely to have. Think about what the async version requires. You need a process manager — that is a stateful component that needs its own persistence, its own error handling. You need to handle timeouts — what if risk management never responds? Do you retry? How many times? What if it responds after the timeout? You need compensation logic — if the order is partially created and then rejected, do you delete it or mark it as rejected? You need the UI to handle an intermediate "pending" state, with polling or websockets to notify the user when the assessment completes. And you need all of this to be reliable and tested. That is easily several hundred lines of additional code, new infrastructure, new failure modes.

**Linh** [14:21]: I accept that the complexity is significant. However, I think we should also consider future architecture evolution. If our system grows and we ever need to extract RiskManagement into a separate deployed service — which is a very common evolution path for modular monoliths — then the async pattern would already be in place. With synchronous in-process coupling, that extraction becomes a much larger refactoring effort. You would need to introduce the intermediate state, redesign the UI flow, handle all the distributed systems edge cases that you were not dealing with before, all at the same time as the service extraction itself.

**James** [14:21]: That's the speculative architecture argument though, right? We'd be building complexity now for a future that might not materialize. I've seen teams do that and end up maintaining infrastructure they never needed.

**Linh** [14:22]: That is a fair characterization. But the cost of changing from synchronous to asynchronous later is significantly higher than building it asynchronous from the beginning. You need to change the domain model for intermediate states, change the UI for pending states, introduce a process manager, handle ordering and idempotency edge cases. If you design for async from the start, these concerns are part of the initial design.

**Tomasz** [14:22]: But that argument assumes that we will need async, which is exactly what is uncertain. Let me give you some numbers. Right now the synchronous code in `PlaceOrderHandler` is maybe twenty lines that are relevant to the risk check — call the integration, check the result, proceed or reject. Very clear, very easy to debug, anyone on the team can understand it in five minutes. The async version with a process manager, saga state machine, timeout handling, compensation actions, event handlers, state persistence — that is easily two hundred to three hundred lines, plus new infrastructure components. You are paying a definite, concrete cost today — in development time, in code complexity, in cognitive load for every developer who needs to understand the order placement flow — for a hypothetical benefit that may never materialize. This is exactly what the YAGNI principle warns us about. You Ain't Gonna Need It until you actually need it.

**James** [14:23]: I tend to agree with Tomasz on the YAGNI point, but Linh's experience is real. What about a middle ground? We keep it synchronous now, but we make sure the integration interface is clean enough that swapping to async later — if we need to — wouldn't require rewriting the domain logic?

**Tomasz** [14:23]: James, this is actually already the case if you look at the code. The `RiskManagementIntegration` interface is a clean port defined in the domain layer. The `PlaceOrderHandler` depends on that abstraction, not on any concrete implementation. If we later decide to change how the communication works — whether that is switching to async messaging, or extracting it to a REST call, or anything else — we change the adapter implementation, not the handler, not the domain logic. The bounded context boundary is already well-defined. We have clean separation. The effort to swap the implementation later would be contained.

**Linh** [14:23]: I see the point about the clean interface, and I accept that the abstraction boundary is well-designed. That does reduce the retrofitting cost significantly. But may I raise one more concern? Resilience. Even with in-process calls, we might want circuit breaker or retry logic in the future. If we add that to the synchronous call, we are adding complexity there too — just a different kind of complexity. With async messaging and an outbox pattern, you get retry and resilience from the messaging infrastructure essentially for free. I noticed that the `TechnicalStuff` module in this very repository already has outbox pattern infrastructure available.

**Tomasz** [14:24]: Yes, the outbox is there, you are right about that. But the resilience argument does not quite apply here. Same process, same deployment, same database even. There is no network to be unreliable. The only way this in-process call fails is if the application itself is crashing or the database is down, and in that case, no amount of retries or circuit breakers will help you. The failure mode of an in-process call is completely different from the failure mode of a network call. Linh, your fraud detection scenario was a network call to a separate service, yes? That is fundamentally different from what we have here.

**Linh** [14:24]: Yes, that is correct. It was a separate service connected over HTTP. The failure characteristics are indeed different for in-process communication.

**James** [14:24]: I think that's a key distinction. The resilience argument is very compelling when you're calling across network boundaries — unreliable networks, service restarts, load balancer timeouts, all that distributed systems complexity. But within a monolith, within a single process, the failure modes are different. If risk management is broken, the whole application is likely broken, and retrying won't help.

**James** [14:25]: Look, Linh, I genuinely appreciate you pushing on this. Your experience at your previous company is exactly the kind of real-world learning that should inform our architecture decisions. And you're right that if we ever do go to microservices, the sync pattern would need to change. But I think for our specific situation — two to three hundred orders a day, single deployment, shared process, co-deployed modules — the synchronous approach gives us the simplest, most debuggable, most maintainable solution. And the clean port interface means the migration cost if we do need to change is manageable.

**Linh** [14:25]: I understand and I accept the team's decision. I want to make sure my position is recorded clearly — I am not arguing that synchronous is wrong for today. I am concerned about tomorrow. But I accept that YAGNI is a valid engineering principle and that our context is different from my previous experience. If we document the assumption that Sales and RiskManagement remain co-deployed in the same process, and we define clear triggers for revisiting this decision, then I am comfortable with keeping the synchronous integration.

**James** [14:25]: That's exactly the right framing. We document the architectural assumption — co-deployment of Sales and RiskManagement — and we define triggers for revisiting: service extraction plans, order volume increasing by an order of magnitude, or any incident where the synchronous coupling causes availability issues.

**Tomasz** [14:26]: Agreed, fully. And Linh, I want to say this — your experience with the fraud service outage is exactly the kind of real-world knowledge that should inform our architecture decisions. I don't dismiss it at all. I just think our context is sufficiently different that the same solution does not apply. If we had microservices architecture, if these were separate deployments communicating over the network, I would be the first person to argue for async messaging with an outbox pattern. Context matters enormously in these decisions.

**Linh** [14:26]: Thank you, Tomasz. I appreciate that acknowledgment. And yes, context is everything in architecture. I think we are making the correct decision for our current situation. We should discuss the specific volume threshold for revisiting at the next sprint planning, if that is acceptable. I think it would be more useful to have a concrete number — say, five thousand orders per day — rather than a vague "when traffic grows" statement.

**James** [14:26]: Absolutely, good idea. I'll add that to the sprint planning agenda for next week. Okay, let me formalize the decision for the recording.

**James** [14:27]: Decision on bounded context integration: we keep the synchronous integration between Sales and RiskManagement via the `RiskManagementIntegration` interface. `PlaceOrderHandler` continues to call `GetMaxOrderTotalCostFor()` synchronously. The rationale is: both modules are co-deployed in the same process, the call is essentially a local function invocation with no network reliability concerns, and the current scale of two to three hundred orders per day does not justify the complexity of asynchronous messaging, process managers, saga state machines, and compensation logic. We document the assumption of co-deployment and define explicit triggers for revisiting this decision. We also note that the `TechnicalStuff` module has outbox pattern infrastructure readily available if we decide to go async in the future, so the building blocks are there when and if we need them.

**Tomasz** [14:27]: That captures it well. The outbox in `TechnicalStuff` is a good reference point — it shows that we are not ignoring async patterns or pretending they don't exist. We are making a deliberate, informed choice not to use them yet, based on our current context and scale.

**James** [14:27]: Alright, let me do a final recap for the recording.

**James** [14:28]: Decision one — Order aggregate persistence. Marten Document Store with JSONB for the write side. Eliminates ORM impedance mismatch with value objects like `MoneyAmount`, `ProductAmount`, and `TaxId`. Aggregates stored as complete JSON documents, aligning with DDD aggregate boundaries. EF Core for the read side with flat relational projections — a CQRS approach. Marten's inline projections keep the read model in sync transactionally. Event Sourcing rejected due to event versioning complexity, snapshot infrastructure, and tooling requirements not justified at two to three hundred orders per day.

**James** [14:28]: Decision two — Sales and RiskManagement integration stays synchronous. `PlaceOrderHandler` continues calling `RiskManagementIntegration.GetMaxOrderTotalCostFor()` synchronously. Both contexts are co-deployed in the same process — local method call, no network reliability concerns. Async patterns would add substantial complexity without clear benefit at our scale. We document the co-deployment assumption and revisit if we plan service extraction or order volume increases significantly.

**James** [14:28]: Alright, that's a wrap. Two decisions made, nobody is bleeding. I call that a successful architecture review. Tomasz, can you update the ADR document with these decisions this afternoon?

**Tomasz** [14:28]: Yes, I will write up both ADRs today. I will include the alternatives we considered and the reasoning for rejecting them, the way we discussed.

**Linh** [14:28]: Thank you both. This was a very productive discussion. I learned a lot about the Marten Document Store approach — I had not considered the CQRS split with inline projections before. That is quite elegant.

**James** [14:28]: Great meeting, everyone. See you at standup tomorrow morning. Have a good rest of the afternoon. And Tomasz — maybe get that third coffee now.

**Tomasz** [14:28]: Ha, already on my way. Bye everyone.

**Linh** [14:28]: Goodbye, have a good afternoon.
