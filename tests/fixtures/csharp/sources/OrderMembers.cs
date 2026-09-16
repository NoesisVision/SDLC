namespace MyCompany.Sales;

[DddAggregate]
public class Order
{
    public int Size { get; set; }
    public int Counter = 0;
    public static readonly Regex Pattern = new Regex("a");

    public Order(int x) { }

    public class Item
    {
        public void InnerOnly() { }
    }

    public int Total() => 42;
    public static Item For(ProductAmount p) => new(p);
    public void OuterMethod() { }
}
