Status: APPROVED

### What I observed
- **Site structure and nav type**: Mega-menu
- **Exact Label of the category and subcategory links as shown on-site**:
  - Category: "Men"
  - Subcategory: "T Shirts"
- **Sort control type**: Button, label "Price: Low to High"
- **First product name and price seen after sorting**:
  - Product Name: "Levis Men Soft Pure Cotton Round Neck Half Sleeve Tshirt"
  - Product Price: Rs. 389
- **"Add to cart" button label and any variant selection required**: 
  - Button Label: "Add to Bag"
  - Variant Selection Required: Size
- **Cart/checkout button label**: "Bag"
- **Any error messages or blockers encountered**: None seen

### Test cases

#### TC-001: Purchase cheapest T Shirts in Men [Automate now]
- **Priority**: High
- **Source**: Observed
- **Pre-conditions**: Browser at site home page, no items in the cart
- **Steps**: 
  1. Navigate to https://www.myntra.com/
  2. Click the "Men" navigation link
  3. Click the "T Shirts" link
  4. Set sort order to "Price: Low to High"
  5. Select a size (e.g., S, M, L)
  6. Click "Add to Bag" on the first listed product
  7. Navigate to the cart
  8. Verify the cart contains exactly 1 item
  9. Verify the item name matches the product selected in step 6
  10. Verify the item price is the lowest price seen on the listing page
- **Expected result**: Cart contains 1 item at the lowest listed price; "Bag" button is visible

#### TC-002: Product listing is sorted by price ascending [proposed, not automated yet]
- **Steps**: 1-4 from TC-001
- **Expected**: First product price <= second product price on the listing

### Blockers
- None seen

### Open questions
- None
