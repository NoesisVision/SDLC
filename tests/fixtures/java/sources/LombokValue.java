package com.acme.orders;

import lombok.Builder;
import lombok.Getter;
import lombok.Value;

// Lombok generates the getters, the constructor, equals/hashCode/toString and
// the builder; none of that is in the source, and none of it is a behavior.
// The fields are the data whatever generates their accessors.
@ValueObject
@Value
@Builder
public class Conditions {
    UserStatus userStatus;
    private final List<Discount> discounts;
    @Getter(AccessLevel.NONE) transient int cachedHash;
    int limit, threshold;
    Class<? extends Discount> exclusiveType;
    Map<String, List<Integer>> buckets = new HashMap<>();
    int[] sizes = { 1, 2 };
    Runnable onChange = new Runnable() { public void run() {} };

    static final int MAX = 10;
    private static Conditions EMPTY;

    Discount pick(int index) { return discounts.get(index); }
    boolean allows(Discount discount) { return true; }
    protected void recompute() {}
    private void audit() {}
}
