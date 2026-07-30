# The method

The reusable unit is not a finished homepage. It is a contract that can produce a distinct store without rewriting the commercial plumbing each time.

## 1. Define the buying decision

Each brand pack starts with the decision a customer is trying to make. That determines the storefront composition:

- skincare: choose a concern, understand a routine, trust the ingredients, reorder;
- luxury: discover a collection, inspect material and fit, personalise, gift;
- premium home wellness: compare specifications, configure, understand delivery, ask for help.

## 2. Keep portable facts portable

Each brand keeps exactly one editable product catalogue beside its brand configuration: `catalog.json` or `catalog.csv`. Builds reject both competing sources and reject a missing source.

Brand language, navigation, tokens, a generic presentation preset and section order live in `brand.json`; product facts live in the brand's selected catalogue source. Options may carry price modifiers in minor currency units; the generator expands them into the same Cartesian variant set on both platforms. An option can also expose explicit regional or measurement labels through its `presentation` metadata and each value's `displayLabels`. Those labels never become another option axis: the canonical value still owns the variant, SKU, price, media and inventory, while the browser changes only the visible nomenclature and records a reference for the order. Missing mappings, duplicate system IDs and undeclared labels fail validation. A Shopify product grid can remain limited to its managed handles, read a native Shopify collection, or combine both in stable order while removing duplicate handles. The native collection is presentation-only: its Shopify-managed products are neither imported into the brand pack nor deleted by the generated catalogue. Configure that behaviour with `shopifyCatalog.mode`, `shopifyCatalog.collectionHandle` and the optional bounded `shopifyCatalog.productLimit` on the product-grid section. Optional `variantMedia` rules associate visible option values or combinations with portable local artwork, with the most specific matching rule taking precedence. When a colour or finish changes the product without changing its form, an explicit `cardMediaSelector` can expose those approved images directly on product cards; it changes only the visual preview and never infers a selector from unrelated variants. Products may also include a portable `details` list of titled text blocks; the build escapes those values and turns them into the same structured product description for the static preview, Shopify and WooCommerce. Product pages keep quantity changes inside an explicit, reusable control and surface the rest of the catalogue without repeating the current item. At compact widths, related products stay in one horizontal rail with buttons, keyboard scrolling, pointer drag and native touch scrolling. Product media in the preview and Shopify uses click-to-zoom by default, with pinned drag inspection and keyboard controls; `presentation.productZoom: "hover"` enables cursor-led zoom when a storefront calls for it. On larger screens, technical layouts place one landscape image in a filled 4:3 frame; the optional `presentation.productMediaHorizontalFocus` keeps the important part of the image visible without exposing a second variant. WooCommerce keeps its own native gallery zoom. Preview and Shopify cart removal use the same theme-aware confirmation dialog instead of browser chrome. Shared CSS and small browser behaviours use a stable class and data-attribute contract. Presentation presets describe composition (`standard`, `editorial` or `technical`) without coupling the public method to a private brand identity.

## 3. Keep commerce native

Liquid renders Shopify objects and forms. When the authorised WooCommerce extension is supplied, PHP and WordPress hooks render WooCommerce objects and forms. The same option contract becomes native WooCommerce variations: resolved media is assigned to each variation, visual controls remain synchronized with the underlying selects, card swatches preview media without changing purchase state, and active engraving choices collect validated text that survives into cart and order line items. Cart, checkout, customer accounts, inventory and payment state remain owned by each platform.

## 4. Generate, then verify

The public build creates a preview, a native Shopify theme and its import file. Supplying the authorised WooCommerce adapter and seeder adds the matching native theme, import file and reproducible Playground bundle. The all-brand build also creates one validated Shopify catalogue for a shared development store, rather than relying on a manually merged CSV. A complete dual-platform release is only valid after the same journeys pass in both runtimes:

1. browse collection;
2. select a variant or option;
3. add to cart;
4. edit cart;
5. reach native checkout;
6. use the store on a small phone viewport;
7. navigate with keyboard and visible focus;
8. load without layout shifts from missing media dimensions.

Automated checks reject broken media references, duplicate product or section IDs, colliding generated Shopify variant SKUs, missing adapter implementations, malformed Shopify schemas, unsupported Shopify asset-to-image pipelines, invalid option combinations, ambiguous variant-media rules, Shopify image metadata without a public image source and unresolved build tokens. Local product artwork is packaged with the theme and rendered by Shopify fallback markup, so its canonical CSV image fields stay empty rather than pretending a local asset path is an importable URL. A generated media manifest lets the separate hydration step assign store-specific HTTPS URLs to both products and variants. These checks complement the runtime journeys; they do not replace them.

## 5. Add another brand

Create `<brand-root>/<id>/brand.json`, exactly one `catalog.json` or `catalog.csv`, and a flat `assets` folder. Brand, product and section IDs use lowercase URL-safe slugs; nested asset directories are rejected so every validated media path is guaranteed to reach every generated target. Choose a composition already supported by the section contract or add a new implementation to the public Shopify adapter and every authorised platform extension before using it.

Do not start by styling a generic shop. Start with the uncertainty that prevents a buyer from acting, then choose the sections that remove it. That is what allows the shared method to produce stores that feel commercially specific rather than templated.
