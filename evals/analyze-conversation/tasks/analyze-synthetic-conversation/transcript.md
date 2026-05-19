**0:00**
Maya
Morning everyone. Can you all hear me? My headset was acting up yesterday.

**0:12**
Tom
Yeah, you come through fine. Let's give Priya a minute, she pinged that she's grabbing coffee.

**0:25**
Dev
No rush. The weather is finally decent today, first sun in a week.

**0:40**
Priya
I'm here, sorry. Okay, so the topic today is the pickup-code lifecycle for the parcel lockers. We need to nail down expiry and what happens on repeated failed attempts.

**1:05**
Maya
Right. Let's frame the scope first. A pickup code is the short numeric code a customer types on the locker keypad to open their compartment. We're deciding how long that code stays valid and how the system reacts when someone keeps entering it wrong.

**1:40**
Tom
On storage: the simplest thing is to store the code in Redis with a TTL equal to the validity window. When the TTL elapses the key just disappears and the code is dead. No cleanup job, Redis handles eviction for us.

**2:10**
Priya
That's attractive operationally. Does it cover the case where support needs to see why a customer's code stopped working?

**2:30**
Maya
That's exactly my concern. If the code only lives in Redis and then evaporates, we have no record that the code ever existed once it expires. Support gets a ticket two days later and there's nothing to look at, no expiry timestamp, no audit trail.

**3:05**
Tom
Hm. We could mirror it into a log line, but that's a side channel nobody will trust as the source of truth.

**3:25**
Maya
Because we need an auditable history of every code and exactly when it expired, we'll persist the pickup code and its expiry timestamp in the Postgres pickup_code row. Redis stays purely as a hot-path cache for the validity check, not the source of truth.

**3:55**
Tom
Yes.

**4:10**
Priya
Good. So Postgres is authoritative, Redis is the cache. That settles storage.

**4:30**
Dev
Quick one while I'm thinking about it — there's a separate cross-cutting rule we keep coming back to: every state change on a pickup code, issued, used, expired, locked, has to be written to the audit trail. That's not specific to storage, it applies everywhere we touch a code.

**5:00**
Maya
Agreed, treat that as a general rule over the whole code lifecycle, not something owned by one part. Now, the retry behaviour. What do we do when a customer fumbles the code?

**5:30**
Tom
I'd say three attempts. After the third wrong entry we lock that compartment slot and notify support so a human can step in. Three is the usual ceiling and it stops brute forcing.

**5:55**
Priya
Three then lock and notify support works for me. No objections from product.

**6:10**
Maya
Then that's decided: three failed attempts, lock the slot, push a notification to the support queue. No alternative on the table, it's clean.

**6:35**
Dev
So just to be sure I wire the guard correctly — we hard-fail and lock on the third attempt, we don't give a grace retry after a delay?

**6:50**
Maya
Yes.

**7:05**
Priya
Last open item: the actual validity duration. Is a code good for 24 hours or 48?

**7:20**
Tom
Lockers in transit hubs get picked up fast, 24 is plenty. But residential lockers in low-traffic areas, people sometimes come on the weekend. 48 is safer there.

**7:45**
Maya
I lean 48 across the board for simplicity, one number is easier to reason about than per-locker tuning. But I don't want to commit until ops confirms the compartment occupancy impact of holding slots for two days.

**8:10**
Priya
Let's leave duration open then. Tentatively 48, pending the ops occupancy review. We'll confirm next week.

**8:30**
Dev
Sounds good. I'll prototype the expiry job assuming a configurable window so we're not blocked on the exact number.

**8:50**
Maya
Perfect. That's everything. I'll write this up. Thanks all, talk next week.

**9:00**
Tom
Thanks, bye.
