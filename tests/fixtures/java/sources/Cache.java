package com.acme;

@Entity
public class Cache {
    public final Map<String, List<Integer>> entries = new HashMap<>();
    public int[] sizes = { 1, 2 };
    public static int count;
    static { count = 0; }
    { entries.clear(); }
    public Map<String, List<Integer>> entries() { return entries; }
}
