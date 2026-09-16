namespace MyCompany.Sales;

[DddDomainService]
public interface PriceChangesPolicy
{
    bool CanChangePrices(int oldQuantity, int newQuantity);
    Task<int> GetAsync();
}
