# The method

The reusable unit is not a finished homepage. It is a contract that can produce a distinct store without rewriting the commercial plumbing each time.

## 1. Define the buying decision

Each brand pack starts with the decision a customer is trying to make. That determines the storefront composition:

- skincare: choose a concern, understand a routine, trust the ingredients, reorder;
- luxury: discover a collection, inspect material and fit, personalise, gift;
- premium home wellness: compare specifications, configure, understand delivery, ask for help.

## 2. Keep portable facts portable

Brand language, navigation, product fixtures, tokens and section order live in JSON. Options may carry price modifiers in minor currency units; the generator expands them into the same Cartesian variant set on both platforms. Shared CSS and small browser behaviours use a stable class and data-attribute contract.

## 3. Keep commerce native

Liquid renders Shopify objects and forms. When the authorised WooCommerce extension is supplied, PHP and WordPress hooks render WooCommerce objects and forms. Cart, checkout, customer accounts, inventory and payment state remain owned by each platform.

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

Automated checks reject broken media references, duplicate product or section IDs, missing adapter implementations, malformed Shopify schemas, unsupported Shopify asset-to-image pipelines, invalid option combinations, Shopify image metadata without a public image source and unresolved build tokens. Local product artwork is packaged with the theme and rendered by Shopify fallback markup, so its CSV image fields stay empty rather than pretending a local asset path is an importable URL. These checks complement the runtime journeys; they do not replace them.

## 5. Add another brand

Create `<brand-root>/<id>/brand.json`, `catalog.json` and an `assets` folder. Choose a composition already supported by the section contract or add a new implementation to the public Shopify adapter and every authorised platform extension before using it.

Do not start by styling a generic shop. Start with the uncertainty that prevents a buyer from acting, then choose the sections that remove it. That is what allows the shared method to produce stores that feel commercially specific rather than templated.
