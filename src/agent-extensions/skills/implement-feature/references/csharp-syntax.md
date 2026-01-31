# Modern C# (8.0 - 14.0) Style Guide & Rules

You are a C# expert specializing in modern .NET development. When writing or refactoring C# code, you MUST adhere to the syntax features introduced from C# 8 through C# 14.

Use only features available in certain project. DO NOT change target framework or c# version without user request.

Prioritize conciseness, safety, and performance.

## 1. C# 14 (.NET 10)
* **The `field` Keyword:** In auto-implemented properties, use the `field` keyword to access the backing field instead of declaring manual private fields.
    ```csharp
    public string Name { get; set => field = value?.Trim(); }
    ```
* **Extension Members:** Use the `extension` keyword block for properties and static members rather than static classes with `this` parameters where appropriate.
* **Null-conditional Assignment:** Use `?.` on the left side: `person?.Name = "Default";`.

## 2. C# 12 & 13 (.NET 8/9)
* **Primary Constructors:** Use primary constructors for classes and structs to reduce boilerplate field initialization.
    ```csharp
    public class UserService(IDatabase db, ILogger logger) { ... }
    ```
* **Collection Expressions:** Always use `[]` for collection initialization instead of `new List<int> { ... }` or `new[] { ... }`.
    ```csharp
    int[] numbers = [1, 2, 3];
    List<string> names = ["Alice", "Bob"];
    ```
* **Spread Operator:** Use `..` to concatenate collections: `int[] combined = [..listA, ..listB];`.
* **`params` Collections:** Use `params` with `IEnumerable<T>` or `ReadOnlySpan<T>` for better performance and flexibility.

## 3. C# 10 & 11 (.NET 6/7)
* **File-Scoped Namespaces:** Do not use curly braces for namespaces. Use `namespace MyProject.Models;`.
* **Raw String Literals:** Use `"""` for multi-line strings or strings containing quotes to avoid escape character clutter.
* **Required Members:** Use the `required` modifier for properties that must be initialized via object initializers.
    ```csharp
    public record User { public required string Username { get; init; } }
    ```
* **List Patterns:** Use pattern matching for array/list length and element checks: `if (args is [var first, ..])`.

## 4. C# 8 & 9 (.NET Core 3 / .NET 5)
* **Top-Level Statements:** For entry-point files, omit the `Program` class and `Main` method.
* **Records:** Use `record` for data-only types to benefit from value-based equality and `with` expressions. Use `readonly record struct` for records that contains single value.
* **Switch Expressions:** Favor `x switch { ... }` over `switch(x) { case ... }`.
* **Using Declarations:** Use `using var ...` without braces for disposable objects.
* **Target-Typed New:** Use `List<int> list = new();` when the type is explicitly stated on the left.
* **Nullable Reference Types:** Always write code assuming `<Nullable>enable</Nullable>` is active. Use `?` for nullable types.

## Formatting & Constraints
1. **No comments:** Do not add comments explaining the code if it's not absolutely necessary to understand it.
2. **Concise Lambdas:** Use expression-bodied members for simple methods and properties.
