# NOURISH HUB Store — User guide

## Administrator

1. Sign in with the initial administrator credentials and change the password before normal use.
2. Add team accounts with the correct role from **Team access**.
3. Maintain categories, products and suppliers. Assign each product a unique SKU and a low-stock threshold.
4. Review the overview, notifications, reports and audit trail regularly.

## Store manager

- Monitor revenue, inventory value, low-stock and out-of-stock products on Overview.
- Review New stock, Low stock and Out of stock notifications.
- Maintain product details and authorize stock receipts.
- Use Reports & analytics for revenue and product performance.

## Storekeeper

- Register catalogue products if granted access.
- Use Stock receiving for each accepted delivery.
- Enter the actual date the delivery arrived, not the date it was typed into the system.
- Verify the generated receipt reference and new stock balance.

## Cashier

- Open Point of sale and search/select available products.
- Adjust quantities within the available stock limit.
- Select payment method, apply any authorized discount and enter the amount received.
- Complete the sale only after confirming the total and payment.
- Keep the sale reference for customer service and end-of-day reconciliation.

## Stock status rules

- **IN STOCK:** quantity is greater than the configured threshold.
- **LOW STOCK:** quantity is above zero and at or below the threshold. Default threshold: 10.
- **OUT OF STOCK:** quantity is zero. Checkout is blocked until stock is replenished.

A low-stock alert is generated once when the balance enters the low-stock range. Replenishment above the threshold resets the alert episode. An out-of-stock event generates a critical notification.
