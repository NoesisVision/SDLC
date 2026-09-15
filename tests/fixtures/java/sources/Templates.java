package com.acme;

// @AggregateRoot public class Commented {}
/* @AggregateRoot public class BlockCommented { public void nope() {} } */
@DomainService
public class Templates {
    private static final String OPEN = "{";
    private static final char CLOSE = '}';
    private static final String SNIPPET = """
        @AggregateRoot
        public class InText {
            public void nope() {}
        }
        """;
    public String render() { return OPEN + "\"}" + CLOSE; }
}
