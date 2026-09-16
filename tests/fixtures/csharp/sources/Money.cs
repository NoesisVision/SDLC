namespace MyCompany.Sales;

[DddValueObject]
public class Money
{
    public override bool Equals(object? other) => false;
    public override int GetHashCode() => 0;
    public override string ToString() => "";

    public bool IsZero() => true;
}
