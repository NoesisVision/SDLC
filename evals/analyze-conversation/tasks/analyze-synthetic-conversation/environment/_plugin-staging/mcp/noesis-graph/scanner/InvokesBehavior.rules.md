# `Behavior.Invokes` — Relation Rules

The `Invokes` relation expresses that one domain behavior causes the
execution of another. A **domain behavior** is a C# method that has been
classified as Behavior by the scanner.

Informally: *a domain behavior `A` invokes a domain behavior `B` when `B` can
be reached from the body of `A` through a chain of method calls that does not
cross another domain behavior along the way.*

The precise rules below are expressed in terms of C# syntax — methods, base
methods, interface members, overrides, generic definitions — rather than
scanner-internal concepts.

---

## Terminology

| Term | Meaning |
| --- | --- |
| **Method** | Any C# method declaration: instance, static, constructor, virtual, abstract, override, interface member, explicit interface implementation. |
| **Domain behavior method** | A method that has been classified as a domain behavior. |
| **Call site** | An invocation expression appearing in a method's body or expression-bodied member. |
| **Target of a call site** | The method symbol that the invocation resolves to at compile time. If the invocation is of a constructed generic method, the target is the generic method definition (see G2). |
| **Base method chain** of `M` | `M`'s `override` target, that target's `override` target, and so on up to the topmost virtual/abstract declaration. |
| **Interface members of `M`** | The interface methods that `M` implements — either implicitly or via an explicit interface implementation. |

---

## When the relation is produced

A relation is produced **per call site**. For each call site inside a method
body, the analyzer computes:

- a set of **sources** — domain behaviors on the *caller* side, derived from
  the method that contains the call site;
- a set of **destinations** — domain behaviors on the *callee* side, reached
  by forward traversal from the call target;

and emits one `Invokes(source, destination)` per pair.

---

## Source rules (the caller side)

Let `M` be the method that contains the call site. Each of the following that
resolves to a domain behavior contributes one source:

### S1 — The containing method
If `M` is itself a domain behavior, `M` is a source.

### S2 — Interface members implemented by `M`
For every interface member that `M` implements (implicitly or through an
explicit interface implementation), if that interface member is a domain
behavior, it is a source.

### S3 — The base method chain
For every method `B` in the base method chain of `M`:
- if `B` is a domain behavior, it is a source;
- for every interface member that `B` implements, if that interface member is
  a domain behavior, it is a source.

### S4 — Overrides and derived types are never sources
Methods that override `M`, or that implement `M` when `M` is itself an
interface member, are not considered. The traversal is strictly upward.

### S5 — Interface inheritance is not traversed
Only the interfaces that a method *directly* implements are inspected. Base
interfaces of those interfaces (an interface's own parents) are not followed.

---

## Destination rules (the callee side)

Let `T` be the target of the call site. A **forward search** is performed over
the call graph starting at `T`:

### D1 — Direct call to a domain behavior
If `T` is a domain behavior, `T` is the destination.

### D2 — Indirect call through non-behavior methods
If `T` is not a domain behavior, the search recursively examines the call
sites appearing in `T`'s body and continues through every target. The first
domain behavior found on any such forward path is a destination.

### D3 — Domain behaviors act as barriers
Once a domain behavior is found along a forward path, the search does not
descend into *its* body. Its own call sites are the responsibility of its own
analysis, not of this one.

### D4 — No inheritance or interface resolution on the callee side
Only the literal target of each invocation expression and its transitive call
chain are considered. The destination search never ascends to base methods or
interface members of `T` — e.g. calling an override does not implicate the
base method as a destination, and calling an implementation does not implicate
the interface member.

### D5 — Cycle safety
Each method is traversed at most once per call-site analysis. Recursive or
mutually recursive call chains terminate without producing duplicate
destinations.

---

## Generics

### G1 — Members of a constructed generic type link to the generic definition
A method declared on a constructed generic type (for example
`Repository<Order>.Save`) is treated, on the **source side**, as implementing
the corresponding method on the generic type definition
(`Repository<T>.Save`). The generic-definition method is therefore inspected
in the same manner as an interface member under S2/S3.

### G2 — Call sites of constructed generic methods resolve to the definition
When a call site invokes a constructed generic method, the target used for
destination analysis is the generic method definition, not the construction.

---

## Emission

### E1 — Cartesian product
A single call site produces one `Invokes` for each `(source,
destination)` pair in the computed sets.

### E2 — Multiple sources yield multiple relations
If a calling method and one of its base methods are both domain behaviors, the
same call site produces a separate relation for each. The source set is not
collapsed to a single "most specific" behavior.

---

## Examples

### Direct invocation
```csharp
public class Order                    // domain behavior on both methods
{
    public void Place()  => Notify(); // call site
    public void Notify() { /* … */ }
}
```
Produces: `Place → Notify`.

### Indirect invocation through a non-behavior helper
```csharp
public class Order
{
    public void Place()                      // domain behavior
        => PlaceCore();

    private void PlaceCore()                 // not a domain behavior
        => Notify();

    public void Notify() { /* … */ }         // domain behavior
}
```
Produces: `Place → Notify` (D2). `PlaceCore` is transparent to the search.

### Base class method as source
```csharp
public abstract class OrderBase
{
    public virtual void Place()              // domain behavior
        => throw new NotImplementedException();
}

public class Order : OrderBase
{
    public override void Place()             // also a domain behavior
        => Notify();

    public void Notify() { /* … */ }         // domain behavior
}
```
Produces: `Order.Place → Notify` (S1) **and** `OrderBase.Place → Notify`
(S3). Both are emitted (E2).

### Interface member as source
```csharp
public interface IOrder
{
    void Place();                            // domain behavior
}

public class Order : IOrder
{
    public void Place()                      // domain behavior
        => Notify();

    public void Notify() { /* … */ }         // domain behavior
}
```
Produces: `Order.Place → Notify` (S1) and `IOrder.Place → Notify` (S2).

### Destination does not follow overrides
```csharp
public abstract class OrderBase
{
    public abstract void Notify();           // domain behavior
}

public class Order : OrderBase
{
    public override void Notify() { /* … */ }// domain behavior

    public void Place() => ((OrderBase)this).Notify();
}
```
The call site's target is `OrderBase.Notify`. Rule D4 means only
`OrderBase.Notify` is considered as destination — `Order.Notify` is *not*
also added.

### Generic definition as source
```csharp
public interface IRepository<T>
{
    void Save(T entity);                     // domain behavior
}

public class OrderRepository : IRepository<Order>
{
    public void Save(Order entity)           // domain behavior
        => Persist(entity);

    private void Persist(Order entity) { /* … */ }
}
```
The `IRepository<Order>.Save` member links to `IRepository<T>.Save` (G1), so
both `OrderRepository.Save` and `IRepository<T>.Save` appear as sources if
they are domain behaviors.
