namespace MyCompany.Sales;

[DddValueObject]
public record ClientId(Guid Value)
{
    public override bool Equals(object? other) => false;
    public bool Equals(ClientId other) => true;
    public override int GetHashCode() => 0;
    public override string ToString() => "x";
    public new Type GetType() => typeof(ClientId);
    public void Deconstruct(out Guid v) { v = Value; }
    public bool PrintMembers(StringBuilder sb) => true;
    protected override void Finalize() { }
    public ClientId MemberwiseClone() => this;
    public static ClientId From(Guid g) => new(g);
}
