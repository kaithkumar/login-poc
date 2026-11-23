Status: DRAFT - awaiting human approval

### What I observed
- **Site structure and nav type**: The site uses a horizontal navigation bar with categories like "Men", "Women", "Kids", etc.
- **Exact Label of the category and subcategory links as shown on-site**:
  - Category: "Men"
  - Subcategory: "T Shirts"
- **Sort control type**: The sort control is a dropdown menu labeled "Sort by".
- **First product name and price seen after sorting**: Not applicable as sorting has not been applied yet.
- **"Add to cart" button label and any variant selection required**: Not applicable as sorting has not been applied yet.
- **Cart/checkout button label**: Not applicable as sorting has not been applied yet.
- **Any error messages or blockers encountered**: None seen.

### Test cases

#### TC-001: Purchase cheapest t-shirt in Men [Automate now]
- **Priority**: High
- **Source**: Observed
- **Pre-conditions**: Browser at site home page, no items in the cart
- **Steps**: 
  1. Navigate to https://www.myntra.com/
  2. Click the "Men" navigation link
  3. Click the "T Shirts" link
  4. Set sort order to "price: Low to High"
  5. Click "Add to cart" on the first listed product
  6. Navigate to the cart
  7. Verify the cart contains exactly 1 item
  8. Verify the item name matches the product selected in step 5
  9. Verify the item price is the lowest price seen on the listing page
- **Expected result**: Cart contains 1 item at the lowest listed price; "proceed to checkout" button is visible

#### TC-002: Product listing is sorted by price ascending [proposed, not automated yet]
- **Steps**: 1-4 from TC-001
- **Expected**: First product price <= second product price on the listing

### Blockers
- None seen

### Open questions
- None
